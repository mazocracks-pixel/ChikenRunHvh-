import type { CollisionWorld } from '../../collision';
import type { Vec3 } from '../../math';
import { makeRay, raycastWorld } from '../../raycast';
import { chickenHeadCenter } from '../../chickenPose';
import { buildHvhMatrix } from '../geometry';

/** `yaw` is the body yaw the hitboxes face (default 0); only the head point depends on it. */
export interface SightTarget { x: number; y: number; z: number; crouch: number; yaw?: number }

// Head and chest centres of an unscaled chicken at the origin. buildHvhMatrix scales every centre
// linearly about the origin, so `origin + offset * scale` is its centre without rebuilding the
// whole skeleton per enemy per command. The chest sits on the axis (yaw-independent); the head
// is offset forward, so it is placed per enemy yaw as buildHvhMatrix does (chickenHeadCenter).
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const CHEST_OFFSET = buildHvhMatrix(ORIGIN, 0).boxes.find(b => b.group === 'chest')!.center;

/**
 * Whether any enemy is in actual line of sight from `eye`: its head or chest point (crouch scale as
 * in rage.ts, the head turned to the enemy's yaw) with no world box before it. Ignores the HvH
 * wallhack by design, and player clips (`world.seeThrough`) do not block sight. At most two
 * raycasts per enemy; stops at the first one seen.
 */
export function enemyVisible(eye: Vec3, enemies: readonly SightTarget[], world: CollisionWorld): boolean {
  for (const e of enemies) {
    const scale = 1 - e.crouch * 0.3;
    for (const o of [chickenHeadCenter(ORIGIN, e.yaw ?? 0), CHEST_OFFSET]) {
      const dx = e.x + o.x * scale - eye.x, dy = e.y + o.y * scale - eye.y, dz = e.z + o.z * scale - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist === 0) return true;
      const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
      if (!raycastWorld(makeRay(eye, dir), world, dist, world.seeThrough)) return true;
    }
  }
  return false;
}
