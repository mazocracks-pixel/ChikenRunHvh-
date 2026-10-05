import { makeRay, rayAabb, raySphere, type Ray } from '../raycast';
import { normalize, type Vec3 } from '../math';
export type HvhHitgroup = 'head' | 'chest' | 'stomach' | 'pelvis' | 'arm' | 'leg';
export interface HvhHitbox { group: HvhHitgroup; center: Vec3; radius: number; half?: Vec3; yaw: number }
export interface HvhMatrix { origin: Vec3; yaw: number; scale: number; boxes: HvhHitbox[] }
export interface HvhHit { t: number; headshot: boolean; group: HvhHitgroup }
export const HVH_HEAD = { forward: 0.34, height: 1.27, radius: 0.20 } as const;
/** Every hypothesis rebuilds the whole skeleton, including oriented torso and limb volumes. */
export function buildHvhMatrix(origin: Vec3, yaw: number, scale = 1): HvhMatrix {
  const local = (x: number, y: number, z: number): Vec3 => ({ x: origin.x + (x * Math.cos(yaw) + z * Math.sin(yaw)) * scale,
    y: origin.y + y * scale, z: origin.z + (-x * Math.sin(yaw) + z * Math.cos(yaw)) * scale });
  const sphere = (group: HvhHitgroup, x: number, y: number, z: number, radius: number): HvhHitbox => ({ group, center: local(x, y, z), radius: radius * scale, yaw });
  const box = (group: HvhHitgroup, y: number, x: number, h: number, z: number): HvhHitbox => ({ group, center: local(0, y, 0), radius: 0,
    half: { x: x * scale, y: h * scale, z: z * scale }, yaw });
  return { origin: { ...origin }, yaw, scale, boxes: [sphere('head', 0, HVH_HEAD.height, -HVH_HEAD.forward, HVH_HEAD.radius),
    box('chest', 0.91, 0.34, 0.20, 0.27), box('stomach', 0.61, 0.35, 0.14, 0.28), box('pelvis', 0.36, 0.31, 0.13, 0.25),
    sphere('arm', -0.38, 0.78, 0, 0.13), sphere('arm', 0.38, 0.78, 0, 0.13), sphere('leg', -0.16, 0.16, 0, 0.13), sphere('leg', 0.16, 0.16, 0, 0.13)] };
}
export function rayHvhMatrix(ray: Ray, matrix: HvhMatrix, range: number, groups?: readonly HvhHitgroup[]): HvhHit | null {
  let hit: HvhHit | null = null;
  for (const box of matrix.boxes) {
    if (groups && !groups.includes(box.group)) continue;
    let t: number;
    if (box.half) {
      const c = Math.cos(box.yaw), s = Math.sin(box.yaw), x = ray.ox - box.center.x, z = ray.oz - box.center.z;
      const local: Ray = { ox: c * x - s * z, oy: ray.oy - box.center.y, oz: s * x + c * z,
        dx: c * ray.dx - s * ray.dz, dy: ray.dy, dz: s * ray.dx + c * ray.dz };
      t = rayAabb(local, { minX: -box.half.x, maxX: box.half.x, minY: -box.half.y, maxY: box.half.y,
        minZ: -box.half.z, maxZ: box.half.z }, hit?.t ?? range);
    } else t = raySphere(ray, box.center.x, box.center.y, box.center.z, box.radius, hit?.t ?? range);
    if (t >= 0 && (!hit || t < hit.t)) hit = { t, group: box.group, headshot: box.group === 'head' };
  }
  return hit;
}
export function rayHvhChicken(ray: Ray, x: number, y: number, z: number, yaw: number, range: number, scale = 1): HvhHit | null {
  return rayHvhMatrix(ray, buildHvhMatrix({ x, y, z }, yaw, scale), range);
}
export function pointSafety(eye: Vec3, point: Vec3, matrices: readonly HvhMatrix[], groups?: readonly HvhHitgroup[]): number {
  if (!matrices.length) return 0;
  const ray = makeRay(eye, normalize({ x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z }));
  return matrices.filter(m => rayHvhMatrix(ray, m, 1000, groups)).length / matrices.length;
}
export function matrixPoints(matrix: HvhMatrix, groups: readonly HvhHitgroup[], scale = 0.65): { point: Vec3; group: HvhHitgroup }[] {
  const points: { point: Vec3; group: HvhHitgroup }[] = [];
  for (const b of matrix.boxes) {
    if (!groups.includes(b.group)) continue;
    const radius = (b.half?.x ?? b.radius) * scale;
    for (const offset of scale <= 0 ? [[0, 0]] : [[0, 0], [-radius, 0], [radius, 0], [0, radius * 0.55]])
      points.push({ point: { x: b.center.x + offset[0]! * Math.cos(b.yaw), y: b.center.y + offset[1]!, z: b.center.z - offset[0]! * Math.sin(b.yaw) }, group: b.group });
  }
  return points;
}
