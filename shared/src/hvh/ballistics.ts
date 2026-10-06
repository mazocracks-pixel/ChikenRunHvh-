import { PLAYER } from '../constants';
import type { CollisionWorld } from '../collision';
import { damageAt, pelletDirections, type WeaponDef } from '../weapons';
import { hvhSpread } from './weapons';
import { makeRay, rayAabb, raycastWorld, type Ray, type RayHit } from '../raycast';
import type { Vec3 } from '../math';
import { rayHvhMatrix, type HvhHit, type HvhMatrix } from './geometry';

export interface BallisticTrace { wallDistance: number; passages: { entry: number; exit: number; loss: number }[]; wall?: RayHit | null; soft?: RayHit[] }
/** Thickness-based penetration shared by server execution and every targeting prediction. */
export function traceHvhCover(ray: Ray, world: CollisionWorld, range: number, isSoft?: (id: number) => boolean): BallisticTrace {
  const skip = new Set<number>(), passages: BallisticTrace['passages'] = [], soft: RayHit[] = [];
  for (let n = 0; n < 3; n++) {
    const hit = raycastWorld(ray, world, range, skip);
    if (!hit) return { wallDistance: range, passages, wall: null, soft };
    if (hit.id === undefined || !isSoft?.(hit.id) || passages.length >= 2) return { wallDistance: hit.t, passages, wall: hit, soft };
    const box = world.get(hit.id);
    if (!box) return { wallDistance: hit.t, passages, wall: hit, soft };
    const endpoint = { x: ray.ox + ray.dx * range, y: ray.oy + ray.dy * range, z: ray.oz + ray.dz * range };
    const reverse = makeRay(endpoint, { x: -ray.dx, y: -ray.dy, z: -ray.dz });
    const backwardsEntry = rayAabb(reverse, box, range);
    const exit = backwardsEntry < 0 ? range : range - backwardsEntry;
    const thickness = Math.max(0, exit - hit.t);
    passages.push({ entry: hit.t, exit, loss: Math.exp(-thickness * 0.22) * 0.82 });
    soft.push(hit);
    skip.add(hit.id);
  }
  return { wallDistance: range, passages, wall: null, soft };
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
export interface HitchanceHypothesis { matrix: HvhMatrix; probability: number }
export function hvhHitchance(w: WeaponDef, eye: Vec3, direction: Vec3, matrix: HvhMatrix, speed: number,
  airborne: boolean, ads: boolean, world: CollisionWorld, isSoft?: (id: number) => boolean, samples = 32, heat = 0,
  hypotheses: readonly HitchanceHypothesis[] = [{ matrix, probability: 1 }]): HitchanceResult {
  let hits = 0, damage = 0;
  const weight = hypotheses.reduce((n, h) => n + h.probability, 0);
  if (weight <= 0) return { chance: 0, damage: 0, samples };
  const spread = hvhSpread(w, speed, airborne, ads, heat);
  const trials = spread === 0 ? 1 : samples;
  for (let n = 0; n < trials; n++) {
    const trial = hypotheses.map(() => 0);
    for (const dir of pelletDirections(w, direction, spread, 4177 + n * 7919)) {
      const ray = makeRay(eye, dir), cover = traceHvhCover(ray, world, w.range, isSoft);
      hypotheses.forEach((h, i) => {
        const hit = rayHvhMatrix(ray, h.matrix, cover.wallDistance);
        if (hit) trial[i]! += hvhHitDamage(w, hit, cover);
      });
    }
    trial.forEach((amount, i) => { if (amount > 0) { const p = hypotheses[i]!.probability / weight; hits += p; damage += amount * p; } });
  }
  return { chance: Math.min(1, hits / trials), damage: hits ? damage / hits : 0, samples: trials };
}
