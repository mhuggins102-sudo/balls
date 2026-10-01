import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, mergeConfig, parseOverrides } from '../src/config.js';
import { Rng, deriveSeed, parseSeed, seedToString } from '../src/rng.js';
import { buildBoard } from '../src/board.js';
import { Bag } from '../src/bag.js';
import { generateLayout } from '../src/slots.js';
import { DropController } from '../src/drop.js';
import { determinismScenario } from '../src/determinism.js';
import { Game } from '../src/game.js';
import { playRun } from '../sim/bots.js';

test('rng is deterministic and serialisable', () => {
  const a = new Rng(123), b = new Rng(123);
  for (let i = 0; i < 100; i++) assert.equal(a.nextU32(), b.nextU32());
  const state = a.getState();
  const c = Rng.fromState(state);
  assert.equal(a.next(), c.next());
  assert.equal(deriveSeed(1, 2, 'x'), deriveSeed(1, 2, 'x'));
  assert.notEqual(deriveSeed(1, 2, 'x'), deriveSeed(1, 3, 'x'));
  assert.equal(parseSeed(seedToString(0xdeadbeef)), 0xdeadbeef);
});

test('board geometry: slot dividers sit under the last peg row', () => {
  const board = buildBoard(DEFAULT_CONFIG);
  assert.equal(board.pegs.length, 21);
  assert.equal(board.dividers.length, 6);
  const lastRow = board.pegs.filter((p) => p.row === 5).map((p) => p.x);
  const dividerX = board.dividers.map((d) => d.x1);
  assert.deepEqual(dividerX.map((x) => +x.toFixed(6)), lastRow.map((x) => +x.toFixed(6)));
  assert.equal(board.slotIndexAt(-3.4), 0);
  assert.equal(board.slotIndexAt(0), 3);
  assert.equal(board.slotIndexAt(3.4), 6);
});

test('bag draw cycles the discard pile and never loses balls', () => {
  const bag = Bag.starting(DEFAULT_CONFIG);
  assert.equal(bag.size, 8);
  const rng = new Rng(1);
  const h1 = bag.draw(rng, 5);
  assert.equal(h1.length, 5);
  assert.equal(bag.pool.length, 3);
  bag.discardAll(h1);
  const h2 = bag.draw(rng, 5);
  assert.equal(h2.length, 5);
  // 3 from the pool, then the discard returned and 2 more drawn from it.
  assert.equal(bag.pool.length, 3);
  assert.equal(bag.discard.length, 0);
  const ids = new Set([...h2, ...bag.pool].map((b) => b.id));
  assert.equal(ids.size, 8);
  bag.add('gold');
  assert.equal(bag.discard.length, 1);
  assert.ok(bag.remove(bag.discard[0].id));
  assert.equal(bag.size, 3, 'the five balls in hand are not in the bag');
});

test('layout generator respects the stage budget and picks distinct special slots', () => {
  for (let seed = 0; seed < 50; seed++) {
    const layout = generateLayout(new Rng(seed), DEFAULT_CONFIG, 1);
    const sum = layout.values.reduce((a, b) => a + b, 0);
    assert.ok(sum >= 25 && sum <= 34, `sum ${sum}`); // stage 1 budget is the base profile sum (29) before rounding
    assert.ok(layout.values.every((v) => v >= 1));
    if (layout.perkSlot >= 0) assert.ok(!layout.highlighted.includes(layout.perkSlot));
  }
  const s3 = generateLayout(new Rng(1), DEFAULT_CONFIG, 3);
  const expected = 29 * DEFAULT_CONFIG.stageValueMultiplier[2];
  const sum3 = s3.values.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum3 - expected) <= 5, `stage 3 sum ${sum3} vs budget ${expected}`);
});

test('drops are deterministic for a given seed and every ball lands in a slot', () => {
  const board = buildBoard(DEFAULT_CONFIG);
  const run = () => {
    const rng = new Rng(99);
    const hand = ['white', 'gold', 'green', 'bouncy', 'white'].map((type, i) => ({ id: i, type }));
    const c = new DropController({ board, cfg: DEFAULT_CONFIG, rng, hand, mode: 'cluster', mods: { walls: [{ row: 3, gap: 1 }], blocked: [2] } });
    return c.runToCompletion().map((r) => r.slot);
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.ok(a.every((s) => s >= 0 && s < DEFAULT_CONFIG.slots));
  assert.ok(!a.includes(2), 'no ball may rest in a blocked slot');
});

test('determinism scenario checksum is stable', () => {
  assert.equal(determinismScenario().checksum, determinismScenario().checksum);
});

test('config overrides parse and merge', () => {
  const o = parseOverrides(['pegRows=5', 'ballPrices.gold=14', 'quotaMode=checked']);
  const cfg = mergeConfig(o);
  assert.equal(cfg.pegRows, 5);
  assert.equal(cfg.ballPrices.gold, 14);
  assert.equal(cfg.ballPrices.green, 8);
  assert.equal(cfg.quotaMode, 'checked');
});

test('game round flow, quota and save/restore', () => {
  const game = Game.newRun({ seed: 7 });
  assert.equal(game.phase, 'setup');
  assert.equal(game.view().hand.length, 5);
  game.setDropMode('cluster');
  const c = game.startDrop();
  c.runToCompletion();
  game.finishDrop();
  assert.equal(game.phase, 'payout');
  const payoutTotal = game.view().payout.total;
  // Save and restore in the payout phase, then re-drop through the restored game.
  const restored = Game.fromJSON(JSON.parse(JSON.stringify(game.toJSON())));
  assert.equal(restored.phase, 'payout');
  assert.equal(restored.view().payout.total, payoutTotal);
  assert.deepEqual(restored.view().results, game.view().results);
  restored.continueFromPayout();
  assert.equal(restored.phase, 'shop');
  assert.equal(restored.view().balance, payoutTotal);
  assert.equal(restored.view().roundsLeft, 2);
  assert.equal(restored.view().bagSize, 8);
  restored.nextRound();
  assert.equal(restored.view().round, 2);
});

test('checked quota mode does not deduct', () => {
  const paid = playRun('never-buy', 3, { quotaMode: 'paid' });
  const checked = playRun('never-buy', 3, { quotaMode: 'checked' });
  const paidStage1 = paid.history.find((h) => h.stage === 1 && h.round === 3);
  const checkedStage1 = checked.history.find((h) => h.stage === 1 && h.round === 3);
  if (paidStage1 && checkedStage1 && paidStage1.quotaPaid) {
    assert.equal(checkedStage1.quotaPaid, 0);
    assert.equal(checkedStage1.balance - paidStage1.balance, paidStage1.quotaPaid);
  }
});

test('bots complete runs', () => {
  for (const bot of ['never-buy', 'cheapest-ball', 'hand-size', 'balanced']) {
    const r = playRun(bot, 11);
    assert.ok(r.won || r.failedStage >= 1, `${bot} should finish`);
    assert.ok(r.history.length >= 3);
  }
});
