/**
 * Finds Mirage's player clips: invisible collision that Counter-Strike lets bullets through (gaps
 * between buildings, smoothed corners). The importer kept them as solid boxes, so shots stopped in
 * mid-air there. Rays are fired from every walkway spot; a box that stops them where nothing is
 * drawn is listed as a clip (players still collide with it; shots and sight pass).
 *
 *   npx tsx tools/mirage_clips.mts      writes shared/src/maps/mirage-clips.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MAPS, makeRay, raycastWorld } from '@game/shared';
import data from '../shared/src/maps/mirage-data.json';

const SPACING = 0.2;
const NEAR = 0.3;
const bytes = readFileSync(new URL('../client/public/maps/mirage.glb', import.meta.url));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .register(() => ({ name: 'NoTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
  .register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
gltf.scene.updateMatrixWorld(true);

// Every drawn surface as points about SPACING apart, hashed by 1 m cells.
const cells = new Map<string, number[]>();
const add = (x: number, y: number, z: number) => {
  const k = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  (cells.get(k) ?? cells.set(k, []).get(k)!).push(x, y, z);
};
const m = new THREE.Matrix4(), M = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
let points = 0;
gltf.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const pos = o.geometry.getAttribute('position'), idx = o.geometry.index;
  const count = o instanceof THREE.InstancedMesh ? o.count : 1;
  for (let inst = 0; inst < count; inst++) {
    if (o instanceof THREE.InstancedMesh) { o.getMatrixAt(inst, m); M.multiplyMatrices(o.matrixWorld, m); } else M.copy(o.matrixWorld);
    for (let t = 0; t < (idx ? idx.count : pos.count) / 3; t++) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t * 3) : t * 3).applyMatrix4(M);
      b.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(M);
      c.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(M);
      const k = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / SPACING));
      for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
        const u = i / k, v = j / k;
        add(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v);
        points++;
      }
    }
  }
});
const drawnNear = (x: number, y: number, z: number) => {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const list = cells.get(`${Math.floor(x) + i},${Math.floor(y) + j},${Math.floor(z) + k}`);
    if (!list) continue;
    for (let n = 0; n < list.length; n += 3) if (Math.abs(list[n]! - x) < NEAR && Math.abs(list[n + 1]! - y) < NEAR && Math.abs(list[n + 2]! - z) < NEAR) return true;
  }
  return false;
};

const map = MAPS.mirage;
const world = new (await import('@game/shared')).CollisionWorld(map.halfSize, map.boxes.map((await import('@game/shared')).boxToAabb));
const nav = map.nav!.slice(0, map.navLinks!.length);
const stats = new Map<number, { hidden: number; drawn: number }>();
for (const p of nav) for (const eye of [0.6, 1.3]) for (let yawStep = 0; yawStep < 48; yawStep++) for (const pitch of [-0.15, 0, 0.2, 0.5]) {
  const yaw = (yawStep / 48) * Math.PI * 2;
  const dir = { x: Math.cos(pitch) * Math.sin(yaw), y: Math.sin(pitch), z: Math.cos(pitch) * Math.cos(yaw) };
  const hit = raycastWorld(makeRay({ x: p.x, y: (p.y ?? 0) + eye, z: p.z }, dir), world, 60);
  if (!hit || hit.id === undefined || hit.id < 0 || hit.id >= data.boxes.length) continue;
  const x = p.x + dir.x * hit.t, y = (p.y ?? 0) + eye + dir.y * hit.t, z = p.z + dir.z * hit.t;
  const s = stats.get(hit.id) ?? stats.set(hit.id, { hidden: 0, drawn: 0 }).get(hit.id)!;
  if (drawnNear(x, y, z)) s.drawn++; else s.hidden++;
}
const clips = [...stats].filter(([, s]) => s.hidden >= 4 && s.hidden >= 0.85 * (s.hidden + s.drawn)).map(([id]) => id).sort((p, q) => p - q);
writeFileSync(new URL('../shared/src/maps/mirage-clips.json', import.meta.url), JSON.stringify(clips) + '\n');
console.log(`${points} surface points; ${stats.size} boxes hit; ${clips.length} clips written`);
for (const id of clips.slice(0, 15)) { const box = data.boxes[id]!; console.log(id, box.x, box.y, box.z, box.w, box.h, box.d, JSON.stringify(stats.get(id))); }
