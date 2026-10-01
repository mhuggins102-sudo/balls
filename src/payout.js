// Turns landing results into money and perks. Pure: given the same inputs it
// returns the same output, so it can be re-run after a re-drop.

import { PERK_IDS } from './perks.js';

/**
 * @param results  [{ index, ball: {id, type}, slot }]
 * @param layout   { values, highlighted, perkSlot }
 * @param mods     { doubled: [slot, ...] }
 * @param perkCount  perks currently held
 * @param rewardRng  fresh per-round generator for perk-slot rewards
 */
export function computePayout({ results, layout, mods, perkCount, cfg, rewardRng }) {
  const entries = [];
  const perksGranted = [];
  let total = 0;
  let held = perkCount;
  const doubled = mods.doubled || [];

  for (const r of results) {
    const slot = r.slot;
    const type = r.ball.type;
    const entry = { index: r.index, ballId: r.ball.id, type, slot, payout: 0, perk: null, note: '' };
    if (slot < 0) {
      entry.note = 'lost';
    } else if (slot === layout.perkSlot) {
      if (held < cfg.perkInventoryCap) {
        entry.perk = rewardRng.pick(PERK_IDS);
        perksGranted.push(entry.perk);
        held++;
        entry.note = 'perk';
      } else {
        entry.payout = cfg.perkSlotFullCash;
        entry.note = 'perks full';
      }
    } else {
      let value = layout.values[slot];
      for (const d of doubled) if (d === slot) value *= 2;
      const highlighted = layout.highlighted.includes(slot);
      if (type === 'gold') {
        entry.payout = value * cfg.goldMultiplier;
        entry.note = `×${cfg.goldMultiplier}`;
      } else if (type === 'green') {
        entry.payout = value + (highlighted ? cfg.greenBonus : 0);
        if (highlighted) entry.note = `+${cfg.greenBonus} bonus`;
      } else {
        entry.payout = value;
      }
    }
    total += entry.payout;
    entries.push(entry);
  }
  return { entries, total, perksGranted };
}
