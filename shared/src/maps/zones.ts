import { mulberry32 } from '../rng';
import type { BoxKind, MapBox, MapLamp, MapZone, ZoneId } from './types';

/**
 * Event levels (Crystal Hunt): mazes generated from a seed, so the server and every client
 * build exactly the same walls. Each one is a sealed area of the map, outside the playable
 * part, with a ceiling, its own lights and its own waypoints.
 */
export interface ZoneSpec {
  id: ZoneId;
  name: string;
  /** Centre of the area, cells per side and the cell size (metres). */
  cx: number;
  cz: number;
  cells: number;
  cell: number;
  wallHeight: number;
  wallKind: BoxKind;
  wallColor: number;
  ceilingColor: number;
  floorColor: number;
  seed: number;
  /** Share of the remaining walls knocked out after the maze is carved (loops and bigger rooms). */
  extraOpen: number;
  /** Openings are a doorway this wide in the wall (null: the whole wall goes). */
  doorway: number | null;
  /** A light every `lampEvery` cells, in this colour; `panel` = a ceiling fluorescent panel. */
  lampEvery: number;
  lampColor: number;
  panel: boolean;
  flicker: 'fluorescent' | 'none';
  /** Crate piles in some rooms (places to hide behind). */
  props: number;
  look: MapZone['look'];
}

const WALL = 0.4;

export interface BuiltZone {
  zone: MapZone;
  boxes: MapBox[];
  lamps: MapLamp[];
  nav: { x: number; z: number }[];
}

export function buildZone(spec: ZoneSpec): BuiltZone {
  const n = spec.cells;
  const c = spec.cell;
  const rand = mulberry32(spec.seed);
  const x0 = spec.cx - (n * c) / 2;
  const z0 = spec.cz - (n * c) / 2;
  const centre = (i: number, j: number) => ({ x: x0 + (i + 0.5) * c, z: z0 + (j + 0.5) * c });

  // Walls between cells: east[i][j] between (i,j) and (i+1,j); south[i][j] between (i,j) and (i,j+1).
  const east = Array.from({ length: n }, () => Array<boolean>(n).fill(true));
  const south = Array.from({ length: n }, () => Array<boolean>(n).fill(true));
  // Carve a maze (depth-first, from the start corner).
  const seen = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0]![0] = true;
  while (stack.length > 0) {
    const [i, j] = stack[stack.length - 1]!;
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([di, dj]) => [i + di, j + dj] as const)
      .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && !seen[a]![b]);
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [a, b] = next[Math.floor(rand() * next.length)]!;
    if (a !== i) east[Math.min(a, i)]![j] = false;
    else south[i]![Math.min(b, j)] = false;
    seen[a]![b] = true;
    stack.push([a, b]);
  }
  // Knock out some more walls: loops, so you can be cut off from either side.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i < n - 1 && east[i]![j] && rand() < spec.extraOpen) east[i]![j] = false;
      if (j < n - 1 && south[i]![j] && rand() < spec.extraOpen) south[i]![j] = false;
    }
  }

  const boxes: MapBox[] = [];
  const wall = (x: number, z: number, w: number, d: number) => boxes.push({ kind: spec.wallKind, x, z, w, h: spec.wallHeight, d, color: spec.wallColor });
  // A wall along X at z, from xa to xb, with a doorway in the middle if it's open.
  const alongX = (xa: number, xb: number, z: number, open: boolean) => {
    if (!open) return wall((xa + xb) / 2, z, xb - xa, WALL);
    if (spec.doorway === null) return;
    const mid = (xa + xb) / 2;
    const g = spec.doorway / 2;
    wall((xa + mid - g) / 2, z, mid - g - xa, WALL);
    wall((mid + g + xb) / 2, z, xb - mid - g, WALL);
  };
  const alongZ = (x: number, za: number, zb: number, open: boolean) => {
    if (!open) return wall(x, (za + zb) / 2, WALL, zb - za);
    if (spec.doorway === null) return;
    const mid = (za + zb) / 2;
    const g = spec.doorway / 2;
    wall(x, (za + mid - g) / 2, WALL, mid - g - za);
    wall(x, (mid + g + zb) / 2, WALL, zb - mid - g);
  };
  // Lines along X (row edges, including the outer ones) run the full cell width; lines along Z
  // stop short of them by half a wall, so walls only touch, never overlap.
  for (let j = 0; j <= n; j++) {
    const z = z0 + j * c;
    for (let i = 0; i < n; i++) alongX(x0 + i * c, x0 + (i + 1) * c, z, j > 0 && j < n && !south[i]![j - 1]);
  }
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * c;
    for (let j = 0; j < n; j++) alongZ(x, z0 + j * c + WALL / 2, z0 + (j + 1) * c - WALL / 2, i > 0 && i < n && !east[i - 1]![j]);
  }
  // The ceiling.
  boxes.push({ kind: 'roof', x: spec.cx, z: spec.cz, y: spec.wallHeight, w: n * c, h: 0.3, d: n * c, color: spec.ceilingColor });

  // Cells, the dead ends (good hiding spots), the start and the exit (the farthest cell).
  const cells: { x: number; z: number }[] = [];
  const corners: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cells.push(centre(i, j));
      const walls = (i === 0 || east[i - 1]![j] ? 1 : 0) + (i === n - 1 || east[i]![j] ? 1 : 0) + (j === 0 || south[i]![j - 1] ? 1 : 0) + (j === n - 1 || south[i]![j] ? 1 : 0);
      if (walls >= 3 && (i > 0 || j > 0)) corners.push(centre(i, j));
    }
  }
  const start = centre(0, 0);
  const exit = centre(n - 1, n - 1);

  // Crate piles against a wall in some rooms (cover, places to lurk).
  const used = new Set<number>();
  for (let k = 0; k < spec.props; k++) {
    const i = 1 + Math.floor(rand() * (n - 1));
    const j = 1 + Math.floor(rand() * (n - 1));
    if (used.has(i * n + j)) continue;
    used.add(i * n + j);
    const p = centre(i, j);
    const ox = (rand() < 0.5 ? -1 : 1) * (c / 2 - 1.2);
    boxes.push({ kind: 'crate', x: p.x + ox, z: p.z - c / 2 + 1.2, w: 1.2, h: 1.2, d: 1.2 }, { kind: 'crate', x: p.x + ox, z: p.z - c / 2 + 1.2, y: 1.2, w: 1, h: 1, d: 1 });
  }

  const lamps: MapLamp[] = [];
  cells.forEach((p, k) => {
    const i = Math.floor(k / n);
    const j = k % n;
    if ((i + j) % spec.lampEvery === 0) lamps.push({ x: p.x, y: spec.wallHeight - 0.05, z: p.z, color: spec.lampColor, panel: spec.panel, flicker: spec.flicker === 'fluorescent' });
  });

  const zone: MapZone = {
    id: spec.id,
    name: spec.name,
    minX: x0,
    maxX: x0 + n * c,
    minZ: z0,
    maxZ: z0 + n * c,
    floorColor: spec.floorColor,
    start,
    exit,
    cells,
    corners,
    look: spec.look,
  };
  return { zone, boxes, lamps, nav: cells };
}

/** Wave 7: the Backrooms. Endless damp yellow rooms under buzzing fluorescent panels. */
export const BACKROOMS_SPEC: ZoneSpec = {
  id: 'backrooms',
  name: 'The Backrooms',
  cx: 130,
  cz: -42,
  cells: 8,
  cell: 6,
  wallHeight: 3,
  wallKind: 'sandstone',
  wallColor: 0xc8b660,
  ceilingColor: 0xcfc48e,
  floorColor: 0x7d6c34,
  seed: 707,
  extraOpen: 0.22,
  doorway: null,
  lampEvery: 2,
  lampColor: 0xfff1b8,
  panel: true,
  flicker: 'fluorescent',
  props: 0,
  look: { horizon: '#2e2912', zenith: '#2e2912', fog: 0.17, ambient: 0.55, sunIntensity: 0, exposure: 1 },
};

/** Wave 10: the Phone Mission. An abandoned facility, nearly black, red emergency lights. */
export const FACILITY_SPEC: ZoneSpec = {
  id: 'facility',
  name: 'The Facility',
  cx: 130,
  cz: 52,
  cells: 6,
  cell: 10,
  wallHeight: 3.6,
  wallKind: 'concrete',
  wallColor: 0x4a4e55,
  ceilingColor: 0x2b2e33,
  floorColor: 0x2a2c30,
  seed: 1010,
  extraOpen: 0.3,
  doorway: 2.4,
  lampEvery: 2,
  lampColor: 0xff2a1a,
  panel: false,
  flicker: 'none',
  props: 9,
  look: { horizon: '#07080c', zenith: '#07080c', fog: 0.14, ambient: 0.28, sunIntensity: 0, exposure: 1.05 },
};
