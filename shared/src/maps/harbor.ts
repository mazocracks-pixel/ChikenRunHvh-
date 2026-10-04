import { block, crate, type MapBox, type MapDef } from './types';

/**
 * Harbor: a container yard on the docks. North is -Z.
 *
 *   chikenT lane (west) ── North lane ─── A site (north) ─── chikenCT lane (east)
 *        │                 Mid lane (centre, with connectors up to North / down to South)
 *        └──────────────── South lane ─── B site (south) ──────────┘
 *
 * Shipping containers (stacked one or two high) fill the blocks between the lanes and stop
 * bullets; crates on the way can be shot through. Two harbour cranes stand at the ends.
 */

const HALF = 46;
const CONTAINER = { long: 6, high: 2.6, wide: 2.4, gap: 0.2 };
const COLORS = [0xb8382f, 0x2f6fb8, 0x3c8f4a, 0xd28a2a, 0x7a7f86, 0x8a3a8f];

/** Fills a rectangle with containers lying along X, some stacked two high. */
function containers(minX: number, maxX: number, minZ: number, maxZ: number, seed: number): MapBox[] {
  const out: MapBox[] = [];
  const pitchX = CONTAINER.long + CONTAINER.gap;
  const pitchZ = CONTAINER.wide + CONTAINER.gap;
  const nx = Math.floor((maxX - minX + CONTAINER.gap) / pitchX);
  const nz = Math.floor((maxZ - minZ + CONTAINER.gap) / pitchZ);
  const x0 = (minX + maxX) / 2 - ((nx - 1) * pitchX) / 2;
  const z0 = (minZ + maxZ) / 2 - ((nz - 1) * pitchZ) / 2;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const n = seed * 31 + i * 7 + j * 13;
      const x = x0 + i * pitchX;
      const z = z0 + j * pitchZ;
      out.push({ kind: 'metal', x, z, w: CONTAINER.long, h: CONTAINER.high, d: CONTAINER.wide, color: COLORS[n % COLORS.length] });
      if (n % 3 === 0) out.push({ kind: 'metal', x, y: CONTAINER.high, z, w: CONTAINER.long, h: CONTAINER.high, d: CONTAINER.wide, color: COLORS[(n + 2) % COLORS.length] });
    }
  }
  return out;
}

/** A harbour crane: two tall legs and a beam across the top. */
function crane(x: number, z: number): MapBox[] {
  return [block('metal', x - 3, z, 1, 12, 1), block('metal', x + 3, z, 1, 12, 1), { kind: 'metal', x, y: 12, z, w: 8, h: 1, d: 1.4, color: 0xd2a22a }];
}

const YARD: MapBox[] = [
  ...containers(-32, -6, -42, -24, 1),
  ...containers(16, 32, -42, -24, 2),
  ...containers(-32, -2, -18, -4, 3),
  ...containers(4, 32, -18, -4, 4),
  ...containers(-32, -2, 4, 18, 5),
  ...containers(4, 32, 4, 18, 6),
  ...containers(-32, -6, 24, 42, 7),
  ...containers(16, 32, 24, 42, 8),
];

/** Low quay walls just inside the map edge. */
const QUAY: MapBox[] = [
  block('concrete', 0, -HALF + 0.5, HALF * 2, 1.2, 1),
  block('concrete', 0, HALF - 0.5, HALF * 2, 1.2, 1),
  block('concrete', -HALF + 0.5, 0, 1, 1.2, HALF * 2 - 2),
  block('concrete', HALF - 0.5, 0, 1, 1.2, HALF * 2 - 2),
];

const COVER: MapBox[] = [
  ...crane(-39, -40),
  ...crane(39, 40),
  // A site (north) and B site (south): a lone container, crates and a low barrier.
  { kind: 'metal', x: 10, z: -36, w: 6, h: 2.6, d: 2.4, color: 0x2f6fb8 },
  crate(0, -30),
  crate(1.2, -30),
  crate(0.6, -30, 1.2, 1.2),
  block('concrete', 5, -27, 4, 1, 0.6),
  { kind: 'metal', x: 10, z: 36, w: 6, h: 2.6, d: 2.4, color: 0xb8382f },
  crate(0, 30),
  crate(1.2, 30),
  crate(0.6, 30, 1.2, 1.2),
  block('concrete', 5, 27, 4, 1, 0.6),
  // Lanes.
  crate(-16, -23),
  crate(18, -19.2),
  block('concrete', -14, 0, 0.6, 1.1, 3),
  block('concrete', 14, 0, 0.6, 1.1, 3),
  crate(-16, 23),
  crate(18, 19.2),
  crate(-41, -16),
  crate(-40, 16),
  crate(41, 16),
  crate(40, -16),
];

export const HARBOR: MapDef = {
  id: 'harbor',
  name: 'Harbor',
  halfSize: HALF,
  ground: 'dock',
  boxes: [...YARD, ...QUAY, ...COVER],
  spawns: [
    ...[-6, -2, 2, 6].flatMap((z) => [
      { x: -40, z, team: 1 as const },
      { x: -36, z, team: 1 as const },
      { x: 40, z, team: 2 as const },
      { x: 36, z, team: 2 as const },
    ]),
  ],
  loot: [
    { x: 1, z: -11 },
    { x: 1, z: 11 },
    { x: -38, z: -30 },
    { x: 38, z: 30 },
  ],
  vehicles: [],
  flags: [],
  bombSites: [
    { id: 'A', x: 5, z: -33, radius: 6.5 },
    { id: 'B', x: 5, z: 33, radius: 6.5 },
  ],
  nav: [
    // The two side lanes.
    ...[-36, -21, -10, 0, 10, 21, 36].flatMap((z) => [
      { x: -38, z },
      { x: 38, z },
    ]),
    // North and south lanes.
    ...[-28, -14, 1, 14, 28].flatMap((x) => [
      { x, z: -21 },
      { x, z: 21 },
    ]),
    // Mid (around the barriers) and the centre connectors.
    { x: -28, z: -2.8 },
    { x: -14, z: -2.8 },
    { x: 1, z: 0 },
    { x: 14, z: -2.8 },
    { x: 28, z: -2.8 },
    { x: 1, z: -11 },
    { x: 1, z: 11 },
    // The sites.
    { x: 5, z: -33 },
    { x: 12, z: -28 },
    { x: -3, z: -27 },
    { x: 5, z: 33 },
    { x: 12, z: 28 },
    { x: -3, z: 27 },
  ],
};
