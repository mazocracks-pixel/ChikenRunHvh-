import { block, crate, mirrored, type MapBox, type MapDef } from './types';

type Side = 'n' | 's' | 'e' | 'w';

const WALL = 0.3;
const DOOR_WIDTH = 1.6;
const DOOR_HEIGHT = 2.2;
const ROOF = 0.3;

/**
 * A hollow one-room house: four walls with a doorway in each listed side, and a flat roof
 * you can stand on. Walls never overlap: N/S walls span the full width, E/W walls fit between.
 */
function house(cx: number, cz: number, w: number, d: number, h: number, doors: Side[]): MapBox[] {
  const out: MapBox[] = [];
  const kind = 'brick';

  // A wall running along X (north/south) or Z (east/west), optionally split by a centred doorway.
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
    if (!doors.includes(side)) {
      piece(centre - length / 2, centre + length / 2, 0, h);
      return;
    }
    piece(centre - length / 2, centre - DOOR_WIDTH / 2, 0, h);
    piece(centre + DOOR_WIDTH / 2, centre + length / 2, 0, h);
    piece(centre - DOOR_WIDTH / 2, centre + DOOR_WIDTH / 2, DOOR_HEIGHT, h - DOOR_HEIGHT);
  };

  (['n', 's', 'w', 'e'] as const).forEach(wall);
  out.push(block('roof', cx, cz, w, ROOF, d, h));
  return out;
}

function car(x: number, z: number, alongZ: boolean, color: number): MapBox {
  return { kind: 'car', x, z, w: alongZ ? 2 : 4, h: 1.4, d: alongZ ? 4 : 2, color };
}

// Everything in the +X/+Z quadrant; the map is mirrored into the other three.
const quadrant: MapBox[] = [
  ...house(11, 11, 8, 8, 3.2, ['w', 'n']),
  ...house(24, 9, 7, 7, 3.2, ['n']),
  ...house(10, 25, 7, 6, 3.2, ['w']),
  // Steps up to the roof of the second house.
  crate(29, 9, 2.4),
  crate(29, 10.8),
  car(5.5, 18, true, 0xd84343),
  car(18, 5.5, false, 0x3f7fd8),
  block('concrete', 20, 20, 3, 1, 0.6),
  block('metal', 30.5, 26, 2.4, 1.6, 1.4),
];

export const TOWN: MapDef = {
  id: 'town',
  name: 'Town',
  halfSize: 34,
  ground: 'town',
  boxes: [
    // Fountain in the central plaza.
    block('stone', 0, -2.25, 5, 0.8, 0.5),
    block('stone', 0, 2.25, 5, 0.8, 0.5),
    block('stone', -2.25, 0, 0.5, 0.8, 4),
    block('stone', 2.25, 0, 0.5, 0.8, 4),
    block('stone', 0, 0, 1, 2.2, 1),
    // Street cover.
    crate(0, 14),
    crate(0, -14),
    crate(14, 0),
    crate(-14, 0),
    ...quadrant.flatMap((box) => mirrored(box)),
  ],
  spawns: [
    { x: 20, z: 30, team: 1 },
    { x: -20, z: 30, team: 1 },
    { x: 8, z: 31, team: 1 },
    { x: -8, z: 31, team: 1 },
    { x: 20, z: -30, team: 2 },
    { x: -20, z: -30, team: 2 },
    { x: 8, z: -31, team: 2 },
    { x: -8, z: -31, team: 2 },
    ...mirrored({ x: 31, z: 18 }),
  ],
  loot: [...mirrored({ x: 11, z: 11 }), ...mirrored({ x: 24, y: 3.5, z: 9 }), { x: 0, y: 2.2, z: 0 }],
  vehicles: [
    { x: 0, z: 24, yaw: 0 },
    { x: 0, z: -24, yaw: Math.PI },
  ],
  flags: [
    { team: 1, x: 0, z: 29 },
    { team: 2, x: 0, z: -29 },
  ],
};
