import { CollisionWorld } from '../collision';
import { FACTORY } from './factory';
import { FARM } from './farm';
import { FLAT } from './flat';
import { FROSTBITE } from './frostbite';
import { HARBOR } from './harbor';
import { LOBBY } from './lobby';
import { MIRAGE } from './mirage';
import { NIGHT } from './night';
import { SANDSTOWN } from './sandstown';
import { TOWN } from './town';
import { boxToAabb, type MapDef, type MapId } from './types';

export * from './types';
export { LOBBY_LAP } from './lobby';

export const MAPS: Record<MapId, MapDef> = { mirage: MIRAGE, farm: FARM, town: TOWN, sandstown: SANDSTOWN, harbor: HARBOR, frostbite: FROSTBITE, factory: FACTORY, flat: FLAT, night: NIGHT, lobby: LOBBY };
export const MAP_IDS = Object.keys(MAPS) as MapId[];

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && Object.hasOwn(MAPS, value);
}

/** A fresh collision world for a map (each room gets its own, since Sandbox adds blocks to it). */
export function createCollisionWorld(map: MapDef): CollisionWorld {
  const world = new CollisionWorld(map.halfSize, map.boxes.map(boxToAabb));
  map.boxes.forEach((box, id) => box.clip && world.seeThrough.add(id));
  world.ladders = map.ladders ?? [];
  return world;
}
