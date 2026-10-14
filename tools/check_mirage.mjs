import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const path = new URL('../client/public/maps/mirage.glb', import.meta.url);
const bytes = readFileSync(path);
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
const bin = bytes.subarray(28 + jsonLength);
assert.ok(gltf.images.length >= 247);
const crate = gltf.materials.find((material) => material.name.includes('dust_food_crates'));
const leaves = gltf.materials.find((material) => material.name.includes('Urban_Trees_branches03'));
assert.ok(crate?.pbrMetallicRoughness.baseColorTexture, 'crate texture is embedded');
assert.equal(crate.alphaMode ?? 'OPAQUE', 'OPAQUE', 'crates are solid');
assert.ok(leaves?.pbrMetallicRoughness.baseColorTexture, 'tree texture is embedded');
assert.equal(leaves.alphaMode, 'MASK', 'leaves use cutouts, not blended surfaces');
for (const image of gltf.images) {
  assert.ok(image.mimeType === 'image/png' || image.mimeType === 'image/webp');
  const view = gltf.bufferViews[image.bufferView];
  if (image.mimeType === 'image/webp') {
    assert.equal(bin.subarray(view.byteOffset, view.byteOffset + 4).toString(), 'RIFF');
    assert.equal(bin.subarray(view.byteOffset + 8, view.byteOffset + 12).toString(), 'WEBP');
  } else assert.deepEqual([...bin.subarray(view.byteOffset, view.byteOffset + 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
// Node has no image decoder; exercise the real compressed geometry loader with texture placeholders.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .register(() => ({ name: 'GeometryCheck', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
  .register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const loaded = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
let meshes = 0, instances = 0, triangles = 0;
loaded.scene.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  meshes++;
  const positions = o.geometry.getAttribute('position');
  assert.ok(positions && positions.count > 0);
  o.geometry.computeBoundingBox();
  assert.ok(Object.values(o.geometry.boundingBox.min).every(Number.isFinite));
  assert.ok(Object.values(o.geometry.boundingBox.max).every(Number.isFinite));
  instances += o instanceof THREE.InstancedMesh ? o.count : 1;
  triangles += (o.geometry.index?.count ?? positions.count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1);
});
assert.ok(meshes > 200 && instances > 1700);
loaded.scene.updateMatrixWorld(true);
const mapData = JSON.parse(readFileSync(new URL('../shared/src/maps/mirage-data.json', import.meta.url), 'utf8'));
for (const spawn of mapData.spawns) {
  const origin = new THREE.Vector3(spawn.x, spawn.y + 0.5, spawn.z);
  const floor = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(loaded.scene, true)[0];
  assert.ok(floor && Math.abs(floor.point.y - spawn.y) < 0.35, `visible floor beneath team ${spawn.team} spawn at ${spawn.x}, ${spawn.z}`);
}
const bounds = new THREE.Box3().setFromObject(loaded.scene);
assert.ok(bounds.min.x < -50 && bounds.max.x > 35 && bounds.min.z < -35 && bounds.max.z > 55);
const spot = new THREE.Vector3(31.25, 5.9, 5.9375);
const floor = new THREE.Raycaster(spot.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0), 0, 3).intersectObject(loaded.scene, true)[0];
assert.ok(floor && Math.abs(floor.point.y - spot.y) < 0.3, 'lobby chicken stands on the visible Mirage floor');
const camera = spot.clone().add(new THREE.Vector3(0, 0.85, 2.8));
const direction = spot.clone().add(new THREE.Vector3(0, 0.82, 0)).sub(camera);
assert.equal(new THREE.Raycaster(camera, direction.clone().normalize(), 0, direction.length()).intersectObject(loaded.scene, true).length, 0, 'lobby camera sees the chicken');
console.log(JSON.stringify({ bytes: statSync(path).size, textures: gltf.images.length, meshes, instances, triangles, bounds }, null, 2));
