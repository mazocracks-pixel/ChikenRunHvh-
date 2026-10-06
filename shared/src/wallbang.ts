import { BLOCK_ID_BASE } from './building';
import type { CollisionWorld } from './collision';
import type { BoxKind, MapDef } from './maps/types';
import type { BlockKind } from './protocol';
import { raycastWorld, type Ray, type RayHit } from './raycast';

/** Bullets go through boxes: crates, hay and wood. Stone, brick, metal and concrete stop them. */
export const WALLBANG = {
  kinds: ['crate', 'hay', 'wood'] as readonly (BoxKind | BlockKind)[],
  /** Damage kept after passing through each box (it was 0.65; 25% less than that). */
  damageScale: 0.4875,
  /** At most this many boxes per bullet. */
  maxBoxes: 2,
} as const;

/** Tells whether a collision id (a map box, or a Sandbox block) is a box bullets pass through. */
export function softBoxTest(map: MapDef, blockKind: (blockId: number) => BlockKind | undefined = () => undefined): (id: number) => boolean {
  return (id) => {
    if (id < 0) return false;
    const kind = id >= BLOCK_ID_BASE ? blockKind(id - BLOCK_ID_BASE) : map.boxes[id]?.kind;
    return kind !== undefined && WALLBANG.kinds.includes(kind);
  };
}

export interface PenetratingHit {
  /** Boxes the ray passed through, nearest first. */
  soft: RayHit[];
  /** What finally stopped it (the ground or a solid wall), or null. */
  wall: RayHit | null;
}

/** Raycast where up to `maxSoft` soft boxes don't stop the ray. Same result on server and client. */
export function raycastPenetrating(ray: Ray, world: CollisionWorld, maxT: number, isSoft: (id: number) => boolean, maxSoft: number): PenetratingHit {
  const soft: RayHit[] = [];
  const skip = new Set<number>();
  for (;;) {
    const hit = raycastWorld(ray, world, maxT, skip);
    if (hit && hit.id !== undefined && soft.length < maxSoft && isSoft(hit.id)) {
      soft.push(hit);
      skip.add(hit.id);
      continue;
    }
    return { soft, wall: hit };
  }
}

/** Damage multiplier for something hit at distance `t`, after the boxes in front of it. */
export function wallbangScale(soft: readonly RayHit[], t: number): number {
  let n = 0;
  for (const s of soft) if (s.t < t) n++;
  return WALLBANG.damageScale ** n;
}
