import * as THREE from 'three';
import { box, cone, cylinder, part, solid, sphere } from './materials';

/**
 * The event monkeys (Crystal Hunt): an original design, a hunched, dark-furred ape with very
 * long arms, a pale scarred face, big ears, a curled tail and glowing yellow eyes. Built to sit
 * on a chicken's hitbox (the head where the chicken's head is), so shots land where they look.
 */
export interface MonkeyModel {
  root: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
}

const FUR = () => solid(0x3a2a20, { flat: false, roughness: 1 });
const FUR_DARK = () => solid(0x241812, { flat: false, roughness: 1 });
const SKIN = () => solid(0xb09178, { flat: false, roughness: 0.8 });
const EYE = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23a).multiplyScalar(2), fog: false });

export function buildMonkey(): MonkeyModel {
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

/** Knuckle-walking gallop, or a crouched, breathing wait (`moving` 0..1). */
export function animateMonkey(m: MonkeyModel, phase: number, moving: number, time: number): void {
  const swing = Math.sin(phase) * 0.9 * moving;
  m.armL.rotation.x = swing - 0.25;
  m.armR.rotation.x = -swing - 0.25;
  m.legL.rotation.x = -swing * 0.7;
  m.legR.rotation.x = swing * 0.7;
  m.root.position.y = Math.abs(Math.sin(phase)) * 0.08 * moving;
  m.head.rotation.z = Math.sin(time * 1.7) * 0.06 * (1 - moving);
  m.tail.rotation.x = Math.sin(time * 2.3) * 0.25;
}
