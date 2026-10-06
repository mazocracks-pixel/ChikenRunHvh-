import * as THREE from 'three';
import type { Vec3 } from '@game/shared';
import { puffTexture } from './textures';

const MAX_PARTICLES = 1500;
const TRACER_POOL = 64;
const SPRITE_POOL = 160;
const HOLE_POOL = 96;
const SHOCKWAVE_POOL = 12;
const SHOCKWAVE_LIFE = 0.42;
/** Bright colours go above 1 so they glow (bloom) and survive tone mapping as near-white. */
const TRACER_GLOW = 2.5;
const SPARK = new THREE.Color(4, 2.6, 1.1);
const BRASS = 0xc9a33a;
const BLAST_INTENSITY = 60;
const BLAST_LIFE = 0.4;

interface Sprite {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  /** Seconds to fade in (smoke grenades). */
  fadeIn: number;
  vy: number;
  active: boolean;
  smoke: boolean;
}

/** Short-lived visuals: tracers, muzzle flashes, debris, feathers, explosions and smoke. */
export class Effects {
  hideSmoke = false;
  showImpacts = true;
  /** Set by the graphics quality; off saves two per-pixel lights on slow devices. */
  static flashLights = true;

  private readonly root = new THREE.Group();

  // Particles live in flat arrays and render through one instanced mesh.
  private readonly particles: THREE.InstancedMesh;
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private highest = 0;

  private readonly tracers: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; life: number }[] = [];
  private nextTracer = 0;
  private readonly shockwaves: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; life: number; radius: number }[] = [];
  private nextShockwave = 0;
  private readonly sprites: Sprite[] = [];
  private readonly puff = puffTexture();

  // Bullet holes: one instanced mesh, the oldest hole is reused first.
  private readonly holes: THREE.InstancedMesh;
  private nextHole = 0;
  private readonly holeTexture = bulletHoleTexture();

  // Two lights that are always in the scene (adding lights later would force shader rebuilds),
  // flashed briefly for gunfire and explosions.
  private readonly flash = new THREE.PointLight(0xffc56b, 0, 9, 2);
  private readonly blast = new THREE.PointLight(0xff9a3c, 0, 22, 2);
  private flashLife = 0;
  private blastLife = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scaleV = new THREE.Vector3();
  private readonly posV = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly euler = new THREE.Euler();
  private readonly spin = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_PARTICLES);
    this.particles.frustumCulled = false;
    this.particles.count = 0;
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.setColorAt(0, this.color.set(0xffffff));
    this.root.add(this.particles);

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    for (let i = 0; i < TRACER_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(tracerGeo, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.tracers.push({ mesh, material, life: 0 });
      this.root.add(mesh);
    }

    const waveGeometry = new THREE.TorusGeometry(1, 0.018, 4, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.5, 1.6, 0.55), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(waveGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.shockwaves.push({ mesh, material, life: 0, radius: 1 });
      this.root.add(mesh);
    }

    for (let i = 0; i < SPRITE_POOL; i++) {
      const material = new THREE.SpriteMaterial({ map: this.puff, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.sprites.push({ sprite, material, life: 0, maxLife: 1, startScale: 1, endScale: 1, startOpacity: 1, fadeIn: 0, vy: 0, active: false, smoke: false });
      this.root.add(sprite);
    }

    const holeGeometry = new THREE.PlaneGeometry(0.13, 0.13);
    const holeMaterial = new THREE.MeshBasicMaterial({ map: this.holeTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.holes = new THREE.InstancedMesh(holeGeometry, holeMaterial, HOLE_POOL);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    this.root.add(this.holes, this.flash, this.blast);
    scene.add(this.root);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.particles.geometry.dispose();
    (this.particles.material as THREE.Material).dispose();
    this.tracers[0]?.mesh.geometry.dispose();
    for (const t of this.tracers) t.material.dispose();
    this.shockwaves[0]?.mesh.geometry.dispose();
    for (const wave of this.shockwaves) wave.material.dispose();
    for (const s of this.sprites) s.material.dispose();
    this.puff.dispose();
    this.holes.geometry.dispose();
    (this.holes.material as THREE.Material).dispose();
    this.holeTexture.dispose();
  }

  // ---------------------------------------------------------------------------
  // Spawners
  // ---------------------------------------------------------------------------

  tracer(from: Vec3, to: Vec3, color = 0xfff1a8): void {
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (!Number.isFinite(length) || length < 0.01) return;
    const t = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % TRACER_POOL;
    t.mesh.position.set(from.x, from.y, from.z);
    t.mesh.lookAt(to.x, to.y, to.z);
    t.mesh.scale.set(0.025, 0.025, length);
    t.material.color.set(color).multiplyScalar(TRACER_GLOW);
    t.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.07;
  }

  muzzleFlash(at: Vec3, big = false): void {
    this.spawnSprite(at, { color: 0xffe7b5, life: 0.055, startScale: big ? 0.65 : 0.32, endScale: big ? 0.85 : 0.5, opacity: 1, additive: true, glow: 3 });
    this.flash.position.set(at.x, at.y, at.z);
    this.flash.intensity = big ? 7 : 4.5;
    this.flashLife = 0.06;
  }

  /** Bullet hitting the level: dust, a few chips and sparks. */
  impact(at: Vec3, color = 0xcbb89b): void {
    if(!this.showImpacts)return;
    for (let i = 0; i < 6; i++) this.particle(at, rand3(3), color, 0.05 + Math.random() * 0.04, 0.35, 12, 2);
    for (let i = 0; i < 3; i++) this.particle(at, rand3(9), SPARK, 0.025, 0.12 + Math.random() * 0.1, 10, 1);
    this.spawnSprite(at, { color: 0xffe3aa, life: 0.08, startScale: 0.12, endScale: 0.24, opacity: 0.7, additive: true, glow: 2 });
    this.spawnSprite(at, { color: 0xd8d0c4, life: 0.38, startScale: 0.22, endScale: 0.75, opacity: 0.45, vy: 0.4 });
  }

  /** A dark mark where a bullet hit a surface with normal `n`. Old holes get reused. */
  bulletHole(at: Vec3, n: Vec3): void {
    if(!this.showImpacts)return;
    const i = this.nextHole;
    this.nextHole = (this.nextHole + 1) % HOLE_POOL;
    this.holes.count = Math.max(this.holes.count, i + 1);
    this.posV.set(at.x + n.x * 0.005, at.y + n.y * 0.005, at.z + n.z * 0.005);
    this.quat.setFromUnitVectors(FACE_Z, this.scaleV.set(n.x, n.y, n.z));
    // Random spin and size so a row of holes doesn't look stamped.
    this.quat.multiply(this.spin.setFromAxisAngle(FACE_Z, Math.random() * Math.PI * 2));
    const k = 0.75 + Math.random() * 0.5;
    this.holes.setMatrixAt(i, this.matrix.compose(this.posV, this.quat, this.scaleV.set(k, k, k)));
    this.holes.instanceMatrix.needsUpdate = true;
  }

  /** An empty shell flying out of the right side of the gun. */
  shell(at: Vec3, yaw: number): void {
    const side = 1.6 + Math.random() * 0.8;
    const v = { x: Math.cos(yaw) * side + (Math.random() - 0.5) * 0.6, y: 2 + Math.random() * 1.2, z: -Math.sin(yaw) * side + (Math.random() - 0.5) * 0.6 };
    this.particle(at, v, BRASS, 0.045, 0.9 + Math.random() * 0.4, 14, 0.6);
  }

  /** Feathers flying off a chicken. */
  feathers(at: Vec3, color: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const v = rand3(3.5);
      v.y = Math.abs(v.y) + 1;
      this.particle(at, v, color, 0.07 + Math.random() * 0.05, 1.2 + Math.random() * 0.8, 3, 2.5);
    }
  }

  /** A dead chicken vanishing: a white puff with feathers flying out of it. */
  poof(at: Vec3, color: number): void {
    for (let i = 0; i < 6; i++) {
      const p = { x: at.x + (Math.random() - 0.5) * 0.6, y: at.y + Math.random() * 0.5, z: at.z + (Math.random() - 0.5) * 0.6 };
      this.spawnSprite(p, { color: 0xffffff, life: 0.45 + Math.random() * 0.2, startScale: 0.4, endScale: 1.4 + Math.random() * 0.6, opacity: 0.85, vy: 0.6 });
    }
    this.feathers(at, color, 16);
  }

  /** Splinters and sparkles when a mystery box breaks. */
  boxBurst(at: Vec3): void {
    for (let i = 0; i < 18; i++) this.particle(at, rand3(5), Math.random() > 0.5 ? 0xffc107 : 0xff8f00, 0.07, 0.8, 12, 1);
  }

  explosion(at: Vec3, radius: number): void {
    const wave = this.shockwaves[this.nextShockwave];
    this.nextShockwave = (this.nextShockwave + 1) % SHOCKWAVE_POOL;
    wave.mesh.position.set(at.x, Math.max(0.045, at.y + 0.05), at.z);
    wave.mesh.scale.setScalar(0.35);
    wave.mesh.visible = true;
    wave.material.opacity = 0.85;
    wave.radius = Math.max(0.5, radius * 1.45);
    wave.life = SHOCKWAVE_LIFE;
    this.spawnSprite(at, { color: 0xffb347, life: 0.35, startScale: 0.6, endScale: radius * 1.3, opacity: 1, additive: true, glow: 2.5 });
    this.spawnSprite(at, { color: 0xfff3c4, life: 0.15, startScale: 0.4, endScale: radius * 0.8, opacity: 1, additive: true, glow: 4 });
    this.blast.position.set(at.x, at.y + 0.5, at.z);
    this.blastLife = BLAST_LIFE;
    for (let i = 0; i < 28; i++) {
      const v = rand3(9);
      v.y = Math.abs(v.y) * 0.8 + 2;
      this.particle(at, v, Math.random() > 0.4 ? 0xff7a1a : 0x3a3a3a, 0.08 + Math.random() * 0.1, 0.6 + Math.random() * 0.6, 18, 1);
    }
    for (let i = 0; i < 10; i++) {
      const p = { x: at.x + (Math.random() - 0.5) * radius, y: at.y + Math.random() * radius * 0.5, z: at.z + (Math.random() - 0.5) * radius };
      this.spawnSprite(p, { color: 0x5b5b5b, life: 1.4 + Math.random() * 0.6, startScale: 1, endScale: 3 + Math.random() * 2, opacity: 0.55, vy: 0.8 });
    }
  }

/** The bomb going off: a fireball much bigger than a rocket's, a flash, debris and a smoke column. */
  bombExplosion(at: Vec3): void {
    this.explosion(at, 7);
    this.spawnSprite(at, { color: 0xfff6dc, life: 0.22, startScale: 3, endScale: 22, opacity: 1, additive: true, glow: 5 });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      const p = { x: at.x + Math.cos(a) * r, y: at.y + 0.5 + Math.random() * 3, z: at.z + Math.sin(a) * r };
      this.spawnSprite(p, { color: Math.random() > 0.5 ? 0xff8a2a : 0xffc04a, life: 0.7 + Math.random() * 0.5, startScale: 2, endScale: 7 + Math.random() * 4, opacity: 1, additive: true, glow: 2.6, vy: 1.5 });
    }
    for (let i = 0; i < 24; i++) {
      const p = { x: at.x + (Math.random() - 0.5) * 3, y: at.y + 0.5 + i * 0.45, z: at.z + (Math.random() - 0.5) * 3 };
      this.spawnSprite(p, { color: i < 6 ? 0x3a3530 : 0x6b6b6b, life: 5 + Math.random() * 2.5, startScale: 2.5, endScale: 7 + Math.random() * 3, opacity: 0.6, vy: 1.1 + Math.random() * 0.6, fadeIn: 0.3 });
    }
    for (let i = 0; i < 60; i++) {
      const v = rand3(16);
      v.y = Math.abs(v.y) * 0.9 + 3;
      this.particle(at, v, Math.random() > 0.5 ? 0xff7a1a : 0x2b2b2b, 0.1 + Math.random() * 0.14, 1 + Math.random(), 18, 0.6);
    }
    this.blast.position.set(at.x, at.y + 1, at.z);
    this.blastLife = BLAST_LIFE * 1.7;
  }

  /** A smoke grenade's cloud, lasting `duration` seconds. */
  smokeCloud(at: Vec3, duration: number): void {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 3.5;
      const p = { x: at.x + Math.cos(a) * r, y: Math.max(0.4, at.y) + Math.random() * 2.6, z: at.z + Math.sin(a) * r };
      this.spawnSprite(p, {
        color: 0xc9cdd2,
        life: duration * (0.85 + Math.random() * 0.15),
        startScale: 3.5 + Math.random() * 1.5,
        endScale: 5 + Math.random() * 1.5,
        opacity: 0.92,
        vy: 0.05,
        fadeIn: 0.6,
        smoke: true,
      });
    }
  }

  /** A flashbang going off: a blinding white pop and a few sparks (the blindness is separate). */
  flashPop(at: Vec3): void {
    this.spawnSprite(at, { color: 0xffffff, life: 0.3, startScale: 1.2, endScale: 7, opacity: 1, additive: true, glow: 5 });
    this.spawnSprite(at, { color: 0xdfe8ff, life: 0.9, startScale: 0.6, endScale: 2.5, opacity: 0.7, vy: 0.6 });
    for (let i = 0; i < 14; i++) this.particle(at, rand3(8), SPARK, 0.03, 0.2 + Math.random() * 0.2, 6, 1);
    this.flash.position.set(at.x, at.y + 0.3, at.z);
    this.flash.intensity = 40;
    this.flashLife = 0.14;
  }

  /** Dust kicked up behind a wheel. */
  dust(at: Vec3, color = 0xcbbd9f): void {
    this.spawnSprite({ x: at.x + (Math.random() - 0.5) * 0.3, y: at.y + 0.15, z: at.z + (Math.random() - 0.5) * 0.3 }, { color, life: 0.7 + Math.random() * 0.4, startScale: 0.35, endScale: 1.3, opacity: 0.4, vy: 0.5 });
  }

  /** Grey smoke from a sliding tyre. */
  tireSmoke(at: Vec3): void {
    this.spawnSprite({ x: at.x + (Math.random() - 0.5) * 0.3, y: at.y + 0.2, z: at.z + (Math.random() - 0.5) * 0.3 }, { color: 0xe6e8ea, life: 0.9 + Math.random() * 0.5, startScale: 0.5, endScale: 1.9, opacity: 0.55, vy: 0.7 });
  }

  /** Nitro: a blue-white flame out of an exhaust, blowing along `dir`. */
  nitro(at: Vec3, dir: Vec3): void {
    this.spawnSprite(at, { color: Math.random() > 0.5 ? 0x6fb8ff : 0xffb347, life: 0.14, startScale: 0.4, endScale: 0.15, opacity: 1, additive: true, glow: 3 });
    for (let i = 0; i < 2; i++) {
      const k = 5 + Math.random() * 3;
      this.particle(at, { x: dir.x * k + (Math.random() - 0.5), y: dir.y * k + Math.random() * 0.5, z: dir.z * k + (Math.random() - 0.5) }, Math.random() > 0.4 ? 0x9fd4ff : 0xffe082, 0.06, 0.28, 0, 3);
    }
  }

  /** Dark smoke from a badly damaged engine. */
  engineSmoke(at: Vec3): void {
    this.spawnSprite({ x: at.x + (Math.random() - 0.5) * 0.3, y: at.y, z: at.z + (Math.random() - 0.5) * 0.3 }, { color: 0x3c3c3c, life: 1.4 + Math.random() * 0.6, startScale: 0.4, endScale: 1.6, opacity: 0.6, vy: 1.4 });
  }

  /** Jetpack exhaust puff. */
  exhaust(at: Vec3): void {
    this.particle(at, { x: (Math.random() - 0.5) * 0.6, y: -3 - Math.random() * 2, z: (Math.random() - 0.5) * 0.6 }, Math.random() > 0.5 ? 0xffa726 : 0xffe082, 0.06, 0.25, 0, 3);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private particle(at: Vec3, v: Vec3, color: number | THREE.Color, size: number, life: number, gravity: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    this.highest = Math.max(this.highest, i + 1);
    this.pos[i * 3] = at.x;
    this.pos[i * 3 + 1] = at.y;
    this.pos[i * 3 + 2] = at.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.particles.setColorAt(i, typeof color === 'number' ? this.color.set(color) : this.color.copy(color));
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  private spawnSprite(
    at: Vec3,
    o: { color: number; life: number; startScale: number; endScale: number; opacity: number; additive?: boolean; vy?: number; fadeIn?: number; glow?: number; smoke?: boolean },
  ): void {
    // Reuse a free sprite, or the one closest to finishing.
    let s = this.sprites.find((x) => !x.active);
    if (!s) s = this.sprites.reduce((a, b) => (a.maxLife - a.life < b.maxLife - b.life ? a : b));
    s.active = true;
    s.smoke = o.smoke ?? false;
    s.life = 0;
    s.maxLife = o.life;
    s.startScale = o.startScale;
    s.endScale = o.endScale;
    s.startOpacity = o.opacity;
    s.fadeIn = o.fadeIn ?? 0;
    s.vy = o.vy ?? 0;
    s.material.color.set(o.color).multiplyScalar(o.glow ?? 1);
    const blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (s.material.blending !== blending) {
      s.material.blending = blending;
      s.material.needsUpdate = true;
    }
    s.material.rotation = Math.random() * Math.PI * 2;
    s.material.opacity = s.fadeIn > 0 ? 0 : o.opacity;
    s.sprite.position.set(at.x, at.y, at.z);
    s.sprite.scale.set(o.startScale, o.startScale, 1);
    s.sprite.visible = true;
  }

  update(dt: number): void {
    this.holes.visible=this.showImpacts;
    // Light flashes fade out quickly. (Toggling visibility rebuilds shaders, so only on change.)
    if (this.flash.visible !== Effects.flashLights) this.flash.visible = this.blast.visible = Effects.flashLights;
    this.flashLife = Math.max(0, this.flashLife - dt);
    if (this.flashLife <= 0) this.flash.intensity = 0;
    this.blastLife = Math.max(0, this.blastLife - dt);
    this.blast.intensity = BLAST_INTENSITY * (this.blastLife / BLAST_LIFE) ** 2;

    // Particles.
    for (let i = 0; i < this.highest; i++) {
      if (this.life[i] <= 0) {
        this.matrix.makeScale(0, 0, 0);
        this.particles.setMatrixAt(i, this.matrix);
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) * 0.2;
        this.vel[i * 3] *= 0.7;
        this.vel[i * 3 + 2] *= 0.7;
      }
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const s = this.size[i] * (0.3 + 0.7 * t);
      this.euler.set(this.life[i] * 7, this.life[i] * 5, 0);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.posV.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), this.quat, this.scaleV.set(s, s * 0.4, s));
      this.particles.setMatrixAt(i, this.matrix);
    }
    this.particles.count = this.highest;
    this.particles.instanceMatrix.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }

    for (const wave of this.shockwaves) {
      if (!wave.mesh.visible) continue;
      wave.life = Math.max(0, wave.life - dt);
      const progress = 1 - wave.life / SHOCKWAVE_LIFE;
      wave.mesh.scale.setScalar(0.35 + (wave.radius - 0.35) * (1 - (1 - progress) ** 2));
      wave.material.opacity = 0.85 * (1 - progress) ** 2;
      if (wave.life === 0) wave.mesh.visible = false;
    }

    for (const s of this.sprites) {
      if (!s.active) continue;
      s.sprite.visible=!(s.smoke && this.hideSmoke);
      s.life += dt;
      const t = Math.min(1, s.life / s.maxLife);
      const scale = s.startScale + (s.endScale - s.startScale) * t;
      s.sprite.scale.set(scale, scale, 1);
      s.sprite.position.y += s.vy * dt;
      const fadeIn = s.fadeIn > 0 ? Math.min(1, s.life / s.fadeIn) : 1;
      // Long effects hold, then fade over their last 20%.
      const fadeOut = s.maxLife > 2 ? Math.min(1, (1 - t) / 0.2) : 1 - t;
      s.material.opacity = s.startOpacity * fadeIn * fadeOut;
      if (t >= 1) {
        s.active = false;
        s.sprite.visible = false;
      }
    }
  }
}

const FACE_Z = new THREE.Vector3(0, 0, 1);

/** A dark, slightly ragged hole with a soft scorched rim. */
function bulletHoleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.35, 'rgba(20,16,12,0.95)');
  g.addColorStop(0.6, 'rgba(40,32,24,0.45)');
  g.addColorStop(1, 'rgba(40,32,24,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function rand3(scale: number): Vec3 {
  return { x: (Math.random() - 0.5) * scale, y: (Math.random() - 0.5) * scale, z: (Math.random() - 0.5) * scale };
}
