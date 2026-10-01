// The four ball types of the first build. Physical differences live in the
// config (restitution); this file is identity and flavour.

export const BALL_TYPES = {
  white:  { id: 'white',  name: 'White',  color: '#f2f2f2', shop: false },
  gold:   { id: 'gold',   name: 'Gold',   color: '#f5c542', shop: true },
  green:  { id: 'green',  name: 'Green',  color: '#4ccf6a', shop: true },
  bouncy: { id: 'bouncy', name: 'Bouncy', color: '#ff6fa8', shop: true, bouncy: true },
};

export const BALL_TYPE_IDS = ['white', 'gold', 'green', 'bouncy'];
export const SHOP_BALL_TYPES = ['gold', 'green', 'bouncy'];

export function restitutionFor(type, cfg) {
  return BALL_TYPES[type] && BALL_TYPES[type].bouncy ? cfg.bouncyRestitution : cfg.standardRestitution;
}

export function describeBall(type, cfg) {
  switch (type) {
    case 'white': return 'Collects the slot value.';
    case 'gold': return `Collects ${cfg.goldMultiplier}× the slot value.`;
    case 'green': return `Collects the slot value, +${cfg.greenBonus} in a highlighted slot.`;
    case 'bouncy': return 'Collects the slot value. Bouncier, so it reaches outer slots more often.';
    default: return '';
  }
}
