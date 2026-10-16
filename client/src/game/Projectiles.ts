import * as THREE from 'three';
import {
  PROJECTILES,
  SIM_DT,
  stepProjectile,
  type CollisionWorld,
  type ExplosionEvent,
  type ProjectileBody,
  type ProjectileKind,
  type ProjectileSpawn,
  type Vec3,
} from '@game/shared';
import type { Effects } from './Effects';
import { cone, cylinder, part, solid, sphere, box } from './models/materials';

interface View {
  id: number | null;
  owner: number;
  ownerSeq: number;
  kind: ProjectileKind;
  body: ProjectileBody;
  mesh: THREE.Group;
  age: number;
  /** Local sim hit something; waiting for the server's explosion. */
  landed: boolean;
  accumulator: number;
}

export function buildProjectileMesh(kind: ProjectileKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'egg':
    case 'he': {
      const egg = part(sphere(0.12, 12, 10), solid(0xfff3d6, { flat: false, roughness: 0.35 }));
      egg.scale.set(1, 1.3, 1);
      g.add(egg);
      break;
    }
    case 'flash':
      // A grey can with a black top and the spoon down its side.
      g.add(
        part(cylinder(0.055, 0.055, 0.2, 10), solid(0x8d939a, { metal: true })),
        part(cylinder(0.04, 0.04, 0.05, 8), solid(0x222428), 0, 0.12, 0),
        part(box(0.02, 0.17, 0.012), solid(0xc9ced6, { metal: true }), 0.06, 0.03, 0),
      );
      break;
    case 'smoke':
      g.add(part(cylinder(0.07, 0.07, 0.22, 10), solid(0x607d8b)), part(cylinder(0.03, 0.03, 0.05, 8), solid(0xb0bec5), 0, 0.13, 0));
      break;
    case 'bolt': {
      const shaft = part(cylinder(0.012, 0.012, 0.5, 6), solid(0x6b4a2e));
      shaft.rotation.x = Math.PI / 2;
      const tip = part(cone(0.022, 0.06, 6), solid(0x9aa0a8, { flat: false }), 0, 0, -0.27);
      tip.rotation.x = -Math.PI / 2;
      g.add(shaft, tip);
      for (const r of [0, Math.PI / 2]) {
        const fin = part(cylinder(0.035, 0.035, 0.002, 3), solid(0xd84343), 0, 0, 0.22);
        fin.rotation.set(Math.PI / 2, r, 0);
        g.add(fin);
      }
      break;
    }
    case 'rocket': {
      const body = part(cylinder(0.06, 0.06, 0.45, 10), solid(0x4f6b3a));
      body.rotation.x = Math.PI / 2;
      const tip = part(cone(0.06, 0.15, 10), solid(0xb33a2e), 0, 0, -0.3);
      tip.rotation.x = -Math.PI / 2;
      g.add(body, tip);
      break;
    }
  }
  return g;
}

/**
 * Draws projectiles by running the same deterministic flight code as the server. Your own
 * throws appear instantly (predicted) and are matched to the server's when it confirms them.
 */
export class ClientProjectiles {
  private readonly root = new THREE.Group();
  private readonly world: CollisionWorld;
  private readonly effects: Effects;
  private readonly views: View[] = [];
  private readonly look = new THREE.Vector3();
  private glow: string | null = null;
  private readonly glowMaterial = new THREE.MeshBasicMaterial({transparent:true,opacity:.55,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending});

  setGlow(color: string | null, alpha = 1): void {
    this.glowMaterial.opacity=.55*alpha;
    if(color===this.glow)return;
    this.glow=color;if(color)this.glowMaterial.color.set(color);
    for(const view of this.views)view.mesh.traverse(node=>{if(node.userData.projectileGlow)node.visible=color!==null;});
  }

  constructor(scene: THREE.Scene, world: CollisionWorld, effects: Effects) {
    this.world = world;
    this.effects = effects;
    scene.add(this.root);
  }

  /** Spawns your own throw right away, with the same launch maths as the server. */
  /** Projectiles in flight (developer ESP). */
  markers(): { kind: ProjectileKind; x: number; y: number; z: number }[] {
    return this.views.map((v) => ({ kind: v.kind, x: v.mesh.position.x, y: v.mesh.position.y, z: v.mesh.position.z }));
  }

  /** `velocity`: from launchVelocity, as the server works it out. */
  predict(kind: ProjectileKind, owner: number, ownerSeq: number, origin: Vec3, velocity: Vec3): void {
    this.add({ id: null, owner, ownerSeq, kind, body: { x: origin.x, y: origin.y, z: origin.z, vx: velocity.x, vy: velocity.y, vz: velocity.z } });
  }

  /** Server confirmed a projectile. `aheadMs` fast-forwards remote ones to roughly "now". */
  spawn(e: ProjectileSpawn, selfPid: number, aheadMs: number): void {
    if (e.owner === selfPid) {
      const mine = this.views.find((v) => v.id === null && v.owner === selfPid && v.ownerSeq === e.ownerSeq && v.kind === e.kind);
      if (mine) {
        // From now on fly the server's throw (same start, same steps), so it lands exactly where
        // everyone else sees it land; caught up by how long ours has been flying.
        mine.id = e.id;
        mine.body = { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz };
        mine.landed = false;
        mine.mesh.visible = true;
        mine.accumulator = 0;
        const steps = Math.min(30, Math.floor(mine.age / SIM_DT));
        for (let i = 0; i < steps && !mine.landed; i++) this.step(mine);
        return;
      }
    }
    if (this.views.some((v) => v.id === e.id)) return;
    const view = this.add({ id: e.id, owner: e.owner, ownerSeq: e.ownerSeq, kind: e.kind, body: { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz } });
    const steps = Math.min(30, Math.floor(aheadMs / 1000 / SIM_DT));
    for (let i = 0; i < steps && !view.landed; i++) this.step(view);
  }

  explode(e: ExplosionEvent): void {
    const i = this.views.findIndex((v) => v.id === e.id);
    if (i >= 0) this.remove(i);
  }

  update(dt: number): void {
    for (let i = this.views.length - 1; i >= 0; i--) {
      const v = this.views[i]!;
      v.age += dt;
      // Forget anything the server never resolved (lost packet, left the room...).
      if (v.age > PROJECTILES[v.kind].fuseMs / 1000 + 1.5) {
        this.remove(i);
        continue;
      }
      if (v.landed) continue;
      v.accumulator += dt;
      while (v.accumulator >= SIM_DT && !v.landed) {
        v.accumulator -= SIM_DT;
        this.step(v);
      }
      v.mesh.position.set(v.body.x, v.body.y, v.body.z);
      if (v.kind === 'rocket' || v.kind === 'bolt') {
        this.look.set(v.body.x + v.body.vx, v.body.y + v.body.vy, v.body.z + v.body.vz);
        v.mesh.lookAt(this.look);
        if (v.kind === 'rocket') this.effects.exhaust(v.mesh.position);
      } else {
        v.mesh.rotation.x += dt * 9;
        v.mesh.rotation.z += dt * 5;
      }
    }
  }

  dispose(): void {
    this.glowMaterial.dispose();
    this.root.removeFromParent();
    this.views.length = 0;
  }

  private add(v: Omit<View, 'mesh' | 'age' | 'landed' | 'accumulator'>): View {
    const view: View = { ...v, mesh: buildProjectileMesh(v.kind), age: 0, landed: false, accumulator: 0 };
    for(const node of [...view.mesh.children])if(node instanceof THREE.Mesh){const glow=new THREE.Mesh(node.geometry,this.glowMaterial);glow.userData.projectileGlow=true;glow.scale.setScalar(1.3);glow.visible=this.glow!==null;glow.renderOrder=10;node.add(glow);}
    view.mesh.position.set(v.body.x, v.body.y, v.body.z);
    this.root.add(view.mesh);
    this.views.push(view);
    return view;
  }

  private step(v: View): void {
    const def = PROJECTILES[v.kind];
    if (stepProjectile(v.body, def, SIM_DT, this.world)) {
      v.landed = true;
      // Impact projectiles vanish on contact; the explosion arrives from the server.
      v.mesh.visible = false;
    }
  }

  private remove(index: number): void {
    const [v] = this.views.splice(index, 1);
    v?.mesh.removeFromParent();
  }
}

/** Dots this far apart along the aiming line. */
const DOT_SPACING = 0.3;
const MAX_DOTS = 160;

/**
 * The thrower's aiming line while a pin is pulled: dots along the flight and a ring where the
 * grenade goes off. Drawn only on your own screen; nothing about it is sent to anyone.
 */
export class ThrowPreview {
  private readonly positions = new Float32Array(MAX_DOTS * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly dots: THREE.Points;
  private readonly ring: THREE.Mesh;
  private readonly dotTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    // Round dots a few pixels across, the same size near and far.
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const g = dot.getContext('2d')!;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(16, 16, 13, 0, Math.PI * 2);
    g.fill();
    this.dotTexture = new THREE.CanvasTexture(dot);
    this.dots = new THREE.Points(this.geometry, new THREE.PointsMaterial({ color: 0xfff4d6, size: 6, sizeAttenuation: false, map: this.dotTexture, alphaTest: 0.5, transparent: true, opacity: 0.9, depthWrite: false }));
    this.dots.frustumCulled = false;
    const ringGeometry = new THREE.RingGeometry(0.28, 0.36, 28);
    ringGeometry.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.dots.visible = this.ring.visible = false;
    scene.add(this.dots, this.ring);
  }

  show(path: readonly Vec3[], end: Vec3): void {
    // Even spacing along the flight, whatever its speed.
    let n = 0, next = DOT_SPACING;
    for (let i = 1; i < path.length && n < MAX_DOTS; i++) {
      const a = path[i - 1]!, b = path[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      let t = next;
      for (; t <= len && n < MAX_DOTS; t += DOT_SPACING) {
        const k = t / len;
        this.positions.set([a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k], n++ * 3);
      }
      next = t - len;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position!.needsUpdate = true;
    this.ring.position.set(end.x, end.y + 0.03, end.z);
    this.dots.visible = this.ring.visible = true;
  }

  hide(): void {
    this.dots.visible = this.ring.visible = false;
  }

  dispose(): void {
    this.dots.removeFromParent();
    this.ring.removeFromParent();
    this.geometry.dispose();
    (this.dots.material as THREE.Material).dispose();
    this.dotTexture.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
