import { isMelee, isSidearm, type WeaponId } from '@game/shared';

export type HeldGrenade = 'egg' | 'smoke' | 'flash';
export type GrenadeStock = { eggs: number; smokes: number; flashes?: number };
export const GRENADE_NAMES: Record<HeldGrenade, string> = { egg: 'HE Egg', smoke: 'Smoke Grenade', flash: 'Flashbang' };

export function weaponHotkey(id: WeaponId): 1 | 2 | 3 {
  return isMelee(id) ? 3 : isSidearm(id) ? 2 : 1;
}

export function weaponIndexForKey(loadout: readonly WeaponId[], key: number): number {
  return loadout.findIndex((id) => weaponHotkey(id) === key);
}

export function grenadeCount(kind: HeldGrenade, stock: GrenadeStock): number {
  return kind === 'egg' ? stock.eggs : kind === 'smoke' ? stock.smokes : stock.flashes ?? 0;
}

export function nextGrenade(current: HeldGrenade | null, stock: GrenadeStock): HeldGrenade | null {
  const owned = (['egg', 'smoke', 'flash'] as const).filter((kind) => grenadeCount(kind, stock) > 0);
  return owned[(current === null ? 0 : owned.indexOf(current) + 1) % owned.length] ?? null;
}

/** One thing you can have in hand, in the order the scroll wheel goes through them. */
export type SlotItem = { kind: 'weapon'; index: number } | { kind: 'grenade'; grenade: HeldGrenade } | { kind: 'bomb' };

/**
 * Everything you can hold, in Counter-Strike's order: your guns by key (1 primary, 2 pistol,
 * 3 knife), then each grenade you carry, then the bomb if you're carrying it. What you don't have
 * isn't in the list, so the wheel skips it.
 */
export function slotItems(loadout: readonly WeaponId[], stock: GrenadeStock, bomb: boolean): SlotItem[] {
  const out: SlotItem[] = [];
  for (const key of [1, 2, 3] as const) loadout.forEach((id, index) => { if (weaponHotkey(id) === key) out.push({ kind: 'weapon', index }); });
  for (const grenade of ['egg', 'smoke', 'flash'] as const) if (grenadeCount(grenade, stock) > 0) out.push({ kind: 'grenade', grenade });
  if (bomb) out.push({ kind: 'bomb' });
  return out;
}

const sameItem = (a: SlotItem, b: SlotItem) =>
  a.kind === b.kind && (a.kind !== 'weapon' || a.index === (b as typeof a).index) && (a.kind !== 'grenade' || a.grenade === (b as typeof a).grenade);

/** The next (`dir` 1) or previous (-1) item after `current`, going round from the last to the first. */
export function stepSlot(items: readonly SlotItem[], current: SlotItem, dir: 1 | -1): SlotItem | null {
  if (items.length === 0) return null;
  const i = items.findIndex((item) => sameItem(item, current));
  const from = i >= 0 ? i : dir > 0 ? -1 : 0;
  return items[(from + dir + items.length) % items.length]!;
}
