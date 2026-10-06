import type { CollisionWorld } from './collision';
import type { Vec3 } from './math';
import { pointOnRay, type Ray, type RayHit } from './raycast';
import { raycastPenetrating, wallbangScale, WALLBANG } from './wallbang';
import { coverDamageScale, traceHvhCover, type BallisticTrace } from './hvh/ballistics';
import { rayHvhMatrix, type HvhHit, type HvhMatrix } from './hvh/geometry';

export type ShotSurface = 'none' | 'world' | 'player' | 'loot' | 'vehicle';
export interface HitscanBlocker { t: number; id: number; kind: 'loot' | 'vehicle' }
export interface HitscanTarget<T> { key: T; matrix: HvhMatrix }
export interface HitscanTrace<T> {
  t: number; point: Vec3; normal: Vec3; surface: ShotSurface;
  target?: T; hit?: HvhHit; blocker?: number;
  soft: RayHit[]; cover: BallisticTrace | null; damageScale: number;
}

/** One instantaneous, nearest-contact query for authoritative shots and their client prediction. */
export function traceHitscan<T>(ray: Ray, world: CollisionWorld, range: number, targets: readonly HitscanTarget<T>[],
  options: { penetration?: 'none' | 'simple' | 'thickness'; isSoft?: (id: number) => boolean; blockers?: readonly HitscanBlocker[] } = {}): HitscanTrace<T> {
  const cover = options.penetration === 'thickness' ? traceHvhCover(ray, world, range, options.isSoft) : null;
  const pen = cover ? { wall: cover.wall ?? null, soft: cover.soft ?? [] }
    : raycastPenetrating(ray, world, range, options.isSoft ?? (() => false), options.penetration === 'simple' ? WALLBANG.maxBoxes : 0);
  let t = pen.wall?.t ?? range, surface: ShotSurface = pen.wall ? 'world' : 'none';
  let blocker: number | undefined, target: T | undefined, hit: HvhHit | undefined;
  let normal = pen.wall ? { x: pen.wall.nx, y: pen.wall.ny, z: pen.wall.nz } : { x: 0, y: 0, z: 0 };
  for (const b of options.blockers ?? []) if (b.t >= 0 && b.t < t) {
    t = b.t; surface = b.kind; blocker = b.id; normal = { x: 0, y: 0, z: 0 };
  }
  for (const candidate of targets) {
    const contact = rayHvhMatrix(ray, candidate.matrix, t);
    if (!contact || contact.t >= t) continue;
    t = contact.t; target = candidate.key; hit = contact; surface = 'player'; blocker = undefined;
    normal = { x: 0, y: 0, z: 0 };
  }
  return { t, point: pointOnRay(ray, t), normal, surface, target, hit, blocker, soft: pen.soft, cover,
    damageScale: cover ? coverDamageScale(cover, t) : wallbangScale(pen.soft, t) };
}
