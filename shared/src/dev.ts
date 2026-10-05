import { clamp } from './math';
import { isWeaponId, type WeaponDef, type WeaponId } from './weapons';

/**
 * Developer testing modifiers for one player. The server only applies them for a player who
 * has unlocked developer access, and only in rooms that allow it; the client uses the same
 * values to predict its own movement and ammo, so both sides stay in step.
 */
export interface DevMods {
  /** Walking speed multiplier. */
  speed: number;
  /** Jump height (velocity) multiplier. */
  jump: number;
  /** Gravity multiplier (low gravity < 1). */
  gravity: number;
  /** Move freely in the look direction, Space to rise. */
  fly: boolean;
  /** Fly through walls. */
  noclip: boolean;
  /** Jetpack fuel never runs out. */
  infiniteFuel: boolean;
  /** Magazines never empty. */
  infiniteAmmo: boolean;
  /** Reloads finish instantly. */
  instantReload: boolean;
  /** Bullet spread multiplier (0 = perfectly accurate). */
  spread: number;
  /** Fire-rate multiplier. */
  fireRate: number;
  /** Damage multiplier for bullets and your own rockets/eggs. */
  damage: number;
  /** Rocket speed multiplier. */
  projectileSpeed: number;
  /** Magazine size multiplier. */
  magazine: number;
  /** Rocket launcher: no delay between shots and no reloading. */
  noRocketCooldown: boolean;
  /** Rocket blasts (anyone's) don't hurt you; they still push you (rocket jumps). */
  noRocketDamage: boolean;
}

/** The movement part of DevMods, used by the shared physics. */
export type MoveMods = Pick<DevMods, 'speed' | 'jump' | 'gravity' | 'fly' | 'noclip' | 'infiniteFuel'>;

export const DEFAULT_MODS: Readonly<DevMods> = {
  speed: 1,
  jump: 1,
  gravity: 1,
  fly: false,
  noclip: false,
  infiniteFuel: false,
  infiniteAmmo: false,
  instantReload: false,
  spread: 1,
  fireRate: 1,
  damage: 1,
  projectileSpeed: 1,
  magazine: 1,
  noRocketCooldown: false,
  noRocketDamage: false,
};

/** Allowed range of every numeric modifier (the server clamps to these). */
export const MOD_LIMITS = {
  speed: { min: 0.25, max: 5 },
  jump: { min: 0.25, max: 4 },
  gravity: { min: 0.1, max: 2 },
  spread: { min: 0, max: 3 },
  fireRate: { min: 0.25, max: 10 },
  damage: { min: 0, max: 20 },
  projectileSpeed: { min: 0.25, max: 4 },
  magazine: { min: 0.5, max: 10 },
} as const;

type NumericMod = keyof typeof MOD_LIMITS;
const NUMERIC = Object.keys(MOD_LIMITS) as NumericMod[];
const BOOLEAN = ['fly', 'noclip', 'infiniteFuel', 'infiniteAmmo', 'instantReload', 'noRocketCooldown', 'noRocketDamage'] as const;

/** Builds a complete, in-range DevMods from untrusted input, keeping `base` for anything missing. */
export function sanitizeMods(raw: unknown, base: Readonly<DevMods> = DEFAULT_MODS): DevMods {
  const out: DevMods = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of NUMERIC) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = clamp(v, MOD_LIMITS[key].min, MOD_LIMITS[key].max);
  }
  for (const key of BOOLEAN) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  }
  return out;
}

export function isDefaultMods(m: Readonly<DevMods>): boolean {
  return (Object.keys(DEFAULT_MODS) as (keyof DevMods)[]).every((k) => m[k] === DEFAULT_MODS[k]);
}

/**
 * Fastest the rocket launcher fires with noRocketCooldown: faster than anyone can click, but
 * holding the trigger (automatic fire) can't flood the server with hundreds of rockets a second.
 */
export const ROCKET_SPAM_INTERVAL_MS = 50;

function noCooldown(w: WeaponDef, mods: Readonly<DevMods> | null): boolean {
  return mods?.noRocketCooldown === true && w.projectile === 'rocket';
}

/** Milliseconds between shots under the given modifiers (client and server use the same rule). */
export function fireIntervalFor(w: WeaponDef, mods: Readonly<DevMods> | null): number {
  return noCooldown(w, mods) ? ROCKET_SPAM_INTERVAL_MS : w.fireInterval / (mods?.fireRate ?? 1);
}

/** Whether a shot takes a round from the magazine (no: melee, infinite ammo, or rockets without cooldown). */
export function shotUsesAmmo(w: WeaponDef, mods: Readonly<DevMods> | null): boolean {
  return !w.melee && !mods?.infiniteAmmo && !noCooldown(w, mods);
}

/** Magazine size for a weapon under the given modifiers. */
export function magazineSize(base: number, mods: Readonly<DevMods> | null): number {
  return mods ? Math.max(1, Math.round(base * mods.magazine)) : base;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Developer actions on players in the room. All are checked and carried out by the server. */
export type DevAction =
  | { kind: 'teleportToPlayer'; target: number }
  | { kind: 'bringPlayer'; target: number }
  | { kind: 'teleport'; x: number; y: number; z: number }
  | { kind: 'freeze'; target: number; frozen: boolean }
  | { kind: 'respawn'; target: number }
  /** Positive heals, negative hurts (can kill). */
  | { kind: 'health'; target: number; amount: number }
  | { kind: 'armor'; target: number; value: number }
  | { kind: 'giveWeapon'; target: number; weapon: WeaponId }
  | { kind: 'removeWeapon'; target: number; weapon: WeaponId }
  | { kind: 'refill'; target: number }
  /** A prank: a scary face and a scream on that player's screen (people only, not bots; public rooms too). */
  | { kind: 'jumpscare'; target: number; style: JumpscareStyle };

/** The jumpscares mega?dev can send. */
export const JUMPSCARE_STYLES = ['chicken', 'ghost', 'glitch'] as const;
export type JumpscareStyle = (typeof JUMPSCARE_STYLES)[number];
/** How long one lasts on screen, and how soon the same player can be scared again. */
export const JUMPSCARE = { ms: 1600, cooldownMs: 5000 } as const;

export interface DevResult {
  ok: boolean;
  error?: string;
}

/** What the server tells a client about its developer access. */
export interface DevStatus {
  hvh?: import('./hvh').HvhLoadout;
  /** Passkey access, or equal public-panel access while in an HvH room. */
  granted: boolean;
  /** Whether the current room permits the reported profile. */
  allowedHere: boolean;
  /** HvH offers bounded abilities; admin keeps private-room testing tools. */
  profile: 'hvh' | 'admin' | 'off';
  /** Deployment flag: the balanced HvH panel is open to everyone, without a passkey. */
  publicHvh: boolean;
  /** The modifiers currently applied to you. */
  mods: DevMods;
}

/** Loadouts can grow beyond the normal four slots in developer testing, up to this. */
export const DEV_MAX_LOADOUT = 8;

const ACTION_KINDS = ['teleportToPlayer', 'bringPlayer', 'teleport', 'freeze', 'respawn', 'health', 'armor', 'giveWeapon', 'removeWeapon', 'refill', 'jumpscare'] as const;

/** Validates the shape of an untrusted DevAction (the server still checks targets and permissions). */
export function parseDevAction(raw: unknown): DevAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (!ACTION_KINDS.includes(kind as (typeof ACTION_KINDS)[number])) return null;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const target = Number.isSafeInteger(r.target) ? (r.target as number) : null;
  switch (kind) {
    case 'teleport':
      return num(r.x) && num(r.y) && num(r.z) ? { kind, x: r.x as number, y: r.y as number, z: r.z as number } : null;
    case 'freeze':
      return target !== null && typeof r.frozen === 'boolean' ? { kind, target, frozen: r.frozen } : null;
    case 'health':
      return target !== null && num(r.amount) ? { kind, target, amount: clamp(r.amount as number, -1000, 1000) } : null;
    case 'armor':
      return target !== null && num(r.value) ? { kind, target, value: r.value as number } : null;
    case 'jumpscare':
      return target !== null && JUMPSCARE_STYLES.includes(r.style as JumpscareStyle) ? { kind, target, style: r.style as JumpscareStyle } : null;
    case 'giveWeapon':
    case 'removeWeapon':
      return target !== null && isWeaponId(r.weapon) ? { kind, target, weapon: r.weapon } : null;
    default:
      return target !== null ? { kind: kind as 'teleportToPlayer' | 'bringPlayer' | 'respawn' | 'refill', target } : null;
  }
}
