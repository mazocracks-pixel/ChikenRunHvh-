import { block, crate, mirrored, type MapDef } from './types';

export const FARM: MapDef = {
  id: 'farm',
  name: 'Farmyard',
  halfSize: 30,
  ground: 'grass',
  boxes: [
    // Central tower, reachable by hopping up the crates on either side.
    block('stone', 0, 0, 6, 2.4, 6),
    crate(3.6, 0),
    crate(-3.6, 0),
    crate(0, 3.6),
    crate(0, -3.6),

    // Cover walls: too tall to jump over.
    block('stone', 12, 0, 1, 1.8, 8),
    block('stone', -12, 0, 1, 1.8, 8),
    block('stone', 0, 12, 8, 1.8, 1),
    block('stone', 0, -12, 8, 1.8, 1),

    // Hay bales between the tower and the corners.
    ...mirrored(block('hay', 8, 7, 2.4, 1.2, 1.2)),
    ...mirrored(block('hay', 7, 16, 1.2, 1.2, 2.4)),

    // Corner lookouts: a tall crate with a step crate beside it.
    ...mirrored(crate(21, 21, 2.4)),
    ...mirrored(crate(19.2, 21.6)),

    // Crates on the side lanes.
    crate(22, 0),
    crate(-22, 0),
    crate(0, 22),
    crate(0, -22),
    crate(22, 1.2),
    crate(-22, -1.2),
  ],
  // Red spawns on the +Z half, blue on the -Z half; free-for-all uses all of them.
  spawns: [...mirrored({ x: 25, z: 25 }), ...mirrored({ x: 25, z: 10 }), ...mirrored({ x: 10, z: 25 })].map((p) => ({
    ...p,
    team: p.z > 0 ? (1 as const) : (2 as const),
  })),
  loot: [
    { x: 0, y: 2.4, z: 0 },
    { x: 16, z: 0 },
    { x: -16, z: 0 },
    { x: 0, z: 16 },
    { x: 0, z: -16 },
    ...mirrored({ x: 21, y: 2.4, z: 21 }),
  ],
  vehicles: [
    { x: 26, z: 0, yaw: 0 },
    { x: -26, z: 0, yaw: Math.PI },
  ],
  flags: [
    { team: 1, x: 0, z: 26 },
    { team: 2, x: 0, z: -26 },
  ],
};
