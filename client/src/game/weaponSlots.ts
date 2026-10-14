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
