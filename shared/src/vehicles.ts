import type { Aabb, CollisionWorld } from './collision';
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
} as const;

export interface CarState {
  x: number;
  z: number;
  yaw: number;
  /** Signed speed along the facing direction (negative = reversing). */
  speed: number;
}

const scratch: Aabb[] = [];

/**
 * Arcade car physics on flat ground: throttle/brake/reverse, speed-dependent steering and
 * circle-vs-box collisions. Deterministic, so the driver predicts it exactly like walking.
 */
export function stepCar(car: CarState, input: InputFrame, dt: number, world: CollisionWorld): void {
  const throttle = clamp(input.forward, -1, 1);
  const steer = clamp(input.right, -1, 1);

  if (input.jump) {
    // Handbrake.
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), BUGGY.brake * dt);
  } else if (throttle > 0) {
    car.speed = car.speed < 0 ? Math.min(0, car.speed + BUGGY.brake * dt) : Math.min(BUGGY.maxSpeed, car.speed + BUGGY.accel * throttle * dt);
  } else if (throttle < 0) {
    car.speed = car.speed > 0 ? Math.max(0, car.speed - BUGGY.brake * dt) : Math.max(-BUGGY.reverseSpeed, car.speed + BUGGY.accel * throttle * dt);
  } else {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), BUGGY.drag * dt);
  }

  // Steering needs some speed, and flips when reversing (like a real car).
  const grip = clamp(car.speed / BUGGY.steerSpeed, -1, 1);
  car.yaw -= steer * BUGGY.turnRate * grip * dt;

  car.x += -Math.sin(car.yaw) * car.speed * dt;
  car.z += -Math.cos(car.yaw) * car.speed * dt;
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
  if (bumped) car.speed *= 0.5;
  const limit = world.halfSize - r;
  if (Math.abs(car.x) > limit || Math.abs(car.z) > limit) car.speed *= 0.5;
  car.x = clamp(car.x, -limit, limit);
  car.z = clamp(car.z, -limit, limit);
}

/** Axis-aligned box around a car (bullets and blasts use this). */
export function carAabb(car: CarState): Aabb {
  const r = BUGGY.radius;
  return { minX: car.x - r, maxX: car.x + r, minY: 0, maxY: BUGGY.height, minZ: car.z - r, maxZ: car.z + r };
}
