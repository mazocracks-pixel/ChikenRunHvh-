import type { CollisionWorld } from './collision';
import type { Vec3 } from './math';
import { makeRay, raycastWorld } from './raycast';

export type ProjectileKind = 'egg' | 'smoke' | 'rocket' | 'bolt' | 'flash';

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
}

export const PROJECTILES: Record<ProjectileKind, ProjectileDef> = {
  egg: {
    speed: 19, upBoost: 3.5, gravity: 18, radius: 0.12, fuseMs: 4000, explodeOnImpact: true, bounce: 0,
    damage: 95, splashRadius: 4.2, knockback: 13, selfDamageScale: 0.5,
  },
  smoke: {
    speed: 15, upBoost: 3, gravity: 18, radius: 0.12, fuseMs: 1500, explodeOnImpact: false, bounce: 0.35,
    damage: 0, splashRadius: 5, knockback: 0, selfDamageScale: 0,
  },
  rocket: {
    speed: 30, upBoost: 0, gravity: 0, radius: 0.15, fuseMs: 5000, explodeOnImpact: true, bounce: 0,
    damage: 110, splashRadius: 4, knockback: 16, selfDamageScale: 0.4,
  },
  /** Flashbang: bounces about, then goes off with a blinding flash (no damage). */
  flash: {
    speed: 16, upBoost: 3, gravity: 18, radius: 0.1, fuseMs: 1600, explodeOnImpact: false, bounce: 0.4,
    damage: 0, splashRadius: 0, knockback: 0, selfDamageScale: 0,
  },
  /** Crossbow bolt: fast, drops a little, and hits whatever it strikes directly (no blast). */
  bolt: {
    speed: 70, upBoost: 0, gravity: 7, radius: 0.04, fuseMs: 3000, explodeOnImpact: true, bounce: 0,
    damage: 0, splashRadius: 0, knockback: 0, selfDamageScale: 0,
  },
};

export const SMOKE_DURATION_MS = 10000;

/** How a flashbang blinds whoever can see it. */
export const FLASH = {
  /** Beyond this nobody is blinded. */
  range: 28,
  /** Blind time looking straight at it, point blank (ms); it fades over the last part. */
  maxMs: 4200,
  /** Shorter than this and it doesn't count. */
  minMs: 350,
} as const;

/**
 * How long (ms) a flash at `at` blinds someone at `eye` looking along `view` (unit vector), if
 * nothing is in the way: full looking at it, less from the side, a little from behind; less far away.
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
  const ms = FLASH.maxMs * angle * near;
  return ms >= FLASH.minMs ? Math.round(ms) : 0;
}

export interface ProjectileBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
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
  const hit = raycastWorld(ray, world, dist + def.radius);
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
  if (hit.ny > 0.7 && Math.abs(p.vy) < 1.5) {
    p.vy = 0;
    p.vx *= 0.8;
    p.vz *= 0.8;
  }
  return false;
}

/** 1 at the centre of a blast, falling linearly to 0 at the edge. */
export function blastFalloff(def: ProjectileDef, distance: number): number {
  return Math.max(0, 1 - distance / def.splashRadius);
}
