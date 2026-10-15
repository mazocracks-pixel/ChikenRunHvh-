/**
 * Collision for the Mirage walls the importer left open. Its stepped collision for diagonal brushes
 * drops every 16-unit cell that pokes outside the brush, so thin diagonal walls lost all of it and
 * you could walk (and shoot) through them. This finds visible wall faces in reach of the walkways
 * with no collision within 0.6 m on either side, and fills them with thin box columns.
 *
 *   npx tsx tools/patch_mirage_walls.mts           writes shared/src/maps/mirage-walls.json
 *   npx tsx tools/patch_mirage_walls.mts --check   counts walks that still cross a visible wall
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MAPS, PLAYER, SIM_DT, boxToAabb, CollisionWorld, createMoveState, makeRay, raycastWorld, stepPlayer, walkable, type MapBox } from '@game/shared';

const CELL = 0.25;
const OUT = new URL('../shared/src/maps/mirage-walls.json', import.meta.url);
const check = process.argv.includes('--check');

const bytes = readFileSync(new URL('../client/public/maps/mirage.glb', import.meta.url));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .register(() => ({ name: 'NoTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
  .register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
gltf.scene.updateMatrixWorld(true);

const map = MAPS.mirage;
const patched = JSON.parse(readFileSync(OUT, 'utf8')) as MapBox[];
// Without the current patch when rebuilding it; with it when checking.
const boxes = check ? map.boxes : map.boxes.slice(0, map.boxes.length - patched.length);
const world = new CollisionWorld(map.halfSize, boxes.map(boxToAabb));
const nav = map.nav!.slice(0, map.navLinks!.length);
const navGrid = new Map<string, typeof nav>();
for (const p of nav) { const k = `${Math.floor(p.x / 4)},${Math.floor(p.z / 4)}`; (navGrid.get(k) ?? navGrid.set(k, []).get(k)!).push(p); }
const navNear = (x: number, z: number) => { const out: typeof nav = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(navGrid.get(`${Math.floor(x / 4) + i},${Math.floor(z / 4) + j}`) ?? [])); return out; };
const inReach = (x: number, y: number, z: number) => navNear(x, z).some((p) => Math.hypot(p.x - x, p.z - z) < 4 && y > (p.y ?? 0) - 0.3 && y < (p.y ?? 0) + 2.2);
const solidNear = (x: number, y: number, z: number, r: number) => world.query(x - r, z - r, x + r, z + r, []).some((b) => y > b.minY - r && y < b.maxY + r && x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);
const open = (p: THREE.Vector3, n: THREE.Vector3) => !solidNear(p.x, p.y, p.z, 0.25)
  && !raycastWorld(makeRay({ x: p.x - n.x * 0.6, y: p.y, z: p.z - n.z * 0.6 }, { x: n.x, y: 0, z: n.z }), world, 1.2);

// Every visible, roughly vertical face; skip see-through and decorative surfaces.
interface Face { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; n: THREE.Vector3 }
const faces: Face[] = [];
const m = new THREE.Matrix4(), M = new THREE.Matrix4();
gltf.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const mat = (Array.isArray(o.material) ? o.material[0] : o.material).name;
  if (/tools|glass|foliage|tree|leaf|branch|rail|fence|wire|cable|decal|overlay|puddle|sky|rug|cloth|vine|ivy|grass/i.test(mat)) return;
  const pos = o.geometry.getAttribute('position'), idx = o.geometry.index;
  const count = o instanceof THREE.InstancedMesh ? o.count : 1;
  for (let inst = 0; inst < count; inst++) {
    if (o instanceof THREE.InstancedMesh) { o.getMatrixAt(inst, m); M.multiplyMatrices(o.matrixWorld, m); } else M.copy(o.matrixWorld);
    for (let t = 0; t < (idx ? idx.count : pos.count) / 3; t++) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k).applyMatrix4(M));
      const n = new THREE.Vector3().subVectors(v[1]!, v[0]!).cross(new THREE.Vector3().subVectors(v[2]!, v[0]!));
      if (n.length() / 2 < 0.15) continue;
      n.normalize();
      if (Math.abs(n.y) > 0.35) continue;
      faces.push({ a: v[0]!, b: v[1]!, c: v[2]!, n });
    }
  }
});

/** Points over a face, about `step` apart. */
function samples(f: Face, step: number): THREE.Vector3[] {
  const size = Math.max(f.a.distanceTo(f.b), f.b.distanceTo(f.c), f.c.distanceTo(f.a));
  const k = Math.max(1, Math.ceil(size / step));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
    const u = (i + 0.3) / (k + 1), w = (j + 0.3) / (k + 1);
    if (u + w > 1) continue;
    out.push(new THREE.Vector3().copy(f.a).addScaledVector(new THREE.Vector3().subVectors(f.b, f.a), u).addScaledVector(new THREE.Vector3().subVectors(f.c, f.a), w));
  }
  return out;
}

if (check) {
  // Walk into every open face from the nearest walkway; crossing it means a hole.
  let holes = 0, tried = 0;
  for (const f of faces) {
    const p = samples(f, 1).find((q) => inReach(q.x, q.y, q.z) && open(q, f.n));
    // A walkway point inside the face's body room means Counter-Strike walks there: a passage.
    if (!p || nav.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < PLAYER.radius && Math.abs((q.y ?? 0) - p.y) < 2)) continue;
    const from = navNear(p.x, p.z).filter((q) => Math.abs((q.y ?? 0) - p.y) < 3).sort((q, r) => Math.hypot(q.x - p.x, q.z - p.z) - Math.hypot(r.x - p.x, r.z - p.z))[0];
    if (!from) continue;
    tried++;
    const s = createMoveState(from.x, (from.y ?? 0) + 0.05, from.z);
    const d = Math.hypot(p.x - from.x, p.z - from.z) || 1;
    const yaw = Math.atan2(-(p.x - from.x), -(p.z - from.z));
    for (let i = 0; i < Math.ceil((d + 2) / PLAYER.speed / SIM_DT); i++) stepPlayer(s, { seq: i, forward: 1, right: 0, jump: false, yaw, pitch: 0 }, SIM_DT, world);
    const dir = new THREE.Vector3(s.x - from.x, 0, s.z - from.z), len = dir.length();
    if (len < 0.3) continue;
    dir.normalize();
    const crossed = [0.4, 0.9].some((dy) => [from.y ?? 0, s.y].some((y) => {
      const hit = new THREE.Ray(new THREE.Vector3(from.x, y + dy, from.z), dir).intersectTriangle(f.a, f.b, f.c, false, new THREE.Vector3());
      return hit !== null && hit.distanceTo(new THREE.Vector3(from.x, y + dy, from.z)) < len - 0.3;
    }));
    if (crossed) { holes++; if (holes <= 20) console.log('hole', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)); }
  }
  console.log(`walks tried ${tried}, through a visible wall ${holes}`);
  process.exit(holes > 0 ? 1 : 0);
}

// Columns: each 0.25 m square the open faces pass through, from their lowest to highest point.
const columns = new Map<string, { cx: number; cz: number; lo: number; hi: number }>();
for (const f of faces) {
  const pts = samples(f, CELL / 2);
  if (!pts.some((p) => inReach(p.x, p.y, p.z) && open(p, f.n))) continue;
  for (const p of pts) {
    if (!open(p, f.n)) continue;
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL), key = `${cx},${cz}`;
    const c = columns.get(key);
    if (c) { c.lo = Math.min(c.lo, p.y); c.hi = Math.max(c.hi, p.y); } else columns.set(key, { cx, cz, lo: p.y, hi: p.y });
  }
}
// Never over a walkway or a spawn: no one may end up inside a new box.
const standing = [...nav, ...map.spawns];
// Boxes are trimmed by INSET a side, which keeps walls flush with walkway points standing 1 cm short.
const INSET = 0.02;
const BODY = PLAYER.radius + 0.005;
const clear = (c: { cx: number; cz: number; lo: number; hi: number }) => !standing.some((p) => {
  const x0 = c.cx * CELL + INSET - BODY, x1 = (c.cx + 1) * CELL - INSET + BODY, z0 = c.cz * CELL + INSET - BODY, z1 = (c.cz + 1) * CELL - INSET + BODY;
  return p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && c.lo < (p.y ?? 0) + 1.6 && c.hi > (p.y ?? 0) - 0.1;
});
const kept = [...columns.values()].filter((c) => c.hi - c.lo > 0.3 && clear(c)).map((c) => ({ ...c, lo: Math.round(c.lo * 10) / 10, hi: Math.round(c.hi * 10) / 10 }));
// Merge runs along X with the same Z and height.
kept.sort((a, b) => a.cz - b.cz || a.lo - b.lo || a.hi - b.hi || a.cx - b.cx);
const out: MapBox[] = [];
for (let i = 0; i < kept.length;) {
  const s = kept[i]!;
  let j = i + 1;
  while (j < kept.length && kept[j]!.cz === s.cz && kept[j]!.lo === s.lo && kept[j]!.hi === s.hi && kept[j]!.cx === kept[j - 1]!.cx + 1) j++;
  const w = (j - i) * CELL;
  out.push({ kind: 'sandstone', x: +(s.cx * CELL + w / 2).toFixed(3), y: s.lo, z: +((s.cz + 0.5) * CELL).toFixed(3), w: +(w - 2 * INSET).toFixed(3), h: +(s.hi - s.lo).toFixed(2), d: CELL - 2 * INSET, visible: false });
  i = j;
}
// Nav links that now clip a wall corner are dropped when the bot graph is built (nav.ts). Where
// one was the only way into an area, reopen the boxes on it, nearest first, until it walks again.
const links = map.navLinks!;
for (let round = 0; round < 50; round++) {
  const w = new CollisionWorld(map.halfSize, [...boxes, ...out].map(boxToAabb));
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of links[i]!) if (!seen.has(j) && walkable(nav[i]!, nav[j]!, w)) { seen.add(j); queue.push(j); }
  }
  if (seen.size === nav.length) break;
  // A cut link from the reached part into the rest: reopen it.
  let fixed = false;
  for (const i of seen) for (const j of links[i]!) {
    if (seen.has(j) || fixed) continue;
    const a = nav[i]!, b = nav[j]!;
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    const dist = (box: MapBox) => { const t = Math.max(0, Math.min(1, ((box.x - a.x) * dx + (box.z - a.z) * dz) / len2)); return Math.hypot(a.x + dx * t - box.x, a.z + dz * t - box.z); };
    const near = out.map((box, k) => ({ box, k, d: dist(box) })).filter((e) => e.d < Math.max(e.box.w, e.box.d) / 2 + PLAYER.radius + 0.2).sort((p, q) => p.d - q.d);
    if (!near.length) continue;
    const drop = new Set<number>();
    for (const e of near) {
      drop.add(e.k);
      if (walkable(a, b, new CollisionWorld(map.halfSize, [...boxes, ...out.filter((_, k) => !drop.has(k))].map(boxToAabb)))) break;
    }
    for (const k of [...drop].sort((p, q) => q - p)) out.splice(k, 1);
    console.log(`reopened ${drop.size} boxes on the link ${a.x},${a.z} -> ${b.x},${b.z}`);
    fixed = true;
  }
  if (!fixed) { console.log('areas still cut off:', nav.length - seen.size); break; }
}
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`${faces.length} wall faces, ${columns.size} open columns, ${kept.length} kept, ${out.length} boxes written`);
