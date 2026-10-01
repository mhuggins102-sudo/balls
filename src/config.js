// Every tunable number in the game lives here. Game logic must read from the
// config object it is handed and never hard-code a value.
//
// All values are placeholders to be tuned with the simulation harness
// (`node sim/harness.js all`).

export const DEFAULT_CONFIG = {
  // ---- Board geometry (world units; 1 unit = the horizontal peg spacing) ----
  pegRows: 6,              // triangular peg field: row i has i+1 pegs
  slots: 7,                // bins along the flat bottom (pegRows + 1 aligns dividers under pegs)
  pegSpacing: 1,
  rowSpacing: 1.0,         // vertical distance between peg rows (0.866 would be equilateral)
  pegRadius: 0.14,
  wallPegs: true,          // bumps on the side walls at each row, so walls do not funnel balls into the outer slots
  ballRadius: 0.22,
  dropDepth: 1.0,          // release point, measured down from the triangle apex
  slotDepth: 2.2,          // height of the slot bins below the divider tops
  dividerCapRadius: 0.1,   // rounded top on each slot divider
  blockCapHeight: 0.45,    // peak height of the roof placed by the Block perk

  // ---- Physics ----
  gravity: 120,            // units / s^2
  timestep: 1 / 240,       // fixed step, seconds
  solverIterations: 2,
  standardRestitution: 0.3,
  bouncyRestitution: 0.7,
  floorRestitution: 0.2,
  dividerRestitution: 0.3,
  friction: 0.1,           // fraction of tangential speed lost on a real impact
  frictionMinImpact: 1.5,  // normal speed below which a contact is "resting" and has no friction
  airDrag: 0.05,           // linear damping per second
  releaseJitterX: 0.15,    // seeded horizontal offset at release
  releaseJitterVx: 0.6,    // seeded horizontal speed at release
  clusterReleaseInterval: 0.09,  // seconds between releases in cluster mode
  clusterReleaseJitter: 0.4,     // +/- fraction applied to the interval
  singleReleaseDelay: 0.2,       // pause after a ball lands before the next release
  settleSpeed: 0.6,        // below this speed, inside a slot, a ball counts as resting
  settleTime: 0.12,        // seconds at rest before a ball is settled
  stuckProgress: 0.05,     // failsafe: a ball above the slots that has not moved this much further down...
  stuckTimeout: 1.0,       // ...within this many seconds gets a sideways nudge
  stuckNudge: 2.5,
  singleStallTimeout: 6,   // single mode releases the next ball anyway if the previous one has not landed by then
  maxDropTime: 25,         // hard cap on a drop, seconds of simulated time
  perkWallThickness: 0.18, // radius of the Wall perk segment; above pegRadius so its shelf sits over the peg tops

  // ---- Balls and bag ----
  startingBag: { white: 6, gold: 1, green: 1 },
  handSize: 5,
  goldMultiplier: 3,
  greenBonus: 10,
  ballPrices: { gold: 12, green: 8, bouncy: 10 },

  // ---- Slot layout generation ----
  slotBaseValues: [8, 4, 2, 1],            // stage 1 values, edge to center
  stageValueMultiplier: [1, 1.35, 1.75, 2.2, 2.8],
  slotNoise: 0.35,                         // +/- fraction of noise per slot
  layoutProfileWeights: { edges: 0.45, center: 0.35, flat: 0.2 },
  highlightedSlots: [1, 2],                // min, max per round
  perkSlotChance: 0.5,
  perkSlotFullCash: 5,                     // paid when the perk inventory is full

  // ---- Perks ----
  perkInventoryCap: 3,
  perkPrice: 10,

  // ---- Run structure ----
  stages: 5,
  roundsPerStage: 3,
  quotas: [35, 100, 230, 360, 520],
  quotaMode: 'paid',       // 'paid': quota is deducted, surplus carries. 'checked': balance only has to cover it.
  startingBalance: 0,

  // ---- Shop ----
  shopBallOffers: 3,
  ballRemovalPrice: 6,
  handUpgradeBasePrice: 20,
  handUpgradePriceStep: 15,
  rerollPrice: 2,
};

const NESTED = ['startingBag', 'ballPrices', 'layoutProfileWeights'];

export function mergeConfig(overrides) {
  const cfg = { ...DEFAULT_CONFIG };
  if (!overrides) return cfg;
  for (const [k, v] of Object.entries(overrides)) {
    if (NESTED.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      cfg[k] = { ...DEFAULT_CONFIG[k], ...v };
    } else {
      cfg[k] = v;
    }
  }
  return cfg;
}

// Parses "key=value" strings (harness CLI). Values are JSON when possible,
// dotted keys reach into nested objects ("ballPrices.gold=14").
export function parseOverrides(pairs) {
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`Bad override "${pair}", expected key=value`);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    const parts = key.split('.');
    if (parts.length === 1) {
      out[key] = value;
    } else {
      out[parts[0]] = { ...(out[parts[0]] || {}), [parts[1]]: value };
    }
  }
  return out;
}
