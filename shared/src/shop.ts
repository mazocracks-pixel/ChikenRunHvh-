import { dayKey } from './daily';
import { ITEMS, ITEMS_BY_ID, type ItemDef } from './items';
import { mulberry32 } from './rng';

/** How rare an item is (its colour in the shop): from its price, or an upgrade's level. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY_COLORS: Record<Rarity, string> = { common: '#9aa3ad', rare: '#3d8bfd', epic: '#a259ff', legendary: '#f5a524' };

export function rarityOf(item: ItemDef): Rarity {
  if (item.slot === 'upgrade') {
    const level = Number(item.key.split(':')[1]);
    return level >= 5 ? 'legendary' : level >= 4 ? 'epic' : level >= 3 ? 'rare' : 'common';
  }
  if (item.price >= 1300) return 'legendary';
  if (item.price >= 700) return 'epic';
  if (item.price >= 300) return 'rare';
  return 'common';
}

/** Daily Deals: this many items, a share off each. */
export const DEAL_COUNT = 4;
const DISCOUNTS = [0.25, 0.3, 0.4, 0.5] as const;

export interface Deal {
  itemId: string;
  /** Share off the price (0.25 = 25% off). */
  discount: number;
  price: number;
}

/**
 * Today's deals (UTC day): the same few items for everyone, picked from the day, so the server
 * and the shop agree without storing anything. Cosmetics, guns and knives only (no upgrades).
 */
export function dailyDeals(now: number): Deal[] {
  const day = dayKey(now);
  let seed = 2166136261;
  for (let i = 0; i < day.length; i++) seed = Math.imul(seed ^ day.charCodeAt(i), 16777619);
  const rand = mulberry32(seed >>> 0);
  const pool = ITEMS.filter((i) => i.price > 0 && i.slot !== 'upgrade');
  const out: Deal[] = [];
  while (out.length < DEAL_COUNT && pool.length > 0) {
    const item = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
    const discount = DISCOUNTS[Math.floor(rand() * DISCOUNTS.length)]!;
    out.push({ itemId: item.id, discount, price: Math.max(1, Math.round(item.price * (1 - discount))) });
  }
  return out;
}

/** What an item costs right now (a deal's price today, otherwise the normal one). */
export function priceNow(itemId: string, now: number): number | null {
  const item = ITEMS_BY_ID.get(itemId);
  if (!item) return null;
  return dailyDeals(now).find((d) => d.itemId === itemId)?.price ?? item.price;
}
