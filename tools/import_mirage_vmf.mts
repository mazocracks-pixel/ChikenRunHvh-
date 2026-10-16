/**
 * Rebuilds Mirage's collision from the map's Hammer source (a BSPSource decompile, de_mirage_d.vmf).
 * The first import took collision from the compiled map and kept only the 16-unit cells lying
 * fully inside each brush, so thin diagonal walls came out with holes, and player clips were solid
 * to bullets. From the source brushes instead:
 *   - an axis-aligned brush is one exact box;
 *   - a slanted brush becomes the 8-unit cells whose centres it holds, and a displacement
 *     (terrain, curved walls) every cell its surface passes through, merged into as few boxes as
 *     possible;
 *   - tools/toolsclip and tools/toolsplayerclip brushes are player clips (bullets and sight pass).
 * Props aren't in the source (only their names), so the old boxes that no brush explains are kept:
 * that's the prop collision. Spawns and navigation stay as they were.
 *
 *   npx tsx tools/import_mirage_vmf.mts path/to/de_mirage_d.vmf
 *   npx tsx tools/prepare_mirage.ts       (settles spawns and navigation on the new collision)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CollisionWorld } from '../shared/src/collision';
import { boxToAabb, type MapBox } from '../shared/src/maps/types';
import { BASE, SCALE, add, brush, displacement, dot, get, parse, scale, solids as allSolids, sub, type Brush, type V } from './vmf.mts';

/** Voxel size in Source units: across and up (the same 0.2 m steps as the first import). */
const CX = 8;
const CY = 8;

const solidCells = new Set<number>();
const clipCells = new Set<number>();
const key = (x: number, y: number, z: number) => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
const unkey = (k: number): V => [Math.floor(k / 4096 / 4096) - 2048, (Math.floor(k / 4096) % 4096) - 2048, (k % 4096) - 2048];

/**
 * Every cell whose centre is inside the brush, so a slanted face is off by half a cell at most
 * (counting every cell it touches made walls thick enough to close doorways). A brush thinner
 * than a cell still gets the cells nearest its middle, so no wall goes missing.
 */
function voxelBrush(b: Brush, into: Set<number>): void {
  const lo = [0, 1, 2].map((a) => Math.min(...b.verts.map((v) => v[a]!)));
  const hi = [0, 1, 2].map((a) => Math.max(...b.verts.map((v) => v[a]!)));
  const size = [CX, CX, CY];
  let hits = 0, nearest = Infinity, nearestKey = 0;
  for (let i = Math.floor(lo[0]! / CX); i < Math.ceil(hi[0]! / CX); i++)
    for (let j = Math.floor(lo[1]! / CX); j < Math.ceil(hi[1]! / CX); j++)
      for (let k = Math.floor(lo[2]! / CY); k < Math.ceil(hi[2]! / CY); k++) {
        const c: V = [(i + 0.5) * size[0]!, (j + 0.5) * size[1]!, (k + 0.5) * size[2]!];
        const out = Math.max(...b.planes.map((p) => dot(p.n, c) - p.d));
        if (out < 0.5) { into.add(key(i, j, k)); hits++; }
        else if (out < nearest) { nearest = out; nearestKey = key(i, j, k); }
      }
  if (hits === 0 && nearest < Infinity) into.add(nearestKey);
}

/** Marks every cell a triangle passes through (sampled finer than a cell). */
function voxelTriangle(a: V, b: V, c: V, into: Set<number>): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, b)), Math.hypot(...sub(a, c))) / (CY / 2)));
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
    const p = add(a, scale(sub(b, a), i / steps), scale(sub(c, a), j / steps));
    into.add(key(Math.floor(p[0] / CX), Math.floor(p[1] / CX), Math.floor(p[2] / CY)));
  }
}

// Not func_breakable: Mirage's are boards that break in one hit (no breakables here).
const ENTITY_SOLIDS = new Set(['func_detail', 'func_brush']);
const SKIP = /^tools\/tools(trigger|hint|skip|areaportal|occluder|skybox|fog|npcclip)/;
const CLIP = /^tools\/tools(player)?clip$/;

const vmf = parse(readFileSync(process.argv[2]!, 'utf8'));
const exact: { box: [V, V]; clip: boolean }[] = [];
const dispGrids: V[][][] = [];
let brushes = 0, slanted = 0, skipped = 0;
const solids = allSolids(vmf)
  .filter(({ cls, entity }) => cls === 'world' || (ENTITY_SOLIDS.has(cls) && !(cls === 'func_brush' && get(entity!, 'Solidity') === '1')))
  .map(({ solid }) => solid);
for (const solid of solids) {
  const b = brush(solid);
  if (!b) { skipped++; continue; }
  const disps = b.planes.filter((p) => p.side.kids.some((k) => k.name === 'dispinfo'));
  if (disps.length) {
    // A brush with a displacement isn't solid itself: only the displaced surface is.
    for (const p of disps) dispGrids.push(displacement(b, p, p.side.kids.find((k) => k.name === 'dispinfo')!));
    continue;
  }
  const mats = b.planes.map((p) => p.material);
  if (mats.some((m) => SKIP.test(m))) { skipped++; continue; }
  const clip = mats.every((m) => CLIP.test(m));
  brushes++;
  if (b.planes.every((p) => p.n.filter((x) => Math.abs(x) > 1e-6).length === 1)) {
    const lo = [0, 1, 2].map((a) => Math.min(...b.verts.map((v) => v[a]!))) as V;
    const hi = [0, 1, 2].map((a) => Math.max(...b.verts.map((v) => v[a]!))) as V;
    exact.push({ box: [lo, hi], clip });
  } else {
    slanted++;
    voxelBrush(b, clip ? clipCells : solidCells);
  }
}
for (const grid of dispGrids) for (let i = 0; i + 1 < grid.length; i++) for (let j = 0; j + 1 < grid.length; j++) {
  voxelTriangle(grid[i]![j]!, grid[i + 1]![j]!, grid[i + 1]![j + 1]!, solidCells);
  voxelTriangle(grid[i]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!, solidCells);
}

/** Cells merged into boxes: rectangles per layer, then equal rectangles stacked. */
function merge(cells: Set<number>): [V, V][] {
  const layers = new Map<number, Set<string>>();
  for (const k of cells) {
    const [i, j, l] = unkey(k);
    (layers.get(l) ?? layers.set(l, new Set()).get(l)!).add(`${i},${j}`);
  }
  const rects = new Map<string, number[]>();
  for (const [l, layer] of layers) {
    const sorted = [...layer].map((s) => s.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const used = new Set<string>();
    for (const [i0, j0] of sorted) {
      if (used.has(`${i0},${j0}`)) continue;
      let i1 = i0;
      while (layer.has(`${i1 + 1},${j0}`) && !used.has(`${i1 + 1},${j0}`)) i1++;
      let j1 = j0;
      for (;;) {
        let ok = true;
        for (let i = i0; i <= i1 && ok; i++) ok = layer.has(`${i},${j1 + 1}`) && !used.has(`${i},${j1 + 1}`);
        if (!ok) break;
        j1++;
      }
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) used.add(`${i},${j}`);
      const r = `${i0},${i1},${j0},${j1}`;
      (rects.get(r) ?? rects.set(r, []).get(r)!).push(l);
    }
  }
  const out: [V, V][] = [];
  for (const [r, ls] of rects) {
    const [i0, i1, j0, j1] = r.split(',').map(Number) as [number, number, number, number];
    ls.sort((a, b) => a - b);
    for (let s = 0; s < ls.length;) {
      let e = s;
      while (e + 1 < ls.length && ls[e + 1] === ls[e]! + 1) e++;
      out.push([[i0 * CX, j0 * CX, ls[s]! * CY], [(i1 + 1) * CX, (j1 + 1) * CX, (ls[e]! + 1) * CY]]);
      s = e + 1;
    }
  }
  return out;
}

const r = (v: number) => Math.round(v * 1000) / 1000;
/** Source box (x right, y forward, z up) to a game box (y up, z = -Source y). */
const toBox = ([lo, hi]: [V, V], clip: boolean): MapBox => ({
  kind: 'sandstone', x: r((lo[0] + hi[0]) / 2 * SCALE), y: r((lo[2] - BASE) * SCALE), z: r(-(lo[1] + hi[1]) / 2 * SCALE),
  w: r((hi[0] - lo[0]) * SCALE), h: r((hi[2] - lo[2]) * SCALE), d: r((hi[1] - lo[1]) * SCALE), visible: false, ...(clip ? { clip: true } : {}),
});
const boxes: MapBox[] = [
  ...exact.map((e) => toBox(e.box, e.clip)),
  ...merge(solidCells).map((b) => toBox(b, false)),
  ...merge(clipCells).map((b) => toBox(b, true)),
];

// Keep the old boxes no brush explains (prop collision): any sample point outside the new boxes.
const dataPath = new URL('../shared/src/maps/mirage-data.json', import.meta.url);
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as { boxes: MapBox[] };
const world = new CollisionWorld(200, boxes.map(boxToAabb));
const near: ReturnType<typeof boxToAabb>[] = [];
const covered = (x: number, y: number, z: number) => {
  world.query(x, z, x, z, near);
  return near.some((b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ);
};
const props = data.boxes.filter((box) => {
  const a = boxToAabb(box);
  for (let x = a.minX + 0.05; x < a.maxX; x += 0.1) for (let y = a.minY + 0.05; y < a.maxY; y += 0.1) for (let z = a.minZ + 0.05; z < a.maxZ; z += 0.1) if (!covered(x, y, z)) return true;
  return false;
});
console.log(`exact ${exact.length}, solid voxels ${merge(solidCells).length}, clip voxels ${merge(clipCells).length}`);
console.log(`${brushes} brushes (${slanted} slanted), ${skipped} skipped, ${dispGrids.length} displacements -> ${boxes.length} boxes (${boxes.filter((b) => b.clip).length} clips); kept ${props.length} of ${data.boxes.length} old boxes as props`);
data.boxes = [...boxes, ...props];
writeFileSync(dataPath, JSON.stringify(data));
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(dispGrids.map((g) => g.flat().map((p) => [p[0] * SCALE, (p[2] - BASE) * SCALE, -p[1] * SCALE]))));
