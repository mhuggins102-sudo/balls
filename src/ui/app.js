// Browser glue: ties the Game, the DropController and the Renderer to the DOM.

import { Game } from '../game.js';
import { BALL_TYPES, describeBall } from '../balls.js';
import { PERKS } from '../perks.js';
import { Renderer } from './render.js';
import { seedToString, parseSeed } from '../rng.js';
import { determinismScenario } from '../determinism.js';

const SAVE_KEY = 'balls.save.v1';
const FAST_FORWARD = 4;

const $ = (sel) => document.querySelector(sel);
const el = {
  balance: $('#hud-balance'),
  quota: $('#hud-quota'),
  stage: $('#hud-stage'),
  bagCount: $('#hud-bag-count'),
  panel: $('#panel'),
  canvas: $('#board'),
  hint: $('#board-hint'),
  modal: $('#modal'),
  modalCard: $('#modal-card'),
  toast: $('#toast'),
};

const ui = {
  game: null,
  renderer: null,
  controller: null,
  speed: 1,
  placing: null,   // { index, perkId } while the player picks a target
  modal: null,     // { kind, ... } for re-rendering open modals
  acc: 0,
  lastTs: 0,
  unsub: null,
  toastTimer: 0,
};

// ----------------------------------------------------------------- helpers

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => `$${n}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const chip = (type, extra = '') => `<span class="chip ${esc(type)} ${extra}" title="${esc(BALL_TYPES[type].name)}"></span>`;

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

// ----------------------------------------------------------------- persistence

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSave() {
  if (!ui.game) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(ui.game.toJSON())); } catch { /* storage may be unavailable */ }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// ----------------------------------------------------------------- run lifecycle

function attachGame(game) {
  if (ui.unsub) ui.unsub();
  ui.game = game;
  ui.controller = game.controller || null;
  ui.placing = null;
  ui.speed = 1;
  ui.acc = 0;
  ui.unsub = game.onChange(() => {
    writeSave();
    renderHud();
    renderPanel();
    if (ui.modal && ui.modal.kind === 'bag') showBagModal(ui.modal.removeMode);
  });
  if (!ui.renderer) ui.renderer = new Renderer(el.canvas, game.board, game.cfg);
  else ui.renderer.setBoard(game.board, game.cfg);
  writeSave();
  renderHud();
  renderPanel();
  if (game.over) showEndModal();
}

function newRun(seed) {
  attachGame(Game.newRun({ seed }));
  closeModal();
  toast(`New run · seed ${seedToString(ui.game.s.seed)}`);
}

function boot() {
  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  let game = null;
  if (seedParam) {
    game = Game.newRun({ seed: parseSeed(seedParam) });
    history.replaceState(null, '', location.pathname);
  } else {
    const saved = readSave();
    if (saved) {
      try { game = Game.fromJSON(saved); } catch (e) { console.warn('Could not restore the saved run', e); }
    }
  }
  if (!game) game = Game.newRun({});
  attachGame(game);
  bindEvents();
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------------- animation

function isAnimating() {
  const g = ui.game;
  return g.phase === 'dropping' || (g.phase === 'payout' && g.s.redropActive != null);
}

function loop(ts) {
  const dtReal = ui.lastTs ? Math.min(0.1, (ts - ui.lastTs) / 1000) : 0;
  ui.lastTs = ts;
  const c = ui.controller;
  if (c && !c.finished && isAnimating()) {
    ui.acc += dtReal * ui.speed;
    const dt = ui.game.cfg.timestep;
    let n = 0;
    while (ui.acc >= dt && n < 4000) {
      c.step();
      ui.acc -= dt;
      n++;
      if (c.finished) { ui.acc = 0; break; }
    }
    if (c.finished) onDropFinished();
  }
  ui.renderer.draw(buildScene());
  requestAnimationFrame(loop);
}

function onDropFinished() {
  const g = ui.game;
  if (g.phase === 'dropping') g.finishDrop();
  else if (g.phase === 'payout' && g.s.redropActive != null) g.finishRedrop();
}

function buildScene() {
  const g = ui.game;
  const s = g.s;
  const bodies = ui.controller ? ui.controller.world.balls : [];
  let targets = null;
  if (ui.placing) {
    const perk = PERKS[ui.placing.perkId];
    if (perk.target === 'gap') targets = { kind: 'gap' };
    else if (perk.target === 'slot') targets = { kind: 'slot', exclude: perk.id === 'block' ? s.mods.blocked : [] };
    else targets = { kind: 'ball' };
  }
  return { layout: s.layout, mods: s.mods, bodies, targets, phase: s.phase };
}

// ----------------------------------------------------------------- HUD and panel

function renderHud() {
  const v = ui.game.view();
  el.balance.textContent = money(v.balance);
  el.quota.textContent = `Quota ${money(v.nextQuota)} in ${plural(v.roundsLeft, 'round')}`;
  el.stage.textContent = `Stage ${v.stage}/${v.stages} · Round ${v.round}/${v.roundsPerStage}`;
  el.bagCount.textContent = v.bagTotal;
}

function updateHint() {
  if (ui.placing) {
    el.hint.textContent = placingHint(ui.placing);
    el.hint.hidden = false;
  } else {
    el.hint.hidden = true;
  }
}

function placingHint(placing) {
  switch (placing.perkId) {
    case 'wall': return 'Tap a gap between two pegs';
    case 'block': return 'Tap the slot to cap';
    case 'double': return 'Tap the slot to double';
    case 'redrop': return 'Tap the ball to drop again';
    default: return '';
  }
}

function modeDesc(mode) {
  return mode === 'cluster' ? 'All together · spreads wide' : 'One at a time · center-heavy';
}

function perkSlots(v, phase, enabled = true) {
  const out = [];
  for (let i = 0; i < v.perkCap; i++) {
    const id = v.perks[i];
    if (!id) { out.push('<div class="perk-btn empty">Empty</div>'); continue; }
    const perk = PERKS[id];
    const usable = enabled && perk.phase === phase;
    const selected = ui.placing && ui.placing.index === i ? 'selected' : '';
    out.push(`<button class="perk-btn ${selected}" data-action="use-perk" data-index="${i}" ${usable ? '' : 'disabled'} title="${esc(perk.desc)}">
      <span class="name">${esc(perk.name)}</span><span class="when">${perk.phase === 'before' ? 'before drop' : 'after drop'}</span></button>`);
  }
  return out.join('');
}

function ffButton() {
  const on = ui.speed > 1;
  return `<button data-action="ff" class="${on ? 'active' : ''}">${on ? `⏩ ${FAST_FORWARD}× on` : '⏩ Fast forward'}</button>`;
}

function renderPanel() {
  const v = ui.game.view();
  let html = '';
  switch (v.phase) {
    case 'setup': html = setupPanel(v); break;
    case 'dropping': html = droppingPanel(v); break;
    case 'payout': html = payoutPanel(v); break;
    case 'shop': html = shopPanel(v); break;
    case 'won':
    case 'lost': html = endPanel(v); break;
    default: html = '';
  }
  el.panel.innerHTML = html;
  updateHint();
}

function setupPanel(v) {
  const hand = v.hand.map((b) => chip(b.type)).join('');
  const controls = ui.placing
    ? `<div class="row between"><span>${esc(placingHint(ui.placing))}</span><button data-action="cancel-place">Cancel</button></div>`
    : `<div class="row nowrap">
        <div class="seg">
          <button data-action="mode" data-mode="single" class="${v.dropMode === 'single' ? 'active' : ''}">Single</button>
          <button data-action="mode" data-mode="cluster" class="${v.dropMode === 'cluster' ? 'active' : ''}">Cluster</button>
        </div>
        <button class="primary big" data-action="drop">Drop ${v.hand.length} balls</button>
      </div>`;
  return `
    <div class="row">
      <span class="label">Hand</span>
      <div class="chip-row">${hand}</div>
      <span class="spacer"></span>
      <span class="small muted">${modeDesc(v.dropMode)}</span>
    </div>
    <div class="row"><span class="label">Perks</span><div class="perk-slots">${perkSlots(v, 'before')}</div></div>
    ${controls}`;
}

function droppingPanel(v) {
  const bodies = ui.controller ? ui.controller.bodies : [];
  const hand = v.hand.map((b, i) => chip(b.type, bodies[i] ? 'dim' : '')).join('');
  return `
    <div class="row">
      <span class="label">Hand</span>
      <div class="chip-row">${hand}</div>
      <span class="spacer"></span>
      <span class="small muted">${v.dropMode === 'cluster' ? 'Cluster' : 'Single'} drop…</span>
    </div>
    <div class="row between">${ffButton()}<span class="small muted">Watch the balls land</span></div>`;
}

function continueLabel(v) {
  if (v.round >= v.roundsPerStage) {
    const after = v.balance + v.payout.total;
    if (after >= v.nextQuota) return v.stage >= v.stages ? `Pay final quota ${money(v.nextQuota)} and win` : `Pay quota ${money(v.nextQuota)}`;
    return `Quota check · short by ${money(v.nextQuota - after)}`;
  }
  return 'Continue to shop';
}

function payoutPanel(v) {
  const p = v.payout;
  const redropping = v.redropActive != null;
  const selecting = ui.placing && ui.placing.perkId === 'redrop';
  const rows = p.entries.map((e) => {
    const amount = e.perk
      ? `<span class="amount perk">+${esc(PERKS[e.perk].name)} perk</span>`
      : `<span class="amount">+${money(e.payout)}</span>`;
    const note = e.note && !e.perk ? ` <span class="muted small">${esc(e.note)}</span>` : '';
    const where = e.slot < 0 ? 'lost' : `Slot ${e.slot + 1}${v.layout.highlighted.includes(e.slot) ? ' ★' : ''}`;
    const sel = selecting ? 'selectable' : '';
    const act = selecting ? `data-action="pick-ball" data-index="${e.index}"` : '';
    const active = redropping && v.redropActive === e.index ? '<span class="muted small">re-dropping…</span>' : '';
    return `<div class="payout-row ${sel}" ${act}>${chip(e.type)}<span>${where}${note} ${active}</span>${amount}</div>`;
  }).join('');
  let controls;
  if (redropping) {
    controls = `<div class="row between">${ffButton()}<span class="small muted">Re-dropping…</span></div>`;
  } else if (selecting) {
    controls = `<div class="row between"><span>Tap the ball to drop again</span><button data-action="cancel-place">Cancel</button></div>`;
  } else {
    controls = `
      <div class="row"><span class="label">Perks</span><div class="perk-slots">${perkSlots(v, 'after')}</div></div>
      <div class="row"><button class="primary big" data-action="continue">${esc(continueLabel(v))}</button></div>`;
  }
  return `
    <div class="payout-list">${rows}</div>
    <div class="payout-total"><span>Round total</span><span>+${money(p.total)}</span></div>
    ${controls}`;
}

function shopPanel(v) {
  const g = ui.game;
  const cfg = g.cfg;
  const s = v.shop;
  const afford = (price) => v.balance >= price;
  const offers = s.balls.map((type, i) => {
    if (!type) return '<div class="offer sold"><span class="name">Sold</span></div>';
    const price = cfg.ballPrices[type];
    return `<div class="offer">${chip(type, 'lg')}<span class="name">${esc(BALL_TYPES[type].name)}</span>
      <span class="desc">${esc(describeBall(type, cfg))}</span>
      <button data-action="buy-ball" data-index="${i}" ${afford(price) ? '' : 'disabled'}>Buy ${money(price)}</button></div>`;
  }).join('');
  const perkFull = v.perks.length >= v.perkCap;
  const perkOffer = s.perk
    ? `<div class="shop-line"><div class="info"><div class="name">Perk: ${esc(PERKS[s.perk].name)} <span class="muted small">(${v.perks.length}/${v.perkCap} held)</span></div>
         <div class="desc">${esc(PERKS[s.perk].desc)}</div></div>
       <button data-action="buy-perk" ${afford(cfg.perkPrice) && !perkFull ? '' : 'disabled'}>${perkFull ? 'Full' : `Buy ${money(cfg.perkPrice)}`}</button></div>`
    : '<div class="shop-line"><div class="info"><div class="name muted">Perk sold</div></div></div>';
  const canRemove = g.canRemoveBall() && afford(cfg.ballRemovalPrice);
  const removal = `<div class="shop-line"><div class="info"><div class="name">Remove a ball</div>
      <div class="desc">Take one ball out of the bag for good. Bag ${v.bagTotal}, hand ${v.handSize}.</div></div>
    <button data-action="remove-ball" ${canRemove ? '' : 'disabled'}>${money(cfg.ballRemovalPrice)}</button></div>`;
  const canUpgrade = g.canUpgradeHand() && afford(v.handUpgradePrice);
  const upgrade = `<div class="shop-line"><div class="info"><div class="name">Hand size ${v.handSize} → ${v.handSize + 1}</div>
      <div class="desc">One more ball drawn and dropped every round.${g.canUpgradeHand() ? '' : ' Needs a bigger bag.'}</div></div>
    <button data-action="upgrade-hand" ${canUpgrade ? '' : 'disabled'}>${money(v.handUpgradePrice)}</button></div>`;
  return `
    <div class="shop-header">
      <div><div class="label">Balance</div><div class="big-num">${money(v.balance)}</div></div>
      <div><div class="label">Next quota</div><div class="big-num">${money(v.nextQuota)}</div></div>
      <div><div class="label">Due in</div><div class="big-num">${plural(v.roundsLeft, 'round')}</div></div>
    </div>
    <div class="row between"><span class="label">Balls</span><button data-action="reroll" ${afford(cfg.rerollPrice) ? '' : 'disabled'}>Reroll offers ${money(cfg.rerollPrice)}</button></div>
    <div class="shop-grid">${offers}</div>
    ${perkOffer}
    ${removal}
    ${upgrade}
    <div class="row"><button class="primary big" data-action="next-round">Start stage ${v.stage} · round ${v.round}</button></div>`;
}

function endPanel(v) {
  const o = v.outcome;
  const text = o.won ? `You won with ${money(o.score)} left over.` : `Run over at stage ${o.failedStage}: ${money(o.quota)} quota, ${money(o.balance)} balance.`;
  return `
    <div class="row between"><span>${esc(text)}</span></div>
    <div class="row"><button class="primary big" data-action="show-end">Results</button><button class="big" data-action="new-run">New run</button></div>`;
}

// ----------------------------------------------------------------- modals

function openModal(html, state) {
  ui.modal = state || { kind: 'generic' };
  el.modalCard.innerHTML = html;
  el.modal.hidden = false;
}
function closeModal() {
  ui.modal = null;
  el.modal.hidden = true;
  el.modalCard.innerHTML = '';
}

function showBagModal(removeMode) {
  const g = ui.game;
  const v = g.view();
  const cfg = g.cfg;
  const canRemove = removeMode && g.phase === 'shop' && g.canRemoveBall() && v.balance >= cfg.ballRemovalPrice;
  const list = (balls) => (balls.length
    ? balls.map((b) => `<div class="ball-line">${chip(b.type)}<span>${esc(BALL_TYPES[b.type].name)}</span><span class="spacer"></span>
        ${canRemove ? `<button data-action="bag-remove" data-id="${b.id}">Remove ${money(cfg.ballRemovalPrice)}</button>` : ''}</div>`).join('')
    : '<div class="muted small">Empty</div>');
  const inPlay = v.hand.length
    ? `<h3>In play (${v.hand.length})</h3><div class="chip-row">${v.hand.map((b) => chip(b.type)).join('')}</div>`
    : '';
  const counts = Object.entries(v.bagCounts.total).map(([t, n]) => `${n} ${BALL_TYPES[t].name.toLowerCase()}`).join(', ');
  openModal(`
    <div class="row between"><h2>Bag · ${v.bagTotal} balls</h2><button data-action="close-modal">Close</button></div>
    <div class="small muted">${esc(counts || 'empty')}${v.hand.length ? ' in the bag, plus the hand in play' : ''}. Hand size ${v.handSize}.</div>
    ${removeMode ? `<div class="small">Remove one ball for ${money(cfg.ballRemovalPrice)}. The bag can never shrink below the hand size.</div>` : ''}
    ${inPlay}
    <div class="bag-cols">
      <div><h3>Draw pool (${v.pool.length})</h3><div class="ball-list">${list(v.pool)}</div></div>
      <div><h3>Discard (${v.discard.length})</h3><div class="ball-list">${list(v.discard)}</div></div>
    </div>`, { kind: 'bag', removeMode });
}

function showMenuModal() {
  const v = ui.game.view();
  openModal(`
    <div class="row between"><h2>Menu</h2><button data-action="close-modal">Close</button></div>
    <div class="menu-list">
      <button data-action="new-run">New run (random seed)</button>
      <div class="row nowrap"><input type="text" id="seed-input" placeholder="Seed, e.g. 3fa9c21b" autocomplete="off"><button data-action="new-run-seed">Start</button></div>
      <button data-action="determinism">Determinism check</button>
      <button data-action="reset-save" class="danger">Clear saved run</button>
    </div>
    <div class="small muted">Current run seed <code>${seedToString(v.seed)}</code> · stage ${v.stage}, round ${v.round}.</div>`, { kind: 'menu' });
}

function showEndModal() {
  const v = ui.game.view();
  const o = v.outcome;
  const seed = seedToString(v.seed);
  openModal(`
    <h2>${o.won ? 'You won!' : 'Run over'}</h2>
    <div class="end-score">${o.won ? money(o.score) : `Stage ${o.failedStage}`}</div>
    <div class="small muted">${o.won
      ? 'Final score is the money left after the last quota.'
      : `The ${money(o.quota)} quota was due and the balance was ${money(o.balance)}.`}</div>
    <h3>Run seed</h3>
    <div class="seed-box"><code>${seed}</code><button data-action="copy-seed" data-seed="${seed}">Copy</button></div>
    <div class="small muted">Open <code>?seed=${seed}</code> to reproduce this run.</div>
    <div class="row"><button class="primary big" data-action="new-run">New run</button><button class="big" data-action="replay-seed">Replay seed</button></div>`, { kind: 'end' });
}

function showDeterminismModal() {
  const t0 = performance.now();
  const r = determinismScenario(ui.game.cfg);
  const ms = (performance.now() - t0).toFixed(0);
  openModal(`
    <div class="row between"><h2>Determinism check</h2><button data-action="close-modal">Close</button></div>
    <div>Checksum <code>${r.checksum}</code> (${r.trace.length} trace values, ${ms} ms)</div>
    <div class="small muted">Run <code>node sim/harness.js determinism</code>. It must print the same checksum.</div>`, { kind: 'determinism' });
}

// ----------------------------------------------------------------- actions

function doRedrop(index) {
  const placing = ui.placing;
  if (!placing) return;
  ui.placing = null;
  try {
    ui.controller = ui.game.usePerk(placing.index, { index });
    ui.speed = 1;
    ui.acc = 0;
  } catch (e) {
    ui.placing = placing;
    throw e;
  }
}

function handleAction(action, data) {
  const g = ui.game;
  switch (action) {
    case 'mode': g.setDropMode(data.mode); break;
    case 'drop':
      ui.placing = null;
      ui.controller = g.startDrop();
      ui.speed = 1;
      ui.acc = 0;
      break;
    case 'use-perk': {
      const index = Number(data.index);
      const perkId = g.s.perks[index];
      if (!perkId) return;
      if (ui.placing && ui.placing.index === index) { ui.placing = null; renderPanel(); return; }
      ui.placing = { index, perkId };
      renderPanel();
      break;
    }
    case 'cancel-place': ui.placing = null; renderPanel(); break;
    case 'pick-ball': doRedrop(Number(data.index)); renderPanel(); break;
    case 'ff': ui.speed = ui.speed > 1 ? 1 : FAST_FORWARD; renderPanel(); break;
    case 'continue':
      ui.placing = null;
      g.continueFromPayout();
      ui.controller = null;
      if (g.over) showEndModal();
      break;
    case 'buy-ball': g.buyBall(Number(data.index)); break;
    case 'buy-perk': g.buyPerk(); break;
    case 'remove-ball': showBagModal(true); break;
    case 'bag-remove': {
      const removed = g.removeBall(Number(data.id));
      toast(`Removed a ${BALL_TYPES[removed.type].name.toLowerCase()} ball`);
      break;
    }
    case 'upgrade-hand': g.buyHandUpgrade(); break;
    case 'reroll': g.reroll(); break;
    case 'next-round': ui.controller = null; g.nextRound(); break;
    case 'bag': showBagModal(false); break;
    case 'menu': showMenuModal(); break;
    case 'close-modal': closeModal(); break;
    case 'show-end': showEndModal(); break;
    case 'new-run':
      if (!g.over && !window.confirm('Abandon the current run and start a new one?')) return;
      newRun(undefined);
      break;
    case 'new-run-seed': {
      const input = $('#seed-input');
      const text = input ? input.value.trim() : '';
      if (!text) { toast('Enter a seed first'); return; }
      if (!g.over && !window.confirm('Abandon the current run and start a new one?')) return;
      newRun(parseSeed(text));
      break;
    }
    case 'replay-seed': newRun(g.s.seed); break;
    case 'copy-seed':
      if (navigator.clipboard) navigator.clipboard.writeText(data.seed).then(() => toast('Seed copied'), () => toast('Could not copy'));
      else toast(data.seed);
      break;
    case 'determinism': showDeterminismModal(); break;
    case 'reset-save':
      if (!window.confirm('Delete the saved run?')) return;
      clearSave();
      newRun(undefined);
      break;
    default: break;
  }
}

function onBoardTap(ev) {
  if (!ui.placing) return;
  const rect = el.canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  const g = ui.game;
  const placing = ui.placing;
  const perk = PERKS[placing.perkId];
  try {
    if (perk.target === 'gap') {
      const gap = ui.renderer.gapAt(sx, sy);
      if (!gap) { toast('Tap a gap between two pegs'); return; }
      ui.placing = null;
      g.usePerk(placing.index, { row: gap.row, gap: gap.gap });
    } else if (perk.target === 'slot') {
      const slot = ui.renderer.slotAt(sx, sy);
      if (slot < 0) { toast('Tap a slot at the bottom'); return; }
      ui.placing = null;
      g.usePerk(placing.index, { slot });
    } else if (perk.target === 'ball') {
      const bodies = ui.controller ? ui.controller.bodies : [];
      const body = ui.renderer.bodyAt(sx, sy, bodies);
      if (!body) { toast('Tap a landed ball'); return; }
      doRedrop(bodies.indexOf(body));
    }
  } catch (e) {
    ui.placing = placing;
    toast(e.message);
  }
  renderPanel();
}

function bindEvents() {
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    try { handleAction(btn.dataset.action, btn.dataset); } catch (e) { toast(e.message); }
  });
  el.canvas.addEventListener('pointerdown', onBoardTap);
  el.modal.addEventListener('click', (ev) => { if (ev.target === el.modal) closeModal(); });
  const onResize = () => ui.renderer && ui.renderer.resize();
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe($('#board-wrap'));
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ui.placing = null; closeModal(); renderPanel(); } });
}

// Expose a little debugging surface.
window.balls = { get game() { return ui.game; }, determinismScenario, newRun, ui };

boot();
