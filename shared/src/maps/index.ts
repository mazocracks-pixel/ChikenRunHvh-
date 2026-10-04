import { CollisionWorld } from '../collision';
import { FACTORY } from './factory';
import { FARM } from './farm';
import { FLAT } from './flat';
import { FROSTBITE } from './frostbite';
import { HARBOR } from './harbor';
import { SANDSTOWN } from './sandstown';
import { TOWN } from './town';
import { boxToAabb, type MapDef, type MapId } from './types';

export * from './types';

export const MAPS: Record<MapId, MapDef> = { farm: FARM, town: TOWN, sandstown: SANDSTOWN, harbor: HARBOR, frostbite: FROSTBITE, factory: FACTORY, flat: FLAT };
export const MAP_IDS = Object.keys(MAPS) as MapId[];

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && value in MAPS;
}

/** A fresh collision world for a map (each room gets its own, since Sandbox adds blocks to it). */
export function createCollisionWorld(map: MapDef): CollisionWorld {
  return new CollisionWorld(map.halfSize, map.boxes.map(boxToAabb));
}
