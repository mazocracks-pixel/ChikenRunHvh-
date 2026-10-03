import type { Aabb, CollisionWorld } from './collision';
import type { Vec3 } from './math';

export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  /** Must be normalized. */
  dx: number;
  dy: number;
  dz: number;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  /** Collision id of the box that was hit, or -1 for the ground. */
  id?: number;
}

export function makeRay(origin: Vec3, dir: Vec3): Ray {
  return { ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z };
}

export function pointOnRay(ray: Ray, t: number): Vec3 {
  return { x: ray.ox + ray.dx * t, y: ray.oy + ray.dy * t, z: ray.oz + ray.dz * t };
}

/** Slab test. Returns the entry distance (0 if the origin is inside) or -1, and the hit normal in `out`. */
export function rayAabb(ray: Ray, b: Aabb, maxT: number, out?: RayHit): number {
  let tMin = 0;
  let tMax = maxT;
  let axis = -1;
  let sign = 0;
  const o = [ray.ox, ray.oy, ray.oz];
  const d = [ray.dx, ray.dy, ray.dz];
  const lo = [b.minX, b.minY, b.minZ];
  const hi = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    const oi = o[i]!;
    const di = d[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < lo[i]! || oi > hi[i]!) return -1;
      continue;
    }
    let t1 = (lo[i]! - oi) / di;
    let t2 = (hi[i]! - oi) / di;
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  if (out) {
    out.t = tMin;
    out.nx = axis === 0 ? sign : 0;
    out.ny = axis === 1 ? sign : 0;
    out.nz = axis === 2 ? sign : 0;
  }
  return tMin;
}

/** Returns the entry distance or -1. */
export function raySphere(ray: Ray, cx: number, cy: number, cz: number, radius: number, maxT: number): number {
  const lx = ray.ox - cx;
  const ly = ray.oy - cy;
  const lz = ray.oz - cz;
  const b = lx * ray.dx + ly * ray.dy + lz * ray.dz;
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = Math.max(0, -b - Math.sqrt(disc));
  return t <= maxT ? t : -1;
}

/** Nearest hit against the ground plane (y = 0) and every solid box (except `skip`), within `maxT`. */
export function raycastWorld(ray: Ray, world: CollisionWorld, maxT: number, skip?: ReadonlySet<number>): RayHit | null {
  let best: RayHit | null = null;
  if (ray.dy < 0 && ray.oy >= 0) {
    const t = -ray.oy / ray.dy;
    if (t <= maxT) best = { t, nx: 0, ny: 1, nz: 0, id: -1 };
  }
  const hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };
  for (const [id, box] of world.entries()) {
    if (skip?.has(id)) continue;
    const t = rayAabb(ray, box, best ? best.t : maxT, hit);
    if (t >= 0 && (!best || t < best.t)) best = { ...hit, id };
  }
  return best;
}

/** Hit volumes of a chicken, relative to its feet. */
export const HITBOX = {
  bodyRadius: 0.42,
  bodyHeight: 1.12,
  headRadius: 0.27,
  headHeight: 1.27,
  /** The head sits forward of the body centre, in the facing direction. */
  headForward: 0.3,
} as const;

export interface ChickenHit {
  t: number;
  headshot: boolean;
}

/** Ray against one chicken standing at (x, y, z) facing `yaw`; `scale` < 1 while crouched. */
export function rayChicken(ray: Ray, x: number, y: number, z: number, yaw: number, maxT: number, scale = 1): ChickenHit | null {
  const hx = x - Math.sin(yaw) * HITBOX.headForward * scale;
  const hz = z - Math.cos(yaw) * HITBOX.headForward * scale;
  const head = raySphere(ray, hx, y + HITBOX.headHeight * scale, hz, HITBOX.headRadius * scale, maxT);
  const body = rayAabb(
    ray,
    {
      minX: x - HITBOX.bodyRadius * scale,
      maxX: x + HITBOX.bodyRadius * scale,
      minY: y,
      maxY: y + HITBOX.bodyHeight * scale,
      minZ: z - HITBOX.bodyRadius * scale,
      maxZ: z + HITBOX.bodyRadius * scale,
    },
    maxT,
  );
  if (head < 0 && body < 0) return null;
  if (head >= 0 && (body < 0 || head <= body)) return { t: head, headshot: true };
  return { t: body, headshot: false };
}

/** Distance from a point to a chicken's chest (for splash damage). */
export function chestPoint(x: number, y: number, z: number): Vec3 {
  return { x, y: y + 0.7, z };
}
