// The run: stages, rounds, bag, perks, shop, quotas. Pure game logic with a
// serialisable state object. The browser UI and the headless harness drive
// the same class.
//
// Phases: setup → dropping → payout → shop → setup … → won | lost

import { mergeConfig } from './config.js';
import { Rng, deriveSeed, randomSeed } from './rng.js';
import { buildBoard } from './board.js';
import { Bag } from './bag.js';
import { generateLayout } from './slots.js';
import { DropController } from './drop.js';
import { computePayout } from './payout.js';
import { PERKS } from './perks.js';
import { BALL_TYPES } from './balls.js';
import { generateOffers, handUpgradePrice, ballPrice } from './shop.js';

export const SAVE_VERSION = 1;

export class Game {
  constructor(cfg, state, configOverrides) {
    this.cfg = cfg;
    this.configOverrides = configOverrides || null;
    this.board = buildBoard(cfg);
    this.s = state;
    this.controller = null;
    this.shopRng = state.shopRng ? Rng.fromState(state.shopRng) : null;
    this.listeners = new Set();
  }

  // ---------------------------------------------------------------- lifecycle

  static newRun({ seed, config } = {}) {
    const cfg = mergeConfig(config);
    const runSeed = (seed === undefined || seed === null) ? randomSeed() : (seed >>> 0);
    const state = {
      version: SAVE_VERSION,
      seed: runSeed,
      roundIndex: 0,
      stage: 1,
      round: 1,
      balance: cfg.startingBalance,
      handSize: cfg.handSize,
      handUpgrades: 0,
      perks: [],
      bag: Bag.starting(cfg).toJSON(),
      phase: 'setup',
      layout: null,
      hand: [],
      mods: { walls: [], blocked: [], doubled: [] },
      dropMode: 'single',
      dropRng: null,
      redrops: [],
      redropActive: null,
      results: null,
      payout: null,
      shop: null,
      shopRng: null,
      history: [],
      outcome: null,
    };
    const game = new Game(cfg, state, config || null);
    game.beginRound();
    return game;
  }

  toJSON() {
    return {
      ...this.s,
      shopRng: this.shopRng ? this.shopRng.getState() : null,
      configOverrides: this.configOverrides,
    };
  }

  static fromJSON(json, config) {
    if (!json || json.version !== SAVE_VERSION) return null;
    const overrides = config !== undefined ? config : json.configOverrides;
    const cfg = mergeConfig(overrides);
    const { configOverrides, ...state } = json;
    state.mods = state.mods || { walls: [], blocked: [], doubled: [] };
    const game = new Game(cfg, state, overrides || null);
    // A save taken mid-drop is replayed deterministically to the payout phase.
    if (state.phase === 'dropping') {
      game.controller = game.rebuildController();
      game.finishDrop();
    } else if (state.phase === 'payout') {
      game.controller = game.rebuildController();
      if (state.redropActive !== null && state.redropActive !== undefined) game.finishRedrop();
    }
    return game;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  // ---------------------------------------------------------------- helpers

  get phase() { return this.s.phase; }
  get over() { return this.s.phase === 'won' || this.s.phase === 'lost'; }

  roundRng(name) { return new Rng(deriveSeed(this.s.seed, this.s.roundIndex, name)); }

  bag() { return Bag.fromJSON(this.s.bag); }
  saveBag(bag) { this.s.bag = bag.toJSON(); }

  nextQuota() {
    const q = this.cfg.quotas;
    return q[Math.min(this.s.stage - 1, q.length - 1)];
  }

  /** Rounds still to be played before the next quota is due, including the current one. */
  roundsLeftInStage() { return this.cfg.roundsPerStage - this.s.round + 1; }

  handUpgradePrice() { return handUpgradePrice(this.cfg, this.s.handUpgrades); }

  view() {
    const s = this.s;
    const bag = this.bag();
    return {
      phase: s.phase,
      seed: s.seed,
      stage: s.stage,
      round: s.round,
      roundIndex: s.roundIndex,
      stages: this.cfg.stages,
      roundsPerStage: this.cfg.roundsPerStage,
      roundsLeft: this.roundsLeftInStage(),
      balance: s.balance,
      nextQuota: this.nextQuota(),
      handSize: s.handSize,
      perks: s.perks.slice(),
      perkCap: this.cfg.perkInventoryCap,
      layout: s.layout,
      hand: s.hand.slice(),
      mods: s.mods,
      dropMode: s.dropMode,
      results: s.results,
      payout: s.payout,
      redropActive: s.redropActive,
      shop: s.shop,
      bagSize: bag.size,
      bagTotal: bag.size + s.hand.length,
      bagCounts: bag.counts(),
      pool: bag.pool.slice(),
      discard: bag.discard.slice(),
      history: s.history.slice(),
      outcome: s.outcome,
      handUpgradePrice: this.handUpgradePrice(),
    };
  }

  // ---------------------------------------------------------------- round flow

  beginRound() {
    const s = this.s;
    s.layout = generateLayout(this.roundRng('layout'), this.cfg, s.stage);
    const bag = this.bag();
    s.hand = bag.draw(this.roundRng('draw'), s.handSize);
    this.saveBag(bag);
    s.mods = { walls: [], blocked: [], doubled: [] };
    s.results = null;
    s.payout = null;
    s.shop = null;
    s.redrops = [];
    s.redropActive = null;
    s.dropRng = this.roundRng('physics').getState();
    this.shopRng = this.roundRng('shop');
    this.controller = null;
    s.phase = 'setup';
    this.emit();
  }

  setDropMode(mode) {
    if (this.s.phase !== 'setup') throw new Error('Drop mode can only change during setup');
    this.s.dropMode = mode === 'cluster' ? 'cluster' : 'single';
    this.emit();
  }

  /**
   * Use a perk from inventory. target: wall → {row, gap}; block/double →
   * {slot}; redrop → {index} (hand index of the ball to drop again).
   */
  usePerk(invIndex, target) {
    const s = this.s;
    const perkId = s.perks[invIndex];
    const perk = PERKS[perkId];
    if (!perk) throw new Error('No such perk in inventory');
    if (perk.phase === 'before') {
      if (s.phase !== 'setup') throw new Error(`${perk.name} must be used before the drop`);
      if (perkId === 'wall') {
        const g = this.board.findGap(target.row, target.gap);
        if (!g) throw new Error('Not a valid gap');
        if (s.mods.walls.some((w) => w.row === g.row && w.gap === g.gap)) throw new Error('That gap already has a wall');
        s.mods.walls.push({ row: g.row, gap: g.gap });
      } else if (perkId === 'block') {
        this.assertSlot(target.slot);
        if (s.mods.blocked.includes(target.slot)) throw new Error('That slot is already blocked');
        s.mods.blocked.push(target.slot);
      } else if (perkId === 'double') {
        this.assertSlot(target.slot);
        s.mods.doubled.push(target.slot);
      }
      s.perks.splice(invIndex, 1);
      this.emit();
      return null;
    }
    // Re-drop
    if (s.phase !== 'payout') throw new Error('Re-drop is used after the drop');
    if (s.redropActive !== null && s.redropActive !== undefined) throw new Error('A re-drop is already in progress');
    if (!this.controller) this.controller = this.rebuildController();
    const index = target.index;
    if (!(index >= 0 && index < s.hand.length)) throw new Error('Not a ball in this hand');
    s.perks.splice(invIndex, 1);
    s.redrops.push(index);
    s.redropActive = index;
    this.controller.redrop(index);
    this.emit();
    return this.controller;
  }

  assertSlot(slot) {
    if (!(Number.isInteger(slot) && slot >= 0 && slot < this.cfg.slots)) throw new Error('Not a valid slot');
  }

  /** Starts the drop. Returns the controller to step (or run to completion). */
  startDrop() {
    const s = this.s;
    if (s.phase !== 'setup') throw new Error('Not in setup');
    s.phase = 'dropping';
    const rng = Rng.fromState(s.dropRng);
    this.controller = new DropController({
      board: this.board, cfg: this.cfg, rng, hand: s.hand, mode: s.dropMode, mods: s.mods,
    });
    this.emit();
    return this.controller;
  }

  /** Rebuilds the drop (and any re-drops) from the saved seed state. */
  rebuildController() {
    const s = this.s;
    const rng = Rng.fromState(s.dropRng);
    const c = new DropController({
      board: this.board, cfg: this.cfg, rng, hand: s.hand, mode: s.dropMode, mods: s.mods,
    });
    c.runToCompletion();
    const redrops = s.redrops || [];
    for (let i = 0; i < redrops.length; i++) {
      c.redrop(redrops[i]);
      // The last re-drop may still be "active" in the saved state; run it too.
      c.runToCompletion();
    }
    return c;
  }

  finishDrop() {
    const s = this.s;
    if (s.phase !== 'dropping') throw new Error('Not dropping');
    const c = this.controller;
    if (!c.finished) c.runToCompletion();
    this.recordResults();
    s.phase = 'payout';
    this.emit();
  }

  finishRedrop() {
    const s = this.s;
    if (s.phase !== 'payout') throw new Error('Not in payout');
    const c = this.controller;
    if (!c.finished) c.runToCompletion();
    s.redropActive = null;
    this.recordResults();
    this.emit();
  }

  recordResults() {
    const s = this.s;
    const results = this.controller.results();
    s.results = results.map((r) => ({ index: r.index, ballId: r.ball.id, type: r.ball.type, slot: r.slot }));
    s.payout = computePayout({
      results,
      layout: s.layout,
      mods: s.mods,
      perkCount: s.perks.length,
      cfg: this.cfg,
      rewardRng: this.roundRng('reward'),
    });
  }

  /** Banks the payout, runs the quota check, opens the shop (or ends the run). */
  continueFromPayout() {
    const s = this.s;
    const cfg = this.cfg;
    if (s.phase !== 'payout') throw new Error('Not in payout');
    if (s.redropActive !== null && s.redropActive !== undefined) throw new Error('Re-drop still in progress');

    s.balance += s.payout.total;
    for (const p of s.payout.perksGranted) {
      if (s.perks.length < cfg.perkInventoryCap) s.perks.push(p);
    }
    const bag = this.bag();
    bag.discardAll(s.hand);
    this.saveBag(bag);

    const entry = {
      roundIndex: s.roundIndex, stage: s.stage, round: s.round,
      income: s.payout.total, balance: s.balance, quotaPaid: 0,
    };

    const lastRoundOfStage = s.round >= cfg.roundsPerStage;
    if (lastRoundOfStage) {
      const quota = this.nextQuota();
      if (s.balance >= quota) {
        if (cfg.quotaMode === 'paid') { s.balance -= quota; entry.quotaPaid = quota; }
        entry.balance = s.balance;
        if (s.stage >= cfg.stages) {
          s.history.push(entry);
          s.phase = 'won';
          s.outcome = { won: true, score: s.balance, stage: s.stage };
          this.controller = null;
          this.emit();
          return;
        }
        s.stage += 1;
        s.round = 1;
      } else {
        s.history.push(entry);
        s.phase = 'lost';
        s.outcome = { won: false, failedStage: s.stage, quota, balance: s.balance, score: 0 };
        this.controller = null;
        this.emit();
        return;
      }
    } else {
      s.round += 1;
    }
    s.history.push(entry);

    const offers = generateOffers(this.shopRng, cfg);
    s.shop = { balls: offers.balls, perk: offers.perk, rerolls: 0, removals: 0 };
    s.phase = 'shop';
    this.controller = null;
    this.emit();
  }

  // ---------------------------------------------------------------- shop

  assertShop() { if (this.s.phase !== 'shop') throw new Error('Shop is closed'); }

  canAfford(price) { return this.s.balance >= price; }

  buyBall(offerIndex) {
    this.assertShop();
    const s = this.s;
    const type = s.shop.balls[offerIndex];
    if (!type) throw new Error('That offer is gone');
    const price = ballPrice(this.cfg, type);
    if (!this.canAfford(price)) throw new Error('Not enough money');
    s.balance -= price;
    const bag = this.bag();
    bag.add(type);
    this.saveBag(bag);
    s.shop.balls[offerIndex] = null;
    this.emit();
  }

  buyPerk() {
    this.assertShop();
    const s = this.s;
    if (!s.shop.perk) throw new Error('That offer is gone');
    if (s.perks.length >= this.cfg.perkInventoryCap) throw new Error('Perk inventory is full');
    if (!this.canAfford(this.cfg.perkPrice)) throw new Error('Not enough money');
    s.balance -= this.cfg.perkPrice;
    s.perks.push(s.shop.perk);
    s.shop.perk = null;
    this.emit();
  }

  canRemoveBall() { return this.bag().size > this.s.handSize; }

  removeBall(ballId) {
    this.assertShop();
    const s = this.s;
    const bag = this.bag();
    if (bag.size <= s.handSize) throw new Error('The bag cannot shrink below the hand size');
    if (!this.canAfford(this.cfg.ballRemovalPrice)) throw new Error('Not enough money');
    const removed = bag.remove(ballId);
    if (!removed) throw new Error('That ball is not in the bag');
    s.balance -= this.cfg.ballRemovalPrice;
    this.saveBag(bag);
    s.shop.removals += 1;
    this.emit();
    return removed;
  }

  canUpgradeHand() { return this.bag().size > this.s.handSize; }

  buyHandUpgrade() {
    this.assertShop();
    const s = this.s;
    if (!this.canUpgradeHand()) throw new Error('The hand cannot be larger than the bag');
    const price = this.handUpgradePrice();
    if (!this.canAfford(price)) throw new Error('Not enough money');
    s.balance -= price;
    s.handSize += 1;
    s.handUpgrades += 1;
    this.emit();
  }

  reroll() {
    this.assertShop();
    const s = this.s;
    if (!this.canAfford(this.cfg.rerollPrice)) throw new Error('Not enough money');
    s.balance -= this.cfg.rerollPrice;
    const offers = generateOffers(this.shopRng, this.cfg);
    s.shop.balls = offers.balls;
    s.shop.perk = offers.perk;
    s.shop.rerolls += 1;
    this.emit();
  }

  nextRound() {
    this.assertShop();
    this.s.roundIndex += 1;
    this.beginRound();
  }
}

export { BALL_TYPES, PERKS };
