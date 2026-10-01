// Simple bots that play full runs through the same Game class the UI uses.
// They share one in-round policy (drop mode, Double, Block, Re-drop) and
// differ only in what they buy.

import { Game } from '../src/game.js';

export const BOT_IDS = ['never-buy', 'cheapest-ball', 'hand-size', 'balanced'];

export const BOTS = {
  'never-buy': {
    name: 'Never buys',
    shop() {},
  },
  'cheapest-ball': {
    name: 'Buys the cheapest ball',
    shop(game) {
      for (let guard = 0; guard < 10; guard++) {
        const v = game.view();
        let best = -1, bestPrice = Infinity;
        v.shop.balls.forEach((type, i) => {
          if (!type) return;
          const p = game.cfg.ballPrices[type];
          if (p < bestPrice) { bestPrice = p; best = i; }
        });
        if (best < 0 || !safeToSpend(game, bestPrice)) break;
        game.buyBall(best);
      }
    },
  },
  'hand-size': {
    name: 'Saves for hand size',
    shop(game) {
      for (let guard = 0; guard < 5; guard++) {
        if (!game.canUpgradeHand()) break;
        const price = game.handUpgradePrice();
        if (!safeToSpend(game, price)) break;
        game.buyHandUpgrade();
      }
    },
  },
  // A "sensible" player: gold balls first, then hand size while the bag
  // allows it, then thins whites out of a big bag, then bouncy balls.
  balanced: {
    name: 'Balanced (gold, hand size, removes whites)',
    shop(game) {
      for (let guard = 0; guard < 8; guard++) {
        const v = game.view();
        const cfg = game.cfg;
        const options = [];
        v.shop.balls.forEach((type, i) => {
          if (!type) return;
          const priority = type === 'gold' ? 4 : type === 'bouncy' ? 1 : 0.5;
          options.push({ priority, price: cfg.ballPrices[type], act: () => game.buyBall(i) });
        });
        if (game.canUpgradeHand()) options.push({ priority: 3, price: game.handUpgradePrice(), act: () => game.buyHandUpgrade() });
        const white = [...v.pool, ...v.discard].find((b) => b.type === 'white');
        if (white && game.canRemoveBall() && v.bagSize >= v.handSize + 2) {
          options.push({ priority: 2, price: cfg.ballRemovalPrice, act: () => game.removeBall(white.id) });
        }
        const pick = options.filter((o) => safeToSpend(game, o.price)).sort((a, b) => b.priority - a.priority)[0];
        if (!pick) break;
        pick.act();
      }
    },
  },
};

/** Expected income per round, from this stage's rounds so far or the last round played. */
export function estimateIncome(game) {
  const v = game.view();
  const h = v.history;
  if (!h.length) return 0;
  const thisStage = h.filter((e) => e.stage === v.stage);
  const sample = thisStage.length ? thisStage : h.slice(-1);
  return sample.reduce((a, e) => a + e.income, 0) / sample.length;
}

/** Fraction of the estimated income the bots trust when deciding what they can spend. */
export const RESERVE_FACTOR = 0.85;

/** Keep enough in reserve to cover the next quota given expected income. */
export function safeToSpend(game, price) {
  const v = game.view();
  const reserve = Math.max(0, v.nextQuota - v.roundsLeft * estimateIncome(game) * RESERVE_FACTOR);
  return v.balance - price >= reserve;
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

/** The in-round policy shared by all bots. */
export function playRound(game, bot) {
  const cfg = game.cfg;
  let v = game.view();
  const layout = v.layout;
  const k = cfg.slots;
  const valueOf = (i) => (i === layout.perkSlot ? 0 : layout.values[i]);

  // Perks before the drop.
  for (let guard = 0; guard < cfg.perkInventoryCap + 1; guard++) {
    v = game.view();
    let used = false;
    for (let i = 0; i < v.perks.length; i++) {
      const perk = v.perks[i];
      if (perk === 'double') {
        let best = -1;
        for (let s = 0; s < k; s++) if (best < 0 || valueOf(s) > valueOf(best)) best = s;
        game.usePerk(i, { slot: best });
        used = true; break;
      }
      if (perk === 'block') {
        let worst = -1;
        for (let s = 0; s < k; s++) {
          if (s === layout.perkSlot || v.mods.blocked.includes(s)) continue;
          if (worst < 0 || valueOf(s) < valueOf(worst)) worst = s;
        }
        if (worst >= 0) { game.usePerk(i, { slot: worst }); used = true; break; }
      }
    }
    if (!used) break;
  }

  // Drop mode: cluster when the outer slots are richer than the center.
  const third = Math.max(1, Math.floor(k / 3));
  const outer = [], center = [];
  for (let s = 0; s < k; s++) {
    if (s < third || s >= k - third) outer.push(valueOf(s)); else center.push(valueOf(s));
  }
  game.setDropMode(mean(outer) > mean(center) ? 'cluster' : 'single');

  const c = game.startDrop();
  c.runToCompletion();
  game.finishDrop();

  // Re-drop the worst ball when it clearly underperformed.
  v = game.view();
  const rd = v.perks.indexOf('redrop');
  if (rd >= 0) {
    const entries = v.payout.entries.filter((e) => !e.perk);
    if (entries.length) {
      const worst = entries.reduce((a, e) => (e.payout < a.payout ? e : a));
      const avgSlot = mean(layout.values);
      if (worst.payout < avgSlot * 0.5) {
        const rc = game.usePerk(rd, { index: worst.index });
        rc.runToCompletion();
        game.finishRedrop();
      }
    }
  }

  game.continueFromPayout();
  if (game.phase === 'shop') {
    bot.shop(game);
    game.nextRound();
  }
}

export function playRun(botId, seed, config) {
  const bot = BOTS[botId];
  const game = Game.newRun({ seed, config });
  let guard = 0;
  while (!game.over && guard++ < 200) playRound(game, bot);
  const v = game.view();
  return {
    seed,
    won: v.outcome ? v.outcome.won : false,
    failedStage: v.outcome && !v.outcome.won ? v.outcome.failedStage : null,
    score: v.outcome ? v.outcome.score : 0,
    finalBalance: v.balance,
    handSize: v.handSize,
    bagSize: v.bagSize,
    history: v.history,
  };
}
