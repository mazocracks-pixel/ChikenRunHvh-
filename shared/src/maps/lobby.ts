import { block, crate, type MapBox, type MapDef } from './types';
import { hut } from './night';

/**
 * Courtyard: the title screen's own map (no game mode uses it, so nobody can pick it). A wide
 * sandy yard with a sandstone house, a wooden pergola, green hedges and a few palms round the
 * edge, so the chicken running its lap in the middle has something nice behind it.
 */

const HEDGE = 0x3f8f3f;
const hedge = (x: number, z: number, w: number, d: number): MapBox => ({ kind: 'metal', x, z, w, h: 2.2, d, color: HEDGE });

/** A stylised palm: a wooden trunk with a flat green crown. */
function palm(x: number, z: number): MapBox[] {
  return [block('wood', x, z, 0.5, 4, 0.5), { kind: 'metal', x, y: 4, z, w: 3.4, h: 0.5, d: 3.4, color: 0x2f7d32 }];
}

/** A pergola: four posts with wooden slats across the top. */
function pergola(cx: number, cz: number): MapBox[] {
  const out: MapBox[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(block('wood', cx + sx * 2.8, cz + sz * 1.9, 0.35, 2.6, 0.35));
  for (let i = -3; i <= 3; i++) out.push(block('wood', cx + i * 0.85, cz, 0.3, 0.2, 4.6, 2.6));
  return out;
}

const BOXES: MapBox[] = [
  // The house on the west side, its door facing the yard.
  ...hut(-17, -3, 11, 8, 4.4, ['e'], 'sandstone'),
  // A long sandstone wall behind everything on the north side.
  block('sandstone', 0, -23, 36, 3.2, 0.8),
  ...pergola(15, 9),
  // Green hedges along the east and south edges.
  hedge(23.5, 0, 1.4, 34),
  hedge(0, 23.5, 34, 1.4),
  ...palm(11, -14),
  ...palm(-7, 16),
  ...palm(19, -8),
  crate(-9, 5),
  crate(-9, 6.2),
  crate(-7.8, 5),
];

const HALF = 26;

export const LOBBY: MapDef = {
  id: 'lobby',
  name: 'Courtyard',
  halfSize: HALF,
  ground: 'sand',
  boxes: BOXES,
  // Never used by a mode, but a map needs somewhere to stand.
  spawns: [
    { x: 0, z: 8 },
    { x: 5, z: 6 },
    { x: -5, z: 6 },
    { x: 0, z: -8 },
    { x: 5, z: -6 },
    { x: -5, z: -6 },
  ],
  loot: [],
  vehicles: [],
  flags: [],
};
