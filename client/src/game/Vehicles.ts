import * as THREE from 'three';
import { BUGGY, lerp, lerpAngle, unpackVehicle, type CarState, type PackedVehicle, type VehicleState } from '@game/shared';
import { Buggy } from './models/Buggy';

const COLORS = [0xe53935, 0xffb300, 0x43a047, 0x1e88e5];

interface View {
  model: Buggy;
  buffer: { t: number; s: VehicleState }[];
  latest: VehicleState;
  /** Position/yaw as drawn this frame. */
  x: number;
  z: number;
  yaw: number;
}

/** Draws the buggies: remote ones interpolated from snapshots, your own from prediction. */
export class Vehicles {
  private readonly scene: THREE.Scene;
  private readonly views = new Map<number, View>();
  private readonly seat = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  pushSnapshot(t: number, packed: PackedVehicle[]): void {
    for (const p of packed) {
      const s = unpackVehicle(p);
      let view = this.views.get(s.id);
      if (!view) {
        const model = new Buggy(COLORS[(s.id - 1) % COLORS.length]);
        this.scene.add(model.root);
        view = { model, buffer: [], latest: s, x: s.x, z: s.z, yaw: s.yaw };
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

  render(renderTime: number, dt: number, own: { id: number; car: CarState } | null): void {
    for (const [id, v] of this.views) {
      v.model.root.visible = v.latest.hp > 0;
      let speed: number;
      if (own && own.id === id) {
        v.x = own.car.x;
        v.z = own.car.z;
        v.yaw = own.car.yaw;
        speed = own.car.speed;
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
          speed = a.s.speed;
        } else {
          const k = (renderTime - a.t) / (b.t - a.t);
          v.x = lerp(a.s.x, b.s.x, k);
          v.z = lerp(a.s.z, b.s.z, k);
          v.yaw = lerpAngle(a.s.yaw, b.s.yaw, k);
          speed = lerp(a.s.speed, b.s.speed, k);
        }
      }
      v.model.root.position.set(v.x, 0, v.z);
      v.model.root.rotation.y = v.yaw;
      v.model.animate(dt, speed);
    }
  }

  /** World position and yaw of the driver's seat, for placing a chicken in the car. */
  seatOf(id: number, out: THREE.Vector3): { position: THREE.Vector3; yaw: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    this.seat.copy(Buggy.SEAT).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw);
    out.set(v.x + this.seat.x, this.seat.y, v.z + this.seat.z);
    return { position: out, yaw: v.yaw };
  }

  dispose(): void {
    for (const v of this.views.values()) v.model.dispose();
    this.views.clear();
  }
}
