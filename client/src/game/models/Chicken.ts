import * as THREE from 'three';
import { CHICKEN_POSE, chickenHeadPose, bodyScale, PLAYER, TEAM_COLORS, clamp, damp, getItem, type Appearance, type Team, type WeaponId } from '@game/shared';
import { buildGun, type GunModel } from './Guns';
import { buildHat } from './Hats';
import { box, cone, cylinder, part, solid, sphere } from './materials';

/** How long a third-person melee swing takes. */
const SWING_SECONDS = 0.3;
/** How long a third-person inspect takes (same as first person). */
const INSPECT_SECONDS = 2.4;

const GEO = {
  body: sphere(0.42, 24, 18),
  head: sphere(CHICKEN_POSE.headRadius, 20, 16),
  tail: sphere(0.2, 12, 10),
  wing: sphere(0.3, 16, 12),
  comb: sphere(0.075, 10, 8),
  wattle: sphere(0.06, 10, 8),
  eye: sphere(0.062, 12, 10),
  pupil: sphere(0.034, 10, 8),
  glint: sphere(0.012, 6, 4),
  brow: box(0.11, 0.027, 0.036),
  scarfTail: box(0.1, 0.24, 0.04),
  beak: cone(0.075, 0.18, 8),
  leg: cylinder(0.035, 0.035, 0.42, 6),
  foot: box(0.16, 0.035, 0.22),
  shoe: box(0.17, 0.09, 0.27),
  sole: box(0.18, 0.025, 0.28),
  scarf: new THREE.TorusGeometry(0.21, 0.05, 6, 14),
  tank: cylinder(0.07, 0.07, 0.36, 10),
  flame: cone(0.07, 0.3, 8),
};

const MAT = {
  red: solid(0xef5538, { flat: false, roughness: 0.6 }),
  eye: solid(0xfff8e7, { flat: false, roughness: 0.25 }),
  pupil: solid(0x17282c, { flat: false, roughness: 0.15 }),
  legs: solid(0xffb23b),
  sole: solid(0xfafafa),
  tank: solid(0x9aa0a6, { metal: true }),
};

const flameMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa726).multiplyScalar(2.5), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });

/** A soft dark spot under the feet, used when real shadows are turned off. */
let blobMaterial: THREE.MeshBasicMaterial | null = null;
function blobShadowMaterial(): THREE.MeshBasicMaterial {
  if (blobMaterial) return blobMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  return blobMaterial;
}
const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Draw order for the wallhack: silhouettes after the level, the chicken after its silhouette. */
const XRAY_ORDER = 5;
const XRAY_BODY_ORDER = 6;

/** Death animation timing (seconds): hop and spin, lie there twitching, then vanish in a puff. */
const DEATH_FALL = 0.5;
const DEATH_VANISH = 2.2;
const DEATH_SHRINK = 0.25;

/** Head-top position (where hats sit), relative to the feet. */
const HEAD_TOP = new THREE.Vector3(0, 1.47, -0.32);
const NECK_REST = new THREE.Vector3(0, CHICKEN_POSE.neckHeight, -CHICKEN_POSE.neckForward);

/**
 * A low-poly chicken built from primitives. Origin is at the feet; it faces -Z.
 * Cosmetics, team colours and the held weapon can change at any time.
 */
export class Chicken {
  /** Set by the graphics quality: draw a fake shadow when the real ones are off. */
  static blobShadows = false;

  readonly root = new THREE.Group();
  private readonly blob = new THREE.Mesh(blobGeometry, blobShadowMaterial().clone());

  private readonly pose = new THREE.Group();
  private readonly bodyPivot = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly wingL = new THREE.Group();
  private readonly wingR = new THREE.Group();
  private readonly gunPivot = new THREE.Group();
  private readonly jetpack = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];
  private readonly combs: THREE.Mesh[] = [];
  private readonly feet: THREE.Mesh[] = [];
  private readonly shoes: THREE.Group[] = [];
  private readonly scarf: THREE.Mesh;
  private readonly scarfTails: THREE.Mesh[] = [];
  private readonly featherMeshes: THREE.Mesh[] = [];
  private readonly wingMeshes: THREE.Mesh[] = [];
  private beak!: THREE.Mesh;
  private hat: THREE.Group | null = null;
  private gun: GunModel | null = null;
  private gunId: WeaponId | null = null;

  private time = Math.random() * 10;
  private walkPhase = 0;
  /** Let the head bob while running (only for chickens that aren't in a match). */
  headBob = false;
  private walkBlend = 0;
  private flapBlend = 0;
  private deadTime = -1;
  private crouchTarget = 1;
  private crouchScale = 1;
  private deathSpin = 1;
  private deathSide = 1;
  private vanished = false;
  /** Called once when a dead chicken vanishes (for the feather puff and sound). */
  onVanish: ((at: THREE.Vector3) => void) | null = null;
  private recoil = 0;
  /** Seconds into a melee swing, or -1. */
  private swingTime = -1;
  /** Seconds into an inspect (F), or -1. */
  private inspectTime = -1;

  constructor(appearance: Appearance, team: Team = 0) {
    const feather = solid(0xffffff);
    const body = part(GEO.body, feather, 0, 0.78, 0);
    body.scale.set(1, 0.9, 1.15);
    // A five-feather fan makes the silhouette read as a chicken from behind, too.
    const tails = [-2, -1, 0, 1, 2].map((side) => {
      const t = part(GEO.tail, feather, side * 0.085, 1.06 - Math.abs(side) * 0.045, 0.42);
      t.scale.set(0.35, 1.22 - Math.abs(side) * 0.1, 0.48);
      t.rotation.set(0.55, 0, -side * 0.35);
      return t;
    });
    this.featherMeshes.push(body, ...tails);

    const head = part(GEO.head, feather, 0, CHICKEN_POSE.headHeight, -CHICKEN_POSE.headForward);
    this.featherMeshes.push(head);
    this.beak = part(GEO.beak, MAT.legs, 0, 1.22, -0.62);
    this.beak.scale.set(1.2, 1, 0.8);
    this.beak.rotation.x = -Math.PI / 2;
    const wattle = part(GEO.wattle, MAT.red, 0, 1.08, -0.52);
    wattle.scale.set(1, 1.4, 1);
    const eyes: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const eye = part(GEO.eye, MAT.eye, side * 0.135, 1.31, -0.505);
      eye.scale.set(1.05, 1.12, 1);
      const brow = part(GEO.brow, MAT.pupil, side * 0.135, 1.377, -0.533);
      brow.rotation.z = side * 0.22;
      eyes.push(eye, part(GEO.pupil, MAT.pupil, side * 0.15, 1.315, -0.553), part(GEO.glint, MAT.eye, side * 0.15 - 0.01, 1.327, -0.579), brow);
    }
    for (const [y, z] of [
      [1.52, -0.4],
      [1.55, -0.3],
      [1.52, -0.2],
    ] as const) {
      const comb = part(GEO.comb, MAT.red, 0, y, z);
      this.combs.push(comb);
      this.headGroup.add(comb);
    }
    this.headGroup.add(head, this.beak, wattle, ...eyes);
    // Rotate the head around the neck, not the feet.
    this.headGroup.position.copy(NECK_REST);
    for (const child of this.headGroup.children) child.position.sub(NECK_REST);

    this.scarf = part(GEO.scarf, MAT.red, 0, 1.03, -0.2);
    this.scarf.rotation.x = Math.PI / 2 - 0.25;
    this.bodyPivot.add(body, ...tails, this.scarf);
    // Keep the physical head stable while the decorative body feathers bob during a walk.
    this.pose.add(this.headGroup);
    for (const side of [-1, 1]) {
      const tail = part(GEO.scarfTail, MAT.red, side * 0.065, 0.91, -0.42);
      tail.rotation.x = -0.25;
      tail.rotation.z = side * 0.15;
      this.scarfTails.push(tail);
      this.bodyPivot.add(tail);
    }

    for (const [wing, side] of [
      [this.wingL, -1],
      [this.wingR, 1],
    ] as const) {
      const w = part(GEO.wing, feather, 0, -0.12, 0);
      w.scale.set(0.3, 0.75, 1);
      this.wingMeshes.push(w);
      wing.add(w);
      wing.position.set(side * 0.4, 0.88, 0.02);
      this.bodyPivot.add(wing);
    }

    for (const [leg, side] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as const) {
      const foot = part(GEO.foot, MAT.legs, 0, -0.43, -0.05);
      this.feet.push(foot);
      const shoe = new THREE.Group();
      shoe.add(part(GEO.shoe, MAT.legs, 0, -0.39, -0.05), part(GEO.sole, MAT.sole, 0, -0.44, -0.05));
      shoe.visible = false;
      this.shoes.push(shoe);
      leg.add(part(GEO.leg, MAT.legs, 0, -0.21, 0), foot, shoe);
      leg.position.set(side * 0.14, 0.45, 0.02);
      this.pose.add(leg);
    }

    // Jetpack: two tanks on the back, flames underneath while thrusting.
    for (const side of [-1, 1]) {
      this.jetpack.add(part(GEO.tank, MAT.tank, side * 0.1, 0, 0));
      const flame = new THREE.Mesh(GEO.flame, flameMaterial);
      flame.position.set(side * 0.1, -0.33, 0);
      flame.rotation.x = Math.PI;
      flame.visible = false;
      this.flames.push(flame);
      this.jetpack.add(flame);
    }
    this.jetpack.position.set(0, 0.9, 0.42);
    this.jetpack.visible = false;
    this.bodyPivot.add(this.jetpack);

    this.gunPivot.position.set(0.3, 0.95, -0.28);
    this.bodyPivot.add(this.gunPivot);
    this.pose.add(this.bodyPivot);
    this.blob.scale.set(1.1, 1, 1.3);
    this.blob.position.y = 0.02;
    this.blob.renderOrder = 1;
    this.blob.visible = Chicken.blobShadows;
    this.root.add(this.pose, this.blob);

    this.setAppearance(appearance);
    this.setTeam(team);
  }

  private xrayMaterial: THREE.Material | null | undefined;
  private chamsMaterial: THREE.Material | null = null;
  private readonly originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  setAppearance(a: Appearance): void {
    this.setChams(null);
    this.xrayMaterial = undefined;
    const skin = getItem('skin', a.skin) ?? getItem('skin', 'white')!;
    const feather = solid(skin.color ?? 0xffffff, { metal: skin.metal, roughness: skin.metal ? 0.3 : 0.8, flat: false });
    const wing = solid(new THREE.Color(skin.color ?? 0xffffff).multiplyScalar(0.88).getHex(), { metal: skin.metal, roughness: skin.metal ? 0.3 : 0.8, flat: false });
    for (const m of this.featherMeshes) m.material = feather;
    for (const m of this.wingMeshes) m.material = wing;

    const beak = getItem('beak', a.beak) ?? getItem('beak', 'orange')!;
    this.beak.material = solid(beak.color ?? 0xf5a623, { metal: beak.metal });

    const shoes = getItem('shoes', a.shoes);
    const hasShoes = !!shoes && a.shoes !== 'none';
    for (const f of this.feet) f.visible = !hasShoes;
    for (const s of this.shoes) {
      s.visible = hasShoes;
      if (hasShoes) (s.children[0] as THREE.Mesh).material = solid(shoes!.color ?? 0xffffff, { metal: shoes!.metal });
    }

    this.hat?.removeFromParent();
    this.hat = buildHat(a.hat);
    for (const comb of this.combs) comb.visible = !this.hat;
    if (this.hat) {
      this.hat.position.copy(HEAD_TOP).sub(NECK_REST);
      this.headGroup.add(this.hat);
    }
  }

  setTeam(team: Team): void {
    for (const cloth of [this.scarf, ...this.scarfTails]) {
      cloth.visible = team !== 0;
      if (team !== 0) cloth.material = solid(TEAM_COLORS[team]);
    }
  }

  setWeapon(id: WeaponId | null): void {
    if (id === this.gunId) return;
    this.xrayMaterial = undefined;
    this.gunId = id;
    this.gun?.group.removeFromParent();
    this.gun = id ? buildGun(id) : null;
    // A pair (Dual Pistols, Shadow Daggers): only the right-hand one sits in the wing.
    if (this.gun?.offhand) this.gun.offhand.visible = false;
    if (this.gun) this.gunPivot.add(this.gun.group);
  }

  /** Tilts the gun and head with the aim pitch. */
  setAim(pitch: number): void {
    this.gunPivot.rotation.x = clamp(pitch, -1.2, 1.2);
    const { tilt, tuck } = chickenHeadPose(pitch);
    this.headGroup.rotation.x = tilt;
    this.headGroup.position.y = CHICKEN_POSE.neckHeight - tuck;
  }

  setJetpack(hasFuel: boolean, firing: boolean): void {
    this.jetpack.visible = hasFuel || firing;
    for (const f of this.flames) f.visible = firing;
  }

  /** Crouched chickens are drawn smaller (matching their smaller hitbox). */
  setCrouch(crouching: boolean, amount?: number): void {
    this.crouchTarget = bodyScale({crouching,crouchAmount:amount});
    this.crouchScale = this.crouchTarget;
  }

  /** Kicks the gun back a little (called on every shot). */
  kick(): void {
    this.recoil = 1;
    this.inspectTime = -1;
  }

  /** A melee swing: the weapon sweeps across in front of the chicken. */
  swing(): void {
    this.swingTime = 0;
    this.inspectTime = -1;
  }

  /** Inspect (F): the chicken lifts its weapon and turns it over. */
  inspect(): void {
    this.inspectTime = 0;
  }

  setDead(dead: boolean): void {
    if (dead && this.deadTime < 0) {
      this.deadTime = 0;
      this.vanished = false;
      // Every death falls a little differently.
      this.deathSpin = Math.random() < 0.5 ? -1 : 1;
      this.deathSide = Math.random() < 0.5 ? -1 : 1;
    }
    if (!dead) {
      this.deadTime = -1;
      this.pose.rotation.set(0, 0, 0);
      this.pose.position.set(0, 0, 0);
      this.pose.scale.set(1, 1, 1);
      this.headGroup.rotation.z = 0;
      this.root.visible = true;
    }
  }

  get isDead(): boolean {
    return this.deadTime >= 0;
  }

  /** Hides the body (first-person view) but keeps the object so it still animates. */
  setBodyVisible(visible: boolean): void {
    this.pose.visible = visible;
  }

  muzzleWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    if (this.gun) return this.gun.muzzle.getWorldPosition(out);
    return this.gunPivot.getWorldPosition(out);
  }

  /** Procedural walk cycle, wing flapping, recoil and the death flop. */
  animate(dt: number, speed: number, onGround: boolean): void {
    this.time += dt;
    this.blob.visible = Chicken.blobShadows && this.deadTime < 0;
    if (this.deadTime >= 0) {
      this.deadTime += dt;
      this.animateDeath(this.deadTime);
      return;
    }

    this.crouchScale = this.crouchTarget;
    this.pose.scale.setScalar(this.crouchScale);
    this.blob.scale.set(1.1 * this.crouchScale, 1, 1.3 * this.crouchScale);

    const moving = clamp(speed / PLAYER.speed, 0, 1);
    this.walkBlend = damp(this.walkBlend, onGround ? moving : 0, 10, dt);
    this.flapBlend = damp(this.flapBlend, onGround ? 0 : 1, 12, dt);
    this.walkPhase += dt * (6 + speed * 1.8) * this.walkBlend;

    const swing = Math.sin(this.walkPhase) * 0.8 * this.walkBlend;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    const idle = (1 - this.walkBlend) * (1 - this.flapBlend);
    this.bodyPivot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06 * this.walkBlend + Math.sin(this.time * 2.4) * 0.01 * idle;
    this.bodyPivot.rotation.x = -0.1 * this.walkBlend;
    this.bodyPivot.rotation.z = Math.sin(this.walkPhase) * 0.025 * this.walkBlend;
    // Title screen only: the head thrusts forward on every step and sways, like a real chicken's.
    // (In matches the drawn head must stay on the hitbox, so it never moves.)
    if (this.headBob) {
      this.headGroup.position.z = NECK_REST.z - Math.cos(this.walkPhase * 2) * 0.07 * this.walkBlend;
      this.headGroup.rotation.y = Math.sin(this.walkPhase) * 0.1 * this.walkBlend;
    }
    this.scarfTails.forEach((tail, i) => {
      tail.rotation.x = -0.25 + Math.sin(this.time * 8 + i) * 0.12 * moving;
    });

    const flap = (Math.sin(this.time * 28) * 0.5 + 0.7) * this.flapBlend;
    this.wingL.rotation.z = -flap;
    // The right wing holds the gun, so it flaps less.
    this.wingR.rotation.z = flap * 0.4;
    this.wingR.rotation.x = -0.6;

    this.recoil = damp(this.recoil, 0, 18, dt);
    let sweep = 0;
    if (this.swingTime >= 0) {
      this.swingTime += dt;
      const p = this.swingTime / SWING_SECONDS;
      if (p >= 1) this.swingTime = -1;
      else sweep = Math.sin(p * Math.PI) * (p < 0.3 ? -0.5 : 1);
    }
    let show = 0;
    let turn = 0;
    if (this.inspectTime >= 0) {
      this.inspectTime += dt;
      const p = this.inspectTime / INSPECT_SECONDS;
      if (p >= 1) this.inspectTime = -1;
      else {
        show = Math.sin(p * Math.PI);
        turn = Math.sin(p * Math.PI * 2) * 1.1;
      }
    }
    if (this.gun) {
      this.gun.group.rotation.set(sweep * -0.5 - show * 0.5, sweep * 1.3 + turn, sweep * 0.4 + show * 0.3);
      this.gun.group.position.z = this.recoil * 0.08;
      if (this.gun.spinner) this.gun.spinner.rotation.z += dt * (4 + this.recoil * 30);
    }
    for (const f of this.flames) if (f.visible) f.scale.y = 0.8 + Math.random() * 0.5;
  }

  /**
   * Cartoon death: a hop with a full spin while tipping onto its side, a squash on landing,
   * kicking legs and a lolling head, then it shrinks away (onVanish fires for the puff).
   */
  private animateDeath(d: number): void {
    const fall = Math.min(1, d / DEATH_FALL);
    const ease = 1 - (1 - fall) ** 3;
    const pose = this.pose;
    pose.rotation.order = 'YXZ';
    pose.rotation.set(0, this.deathSpin * ease * Math.PI * 2, this.deathSide * ease * (Math.PI / 2));
    pose.position.y = Math.sin(fall * Math.PI) * 0.7 + 0.35 * ease;

    // Squash when it hits the ground.
    const land = d - DEATH_FALL;
    const squash = land > 0 && land < 0.25 ? Math.sin((land / 0.25) * Math.PI) * 0.25 : 0;
    pose.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);

    if (land > 0) {
      // Twitching that dies down.
      const k = Math.exp(-land * 2.2);
      this.legL.rotation.x = Math.sin(d * 30) * 0.9 * k + 0.3;
      this.legR.rotation.x = Math.sin(d * 26 + 1) * 0.9 * k - 0.2;
      this.wingL.rotation.z = -(Math.sin(d * 20) * 0.5 * k + 0.3);
      this.wingR.rotation.z = Math.sin(d * 18 + 2) * 0.3 * k + 0.2;
      this.headGroup.rotation.z = this.deathSide * 0.5 * Math.min(1, land * 3);
    } else {
      this.legL.rotation.x = this.legR.rotation.x = 0.6 * ease;
      this.wingL.rotation.z = -1.2 * ease;
      this.wingR.rotation.z = 1.2 * ease;
    }

    if (d > DEATH_VANISH) {
      if (!this.vanished) {
        this.vanished = true;
        this.onVanish?.(this.root.getWorldPosition(new THREE.Vector3()).setY(this.root.position.y + 0.5));
      }
      const v = Math.min(1, (d - DEATH_VANISH) / DEATH_SHRINK);
      pose.scale.multiplyScalar(Math.max(0.001, 1 - v * v));
      if (v >= 1) this.root.visible = false;
    }
  }

  /**
   * Developer wallhack (chams): draws the chicken in `material` wherever walls hide it, or turns
   * that off with null. Each body part gets a child mesh with the same geometry, drawn after the
   * level but before the chicken itself, so only the hidden parts show (see DevRuntime).
   */
  setXray(material: THREE.Material | null): void {
    if (this.xrayMaterial === material) return;
    this.xrayMaterial = material;
    // Gear (gun, hat, jetpack) gets no silhouette of its own: just the chicken shows.
    const gear = new Set<THREE.Object3D>([this.gunPivot, this.jetpack]);
    if (this.hat) gear.add(this.hat);
    const walk = (o: THREE.Object3D, isGear: boolean) => {
      if (o.userData.xrayPart) return;
      const inGear = isGear || gear.has(o);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        // Ordering is per mesh: three.js restarts group ordering at every nested Group, and the
        // chicken is all nested groups. Level (0) → silhouettes (5) → the chicken itself (6).
        mesh.renderOrder = material ? XRAY_BODY_ORDER : 0;
        let x = mesh.userData.xray as THREE.Mesh | undefined;
        if (!x && material && !inGear) {
          x = new THREE.Mesh(mesh.geometry, material);
          x.userData.xrayPart = true;
          x.renderOrder = XRAY_ORDER;
          mesh.userData.xray = x;
          mesh.add(x);
        }
        if (x) {
          x.visible = material !== null && !inGear;
          if (material && x.material !== material) x.material = material;
        }
      }
      for (const child of o.children) walk(child, inGear);
    };
    walk(this.pose, false);
  }

  setChams(material: THREE.Material | null): void {
    if (this.chamsMaterial === material) return;
    this.chamsMaterial = material;
    if (!material) {
      for (const [mesh, original] of this.originalMaterials) mesh.material = original;
      this.originalMaterials.clear();
      return;
    }
    const walk = (node: THREE.Object3D) => {
      if (node === this.gunPivot || node === this.jetpack || node.userData.xrayPart) return;
      if (node instanceof THREE.Mesh) {
        if (!this.originalMaterials.has(node)) this.originalMaterials.set(node, node.material);
        node.material = material;
      }
      for (const child of node.children) walk(child);
    };
    walk(this.pose);
  }

  setShadow(color: string | null, opacity = 1): void {
    this.blob.visible = (color !== null || Chicken.blobShadows) && this.deadTime < 0;
    const material = this.blob.material;
    material.color.set(color ?? '#000000');
    material.opacity = color ? opacity : 1;
  }

  dispose(): void {
    this.blob.material.dispose();
    this.root.removeFromParent();
  }
}
