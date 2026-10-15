/**
 * Mirage's climbable ladders, from the ladder props standing upright in the map model (the
 * importer kept them as scenery only).
 *
 *   npx tsx tools/mirage_ladders.mts      writes shared/src/maps/mirage-ladders.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const bytes = readFileSync(new URL('../client/public/maps/mirage.glb', import.meta.url));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .register(() => ({ name: 'NoTextures', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
  .register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
gltf.scene.updateMatrixWorld(true);

const ladders: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }[] = [];
const m = new THREE.Matrix4();
gltf.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const name = (Array.isArray(o.material) ? o.material[0] : o.material).name;
  if (!/ladder/i.test(name)) return;
  o.geometry.computeBoundingBox();
  const count = o instanceof THREE.InstancedMesh ? o.count : 1;
  for (let i = 0; i < count; i++) {
    const box = o.geometry.boundingBox!.clone();
    if (o instanceof THREE.InstancedMesh) { o.getMatrixAt(i, m); box.applyMatrix4(m); }
    box.applyMatrix4(o.matrixWorld);
    const size = box.getSize(new THREE.Vector3());
    // Upright ones only (one lies flat on a roof).
    if (size.y < 1.5 || size.y < Math.max(size.x, size.z)) continue;
    const r = (v: number) => Math.round(v * 100) / 100;
    ladders.push({ minX: r(box.min.x), minY: r(box.min.y), minZ: r(box.min.z), maxX: r(box.max.x), maxY: r(box.max.y), maxZ: r(box.max.z) });
    console.log(name, ladders.at(-1));
  }
});
writeFileSync(new URL('../shared/src/maps/mirage-ladders.json', import.meta.url), JSON.stringify(ladders) + '\n');
console.log(`${ladders.length} ladders`);
