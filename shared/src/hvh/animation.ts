import { clamp, wrapAngle, type Vec3 } from '../math';
import { SIM_DT } from '../constants';

export interface AnimationInput { eyeYaw: number; desiredDelta: number; speed: number; crouch: number; grounded: boolean; velocity?: Vec3; weaponSpeed?: number; active: boolean; concealed?: boolean }
export interface AuthoritativeAnimation {
  eyeYaw: number; bodyYaw: number; lowerBodyYaw: number; maxDelta: number; stoppedTicks: number;
  crouch: number; speed: number; grounded: boolean; turnWeight: number; nextBodyUpdate: number;
  runFraction: number; movementWeight: number;
}
export function createAnimation(yaw = 0): AuthoritativeAnimation {
  return { eyeYaw: yaw, bodyYaw: yaw, lowerBodyYaw: yaw, maxDelta: 0, stoppedTicks: 0,
    crouch: 0, speed: 0, grounded: true, turnWeight: 0, nextBodyUpdate: 0, runFraction: 0, movementWeight: 0 };
}
/** Rules of this game's animation, not offsets from a foreign engine. */
export function maximumBodyDelta(speed: number, crouch: number, _grounded: boolean, weaponSpeed = 1, runFraction = clamp(speed / (6 * weaponSpeed), 0, 1)): number {
  const top = Math.max(0.001, 6 * weaponSpeed), walk = clamp(speed / (top * 0.52), 0, 1), duck = clamp(speed / (top * 0.34), 0, 1);
  let width = 1 - (0.2 + 0.3 * clamp(runFraction, 0, 1)) * walk;
  width += clamp(crouch, 0, 1) * duck * (0.5 - width);
  return 58 * width * Math.PI / 180;
}
// shortcut: directional chicken layer; use sequence playback if the rig gains baked movement animations.
export function movementLayerWeight(yaw: number, velocity: Vec3, speed: number, crouch: number, grounded: boolean, weaponSpeed = 1): number {
  const length = Math.hypot(velocity.x, velocity.z); if (!grounded || length < 0.01) return 0;
  const top = Math.max(0.001, 6 * weaponSpeed), duck = clamp(crouch, 0, 1);
  const weight = (1 - duck) * clamp(speed / (top * 0.52), 0, 1) + duck * clamp(speed / (top * 0.34), 0, 1);
  const alignment = Math.abs((-Math.sin(yaw) * velocity.x - Math.cos(yaw) * velocity.z) / length);
  return weight * Math.pow(clamp(alignment, 0, 1), Math.log(0.2) / Math.log(0.5));
}
export function stepAnimation(s: AuthoritativeAnimation, input: AnimationInput, tick: number): void {
  const previous = s.bodyYaw;
  s.eyeYaw = wrapAngle(input.eyeYaw); s.speed = input.speed; s.grounded = input.grounded;
  s.crouch += clamp(input.crouch - s.crouch, -SIM_DT * 6, SIM_DT * 6);
  const running = input.speed > 6 * (input.weaponSpeed ?? 1) * 0.52 ? 1 : 0;
  s.runFraction += clamp(running - s.runFraction, -SIM_DT * 2, SIM_DT * 2);
  s.maxDelta = input.active ? maximumBodyDelta(input.speed, s.crouch, input.grounded, input.weaponSpeed, s.runFraction) : 0;
  const delta = clamp(input.desiredDelta, -s.maxDelta, s.maxDelta);
  const goal = wrapAngle(s.eyeYaw + delta);
  const rate = input.speed > 0.1 ? 30 + 20 * s.runFraction : 100;
  s.bodyYaw = wrapAngle(previous + clamp(wrapAngle(goal - previous), -rate * Math.PI / 180 * SIM_DT, rate * Math.PI / 180 * SIM_DT));
  // A large eye turn can move the body immediately to the legal boundary, never outside it.
  s.bodyYaw = wrapAngle(s.eyeYaw + clamp(wrapAngle(s.bodyYaw - s.eyeYaw), -s.maxDelta, s.maxDelta));
  s.turnWeight = clamp(Math.abs(wrapAngle(s.bodyYaw - previous)) / (Math.PI / 8), 0, 1);
  if (input.speed > 0.1 && input.grounded) {
    s.stoppedTicks = 0; s.nextBodyUpdate = tick + Math.ceil(0.22 / SIM_DT);
    if (!input.concealed) s.lowerBodyYaw = s.eyeYaw;
  } else {
    s.stoppedTicks++;
    if (!input.concealed && input.grounded && tick >= s.nextBodyUpdate && Math.abs(wrapAngle(s.bodyYaw - s.eyeYaw)) > 35 * Math.PI / 180) {
      s.lowerBodyYaw = s.eyeYaw; s.nextBodyUpdate = tick + Math.ceil(1.1 / SIM_DT);
    }
  }
  if (!input.active) s.lowerBodyYaw = s.bodyYaw;
  s.movementWeight = movementLayerWeight(s.bodyYaw, input.velocity ?? { x: 0, y: 0, z: 0 }, s.speed, s.crouch, s.grounded, input.weaponSpeed);
}

/** Explicit allow-list: no bodyYaw, inverter, enemy config, or authoritative bones. */
export interface ObservableRecord {
  pid: number; tick: number; t: number; origin: Vec3; velocity: Vec3; eyeYaw: number; lowerBodyYaw: number;
  speed: number; crouch: number; grounded: boolean; turnWeight: number; alive: boolean; hp: number; armor: number;
  fired: boolean; concealed: boolean; defensive: boolean;
  /** Observable physical head pitch; never a hidden-body orientation. */
  pitch?: number;
  movementWeight?: number;
  runFraction?: number;
  weaponSpeed?: number;
}
export function copyObservableRecord(r: ObservableRecord): ObservableRecord {
  return { pid: r.pid, tick: r.tick, t: r.t, origin: { x: r.origin.x, y: r.origin.y, z: r.origin.z },
    velocity: { x: r.velocity.x, y: r.velocity.y, z: r.velocity.z }, eyeYaw: r.eyeYaw, lowerBodyYaw: r.lowerBodyYaw,
    speed: r.speed, crouch: r.crouch, grounded: r.grounded, turnWeight: r.turnWeight, alive: r.alive,
    hp: r.hp, armor: r.armor, fired: r.fired, concealed: r.concealed, defensive: r.defensive, pitch: r.pitch ?? 0,
    movementWeight: r.movementWeight, runFraction: r.runFraction, weaponSpeed: r.weaponSpeed };
}
export function observableRecord(pid: number, tick: number, t: number, origin: Vec3, velocity: Vec3,
  a: AuthoritativeAnimation, hp: number, armor: number, alive: boolean, fired = false, concealed = false, defensive = false): ObservableRecord {
  return { pid, tick, t, origin: { ...origin }, velocity: { ...velocity }, eyeYaw: a.eyeYaw,
    lowerBodyYaw: a.lowerBodyYaw, speed: a.speed, crouch: a.crouch, grounded: a.grounded,
    turnWeight: Math.round(a.turnWeight * 4) / 4, movementWeight: Math.round(a.movementWeight * 1000) / 1000,
    runFraction: a.runFraction, hp, armor, alive, fired: fired && !concealed, concealed, defensive };
}
