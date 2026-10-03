import { HOP } from './constants';
import { clamp, lerp, normalize, type Vec3 } from './math';
import type { ProjectileKind } from './projectiles';
import { mulberry32 } from './rng';

export type WeaponId = 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'smg' | 'minigun' | 'rocket' | 'golden' | 'knife' | 'pan' | 'katana';

/** Index order is part of the network protocol (snapshots send the index). Only append. */
export const WEAPON_IDS: readonly WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper', 'smg', 'minigun', 'rocket', 'golden', 'knife', 'pan', 'katana'];

export type WeaponSound = 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'smg' | 'minigun' | 'rocket' | 'knife' | 'pan' | 'katana';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Damage per bullet (per pellet for shotguns). Projectile weapons deal damage via their projectile. */
  damage: number;
  headshotMultiplier: number;
  /** Minimum time between shots, ms. */
  fireInterval: number;
  automatic: boolean;
  magazine: number;
  reloadTime: number;
  pellets: number;
  /** Cone half-angle in radians while standing still and aiming normally. */
  spread: number;
  moveSpread: number;
  airSpread: number;
  range: number;
  /** Damage starts dropping at this distance, down to `minDamageScale` at max range. */
  falloffStart: number;
  minDamageScale: number;
  /** Field-of-view divisor while aiming (right mouse). */
  zoom: number;
  scope: boolean;
  /** Camera kick per shot, radians. */
  recoil: number;
  projectile?: ProjectileKind;
  /**
   * Melee weapons: `range` is the reach, and a swing also hits a chest within `arc` (cone
   * half-angle, radians) of the crosshair. No ammo; see meleeHit.
   */
  melee?: { arc: number };
  /** Shop price in coins; 0 = everyone owns it. */
  price: number;
  sound: WeaponSound;
  /** Visual style hints for the procedural gun model. */
  model: { length: number; color: number; accent: number; barrels?: number };
}

const DEFS: WeaponDef[] = [
  {
    id: 'pistol', name: 'Pistol', damage: 24, headshotMultiplier: 2, fireInterval: 220, automatic: false,
    magazine: 12, reloadTime: 1100, pellets: 1, spread: 0.012, moveSpread: 0.02, airSpread: 0.05,
    range: 80, falloffStart: 25, minDamageScale: 0.6, zoom: 1.25, scope: false, recoil: 0.025,
    price: 0, sound: 'pistol', model: { length: 0.32, color: 0x2d2f33, accent: 0x55585e },
  },
  {
    id: 'rifle', name: 'Rifle', damage: 17, headshotMultiplier: 2, fireInterval: 105, automatic: true,
    magazine: 30, reloadTime: 1800, pellets: 1, spread: 0.016, moveSpread: 0.03, airSpread: 0.08,
    range: 120, falloffStart: 40, minDamageScale: 0.7, zoom: 1.4, scope: false, recoil: 0.012,
    price: 0, sound: 'rifle', model: { length: 0.7, color: 0x3b3f2e, accent: 0x1e1f1a },
  },
  {
    id: 'shotgun', name: 'Shotgun', damage: 11, headshotMultiplier: 1.5, fireInterval: 750, automatic: false,
    magazine: 6, reloadTime: 2200, pellets: 8, spread: 0.07, moveSpread: 0.02, airSpread: 0.04,
    range: 40, falloffStart: 8, minDamageScale: 0.3, zoom: 1.2, scope: false, recoil: 0.06,
    price: 0, sound: 'shotgun', model: { length: 0.62, color: 0x5a3a22, accent: 0x2b2b2b, barrels: 2 },
  },
  {
    id: 'sniper', name: 'Sniper', damage: 80, headshotMultiplier: 2.5, fireInterval: 1300, automatic: false,
    magazine: 5, reloadTime: 2600, pellets: 1, spread: 0.004, moveSpread: 0.08, airSpread: 0.15,
    range: 250, falloffStart: 250, minDamageScale: 1, zoom: 4, scope: true, recoil: 0.08,
    price: 0, sound: 'sniper', model: { length: 0.95, color: 0x2f3b2f, accent: 0x111111 },
  },
  {
    id: 'smg', name: 'SMG', damage: 13, headshotMultiplier: 1.8, fireInterval: 72, automatic: true,
    magazine: 35, reloadTime: 1600, pellets: 1, spread: 0.028, moveSpread: 0.02, airSpread: 0.05,
    range: 70, falloffStart: 18, minDamageScale: 0.55, zoom: 1.3, scope: false, recoil: 0.009,
    price: 400, sound: 'smg', model: { length: 0.48, color: 0x26282c, accent: 0x6b6e73 },
  },
  {
    id: 'minigun', name: 'Minigun', damage: 10, headshotMultiplier: 1.5, fireInterval: 50, automatic: true,
    magazine: 120, reloadTime: 4000, pellets: 1, spread: 0.045, moveSpread: 0.02, airSpread: 0.04,
    range: 80, falloffStart: 25, minDamageScale: 0.6, zoom: 1.15, scope: false, recoil: 0.006,
    price: 1200, sound: 'minigun', model: { length: 0.8, color: 0x44474d, accent: 0x9a9da3, barrels: 6 },
  },
  {
    id: 'rocket', name: 'Rocket Launcher', damage: 0, headshotMultiplier: 1, fireInterval: 1100, automatic: false,
    magazine: 2, reloadTime: 2800, pellets: 1, spread: 0.004, moveSpread: 0.01, airSpread: 0.02,
    range: 200, falloffStart: 200, minDamageScale: 1, zoom: 1.3, scope: false, recoil: 0.07,
    projectile: 'rocket', price: 1500, sound: 'rocket', model: { length: 0.9, color: 0x4f6b3a, accent: 0xb33a2e },
  },
  {
    id: 'golden', name: 'Golden Rifle', damage: 19, headshotMultiplier: 2, fireInterval: 100, automatic: true,
    magazine: 32, reloadTime: 1700, pellets: 1, spread: 0.014, moveSpread: 0.028, airSpread: 0.075,
    range: 130, falloffStart: 45, minDamageScale: 0.7, zoom: 1.45, scope: false, recoil: 0.011,
    price: 2500, sound: 'rifle', model: { length: 0.72, color: 0xe0b23a, accent: 0xa8801e },
  },
  // Melee: hold to keep swinging, no ammo. With one out, bunny hops build more speed (HOP.meleeMax).
  {
    id: 'knife', name: 'Knife', damage: 35, headshotMultiplier: 1.5, fireInterval: 420, automatic: true,
    magazine: 1, reloadTime: 0, pellets: 1, spread: 0, moveSpread: 0, airSpread: 0,
    range: 2.3, falloffStart: 2.3, minDamageScale: 1, zoom: 1, scope: false, recoil: 0.01,
    melee: { arc: 0.6 }, price: 0, sound: 'knife', model: { length: 0.3, color: 0x2a2c31, accent: 0xd5dae2 },
  },
  {
    id: 'pan', name: 'Frying Pan', damage: 55, headshotMultiplier: 1.6, fireInterval: 800, automatic: true,
    magazine: 1, reloadTime: 0, pellets: 1, spread: 0, moveSpread: 0, airSpread: 0,
    range: 2.2, falloffStart: 2.2, minDamageScale: 1, zoom: 1, scope: false, recoil: 0.02,
    melee: { arc: 0.65 }, price: 600, sound: 'pan', model: { length: 0.5, color: 0x2b2b2f, accent: 0x7a5434 },
  },
  {
    id: 'katana', name: 'Katana', damage: 46, headshotMultiplier: 1.6, fireInterval: 560, automatic: true,
    magazine: 1, reloadTime: 0, pellets: 1, spread: 0, moveSpread: 0, airSpread: 0,
    range: 2.9, falloffStart: 2.9, minDamageScale: 1, zoom: 1, scope: false, recoil: 0.015,
    melee: { arc: 0.5 }, price: 1800, sound: 'katana', model: { length: 0.95, color: 0x1d1a2a, accent: 0xc9a33a },
  },
];

export const WEAPONS = Object.fromEntries(DEFS.map((w) => [w.id, w])) as Record<WeaponId, WeaponDef>;

export const DEFAULT_LOADOUT: readonly WeaponId[] = ['rifle', 'shotgun', 'sniper', 'pistol'];
/** Guns in a loadout (keys 1-4). A melee weapon always comes after them. */
export const LOADOUT_SIZE = 4;
/** Everyone's melee weapon unless they pick another one in the shop. */
export const DEFAULT_MELEE: WeaponId = 'knife';
/** Time after switching weapons before the new one can fire, ms. */
export const WEAPON_SWITCH_MS = 250;

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && value in WEAPONS;
}

export function isMelee(id: WeaponId): boolean {
  return WEAPONS[id].melee !== undefined;
}

/** How much speed bunny hops can build while holding this weapon (melee: more). */
export function hopMaxFor(id: WeaponId): number {
  return isMelee(id) ? HOP.meleeMax : HOP.max;
}

export function weaponIndex(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}

export function weaponAt(index: number): WeaponId {
  return WEAPON_IDS[index] ?? 'pistol';
}

/** Current cone half-angle for a shot, depending on how the shooter is moving. */
export function spreadFor(w: WeaponDef, moving: boolean, airborne: boolean, aiming: boolean): number {
  let s = w.spread + (moving ? w.moveSpread : 0) + (airborne ? w.airSpread : 0);
  if (aiming) s *= w.scope ? 0.25 : 0.6;
  return s;
}

/** Seed for a shot's pellet pattern, so client tracers and server hits use the same directions. */
export function shotSeed(pid: number, shotSeq: number): number {
  return (Math.imul(pid, 73856093) ^ Math.imul(shotSeq, 19349663)) >>> 0;
}

/** Bullet directions for one trigger pull: `pellets` random directions within the spread cone. */
export function pelletDirections(w: WeaponDef, aim: Vec3, spread: number, seed: number): Vec3[] {
  const dir = normalize(aim);
  const rand = mulberry32(seed);
  // Two unit vectors perpendicular to the aim direction.
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize({ x: dir.y * up.z - dir.z * up.y, y: dir.z * up.x - dir.x * up.z, z: dir.x * up.y - dir.y * up.x });
  const v = { x: u.y * dir.z - u.z * dir.y, y: u.z * dir.x - u.x * dir.z, z: u.x * dir.y - u.y * dir.x };
  const out: Vec3[] = [];
  for (let i = 0; i < w.pellets; i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.tan(spread) * Math.sqrt(rand());
    const a = Math.cos(angle) * r;
    const b = Math.sin(angle) * r;
    out.push(normalize({ x: dir.x + u.x * a + v.x * b, y: dir.y + u.y * a + v.y * b, z: dir.z + u.z * a + v.z * b }));
  }
  return out;
}

/** Damage of one bullet at a distance, before headshot/armor modifiers. */
export function damageAt(w: WeaponDef, distance: number): number {
  if (distance <= w.falloffStart) return w.damage;
  const t = clamp((distance - w.falloffStart) / Math.max(1, w.range - w.falloffStart), 0, 1);
  return w.damage * lerp(1, w.minDamageScale, t);
}
