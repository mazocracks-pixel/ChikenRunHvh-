import * as THREE from 'three';
import { BUGGY, carAabb, clamp, lerp, lerpAngle, rayAabb, unpackVehicle, wrapAngle, type CarState, type InputFrame, type PackedVehicle, type Ray, type VehicleState } from '@game/shared';
import type { Effects } from './Effects';
import { Buggy } from './models/Buggy';

const COLORS = [0xe53935, 0xffb300, 0x43a047, 0x1e88e5];
const SKID_POOL = 360;
/** A skid mark every this many metres while sliding. */
const SKID_STEP = 0.35;

interface View {
  model: Buggy;
  buffer: { t: number; s: VehicleState }[];
  latest: VehicleState;
  /** Position/yaw as drawn this frame. */
  x: number;
  z: number;
  yaw: number;
  speed: number;
  slip: number;
  /** For working out steering and braking on other people's cars. */
  lastYaw: number;
  lastSpeed: number;
  /** Distance driven since the last skid mark, and the time since the last puff. */
  skidDistance: number;
  puffTimer: number;
}

/** Draws the buggies: remote ones interpolated from snapshots, your own from prediction. */
export class Vehicles {
  private readonly scene: THREE.Scene;
  private readonly effects: Effects | null;
  private readonly views = new Map<number, View>();
  private readonly seat = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmp = new THREE.Vector3();
  // Skid marks: one instanced mesh of dark strips on the ground, oldest reused first.
  private readonly skids: THREE.InstancedMesh;
  private nextSkid = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene, effects: Effects | null = null) {
    this.scene = scene;
    this.effects = effects;
    const geometry = new THREE.PlaneGeometry(0.3, SKID_STEP + 0.06).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.skids = new THREE.InstancedMesh(geometry, material, SKID_POOL);
    this.skids.count = 0;
    this.skids.frustumCulled = false;
    scene.add(this.skids);
  }

  pushSnapshot(t: number, packed: PackedVehicle[]): void {
    for (const p of packed) {
      const s = unpackVehicle(p);
      let view = this.views.get(s.id);
      if (!view) {
        const model = new Buggy(COLORS[(s.id - 1) % COLORS.length]);
        this.scene.add(model.root);
        view = { model, buffer: [], latest: s, x: s.x, z: s.z, yaw: s.yaw, speed: s.speed, slip: s.slip, lastYaw: s.yaw, lastSpeed: s.speed, skidDistance: 0, puffTimer: 0 };
        this.views.set(s.id, view);
      }
      view.latest = s;
      view.buffer.push({ t, s });
      if (view.buffer.length > 40) view.buffer.shift();
    }
  }

  /** Buggies as drawn this frame (developer ESP). */
  markers(): { id: number; x: number; z: number; hp: number; driver: number }[] {
    return [...this.views.values()].map((v) => ({ id: v.latest.id, x: v.x, z: v.z, hp: v.latest.hp, driver: v.latest.driver }));
  }

  get(id: number): VehicleState | undefined {
    return this.views.get(id)?.latest;
  }

  /** The closest buggy you could get into right now. */
  nearestFree(x: number, z: number): VehicleState | null {
    let best: VehicleState | null = null;
    let bestDist: number = BUGGY.useRange;
    for (const v of this.views.values()) {
      const s = v.latest;
      if (s.driver || s.hp <= 0) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  /** `own`: your car from prediction, with this frame's input (for the steering and lights). */
  render(renderTime: number, dt: number, own: { id: number; car: CarState; input: InputFrame | null } | null): void {
    for (const [id, v] of this.views) {
      v.model.root.visible = v.latest.hp > 0;
      const mine = own && own.id === id ? own : null;
      if (mine) {
        v.x = mine.car.x;
        v.z = mine.car.z;
        v.yaw = mine.car.yaw;
        v.speed = mine.car.speed;
        v.slip = mine.car.slip;
      } else {
        const buf = v.buffer;
        while (buf.length >= 2 && buf[1]!.t <= renderTime) buf.shift();
        const a = buf[0];
        const b = buf[1];
        if (!a) continue;
        if (!b || renderTime <= a.t) {
          v.x = a.s.x;
          v.z = a.s.z;
          v.yaw = a.s.yaw;
          v.speed = a.s.speed;
          v.slip = a.s.slip;
        } else {
          const k = (renderTime - a.t) / (b.t - a.t);
          v.x = lerp(a.s.x, b.s.x, k);
          v.z = lerp(a.s.z, b.s.z, k);
          v.yaw = lerpAngle(a.s.yaw, b.s.yaw, k);
          v.speed = lerp(a.s.speed, b.s.speed, k);
          v.slip = lerp(a.s.slip, b.s.slip, k);
        }
      }
      // Steering, brakes and nitro: from your keys, or worked out from how the car moves.
      const yawRate = dt > 0 ? wrapAngle(v.yaw - v.lastYaw) / dt : 0;
      const decel = dt > 0 ? (Math.abs(v.lastSpeed) - Math.abs(v.speed)) / dt : 0;
      v.lastYaw = v.yaw;
      v.lastSpeed = v.speed;
      const input = mine?.input ?? null;
      const steer = input ? input.right : clamp(-yawRate / BUGGY.turnRate, -1, 1);
      const braking = input ? input.jump || (input.forward < 0 && v.speed > 0.5) : decel > 6;
      const boosting = input ? input.boost === true && input.forward > 0 && v.speed > BUGGY.maxSpeed * 0.6 && mine!.car.boost > 0 : v.speed > BUGGY.maxSpeed + 0.4;

      v.model.root.position.set(v.x, 0, v.z);
      v.model.root.rotation.y = v.yaw;
      v.model.animate(dt, { speed: v.speed, slip: v.slip, steer, braking, boosting });
      if (v.latest.hp > 0) this.trail(v, dt, boosting);
    }
  }

  /** Use the same collision hull as the server for bullet and camera targeting. */
  raycast(ray: Ray, range: number, skipId = 0): number {
    let best = range, found = false;
    for (const [id, v] of this.views) {
      if (v.latest.hp <= 0 || id === skipId) continue;
      const t = rayAabb(ray, carAabb({ x: v.x, z: v.z }), best);
      if (t >= 0) { best = t; found = true; }
    }
    return found ? best : -1;
  }

  /** Dust, tyre smoke and skid marks behind a moving car; nitro flames; smoke when it's wrecked-ish. */
  private trail(v: View, dt: number, boosting: boolean): void {
    const fx = this.effects;
    const sliding = Math.abs(v.slip) > 2.2;
    const fast = Math.abs(v.speed) > 7;
    v.puffTimer += dt;
    v.skidDistance += Math.hypot(v.speed, v.slip) * dt;
    const root = v.model.root;
    root.updateMatrixWorld();
    if (sliding && v.skidDistance >= SKID_STEP) {
      v.skidDistance = 0;
      for (const w of Buggy.REAR_WHEELS) this.skid(this.tmp.copy(w).applyMatrix4(root.matrixWorld), v.yaw - Math.atan2(v.slip, v.speed));
    }
    if (!fx) return;
    if (v.puffTimer >= 0.06) {
      v.puffTimer = 0;
      for (const w of Buggy.REAR_WHEELS) {
        const at = this.tmp.copy(w).applyMatrix4(root.matrixWorld);
        if (sliding) fx.tireSmoke(at);
        else if (fast && Math.random() < 0.6) fx.dust(at);
      }
      if (v.latest.hp > 0 && v.latest.hp < BUGGY.maxHp * 0.35) fx.engineSmoke(this.tmp.copy(Buggy.ENGINE).applyMatrix4(root.matrixWorld));
    }
    if (boosting) {
      const back = { x: Math.sin(v.yaw), y: 0, z: Math.cos(v.yaw) };
      for (const e of Buggy.EXHAUSTS) fx.nitro(this.tmp.copy(e).applyMatrix4(root.matrixWorld), back);
    }
  }

  private skid(at: THREE.Vector3, heading: number): void {
    const i = this.nextSkid;
    this.nextSkid = (this.nextSkid + 1) % SKID_POOL;
    this.skids.count = Math.max(this.skids.count, i + 1);
    this.quat.setFromAxisAngle(this.up, heading);
    this.skids.setMatrixAt(i, this.matrix.compose(this.seat.set(at.x, 0.015, at.z), this.quat, this.one));
    this.skids.instanceMatrix.needsUpdate = true;
  }

  /** World position and yaw of the driver's seat, for placing a chicken in the car. */
  seatOf(id: number, out: THREE.Vector3): { position: THREE.Vector3; yaw: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    this.seat.copy(Buggy.SEAT).applyAxisAngle(this.up, v.yaw);
    out.set(v.x + this.seat.x, this.seat.y, v.z + this.seat.z);
    return { position: out, yaw: v.yaw };
  }

  dispose(): void {
    for (const v of this.views.values()) v.model.dispose();
    this.views.clear();
    this.skids.removeFromParent();
    this.skids.geometry.dispose();
    (this.skids.material as THREE.Material).dispose();
  }
}
