import { block, crate, type MapBox, type MapDef } from './types';

/**
 * Factory: a warehouse floor for close fights (Arms Race, Knife Fight, Duel). Tall walls all
 * round, heavy machines in the middle, conveyor belts, crate stacks, and a raised catwalk along
 * the north and south walls with jump-up steps at one end of each. North is -Z.
 */

const HALF = 30;
const MACHINE = 0x5c6670;

/** Three 1 m steps up to a catwalk at 3.5 m (each a jump up). `dir` +1 climbs east, -1 west. */
function steps(x: number, z: number, dir: 1 | -1): MapBox[] {
  return [1.1, 2.2, 3.3].map((top, i) => block('concrete', x + dir * i * 1.5, z, 1.5, top, 2));
}

const WALLS: MapBox[] = [
  block('concrete', 0, -HALF + 0.5, HALF * 2, 10, 1),
  block('concrete', 0, HALF - 0.5, HALF * 2, 10, 1),
  block('concrete', -HALF + 0.5, 0, 1, 10, HALF * 2 - 2),
  block('concrete', HALF - 0.5, 0, 1, 10, HALF * 2 - 2),
];

const FLOOR: MapBox[] = [
  // Heavy machinery in the middle, and two presses beside it.
  { kind: 'metal', x: 0, z: 0, w: 6, h: 4, d: 4, color: MACHINE },
  { kind: 'metal', x: 0, z: 0, w: 2, h: 2, d: 2, y: 4, color: 0xd2a22a },
  { kind: 'metal', x: -10, z: 0, w: 3, h: 5, d: 3, color: MACHINE },
  { kind: 'metal', x: 10, z: 0, w: 3, h: 5, d: 3, color: MACHINE },
  // Conveyor belts (low enough to jump over).
  { kind: 'metal', x: -18, z: 0, w: 1.2, h: 0.9, d: 16, color: 0x2f3236 },
  { kind: 'metal', x: 18, z: 0, w: 1.2, h: 0.9, d: 16, color: 0x2f3236 },
  // Crate stacks.
  crate(-6, -12),
  crate(-4.8, -12),
  crate(-5.4, -12, 1.2, 1.2),
  crate(6, 12),
  crate(4.8, 12),
  crate(5.4, 12, 1.2, 1.2),
  crate(-14, 13),
  crate(14, -13),
  crate(-22, -8),
  crate(22, 8),
  block('wood', -8, 8, 2.4, 1.2, 1.2),
  block('wood', 8, -8, 2.4, 1.2, 1.2),
  // Catwalks: north (steps up at the west end) and south (steps up at the east end).
  ...steps(-24, -26, 1),
  // Each catwalk starts right where its top step ends (x = ±20.25) and runs to the far wall.
  block('concrete', 3.375, -26, 47.25, 0.3, 2, 3.5),
  ...steps(24, 26, -1),
  block('concrete', -3.375, 26, 47.25, 0.3, 2, 3.5),
  // Railings along the catwalks (cover for the people up there).
  block('metal', 3.375, -25.05, 47.25, 1, 0.1, 3.8),
  block('metal', -3.375, 25.05, 47.25, 1, 0.1, 3.8),
];

export const FACTORY: MapDef = {
  id: 'factory',
  name: 'Factory',
  halfSize: HALF,
  ground: 'factory',
  boxes: [...WALLS, ...FLOOR],
  spawns: [
    { x: -26, z: -14, team: 1 },
    { x: -26, z: -4, team: 1 },
    { x: -26, z: 4, team: 1 },
    { x: -26, z: 14, team: 1 },
    { x: -22, z: 18, team: 1 },
    { x: 26, z: -14, team: 2 },
    { x: 26, z: -4, team: 2 },
    { x: 26, z: 4, team: 2 },
    { x: 26, z: 14, team: 2 },
    { x: 22, z: -18, team: 2 },
    { x: -12, z: -20 },
    { x: 12, z: 20 },
  ],
  loot: [
    { x: 0, z: -12 },
    { x: 0, z: 12 },
    { x: 0, y: 3.8, z: -26 },
    { x: 0, y: 3.8, z: 26 },
  ],
  vehicles: [],
  flags: [],
};
