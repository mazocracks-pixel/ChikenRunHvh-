import { PLAYER } from './constants';
import { clamp, wrapAngle } from './math';
import type { InputFrame, MoveState } from './physics';

/** Source movement ratios in this game's units: 250 Source units/s corresponds to PLAYER.speed. */
export const SOURCE_MOVE = {
  groundAcceleration: 5.5, airAcceleration: 12, friction: 5.2,
  stopSpeed: PLAYER.speed * 80 / 250, airWishSpeed: PLAYER.speed * 30 / 250,
  deadStrafeSpeed: PLAYER.speed * 140 / 250, maxVelocity: PLAYER.speed * 3500 / 250,
  strafeSubsteps: 8,
} as const;

export function airSurfaceFriction(vy: number): number { return vy > 0 && vy < SOURCE_MOVE.deadStrafeSpeed ? 0.25 : 1; }

/** Friction acts on existing ground momentum; counter-input then accelerates against it. */
export function groundFriction(v: { x: number; z: number }, dt: number): void {
  const speed = Math.hypot(v.x, v.z);
  if (!speed) return;
  const next = Math.max(0, speed - Math.max(speed, SOURCE_MOVE.stopSpeed) * SOURCE_MOVE.friction * dt);
  v.x *= next / speed; v.z *= next / speed;
}

/** Cap the velocity projection along wish direction, not the total horizontal speed. */
export function accelerateWish(v: { x: number; z: number }, wishX: number, wishZ: number, dt: number, airborne: boolean, surfaceFriction = 1): void {
  const wishSpeed = Math.hypot(wishX, wishZ);
  if (!wishSpeed) return;
  const dx = wishX / wishSpeed, dz = wishZ / wishSpeed;
  const cap = airborne ? Math.min(wishSpeed, SOURCE_MOVE.airWishSpeed) : wishSpeed;
  const room = cap - (v.x * dx + v.z * dz);
  if (room <= 0) return;
  // Source's air rule uses the uncapped wish speed in the acceleration amount.
  const add = Math.min(room, (airborne ? SOURCE_MOVE.airAcceleration : SOURCE_MOVE.groundAcceleration) * wishSpeed * dt * surfaceFriction);
  v.x += dx * add; v.z += dz * add;
}

/** Closest efficient wish angle to the player's requested world direction. */
function strafeYaw(vx: number, vz: number, targetYaw: number, turn: number, dt: number, maxSpeed: number, friction: number): number {
  const velocityYaw = Math.atan2(-vx, -vz), speed = Math.hypot(vx, vz);
  const amount = SOURCE_MOVE.airAcceleration * maxSpeed * dt * friction;
  const cap = Math.min(maxSpeed, SOURCE_MOVE.airWishSpeed);
  const angle = Math.acos(clamp(Math.max(0, cap - amount) / Math.max(speed, 0.01), 0, 1));
  const difference = wrapAngle(targetYaw - velocityYaw);
  const side = Math.abs(difference) > 0.0001 ? Math.sign(difference) : Math.sign(turn) || 1;
  return velocityYaw + side * angle;
}

/** Follow WASD intent while optimizing air acceleration; never change the camera. */
export function airStrafeInput(frame: InputFrame, state: MoveState, turn: number, dt: number, maxSpeed: number): InputFrame {
  if (state.onGround || state.jetting || state.gliding) return frame;
  const vx = (state.walkVx ?? 0) + state.vx, vz = (state.walkVz ?? 0) + state.vz, speed = Math.hypot(vx, vz);
  if (speed < 0.01) return frame;
  const targetYaw = frame.yaw + (frame.forward || frame.right ? Math.atan2(-frame.right, frame.forward) : 0);
  const wishYaw = strafeYaw(vx,vz,targetYaw,turn,dt,maxSpeed,airSurfaceFriction(state.vy - PLAYER.gravity * dt));
  const dx = -Math.sin(wishYaw), dz = -Math.cos(wishYaw);
  return { ...frame, forward: -Math.sin(frame.yaw) * dx - Math.cos(frame.yaw) * dz,
    right: Math.cos(frame.yaw) * dx - Math.sin(frame.yaw) * dz };
}

/** HvH's subtick exploit: re-optimize directions within one fixed tick, with no extra elapsed time. */
export function accelerateSubtickStrafe(v: { x: number; z: number }, frame: InputFrame, dt: number, maxSpeed: number, friction: number): void {
  const targetYaw = frame.yaw + (frame.forward || frame.right ? Math.atan2(-frame.right, frame.forward) : 0);
  const slice = dt / SOURCE_MOVE.strafeSubsteps;
  for (let i=0;i<SOURCE_MOVE.strafeSubsteps;i++) {
    const yaw = Math.hypot(v.x,v.z)<0.01 ? targetYaw : strafeYaw(v.x,v.z,targetYaw,0,slice,maxSpeed,friction);
    accelerateWish(v,-Math.sin(yaw)*maxSpeed,-Math.cos(yaw)*maxSpeed,slice,true,friction);
  }
}
