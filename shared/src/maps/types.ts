import type { Aabb } from '../collision';

export type MapId = 'farm' | 'town' | 'flat';

export type BoxKind = 'crate' | 'hay' | 'stone' | 'brick' | 'wood' | 'roof' | 'concrete' | 'car' | 'metal';

/** A solid block in the level. `x`/`z` are the centre, `y` is the bottom (defaults to the ground). */
export interface MapBox {
  kind: BoxKind;
  x: number;
  y?: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** Optional paint colour (e.g. parked cars). */
  color?: number;
}

/** Team 0 = no team (free-for-all), 1 = red, 2 = blue. */
export type Team = 0 | 1 | 2;

export interface SpawnPoint {
  x: number;
  z: number;
  /** Team-mode spawns; points without a team are only used in free-for-all modes. */
  team?: 1 | 2;
}

/** Where a loot box floats. `y` is the surface it hovers over. */
export interface LootSpot {
  x: number;
  y?: number;
  z: number;
}

export interface VehicleSpot {
  x: number;
  z: number;
  yaw: number;
}

export interface FlagSpot {
  team: 1 | 2;
  x: number;
  z: number;
}

export type GroundStyle = 'grass' | 'town' | 'flat';

export interface MapDef {
  id: MapId;
  name: string;
  /** The playable area is the square [-halfSize, halfSize] on X and Z. */
  halfSize: number;
  ground: GroundStyle;
  boxes: readonly MapBox[];
  spawns: readonly SpawnPoint[];
  loot: readonly LootSpot[];
  vehicles: readonly VehicleSpot[];
  flags: readonly FlagSpot[];
}

export function boxToAabb(box: MapBox): Aabb {
  const y = box.y ?? 0;
  return {
    minX: box.x - box.w / 2,
    maxX: box.x + box.w / 2,
    minY: y,
    maxY: y + box.h,
    minZ: box.z - box.d / 2,
    maxZ: box.z + box.d / 2,
  };
}

/** Mirrors something into all four quadrants (skips duplicates when a coordinate is 0). */
export function mirrored<T extends { x: number; z: number }>(item: T): T[] {
  const out: T[] = [];
  for (const sx of item.x === 0 ? [1] : [1, -1]) {
    for (const sz of item.z === 0 ? [1] : [1, -1]) {
      out.push({ ...item, x: item.x * sx, z: item.z * sz });
    }
  }
  return out;
}

export const CRATE_SIZE = 1.2;

export function crate(x: number, z: number, size = CRATE_SIZE, y = 0): MapBox {
  return { kind: 'crate', x, y, z, w: size, h: size, d: size };
}

export function block(kind: BoxKind, x: number, z: number, w: number, h: number, d: number, y = 0): MapBox {
  return { kind, x, y, z, w, h, d };
}
