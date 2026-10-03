import {
  BUGGY,
  PLAYER,
  PROJECTILES,
  SIM_DT,
  carAabb,
  isSpaceFree,
  packVehicle,
  rayAabb,
  stepCar,
  type CarState,
  type InputFrame,
  type PackedVehicle,
  type Ray,
  type Vec3,
  type VehicleSpot,
} from '@game/shared';
import type { GameRoom } from './GameRoom';
import type { ServerPlayer } from './ServerPlayer';

const NEUTRAL: InputFrame = { seq: 0, forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 };
const RAM_COOLDOWN_MS = 600;

interface Vehicle {
  id: number;
  spot: VehicleSpot;
  state: CarState;
  driver: ServerPlayer | null;
  hp: number;
  /** While destroyed: when it comes back. 0 = alive. */
  respawnAt: number;
  lastRam: Map<number, number>;
}

/** Drivable buggies: entering/exiting, driving with the driver's inputs, ramming and wrecks. */
export class VehicleSystem {
  private readonly room: GameRoom;
  private readonly vehicles: Vehicle[];

  constructor(room: GameRoom) {
    this.room = room;
    this.vehicles = room.map.vehicles.map((spot, i) => ({
      id: i + 1,
      spot,
      state: { x: spot.x, z: spot.z, yaw: spot.yaw, speed: 0 },
      driver: null,
      hp: BUGGY.maxHp,
      respawnAt: 0,
      lastRam: new Map(),
    }));
  }

  packed(): PackedVehicle[] {
    return this.vehicles.map((v) =>
      packVehicle({ id: v.id, x: v.state.x, z: v.state.z, yaw: v.state.yaw, speed: v.state.speed, driver: v.driver?.pid ?? 0, hp: v.respawnAt ? 0 : v.hp }),
    );
  }

  reset(): void {
    for (const v of this.vehicles) {
      if (v.driver) this.eject(v.driver);
      this.restore(v);
    }
  }

  /** E key: get into the nearest free buggy, or out of the one you're driving. */
  use(p: ServerPlayer): void {
    if (!p.alive) return;
    if (p.vehicle) {
      this.eject(p);
      return;
    }
    let best: Vehicle | null = null;
    let bestDist: number = BUGGY.useRange;
    for (const v of this.vehicles) {
      if (v.driver || v.respawnAt) continue;
      const d = Math.hypot(v.state.x - p.state.x, v.state.z - p.state.z);
      if (d < bestDist && p.state.y < 1.5) {
        best = v;
        bestDist = d;
      }
    }
    if (!best) return;
    best.driver = p;
    p.vehicle = best.id;
    p.reloadUntil = 0;
    p.aiming = false;
    this.syncDriver(best);
  }

  /** Applies the driver's input to their car (called instead of walking physics). */
  drive(p: ServerPlayer, frame: InputFrame): void {
    const v = this.vehicles.find((x) => x.id === p.vehicle);
    if (!v || v.driver !== p) {
      p.vehicle = 0;
      return;
    }
    stepCar(v.state, frame, SIM_DT, this.room.world);
    this.syncDriver(v);
  }

  /** Puts the driver back on foot beside the car. */
  eject(p: ServerPlayer): void {
    const v = this.vehicles.find((x) => x.driver === p);
    p.vehicle = 0;
    if (!v) return;
    v.driver = null;
    const { x, z, yaw } = v.state;
    const sides = [
      [Math.cos(yaw) * 2, -Math.sin(yaw) * 2],
      [-Math.cos(yaw) * 2, Math.sin(yaw) * 2],
      [Math.sin(yaw) * 2.6, Math.cos(yaw) * 2.6],
      [0, 0],
    ];
    for (const [dx, dz] of sides) {
      const px = x + dx!;
      const pz = z + dz!;
      const limit = this.room.map.halfSize - PLAYER.radius;
      if (Math.abs(px) < limit && Math.abs(pz) < limit && isSpaceFree(px, 0, pz, this.room.world)) {
        p.state.x = px;
        p.state.z = pz;
        break;
      }
    }
    p.state.y = 0;
    p.state.vx = p.state.vz = p.state.vy = 0;
    p.state.onGround = true;
  }

  update(now: number): void {
    for (const v of this.vehicles) {
      if (v.respawnAt) {
        if (now >= v.respawnAt) this.restore(v);
        continue;
      }
      if (v.driver && (!v.driver.alive || !this.room.players.has(v.driver.pid))) this.eject(v.driver);
      // Empty cars keep rolling until friction stops them.
      if (!v.driver && v.state.speed !== 0) stepCar(v.state, NEUTRAL, SIM_DT, this.room.world);
      if (Math.abs(v.state.speed) >= BUGGY.ramMinSpeed) this.ram(v, now);
    }
  }

  /** Nearest intact car along a bullet's path. */
  raycast(ray: Ray, maxT: number): { id: number; t: number } | null {
    let best: { id: number; t: number } | null = null;
    for (const v of this.vehicles) {
      if (v.respawnAt) continue;
      const t = rayAabb(ray, carAabb(v.state), best ? best.t : maxT);
      if (t >= 0) best = { id: v.id, t };
    }
    return best;
  }

  damage(id: number, amount: number, attacker: ServerPlayer | null, now: number): void {
    const v = this.vehicles.find((x) => x.id === id);
    if (!v || v.respawnAt || amount <= 0) return;
    // Teammates can't wreck your ride.
    if (attacker && v.driver && this.room.areTeammates(attacker, v.driver)) return;
    v.hp -= amount;
    if (v.hp <= 0) this.destroy(v, attacker, now);
  }

  blast(centre: Vec3, radius: number, amount: number, owner: ServerPlayer | null, now: number): void {
    for (const v of this.vehicles) {
      if (v.respawnAt) continue;
      const d = Math.hypot(v.state.x - centre.x, 0.6 - centre.y, v.state.z - centre.z);
      if (d < radius + BUGGY.radius) this.damage(v.id, amount * Math.max(0.3, 1 - d / (radius + BUGGY.radius)), owner, now);
    }
  }

  private destroy(v: Vehicle, attacker: ServerPlayer | null, now: number): void {
    const driver = v.driver;
    if (driver) this.eject(driver);
    v.respawnAt = now + BUGGY.respawnMs;
    v.state.speed = 0;
    const centre = { x: v.state.x, y: 0.8, z: v.state.z };
    this.room.io.to(this.room.channel).emit('explode', { id: -v.id, kind: 'rocket', x: centre.x, y: centre.y, z: centre.z });
    // The wreck goes up like a rocket blast (hurts the ex-driver too).
    this.room.projectiles.blastAt(centre, PROJECTILES.rocket, attacker, 'car', now);
  }

  private restore(v: Vehicle): void {
    v.state = { x: v.spot.x, z: v.spot.z, yaw: v.spot.yaw, speed: 0 };
    v.hp = BUGGY.maxHp;
    v.respawnAt = 0;
    v.lastRam.clear();
  }

  private syncDriver(v: Vehicle): void {
    const p = v.driver!;
    p.state.x = v.state.x;
    p.state.z = v.state.z;
    p.state.y = 0;
    p.state.vx = p.state.vy = p.state.vz = 0;
    p.state.onGround = true;
  }

  private ram(v: Vehicle, now: number): void {
    const speed = Math.abs(v.state.speed);
    for (const target of this.room.players.values()) {
      if (!target.alive || target.vehicle || target === v.driver) continue;
      if (v.driver && this.room.areTeammates(v.driver, target)) continue;
      if (target.state.y > BUGGY.height) continue;
      const dx = target.state.x - v.state.x;
      const dz = target.state.z - v.state.z;
      const dist = Math.hypot(dx, dz);
      if (dist > BUGGY.radius + PLAYER.radius) continue;
      if (now - (v.lastRam.get(target.pid) ?? -Infinity) < RAM_COOLDOWN_MS) continue;
      v.lastRam.set(target.pid, now);
      const nx = dist > 0.01 ? dx / dist : 1;
      const nz = dist > 0.01 ? dz / dist : 0;
      target.state.vx += nx * speed * 0.9;
      target.state.vz += nz * speed * 0.9;
      target.state.vy = Math.max(target.state.vy, 5);
      target.state.onGround = false;
      v.state.speed *= 0.7;
      this.room.damage(target, v.driver, BUGGY.ramDamagePerSpeed * speed, false, 'car', { x: v.state.x, y: 0.6, z: v.state.z }, now);
    }
  }
}
