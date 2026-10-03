import type { CollisionWorld } from './collision';
import { clamp, type Vec3 } from './math';
import { HITBOX, makeRay, pointOnRay, rayChicken, raycastWorld } from './raycast';
import type { WeaponDef } from './weapons';

/** A chicken a swing could hit (positions already rewound for lag compensation on the server). */
export interface MeleeTarget<T> {
  key: T;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Body scale, smaller while crouched. */
  scale: number;
}

export interface MeleeHit<T> {
  key: T;
  headshot: boolean;
  /** Where the blow lands. */
  point: Vec3;
}

/**
 * Which chicken a melee swing hits, if any. First exactly under the crosshair within reach (so
 * head hits count); failing that, the nearest chicken inside the weapon's swing cone. Walls block
 * both. Same function on the client (feedback) and server (the authority).
 * @param aim normalized look direction
 */
export function meleeHit<T>(eye: Vec3, aim: Vec3, w: WeaponDef, targets: readonly MeleeTarget<T>[], world: CollisionWorld): MeleeHit<T> | null {
  const reach = w.range;
  const ray = makeRay(eye, aim);
  const wall = raycastWorld(ray, world, reach);
  let maxT = wall ? wall.t : reach;
  let best: MeleeHit<T> | null = null;
  for (const t of targets) {
    const hit = rayChicken(ray, t.x, t.y, t.z, t.yaw, maxT, t.scale);
    if (hit) {
      maxT = hit.t;
      best = { key: t.key, headshot: hit.headshot, point: pointOnRay(ray, hit.t) };
    }
  }
  if (best || !w.melee) return best;

  const minDot = Math.cos(w.melee.arc);
  const flat = Math.hypot(aim.x, aim.z);
  let bestDistance = Infinity;
  for (const t of targets) {
    const dx = t.x - eye.x;
    const dz = t.z - eye.z;
    // Aim at the point of the body (feet to head) at the height the swing passes, so looking a
    // little high or low doesn't matter, only left and right does.
    const passes = flat > 1e-6 ? eye.y + (aim.y / flat) * Math.hypot(dx, dz) : eye.y;
    const dy = clamp(passes, t.y, t.y + (HITBOX.headHeight + HITBOX.headRadius) * t.scale) - eye.y;
    const d = Math.hypot(dx, dy, dz);
    const surface = d - HITBOX.bodyRadius * t.scale;
    if (d < 1e-6 || surface > reach || d >= bestDistance) continue;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    if (dir.x * aim.x + dir.y * aim.y + dir.z * aim.z < minDot) continue;
    if (raycastWorld(makeRay(eye, dir), world, d)) continue;
    bestDistance = d;
    const at = Math.max(0, surface);
    best = { key: t.key, headshot: false, point: { x: eye.x + dir.x * at, y: eye.y + dir.y * at, z: eye.z + dir.z * at } };
  }
  return best;
}
