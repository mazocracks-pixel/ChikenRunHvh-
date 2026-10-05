import { clamp, type Vec3 } from './math';

/** Shared by rendered bones, targeting and authoritative hit detection in every mode. */
export const CHICKEN_POSE = {
  headHeight: 1.25, headForward: 0.32, headRadius: 0.25,
  neckHeight: 1.05, neckForward: 0.25, pitchLimit: 1.2,
} as const;
export function chickenHeadPose(pitch = 0): { tilt: number; tuck: number } {
  const p = clamp(Number.isFinite(pitch) ? pitch : 0, -CHICKEN_POSE.pitchLimit, CHICKEN_POSE.pitchLimit);
  return { tilt: p * 0.85, tuck: Math.max(0, -p) / CHICKEN_POSE.pitchLimit * 0.1 };
}
export function chickenHeadCenter(origin: Vec3, yaw: number, scale = 1, pitch = 0): Vec3 {
  const { tilt, tuck } = chickenHeadPose(pitch);
  const y = CHICKEN_POSE.headHeight - CHICKEN_POSE.neckHeight;
  const z = CHICKEN_POSE.neckForward - CHICKEN_POSE.headForward;
  const forward = -CHICKEN_POSE.neckForward + y * Math.sin(tilt) + z * Math.cos(tilt);
  return { x: origin.x + forward * Math.sin(yaw) * scale,
    y: origin.y + (CHICKEN_POSE.neckHeight - tuck + y * Math.cos(tilt) - z * Math.sin(tilt)) * scale,
    z: origin.z + forward * Math.cos(yaw) * scale };
}
