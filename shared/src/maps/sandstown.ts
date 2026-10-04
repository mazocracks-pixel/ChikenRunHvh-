import { block, crate, type MapBox, type MapDef } from './types';

/**
 * Sandstown: a desert town for ChikenBomb. North is -Z.
 *
 *   chikenT spawn (west) ── Long A (north lane) ───────────► A site (north-east)
 *        │   └──── Mid (centre, through the mid doors) ──► chikenCT spawn (east) ─► A / B
 *        │              ├─ Short A (north connector)             │
 *        │              └─ Mid to B (south connector)            │
 *        └──── B tunnels (south lane) ───────────────────► B site (south) ◄──────┘
 *
 * The streets run between big sandstone blocks; crates (shoot-through), metal containers and
 * low walls give cover on the way and on both sites.
 */

const HALF = 44;

/** A sandstone building filling the rectangle between two corners. */
function building(minX: number, maxX: number, minZ: number, maxZ: number, h: number): MapBox {
  return block('sandstone', (minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, h, maxZ - minZ);
}

const BUILDINGS: MapBox[] = [
  // North-west blocks between Long A, Mid and Short A.
  building(-34, -16, -34, -8, 8),
  building(-16, 2, -34, -8, 6),
  building(-26, 2, -8, -4, 4),
  // "Apartments" between Short A and the A site, and a lower block by chikenCT spawn.
  building(8, 20, -34, -4, 7),
  building(20, 28, -16, -4, 5),
  // South-west blocks between Mid, the B tunnels and Mid to B.
  building(-34, -20, 12, 34, 7),
  building(-20, -6, 12, 34, 8),
  building(-26, -6, 4, 12, 4),
  // South-east blocks between Mid, B and the chikenCT side.
  building(0, 14, 4, 24, 6),
  building(14, 28, 4, 24, 8),
  building(0, 4, 24, 34, 5),
];

/** Town walls just inside the map edge (north/south span the corners, east/west fit between). */
const PERIMETER: MapBox[] = [
  block('sandstone', 0, -HALF + 0.5, HALF * 2, 9, 1),
  block('sandstone', 0, HALF - 0.5, HALF * 2, 9, 1),
  block('sandstone', -HALF + 0.5, 0, 1, 9, HALF * 2 - 2),
  block('sandstone', HALF - 0.5, 0, 1, 9, HALF * 2 - 2),
];

const COVER: MapBox[] = [
  // chikenT spawn.
  crate(-29, -6),
  crate(-29, 9),
  // Long A: the west lane, then the north lane.
  crate(-37, -20),
  block('wood', -40, -28, 1.2, 1.2, 2.4),
  { kind: 'car', x: -14, z: -40.5, w: 4, h: 1.4, d: 2, color: 0xc9a227 },
  crate(6, -40),
  crate(6, -40, 1.2, 1.2),
  // A site.
  block('metal', 34, -36, 6, 2.6, 2.4),
  crate(26, -27),
  crate(27.2, -27),
  crate(26.6, -27, 1.2, 1.2),
  block('sandstone', 30, -21, 6, 1.2, 0.8),
  crate(38, -24),
  // Short A.
  crate(3, -18),
  // Mid, with the mid doors halfway.
  block('sandstone', 0, -3, 1, 4, 2),
  block('sandstone', 0, 3, 1, 4, 2),
  crate(-14, 2),
  crate(14, -2),
  crate(21, 2.5),
  // chikenCT spawn and the way down to B.
  crate(31, -6),
  crate(40.5, 10),
  crate(31, 20),
  // B site: containers and crates.
  block('metal', 11, 30, 2.4, 2.6, 6),
  block('metal', 24, 38, 6, 2.6, 2.4),
  crate(16, 28),
  crate(17.2, 28),
  crate(16.6, 28, 1.2, 1.2),
  block('wood', 30, 30, 2.4, 1.2, 1.2),
  // B tunnels and Mid to B.
  crate(-20, 40.5),
  crate(-8, 40),
  crate(-40, 26),
  crate(-5, 20),
];

export const SANDSTOWN: MapDef = {
  id: 'sandstown',
  name: 'Sandstown',
  halfSize: HALF,
  ground: 'sand',
  boxes: [...BUILDINGS, ...PERIMETER, ...COVER],
  spawns: [
    // chikenT (team 1), west.
    { x: -38, z: -4, team: 1 },
    { x: -38, z: 0, team: 1 },
    { x: -38, z: 4, team: 1 },
    { x: -38, z: 8, team: 1 },
    { x: -33, z: -2, team: 1 },
    { x: -33, z: 2, team: 1 },
    { x: -33, z: 6, team: 1 },
    // chikenCT (team 2), east.
    { x: 38, z: -6, team: 2 },
    { x: 38, z: -2, team: 2 },
    { x: 38, z: 2, team: 2 },
    { x: 38, z: 6, team: 2 },
    { x: 33, z: -3, team: 2 },
    { x: 33, z: 1, team: 2 },
    { x: 33, z: 5, team: 2 },
  ],
  loot: [],
  vehicles: [],
  flags: [],
  bombSites: [
    { id: 'A', x: 31, z: -29, radius: 6.5 },
    { id: 'B', x: 18, z: 33, radius: 6.5 },
  ],
  nav: [
    // chikenT spawn, Long A (west lane, north lane), A site.
    { x: -36, z: 2 },
    { x: -30, z: 2 },
    { x: -38, z: -12 },
    { x: -38, z: -26 },
    { x: -38, z: -38 },
    { x: -24, z: -37 },
    { x: -6, z: -37 },
    { x: 5, z: -37 },
    { x: 14, z: -37 },
    { x: 26, z: -37 },
    { x: 31, z: -29 },
    { x: 36, z: -20 },
    // chikenCT side.
    { x: 35, z: -13 },
    { x: 35, z: 0 },
    { x: 35, z: 18 },
    // B site and the B tunnels.
    { x: 36, z: 30 },
    { x: 24, z: 31 },
    { x: 18, z: 33 },
    { x: 8, z: 38 },
    { x: 0, z: 38 },
    { x: -14, z: 38 },
    { x: -28, z: 38 },
    { x: -38, z: 38 },
    { x: -38, z: 24 },
    { x: -38, z: 14 },
    // Mid, Short A and Mid to B.
    { x: -22, z: 0 },
    { x: -12, z: 0 },
    { x: -3, z: 0 },
    { x: 5, z: 0 },
    { x: 16, z: 0 },
    { x: 24, z: 0 },
    { x: 5, z: -10 },
    { x: 5, z: -24 },
    { x: 5, z: -32 },
    { x: -3, z: 10 },
    { x: -3, z: 22 },
    { x: -3, z: 32 },
  ],
};
