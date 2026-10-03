import * as THREE from 'three';
import {
  CROUCH,
  SIM_DT,
  damp,
  copyMoveState,
  createMoveState,
  lerp,
  stepCar,
  stepPlayer,
  type CarState,
  type CollisionWorld,
  type InputFrame,
  type MoveMods,
  type MoveState,
  type PlayerInfo,
  type PlayerState,
  type VehicleState,
} from '@game/shared';
import { Chicken } from './models/Chicken';

/** Beyond this prediction error (metres) we teleport instead of smoothing, e.g. after a respawn. */
const SNAP_DISTANCE = 2;
/** How quickly a small prediction error is smoothed out of the rendered position. */
const ERROR_DECAY = 12;
/** Safety cap in case the server stops acknowledging inputs (~2 s). */
const MAX_PENDING = 120;

/**
 * The player on this machine, using client-side prediction:
 *  - every tick we apply our own input immediately (no waiting for the server),
 *  - keep the inputs the server hasn't confirmed yet,
 *  - and when a snapshot arrives, rewind to the server's state and replay those inputs.
 */
export class LocalPlayer {
  /** Smoothed position to render and point the camera at. */
  readonly position = new THREE.Vector3();
  readonly chicken: Chicken;
  readonly state: MoveState;
  /** Latest authoritative state from the server (health, ammo, grenades...). */
  server: PlayerState;

  private readonly prev = new THREE.Vector3();
  private readonly errorOffset = new THREE.Vector3();
  /** Inputs the server hasn't confirmed yet, with the hop cap of the weapon held at the time. */
  private pending: { frame: InputFrame; hopMax: number }[] = [];
  private speed = 0;
  /** Predicted buggy while driving, else null. */
  car: CarState | null = null;
  vehicleId = 0;
  /** Smoothed body scale for the camera height (1 standing, smaller crouched). */
  eyeScale = 1;
  /** Developer movement modifiers confirmed by the server (null = normal movement). */
  mods: MoveMods | null = null;

  constructor(scene: THREE.Scene, info: PlayerInfo, spawn: PlayerState) {
    this.server = spawn;
    this.state = copyMoveState(spawn, createMoveState(0, 0, 0));
    this.prev.set(spawn.x, spawn.y, spawn.z);
    this.position.copy(this.prev);
    this.chicken = new Chicken(info.appearance, info.team);
    this.chicken.setWeapon(spawn.weapon);
    scene.add(this.chicken.root);
  }

  get alive(): boolean {
    return this.server.alive;
  }

  get onGround(): boolean {
    return this.state.onGround;
  }

  /** @param hopMax bunny-hop cap for the weapon in hand (the server uses the same, see hopMaxFor). */
  predict(frame: InputFrame, world: CollisionWorld, hopMax: number): void {
    this.prev.set(this.state.x, this.state.y, this.state.z);
    this.step(frame, world, hopMax);
    this.speed = Math.hypot(this.state.x - this.prev.x, this.state.z - this.prev.z) / SIM_DT;
    this.pending.push({ frame, hopMax });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  private step(frame: InputFrame, world: CollisionWorld, hopMax: number): void {
    // A developer froze us: the server ignores our inputs, so don't predict any movement.
    if (this.server.frozen) return;
    if (this.car) this.drive(frame, world);
    else stepPlayer(this.state, frame, SIM_DT, world, this.mods, hopMax);
  }

  /** While driving, inputs steer the car and the chicken rides along. */
  private drive(frame: InputFrame, world: CollisionWorld): void {
    const car = this.car!;
    stepCar(car, frame, SIM_DT, world);
    this.state.x = car.x;
    this.state.z = car.z;
    this.state.y = 0;
    this.state.vx = this.state.vy = this.state.vz = 0;
    this.state.onGround = true;
  }

  reconcile(server: PlayerState, world: CollisionWorld, car?: VehicleState): void {
    this.server = server;
    const bx = this.state.x;
    const by = this.state.y;
    const bz = this.state.z;

    copyMoveState(server, this.state);
    this.pending = this.pending.filter((p) => p.frame.seq > server.ack);
    this.vehicleId = server.vehicle;
    this.car = server.vehicle && car ? { x: car.x, z: car.z, yaw: car.yaw, speed: car.speed } : null;
    if (!server.alive) this.pending = [];
    for (const p of this.pending) this.step(p.frame, world, p.hopMax);

    // Normally tiny, because both sides run the same deterministic stepPlayer.
    const ex = bx - this.state.x;
    const ey = by - this.state.y;
    const ez = bz - this.state.z;
    if (ex * ex + ey * ey + ez * ez > SNAP_DISTANCE * SNAP_DISTANCE) {
      this.snap();
    } else {
      // Shift the interpolation start and carry the difference as a decaying visual offset, so
      // the rendered position doesn't jump this frame and glides onto the corrected path instead.
      this.prev.x -= ex;
      this.prev.y -= ey;
      this.prev.z -= ez;
      this.errorOffset.x += ex;
      this.errorOffset.y += ey;
      this.errorOffset.z += ez;
    }
  }

  /** Teleport (respawn): no smoothing from the old position. */
  respawnAt(x: number, y: number, z: number): void {
    const fresh = createMoveState(x, y, z);
    copyMoveState(fresh, this.state);
    this.pending = [];
    this.snap();
    this.server = { ...this.server, alive: true, x, y, z };
    this.chicken.setDead(false);
  }

  private snap(): void {
    this.errorOffset.set(0, 0, 0);
    this.prev.set(this.state.x, this.state.y, this.state.z);
  }

  /** @param alpha How far we are between the previous and current simulation tick (0..1). */
  render(alpha: number, dt: number, yaw: number, pitch: number, seat: { position: THREE.Vector3; yaw: number } | null = null): void {
    this.errorOffset.multiplyScalar(Math.exp(-ERROR_DECAY * dt));
    this.position.set(
      lerp(this.prev.x, this.state.x, alpha) + this.errorOffset.x,
      lerp(this.prev.y, this.state.y, alpha) + this.errorOffset.y,
      lerp(this.prev.z, this.state.z, alpha) + this.errorOffset.z,
    );
    const c = this.chicken;
    if (seat) {
      c.root.position.copy(seat.position);
      c.root.rotation.y = seat.yaw;
    } else {
      c.root.position.copy(this.position);
      if (this.alive) c.root.rotation.y = yaw;
    }
    c.setDead(!this.alive);
    c.setAim(pitch);
    c.setJetpack(this.state.fuel > 0, this.state.jetting);
    c.setCrouch(this.state.crouching && !seat);
    this.eyeScale = damp(this.eyeScale, this.state.crouching && !seat ? CROUCH.scale : 1, 14, dt);
    c.animate(dt, this.alive && !seat ? this.speed : 0, this.state.onGround);
  }

  dispose(): void {
    this.chicken.dispose();
  }
}
