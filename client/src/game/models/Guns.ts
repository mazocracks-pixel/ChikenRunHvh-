import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, type WeaponId } from '@game/shared';

export interface GunModel {
  group: THREE.Group;
  /** Where bullets visually leave the barrel. */
  muzzle: THREE.Object3D;
  /** Spinning barrel cluster (minigun only). */
  spinner: THREE.Object3D | null;
  /** The part that comes out during a reload (magazine or rocket), or null. */
  magazine: THREE.Object3D | null;
  /** The second gun or dagger of a pair, in the left hand (first person only). */
  offhand: THREE.Object3D | null;
  /** Moving parts for the inspect (F): called with its progress 0..1, or -1 to rest. */
  animate: ((progress: number) => void) | null;
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

/** Brushed metal: fine lengthwise streaks and a few scratches (colour and roughness). */
const metal = (color: number, roughness = 0.34) =>
  material(`metal:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness, map: tex('brushed'), roughnessMap: tex('brushedRough') }));
/** Polymer: a fine stippled grain, slightly bumpy. */
const polymer = (color: number, roughness = 0.68) =>
  material(`poly:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness, map: tex('stipple'), bumpMap: tex('stippleBump'), bumpScale: 0.6 }));
/** Grip panels and knife handles: diamond knurling you can see. */
const grippy = (color: number) =>
  material(`grip:${color}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.82, map: tex('knurl'), bumpMap: tex('knurlBump'), bumpScale: 1.2 }));
const GOLD = () => material('gold', () => new THREE.MeshStandardMaterial({ color: 0xe8b93e, metalness: 1, roughness: 0.22, map: tex('brushed'), roughnessMap: tex('brushedRough') }));
const BRASS = () => metal(0xc9a33a, 0.3);
const STEEL = () => metal(0x2b2e33);
const DARK = () => metal(0x141619, 0.42);
const RUBBER = () => grippy(0x18191b);
const GLASS = () =>
  material('glass', () => new THREE.MeshStandardMaterial({ color: 0x0a2440, metalness: 0.9, roughness: 0.04, emissive: 0x0b3a66, emissiveIntensity: 0.55 }));
const WOOD = () => material('wood', () => new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.58, metalness: 0 }));

// ---------------------------------------------------------------------------
// Surface textures (small, drawn once on a canvas, shared by every gun)
// ---------------------------------------------------------------------------

type TexKind = 'brushed' | 'brushedRough' | 'stipple' | 'stippleBump' | 'knurl' | 'knurlBump' | 'blade' | 'bladeRough';
const textures = new Map<TexKind, THREE.CanvasTexture>();

/** A repeatable random generator, so every texture looks the same every time. */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function tex(kind: TexKind): THREE.CanvasTexture {
  let t = textures.get(kind);
  if (t) return t;
  const blade = kind === 'blade' || kind === 'bladeRough';
  const canvas = document.createElement('canvas');
  canvas.width = blade ? 256 : 128;
  canvas.height = blade ? 64 : 128;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const rand = seeded(kind.length * 977 + 13);
  const gray = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
  switch (kind) {
    case 'brushed':
    case 'brushedRough': {
      // Colour: near white (it tints the material colour). Roughness: mid grey, streaks vary it.
      const rough = kind === 'brushedRough';
      ctx.fillStyle = gray(rough ? 150 : 236);
      ctx.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y++) {
        ctx.fillStyle = gray(rough ? 110 + rand() * 90 : 205 + rand() * 50, 0.55);
        ctx.fillRect(0, y, W, 1);
      }
      for (let i = 0; i < 18; i++) {
        ctx.strokeStyle = gray(rough ? 70 : 255, rough ? 0.8 : 0.6);
        ctx.lineWidth = 0.7;
        const x = rand() * W;
        const y = rand() * H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10 + rand() * 30, y + (rand() - 0.5) * 8);
        ctx.stroke();
      }
      break;
    }
    case 'stipple':
    case 'stippleBump': {
      const bump = kind === 'stippleBump';
      ctx.fillStyle = gray(bump ? 128 : 232);
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 2600; i++) {
        const v = rand() < 0.5 ? (bump ? 90 : 205) : bump ? 175 : 250;
        ctx.fillStyle = gray(v, 0.7);
        ctx.fillRect(rand() * W, rand() * H, 1.2, 1.2);
      }
      break;
    }
    case 'knurl':
    case 'knurlBump': {
      // Diamond knurling: two sets of diagonal grooves.
      const bump = kind === 'knurlBump';
      ctx.fillStyle = gray(bump ? 200 : 236);
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = gray(bump ? 40 : 150, bump ? 1 : 0.8);
      ctx.lineWidth = 2;
      for (let i = -H; i < W + H; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + H, H);
        ctx.moveTo(i, H);
        ctx.lineTo(i + H, 0);
        ctx.stroke();
      }
      break;
    }
    case 'blade':
    case 'bladeRough': {
      // Across the blade (v 0 = the cutting edge, 1 = the spine): a mirror-polished edge bevel,
      // a sharp grind line, satin flats with a fuller groove, and a darker spine.
      const rough = kind === 'bladeRough';
      const bands: [number, number][] = rough
        ? [[0, 40], [0.3, 40], [0.31, 200], [0.32, 120], [0.58, 120], [0.6, 200], [0.68, 200], [0.7, 120], [0.92, 120], [1, 170]]
        : [[0, 255], [0.28, 238], [0.3, 120], [0.32, 205], [0.58, 200], [0.6, 150], [0.68, 165], [0.7, 210], [0.92, 196], [1, 140]];
      const g = ctx.createLinearGradient(0, H, 0, 0);
      for (const [at, v] of bands) g.addColorStop(at, gray(v));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // Brushed lengthwise.
      for (let y = 0; y < H; y++) {
        ctx.fillStyle = gray(rough ? 90 + rand() * 80 : 150 + rand() * 105, 0.18);
        ctx.fillRect(0, y, W, 1);
      }
      break;
    }
  }
  t = new THREE.CanvasTexture(canvas);
  // Colour maps are sRGB; roughness and bump maps are plain data.
  if (kind === 'brushed' || kind === 'stipple' || kind === 'knurl' || kind === 'blade') t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!blade) t.repeat.set(2, 2);
  t.anisotropy = 4;
  textures.set(kind, t);
  return t;
}

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
    // u along the blade (0 at the guard), v across it (0 at the edge): the blade texture's polished
    // edge and fuller then sit in the same place on every blade.
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    uv.needsUpdate = true;
    g.translate(0, 0, -(thickness - bevel * 2) / 2);
    return g.rotateY(Math.PI / 2);
  });

/** An assault-rifle magazine: one curved piece, 0.04 wide, hanging down and sweeping forward. */
const curvedMag = () =>
  geometry('curvedmag', () => {
    // Drawn side on: x = forward (towards -Z), y = up. Front and back edges both curve forward.
    const shape = new THREE.Shape();
    shape.moveTo(-0.032, 0);
    shape.quadraticCurveTo(-0.034, -0.1, 0.046, -0.17);
    shape.lineTo(0.112, -0.15);
    shape.quadraticCurveTo(0.04, -0.09, 0.032, 0);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -0.016);
    // Extrusion depth becomes the width (X); the drawing's x becomes forward (-Z).
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
  offhand?: THREE.Object3D;
  animate?: (progress: number) => void;
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
    // One smooth banana magazine, with a base plate.
    add(mag, curvedMag(), gold ? DARK() : accent, 0, 0.01, 0);
    add(mag, rbox(0.046, 0.014, 0.07), DARK(), 0, -0.168, -0.083, 0.42);
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
// Second wave
// ---------------------------------------------------------------------------

/** Machine pistol: compact receiver, compensator, front stub grip and a long magazine through the grip. */
const mpistol: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.6);
  add(g, rbox(0.04, 0.05, 0.17), body, 0, 0.065, -0.06);
  add(g, box(0.034, 0.01, 0.13), DARK(), 0, 0.094, -0.06);
  for (let i = 0; i < 4; i++) add(g, box(0.038, 0.004, 0.006), DARK(), 0, 0.1, -0.11 + i * 0.03);
  add(g, tube(0.009, 0.05), DARK(), 0, 0.068, -0.17);
  add(g, rbox(0.026, 0.026, 0.042), metal(WEAPONS[id].model.accent, 0.4), 0, 0.068, -0.205);
  for (const side of [-1, 1]) add(g, box(0.004, 0.01, 0.022), polymer(0x050505), side * 0.013, 0.078, -0.205);
  add(g, box(0.005, 0.012, 0.006), DARK(), 0, 0.106, -0.12);
  add(g, rbox(0.024, 0.05, 0.022), RUBBER(), 0, 0.02, -0.13, 0.12);
  grip(g, polymer(0x1c1d1f), 0.0, 0.095, 0.15);
  trigger(g, DARK(), -0.045, 0.02);
  const mag = new THREE.Group();
  mag.position.set(0, -0.03, 0.002);
  add(mag, rbox(0.026, 0.19, 0.032), DARK(), 0, -0.07, 0, 0.15);
  add(mag, rbox(0.03, 0.014, 0.036), polymer(0x1c1d1f), 0, -0.165, 0.014, 0.15);
  g.add(mag);
  return { muzzle: new THREE.Vector3(0, 0.068, -0.23), magazine: mag, scale: 1.05 };
};

/** Revolver: ribbed barrel, fluted cylinder (it drops for the reload), hammer and a walnut grip. */
const revolver: Builder = (g, id) => {
  const steel = metal(WEAPONS[id].model.color, 0.26);
  add(g, rbox(0.032, 0.062, 0.1), steel, 0, 0.062, -0.02);
  add(g, tube(0.012, 0.21), steel, 0, 0.08, -0.175);
  add(g, box(0.012, 0.01, 0.21), steel, 0, 0.094, -0.175);
  add(g, rbox(0.02, 0.018, 0.2), steel, 0, 0.062, -0.17);
  add(g, box(0.004, 0.014, 0.008), DARK(), 0, 0.105, -0.27);
  add(g, disc(0.008), polymer(0x020202), 0, 0.08, -0.281, 0, Math.PI);
  const cylinder = new THREE.Group();
  cylinder.position.set(0, 0.07, -0.035);
  add(cylinder, tube(0.03, 0.06), DARK(), 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(cylinder, box(0.004, 0.012, 0.062), steel, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0, 0, 0, a);
    add(cylinder, disc(0.0065), BRASS(), Math.cos(a + 0.52) * 0.018, Math.sin(a + 0.52) * 0.018, -0.031, 0, Math.PI);
  }
  g.add(cylinder);
  add(g, box(0.01, 0.024, 0.012), steel, 0, 0.1, 0.04, -0.5);
  trigger(g, steel, 0.005, 0.022, 0.02);
  add(g, rbox(0.032, 0.1, 0.05), WOOD(), 0, -0.002, 0.052, 0.38);
  add(g, ball(0.007), BRASS(), 0.017, 0.0, 0.05);
  return { muzzle: new THREE.Vector3(0, 0.08, -0.285), magazine: cylinder, scale: 1.05 };
};

/** Burst rifle: a bullpup with a carry handle and red-dot, the magazine behind the grip. */
const burst: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.58);
  const accent = metal(WEAPONS[id].model.accent, 0.35);
  add(g, rbox(0.07, 0.095, 0.46), body, 0, 0.05, -0.02);
  add(g, rbox(0.06, 0.05, 0.16), body, 0, 0.03, -0.32);
  for (let i = 0; i < 5; i++) add(g, box(0.063, 0.006, 0.02), DARK(), 0, 0.058, -0.27 - i * 0.025);
  add(g, tube(0.011, 0.16), DARK(), 0, 0.06, -0.46);
  add(g, rbox(0.024, 0.024, 0.05), DARK(), 0, 0.06, -0.55);
  for (const z of [-0.2, 0.08]) add(g, rbox(0.016, 0.06, 0.02), accent, 0, 0.125, z);
  add(g, rbox(0.03, 0.016, 0.34), accent, 0, 0.158, -0.06);
  add(g, rbox(0.024, 0.028, 0.05), DARK(), 0, 0.18, -0.1);
  add(g, disc(0.009), GLASS(), 0, 0.182, -0.126, 0, Math.PI);
  grip(g, polymer(0x1c1d1f), -0.11, 0.09, 0.22);
  trigger(g, accent, -0.15, 0.012);
  const mag = new THREE.Group();
  mag.position.set(0, -0.005, 0.07);
  add(mag, rbox(0.04, 0.12, 0.06), DARK(), 0, -0.05, 0, 0.1);
  g.add(mag);
  add(g, rbox(0.074, 0.1, 0.022), RUBBER(), 0, 0.045, 0.22);
  add(g, box(0.003, 0.02, 0.05), DARK(), 0.036, 0.06, 0.02);
  return { muzzle: new THREE.Vector3(0, 0.06, -0.58), magazine: mag, scale: 0.9 };
};

/** Battle rifle: tan furniture, a long barrel with a muzzle brake and a small scope. */
const battle: Builder = (g, id) => {
  const furniture = polymer(WEAPONS[id].model.color, 0.7);
  add(g, rbox(0.056, 0.07, 0.24), DARK(), 0, 0.064, -0.05);
  add(g, rbox(0.062, 0.06, 0.32), furniture, 0, 0.045, -0.3);
  add(g, tube(0.012, 0.3), DARK(), 0, 0.068, -0.56);
  add(g, rbox(0.03, 0.03, 0.06), DARK(), 0, 0.068, -0.73);
  for (const side of [-1, 1]) add(g, box(0.006, 0.014, 0.034), polymer(0x050505), side * 0.016, 0.068, -0.73);
  add(g, tube(0.019, 0.17), DARK(), 0, 0.13, -0.08);
  add(g, tube(0.027, 0.05, 0.019), DARK(), 0, 0.13, -0.18);
  add(g, disc(0.024), GLASS(), 0, 0.13, -0.206, 0, Math.PI);
  for (const z of [-0.12, -0.02]) add(g, box(0.014, 0.034, 0.012), STEEL(), 0, 0.103, z);
  const mag = new THREE.Group();
  mag.position.set(0, 0.0, -0.1);
  add(mag, rbox(0.04, 0.11, 0.065), DARK(), 0, -0.05, 0, 0.05);
  g.add(mag);
  grip(g, furniture, 0.05);
  trigger(g, DARK(), 0.012, 0.012);
  add(g, rbox(0.048, 0.085, 0.3), furniture, 0, 0.03, 0.22, 0.04);
  add(g, rbox(0.052, 0.095, 0.022), RUBBER(), 0, 0.022, 0.37, 0.04);
  add(g, post(0.004, 0.04), STEEL(), 0.036, 0.075, 0.0, 0, 0, Math.PI / 2);
  return { muzzle: new THREE.Vector3(0, 0.068, -0.76), magazine: mag, scale: 0.9 };
};

/** Auto shotgun: a boxy receiver with red trim, slotted heat shield and a drum magazine. */
const autoshotgun: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.6);
  const red = polymer(WEAPONS[id].model.accent, 0.5);
  add(g, rbox(0.068, 0.09, 0.3), body, 0, 0.058, -0.06);
  add(g, box(0.07, 0.012, 0.3), red, 0, 0.105, -0.06);
  add(g, tube(0.017, 0.3), DARK(), 0, 0.075, -0.36);
  add(g, rbox(0.044, 0.04, 0.24), metal(0x3a3d42, 0.5), 0, 0.082, -0.34);
  for (let i = 0; i < 5; i++) add(g, box(0.046, 0.026, 0.012), polymer(0x050505), 0, 0.082, -0.25 - i * 0.04);
  add(g, rbox(0.03, 0.03, 0.04), DARK(), 0, 0.075, -0.52);
  add(g, rbox(0.03, 0.055, 0.03), RUBBER(), 0, 0.01, -0.27, 0.1);
  const drum = new THREE.Group();
  drum.position.set(0, -0.02, -0.1);
  add(drum, geometry('drum:autoshotgun', () => new THREE.CylinderGeometry(0.06, 0.06, 0.05, 20).rotateZ(Math.PI / 2)), DARK(), 0, -0.05, 0);
  add(drum, geometry('drumcap:autoshotgun', () => new THREE.CylinderGeometry(0.03, 0.03, 0.054, 12).rotateZ(Math.PI / 2)), red, 0, -0.05, 0);
  g.add(drum);
  grip(g, polymer(0x1c1d1f), 0.07);
  trigger(g, DARK(), 0.025, 0.012);
  add(g, rbox(0.05, 0.08, 0.2), body, 0, 0.035, 0.2);
  add(g, rbox(0.054, 0.09, 0.022), RUBBER(), 0, 0.03, 0.3);
  return { muzzle: new THREE.Vector3(0, 0.075, -0.54), magazine: drum, scale: 0.95 };
};

/** LMG: heavy barrel with a carry handle, an ammo box and belt, and a folded-out bipod. */
const lmg: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.62);
  add(g, rbox(0.078, 0.1, 0.36), body, 0, 0.06, -0.05);
  add(g, rbox(0.07, 0.05, 0.2), DARK(), 0, 0.118, -0.02);
  add(g, tube(0.02, 0.46), DARK(), 0, 0.07, -0.47);
  for (let i = 0; i < 6; i++) add(g, ring(0.021, 0.003), STEEL(), 0, 0.07, -0.3 - i * 0.05);
  add(g, rbox(0.034, 0.034, 0.06), DARK(), 0, 0.07, -0.72);
  add(g, ring(0.032, 0.006, Math.PI), STEEL(), 0, 0.1, -0.3, 0, Math.PI / 2, 0);
  const box_ = new THREE.Group();
  box_.position.set(0, -0.03, -0.08);
  add(box_, rbox(0.1, 0.09, 0.12), polymer(WEAPONS[id].model.accent, 0.8), 0, -0.04, 0);
  for (let k = 0; k < 4; k++) add(box_, box(0.026, 0.01, 0.012), BRASS(), 0.03 + k * 0.006, 0.02 + k * 0.012, -0.02 + k * 0.004, 0, 0, 0.5);
  g.add(box_);
  // Bipod, folded flat under the barrel.
  for (const side of [-1, 1]) {
    add(g, tube(0.0055, 0.22), DARK(), side * 0.018, 0.04, -0.52);
    add(g, ball(0.008), RUBBER(), side * 0.018, 0.04, -0.635);
  }
  grip(g, polymer(0x1c1d1f), 0.08);
  trigger(g, DARK(), 0.035, 0.012);
  add(g, rbox(0.05, 0.08, 0.24), body, 0, 0.04, 0.24);
  add(g, rbox(0.055, 0.09, 0.022), RUBBER(), 0, 0.035, 0.37);
  return { muzzle: new THREE.Vector3(0, 0.07, -0.75), magazine: box_, scale: 0.88 };
};

/** Scout: a slim light sniper with a skeleton stock and a compact scope. */
const scout: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.62);
  add(g, rbox(0.048, 0.06, 0.26), body, 0, 0.058, -0.05);
  add(g, rbox(0.052, 0.045, 0.26), body, 0, 0.045, -0.3);
  add(g, tube(0.0095, 0.46), DARK(), 0, 0.064, -0.48);
  add(g, rbox(0.022, 0.022, 0.05), DARK(), 0, 0.064, -0.72);
  const scope = DARK();
  add(g, tube(0.017, 0.22), scope, 0, 0.122, -0.05);
  add(g, tube(0.026, 0.05, 0.017), scope, 0, 0.122, -0.185);
  add(g, disc(0.023), GLASS(), 0, 0.122, -0.211, 0, Math.PI);
  add(g, disc(0.016), GLASS(), 0, 0.122, 0.061);
  for (const z of [-0.11, 0.0]) add(g, ring(0.019, 0.004), STEEL(), 0, 0.122, z);
  add(g, post(0.004, 0.044), STEEL(), 0.034, 0.068, 0.04, 0, 0, Math.PI / 2);
  add(g, ball(0.009), STEEL(), 0.058, 0.066, 0.04);
  // Skeleton stock: two bars and a pad.
  add(g, rbox(0.02, 0.016, 0.26), body, 0, 0.075, 0.2);
  add(g, rbox(0.02, 0.016, 0.26), body, 0, 0.0, 0.18, -0.25);
  add(g, rbox(0.044, 0.1, 0.02), RUBBER(), 0, 0.035, 0.33);
  grip(g, polymer(0x1c1d1f), 0.06, 0.085, 0.3);
  trigger(g, DARK(), 0.02, 0.012);
  const mag = new THREE.Group();
  mag.position.set(0, 0.0, -0.07);
  add(mag, rbox(0.034, 0.04, 0.06), DARK(), 0, -0.005, 0);
  g.add(mag);
  return { muzzle: new THREE.Vector3(0, 0.064, -0.75), magazine: mag, scale: 1.0 };
};

/** Crossbow: a wooden stock, metal rail, swept bow limbs with a string, and a bolt ready on the rail. */
const crossbow: Builder = (g) => {
  const wood = WOOD();
  add(g, rbox(0.05, 0.06, 0.5), wood, 0, 0.045, -0.12);
  add(g, box(0.022, 0.012, 0.46), STEEL(), 0, 0.08, -0.16);
  add(g, rbox(0.05, 0.08, 0.22), wood, 0, 0.025, 0.22, 0.12);
  add(g, rbox(0.054, 0.09, 0.02), RUBBER(), 0, 0.012, 0.33, 0.12);
  // Limbs swept back from the riser, and the string from their tips to the latch.
  add(g, rbox(0.05, 0.05, 0.05), DARK(), 0, 0.07, -0.38);
  const tips: [number, number][] = [];
  for (const side of [-1, 1]) {
    const limb = add(g, rbox(0.2, 0.018, 0.026), polymer(0x1c1d1f, 0.5), side * 0.1, 0.07, -0.35, 0, side * 0.32, 0);
    limb.castShadow = true;
    tips.push([side * 0.195, -0.35 + 0.064]);
  }
  for (const [x, z] of tips) {
    const dx = 0 - x;
    const dz = -0.08 - z;
    const len = Math.hypot(dx, dz);
    add(g, box(0.003, 0.003, len), polymer(0xe8e2d0, 0.9), x / 2, 0.08, (z - 0.08) / 2, 0, Math.atan2(dx, dz), 0);
  }
  // The bolt on the rail (it comes off for the reload).
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.092, -0.22);
  add(bolt, tube(0.006, 0.34), WOOD(), 0, 0, 0);
  add(bolt, geometry('cone:bolt', () => new THREE.ConeGeometry(0.012, 0.04, 8).rotateX(-Math.PI / 2)), STEEL(), 0, 0, -0.19);
  for (const r of [0, Math.PI / 2]) add(bolt, box(0.002, 0.024, 0.04), polymer(0xd84343), 0, 0, 0.14, 0, 0, r);
  g.add(bolt);
  add(g, box(0.006, 0.02, 0.01), STEEL(), 0, 0.1, 0.02);
  add(g, ring(0.03, 0.005, Math.PI), STEEL(), 0, 0.04, -0.47, Math.PI, 0, 0);
  trigger(g, STEEL(), 0.05, 0.0);
  return { muzzle: new THREE.Vector3(0, 0.092, -0.43), magazine: bolt, scale: 1.0 };
};

/** Egg launcher: a fat barrel, a pump grip and a revolving drum with eggs in the chambers. */
const launcher: Builder = (g, id) => {
  const body = polymer(WEAPONS[id].model.color, 0.55);
  const dark = polymer(WEAPONS[id].model.accent, 0.6);
  add(g, tube(0.042, 0.32), dark, 0, 0.08, -0.3);
  add(g, tube(0.046, 0.03), body, 0, 0.08, -0.47);
  add(g, disc(0.034), polymer(0x050505), 0, 0.08, -0.486, 0, Math.PI);
  add(g, rbox(0.06, 0.05, 0.12), RUBBER(), 0, 0.02, -0.28);
  const drum = new THREE.Group();
  drum.position.set(0, 0.06, -0.06);
  add(drum, tube(0.075, 0.13), body, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const egg = add(drum, ball(0.022), polymer(0xfff3d6, 0.4), Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.066);
    egg.scale.set(1, 1, 1.3);
  }
  add(drum, tube(0.02, 0.135), dark, 0, 0, 0);
  g.add(drum);
  add(g, rbox(0.04, 0.03, 0.08), dark, 0, 0.145, -0.1);
  add(g, box(0.006, 0.02, 0.006), dark, 0, 0.17, -0.13);
  grip(g, dark, 0.06);
  trigger(g, dark, 0.02, 0.0);
  add(g, rbox(0.05, 0.08, 0.2), body, 0, 0.04, 0.18);
  add(g, rbox(0.055, 0.09, 0.022), RUBBER(), 0, 0.04, 0.28);
  return { muzzle: new THREE.Vector3(0, 0.08, -0.49), magazine: drum, scale: 0.95 };
};

// ---------------------------------------------------------------------------
// Melee (held at the handle, pointing down -Z like the guns)
// ---------------------------------------------------------------------------

/** Blade steel: only half metallic, so it still reads as bright steel without reflections (Low quality). */
const POLISHED = () => material('blade', () => new THREE.MeshStandardMaterial({ color: 0xf2f5f8, metalness: 0.6, roughness: 0.32, map: tex('blade'), roughnessMap: tex('bladeRough') }));
const GOLD_BLADE = () => material('blade:gold', () => new THREE.MeshStandardMaterial({ color: 0xf0c04a, metalness: 0.95, roughness: 0.3, map: tex('blade'), roughnessMap: tex('bladeRough') }));

const knife: Builder = (g, id) => knifeWith(id === 'goldknife' ? GOLD_BLADE() : POLISHED())(g, id);

function knifeWith(bladeMaterial: THREE.Material): Builder {
  return (g, id) => {
  const handle = grippy(WEAPONS[id].model.color);
  add(g, rbox(0.026, 0.034, 0.11), handle, 0, 0.03, 0.02);
  for (let i = 0; i < 3; i++) add(g, box(0.028, 0.005, 0.012), RUBBER(), 0, 0.0145, 0.05 - i * 0.028);
  add(g, rbox(0.03, 0.038, 0.012), DARK(), 0, 0.03, 0.08);
  add(g, ring(0.007, 0.0018), STEEL(), 0, 0.03, 0.093, 0, Math.PI / 2);
  add(g, rbox(0.012, 0.06, 0.012), STEEL(), 0, 0.03, -0.04);
  for (const s of [-1, 1]) add(g, ball(0.006), STEEL(), 0, 0.03 + s * 0.03, -0.04);
  add(g, blade(0.17, 0.032, 0.005), bladeMaterial, 0, 0.034, -0.046);
  if (id === 'goldknife') add(g, rbox(0.032, 0.04, 0.014), GOLD(), 0, 0.03, 0.08);
  return { muzzle: new THREE.Vector3(0, 0.04, -0.22), scale: 1.1 };
  };
}

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

// ---------------------------------------------------------------------------
// Third wave: pistols and CS2-style knives
// ---------------------------------------------------------------------------

/** Smooth 0→1 over [from, to] of the inspect (0 before, 1 after). */
const window01 = (p: number, from: number, to: number) => {
  const k = Math.min(1, Math.max(0, (p - from) / (to - from)));
  return k * k * (3 - 2 * k);
};

/** A pistol magazine that drops out of the grip on reload. */
function pistolMag(g: THREE.Object3D, body: THREE.Material, height = 0.085, z = 0.02): THREE.Group {
  const mag = new THREE.Group();
  mag.position.set(0, -0.078, z);
  add(mag, rbox(0.036, 0.012, 0.05), DARK(), 0, 0, 0);
  add(mag, rbox(0.026, height, 0.034), body, 0, height / 2 + 0.002, -0.008, 0.22);
  g.add(mag);
  return mag;
}

/** Deagle: a big stainless slide with a top rib, hammer, chunky grip. Hits like a truck. */
const deagle: Builder = (g, id) => {
  const steel = metal(WEAPONS[id].model.color, 0.24);
  add(g, rbox(0.044, 0.05, 0.26), steel, 0, 0.078, -0.1);
  add(g, box(0.018, 0.008, 0.25), steel, 0, 0.106, -0.1);
  for (let i = 0; i < 7; i++) add(g, box(0.0462, 0.03, 0.003), DARK(), 0, 0.08, 0.016 - i * 0.007);
  add(g, box(0.0455, 0.005, 0.14), DARK(), 0, 0.058, -0.16);
  add(g, rbox(0.04, 0.03, 0.2), steel, 0, 0.04, -0.07);
  add(g, tube(0.011, 0.012), DARK(), 0, 0.08, -0.234);
  add(g, disc(0.0075), polymer(0x020202), 0, 0.08, -0.2405, 0, Math.PI);
  add(g, box(0.006, 0.012, 0.008), DARK(), 0, 0.115, -0.215);
  add(g, box(0.026, 0.01, 0.01), DARK(), 0, 0.114, 0.012);
  add(g, box(0.012, 0.022, 0.014), steel, 0, 0.096, 0.045, -0.5);
  grip(g, polymer(WEAPONS[id].model.accent, 0.8), 0.014, 0.112, 0.24);
  trigger(g, steel, -0.042, 0.02, 0.024);
  const mag = pistolMag(g, steel, 0.09, 0.024);
  return { muzzle: new THREE.Vector3(0, 0.08, -0.245), magazine: mag, scale: 1.08 };
};

/** Five-Seven: a long slim black slide on a tan frame, squared-off trigger guard, long grip (20 rounds). */
const fiveseven: Builder = (g, id) => {
  const frame = polymer(WEAPONS[id].model.color, 0.62);
  const slide = metal(WEAPONS[id].model.accent, 0.42);
  add(g, rbox(0.034, 0.038, 0.215), slide, 0, 0.075, -0.088);
  for (let i = 0; i < 6; i++) add(g, box(0.0352, 0.022, 0.003), DARK(), 0, 0.077, 0.012 - i * 0.007);
  add(g, rbox(0.032, 0.028, 0.19), frame, 0, 0.04, -0.078);
  add(g, box(0.026, 0.006, 0.06), frame, 0, 0.024, -0.145);
  add(g, box(0.006, 0.005, 0.052), frame, 0, -0.004, -0.04);
  add(g, box(0.006, 0.03, 0.006), frame, 0, 0.01, -0.064);
  add(g, box(0.006, 0.018, 0.006), DARK(), 0, 0.012, -0.034, 0.35);
  add(g, tube(0.008, 0.012), DARK(), 0, 0.075, -0.199);
  add(g, box(0.005, 0.009, 0.006), DARK(), 0, 0.099, -0.185);
  add(g, box(0.022, 0.009, 0.008), DARK(), 0, 0.099, 0.012);
  grip(g, frame, 0.006, 0.118, 0.2);
  const mag = pistolMag(g, DARK(), 0.1, 0.022);
  return { muzzle: new THREE.Vector3(0, 0.075, -0.206), magazine: mag, scale: 1.05 };
};

/** One of the Dual Pistols: a silver slide with an open top over the barrel. */
function dualPistol(g: THREE.Object3D, id: WeaponId): void {
  const slide = metal(WEAPONS[id].model.color, 0.22);
  add(g, rbox(0.036, 0.04, 0.2), slide, 0, 0.072, -0.08);
  add(g, box(0.022, 0.012, 0.09), DARK(), 0, 0.088, -0.11);
  add(g, tube(0.0085, 0.02), STEEL(), 0, 0.074, -0.188);
  add(g, rbox(0.033, 0.026, 0.16), polymer(WEAPONS[id].model.accent, 0.6), 0, 0.037, -0.066);
  add(g, box(0.005, 0.008, 0.006), DARK(), 0, 0.097, -0.165);
  grip(g, polymer(WEAPONS[id].model.accent, 0.7), 0.008, 0.1, 0.22);
  trigger(g, slide, -0.035, 0.02);
}

/** Dual Pistols: one in each hand (the left one only shows in first person). */
const dualies: Builder = (g, id) => {
  dualPistol(g, id);
  const mag = pistolMag(g, STEEL());
  const offhand = new THREE.Group();
  offhand.position.set(-0.62, 0.01, 0.02);
  offhand.rotation.y = -0.06;
  dualPistol(offhand, id);
  g.add(offhand);
  return { muzzle: new THREE.Vector3(0, 0.074, -0.2), magazine: mag, offhand, scale: 1 };
};

/** Silenced pistol: a slim pistol with a long suppressor screwed on the barrel. */
const silenced: Builder = (g, id) => {
  const slide = metal(WEAPONS[id].model.color, 0.4);
  add(g, rbox(0.036, 0.04, 0.19), slide, 0, 0.072, -0.075);
  for (let i = 0; i < 5; i++) add(g, box(0.0372, 0.024, 0.003), DARK(), 0, 0.073, 0.008 - i * 0.008);
  add(g, rbox(0.033, 0.026, 0.16), polymer(WEAPONS[id].model.accent), 0, 0.037, -0.065);
  add(g, box(0.028, 0.008, 0.05), DARK(), 0, 0.022, -0.12);
  add(g, tube(0.009, 0.02), DARK(), 0, 0.074, -0.18);
  const can = polymer(0x1b1c20, 0.45);
  add(g, tube(0.0175, 0.17), can, 0, 0.074, -0.272);
  add(g, ring(0.0176, 0.0022), STEEL(), 0, 0.074, -0.19);
  add(g, ring(0.0176, 0.0022), STEEL(), 0, 0.074, -0.356);
  for (let i = 0; i < 3; i++) add(g, ring(0.0177, 0.0012), DARK(), 0, 0.074, -0.23 - i * 0.04);
  add(g, disc(0.006), polymer(0x020202), 0, 0.074, -0.3575, 0, Math.PI);
  add(g, box(0.006, 0.012, 0.006), DARK(), 0, 0.1, -0.16);
  add(g, box(0.024, 0.012, 0.008), DARK(), 0, 0.1, 0.012);
  grip(g, polymer(WEAPONS[id].model.accent), 0.008, 0.1, 0.22);
  trigger(g, polymer(WEAPONS[id].model.accent), -0.035, 0.02);
  const mag = pistolMag(g, STEEL());
  return { muzzle: new THREE.Vector3(0, 0.074, -0.36), magazine: mag, scale: 1.05 };
};

/**
 * Butterfly knife: two handles and the blade, each on its own pin. Inspect: the blade fans round
 * the pin three times while the free handle swings out and back.
 */
const butterfly: Builder = (g, id) => {
  const handleMat = metal(WEAPONS[id].model.color, 0.3);
  const pivotZ = -0.055;
  const handle = (parent: THREE.Object3D, x: number, z: number) => {
    add(parent, rbox(0.011, 0.028, 0.125), handleMat, x, 0, z);
    for (let i = 0; i < 3; i++) add(parent, box(0.0115, 0.012, 0.02), DARK(), x, 0, z - 0.035 + i * 0.035);
  };
  const held = new THREE.Group();
  held.position.set(0, 0.03, 0);
  handle(held, 0.0065, pivotZ + 0.0625);
  add(held, box(0.004, 0.006, 0.022), STEEL(), 0, -0.016, 0.06);
  g.add(held);
  const free = new THREE.Group();
  free.position.set(0, 0.03, pivotZ);
  handle(free, -0.0065, 0.0625);
  g.add(free);
  const swing = new THREE.Group();
  swing.position.set(0, 0.03, pivotZ);
  add(swing, blade(0.15, 0.03, 0.005), POLISHED(), 0, 0.004, -0.004);
  add(swing, post(0.0055, 0.032), STEEL(), 0, 0, 0, 0, 0, Math.PI / 2);
  g.add(swing);
  const animate = (p: number) => {
    const e = p < 0 ? 0 : window01(p, 0.14, 0.86);
    swing.rotation.x = -e * Math.PI * 6;
    free.rotation.x = -(1 - Math.cos(e * Math.PI * 6)) * 0.5 * Math.PI;
  };
  return { muzzle: new THREE.Vector3(0, 0.035, -0.21), scale: 1.1, animate };
};

/** Karambit: a curved claw blade and a finger ring. Inspect: it spins twice around your finger. */
const karambit: Builder = (g, id) => {
  const ringZ = 0.078;
  const spin = new THREE.Group();
  spin.position.set(0, 0.03, ringZ);
  const parts = new THREE.Group();
  parts.position.set(0, -0.03, -ringZ);
  spin.add(parts);
  const handle = polymer(WEAPONS[id].model.color, 0.6);
  add(parts, rbox(0.022, 0.03, 0.095), handle, 0, 0.03, 0.022, 0.16);
  for (let i = 0; i < 3; i++) add(parts, box(0.0225, 0.006, 0.01), RUBBER(), 0, 0.022, 0.0 + i * 0.025, 0.16);
  add(parts, ring(0.021, 0.0055), STEEL(), 0, 0.03, ringZ, 0, Math.PI / 2);
  add(parts, rbox(0.024, 0.034, 0.01), DARK(), 0, 0.034, -0.027);
  add(parts, blade(0.13, 0.03, 0.005, -0.048), POLISHED(), 0, 0.042, -0.03, 0.3);
  g.add(spin);
  const animate = (p: number) => {
    spin.rotation.x = p < 0 ? 0 : -window01(p, 0.2, 0.72) * Math.PI * 4;
  };
  return { muzzle: new THREE.Vector3(0, 0.03, -0.18), scale: 1.15, animate };
};

/** M9 Bayonet: a big clip-point blade with saw teeth, a muzzle ring on the guard. Inspect: a flip toss. */
const m9: Builder = (g, id) => {
  const spin = new THREE.Group();
  spin.position.set(0, 0.03, -0.05);
  const parts = new THREE.Group();
  parts.position.set(0, -0.03, 0.05);
  spin.add(parts);
  const handle = polymer(WEAPONS[id].model.color, 0.75);
  add(parts, rbox(0.026, 0.036, 0.12), handle, 0, 0.03, 0.025);
  for (let i = 0; i < 5; i++) add(parts, box(0.0275, 0.004, 0.008), RUBBER(), 0, 0.0125, 0.068 - i * 0.022);
  add(parts, rbox(0.03, 0.03, 0.022), STEEL(), 0, 0.03, 0.094);
  add(parts, rbox(0.012, 0.075, 0.012), STEEL(), 0, 0.034, -0.04);
  add(parts, ring(0.011, 0.0035), STEEL(), 0, 0.077, -0.04);
  add(parts, blade(0.2, 0.044, 0.006), POLISHED(), 0, 0.036, -0.047);
  for (let i = 0; i < 7; i++) add(parts, box(0.0045, 0.008, 0.008), POLISHED(), 0, 0.058, -0.072 - i * 0.012, Math.PI / 4);
  g.add(spin);
  const animate = (p: number) => {
    const k = p < 0 ? 0 : window01(p, 0.32, 0.6);
    spin.rotation.x = -k * Math.PI * 2;
    spin.position.y = 0.03 + Math.sin(k * Math.PI) * 0.16;
  };
  return { muzzle: new THREE.Vector3(0, 0.04, -0.26), scale: 1.05, animate };
};

/** One push dagger: a T-handle in the fist, the blade sticking out between the fingers. */
function pushDagger(g: THREE.Object3D, id: WeaponId): THREE.Group {
  const d = new THREE.Group();
  d.position.set(0, 0.03, 0);
  add(d, rbox(0.075, 0.024, 0.026), polymer(WEAPONS[id].model.color, 0.55), 0, 0, 0.02);
  add(d, rbox(0.012, 0.018, 0.03), STEEL(), 0, 0, -0.008);
  add(d, blade(0.11, 0.036, 0.005), POLISHED(), 0, 0.002, -0.022);
  g.add(d);
  return d;
}

/** Shadow Daggers: one in each hand. Inspect: both twirl. */
const daggers: Builder = (g, id) => {
  const right = pushDagger(g, id);
  const offhand = new THREE.Group();
  offhand.position.set(-0.62, 0, 0.02);
  const left = pushDagger(offhand, id);
  g.add(offhand);
  const animate = (p: number) => {
    const e = p < 0 ? 0 : window01(p, 0.18, 0.8);
    right.rotation.z = e * Math.PI * 4;
    left.rotation.z = -e * Math.PI * 4;
  };
  return { muzzle: new THREE.Vector3(0, 0.03, -0.14), offhand, scale: 1.1, animate };
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
  mpistol,
  revolver,
  burst,
  battle,
  autoshotgun,
  lmg,
  scout,
  crossbow,
  launcher,
  goldknife: knife,
  deagle,
  fiveseven,
  dualies,
  silenced,
  butterfly,
  karambit,
  m9,
  daggers,
};

/** Baked geometry per weapon, group and material: made the first time, shared by every copy after. */
const baked = new Map<string, THREE.BufferGeometry>();

/**
 * A gun is dozens of small parts, each its own draw call (and again for shadows). Every group's own
 * meshes are merged into one mesh per material, so a gun draws in a handful of calls. Groups that
 * move (magazine, minigun barrels, knife-trick parts) stay groups, merged inside, and other objects
 * (the muzzle) are kept as they are. The builders are deterministic, so the key is the group's path.
 */
function bake(group: THREE.Object3D, key: string): void {
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  [...group.children].forEach((child, i) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && child.children.length === 0 && !Array.isArray(mesh.material)) {
      const list = byMaterial.get(mesh.material) ?? [];
      list.push(mesh);
      byMaterial.set(mesh.material, list);
    } else bake(child, `${key}/${i}`);
  });
  for (const [mat, meshes] of byMaterial) {
    if (meshes.length < 2) continue;
    const k = `${key}|${mat.uuid}`;
    let geo = baked.get(k);
    if (!geo) {
      const parts = meshes.map((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        g.clearGroups();
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) continue;
      baked.set(k, (geo = merged));
    }
    for (const m of meshes) group.remove(m);
    const one = new THREE.Mesh(geo, mat);
    one.castShadow = true;
    group.add(one);
  }
}

/** A detailed procedural gun pointing down -Z, held at the origin (the grip). */
export function buildGun(id: WeaponId): GunModel {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const built = BUILDERS[id](parts, id);
  bake(parts, id);
  parts.scale.setScalar(built.scale ?? 1);
  group.add(parts);
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(built.muzzle);
  parts.add(muzzle);
  return { group, muzzle, spinner: built.spinner ?? null, magazine: built.magazine ?? null, offhand: built.offhand ?? null, animate: built.animate ?? null };
}
