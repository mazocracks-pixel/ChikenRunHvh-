import type { Aabb, CollisionWorld } from './collision';
import { PLAYER } from './constants';
import { clamp } from './math';
import type { InputFrame } from './physics';

export const BUGGY = {
  /** Collision circle radius on the ground plane. */
  radius: 1.25,
  /** Boxes lower than this get bumped into; higher ones (roofs, lintels) are driven under. */
  height: 1.3,
  maxSpeed: 17,
  reverseSpeed: 6,
  accel: 13,
  brake: 28,
  /** Rolling resistance with no throttle (m/s²). */
  drag: 4,
  /** Yaw rate (rad/s) at full steering once moving at `steerSpeed` or more. */
  turnRate: 2.3,
  steerSpeed: 6,
  maxHp: 220,
  /** How close you must be to get in. */
  useRange: 3.2,
  /** Ramming chickens hurts above this speed. */
  ramMinSpeed: 5,
  ramDamagePerSpeed: 7,
  respawnMs: 20000,
  /** Sideways grip: how fast a slide straightens out (1/s). The handbrake lets it drift. */
  grip: 7,
  driftGrip: 0.9,
  /** Handbrake: brakes gently (so a drift keeps its speed) and turns harder. */
  handbrake: 9,
  handbrakeTurn: 1.6,
  /** Nitro (Shift): faster and quicker while the tank lasts; it refills slowly. */
  boostSpeed: 25,
  boostAccel: 26,
  boostDrain: 0.4,
  boostRefill: 0.1,
  /** Below this much nitro it can't be lit again. */
  boostMin: 0.15,
} as const;

/** Where the driver sits, in the car's frame (x right, z back). Used for shooting from the car. */
export const BUGGY_SEAT = { x: 0, y: 0.42, z: 0.32 } as const;

/** The driver's seat in the world. */
export function seatPosition(car: { x: number; z: number; yaw: number }): { x: number; y: number; z: number } {
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  return { x: car.x + BUGGY_SEAT.x * c + BUGGY_SEAT.z * s, y: BUGGY_SEAT.y, z: car.z - BUGGY_SEAT.x * s + BUGGY_SEAT.z * c };
}

export function newCar(x: number, z: number, yaw: number): CarState {
  return { x, z, yaw, speed: 0, slip: 0, boost: 1 };
}

export interface CarState {
  x: number;
  z: number;
  yaw: number;
  /** Signed speed along the facing direction (negative = reversing). */
  speed: number;
  /** Sideways speed (positive = sliding to the car's right): drifts. */
  slip: number;
  /** Nitro left, 0–1. */
  boost: number;
}

const scratch: Aabb[] = [];

/**
 * Arcade car physics on flat ground: throttle/brake/reverse, speed-dependent steering, sideways
 * slide (drifts with the handbrake), nitro and circle-vs-box collisions. Deterministic, so the
 * driver predicts it exactly like walking.
 */
export function stepCar(car: CarState, input: InputFrame, dt: number, world: CollisionWorld): void {
  const throttle = clamp(input.forward, -1, 1);
  const steer = clamp(input.right, -1, 1);
  const handbrake = input.jump;
  const boosting = input.boost === true && throttle > 0 && !handbrake && car.boost > (car.speed > BUGGY.maxSpeed ? 0 : BUGGY.boostMin);
  const top = boosting ? BUGGY.boostSpeed : BUGGY.maxSpeed;
  const accel = boosting ? BUGGY.boostAccel : BUGGY.accel;
  // It refills only while Shift is let go, so an empty tank can't sputter on and off.
  if (boosting) car.boost = Math.max(0, car.boost - BUGGY.boostDrain * dt);
  else if (input.boost !== true) car.boost = Math.min(1, car.boost + BUGGY.boostRefill * dt);

  if (handbrake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), BUGGY.handbrake * dt);
  } else if (throttle > 0) {
    if (car.speed < 0) car.speed = Math.min(0, car.speed + BUGGY.brake * dt);
    else if (car.speed > top) car.speed = Math.max(top, car.speed - BUGGY.drag * 2 * dt);
    else car.speed = Math.min(top, car.speed + accel * throttle * dt);
  } else if (throttle < 0) {
    car.speed = car.speed > 0 ? Math.max(0, car.speed - BUGGY.brake * dt) : Math.max(-BUGGY.reverseSpeed, car.speed + BUGGY.accel * throttle * dt);
  } else {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), BUGGY.drag * dt);
  }

  // Steering needs some speed, and flips when reversing (like a real car). The handbrake swings
  // the back out.
  const grip = clamp(car.speed / BUGGY.steerSpeed, -1, 1);
  const turn = steer * BUGGY.turnRate * grip * (handbrake ? BUGGY.handbrakeTurn : 1) * dt;
  car.yaw -= turn;
  // The car turned but its momentum didn't: some forward speed becomes sideways slide...
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const forward = car.speed * c + car.slip * s;
  car.slip = car.slip * c - car.speed * s;
  car.speed = forward;
  // ...which the tyres scrub off (slowly with the handbrake on: a drift).
  car.slip *= Math.exp(-(handbrake ? BUGGY.driftGrip : BUGGY.grip) * dt);
  if (Math.abs(car.slip) < 1e-3) car.slip = 0;

  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  car.x += (fx * car.speed + -fz * car.slip) * dt;
  car.z += (fz * car.speed + fx * car.slip) * dt;
  collide(car, world);
}

function collide(car: CarState, world: CollisionWorld): void {
  const r = BUGGY.radius;
  let bumped = false;
  for (const b of world.query(car.x - r, car.z - r, car.x + r, car.z + r, scratch)) {
    if (b.minY >= BUGGY.height || b.maxY <= 0.05) continue;
    const cx = clamp(car.x, b.minX, b.maxX);
    const cz = clamp(car.z, b.minZ, b.maxZ);
    let dx = car.x - cx;
    let dz = car.z - cz;
    let dist = Math.hypot(dx, dz);
    if (dist >= r) continue;
    if (dist < 1e-6) {
      // Centre inside the box: leave through the nearest face.
      const exits = [car.x - b.minX, b.maxX - car.x, car.z - b.minZ, b.maxZ - car.z];
      const i = exits.indexOf(Math.min(...exits));
      dx = i === 0 ? -1 : i === 1 ? 1 : 0;
      dz = i === 2 ? -1 : i === 3 ? 1 : 0;
      dist = 0;
      car.x += dx * (exits[i]! + r);
      car.z += dz * (exits[i]! + r);
    } else {
      car.x += (dx / dist) * (r - dist);
      car.z += (dz / dist) * (r - dist);
    }
    bumped = true;
  }
  if (bumped) {
    car.speed *= 0.5;
    car.slip *= 0.3;
  }
  const limit = world.halfSize - r;
  if (Math.abs(car.x) > limit || Math.abs(car.z) > limit) car.speed *= 0.5;
  car.x = clamp(car.x, -limit, limit);
  car.z = clamp(car.z, -limit, limit);
}

/**
 * How much a car's speed spoils the driver's aim, as a walking speed for spreadFor: nothing while
 * nearly still, like walking at full speed when flat out.
 */
export function carAimSpeed(carSpeed: number): number {
  return carSpeed < 2.5 ? 0 : Math.min(1, carSpeed / BUGGY.maxSpeed) * PLAYER.speed;
}

/** Axis-aligned box around a car (bullets and blasts use this). */
export function carAabb(car: { x: number; z: number }): Aabb {
  const r = BUGGY.radius;
  return { minX: car.x - r, maxX: car.x + r, minY: 0, maxY: BUGGY.height, minZ: car.z - r, maxZ: car.z + r };
}
