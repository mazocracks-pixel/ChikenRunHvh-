import { PLAYER } from '../constants';
import type { CollisionWorld } from '../collision';
import { damageAt, pelletDirections, type WeaponDef } from '../weapons';
import { hvhSpread } from './weapons';
import { makeRay, rayAabb, raycastWorld, type Ray } from '../raycast';
import type { Vec3 } from '../math';
import { rayHvhMatrix, type HvhHit, type HvhMatrix } from './geometry';

export interface BallisticTrace { wallDistance: number; passages: { entry: number; exit: number; loss: number }[] }
/** Thickness-based penetration shared by server execution and every targeting prediction. */
export function traceHvhCover(ray: Ray, world: CollisionWorld, range: number, isSoft?: (id: number) => boolean): BallisticTrace {
  const skip = new Set<number>(), passages: BallisticTrace['passages'] = [];
  for (let n = 0; n < 3; n++) {
    const hit = raycastWorld(ray, world, range, skip);
    if (!hit) return { wallDistance: range, passages };
    if (hit.id === undefined || !isSoft?.(hit.id) || passages.length >= 2) return { wallDistance: hit.t, passages };
    const box = world.get(hit.id);
    if (!box) return { wallDistance: hit.t, passages };
    const endpoint = { x: ray.ox + ray.dx * range, y: ray.oy + ray.dy * range, z: ray.oz + ray.dz * range };
    const reverse = makeRay(endpoint, { x: -ray.dx, y: -ray.dy, z: -ray.dz });
    const backwardsEntry = rayAabb(reverse, box, range);
    const exit = backwardsEntry < 0 ? range : range - backwardsEntry;
    const thickness = Math.max(0, exit - hit.t);
    passages.push({ entry: hit.t, exit, loss: Math.exp(-thickness * 0.22) * 0.82 });
    skip.add(hit.id);
  }
  return { wallDistance: range, passages };
}
export function coverDamageScale(cover: BallisticTrace, t: number): number {
  return cover.passages.filter(p => p.entry < t).reduce((n, p) => n * p.loss, 1);
}
export function hvhHitDamage(w: WeaponDef, hit: HvhHit, cover: BallisticTrace): number {
  const multiplier = hit.headshot ? w.headshotMultiplier : hit.group === 'stomach' ? 1.15 : hit.group === 'leg' ? 0.75 : 1;
  return damageAt(w, hit.t) * multiplier * coverDamageScale(cover, hit.t);
}
export function afterArmor(damage: number, armor: number): number { return damage - Math.min(armor, damage * PLAYER.armorAbsorb); }
export interface HitchanceResult { chance: number; damage: number; samples: number }
export function hvhHitchance(w: WeaponDef, eye: Vec3, direction: Vec3, matrix: HvhMatrix, speed: number,
  airborne: boolean, ads: boolean, world: CollisionWorld, isSoft?: (id: number) => boolean, samples = 32, heat = 0): HitchanceResult {
  let hits = 0, damage = 0;
  for (let n = 0; n < samples; n++) {
    let trial = 0;
    for (const dir of pelletDirections(w, direction, hvhSpread(w, speed, airborne, ads, heat), 4177 + n * 7919)) {
      const ray = makeRay(eye, dir), cover = traceHvhCover(ray, world, w.range, isSoft);
      const hit = rayHvhMatrix(ray, matrix, cover.wallDistance);
      if (hit) trial += hvhHitDamage(w, hit, cover);
    }
    if (trial > 0) { hits++; damage += trial; }
  }
  return { chance: hits / samples, damage: hits ? damage / hits : 0, samples };
}
