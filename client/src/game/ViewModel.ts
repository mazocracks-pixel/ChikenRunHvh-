import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, clamp, damp, wrapAngle, type WeaponId } from '@game/shared';
import { buildGun, type GunModel } from './models/Guns';

/** Where the gun sits in front of the camera (metres), hip-fire and aiming down the sights. */
const HIP = new THREE.Vector3(0.24, -0.22, -0.45);
const ADS = new THREE.Vector3(0, -0.075, -0.34);
const SCALE = 0.55;
/** Per-weapon nudges so long guns don't fill the screen. */
const OFFSETS: Partial<Record<WeaponId, THREE.Vector3>> = {
  rocket: new THREE.Vector3(0.09, -0.02, -0.02),
  minigun: new THREE.Vector3(0.02, -0.05, 0.02),
  sniper: new THREE.Vector3(0, -0.01, 0.03),
  knife: new THREE.Vector3(0.02, -0.02, 0.04),
  goldknife: new THREE.Vector3(0.02, -0.02, 0.04),
  butterfly: new THREE.Vector3(0.02, -0.02, 0.04),
  karambit: new THREE.Vector3(0.02, -0.02, 0.05),
  m9: new THREE.Vector3(0.02, -0.03, 0.04),
  daggers: new THREE.Vector3(0.05, -0.03, 0.05),
  dualies: new THREE.Vector3(0.05, -0.01, 0.02),
  silenced: new THREE.Vector3(0, -0.005, 0.03),
  deagle: new THREE.Vector3(0, -0.01, 0.02),
  lmg: new THREE.Vector3(0.03, -0.04, 0.03),
  launcher: new THREE.Vector3(0.03, -0.03, 0.02),
  crossbow: new THREE.Vector3(0.02, -0.03, 0.02),
  pan: new THREE.Vector3(0.04, -0.04, 0.04),
  katana: new THREE.Vector3(0.07, -0.08, 0.06),
};
/** Melee weapons are held angled up rather than pointed like a gun (x pitch, y yaw, z roll). */
const HOLD_ANGLES: Partial<Record<WeaponId, THREE.Euler>> = {
  knife: new THREE.Euler(0.2, 0.08, -0.15),
  goldknife: new THREE.Euler(0.2, 0.08, -0.15),
  butterfly: new THREE.Euler(0.2, 0.08, -0.15),
  karambit: new THREE.Euler(0.1, 0.1, -0.25),
  m9: new THREE.Euler(0.2, 0.08, -0.15),
  daggers: new THREE.Euler(0.05, 0, 0),
  pan: new THREE.Euler(0.45, 0.1, -0.2),
  katana: new THREE.Euler(1.0, -0.15, -0.2),
};
/** Seconds one swing animation takes. */
const SWING_TIME: Partial<Record<WeaponId, number>> = { knife: 0.26, goldknife: 0.26, butterfly: 0.24, karambit: 0.24, m9: 0.27, daggers: 0.22, pan: 0.38, katana: 0.32 };

/** An offset added to the held pose (metres and radians). */
interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}
const REST: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });
const ease = (t: number) => t * t * (3 - 2 * t);
function mixPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  for (const k of Object.keys(out) as (keyof Pose)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
/** Keyframes as [progress 0..1, pose], eased between. */
type Keyframes = readonly (readonly [number, Pose])[];
function sample(frames: Keyframes, p: number, out: Pose): Pose {
  for (let i = 1; i < frames.length; i++) {
    const [t1, b] = frames[i]!;
    const [t0, a] = frames[i - 1]!;
    if (p <= t1) return mixPose(a, b, ease((p - t0) / (t1 - t0)), out);
  }
  return mixPose(REST, REST, 0, out);
}

/** Melee swing: wind up to the right, slash across to the left. */
const SWING: Keyframes = [
  [0, REST],
  [0.18, pose({ x: 0.07, y: 0.05, z: 0.04, rx: 0.45, ry: -0.6, rz: -0.45 })],
  [0.5, pose({ x: -0.22, y: -0.07, z: -0.1, rx: -0.4, ry: 0.95, rz: 0.55 })],
  [1, REST],
];
/** Inspect (F): bring it in, show the left side, flip to show the right, put it back. */
const SHOW_LEFT = pose({ x: -0.13, y: 0.05, z: 0.07, rx: 0.15, ry: 0.95, rz: 0.35 });
const INSPECT: Keyframes = [
  [0, REST],
  [0.14, SHOW_LEFT],
  [0.48, { ...SHOW_LEFT, ry: 1.15, rz: 0.45 }],
  [0.62, pose({ x: -0.1, y: 0.06, z: 0.06, rx: 0.3, ry: -0.85, rz: -0.55 })],
  [0.84, pose({ x: -0.09, y: 0.05, z: 0.06, rx: 0.25, ry: -1.0, rz: -0.6 })],
  [1, REST],
];
/**
 * Melee weapons: turned across the screen to show the flat of the blade, then rolled over to
 * show the other side (and rolled the rest of the way round on the way back, so it ends at rest).
 */
const ACROSS = pose({ x: -0.15, y: 0.07, z: 0.03, rx: -0.1, ry: 1.35 });
const INSPECT_MELEE: Keyframes = [
  [0, REST],
  [0.15, ACROSS],
  [0.42, { ...ACROSS, ry: 1.45, rx: -0.05 }],
  [0.58, { ...ACROSS, ry: 1.45, rz: Math.PI }],
  [0.84, { ...ACROSS, ry: 1.35, rx: -0.15, rz: Math.PI }],
  [1, pose({ rz: Math.PI * 2 })],
];
/** Knives with their own trick (butterfly fan, karambit spin...): held up in view while it plays. */
const SHOW = pose({ x: -0.12, y: 0.07, z: 0.04, rx: 0.25, ry: 0.55, rz: 0.1 });
const INSPECT_TRICK: Keyframes = [
  [0, REST],
  [0.12, SHOW],
  [0.88, { ...SHOW, ry: 0.65 }],
  [1, REST],
];
/** A pair (Dual Pistols, Shadow Daggers): lifted and tipped, not turned, so the left one stays in view. */
const LIFT = pose({ x: -0.03, y: 0.06, z: 0.05, rx: 0.35 });
const INSPECT_PAIR: Keyframes = [
  [0, REST],
  [0.14, LIFT],
  [0.86, { ...LIFT, rx: 0.25 }],
  [1, REST],
];
const INSPECT_SECONDS = 2.4;
/** Per-weapon size (big guns would cover the HUD). */
const SIZES: Partial<Record<WeaponId, number>> = { rocket: 0.72, minigun: 0.85, sniper: 0.95, lmg: 0.82, launcher: 0.85, crossbow: 0.9, scout: 0.95, battle: 0.95 };
interface RecoilFeel {
  back: number;
  pitch: number;
  roll: number;
  recovery: number;
  flash: number;
  flashLife: number;
}
/** Cosmetic recoil only: the server and input controller still own aim and bullet spread. */
const RECOIL: Partial<Record<WeaponId, RecoilFeel>> = {
  pistol: { back: 0.07, pitch: 0.2, roll: 0.14, recovery: 17, flash: 0.75, flashLife: 0.045 },
  golden: { back: 0.085, pitch: 0.22, roll: 0.12, recovery: 16, flash: 0.9, flashLife: 0.045 },
  rifle: { back: 0.055, pitch: 0.11, roll: 0.09, recovery: 19, flash: 0.9, flashLife: 0.04 },
  smg: { back: 0.035, pitch: 0.075, roll: 0.1, recovery: 24, flash: 0.6, flashLife: 0.035 },
  minigun: { back: 0.022, pitch: 0.045, roll: 0.065, recovery: 26, flash: 0.7, flashLife: 0.028 },
  shotgun: { back: 0.14, pitch: 0.25, roll: 0.18, recovery: 10, flash: 1.5, flashLife: 0.06 },
  sniper: { back: 0.13, pitch: 0.2, roll: 0.12, recovery: 9, flash: 1.4, flashLife: 0.055 },
  scout: { back: 0.105, pitch: 0.17, roll: 0.1, recovery: 12, flash: 1.1, flashLife: 0.05 },
  battle: { back: 0.085, pitch: 0.15, roll: 0.09, recovery: 14, flash: 1.15, flashLife: 0.045 },
  rocket: { back: 0.1, pitch: 0.13, roll: 0.14, recovery: 9, flash: 1.6, flashLife: 0.08 },
};
const DEFAULT_RECOIL = RECOIL.pistol!;

export interface ViewModelFrame {
  dt: number;
  camera: THREE.Camera;
  weapon: WeaponId;
  visible: boolean;
  aiming: boolean;
  /** Horizontal speed, m/s (for the walk bob). */
  speed: number;
  onGround: boolean;
  /** 0..1 while reloading, otherwise null. */
  reload: number | null;
  yaw: number;
  pitch: number;
}

/**
 * The first-person gun. It lives in its own overlay scene (drawn after the world with a fresh
 * depth buffer) so it never pokes through walls, and it moves like a real held weapon: sway,
 * walk bob, landing dip, recoil kick, reload, weapon switch and a muzzle flash on the barrel.
 */
export class ViewModel {
  suppressRecoil = false;
  /** Follows the camera every frame. Lives in the overlay scene. */
  private readonly root = new THREE.Group();
  /** Animated offset in front of the camera. */
  private readonly holder = new THREE.Group();
  private gun: GunModel | null = null;
  private gunId: WeaponId | null = null;
  private readonly guns = new Map<WeaponId, GunModel>();
  private tint: string | null = null;
  private tintStyle = 0;
  private tintAlpha = 1;
  private readonly tintClones = new Map<THREE.Material, THREE.Material>();
  private readonly tintSources = new Map<THREE.Material, THREE.Material>();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly flash: THREE.Mesh;
  private flashLife = 0;
  private readonly magRest = new THREE.Vector3();

  private kick = 0;
  private roll = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw: number | null = null;
  private lastPitch = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private ads = 0;
  private raise = 1;
  private landDip = 0;
  private wasOnGround = true;
  private reloadBlend = 0;
  /** Seconds into the current melee swing, or -1. */
  private swingT = -1;
  /** Seconds into an inspect (F), or -1. */
  private inspectT = -1;
  private readonly swingPose: Pose = { ...REST };
  private readonly inspectPose: Pose = { ...REST };
  private readonly pose: Pose = { ...REST };
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.holder.scale.setScalar(SCALE);
    this.root.add(this.holder);
    this.root.visible = false;
    this.flash = new THREE.Mesh(FLASH_GEOMETRY, flashMaterial());
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    scene.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** A shot: kick the gun back and flash the muzzle. With a melee weapon: a swing. */
  fire(): void {
    this.inspectT = -1;
    if (this.gunId && WEAPONS[this.gunId].melee) {
      this.swingT = 0;
      return;
    }
    const feel = (this.gunId && RECOIL[this.gunId]) || DEFAULT_RECOIL;
    this.kick = this.suppressRecoil ? 0 : Math.min(1.35, this.kick + 1);
    this.roll = this.suppressRecoil ? 0 : (Math.random() - 0.5) * feel.roll;
    this.flashLife = feel.flashLife;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(feel.flash * (0.85 + Math.random() * 0.3) * (this.reducedMotion.matches ? 0.7 : 1));
  }

  /** Inspect the weapon (F): turn it over to look at it. Shooting, aiming or reloading stops it. */
  inspect(): void {
    if (this.swingT < 0) this.inspectT = 0;
  }

  /** World position of the muzzle (for tracers and the world-space flash). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.root.visible || !this.gun) return null;
    this.root.updateMatrixWorld(true);
    return this.gun.muzzle.getWorldPosition(out);
  }

  update(f: ViewModelFrame): void {
    this.root.visible = f.visible;
    if (!f.visible) {
      this.lastYaw = null;
      return;
    }
    const dt = f.dt;
    if (f.weapon !== this.gunId) this.swap(f.weapon);
    const feel = RECOIL[f.weapon] ?? DEFAULT_RECOIL;
    const motion = this.reducedMotion.matches ? 0.25 : 1;

    // Follow the camera exactly.
    f.camera.updateMatrixWorld();
    f.camera.matrixWorld.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.root.scale.set(1, 1, 1);

    // Sway: the gun lags behind the look direction a little (less while aiming).
    const dYaw = this.lastYaw === null ? 0 : wrapAngle(f.yaw - this.lastYaw);
    const dPitch = this.lastYaw === null ? 0 : f.pitch - this.lastPitch;
    this.lastYaw = f.yaw;
    this.lastPitch = f.pitch;
    const steady = 1 - this.ads * 0.8;
    const rate = dt > 0 ? 1 / dt : 0;
    this.swayX = damp(this.swayX, clamp(dYaw * rate * 0.006, -0.04, 0.04) * steady * motion, 10, dt);
    this.swayY = damp(this.swayY, clamp(-dPitch * rate * 0.006, -0.04, 0.04) * steady * motion, 10, dt);

    // Walk bob, and a dip when landing.
    const walking = f.onGround ? clamp(f.speed / 6, 0, 1.4) : 0;
    this.bobAmount = damp(this.bobAmount, walking * steady * motion, 8, dt);
    this.bobPhase += dt * (4 + f.speed * 1.4);
    if (f.onGround && !this.wasOnGround) this.landDip = 1;
    this.wasOnGround = f.onGround;
    this.landDip = damp(this.landDip, 0, 7, dt);

    this.ads = damp(this.ads, f.aiming ? 1 : 0, 14, dt);
    this.kick = damp(this.kick, 0, feel.recovery, dt);
    if(this.suppressRecoil)this.kick=this.roll=0;
    this.roll = damp(this.roll, 0, 10, dt);
    this.raise = Math.min(1, this.raise + dt * 3.5);
    const raise = 1 - (1 - this.raise) ** 3;
    this.reloadBlend = damp(this.reloadBlend, f.reload !== null ? 1 : 0, 10, dt);
    const reloadCurve = f.reload !== null ? Math.sin(f.reload * Math.PI) : 0;
    const seating = f.reload !== null && f.reload > 0.85 ? Math.sin(((f.reload - 0.85) / 0.15) * Math.PI) * 0.018 : 0;
    const breath = Math.sin(this.bobPhase * 0.18) * 0.0015 * steady * motion;

    // Melee swing: rest → wind-up → slash → back to rest.
    const swing = mixPose(REST, REST, 0, this.swingPose);
    if (this.swingT >= 0) {
      this.swingT += dt;
      const p = this.swingT / (SWING_TIME[f.weapon] ?? 0.3);
      if (p >= 1) this.swingT = -1;
      else sample(SWING, p, swing);
    }
    // Inspect (F), stopped by aiming or reloading.
    const look = mixPose(REST, REST, 0, this.inspectPose);
    if (this.inspectT >= 0 && (f.aiming || f.reload !== null)) this.inspectT = -1;
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      const p = this.inspectT / INSPECT_SECONDS;
      if (p >= 1) this.inspectT = -1;
      else sample(this.gun?.offhand ? INSPECT_PAIR : this.gun?.animate ? INSPECT_TRICK : WEAPONS[f.weapon].melee ? INSPECT_MELEE : INSPECT, p, look);
    }
    this.gun?.animate?.(this.inspectT >= 0 ? this.inspectT / INSPECT_SECONDS : -1);
    const pose = this.pose;
    for (const k of Object.keys(pose) as (keyof Pose)[]) pose[k] = swing[k] + look[k];
    const hold = HOLD_ANGLES[f.weapon];

    const base = this.tmp.copy(HIP).lerp(ADS, this.ads).add(OFFSETS[f.weapon] ?? ZERO);
    base.x += pose.x;
    base.y += pose.y;
    base.z += pose.z;
    this.holder.position.set(
      base.x + this.swayX + Math.sin(this.bobPhase) * 0.012 * this.bobAmount,
      base.y + this.swayY + breath - Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmount - this.landDip * 0.035 * motion - (1 - raise) * 0.25 - reloadCurve * 0.07,
      base.z + this.kick * feel.back * (1 - this.ads * 0.5) * motion + seating,
    );
    this.holder.rotation.set(
      this.kick * feel.pitch * motion + (1 - raise) * 0.7 - reloadCurve * 0.35 + this.swayY * 1.5 + (hold?.x ?? 0) + pose.rx,
      -this.swayX * 1.5 + (hold?.y ?? 0) + pose.ry,
      this.roll * this.kick * motion + reloadCurve * 0.45 * this.reloadBlend + (hold?.z ?? 0) + pose.rz,
    );

    // Reload: the magazine drops out, then a fresh one goes back in.
    if (this.gun?.magazine) {
      const p = f.reload;
      let drop = 0;
      if (p !== null) drop = p < 0.25 ? 0 : p < 0.45 ? (p - 0.25) / 0.2 : p < 0.6 ? 1 : p < 0.85 ? 1 - (p - 0.6) / 0.25 : 0;
      const mag = this.gun.magazine;
      mag.position.copy(this.magRest);
      mag.position.y -= drop * 0.22;
      mag.position.z += drop * 0.03;
    }

    if (this.gun?.spinner) this.gun.spinner.rotation.z += dt * (4 + this.kick * 30);

    this.flashLife = Math.max(0, this.flashLife - dt);
    this.flash.visible = this.flashLife > 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.flash.removeFromParent();
    (this.flash.material as THREE.Material).dispose();
    this.guns.clear();
    for (const material of this.tintClones.values()) material.dispose();
    this.tintClones.clear(); this.tintSources.clear();
  }

  /** Local finishes clone materials; shared gun models and other players are never recolored. */
  setTint(color: string | null, style = 0, alpha = 1): void {
    if (this.tint === color && this.tintStyle === style && this.tintAlpha === alpha) return;
    this.tint = color; this.tintStyle=style; this.tintAlpha=alpha;
    for (const gun of this.guns.values()) this.tintGun(gun);
  }
  private tintGun(gun: GunModel): void {
    const tint = this.tint ? new THREE.Color(this.tint) : null;
    gun.group.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node === this.flash) return;
      const paint = (material: THREE.Material) => {
        const source = this.tintSources.get(material) ?? material;
        if (!tint || !(source instanceof THREE.MeshStandardMaterial)) return source;
        let clone = this.tintClones.get(source) as THREE.MeshStandardMaterial | undefined;
        if (!clone) { clone = source.clone(); this.tintClones.set(source, clone); this.tintSources.set(clone, source); }
        clone.color.copy(source.color).multiply(tint);
        clone.roughness=this.tintStyle===3?.15:source.roughness;clone.metalness=this.tintStyle===3?1:source.metalness;
        clone.emissive.copy(this.tintStyle===1||this.tintStyle===4 ? tint : source.emissive);
        clone.emissiveIntensity=this.tintStyle===1||this.tintStyle===4 ? 1 : source.emissiveIntensity;
        clone.wireframe=this.tintStyle===5;clone.opacity=this.tintAlpha;clone.transparent=this.tintAlpha<1||this.tintStyle===4;clone.depthWrite=!clone.transparent;clone.blending=this.tintStyle===4?THREE.AdditiveBlending:THREE.NormalBlending;clone.needsUpdate=true;
        return clone;
      };
      node.material = Array.isArray(node.material) ? node.material.map(paint) : paint(node.material);
    });
  }

  private swap(id: WeaponId): void {
    if (this.gun?.magazine) this.gun.magazine.position.copy(this.magRest);
    this.gun?.group.removeFromParent();
    let gun = this.guns.get(id);
    if (!gun) this.guns.set(id, (gun = buildGun(id)));
    this.gun = gun;
    this.gunId = id;
    this.holder.add(this.gun.group);
    this.holder.scale.setScalar(SCALE * (SIZES[id] ?? 1));
    this.gun.muzzle.add(this.flash);
    if (this.gun.magazine) this.magRest.copy(this.gun.magazine.position);
    this.raise = 0;
    this.kick = 0;
    this.roll = 0;
    this.flashLife = 0;
    this.flash.visible = false;
    this.swingT = -1;
    this.inspectT = -1;
    if (this.tint) this.tintGun(this.gun);
  }
}

const ZERO = new THREE.Vector3();

/** Three crossed quads with a star texture: reads as a flash from any angle. */
const FLASH_GEOMETRY = mergeGeometries([
  new THREE.PlaneGeometry(0.22, 0.22).rotateY(Math.PI / 2),
  new THREE.PlaneGeometry(0.22, 0.22).rotateY(Math.PI / 2).rotateZ(Math.PI / 2),
  new THREE.PlaneGeometry(0.16, 0.16),
])!.translate(0, 0, -0.06);

let flashTexture: THREE.CanvasTexture | null = null;
function flashMaterial(): THREE.MeshBasicMaterial {
  if (!flashTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.25, 'rgba(255,214,120,0.9)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    // A rough star: a soft core plus pointed rays.
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 === 0 ? 32 : 11;
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    flashTexture = new THREE.CanvasTexture(canvas);
    flashTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({
    map: flashTexture,
    color: new THREE.Color(3, 2.4, 1.4),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
