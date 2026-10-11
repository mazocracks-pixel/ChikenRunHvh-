import { BACKROOMS_LEVEL } from '../events';
import { mulberry32 } from '../rng';
import type { BoxKind, MapBox, MapLamp, MapZone, ZoneId } from './types';

/**
 * Event levels (Crystal Hunt): mazes generated from a seed, so the server and every client
 * build exactly the same walls. Each one is a sealed area of the map, outside the playable
 * part, with a ceiling, its own lights and its own waypoints.
 *
 * The maze: a recursive backtracker, then some walls knocked out for loops. On top of that
 * (all optional): big halls with pillars, long straight hallways, a ring hallway that loops,
 * a flooded section, a "wrong" room in another light, and holes in the ceiling.
 */
export interface ZoneSpec {
  id: ZoneId;
  name: string;
  /** The level's north-west corner, rooms across (X) and down (Z), and the room size. */
  minX: number;
  minZ: number;
  gridWidth: number;
  gridHeight: number;
  roomSize: number;
  wallHeight: number;
  wallKind: BoxKind;
  wallColor: number;
  ceilingColor: number;
  floorColor: number;
  seed: number;
  /** Share of the remaining walls knocked out after the maze is carved (loops). */
  extraOpen: number;
  /** Openings are a doorway this wide in the wall (null: the whole wall goes). */
  doorway: number | null;
  /** A light every `lampEvery` rooms (checkerboard), in this colour; `panel` = ceiling panel. */
  lampEvery: number;
  lampColor: number;
  panel: boolean;
  flicker: 'fluorescent' | 'none';
  /** Crate piles in some rooms (places to hide behind). */
  props: number;
  /** Big open halls with pillars (how many, rooms per side). */
  halls?: { count: number; size: number };
  /** Long straight hallways cut through the maze. */
  hallways?: number;
  /** A ring hallway you can run round (rooms wide and deep). */
  loop?: { w: number; h: number };
  /** A flooded block of rooms. */
  flood?: { w: number; h: number };
  /** A block of rooms in another light. */
  wrongRoom?: { w: number; h: number; color: number };
  /** Rooms with a hole in the ceiling (monkeys wait above). */
  ceilingGaps?: number;
  look: MapZone['look'];
}

const WALL = 0.4;

export interface BuiltZone {
  zone: MapZone;
  boxes: MapBox[];
  lamps: MapLamp[];
  nav: { x: number; z: number }[];
}

type Rect = { i: number; j: number; w: number; h: number };

export function buildZone(spec: ZoneSpec): BuiltZone {
  const nx = spec.gridWidth;
  const nz = spec.gridHeight;
  const c = spec.roomSize;
  const rand = mulberry32(spec.seed);
  const x0 = spec.minX;
  const z0 = spec.minZ;
  const centre = (i: number, j: number) => ({ x: x0 + (i + 0.5) * c, z: z0 + (j + 0.5) * c });
  const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

  // Walls between rooms: east[i][j] between (i,j) and (i+1,j); south[i][j] between (i,j) and (i,j+1).
  const east = Array.from({ length: nx }, () => Array<boolean>(nz).fill(true));
  const south = Array.from({ length: nx }, () => Array<boolean>(nz).fill(true));
  // 1. Carve a maze (recursive backtracker, from the entrance corner).
  const seen = Array.from({ length: nx }, () => Array<boolean>(nz).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0]![0] = true;
  while (stack.length > 0) {
    const [i, j] = stack[stack.length - 1]!;
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
      .map(([di, dj]) => [i + di, j + dj] as const)
      .filter(([a, b]) => a >= 0 && b >= 0 && a < nx && b < nz && !seen[a]![b]);
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
  // 2. Knock out some more walls: loops, so you can be cut off from either side.
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (i < nx - 1 && east[i]![j] && rand() < spec.extraOpen) east[i]![j] = false;
      if (j < nz - 1 && south[i]![j] && rand() < spec.extraOpen) south[i]![j] = false;
    }
  }
  // Blocks of rooms for the special places: inside the edge rooms, never touching each other.
  const taken: Rect[] = [];
  const overlaps = (a: Rect, b: Rect) => a.i < b.i + b.w + 1 && b.i < a.i + a.w + 1 && a.j < b.j + b.h + 1 && b.j < a.j + a.h + 1;
  const place = (w: number, h: number): Rect | null => {
    if (w > nx - 2 || h > nz - 2) return null;
    for (let tries = 0; tries < 80; tries++) {
      const r = { i: randInt(1, nx - w - 1), j: randInt(1, nz - h - 1), w, h };
      if (taken.some((t) => overlaps(t, r))) continue;
      taken.push(r);
      return r;
    }
    return null;
  };
  const openBlock = (r: Rect) => {
    for (let i = r.i; i < r.i + r.w; i++) {
      for (let j = r.j; j < r.j + r.h; j++) {
        if (i < r.i + r.w - 1) east[i]![j] = false;
        if (j < r.j + r.h - 1) south[i]![j] = false;
      }
    }
  };
  const inRect = (r: Rect | null, i: number, j: number) => r !== null && i >= r.i && i < r.i + r.w && j >= r.j && j < r.j + r.h;

  // 3. Big halls: a block of rooms opened into one, with pillars where the inner corners were.
  const pillars: { x: number; z: number }[] = [];
  const halls: Rect[] = [];
  for (let k = 0; k < (spec.halls?.count ?? 0); k++) {
    const s = spec.halls!.size;
    const r = place(s, s);
    if (!r) continue;
    halls.push(r);
    openBlock(r);
    for (let a = 1; a < s; a++) for (let b = 1; b < s; b++) pillars.push({ x: x0 + (r.i + a) * c, z: z0 + (r.j + b) * c });
  }
  // 4. Long straight hallways, across and down in turn (never through a hall's pillars).
  for (let k = 0; k < (spec.hallways ?? 0); k++) {
    if (k % 2 === 0) {
      const j = randInt(1, nz - 2);
      const len = randInt(Math.floor(nx / 2), nx - 2);
      const i0 = randInt(0, nx - 1 - len);
      for (let i = i0; i < i0 + len; i++) if (!halls.some((r) => inRect(r, i, j) || inRect(r, i + 1, j))) east[i]![j] = false;
    } else {
      const i = randInt(1, nx - 2);
      const len = randInt(Math.floor(nz / 2), nz - 2);
      const j0 = randInt(0, nz - 1 - len);
      for (let j = j0; j < j0 + len; j++) if (!halls.some((r) => inRect(r, i, j) || inRect(r, i, j + 1))) south[i]![j] = false;
    }
  }
  // 5. A ring hallway: follow the edge of a block of rooms and you come back where you started.
  const loop = spec.loop ? place(spec.loop.w, spec.loop.h) : null;
  if (loop) {
    const { i, j, w, h } = loop;
    for (let a = i; a < i + w - 1; a++) {
      east[a]![j] = false;
      east[a]![j + h - 1] = false;
    }
    for (let b = j; b < j + h - 1; b++) {
      south[i]![b] = false;
      south[i + w - 1]![b] = false;
    }
  }
  // 6. The flooded section and the wrong room, each opened into one place.
  const flood = spec.flood ? place(spec.flood.w, spec.flood.h) : null;
  if (flood) openBlock(flood);
  const wrong = spec.wrongRoom ? place(spec.wrongRoom.w, spec.wrongRoom.h) : null;
  if (wrong) openBlock(wrong);

  // 7. Walls. Lines along X run the full room width (closed neighbours merged into one long
  // wall); lines along Z stop half a wall short, so walls only touch, never overlap.
  const boxes: MapBox[] = [];
  const wall = (x: number, z: number, w: number, d: number) => boxes.push({ kind: spec.wallKind, x, z, w, h: spec.wallHeight, d, color: spec.wallColor });
  const doorPieces = (a: number, b: number, at: (from: number, to: number) => void) => {
    const mid = (a + b) / 2;
    const g = spec.doorway! / 2;
    at(a, mid - g);
    at(mid + g, b);
  };
  for (let j = 0; j <= nz; j++) {
    const z = z0 + j * c;
    let run = -1;
    const flush = (end: number) => {
      if (run >= 0) wall(x0 + ((run + end) / 2) * c, z, (end - run) * c, WALL);
      run = -1;
    };
    for (let i = 0; i < nx; i++) {
      const open = j > 0 && j < nz && !south[i]![j - 1];
      if (!open) {
        if (run < 0) run = i;
        continue;
      }
      flush(i);
      if (spec.doorway !== null) doorPieces(x0 + i * c, x0 + (i + 1) * c, (a, b) => wall((a + b) / 2, z, b - a, WALL));
    }
    flush(nx);
  }
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * c;
    for (let j = 0; j < nz; j++) {
      const za = z0 + j * c + WALL / 2;
      const zb = z0 + (j + 1) * c - WALL / 2;
      const open = i > 0 && i < nx && !east[i - 1]![j];
      if (!open) wall(x, (za + zb) / 2, WALL, zb - za);
      else if (spec.doorway !== null) doorPieces(za, zb, (a, b) => wall(x, (a + b) / 2, WALL, b - a));
    }
  }
  for (const p of pillars) boxes.push({ kind: spec.wallKind, x: p.x, z: p.z, w: 0.8, h: spec.wallHeight, d: 0.8, color: spec.wallColor });

  // 8. Holes in the ceiling (never in a hall, the entrance or the exit), then the ceiling in
  // rows round them.
  const gaps = new Set<number>();
  for (let k = 0, tries = 0; k < (spec.ceilingGaps ?? 0) && tries < 300; tries++) {
    const i = randInt(1, nx - 2);
    const j = randInt(1, nz - 2);
    if (gaps.has(i * nz + j) || halls.some((r) => inRect(r, i, j))) continue;
    gaps.add(i * nz + j);
    k++;
  }
  for (let j = 0; j < nz; j++) {
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      const solid = i < nx && !gaps.has(i * nz + j);
      if (solid && run < 0) run = i;
      if (!solid && run >= 0) {
        boxes.push({ kind: 'roof', x: x0 + ((run + i) / 2) * c, z: z0 + (j + 0.5) * c, y: spec.wallHeight, w: (i - run) * c, h: 0.3, d: c, color: spec.ceilingColor });
        run = -1;
      }
    }
  }

  // Rooms, dead ends (good hiding spots), the entrance and the exit (the far corner).
  const cells: { x: number; z: number }[] = [];
  const corners: { x: number; z: number }[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      cells.push(centre(i, j));
      const walls = (i === 0 || east[i - 1]![j] ? 1 : 0) + (i === nx - 1 || east[i]![j] ? 1 : 0) + (j === 0 || south[i]![j - 1] ? 1 : 0) + (j === nz - 1 || south[i]![j] ? 1 : 0);
      if (walls >= 3 && (i > 0 || j > 0)) corners.push(centre(i, j));
    }
  }

  // Crate piles against a wall in some rooms (cover, places to lurk).
  const used = new Set<number>();
  for (let k = 0; k < spec.props; k++) {
    const i = randInt(1, nx - 1);
    const j = randInt(1, nz - 1);
    if (used.has(i * nz + j)) continue;
    used.add(i * nz + j);
    const p = centre(i, j);
    const ox = (rand() < 0.5 ? -1 : 1) * (c / 2 - 1.2);
    boxes.push({ kind: 'crate', x: p.x + ox, z: p.z - c / 2 + 1.2, w: 1.2, h: 1.2, d: 1.2 }, { kind: 'crate', x: p.x + ox, z: p.z - c / 2 + 1.2, y: 1.2, w: 1, h: 1, d: 1 });
  }

  // Lights on a checkerboard (every room of a hall), none where the ceiling is open; the wrong
  // room glows in its own colour.
  const lamps: MapLamp[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (gaps.has(i * nz + j)) continue;
      const hall = halls.some((r) => inRect(r, i, j));
      if (!hall && (i + j) % spec.lampEvery !== 0) continue;
      const p = centre(i, j);
      const color = inRect(wrong, i, j) ? spec.wrongRoom!.color : spec.lampColor;
      lamps.push({ x: p.x, y: spec.wallHeight - 0.05, z: p.z, color, panel: spec.panel, flicker: spec.flicker === 'fluorescent' });
    }
  }

  const rect = (r: Rect | null) => (r ? { minX: x0 + r.i * c, maxX: x0 + (r.i + r.w) * c, minZ: z0 + r.j * c, maxZ: z0 + (r.j + r.h) * c } : null);
  const zone: MapZone = {
    id: spec.id,
    name: spec.name,
    minX: x0,
    maxX: x0 + nx * c,
    minZ: z0,
    maxZ: z0 + nz * c,
    floorColor: spec.floorColor,
    start: centre(0, 0),
    exit: centre(nx - 1, nz - 1),
    cells,
    corners,
    roomSize: c,
    gaps: [...gaps].map((k) => centre(Math.floor(k / nz), k % nz)),
    flood: rect(flood),
    look: spec.look,
  };
  return { zone, boxes, lamps, nav: cells };
}

/** Wave 7: the Backrooms. Endless damp yellow rooms under buzzing fluorescent panels. */
export const BACKROOMS_SPEC: ZoneSpec = {
  id: 'backrooms',
  name: 'The Backrooms',
  // East of the graveyard, ending 8 m north of the map's middle line; the size is BACKROOMS_LEVEL.
  minX: 100,
  minZ: -8 - BACKROOMS_LEVEL.gridHeight * BACKROOMS_LEVEL.roomSize,
  gridWidth: BACKROOMS_LEVEL.gridWidth,
  gridHeight: BACKROOMS_LEVEL.gridHeight,
  roomSize: BACKROOMS_LEVEL.roomSize,
  wallHeight: BACKROOMS_LEVEL.wallHeight,
  wallKind: 'sandstone',
  wallColor: 0xc8b660,
  ceilingColor: 0xcfc48e,
  floorColor: 0x7d6c34,
  seed: BACKROOMS_LEVEL.seed,
  extraOpen: BACKROOMS_LEVEL.extraOpen,
  doorway: null,
  lampEvery: 2,
  lampColor: 0xfff1b8,
  panel: true,
  flicker: 'fluorescent',
  props: 0,
  halls: BACKROOMS_LEVEL.halls,
  hallways: BACKROOMS_LEVEL.hallways,
  loop: BACKROOMS_LEVEL.loop,
  flood: BACKROOMS_LEVEL.flood,
  wrongRoom: BACKROOMS_LEVEL.wrongRoom,
  ceilingGaps: BACKROOMS_LEVEL.ceilingGaps,
  look: { horizon: '#2e2912', zenith: '#2e2912', fog: 0.17, ambient: 0.55, sunIntensity: 0, exposure: 1 },
};

/** Wave 10: the Phone Mission. An abandoned facility, nearly black, red emergency lights. */
export const FACILITY_SPEC: ZoneSpec = {
  id: 'facility',
  name: 'The Facility',
  minX: 100,
  minZ: 22,
  gridWidth: 6,
  gridHeight: 6,
  roomSize: 10,
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
