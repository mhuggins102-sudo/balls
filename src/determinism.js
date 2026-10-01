// A fixed drop scenario whose checksum must match between Node and the
// browser. `node sim/harness.js determinism` prints it; the game's menu has a
// "Determinism check" that computes the same value in the browser.

import { DEFAULT_CONFIG } from './config.js';
import { buildBoard } from './board.js';
import { Rng } from './rng.js';
import { DropController } from './drop.js';

export const DETERMINISM_SEED = 0xc0ffee;

export function determinismScenario(cfg = DEFAULT_CONFIG) {
  const board = buildBoard(cfg);
  const rng = new Rng(DETERMINISM_SEED);
  const trace = [];
  const record = (c) => {
    for (const b of c.world.balls) {
      trace.push(b.removed ? -1 : b.slot, Math.round(b.x * 1e6), Math.round(b.y * 1e6), c.world.stepCount, b.hits, b.nudges);
    }
  };
  const mk = (types) => types.map((type, i) => ({ id: i + 1, type }));

  let c = new DropController({ board, cfg, rng, hand: mk(['white', 'white', 'gold', 'green', 'bouncy']), mode: 'cluster', mods: {} });
  c.runToCompletion(); record(c);

  c = new DropController({ board, cfg, rng, hand: mk(['white', 'bouncy', 'white']), mode: 'single', mods: {} });
  c.runToCompletion(); record(c);

  c = new DropController({
    board, cfg, rng, hand: mk(['white', 'white', 'white', 'white']), mode: 'cluster',
    mods: { walls: [{ row: 2, gap: 1 }], blocked: [Math.floor(cfg.slots / 2)], doubled: [] },
  });
  c.runToCompletion(); record(c);

  c = new DropController({ board, cfg, rng, hand: mk(['white', 'gold']), mode: 'single', mods: {} });
  c.runToCompletion();
  c.redrop(0);
  c.runToCompletion(); record(c);

  return { checksum: hashTrace(trace), trace };
}

export function hashTrace(nums) {
  let h = 0x811c9dc5 | 0;
  for (const n of nums) {
    h = Math.imul(h ^ (n | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
