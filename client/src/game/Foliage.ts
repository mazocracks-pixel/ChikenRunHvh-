import * as THREE from 'three';
import { mulberry32, type Aabb, type CollisionWorld, type MapDef } from '@game/shared';

/** Tufts per square metre at full detail, inside and just outside the fence. */
const NEAR_DENSITY = 0.75;
/** Further out, where fog hides most of it anyway. */
const FAR_DENSITY = 0.25;
const NEAR_BAND = 22;
const FAR_BAND = 50;
const BLADES = 5;
const scratch: Aabb[] = [];

/**
 * Purely visual grass tufts, flowers and rocks, instanced so thousands cost a few draw calls.
 * Grass sways in the wind on the GPU. Inside the fence it only grows on grass maps, and never
 * inside solid boxes; rocks stay outside the fence so nobody mistakes them for cover.
 */
export class Foliage {
  readonly root = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly disposables: { dispose(): void }[] = [];

  constructor(map: MapDef, collision: CollisionWorld, detail: number) {
    const rand = mulberry32(31);
    const tufts: THREE.Vector3[] = [];
    const flowers: THREE.Vector3[] = [];
    const rocks: THREE.Vector3[] = [];
    const inner = map.halfSize;
    const insideAllowed = map.ground === 'grass';
    const blocked = (x: number, z: number) => {
      for (const b of collision.query(x - 0.2, z - 0.2, x + 0.2, z + 0.2, scratch)) {
        if (b.minY < 0.4 && x > b.minX - 0.15 && x < b.maxX + 0.15 && z > b.minZ - 0.15 && z < b.maxZ + 0.15) return true;
      }
      return false;
    };

    const scatter = (half: number, holeHalf: number, density: number) => {
      const area = (2 * half) ** 2 - (2 * holeHalf) ** 2;
      const count = Math.round(area * density * detail);
      for (let i = 0; i < count; i++) {
        const x = (rand() * 2 - 1) * half;
        const z = (rand() * 2 - 1) * half;
        if (Math.max(Math.abs(x), Math.abs(z)) < holeHalf) {
          i--;
          continue;
        }
        const outside = Math.abs(x) > inner || Math.abs(z) > inner;
        if (!outside && (!insideAllowed || blocked(x, z))) continue;
        const r = rand();
        if (r < 0.06) flowers.push(new THREE.Vector3(x, 0, z));
        else if (outside && r < 0.075) rocks.push(new THREE.Vector3(x, 0, z));
        else tufts.push(new THREE.Vector3(x, 0, z));
      }
    };
    scatter(inner + NEAR_BAND, 0, NEAR_DENSITY);
    scatter(inner + FAR_BAND, inner + NEAR_BAND, FAR_DENSITY);

    this.addGrass(tufts, rand);
    this.addFlowers(flowers, rand);
    this.addRocks(rocks, rand);
  }

  update(dt: number): void {
    this.time.value += dt;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private addGrass(spots: THREE.Vector3[], rand: () => number): void {
    if (spots.length === 0) return;
    const material = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 origin = instanceMatrix[3];
        float sway = sin(uTime * 1.7 + origin.x * 0.31 + origin.z * 0.23) * 0.6 + sin(uTime * 3.3 + origin.x * 0.9 - origin.z * 0.5) * 0.25;
        transformed.x += sway * 0.13 * position.y;
        transformed.z += sway * 0.05 * position.y;`,
      );
      // Both sides of a blade keep the upward normal (three.js would flip it on the back face,
      // turning half the blades nearly black).
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    };
    material.customProgramCacheKey = () => 'grass-wind';
    const mesh = new THREE.InstancedMesh(this.track(tuftGeometry(rand)), material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    spots.forEach((p, i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const size = 0.55 + rand() * 0.4;
      s.set(size, size * (0.7 + rand() * 0.4), size);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, color.setHSL(0.25 + rand() * 0.04, 0.48 + rand() * 0.1, 0.33 + rand() * 0.06));
    });
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private addFlowers(spots: THREE.Vector3[], rand: () => number): void {
    if (spots.length === 0) return;
    const colors = [0xffffff, 0xfff176, 0xf48fb1, 0xce93d8, 0xffb74d];
    const geometry = this.track(new THREE.IcosahedronGeometry(0.07, 0));
    geometry.translate(0, 0.28, 0);
    const mesh = new THREE.InstancedMesh(geometry, this.track(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true })), spots.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    spots.forEach((p, i) => {
      const k = 0.8 + rand() * 0.6;
      mesh.setMatrixAt(i, m.makeScale(k, k, k).setPosition(p));
      mesh.setColorAt(i, color.set(colors[Math.floor(rand() * colors.length)]!));
    });
    this.root.add(mesh);
  }

  private addRocks(spots: THREE.Vector3[], rand: () => number): void {
    if (spots.length === 0) return;
    const geometry = this.track(new THREE.DodecahedronGeometry(0.5, 0));
    const mesh = new THREE.InstancedMesh(geometry, this.track(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const color = new THREE.Color();
    spots.forEach((p, i) => {
      const k = 0.4 + rand() * 1.4;
      s.set(k * (0.8 + rand() * 0.5), k * (0.45 + rand() * 0.35), k * (0.8 + rand() * 0.5));
      q.setFromEuler(e.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
      mesh.setMatrixAt(i, m.compose(p.clone().setY(s.y * 0.15), q, s));
      mesh.setColorAt(i, color.setHSL(0.1, 0.05 + rand() * 0.06, 0.45 + rand() * 0.15));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }
}

/**
 * One tuft: a few thin, slightly leaning blades. Normals point straight up so the blades
 * light like the ground they grow from (no dark backsides), and vertex colours darken the base.
 */
function tuftGeometry(rand: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2 + rand() * 0.8;
    const r = 0.04 + rand() * 0.09;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const height = 0.26 + rand() * 0.22;
    const width = 0.035 + rand() * 0.02;
    // Blade faces a random direction and leans outwards.
    const fa = rand() * Math.PI;
    const wx = Math.cos(fa) * width;
    const wz = Math.sin(fa) * width;
    const lean = 0.06 + rand() * 0.1;
    positions.push(x - wx, 0, z - wz, x + wx, 0, z + wz, x + Math.cos(a) * lean, height, z + Math.sin(a) * lean);
    colors.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.1, 1.1, 1.0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geometry;
}
