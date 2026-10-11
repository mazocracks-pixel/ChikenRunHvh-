import * as THREE from 'three';
import { box, cone, cylinder, part, solid, sphere } from './materials';

/**
 * The event monkeys (Crystal Hunt), original designs built to sit on a chicken's hitbox (the
 * head where the chicken's head is), so shots land where they look. Two of them:
 *
 * - `stalker` (the main one): gaunt and tall, ribs showing through thin matted fur, long jointed
 *   arms ending in claws, a wide jaw that drops open when it attacks, deep-set burning eyes, a
 *   torn ear and a ragged spine.
 * - `classic` (the first version, still about): a hunched, dark-furred ape with long arms, a pale
 *   scarred face, big ears, a curled tail and glowing yellow eyes.
 */
export type MonkeyStyle = 'stalker' | 'classic';

export interface MonkeyModel {
  root: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  /** The stalker's jaw (drops open to bite) and chest (breathes). */
  jaw?: THREE.Group;
  chest?: THREE.Object3D;
}

export function buildMonkey(style: MonkeyStyle = 'stalker'): MonkeyModel {
  return style === 'classic' ? buildClassicMonkey() : buildStalkerMonkey();
}

const FUR = () => solid(0x3a2a20, { flat: false, roughness: 1 });
const FUR_DARK = () => solid(0x241812, { flat: false, roughness: 1 });
const SKIN = () => solid(0xb09178, { flat: false, roughness: 0.8 });
const EYE = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23a).multiplyScalar(2), fog: false });

/** The first monkey (kept as the second design). */
function buildClassicMonkey(): MonkeyModel {
  const root = new THREE.Group();
  const fur = FUR();
  const dark = FUR_DARK();
  const skin = SKIN();

  // A hunched torso leaning forward.
  const torso = part(sphere(0.42, 16, 12), fur, 0, 0.88, 0.02);
  torso.scale.set(1, 1.15, 0.9);
  torso.rotation.x = -0.35;
  const belly = part(sphere(0.3, 14, 10), skin, 0, 0.8, -0.2);
  belly.scale.set(0.9, 1.05, 0.6);
  root.add(torso, belly);

  // The head, at the chicken's head height and forward (where its hitbox is).
  const head = new THREE.Group();
  head.position.set(0, 1.28, -0.42);
  const skull = part(sphere(0.25, 16, 12), fur);
  skull.scale.set(1.05, 0.95, 1);
  const face = part(sphere(0.19, 14, 10), skin, 0, -0.03, -0.12);
  face.scale.set(1, 0.9, 0.7);
  const muzzle = part(sphere(0.12, 12, 8), skin, 0, -0.1, -0.24);
  muzzle.scale.set(1.2, 0.75, 0.9);
  const brow = part(box(0.36, 0.05, 0.08), dark, 0, 0.07, -0.25);
  brow.rotation.x = 0.25;
  const scar = part(box(0.02, 0.14, 0.01), solid(0x6e2a22), 0.08, 0, -0.29);
  scar.rotation.z = 0.4;
  const eyes = [-1, 1].map((s) => part(sphere(0.035, 8, 6), EYE, s * 0.075, 0.01, -0.27));
  const ears = [-1, 1].map((s) => {
    const ear = part(sphere(0.09, 10, 8), skin, s * 0.26, 0.02, -0.02);
    ear.scale.set(0.5, 1, 1);
    return ear;
  });
  // Bared fangs.
  const fangs = [-1, 1].map((s) => {
    const f = part(cone(0.015, 0.06, 5), solid(0xf2ead2), s * 0.04, -0.16, -0.31);
    f.rotation.x = Math.PI;
    return f;
  });
  head.add(skull, face, muzzle, brow, scar, ...eyes, ...ears, ...fangs);
  root.add(head);

  // Long arms that nearly reach the ground (knuckle-walking), shoulders at the top of the torso.
  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.38, 1.05, -0.12);
    const upper = part(cylinder(0.08, 0.07, 0.5, 8), fur, 0, -0.25, 0);
    const lower = part(cylinder(0.07, 0.06, 0.45, 8), fur, 0, -0.68, -0.05);
    const hand = part(sphere(0.08, 8, 6), skin, 0, -0.93, -0.07);
    hand.scale.set(1, 0.7, 1.3);
    g.add(upper, lower, hand);
    root.add(g);
    return g;
  };
  // Short bent legs.
  const leg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.18, 0.55, 0.1);
    const thigh = part(cylinder(0.1, 0.08, 0.32, 8), fur, 0, -0.15, 0);
    const shin = part(cylinder(0.07, 0.06, 0.28, 8), fur, 0, -0.38, 0.05);
    const foot = part(box(0.13, 0.06, 0.24), skin, 0, -0.53, -0.04);
    g.add(thigh, shin, foot);
    root.add(g);
    return g;
  };
  // A tail curling up behind.
  const tail = new THREE.Group();
  tail.position.set(0, 0.6, 0.38);
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI * 0.9;
    tail.add(part(sphere(0.045 - i * 0.004, 6, 5), dark, 0, Math.sin(a) * 0.32, Math.cos(a) * 0.1 + i * 0.07));
  }
  root.add(tail);
  for (const o of root.children) o.castShadow = true;
  return { root, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), head, tail };
}

/** Matted fur: dark streaks and clumps over a grey-brown hide (one texture, made once). */
let furTexture: THREE.CanvasTexture | null = null;
function furTex(): THREE.CanvasTexture {
  if (furTexture) return furTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    g.strokeStyle = `rgba(${20 + Math.random() * 30}, ${12 + Math.random() * 20}, ${8 + Math.random() * 14}, ${0.15 + Math.random() * 0.35})`;
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 4, y + 4 + Math.random() * 8);
    g.stroke();
  }
  // Bald, sore patches.
  for (let i = 0; i < 10; i++) {
    g.fillStyle = 'rgba(150, 90, 80, 0.35)';
    g.beginPath();
    g.ellipse(Math.random() * 128, Math.random() * 128, 4 + Math.random() * 8, 3 + Math.random() * 5, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  furTexture = new THREE.CanvasTexture(c);
  furTexture.wrapS = furTexture.wrapT = THREE.RepeatWrapping;
  furTexture.colorSpace = THREE.SRGBColorSpace;
  return furTexture;
}

const STALKER_EYE = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1a).multiplyScalar(2.2), fog: false });

/** The main monkey: gaunt, tall, clawed, with a jaw that opens. */
function buildStalkerMonkey(): MonkeyModel {
  const root = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: 0x5a4a3e, map: furTex(), bumpMap: furTex(), bumpScale: 1.5, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1f1a, map: furTex(), roughness: 1 });
  const skin = solid(0x9c7f6e, { flat: false, roughness: 0.85 });
  const bone = solid(0xd9ccb0, { flat: false, roughness: 0.6 });
  const gum = solid(0x5e1414, { flat: false, roughness: 0.5 });

  // A thin, hunched torso; ribs pressing through the skin of the chest.
  const chest = new THREE.Group();
  chest.position.set(0, 0.9, 0);
  chest.rotation.x = -0.45;
  const torso = part(sphere(0.34, 16, 12), hide);
  torso.scale.set(0.9, 1.35, 0.75);
  const belly = part(sphere(0.24, 12, 10), skin, 0, -0.08, -0.13);
  belly.scale.set(0.85, 1.2, 0.55);
  chest.add(torso, belly);
  for (let i = 0; i < 4; i++) {
    const rib = part(new THREE.TorusGeometry(0.2 - i * 0.015, 0.018, 5, 14, Math.PI), skin, 0, 0.18 - i * 0.09, -0.12);
    rib.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI);
    chest.add(rib);
  }
  // A ragged spine: tufts of matted fur down the back.
  for (let i = 0; i < 6; i++) {
    const tuft = part(cone(0.05, 0.16, 5), dark, 0, 0.32 - i * 0.12, 0.22);
    tuft.rotation.x = -0.9;
    chest.add(tuft);
  }
  root.add(chest);

  // The head, at the chicken's head height and forward (where its hitbox is).
  const head = new THREE.Group();
  head.position.set(0, 1.3, -0.44);
  const skull = part(sphere(0.22, 16, 12), hide);
  skull.scale.set(1, 0.92, 1.1);
  const brow = part(box(0.34, 0.045, 0.08), dark, 0, 0.1, -0.17);
  brow.rotation.x = 0.35;
  // Deep sockets, with the eyes burning in them.
  const sockets = [-1, 1].map((s) => part(sphere(0.055, 10, 8), solid(0x0c0807), s * 0.08, 0.04, -0.17));
  const eyes = [-1, 1].map((s) => part(sphere(0.034, 8, 6), STALKER_EYE, s * 0.08, 0.04, -0.215));
  const snout = part(sphere(0.12, 12, 8), skin, 0, -0.07, -0.2);
  snout.scale.set(1.1, 0.7, 1);
  // Upper teeth on the snout; the jaw (with its own teeth) hinges below.
  const fangs = [-0.06, -0.02, 0.02, 0.06].map((x) => {
    const f = part(cone(0.012, 0.055, 4), bone, x, -0.13, -0.29);
    f.rotation.x = Math.PI;
    return f;
  });
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.12, -0.12);
  const jawBone = part(box(0.2, 0.05, 0.2), skin, 0, -0.02, -0.1);
  const mouth = part(box(0.16, 0.02, 0.16), gum, 0, 0.012, -0.1);
  const lower = [-0.05, 0, 0.05].map((x) => part(cone(0.011, 0.045, 4), bone, x, 0.03, -0.19));
  jaw.add(jawBone, mouth, ...lower);
  // One whole ear, one torn.
  const ears = [-1, 1].map((s) => {
    const ear = part(sphere(0.08, 10, 8), skin, s * 0.22, 0.05, 0.0);
    ear.scale.set(0.35, s < 0 ? 1 : 0.6, 1);
    return ear;
  });
  head.add(skull, brow, ...sockets, ...eyes, snout, ...fangs, jaw, ...ears);
  root.add(head);

  // Long arms in two parts (elbows), hands with three hooked claws, reaching the ground.
  const arm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.33, 1.12, -0.18);
    g.add(part(cylinder(0.065, 0.05, 0.5, 8), hide, 0, -0.25, 0));
    const fore = new THREE.Group();
    fore.position.set(0, -0.5, 0);
    fore.rotation.x = -0.35;
    fore.add(part(sphere(0.06, 8, 6), hide));
    fore.add(part(cylinder(0.05, 0.035, 0.48, 8), hide, 0, -0.24, 0));
    const hand = part(sphere(0.06, 8, 6), skin, 0, -0.5, -0.02);
    hand.scale.set(1.1, 0.6, 1.3);
    fore.add(hand);
    for (const k of [-1, 0, 1]) {
      const claw = part(cone(0.014, 0.1, 4), bone, k * 0.035, -0.55, -0.07);
      claw.rotation.x = -1.9;
      fore.add(claw);
    }
    g.add(fore);
    root.add(g);
    return g;
  };
  // Bent, digitigrade legs.
  const leg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.16, 0.58, 0.08);
    const thigh = part(cylinder(0.085, 0.06, 0.34, 8), hide, 0, -0.14, -0.05);
    thigh.rotation.x = 0.35;
    const shin = part(cylinder(0.05, 0.04, 0.3, 8), hide, 0, -0.38, 0.06);
    shin.rotation.x = -0.35;
    const foot = part(box(0.11, 0.05, 0.26), skin, 0, -0.55, -0.04);
    g.add(thigh, shin, foot);
    root.add(g);
    return g;
  };
  // A long thin tail, with a ragged tuft at the end.
  const tail = new THREE.Group();
  tail.position.set(0, 0.62, 0.32);
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI * 0.75;
    tail.add(part(sphere(0.035 - i * 0.002, 6, 5), dark, 0, Math.sin(a) * 0.45, Math.cos(a) * 0.08 + i * 0.07));
  }
  tail.add(part(cone(0.05, 0.14, 5), dark, 0, 0.47, 0.62));
  root.add(tail);
  for (const o of root.children) o.castShadow = true;
  return { root, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), head, tail, jaw, chest };
}

/**
 * Knuckle-walking gallop, or a crouched, breathing wait (`moving` 0..1). `bite` 0..1 drops the
 * stalker's jaw (attacking; a little while running).
 */
export function animateMonkey(m: MonkeyModel, phase: number, moving: number, time: number, bite = 0): void {
  if (m.jaw) m.jaw.rotation.x = 0.15 + 0.25 * moving + 0.7 * bite + Math.sin(time * 9) * 0.04;
  if (m.chest) m.chest.scale.set(1, 1 + Math.sin(time * 3.1) * 0.025, 1 + Math.sin(time * 3.1) * 0.04);
  const swing = Math.sin(phase) * 0.9 * moving;
  m.armL.rotation.x = swing - 0.25;
  m.armR.rotation.x = -swing - 0.25;
  m.legL.rotation.x = -swing * 0.7;
  m.legR.rotation.x = swing * 0.7;
  m.root.position.y = Math.abs(Math.sin(phase)) * 0.08 * moving;
  m.head.rotation.z = Math.sin(time * 1.7) * 0.06 * (1 - moving);
  m.tail.rotation.x = Math.sin(time * 2.3) * 0.25;
}
