import type { Aabb, CollisionWorld } from './collision';
import { CROUCH, HOP, JETPACK, PLAYER } from './constants';
import type { MoveMods } from './dev';
import { clamp } from './math';

/** The part of a player's state that movement reads and writes. */
export interface MoveState {
  x: number;
  y: number;
  z: number;
  /** External horizontal velocity (knockback); decays over time. Walking speed is not stored. */
  vx: number;
  vy: number;
  vz: number;
  /** Actual horizontal speed after collisions, in metres per second. */
  horizontalSpeed: number;
  onGround: boolean;
  /** Jetpack fuel in seconds of thrust. */
  fuel: number;
  /** Jump button state on the previous tick (to detect a fresh press). */
  jumpHeld: boolean;
  /** Jetpack currently firing. */
  jetting: boolean;
  /** Wings out: falling slowly (a fresh jump press in the air without fuel). */
  gliding: boolean;
  /** Bunny-hop speed bonus, as a fraction of walking speed (0 … HOP.max). */
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
  /** Radians around +Y. 0 faces -Z (the Three.js convention). */
  yaw: number;
  /** Radians, positive looks up. Not used by movement; lets others see where you aim. */
  pitch: number;
  /** Crouch held. */
  crouch?: boolean;
  /** Use (E) held: plant / defuse the bomb. */
  use?: boolean;
  /** HvH: invert the bounded fake pose; never changes movement or shot direction. */
  invert?: boolean;
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
const GROUND_DRAG = 8;
const AIR_DRAG = 0.8;
const EPS = 1e-4;
const R = PLAYER.radius;

/** How big a chicken is drawn and hit: 1 standing, CROUCH.scale crouched. */
export function bodyScale(s: { crouching: boolean }): number {
  return s.crouching ? CROUCH.scale : 1;
}

/** Height of the eyes (where shots start) above the feet. */
export function eyeHeightOf(s: { crouching: boolean }): number {
  return PLAYER.eyeHeight * bodyScale(s);
}

/** Collision height. */
export function heightOf(s: { crouching: boolean }): number {
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
/** @param hopMax bunny-hop speed cap for the weapon in hand (hopMaxFor); both sides pass the same. */
/** @param weaponSpeed walking speed multiplier of the weapon in hand (moveSpeedFor; the LMG is slower). */
export function stepPlayer(s: MoveState, input: InputFrame, dt: number, world: CollisionWorld, mods?: MoveMods | null, hopMax: number = HOP.max, weaponSpeed = 1): void {
  const x = s.x, z = s.z;
  stepMovement(s, input, dt, world, mods, hopMax, weaponSpeed);
  s.horizontalSpeed = dt > 0 ? Math.hypot(s.x - x, s.z - z) / dt : 0;
}

function stepMovement(s: MoveState, input: InputFrame, dt: number, world: CollisionWorld, mods: MoveMods | null | undefined, hopMax: number, weaponSpeed: number): void {
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
  if (mods?.infiniteFuel) s.fuel = JETPACK.maxFuel;
  // Put the melee weapon away and the extra hop speed goes with it.
  if (s.hop > hopMax) s.hop = hopMax;
  const gravity = PLAYER.gravity * (mods?.gravity ?? 1);

  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const moving = f !== 0 || r !== 0;

  // On the ground jump is held-to-repeat: holding it bunny hops, and every hop taken right
  // after landing (while moving) builds extra speed. In the air, a fresh press fires the
  // jetpack if there's fuel, otherwise spreads the wings to glide.
  const pressed = input.jump && !s.jumpHeld;
  if (s.onGround) {
    s.jetting = false;
    s.gliding = false;
    if (input.jump) {
      const chained = s.groundTicks <= HOP.windowTicks;
      // Crouch-jumping never builds (or keeps) bunny-hop speed: hopping only works standing.
      s.hop = moving && chained && !s.crouching ? Math.min(hopMax, s.hop + HOP.gain) : 0;
      s.vy = PLAYER.jumpVelocity * (mods?.jump ?? 1);
      s.onGround = false;
    } else if (s.groundTicks > HOP.windowTicks) {
      s.hop = Math.max(0, s.hop - HOP.decay * dt);
    }
  } else {
    if (pressed) {
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
  const walk = PLAYER.speed * (1 + s.hop) * (mods?.speed ?? 1) * (s.crouching ? CROUCH.speed : 1) * weaponSpeed;

  // Knockback fades quickly on the ground, slowly in the air.
  const keep = Math.max(0, 1 - (s.onGround ? GROUND_DRAG : AIR_DRAG) * dt);
  s.vx = Math.abs(s.vx * keep) < 0.01 ? 0 : s.vx * keep;
  s.vz = Math.abs(s.vz * keep) < 0.01 ? 0 : s.vz * keep;

  // Resolve one axis at a time so players slide along walls instead of sticking.
  moveX(s, ((-sin * f + cos * r) * walk + s.vx) * dt, world);
  moveZ(s, ((-cos * f - sin * r) * walk + s.vz) * dt, world);
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
  const standing = { ...s, crouching: false };
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
  s.x += dx;
  for (const b of nearby(s, world)) {
    if (!overlaps(s, b)) continue;
    s.x = dx > 0 ? b.minX - R : b.maxX + R;
    s.vx = 0;
    // Running into a wall kills your bunny-hop momentum.
    s.hop = 0;
  }
  const limit = world.halfSize - R;
  // The fence stops you like a wall.
  if (Math.abs(s.x) > limit) s.hop = 0;
  s.x = clamp(s.x, -limit, limit);
}

function moveZ(s: MoveState, dz: number, world: CollisionWorld): void {
  if (dz === 0) return;
  s.z += dz;
  for (const b of nearby(s, world)) {
    if (!overlaps(s, b)) continue;
    s.z = dz > 0 ? b.minZ - R : b.maxZ + R;
    s.vz = 0;
    s.hop = 0;
  }
  const limit = world.halfSize - R;
  if (Math.abs(s.z) > limit) s.hop = 0;
  s.z = clamp(s.z, -limit, limit);
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
