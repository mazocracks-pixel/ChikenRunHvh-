import { clamp, wrapAngle } from '../../math';
import type { EraTable } from './era';

/*
 * Conventions (from legacy shared/src/hvh.ts):
 * - Yaw is in radians, wrapped to [-PI, PI) with math.wrapAngle. Positive yaw turns left:
 *   base offsets are backward = +PI, left = +PI/2, right = -PI/2 (hvh.ts:147).
 * - Config angles (jitterDeg, desyncDeg) are degrees. Jitter clamps to 0..HVH.maxJitter (45) (hvh.ts:86,111).
 * - Desync side is +1 normally and -1 when inverted; body = eye + desync * side (hvh.ts:146,150).
 *   A positive body offset is 'left', negative is 'right', zero is 'center'.
 * - Jitter: phase 1 adds +jitter, phase 0 adds -jitter (hvh.ts:148). The phase flips once per
 *   stepPose call, i.e. once per executed command.
 * - Spin rotates at the legacy default spinSpeed of 180 deg/s (hvh.ts:88), computed from the tick
 *   at 64 Hz so it stays deterministic.
 * - pitch is carried over from prev; AntiAimConfig has no pitch mode.
 */

export type Side = 'left' | 'right' | 'center';

export interface AntiAimConfig {
  base: 'backward' | 'left' | 'right' | 'spin';
  jitterDeg: number;
  desyncDeg: number;
  inverted: boolean;
}

export interface Motion {
  speedFraction: number;
  duck: number;
  onGround: boolean;
}

export interface PoseState {
  eyeYaw: number;
  bodyYaw: number;
  pitch: number;
  jitterPhase: 0 | 1;
  realSide: Side;
  /** Signed jitter offset of the eyes from the base yaw, degrees. Visible to opponents. */
  eyeOffsetDeg: number;
}

/** What an opponent can see of a pose. Never contains bodyYaw or realSide. */
export interface Observation {
  tick: number;
  eyeYaw: number;
  eyeOffsetDeg: number;
  speedFraction: number;
  duck: number;
}

export const MAX_JITTER_DEG = 45;
export const SPIN_DEG_PER_SEC = 180;

export const INITIAL_POSE: PoseState = Object.freeze({
  eyeYaw: 0,
  bodyYaw: 0,
  pitch: 0,
  jitterPhase: 0,
  realSide: 'center',
  eyeOffsetDeg: 0,
});

const DEG = Math.PI / 180;
const BASE_OFFSET = { backward: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 } as const;

export function maxDesync(speedFraction: number, era: EraTable): number {
  return era.maxDesyncDeg * (1 - era.desyncRunFalloff * clamp(speedFraction, 0, 1));
}

export function stepPose(
  prev: PoseState,
  aimYaw: number,
  aa: AntiAimConfig,
  motion: Motion,
  tick: number,
  era: EraTable,
): PoseState {
  const base =
    aa.base === 'spin'
      ? aimYaw + ((tick * SPIN_DEG_PER_SEC) / era.tickRate) * DEG
      : aimYaw + BASE_OFFSET[aa.base];
  const jitterPhase: 0 | 1 = prev.jitterPhase === 1 ? 0 : 1;
  const jitter = clamp(aa.jitterDeg, 0, MAX_JITTER_DEG);
  const eyeOffsetDeg = jitterPhase === 1 ? jitter : -jitter;
  const eyeYaw = wrapAngle(base + eyeOffsetDeg * DEG);

  const desync = Math.min(Math.max(aa.desyncDeg, 0), maxDesync(motion.speedFraction, era));
  const side = aa.inverted ? -1 : 1;
  const bodyYaw = wrapAngle(eyeYaw + desync * side * DEG);
  const realSide: Side = desync === 0 ? 'center' : side > 0 ? 'left' : 'right';

  return { eyeYaw, bodyYaw, pitch: prev.pitch, jitterPhase, realSide, eyeOffsetDeg };
}

export function publicObservation(p: PoseState, motion: Motion, tick: number): Observation {
  return {
    tick,
    eyeYaw: p.eyeYaw,
    eyeOffsetDeg: p.eyeOffsetDeg,
    speedFraction: motion.speedFraction,
    duck: motion.duck,
  };
}
