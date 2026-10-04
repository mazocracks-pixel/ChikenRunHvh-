import { block, crate, mirrored, type BoxKind, type MapBox, type MapDef } from './types';

/**
 * Frostbite: a snowy outpost. Wooden cabins (bullets go through their walls) around an icy
 * square, a flag base at each end for Capture the Flag. North is -Z; the map is symmetric.
 */

type Side = 'n' | 's' | 'e' | 'w';
const WALL = 0.3;
const DOOR_WIDTH = 1.6;
const DOOR_HEIGHT = 2.2;
const ICE = 0xbfe4f5;

/** A hollow cabin: four walls with a doorway in each listed side and a flat roof. */
function cabin(cx: number, cz: number, w: number, d: number, h: number, doors: Side[], kind: BoxKind = 'wood'): MapBox[] {
  const out: MapBox[] = [];
  const wall = (side: Side) => {
    const alongX = side === 'n' || side === 's';
    const length = alongX ? w : d - 2 * WALL;
    const fixed = side === 'n' ? cz - d / 2 + WALL / 2 : side === 's' ? cz + d / 2 - WALL / 2 : side === 'w' ? cx - w / 2 + WALL / 2 : cx + w / 2 - WALL / 2;
    const centre = alongX ? cx : cz;
    const piece = (from: number, to: number, y: number, height: number) => {
      const mid = (from + to) / 2;
      const len = to - from;
      out.push(alongX ? block(kind, mid, fixed, len, height, WALL, y) : block(kind, fixed, mid, WALL, height, len, y));
    };
    if (!doors.includes(side)) return piece(centre - length / 2, centre + length / 2, 0, h);
    piece(centre - length / 2, centre - DOOR_WIDTH / 2, 0, h);
    piece(centre + DOOR_WIDTH / 2, centre + length / 2, 0, h);
    piece(centre - DOOR_WIDTH / 2, centre + DOOR_WIDTH / 2, DOOR_HEIGHT, h - DOOR_HEIGHT);
  };
  (['n', 's', 'w', 'e'] as const).forEach(wall);
  out.push(block('roof', cx, cz, w, 0.3, d, h));
  return out;
}

const ice = (x: number, z: number, w: number, h: number, d: number): MapBox => ({ kind: 'stone', x, z, w, h, d, color: ICE });

// The +X/+Z quarter, mirrored into the other three.
const QUARTER: MapBox[] = [
  ...cabin(14, 12, 8, 7, 3.2, ['w', 'n']),
  crate(19.5, 17),
  crate(19.5, 18.2),
  ice(22, 24, 3, 1.4, 1),
  ice(8, 4, 3.4, 1.1, 0.8),
];

export const FROSTBITE: MapDef = {
  id: 'frostbite',
  name: 'Frostbite',
  halfSize: 38,
  ground: 'snow',
  boxes: [
    // The icy square in the middle.
    ice(0, 0, 2, 3, 2),
    // A cabin at each base, and one on each side of the square.
    ...cabin(0, 24, 9, 6, 3.4, ['n', 'e', 'w']),
    ...cabin(0, -24, 9, 6, 3.4, ['s', 'e', 'w']),
    ...cabin(26, 0, 7, 7, 3.2, ['w', 'e']),
    ...cabin(-26, 0, 7, 7, 3.2, ['w', 'e']),
    crate(0, 12),
    crate(0, -12),
    ...QUARTER.flatMap((box) => mirrored(box)),
  ],
  spawns: [
    { x: -20, z: 32, team: 1 },
    { x: -10, z: 33, team: 1 },
    { x: 10, z: 33, team: 1 },
    { x: 20, z: 32, team: 1 },
    { x: -7, z: 29, team: 1 },
    { x: 7, z: 29, team: 1 },
    { x: -20, z: -32, team: 2 },
    { x: -10, z: -33, team: 2 },
    { x: 10, z: -33, team: 2 },
    { x: 20, z: -32, team: 2 },
    { x: -7, z: -29, team: 2 },
    { x: 7, z: -29, team: 2 },
    ...mirrored({ x: 32, z: 12 }),
  ],
  loot: [...mirrored({ x: 14, z: 12 }), { x: 0, y: 3, z: 0 }],
  vehicles: [],
  flags: [
    { team: 1, x: 0, z: 31 },
    { team: 2, x: 0, z: -31 },
  ],
};
