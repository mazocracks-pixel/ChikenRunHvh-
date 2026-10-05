import type { Aabb, CollisionWorld } from './collision';
import { CROUCH, HOP, JETPACK, PLAYER } from './constants';
import type { MoveMods } from './dev';
import { clamp } from './math';
import { SOURCE_MOVE, accelerateWish, accelerateSubtickStrafe, airSurfaceFriction, groundFriction } from './movement';

/** The part of a player's state that movement reads and writes. */
export interface MoveState {
  x: number;
  y: number;
  z: number;
  /** Pending external horizontal impulses, folded into persistent movement velocity each tick. */
  vx: number;
  vy: number;
  vz: number;
  /** Actual horizontal speed after collisions, in metres per second. */
  horizontalSpeed: number;
  walkVx?: number;
  walkVz?: number;
  crouchAmount?: number;
  onGround: boolean;
  /** Jetpack fuel in seconds of thrust. */
  fuel: number;
  /** Jump button state on the previous tick (to detect a fresh press). */
  jumpHeld: boolean;
  /** Jetpack currently firing. */
  jetting: boolean;
  /** Wings out: falling slowly (a fresh jump press in the air without fuel). */
  gliding: boolean;
  /** Legacy packet field: observed excess speed ratio, never used to grant acceleration. */
  hop: number;
  /** Ticks spent on the ground since the last landing (for chaining hops). */
  groundTicks: number;
  /** Crouched: slower and smaller. */
  crouching: boolean;
}

/** One fixed tick of player intent, sent client → server. */
export interface InputFrame {
  /** Strictly increasing per client; the server echoes the last applied one back as `ack`. */
  seq: number;
  /** -1 (back) … 1 (forward). */
  forward: number;
  /** -1 (left) … 1 (right). */
  right: number;
  jump: boolean;
  /** Supported landing-timing helper; requires jump to be held and grants no speed. */
  autoHop?: boolean;
  /** HvH-only air-direction optimization within a fixed tick, never extra simulation time. */
  subtickStrafe?: boolean;
  /** Radians around +Y. 0 faces -Z (the Three.js convention). */
  yaw: number;
  /** Radians, positive looks up. Not used by movement; lets others see where you aim. */
  pitch: number;
  /** Crouch held. */
  crouch?: boolean;
  /** Shift held on foot: lower ground speed, hence lower movement spread. */
  slowWalk?: boolean;
  /** Use (E) held: plant / defuse the bomb. */
  use?: boolean;
  /** HvH: invert the bounded fake pose; never changes movement or shot direction. */
  invert?: boolean;
  /** Shift held: nitro while driving. */
  boost?: boolean;
}

export function createMoveState(x: number, y: number, z: number): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, horizontalSpeed: 0, onGround: y <= 0, fuel: 0, jumpHeld: false, jetting: false, gliding: false, hop: 0, groundTicks: MAX_GROUND_TICKS, crouching: false };
}

export function copyMoveState(from: MoveState, to: MoveState): MoveState {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.horizontalSpeed = from.horizontalSpeed ?? 0;
  to.walkVx = from.walkVx ?? 0;
  to.walkVz = from.walkVz ?? 0;
  to.crouchAmount = from.crouchAmount;
  to.onGround = from.onGround;
  to.fuel = from.fuel;
  to.jumpHeld = from.jumpHeld;
  to.jetting = from.jetting;
  to.gliding = from.gliding;
  to.hop = from.hop;
  to.groundTicks = from.groundTicks;
  to.crouching = from.crouching;
  return to;
}

const MAX_GROUND_TICKS = 255;
const MAX_FALL_SPEED = 30;
const EPS = 1e-4;
const R = PLAYER.radius;

/** How big a chicken is drawn and hit: 1 standing, CROUCH.scale crouched. */
export function bodyScale(s: { crouching: boolean; crouchAmount?: number }): number {
  return s.crouchAmount === undefined ? s.crouching ? CROUCH.scale : 1 : 1 - clamp(s.crouchAmount, 0, 1) * (1 - CROUCH.scale);
}

/** Height of the eyes (where shots start) above the feet. */
export function eyeHeightOf(s: { crouching: boolean; crouchAmount?: number }): number {
  return PLAYER.eyeHeight * bodyScale(s);
}

/** Collision height. */
export function heightOf(s: { crouching: boolean; crouchAmount?: number }): number {
  return PLAYER.height * bodyScale(s);
}
const scratch: Aabb[] = [];

/**
 * Advances one player by one fixed tick.
 *
 * Deterministic on purpose: the client runs it to predict its own movement and the
 * server runs it as the authority. Given the same inputs they must produce the same
 * result, so keep it free of randomness, wall-clock time and per-side special cases.
 */
/** @param hopMax excess takeoff speed fraction (hopMaxFor); both sides pass the same. */
/** @param weaponSpeed walking speed multiplier of the weapon in hand (moveSpeedFor; the LMG is slower). */
export function stepPlayer(s: MoveState, input: InputFrame, dt: number, world: CollisionWorld, mods?: MoveMods | null, hopMax: number = HOP.max, weaponSpeed = 1, tactical = false): void {
  const x = s.x, z = s.z;
  stepMovement(s, input, dt, world, mods, hopMax, weaponSpeed, tactical);
  s.horizontalSpeed = dt > 0 ? Math.hypot(s.x - x, s.z - z) / dt : 0;
}

function stepMovement(s: MoveState, input: InputFrame, dt: number, world: CollisionWorld, mods: MoveMods | null | undefined, hopMax: number, weaponSpeed: number, tactical: boolean): void {
  let f = clamp(input.forward, -1, 1);
  let r = clamp(input.right, -1, 1);
  const len = Math.hypot(f, r);
  if (len > 1) {
    f /= len;
    r /= len;
  }

  if (mods && (mods.fly || mods.noclip)) {
    s.crouching = false;
    stepFlying(s, input, f, r, dt, world, mods);
    return;
  }
  // Crouch while held; standing back up needs headroom.
  if (input.crouch) s.crouching = true;
  else if (s.crouching && canStand(s, world)) s.crouching = false;
  if (tactical) s.crouchAmount = clamp((s.crouchAmount ?? 0) + clamp((s.crouching ? 1 : 0) - (s.crouchAmount ?? 0), -dt * 8, dt * 8), 0, 1);
  if (mods?.infiniteFuel) s.fuel = JETPACK.maxFuel;
  const slowWalking = input.slowWalk === true && s.onGround;
  const moveScale = s.crouching ? CROUCH.speed : slowWalking ? PLAYER.slowWalkSpeed : 1;
  const runSpeed = PLAYER.speed * (mods?.speed ?? 1) * weaponSpeed;
  const walk = runSpeed * moveScale;
  const velocity = { x: (s.walkVx ?? 0) + s.vx, z: (s.walkVz ?? 0) + s.vz };
  s.vx = s.vz = 0;
  const gravity = PLAYER.gravity * (mods?.gravity ?? 1);

  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);

  // Jump before ground friction: a correctly timed hop preserves landing momentum.
  // Holding Space alone does not re-jump; autoHop changes timing, never acceleration.
  const pressed = input.jump && !s.jumpHeld;
  if (s.onGround) {
    s.jetting = false;
    s.gliding = false;
    if (input.jump && (pressed || input.autoHop === true)) {
      const speed = Math.hypot(velocity.x, velocity.z), limit = runSpeed * (1 + clamp(hopMax, 0, HOP.max));
      if (speed > limit && speed) { velocity.x *= limit / speed; velocity.z *= limit / speed; }
      s.vy = PLAYER.jumpVelocity * (mods?.jump ?? 1);
      s.onGround = false;
    }
  } else {
    if (pressed && !tactical) {
      if (s.fuel > 0) s.jetting = true;
      else s.gliding = true;
    }
    if (!input.jump) s.jetting = s.gliding = false;
    if (s.fuel <= 0) s.jetting = false;
  }
  s.jumpHeld = input.jump;

  if (s.jetting) {
    s.fuel = Math.max(0, s.fuel - dt);
    s.vy = Math.min(s.vy + JETPACK.thrust * dt, JETPACK.maxRiseSpeed);
  } else {
    s.vy = Math.max(s.vy - gravity * dt, -MAX_FALL_SPEED);
    if (s.gliding && s.vy < -PLAYER.glideFallSpeed) s.vy = -PLAYER.glideFallSpeed;
  }
  if (s.onGround) {
    groundFriction(velocity, dt);
  }
  if (tactical && input.subtickStrafe === true && !s.onGround && !s.jetting && !s.gliding) {
    accelerateSubtickStrafe(velocity,input,dt,walk,airSurfaceFriction(s.vy));
  } else accelerateWish(velocity, (-sin * f + cos * r) * walk, (-cos * f - sin * r) * walk, dt, !s.onGround, airSurfaceFriction(s.vy));
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > SOURCE_MOVE.maxVelocity) { velocity.x *= SOURCE_MOVE.maxVelocity / speed; velocity.z *= SOURCE_MOVE.maxVelocity / speed; }
  s.walkVx = velocity.x; s.walkVz = velocity.z;
  moveX(s, velocity.x * dt, world);
  moveZ(s, velocity.z * dt, world);
  const excessSpeed = Math.hypot(s.walkVx ?? 0, s.walkVz ?? 0) / (runSpeed || PLAYER.speed) - 1;
  s.hop = excessSpeed > 1e-9 ? excessSpeed : 0;
  const wasOnGround = s.onGround;
  moveY(s, s.vy * dt, world);
  if (s.onGround) s.groundTicks = wasOnGround ? Math.min(MAX_GROUND_TICKS, s.groundTicks + 1) : 0;
}

/**
 * Developer fly / noclip: move along the look direction (Space rises), no gravity. Noclip also
 * ignores walls but still stays above the ground and inside the play area.
 */
function stepFlying(s: MoveState, input: InputFrame, f: number, r: number, dt: number, world: CollisionWorld, mods: MoveMods): void {
  const speed = PLAYER.speed * 1.6 * mods.speed;
  const sy = Math.sin(input.yaw);
  const cy = Math.cos(input.yaw);
  const cp = Math.cos(input.pitch);
  const sp = Math.sin(input.pitch);
  const dx = (-sy * cp * f + cy * r) * speed;
  const dz = (-cy * cp * f - sy * r) * speed;
  const dy = (sp * f + (input.jump ? 0.8 : 0)) * speed;
  s.vx = s.vy = s.vz = 0;
  s.walkVx = s.walkVz = 0;
  s.jetting = s.gliding = false;
  s.hop = 0;
  s.jumpHeld = input.jump;
  if (mods.infiniteFuel) s.fuel = JETPACK.maxFuel;
  const wasOnGround = s.onGround;
  if (mods.noclip) {
    const limit = world.halfSize - R;
    s.x = clamp(s.x + dx * dt, -limit, limit);
    s.z = clamp(s.z + dz * dt, -limit, limit);
    s.y = Math.max(0, s.y + dy * dt);
    s.onGround = s.y <= 0;
  } else {
    moveX(s, dx * dt, world);
    moveZ(s, dz * dt, world);
    moveY(s, dy * dt, world);
  }
  s.groundTicks = s.onGround ? (wasOnGround ? Math.min(MAX_GROUND_TICKS, s.groundTicks + 1) : 0) : s.groundTicks;
}

function canStand(s: MoveState, world: CollisionWorld): boolean {
  const standing = { ...s, crouching: false, crouchAmount: undefined };
  return !nearby(s, world).some((b) => overlaps(standing, b));
}

function overlaps(s: MoveState, b: Aabb): boolean {
  return (
    s.x - R < b.maxX - EPS &&
    s.x + R > b.minX + EPS &&
    s.y < b.maxY - EPS &&
    s.y + heightOf(s) > b.minY + EPS &&
    s.z - R < b.maxZ - EPS &&
    s.z + R > b.minZ + EPS
  );
}

function nearby(s: MoveState, world: CollisionWorld): Aabb[] {
  return world.query(s.x - R, s.z - R, s.x + R, s.z + R, scratch);
}

function moveX(s: MoveState, dx: number, world: CollisionWorld): void {
  if (dx === 0) return;
  const start = s.x, end = start + dx;
  s.x = clamp(end, -world.halfSize + R, world.halfSize - R);
  for (const b of world.query(Math.min(start,end)-R,s.z-R,Math.max(start,end)+R,s.z+R,scratch)) {
    if (s.y >= b.maxY-EPS || s.y+heightOf(s) <= b.minY+EPS || s.z-R >= b.maxZ-EPS || s.z+R <= b.minZ+EPS) continue;
    if (dx>0 && start+R<=b.minX+EPS && s.x+R>b.minX) s.x=Math.min(s.x,b.minX-R);
    else if(dx<0 && start-R>=b.maxX-EPS && s.x-R<b.maxX) s.x=Math.max(s.x,b.maxX+R);
    else if(overlaps(s,b)) s.x=dx>0?b.minX-R:b.maxX+R;
  }
  if(Math.abs(s.x-end)>EPS) {s.vx=0;s.walkVx=0;}
}

function moveZ(s: MoveState, dz: number, world: CollisionWorld): void {
  if (dz === 0) return;
  const start=s.z,end=start+dz;
  s.z=clamp(end,-world.halfSize+R,world.halfSize-R);
  for(const b of world.query(s.x-R,Math.min(start,end)-R,s.x+R,Math.max(start,end)+R,scratch)) {
    if(s.y>=b.maxY-EPS || s.y+heightOf(s)<=b.minY+EPS || s.x-R>=b.maxX-EPS || s.x+R<=b.minX+EPS)continue;
    if(dz>0 && start+R<=b.minZ+EPS && s.z+R>b.minZ)s.z=Math.min(s.z,b.minZ-R);
    else if(dz<0 && start-R>=b.maxZ-EPS && s.z-R<b.maxZ)s.z=Math.max(s.z,b.maxZ+R);
    else if(overlaps(s,b))s.z=dz>0?b.minZ-R:b.maxZ+R;
  }
  if(Math.abs(s.z-end)>EPS) {s.vz=0;s.walkVz=0;}
}

function moveY(s: MoveState, dy: number, world: CollisionWorld): void {
  s.y += dy;
  s.onGround = false;
  if (s.y <= 0) {
    s.y = 0;
    s.vy = 0;
    s.onGround = true;
  }
  for (const b of nearby(s, world)) {
    if (!overlaps(s, b)) continue;
    if (dy < 0) {
      s.y = b.maxY;
      s.onGround = true;
    } else {
      s.y = b.minY - heightOf(s);
    }
    s.vy = 0;
  }
}

/** True if a standing player at (x, y, z) would overlap any solid box. */
export function isSpaceFree(x: number, y: number, z: number, world: CollisionWorld): boolean {
  const probe = createMoveState(x, y, z);
  return !nearby(probe, world).some((b) => overlaps(probe, b));
}
