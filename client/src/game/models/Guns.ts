import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS, type WeaponId } from '@game/shared';

export interface GunModel {
  group: THREE.Group;
  /** Where bullets visually leave the barrel. */
  muzzle: THREE.Object3D;
  /** Spinning barrel cluster (minigun only). */
  spinner: THREE.Object3D | null;
  /** The part that comes out during a reload (magazine or rocket), or null. */
  magazine: THREE.Object3D | null;
}

// ---------------------------------------------------------------------------
// Materials (shared by every gun of the same kind)
// ---------------------------------------------------------------------------

const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = materials.get(key);
  if (!m) materials.set(key, (m = make()));
  return m;
}

const metal = (color: number, roughness = 0.34) => material(`metal:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness }));
const polymer = (color: number, roughness = 0.68) => material(`poly:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness }));
const GOLD = () => material('gold', () => new THREE.MeshStandardMaterial({ color: 0xe8b93e, metalness: 1, roughness: 0.22 }));
const BRASS = () => metal(0xc9a33a, 0.3);
const STEEL = () => metal(0x2b2e33);
const DARK = () => metal(0x141619, 0.42);
const RUBBER = () => polymer(0x111213, 0.9);
const GLASS = () =>
  material('glass', () => new THREE.MeshStandardMaterial({ color: 0x0a2440, metalness: 0.9, roughness: 0.04, emissive: 0x0b3a66, emissiveIntensity: 0.55 }));
const WOOD = () => material('wood', () => new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.58, metalness: 0 }));

/** Walnut with a long grain, drawn once. */
function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#6e4122';
  ctx.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 70; i++) {
    const y = (i * 37) % 64;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(40, 20, 8, 0.45)' : 'rgba(150, 95, 50, 0.35)';
    ctx.lineWidth = 0.6 + (i % 4) * 0.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 2.5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Geometry kit (cached, all guns point down -Z with the grip at the origin)
// ---------------------------------------------------------------------------

const geometries = new Map<string, THREE.BufferGeometry>();
function geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = make()));
  return g;
}

/** Box with softened edges. */
const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.22) => geometry(`rb:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r));
const box = (w: number, h: number, d: number) => geometry(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
/** Cylinder along Z. `back` and `front` radii may differ (tapers). */
const tube = (front: number, length: number, back = front, segments = 14) =>
  geometry(`t:${front}:${back}:${length}:${segments}`, () => new THREE.CylinderGeometry(back, front, length, segments).rotateX(Math.PI / 2));
/** Upright cylinder (turrets, knobs). */
const post = (r: number, h: number) => geometry(`p:${r}:${h}`, () => new THREE.CylinderGeometry(r, r, h, 10));
/** Flat disc facing +Z (lenses, bores). */
const disc = (r: number) => geometry(`d:${r}`, () => new THREE.CircleGeometry(r, 18));
/** Ring around Z, or an arc of one. */
const ring = (r: number, t: number, arc = Math.PI * 2) => geometry(`r:${r}:${t}:${arc}`, () => new THREE.TorusGeometry(r, t, 6, 18, arc));
const ball = (r: number) => geometry(`s:${r}`, () => new THREE.SphereGeometry(r, 10, 8));
/**
 * A flat blade pointing down -Z from z = 0 (the guard): edge below, spine above, sweeping up to
 * the tip. `curve` bends the whole blade upwards (a katana's curve). Thickness is along X.
 */
const blade = (length: number, height: number, thickness: number, curve = 0) =>
  geometry(`bl:${length}:${height}:${thickness}:${curve}`, () => {
    const L = length;
    const h = height / 2;
    const c = curve;
    const shape = new THREE.Shape();
    shape.moveTo(0, -h);
    shape.quadraticCurveTo(L * 0.5, -h + c, L * 0.8, -h + c * 1.6);
    shape.quadraticCurveTo(L * 0.96, -h + c * 2 + height * 0.15, L, height * 0.3 + c * 2);
    shape.lineTo(L * 0.86, h + c * 1.8);
    shape.quadraticCurveTo(L * 0.5, h + c, 0, h);
    shape.closePath();
    const bevel = thickness * 0.35;
    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 8 });
    g.translate(0, 0, -(thickness - bevel * 2) / 2);
    return g.rotateY(Math.PI / 2);
  });

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** Trigger guard (a half ring under the receiver) and trigger. */
function trigger(g: THREE.Object3D, mat: THREE.Material, z: number, y = 0.012, r = 0.022): void {
  add(g, ring(r, 0.0035, Math.PI), mat, 0, y, z, 0, Math.PI / 2, Math.PI);
  add(g, box(0.006, 0.018, 0.006), DARK(), 0, y - 0.006, z + 0.004, 0.35);
}

/** Pistol grip, raked back like a real one. */
function grip(g: THREE.Object3D, mat: THREE.Material, z: number, h = 0.095, rake = 0.28): void {
  add(g, rbox(0.034, h, 0.046), mat, 0, -0.03, z, rake);
  // Rubbery side panels.
  add(g, rbox(0.037, h * 0.62, 0.032), RUBBER(), 0, -0.032, z + 0.002, rake);
}

// ---------------------------------------------------------------------------
// The guns
// ---------------------------------------------------------------------------

interface Build {
  muzzle: THREE.Vector3;
  spinner?: THREE.Object3D;
  magazine?: THREE.Object3D;
  /** Overall size multiplier, so third-person proportions stay as before. */
  scale?: number;
}

type Builder = (g: THREE.Group, id: WeaponId) => Build;

const pistol: Builder = (g) => {
  const slide = STEEL();
  add(g, rbox(0.038, 0.042, 0.19), slide, 0, 0.072, -0.075);
  for (let i = 0; i < 5; i++) add(g, box(0.0405, 0.026, 0.003), DARK(), 0, 0.073, 0.008 - i * 0.008);
  add(g, box(0.003, 0.016, 0.034), DARK(), 0.019, 0.08, -0.05);
  add(g, rbox(0.034, 0.026, 0.16), polymer(0x1a1b1e), 0, 0.037, -0.065);
  add(g, box(0.03, 0.008, 0.05), DARK(), 0, 0.022, -0.12);
  add(g, tube(0.0085, 0.014), DARK(), 0, 0.074, -0.174);
  add(g, box(0.006, 0.008, 0.006), DARK(), 0, 0.097, -0.16);
  add(g, box(0.024, 0.008, 0.008), DARK(), 0, 0.097, 0.012);
  grip(g, polymer(0x1a1b1e), 0.008, 0.1, 0.22);
  trigger(g, polymer(0x1a1b1e), -0.035, 0.02);
  const mag = new THREE.Group();
  mag.position.set(0, -0.078, 0.02);
  add(mag, rbox(0.036, 0.012, 0.05), DARK(), 0, 0, 0);
  add(mag, rbox(0.026, 0.085, 0.034), STEEL(), 0, 0.045, -0.008, 0.22);
  g.add(mag);
  return { muzzle: new THREE.Vector3(0, 0.074, -0.186), magazine: mag, scale: 1.05 };
};

/** Assault-rifle family: Rifle and Golden Rifle. */
function rifleLike(body: THREE.Material, accent: THREE.Material, gold: boolean): Builder {
  return (g) => {
    add(g, rbox(0.066, 0.085, 0.34), body, 0, 0.06, -0.1);
    add(g, rbox(0.05, 0.05, 0.1), body, 0, 0.005, -0.13);
    // Picatinny rail with teeth.
    add(g, box(0.028, 0.012, 0.3), accent, 0, 0.108, -0.12);
    for (let i = 0; i < 10; i++) add(g, box(0.032, 0.006, 0.01), accent, 0, 0.116, -0.25 + i * 0.028);
    // Handguard with cooling slots.
    add(g, rbox(0.07, 0.068, 0.26), body, 0, 0.058, -0.4);
    for (let i = 0; i < 4; i++) add(g, box(0.073, 0.012, 0.034), DARK(), 0, 0.06, -0.33 - i * 0.05);
    add(g, tube(0.011, 0.2), DARK(), 0, 0.064, -0.62);
    add(g, rbox(0.022, 0.03, 0.025), accent, 0, 0.07, -0.55);
    add(g, box(0.006, 0.05, 0.012), accent, 0, 0.1, -0.55);
    add(g, tube(0.017, 0.05), DARK(), 0, 0.064, -0.735);
    for (const s of [-1, 1]) add(g, box(0.008, 0.008, 0.03), polymer(0x050505), s * 0.015, 0.064, -0.735);
    add(g, rbox(0.03, 0.025, 0.03), accent, 0, 0.125, 0.03);
    add(g, box(0.02, 0.01, 0.03), accent, 0, 0.104, 0.05);
    // Ejection port.
    add(g, box(0.003, 0.022, 0.05), DARK(), 0.034, 0.07, -0.07);
    // Curved magazine.
    const mag = new THREE.Group();
    mag.position.set(0, -0.025, -0.135);
    for (let k = 0; k < 3; k++) add(mag, rbox(0.042, 0.055, 0.064), gold ? DARK() : accent, 0, -0.025 - k * 0.05, -0.012 * k - 0.01 * k * k, 0.16 * k);
    g.add(mag);
    grip(g, gold ? DARK() : polymer(0x1c1d1f), 0.04);
    trigger(g, accent, -0.005, 0.01, 0.024);
    // Stock with cheek riser and rubber butt pad.
    add(g, rbox(0.045, 0.07, 0.2), body, 0, 0.035, 0.17);
    add(g, rbox(0.035, 0.02, 0.12), body, 0, 0.075, 0.16);
    add(g, rbox(0.05, 0.095, 0.022), RUBBER(), 0, 0.03, 0.28);
    if (gold) {
      // Engraved trim strips.
      for (const s of [-1, 1]) add(g, box(0.002, 0.008, 0.28), metal(0x8a6512, 0.4), s * 0.034, 0.075, -0.1);
    }
    return { muzzle: new THREE.Vector3(0, 0.064, -0.765), magazine: mag, scale: 0.84 };
  };
}

const shotgun: Builder = (g) => {
  const wood = WOOD();
  add(g, rbox(0.06, 0.07, 0.12), STEEL(), 0, 0.058, -0.02);
  for (const s of [-1, 1]) {
    add(g, tube(0.015, 0.5), DARK(), s * 0.016, 0.075, -0.33);
    add(g, disc(0.011), polymer(0x020202), s * 0.016, 0.075, -0.581, 0, Math.PI);
  }
  add(g, box(0.008, 0.006, 0.5), STEEL(), 0, 0.093, -0.33);
  add(g, ball(0.005), BRASS(), 0, 0.099, -0.57);
  add(g, rbox(0.055, 0.035, 0.2), wood, 0, 0.045, -0.2);
  add(g, rbox(0.04, 0.05, 0.08), wood, 0, 0.03, 0.06, 0.1);
  add(g, rbox(0.05, 0.085, 0.28), wood, 0, 0.012, 0.2, 0.12);
  add(g, rbox(0.054, 0.094, 0.02), RUBBER(), 0, -0.006, 0.34, 0.12);
  // Exposed hammers.
  for (const s of [-1, 1]) add(g, box(0.008, 0.02, 0.01), STEEL(), s * 0.016, 0.098, 0.035, -0.4);
  trigger(g, STEEL(), 0.0, 0.012);
  return { muzzle: new THREE.Vector3(0, 0.075, -0.585), scale: 1.0 };
};

const sniper: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.62);
  add(g, rbox(0.058, 0.07, 0.28), body, 0, 0.06, -0.06);
  add(g, rbox(0.064, 0.06, 0.3), body, 0, 0.045, -0.3);
  add(g, tube(0.013, 0.52), DARK(), 0, 0.066, -0.46);
  add(g, rbox(0.03, 0.026, 0.06), DARK(), 0, 0.066, -0.75);
  for (const s of [-1, 1]) add(g, box(0.006, 0.008, 0.012), polymer(0x050505), s * 0.015, 0.066, -0.745);
  // Stock with cheek rest.
  add(g, rbox(0.05, 0.1, 0.34), body, 0, 0.03, 0.2);
  add(g, rbox(0.04, 0.025, 0.14), body, 0, 0.088, 0.2);
  add(g, rbox(0.054, 0.11, 0.022), RUBBER(), 0, 0.03, 0.37);
  grip(g, polymer(0x1c1d1f), 0.05, 0.085, 0.3);
  trigger(g, DARK(), 0.005, 0.012);
  // Scope: tube, bells, lenses, turrets and rings.
  const scope = DARK();
  add(g, tube(0.022, 0.26), scope, 0, 0.138, -0.06);
  add(g, tube(0.034, 0.07, 0.022), scope, 0, 0.138, -0.225);
  add(g, tube(0.024, 0.05, 0.028), scope, 0, 0.138, 0.095);
  add(g, disc(0.03), GLASS(), 0, 0.138, -0.261, 0, Math.PI);
  add(g, disc(0.023), GLASS(), 0, 0.138, 0.121);
  add(g, post(0.011, 0.024), scope, 0, 0.166, -0.06);
  add(g, post(0.011, 0.024), scope, 0.027, 0.138, -0.06, 0, 0, Math.PI / 2);
  for (const z of [-0.14, 0.02]) {
    add(g, ring(0.024, 0.005), STEEL(), 0, 0.138, z);
    add(g, box(0.016, 0.03, 0.014), STEEL(), 0, 0.106, z);
  }
  // Bolt handle.
  add(g, post(0.005, 0.05), STEEL(), 0.04, 0.072, 0.035, 0, 0, Math.PI / 2);
  add(g, ball(0.011), STEEL(), 0.066, 0.07, 0.035);
  // Folded bipod.
  for (const s of [-1, 1]) add(g, tube(0.0045, 0.2), DARK(), s * 0.015, 0.02, -0.5);
  const mag = new THREE.Group();
  mag.position.set(0, 0.0, -0.06);
  add(mag, rbox(0.04, 0.05, 0.08), DARK(), 0, -0.01, 0);
  g.add(mag);
  return { muzzle: new THREE.Vector3(0, 0.066, -0.785), magazine: mag, scale: 1.0 };
};

const smg: Builder = (g, id) => {
  const body = metal(WEAPONS[id].model.color, 0.45);
  add(g, rbox(0.058, 0.075, 0.24), body, 0, 0.056, -0.06);
  add(g, box(0.026, 0.012, 0.2), DARK(), 0, 0.1, -0.06);
  add(g, tube(0.016, 0.06), DARK(), 0, 0.06, -0.21);
  // Suppressor.
  add(g, tube(0.024, 0.16), metal(0x1e2024, 0.55), 0, 0.06, -0.32);
  add(g, ring(0.024, 0.003), STEEL(), 0, 0.06, -0.4);
  add(g, rbox(0.03, 0.07, 0.035), polymer(0x1c1d1f), 0, -0.01, -0.18);
  grip(g, polymer(0x1c1d1f), 0.04, 0.09, 0.25);
  trigger(g, DARK(), -0.005, 0.014);
  // Folding wire stock.
  for (const s of [-1, 1]) add(g, tube(0.0055, 0.16), STEEL(), s * 0.018, 0.05, 0.14);
  add(g, rbox(0.05, 0.07, 0.012), RUBBER(), 0, 0.045, 0.22);
  add(g, box(0.006, 0.016, 0.008), DARK(), 0, 0.112, -0.15);
  add(g, box(0.02, 0.012, 0.01), DARK(), 0, 0.112, 0.04);
  const mag = new THREE.Group();
  mag.position.set(0, -0.01, -0.1);
  add(mag, rbox(0.032, 0.15, 0.04), DARK(), 0, -0.07, 0, 0.08);
  g.add(mag);
  return { muzzle: new THREE.Vector3(0, 0.06, -0.405), magazine: mag, scale: 0.95 };
};

const minigun: Builder = (g, id) => {
  const body = metal(WEAPONS[id].model.color, 0.4);
  add(g, rbox(0.13, 0.13, 0.28), body, 0, 0.02, -0.02);
  add(g, tube(0.05, 0.08), DARK(), 0, 0.02, 0.15);
  const spinner = new THREE.Group();
  spinner.position.set(0, 0.02, -0.16);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(spinner, tube(0.011, 0.55), DARK(), Math.cos(a) * 0.042, Math.sin(a) * 0.042, -0.275);
  }
  add(spinner, tube(0.012, 0.55), STEEL(), 0, 0, -0.275);
  for (const z of [-0.06, -0.3, -0.53]) add(spinner, tube(0.058, 0.012), STEEL(), 0, 0, z);
  g.add(spinner);
  // Carry handle, rear spade grips, ammo box with a feed chute.
  add(g, ring(0.06, 0.009, Math.PI), DARK(), 0, 0.08, -0.02, 0, Math.PI / 2, 0);
  for (const s of [-1, 1]) add(g, rbox(0.025, 0.08, 0.025), RUBBER(), s * 0.05, 0.0, 0.17);
  add(g, rbox(0.08, 0.1, 0.12), polymer(0x3b4030), -0.11, -0.02, 0.0);
  for (let k = 0; k < 3; k++) add(g, box(0.03, 0.012, 0.03), BRASS(), -0.085 + k * 0.012, 0.035 + k * 0.006, -0.03 - k * 0.025, 0, 0, 0.3);
  return { muzzle: new THREE.Vector3(0, 0.02, -0.72), spinner, scale: 1.0 };
};

const rocket: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.72);
  add(g, tube(0.06, 0.8), body, 0, 0.07, -0.2);
  add(g, tube(0.068, 0.04), DARK(), 0, 0.07, -0.6);
  add(g, tube(0.06, 0.1, 0.085), DARK(), 0, 0.07, 0.25);
  add(g, ring(0.062, 0.004), polymer(0xd9c97a), 0, 0.07, -0.45);
  // The rocket sitting in the tube.
  const warhead = new THREE.Group();
  warhead.position.set(0, 0.07, -0.62);
  add(warhead, tube(0.05, 0.06), polymer(0x56603f), 0, 0, 0);
  add(warhead, geometry('cone:rocket', () => new THREE.ConeGeometry(0.05, 0.13, 14).rotateX(-Math.PI / 2)), polymer(0xb33a2e, 0.5), 0, 0, -0.095);
  g.add(warhead);
  grip(g, polymer(0x1c1d1f), 0.0, 0.09, 0.2);
  trigger(g, DARK(), -0.04, 0.015);
  add(g, rbox(0.03, 0.07, 0.035), polymer(0x1c1d1f), 0, 0.0, -0.26);
  add(g, rbox(0.03, 0.04, 0.08), DARK(), -0.072, 0.12, -0.15);
  add(g, disc(0.012), GLASS(), -0.072, 0.12, -0.191, 0, Math.PI);
  add(g, rbox(0.04, 0.03, 0.12), RUBBER(), 0, 0.01, 0.12);
  return { muzzle: new THREE.Vector3(0, 0.07, -0.74), magazine: warhead, scale: 1.0 };
};

// ---------------------------------------------------------------------------
// Melee (held at the handle, pointing down -Z like the guns)
// ---------------------------------------------------------------------------

/** Blade steel: only half metallic, so it still reads as bright steel without reflections (Low quality). */
const POLISHED = () => material('blade', () => new THREE.MeshStandardMaterial({ color: 0xe4e9f0, metalness: 0.55, roughness: 0.24 }));

const knife: Builder = (g, id) => {
  const handle = polymer(WEAPONS[id].model.color, 0.55);
  add(g, rbox(0.026, 0.034, 0.11), handle, 0, 0.03, 0.02);
  for (let i = 0; i < 3; i++) add(g, box(0.028, 0.005, 0.012), RUBBER(), 0, 0.0145, 0.05 - i * 0.028);
  add(g, rbox(0.03, 0.038, 0.012), DARK(), 0, 0.03, 0.08);
  add(g, rbox(0.012, 0.06, 0.012), STEEL(), 0, 0.03, -0.04);
  add(g, blade(0.17, 0.032, 0.005), POLISHED(), 0, 0.034, -0.046);
  return { muzzle: new THREE.Vector3(0, 0.04, -0.22), scale: 1.1 };
};

const pan: Builder = (g) => {
  add(g, tube(0.012, 0.2, 0.015), WOOD(), 0, 0.03, -0.03);
  add(g, ring(0.013, 0.003), BRASS(), 0, 0.03, 0.07);
  add(g, tube(0.009, 0.06), metal(0x8d9097, 0.3), 0, 0.03, -0.15);
  // The pan stands on edge, so a swing lands with its flat face. Cast iron: only half metallic,
  // so it isn't a black silhouette without reflections (Low quality).
  const body = material('pan:iron', () => new THREE.MeshStandardMaterial({ color: 0x6a6d74, metalness: 0.45, roughness: 0.5 }));
  add(g, geometry('pan:shell', () => new THREE.CylinderGeometry(0.115, 0.1, 0.03, 30).rotateZ(-Math.PI / 2)), body, 0, 0.03, -0.29);
  add(g, ring(0.112, 0.006), POLISHED(), 0.016, 0.03, -0.29, 0, Math.PI / 2);
  add(g, disc(0.104), polymer(0x3c3d43, 0.36), 0.0152, 0.03, -0.29, 0, Math.PI / 2);
  add(g, ball(0.006), metal(0x8d9097, 0.3), 0.008, 0.045, -0.178);
  add(g, ball(0.006), metal(0x8d9097, 0.3), 0.008, 0.015, -0.178);
  return { muzzle: new THREE.Vector3(0, 0.03, -0.4), scale: 1.05 };
};

const katana: Builder = (g, id) => {
  const wrap = polymer(0x3b3566, 0.8);
  add(g, tube(0.0155, 0.24), polymer(WEAPONS[id].model.color, 0.7), 0, 0.03, 0.08);
  for (let i = 0; i < 7; i++) add(g, ring(0.0158, 0.0026), wrap, 0, 0.03, 0.18 - i * 0.033);
  add(g, tube(0.0168, 0.014), BRASS(), 0, 0.03, 0.205);
  add(g, tube(0.04, 0.008), DARK(), 0, 0.03, -0.044);
  add(g, ring(0.04, 0.0025), BRASS(), 0, 0.03, -0.044);
  add(g, rbox(0.012, 0.03, 0.022), BRASS(), 0, 0.031, -0.059);
  add(g, blade(0.72, 0.03, 0.006, 0.022), POLISHED(), 0, 0.031, -0.07);
  return { muzzle: new THREE.Vector3(0, 0.1, -0.79), scale: 1 };
};

const BUILDERS: Record<WeaponId, Builder> = {
  pistol,
  rifle: (g, id) => rifleLike(polymer(WEAPONS[id].model.color), metal(WEAPONS[id].model.accent, 0.4), false)(g, id),
  shotgun,
  sniper,
  smg,
  minigun,
  rocket,
  golden: (g, id) => rifleLike(GOLD(), DARK(), true)(g, id),
  knife,
  pan,
  katana,
};

/** A detailed procedural gun pointing down -Z, held at the origin (the grip). */
export function buildGun(id: WeaponId): GunModel {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const built = BUILDERS[id](parts, id);
  parts.scale.setScalar(built.scale ?? 1);
  group.add(parts);
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(built.muzzle);
  parts.add(muzzle);
  return { group, muzzle, spinner: built.spinner ?? null, magazine: built.magazine ?? null };
}
