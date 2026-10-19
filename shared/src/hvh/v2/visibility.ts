import type { CollisionWorld } from '../../collision';
import type { Vec3 } from '../../math';
import { makeRay, raycastWorld } from '../../raycast';
import { buildHvhMatrix } from '../geometry';

export interface SightTarget { x: number; y: number; z: number; crouch: number }

// Head and chest centres of an unscaled, yaw-0 chicken at the origin. buildHvhMatrix scales every
// centre linearly about the origin, so `origin + offset * scale` is its centre without rebuilding
// the whole skeleton per enemy per command.
const UNIT = buildHvhMatrix({ x: 0, y: 0, z: 0 }, 0);
const SIGHT_OFFSETS: readonly Vec3[] = (['head', 'chest'] as const).map(g => UNIT.boxes.find(b => b.group === g)!.center);

/**
 * Whether any enemy is in actual line of sight from `eye`: its head or chest point (crouch scale as
 * in rage.ts) with no world box before it. Ignores the HvH wallhack by design, and player clips
 * (`world.seeThrough`) do not block sight. At most two raycasts per enemy; stops at the first one seen.
 */
export function enemyVisible(eye: Vec3, enemies: readonly SightTarget[], world: CollisionWorld): boolean {
  for (const e of enemies) {
    const scale = 1 - e.crouch * 0.3;
    for (const o of SIGHT_OFFSETS) {
      const dx = e.x + o.x * scale - eye.x, dy = e.y + o.y * scale - eye.y, dz = e.z + o.z * scale - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist === 0) return true;
      const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
      if (!raycastWorld(makeRay(eye, dir), world, dist, world.seeThrough)) return true;
    }
  }
  return false;
}
