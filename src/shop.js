// Shop offers and prices.

import { SHOP_BALL_TYPES } from './balls.js';
import { PERK_IDS } from './perks.js';

export function generateOffers(rng, cfg) {
  const balls = [];
  for (let i = 0; i < cfg.shopBallOffers; i++) balls.push(rng.pick(SHOP_BALL_TYPES));
  const perk = rng.pick(PERK_IDS);
  return { balls, perk };
}

export function handUpgradePrice(cfg, upgradesBought) {
  return cfg.handUpgradeBasePrice + cfg.handUpgradePriceStep * upgradesBought;
}

export function ballPrice(cfg, type) {
  return cfg.ballPrices[type];
}
