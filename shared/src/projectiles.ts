import type { CollisionWorld } from './collision';
import type { Vec3 } from './math';
import { makeRay, raycastWorld } from './raycast';
import { SIM_DT } from './constants';

/** `egg`: the Egg Launcher's (goes off on impact); `he`: a thrown HE egg (bounces, then a fuse). */
export type ProjectileKind = 'egg' | 'he' | 'smoke' | 'rocket' | 'bolt' | 'flash';

export interface ProjectileDef {
  speed: number;
  /** Extra upward speed added to the throw, so lobbing feels natural. */
  upBoost: number;
  gravity: number;
  radius: number;
  /** Max lifetime; non-impact projectiles (smoke) go off when it runs out. */
  fuseMs: number;
  explodeOnImpact: boolean;
  /** Velocity kept after bouncing (non-impact projectiles only). */
  bounce: number;
  /** Damage at the centre of the blast; falls off linearly to 0 at `splashRadius`. */
  damage: number;
  splashRadius: number;
  knockback: number;
  /** Damage multiplier when you catch yourself in your own blast. */
  selfDamageScale: number;
  /** Grenades: slowing (m/s²) while rolling along the floor. */
  rollFriction?: number;
  /** How much of the thrower's own speed it carries (Counter-Strike: 1.25). */
  carry?: number;
  /** Goes off once it comes to rest (Counter-Strike's smoke), `fuseMs` at the latest. */
  restFuse?: boolean;
  /** Goes off this long after it first lands (the HE egg), `fuseMs` at the latest. */
  landFuseMs?: number;
}

/**
 * Counter-Strike's grenade arc, at this game's scale (both about 40 units a metre): thrown at
 * 750 × 0.9 u/s, a little upward, under 0.4 gravity; 45% kept per bounce, then it rolls.
 */
const CS_GRENADE = { speed: 16.9, upBoost: 2.9, gravity: 8, bounce: 0.45, rollFriction: 5, carry: 1.25 } as const;

export const PROJECTILES: Record<ProjectileKind, ProjectileDef> = {
  /** The Egg Launcher's egg: bursts on whatever it hits. */
  egg: {
    speed: 19, upBoost: 3.5, gravity: 18, radius: 0.12, fuseMs: 4000, explodeOnImpact: true, bounce: 0,
    damage: 95, splashRadius: 4.2, knockback: 13, selfDamageScale: 0.5,
  },
  /** A thrown HE egg: Counter-Strike's arc, bounces and rolls, bursts 1.5 s after it lands. */
  he: {
    ...CS_GRENADE, radius: 0.12, fuseMs: 8000, landFuseMs: 1500, explodeOnImpact: false,
    damage: 95, splashRadius: 4.2, knockback: 13, selfDamageScale: 0.5,
  },
  /** Smoke: Counter-Strike's arc; pops once it has stopped rolling. */
  smoke: {
    ...CS_GRENADE, radius: 0.12, fuseMs: 5000, explodeOnImpact: false, restFuse: true,
    damage: 0, splashRadius: 5, knockback: 0, selfDamageScale: 0,
  },
  rocket: {
    speed: 30, upBoost: 0, gravity: 0, radius: 0.15, fuseMs: 5000, explodeOnImpact: true, bounce: 0,
    damage: 110, splashRadius: 4, knockback: 16, selfDamageScale: 0.4,
  },
  /** Flashbang: bounces about, then goes off with a blinding flash (no damage). */
  flash: {
    ...CS_GRENADE, radius: 0.1, fuseMs: 1500, explodeOnImpact: false,
    damage: 0, splashRadius: 0, knockback: 0, selfDamageScale: 0,
  },
  /** Crossbow bolt: fast, drops a little, and hits whatever it strikes directly (no blast). */
  bolt: {
    speed: 70, upBoost: 0, gravity: 7, radius: 0.04, fuseMs: 3000, explodeOnImpact: true, bounce: 0,
    damage: 0, splashRadius: 0, knockback: 0, selfDamageScale: 0,
  },
};

/** A smoke cloud hangs this long, then fades out. */
export const SMOKE_DURATION_MS = 15000;

/** How a flashbang blinds whoever can see it. */
export const FLASH = {
  /** Beyond this nobody is blinded. */
  range: 28,
  /** White-out looking straight at it, point blank (ms); it fades out over that time. */
  maxMs: 3000,
  /** Looking at it from the edge of its range. */
  lookingMs: 1000,
  /** Shorter than this and it doesn't count. */
  minMs: 300,
} as const;

/**
 * How long (ms) a flash at `at` blinds someone at `eye` looking along `view` (unit vector), if
 * nothing is in the way: 1–3 s looking at it (longer the closer), less from the side, barely
 * anything facing away.
 */
export function flashBlindMs(eye: Vec3, view: Vec3, at: Vec3): number {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > FLASH.range) return 0;
  const facing = dist < 0.5 ? 1 : (dx * view.x + dy * view.y + dz * view.z) / dist;
  // 1 looking at it, 0.5 at 90°, 0.15 straight behind.
  const angle = facing >= 0.5 ? 1 : facing >= 0 ? 0.5 + facing : 0.5 + facing * 0.35;
  const near = 1 - (dist / FLASH.range) ** 1.4;
  const ms = (FLASH.lookingMs + (FLASH.maxMs - FLASH.lookingMs) * near) * angle;
  return ms >= FLASH.minMs ? Math.round(ms) : 0;
}

export interface ProjectileBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Set once it has touched a floor. */
  landed?: boolean;
}

/** How hard a grenade is thrown: right click 0 (underhand), both 0.5, left click 1. */
export type ThrowPower = 0 | 0.5 | 1;
export const THROW_POWERS: readonly ThrowPower[] = [0, 0.5, 1];

/** A thrower's own motion: their run (walk velocity and pushes) and their jump. */
export function throwerVelocity(s: { vx: number; vy: number; vz: number; walkVx?: number; walkVz?: number }): Vec3 {
  return { x: (s.walkVx ?? 0) + s.vx, y: s.vy, z: (s.walkVz ?? 0) + s.vz };
}

/** Underhand throws leave from lower down (Counter-Strike: 12 units, 0.3 m). */
export function throwDrop(power: ThrowPower): number {
  return (1 - power) * 0.3;
}

/**
 * A projectile's launch velocity. Grenades (with `carry`) are thrown at Counter-Strike's 30%,
 * 65% or 100% for the three throws and carry 1.25× the thrower's run, and their jump if rising.
 * The server, your own prediction and the aiming line all use this.
 */
export function launchVelocity(def: ProjectileDef, dir: Vec3, power: ThrowPower = 1, mover: Vec3 = { x: 0, y: 0, z: 0 }, speedScale = 1): Vec3 {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const k = def.carry ? power * 0.7 + 0.3 : 1;
  const carry = def.carry ?? 0;
  const speed = def.speed * speedScale * k;
  return {
    x: (dir.x / len) * speed + mover.x * carry,
    y: (dir.y / len) * speed + def.upBoost * k + Math.max(0, mover.y) * carry,
    z: (dir.z / len) * speed + mover.z * carry,
  };
}

/**
 * Whether a projectile goes off now. `ageMs`: since it was thrown; `landedMs`: since it first
 * landed (null in the air). Impacts are reported by `stepProjectile` itself.
 */
export function fuseDone(def: ProjectileDef, body: ProjectileBody, ageMs: number, landedMs: number | null): boolean {
  if (ageMs >= def.fuseMs) return true;
  if (def.restFuse && ageMs > 300 && atRest(body)) return true;
  return def.landFuseMs !== undefined && landedMs !== null && landedMs >= def.landFuseMs;
}

/**
 * Moves a projectile one tick against the level (not players; the server checks those).
 * Returns true when an impact projectile hits something; bouncing ones reflect instead.
 */
export function stepProjectile(p: ProjectileBody, def: ProjectileDef, dt: number, world: CollisionWorld): boolean {
  p.vy -= def.gravity * dt;
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  if (speed < 1e-6) return false;
  const dist = speed * dt;
  const ray = makeRay(p, { x: p.vx / speed, y: p.vy / speed, z: p.vz / speed });
  const hit = raycastWorld(ray, world, dist + def.radius, world.seeThrough); // Player clips stop chickens only, like CS.
  if (!hit) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    return false;
  }

  const t = Math.max(0, hit.t - def.radius);
  p.x += ray.dx * t;
  p.y += ray.dy * t;
  p.z += ray.dz * t;
  if (def.explodeOnImpact) return true;

  // Reflect off the surface and lose energy; come to rest when slow.
  const dot = p.vx * hit.nx + p.vy * hit.ny + p.vz * hit.nz;
  p.vx = (p.vx - 2 * dot * hit.nx) * def.bounce;
  p.vy = (p.vy - 2 * dot * hit.ny) * def.bounce;
  p.vz = (p.vz - 2 * dot * hit.nz) * def.bounce;
  if (hit.ny > 0.7) p.landed = true;
  if (hit.ny > 0.7 && Math.abs(p.vy) < 1.5) {
    p.vy = 0;
    if (def.rollFriction) {
      // Rolling: slows at a steady rate, then lies still.
      const along = Math.hypot(p.vx, p.vz), slower = Math.max(0, along - def.rollFriction * dt);
      p.vx = along > 1e-6 ? (p.vx / along) * slower : 0;
      p.vz = along > 1e-6 ? (p.vz / along) * slower : 0;
    } else {
      p.vx *= 0.8;
      p.vz *= 0.8;
    }
  }
  return false;
}

/** True once a bouncing projectile lies still. */
export function atRest(p: ProjectileBody): boolean {
  return Math.hypot(p.vx, p.vy, p.vz) < 0.05;
}

/** 1 at the centre of a blast, falling linearly to 0 at the edge. */
export function blastFalloff(def: ProjectileDef, distance: number): number {
  return Math.max(0, 1 - distance / def.splashRadius);
}

/**
 * Where a throw goes: its flight (a point every other tick) and where it goes off, by the same
 * steps as the server. For the thrower's aiming line only.
 */
export function predictThrow(def: ProjectileDef, origin: Vec3, velocity: Vec3, world: CollisionWorld): { path: Vec3[]; end: Vec3 } {
  const b: ProjectileBody = { x: origin.x, y: origin.y, z: origin.z, vx: velocity.x, vy: velocity.y, vz: velocity.z };
  const path: Vec3[] = [{ x: b.x, y: b.y, z: b.z }];
  let landedAt: number | null = null;
  const tick = SIM_DT * 1000;
  for (let i = 1; i * tick <= def.fuseMs; i++) {
    const hit = stepProjectile(b, def, SIM_DT, world);
    if (b.landed && landedAt === null) landedAt = i * tick;
    if (i % 2 === 0 || hit) path.push({ x: b.x, y: b.y, z: b.z });
    if (hit || fuseDone(def, b, i * tick, landedAt === null ? null : i * tick - landedAt) || b.y < -5) break;
  }
  return { path, end: { x: b.x, y: b.y, z: b.z } };
}
