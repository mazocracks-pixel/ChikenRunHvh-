import type { CollisionWorld } from './collision';
import { makeRay, raycastWorld } from './raycast';

export interface NavPoint {
  x: number;
  z: number;
}

/** Waypoints, and which ones are linked (an index list per point). */
export interface NavGraph {
  points: readonly NavPoint[];
  links: readonly (readonly number[])[];
}

/** Two spots are linked when they're this close and nothing blocks a chicken walking between them. */
const MAX_LINK = 26;
/** Checked at knee and head height, and a body-width either side, so links never clip a corner. */
const HEIGHTS = [0.4, 1.3];
const SIDE = 0.45;

/** True if a chicken can walk in a straight line from `a` to `b`. */
export function walkable(a: NavPoint, b: NavPoint, world: CollisionWorld): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;
  const dir = { x: dx / dist, y: 0, z: dz / dist };
  const nx = -dir.z * SIDE;
  const nz = dir.x * SIDE;
  for (const y of HEIGHTS) {
    for (const side of [-1, 0, 1]) {
      const origin = { x: a.x + nx * side, y, z: a.z + nz * side };
      if (raycastWorld(makeRay(origin, dir), world, dist)) return false;
    }
  }
  return true;
}

export function buildNavGraph(points: readonly NavPoint[], world: CollisionWorld): NavGraph {
  const links: number[][] = points.map(() => []);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      if (Math.hypot(a.x - b.x, a.z - b.z) > MAX_LINK || !walkable(a, b, world)) continue;
      links[i]!.push(j);
      links[j]!.push(i);
    }
  }
  return { points, links };
}

/** The waypoint nearest to `p` that `p` can walk straight to (or just the nearest one). */
export function nearestNavPoint(graph: NavGraph, p: NavPoint, world: CollisionWorld): number {
  let best = -1;
  let bestDist = Infinity;
  let fallback = 0;
  let fallbackDist = Infinity;
  graph.points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < fallbackDist) {
      fallbackDist = d;
      fallback = i;
    }
    if (d < bestDist && walkable(p, q, world)) {
      bestDist = d;
      best = i;
    }
  });
  return best >= 0 ? best : fallback;
}

/**
 * Shortest route of waypoints from `from` to `to` (Dijkstra; the graphs are tiny). Ends at `to`
 * itself. Empty if there's no waypoint graph; a direct line if they can see each other.
 */
export function findPath(graph: NavGraph, from: NavPoint, to: NavPoint, world: CollisionWorld): NavPoint[] {
  if (graph.points.length === 0 || walkable(from, to, world)) return [to];
  const start = nearestNavPoint(graph, from, world);
  const goal = nearestNavPoint(graph, to, world);
  const dist = graph.points.map(() => Infinity);
  const prev = graph.points.map(() => -1);
  const done = graph.points.map(() => false);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === goal) break;
    done[u] = true;
    for (const v of graph.links[u]!) {
      const p = graph.points[u]!;
      const q = graph.points[v]!;
      const alt = dist[u]! + Math.hypot(p.x - q.x, p.z - q.z);
      if (alt < dist[v]!) {
        dist[v] = alt;
        prev[v] = u;
      }
    }
  }
  if (dist[goal] === Infinity) return [to];
  const route: NavPoint[] = [to];
  for (let i = goal; i >= 0; i = prev[i]!) route.unshift(graph.points[i]!);
  return route;
}

/** How many waypoints `start` can reach (for tests: every spot should reach every other). */
export function reachableCount(graph: NavGraph, start = 0): number {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of graph.links[u]!) {
      if (seen.has(v)) continue;
      seen.add(v);
      queue.push(v);
    }
  }
  return seen.size;
}
