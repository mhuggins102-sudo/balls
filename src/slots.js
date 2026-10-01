// Seeded slot layout generation: money values, highlighted slots, perk slot.

export function generateLayout(rng, cfg, stage) {
  const k = cfg.slots;
  const half = (k - 1) / 2;
  const base = cfg.slotBaseValues; // edge → center
  const last = base.length - 1;

  // Map a slot's distance from center onto the base list (edge = index 0).
  const edgeIdx = (i) => {
    const t = half === 0 ? 1 : 1 - Math.abs(i - half) / half; // 0 at edge, 1 at center
    return Math.round(t * last);
  };
  const edgeProfile = [];
  for (let i = 0; i < k; i++) edgeProfile.push(base[edgeIdx(i)]);
  const baseSum = edgeProfile.reduce((a, b) => a + b, 0);

  const w = cfg.layoutProfileWeights;
  const profile = rng.weighted([['edges', w.edges], ['center', w.center], ['flat', w.flat]]);
  let shape;
  if (profile === 'edges') shape = edgeProfile;
  else if (profile === 'center') shape = edgeProfile.map((_, i) => base[last - edgeIdx(i)]);
  else shape = edgeProfile.map(() => baseSum / k);

  const mults = cfg.stageValueMultiplier;
  const mult = mults[Math.min(Math.max(stage - 1, 0), mults.length - 1)];
  const target = baseSum * mult;

  const noisy = shape.map((v) => v * (1 + rng.range(-cfg.slotNoise, cfg.slotNoise)));
  const noisySum = noisy.reduce((a, b) => a + b, 0);
  const values = noisy.map((v) => Math.max(1, Math.round((v * target) / noisySum)));

  const [hMin, hMax] = cfg.highlightedSlots;
  const nHighlighted = Math.min(k, hMin + rng.int(hMax - hMin + 1));
  const order = rng.shuffle(Array.from({ length: k }, (_, i) => i));
  const highlighted = order.slice(0, nHighlighted).sort((a, b) => a - b);
  const perkSlot = rng.chance(cfg.perkSlotChance) && nHighlighted < k ? order[nHighlighted] : -1;

  return { values, highlighted, perkSlot, profile, stage };
}

/** Sum of all slot values, the round's "value budget". */
export function layoutBudget(layout) { return layout.values.reduce((a, b) => a + b, 0); }
