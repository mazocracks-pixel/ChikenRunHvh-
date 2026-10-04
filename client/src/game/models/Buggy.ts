import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUGGY_SEAT, damp } from '@game/shared';
import { solid } from './materials';

/** What the buggy is doing this frame (drives the wheels, suspension and lights). */
export interface BuggyMotion {
  /** Forward speed, m/s (negative reversing). */
  speed: number;
  /** Sideways slide, m/s. */
  slip: number;
  /** Steering, -1 (left) … 1 (right). */
  steer: number;
  braking: boolean;
  boosting: boolean;
}

const WHEEL_R = 0.44;
const WHEELS = [
  [-0.88, -1.08, true],
  [0.88, -1.08, true],
  [-0.9, 1.08, false],
  [0.9, 1.08, false],
] as const;

/** Collects many small parts and merges them per material, so a buggy is a handful of draw calls. */
class Parts {
  private readonly byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.m);
    const list = this.byMaterial.get(mat) ?? [];
    list.push(g);
    this.byMaterial.set(mat, list);
  }

  /** A tube from a to b. */
  bar(a: THREE.Vector3Like, b: THREE.Vector3Like, r: number, mat: THREE.Material): void {
    const from = new THREE.Vector3(a.x, a.y, a.z);
    const dir = new THREE.Vector3(b.x, b.y, b.z).sub(from);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, 8, 1).toNonIndexed();
    g.deleteAttribute('uv');
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.m.compose(from.addScaledVector(dir, 0.5), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    const list = this.byMaterial.get(mat) ?? [];
    list.push(g);
    this.byMaterial.set(mat, list);
  }

  /** Adds one merged mesh per material; returns the new geometries (the caller disposes them). */
  build(parent: THREE.Object3D): THREE.BufferGeometry[] {
    const made: THREE.BufferGeometry[] = [];
    for (const [mat, list] of this.byMaterial) {
      const merged = mergeGeometries(list)!;
      made.push(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      for (const g of list) g.dispose();
    }
    return made;
  }
}

const glow = (color: number, intensity: number) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

/**
 * A farm buggy: rounded tub and nose, fenders, a roll cage with a light bar, bucket seat and
 * steering wheel, an open engine with twin exhausts, a spare wheel and chunky treaded tyres.
 * Faces -Z; origin on the ground.
 */
export class Buggy {
  readonly root = new THREE.Group();
  /** Leans and dips on the suspension. */
  private readonly body = new THREE.Group();
  private readonly wheels: { pivot: THREE.Group; tyre: THREE.Group; front: boolean; bounce: number }[] = [];
  private readonly steeringWheel = new THREE.Group();
  private readonly brakeLights: THREE.MeshStandardMaterial;
  private readonly materials: THREE.Material[] = [];
  private readonly ownGeometries: THREE.BufferGeometry[] = [];
  private spin = 0;
  private steerShown = 0;
  private lean = 0;
  private pitch = 0;
  private lastSpeed = 0;
  private time = Math.random() * 10;

  /** Where the nitro flames come out (local), for the effects. */
  static readonly EXHAUSTS = [new THREE.Vector3(-0.32, 0.78, 1.62), new THREE.Vector3(0.32, 0.78, 1.62)];
  /** Where the driver sits (local coordinates). */
  static readonly SEAT = new THREE.Vector3(BUGGY_SEAT.x, BUGGY_SEAT.y, BUGGY_SEAT.z);
  /** Rear wheels' contact points (local), for skid marks and dust. */
  static readonly REAR_WHEELS = [new THREE.Vector3(-0.9, 0.02, 1.08), new THREE.Vector3(0.9, 0.02, 1.08)];
  /** The engine (local), for smoke when the buggy is badly damaged. */
  static readonly ENGINE = new THREE.Vector3(0, 1.0, 1.15);

  constructor(color = 0xe53935) {
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25 });
    const paintDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    const dark = solid(0x22272c, { roughness: 0.7 });
    const black = solid(0x111315, { roughness: 0.85 });
    const chrome = solid(0xc9ced6, { metal: true, roughness: 0.25 });
    const steel = solid(0x6f767e, { metal: true, roughness: 0.4 });
    const seatMat = solid(0x3b2f2a, { roughness: 0.9 });
    const head = glow(0xfff4d6, 2.2);
    this.brakeLights = glow(0xff2a1a, 0.9);
    const amber = glow(0xffb347, 1.4);
    const plate = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6 });
    this.materials.push(paint, paintDark, head, this.brakeLights, amber, plate);

    const p = new Parts();
    const rbox = (w: number, h: number, d: number, r: number) => {
      const g = new RoundedBoxGeometry(w, h, d, 2, r);
      this.ownGeometries.push(g);
      return g;
    };
    const cyl = (rt: number, rb: number, h: number, seg = 12) => {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      this.ownGeometries.push(g);
      return g;
    };
    const box = (w: number, h: number, d: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.ownGeometries.push(g);
      return g;
    };

    // Tub, sloped nose and rear deck.
    p.add(rbox(1.56, 0.4, 2.7, 0.12), paint, 0, 0.66, 0.05);
    p.add(rbox(1.42, 0.3, 1.0, 0.12), paint, 0, 0.9, -0.92, 0.14);
    p.add(rbox(1.5, 0.22, 0.75, 0.08), paintDark, 0, 0.92, 1.05);
    // Side rails and steps.
    for (const s of [-1, 1]) {
      p.add(box(0.1, 0.12, 2.3), black, s * 0.82, 0.5, 0.05);
      p.add(box(0.22, 0.05, 0.7), steel, s * 0.86, 0.43, 0.1);
    }
    // Fenders over every wheel.
    for (const [x, z] of WHEELS) {
      // The top half of an open tube, its axis across the car.
      const arc = new THREE.CylinderGeometry(WHEEL_R + 0.1, WHEEL_R + 0.1, 0.42, 14, 1, true, 0, Math.PI);
      this.ownGeometries.push(arc);
      p.add(arc, paintDark, x * 1.02, 0.46, z, 0, 0, Math.PI / 2, 1, 1, 1);
    }
    // Bull bar, grille and headlights.
    p.bar({ x: -0.78, y: 0.5, z: -1.52 }, { x: 0.78, y: 0.5, z: -1.52 }, 0.055, chrome);
    p.bar({ x: -0.5, y: 0.5, z: -1.52 }, { x: -0.45, y: 0.9, z: -1.38 }, 0.04, chrome);
    p.bar({ x: 0.5, y: 0.5, z: -1.52 }, { x: 0.45, y: 0.9, z: -1.38 }, 0.04, chrome);
    p.add(box(0.62, 0.22, 0.06), black, 0, 0.74, -1.43);
    for (let i = 0; i < 4; i++) p.add(box(0.56, 0.025, 0.07), steel, 0, 0.66 + i * 0.05, -1.44);
    for (const s of [-1, 1]) {
      p.add(cyl(0.12, 0.12, 0.08, 16), chrome, s * 0.52, 0.8, -1.41, Math.PI / 2);
      p.add(cyl(0.095, 0.095, 0.02, 16), head, s * 0.52, 0.8, -1.455, Math.PI / 2);
    }
    // Dash, seat and the steering column.
    p.add(rbox(1.2, 0.18, 0.3, 0.06), dark, 0, 1.0, -0.42);
    p.add(rbox(0.66, 0.16, 0.6, 0.06), seatMat, 0, 0.82, 0.32);
    p.add(rbox(0.66, 0.66, 0.14, 0.06), seatMat, 0, 1.16, 0.66, -0.18);
    p.bar({ x: 0, y: 0.98, z: -0.4 }, { x: 0, y: 1.12, z: -0.16 }, 0.025, steel);
    // Roll cage: rear hoop, front pillars, roof bars, a cross brace and a light bar.
    const hoopZ = 0.78;
    const top = 1.92;
    for (const s of [-1, 1]) {
      p.bar({ x: s * 0.72, y: 0.82, z: hoopZ }, { x: s * 0.66, y: top, z: hoopZ }, 0.045, steel);
      p.bar({ x: s * 0.7, y: 0.92, z: -0.52 }, { x: s * 0.64, y: top, z: -0.05 }, 0.045, steel);
      p.bar({ x: s * 0.64, y: top, z: -0.05 }, { x: s * 0.66, y: top, z: hoopZ }, 0.045, steel);
      p.bar({ x: s * 0.66, y: top, z: hoopZ }, { x: s * 0.5, y: 0.95, z: 1.42 }, 0.04, steel);
    }
    p.bar({ x: -0.66, y: top, z: hoopZ }, { x: 0.66, y: top, z: hoopZ }, 0.045, steel);
    p.bar({ x: -0.64, y: top, z: -0.05 }, { x: 0.64, y: top, z: -0.05 }, 0.045, steel);
    p.bar({ x: -0.7, y: 0.95, z: hoopZ }, { x: 0.66, y: top - 0.05, z: hoopZ }, 0.035, steel);
    p.add(rbox(1.0, 0.12, 0.14, 0.04), black, 0, top + 0.1, -0.05);
    for (let i = 0; i < 4; i++) p.add(box(0.16, 0.07, 0.03), i === 0 || i === 3 ? amber : head, -0.36 + i * 0.24, top + 0.1, -0.13);
    // The engine and twin exhausts.
    p.add(rbox(0.7, 0.32, 0.5, 0.05), steel, 0, 1.12, 1.15);
    for (let i = 0; i < 4; i++) p.add(box(0.72, 0.03, 0.04), dark, 0, 1.0 + i * 0.07, 0.98);
    p.add(cyl(0.11, 0.11, 0.36, 12), chrome, 0.22, 1.32, 1.18);
    p.add(cyl(0.11, 0.11, 0.36, 12), chrome, -0.22, 1.32, 1.18);
    for (const s of [-1, 1]) {
      p.bar({ x: s * 0.28, y: 1.0, z: 1.25 }, { x: s * 0.32, y: 0.78, z: 1.55 }, 0.045, chrome);
      p.add(cyl(0.06, 0.07, 0.14, 12), black, s * 0.32, 0.78, 1.58, Math.PI / 2);
    }
    // Tail: lights, number plate and the spare wheel.
    for (const s of [-1, 1]) p.add(box(0.2, 0.1, 0.05), this.brakeLights, s * 0.6, 0.78, 1.42);
    const plateGeo = new THREE.PlaneGeometry(0.44, 0.13);
    this.ownGeometries.push(plateGeo);
    const plateMesh = new THREE.Mesh(plateGeo, plate);
    plateMesh.position.set(0, 0.6, 1.415);
    this.body.add(plateMesh);
    const spare = new THREE.TorusGeometry(0.3, 0.11, 8, 18);
    this.ownGeometries.push(spare);
    p.add(spare, black, 0, 1.45, hoopZ + 0.08);
    p.add(cyl(0.16, 0.16, 0.1, 10), steel, 0, 1.45, hoopZ + 0.08, Math.PI / 2);
    this.ownGeometries.push(...p.build(this.body));

    // Steering wheel: rim, spokes and hub, turned to face the driver.
    this.steeringWheel.position.set(0, 1.13, -0.15);
    this.steeringWheel.rotation.x = -0.9;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.024, 8, 20), black);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), steel);
    const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), steel);
    spoke2.position.y = -0.08;
    this.ownGeometries.push(rim.geometry, spoke.geometry, spoke2.geometry);
    const wheelGroup = new THREE.Group();
    wheelGroup.add(rim, spoke, spoke2);
    this.steeringWheel.add(wheelGroup);
    this.body.add(this.steeringWheel);

    // Wheels: knobbly tyre, five-spoke rim and hub, each on a steering/suspension pivot.
    const tyreParts = new Parts();
    tyreParts.add(cyl(WHEEL_R, WHEEL_R, 0.36, 18), black, 0, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      tyreParts.add(box(0.38, 0.07, 0.11), dark, 0, Math.cos(a) * (WHEEL_R + 0.015), Math.sin(a) * (WHEEL_R + 0.015), a);
    }
    tyreParts.add(cyl(0.26, 0.26, 0.38, 14), chrome, 0, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      tyreParts.add(box(0.05, 0.22, 0.06), steel, 0, Math.cos(a) * 0.12, Math.sin(a) * 0.12, a);
    }
    tyreParts.add(cyl(0.07, 0.07, 0.42, 10), steel, 0, 0, 0, 0, 0, Math.PI / 2);
    const template = new THREE.Group();
    this.ownGeometries.push(...tyreParts.build(template));
    for (const [x, z, front] of WHEELS) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const tyre = template.clone();
      pivot.add(tyre);
      this.wheels.push({ pivot, tyre, front, bounce: 0 });
      this.root.add(pivot);
    }
    this.root.add(this.body);
  }

  animate(dt: number, m: BuggyMotion): void {
    this.time += dt;
    this.spin += (m.speed / WHEEL_R) * dt;
    this.steerShown = damp(this.steerShown, m.steer, 10, dt);
    const accel = dt > 0 ? (m.speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = m.speed;
    // Body roll in turns and slides, a dip under braking, a squat when accelerating.
    const fast = Math.min(1, Math.abs(m.speed) / 12);
    this.lean = damp(this.lean, -this.steerShown * fast * 0.07 - m.slip * 0.012, 6, dt);
    this.pitch = damp(this.pitch, Math.max(-0.07, Math.min(0.07, -accel * 0.004)), 5, dt);
    const rumble = Math.sin(this.time * 31) * 0.006 * fast + Math.sin(this.time * 17.3) * 0.004 * fast;
    this.body.position.y = 0.01 + rumble;
    this.body.rotation.set(this.pitch, 0, this.lean);
    for (const w of this.wheels) {
      w.tyre.rotation.x = -this.spin;
      w.pivot.rotation.y = w.front ? -this.steerShown * 0.45 : 0;
      w.pivot.position.y = WHEEL_R + Math.sin(this.time * 23 + w.pivot.position.z * 3 + w.pivot.position.x) * 0.012 * fast;
    }
    this.steeringWheel.children[0]!.rotation.z = this.steerShown * 1.6;
    this.brakeLights.emissiveIntensity = m.braking ? 4 : 0.9;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** A little number plate. */
function plateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 40;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(0, 0, 128, 40);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 124, 36);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CHIK 3N', 64, 21);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
