/** Reading a Hammer source map (.vmf): brushes, their faces and displacements. Used by the Mirage tools. */

/** Mirage's import scale: 40 Source units per metre, Source Z=-400 at ground zero. */
export const SCALE = 0.025;
export const BASE = -400;

export type V = [number, number, number];
export type Node = { name: string; kv: [string, string][]; kids: Node[] };

export function parse(text: string): Node {
  const root: Node = { name: 'root', kv: [], kids: [] };
  const stack = [root];
  let pending = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '{') {
      const node: Node = { name: pending, kv: [], kids: [] };
      stack.at(-1)!.kids.push(node);
      stack.push(node);
    } else if (line === '}') stack.pop();
    else if (line.startsWith('"')) {
      const m = /^"([^"]*)"\s+"([^"]*)"/.exec(line);
      if (m) stack.at(-1)!.kv.push([m[1]!, m[2]!]);
    } else pending = line;
  }
  return root;
}
export const get = (n: Node, key: string) => n.kv.find(([k]) => k === key)?.[1];
export const nums = (s: string) => s.match(/-?[\d.e+-]+/g)!.map(Number);

export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const add = (...vs: V[]): V => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
export const unit = (a: V): V => scale(a, 1 / Math.hypot(...a));
/** Source (x right, y forward, z up) to the game (y up, z = -Source y), in metres. */
export const toGame = (p: V): V => [p[0] * SCALE, (p[2] - BASE) * SCALE, -p[1] * SCALE];

export type Plane = { n: V; d: number; material: string; side: Node };
export type Brush = { planes: Plane[]; verts: V[] };

/** A brush's planes (normals out) and corners. */
export function brush(solid: Node): Brush | null {
  const sides = solid.kids.filter((k) => k.name === 'side');
  const raw = sides.map((side) => {
    const p = nums(get(side, 'plane')!);
    const a: V = [p[0]!, p[1]!, p[2]!], b: V = [p[3]!, p[4]!, p[5]!], c: V = [p[6]!, p[7]!, p[8]!];
    const n = unit(cross(sub(c, a), sub(b, a)));
    return { n, d: dot(n, a), material: get(side, 'material')!.toLowerCase(), side, pts: [a, b, c] };
  });
  const centre = scale(add(...raw.flatMap((r) => r.pts)), 1 / (raw.length * 3));
  // The decompiler's winding sets which way the normals face: make them face out.
  if (raw.filter((r) => dot(r.n, centre) - r.d > 0).length > raw.length / 2) for (const r of raw) { r.n = scale(r.n, -1); r.d = -r.d; }
  const planes = raw.map(({ n, d, material, side }) => ({ n, d, material, side }));
  const verts: V[] = [];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) for (let k = j + 1; k < planes.length; k++) {
    const [p, q, r] = [planes[i]!, planes[j]!, planes[k]!];
    const det = dot(p.n, cross(q.n, r.n));
    if (Math.abs(det) < 1e-9) continue;
    const v = scale(add(scale(cross(q.n, r.n), p.d), scale(cross(r.n, p.n), q.d), scale(cross(p.n, q.n), r.d)), 1 / det);
    if (planes.every((pl) => dot(pl.n, v) - pl.d < 0.01)) verts.push(v);
  }
  return verts.length >= 4 ? { planes, verts } : null;
}

/** A face's corners, clockwise seen from outside (Source's winding). */
export function faceCorners(b: Brush, plane: Plane): V[] {
  const corners: V[] = [];
  for (const v of b.verts) if (Math.abs(dot(plane.n, v) - plane.d) < 0.05 && !corners.some((c) => Math.hypot(...sub(c, v)) < 0.01)) corners.push(v);
  if (corners.length < 3) return corners;
  const mid = scale(add(...corners), 1 / corners.length);
  const u = unit(sub(corners[0]!, mid)), w = cross(plane.n, u);
  corners.sort((a, c) => Math.atan2(dot(sub(a, mid), w), dot(sub(a, mid), u)) - Math.atan2(dot(sub(c, mid), w), dot(sub(c, mid), u)));
  // Checked against the compiled map's model (median 1 mm off).
  return corners.reverse();
}

/** A displacement's surface points (rows × columns), as Source's compiler builds them. */
export function displacement(b: Brush, plane: Plane, disp: Node): V[][] {
  const corners = faceCorners(b, plane);
  const start = nums(get(disp, 'startposition')!) as V;
  const first = corners.reduce((best, v, i) => Math.hypot(...sub(v, start)) < Math.hypot(...sub(corners[best]!, start)) ? i : best, 0);
  const [p0, p1, p2, p3] = [0, 1, 2, 3].map((i) => corners[(first + i) % 4]!);
  const n = 2 ** Number(get(disp, 'power')!) + 1;
  const elevation = Number(get(disp, 'elevation') ?? 0);
  const rows = (name: string) => {
    const block = disp.kids.find((k) => k.name === name);
    return Array.from({ length: n }, (_, i) => block ? nums(get(block, `row${i}`)!) : []);
  };
  const normals = rows('normals'), distances = rows('distances'), offsets = rows('offsets');
  const grid: V[][] = [];
  for (let i = 0; i < n; i++) {
    const a = add(p0!, scale(sub(p1!, p0!), i / (n - 1)));
    const c = add(p3!, scale(sub(p2!, p3!), i / (n - 1)));
    grid.push(Array.from({ length: n }, (_, j) => {
      const nn: V = normals[i]!.length ? [normals[i]![j * 3]!, normals[i]![j * 3 + 1]!, normals[i]![j * 3 + 2]!] : [0, 0, 0];
      const off: V = offsets[i]!.length ? [offsets[i]![j * 3]!, offsets[i]![j * 3 + 1]!, offsets[i]![j * 3 + 2]!] : [0, 0, 0];
      return add(a, scale(sub(c, a), j / (n - 1)), scale(nn, distances[i]![j] ?? 0), off, scale(plane.n, elevation));
    }));
  }
  return grid;
}

/** Every brush in the world and in brush entities, with its entity's class ('world' for the world). */
export function solids(vmf: Node): { solid: Node; cls: string; entity: Node | null }[] {
  const out: { solid: Node; cls: string; entity: Node | null }[] = [];
  for (const top of vmf.kids) {
    if (top.name === 'world') for (const k of top.kids) if (k.name === 'solid') out.push({ solid: k, cls: 'world', entity: null });
    if (top.name === 'entity') for (const k of top.kids) if (k.name === 'solid') out.push({ solid: k, cls: get(top, 'classname')!, entity: top });
  }
  return out;
}
