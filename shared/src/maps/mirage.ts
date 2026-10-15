import data from './mirage-data.json';
import { type MapBox, type MapDef, type SpawnPoint } from './types';
import { BACKROOMS_SPEC, FACILITY_SPEC, buildZone } from './zones';

const backrooms = buildZone(BACKROOMS_SPEC);
const facility = buildZone(FACILITY_SPEC);
const index = new Map(data.nav.map((p, i) => [p.id, i]));
const bases = [1, 2].map((team) => {
  const spawn = data.spawns.find((p) => p.team === team)!;
  return data.nav.reduce((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) <= Math.hypot(b.x - spawn.x, b.z - spawn.z) ? a : b);
});

/** Original Mirage coordinates: 40 Source units per metre, Source Z=-400 at ground zero. */
export const MIRAGE: MapDef = {
  id: 'mirage', name: 'Mirage', ground: 'sand', mesh: '/maps/mirage.glb',
  radar: { image: '/maps/mirage-radar.png', x: -80.75, z: -42.825, size: 128 },
  halfSize: Math.ceil(Math.max(86, backrooms.zone.maxX, -backrooms.zone.minZ, facility.zone.maxZ) + 6),
  boxes: [...data.boxes as MapBox[], ...backrooms.boxes, ...facility.boxes],
  spawns: data.spawns as SpawnPoint[],
  loot: [], vehicles: [],
  flags: bases.map((p, i) => ({ team: (i + 1) as 1 | 2, x: p.x, y: p.y, z: p.z })),
  bombSites: [
    { id: 'A', x: -11, y: 5.7, z: 54.2, radius: 4 },
    { id: 'B', x: -51.2, y: 6.1, z: -6.4, radius: 4 },
  ],
  buyZones: [
    { team: 1, x: 31.2, z: 3.4, radius: 8.3 },
    { team: 2, x: -45.6, z: 46.6, radius: 11.9 },
  ],
  nav: [...data.nav, ...backrooms.nav, ...facility.nav],
  navLinks: data.nav.map((p) => p.links.flatMap((id) => index.has(id) ? [index.get(id)!] : [])),
  // Existing PvE events stay sealed outside the competitive map.
  zones: [backrooms.zone, facility.zone],
  lamps: [...backrooms.lamps, ...facility.lamps],
};
