import * as THREE from 'three';
import {
  PROJECTILES,
  SIM_DT,
  normalize,
  stepProjectile,
  type CollisionWorld,
  type ExplosionEvent,
  type ProjectileBody,
  type ProjectileKind,
  type ProjectileSpawn,
  type Vec3,
} from '@game/shared';
import type { Effects } from './Effects';
import { cone, cylinder, part, solid, sphere } from './models/materials';

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

function buildMesh(kind: ProjectileKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'egg': {
      const egg = part(sphere(0.12, 12, 10), solid(0xfff3d6, { flat: false, roughness: 0.35 }));
      egg.scale.set(1, 1.3, 1);
      g.add(egg);
      break;
    }
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

  predict(kind: ProjectileKind, owner: number, ownerSeq: number, origin: Vec3, dir: Vec3): void {
    const def = PROJECTILES[kind];
    const d = normalize(dir);
    this.add({
      id: null,
      owner,
      ownerSeq,
      kind,
      body: { x: origin.x, y: origin.y, z: origin.z, vx: d.x * def.speed, vy: d.y * def.speed + def.upBoost, vz: d.z * def.speed },
    });
  }

  /** Server confirmed a projectile. `aheadMs` fast-forwards remote ones to roughly "now". */
  spawn(e: ProjectileSpawn, selfPid: number, aheadMs: number): void {
    if (e.owner === selfPid) {
      const mine = this.views.find((v) => v.id === null && v.owner === selfPid && v.ownerSeq === e.ownerSeq && v.kind === e.kind);
      if (mine) {
        mine.id = e.id;
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
    this.root.removeFromParent();
    this.views.length = 0;
  }

  private add(v: Omit<View, 'mesh' | 'age' | 'landed' | 'accumulator'>): View {
    const view: View = { ...v, mesh: buildMesh(v.kind), age: 0, landed: false, accumulator: 0 };
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
