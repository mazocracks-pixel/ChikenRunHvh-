import { HITBOX, clamp, makeRay, normalize, rayChicken, type Vec3 } from '@game/shared';
import type { ShotTarget } from '../tactics';

export function skeetPointOffsets(part: 'head' | 'body', scale: number, amount: number, enabled: boolean): Vec3[] {
  const zero = { x: 0, y: 0, z: 0 };
  if (!enabled || amount <= 0) return [zero];
  const radius = (part === 'head' ? HITBOX.headRadius : HITBOX.bodyRadius) * scale * clamp(amount, 0, 75) / 100;
  return [zero, { x: -radius, y: 0, z: 0 }, { x: radius, y: 0, z: 0 }, { x: 0, y: radius * 0.6, z: 0 }, { x: 0, y: -radius * 0.6, z: 0 }];
}
/** A safe point must hit the same real geometry across the observed yaw uncertainty. */
export function skeetSafeRay(eye: Vec3, direction: Vec3, target: ShotTarget, uncertainty: number, range: number): boolean {
  const ray = makeRay(eye, normalize(direction));
  const radians = clamp(uncertainty, 0, 25) * Math.PI / 180;
  return [-radians, 0, radians].every(offset => !!rayChicken(ray, target.x, target.y, target.z, target.yaw + offset, range, target.scale));
}
