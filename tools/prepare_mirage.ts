import { readFileSync, writeFileSync } from 'node:fs';
import { CollisionWorld } from '../shared/src/collision';
import { PLAYER, SIM_DT } from '../shared/src/constants';
import { SOURCE_MOVE } from '../shared/src/movement';
import { walkable } from '../shared/src/nav';
import { createMoveState, isSpaceFree, stepPlayer } from '../shared/src/physics';
import { boxToAabb, type MapBox } from '../shared/src/maps/types';

const path = new URL('../shared/src/maps/mirage-data.json', import.meta.url);
const data = JSON.parse(readFileSync(path, 'utf8')) as {
  boxes: MapBox[];
  spawns: { x: number; y: number; z: number; team: number }[];
  nav: { id: number; x: number; y: number; z: number; links: number[]; place: string; flags: number }[];
};
const world = new CollisionWorld(90, data.boxes.map(boxToAabb));
for (const spawn of data.spawns) {
  const state = createMoveState(spawn.x, spawn.y, spawn.z);
  for (let i = 0; i < 120; i++) stepPlayer(state, { seq: i, forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 }, SIM_DT, world);
  if (!state.onGround || !isSpaceFree(state.x, state.y, state.z, world)) throw new Error('Mirage spawn cannot settle on a clear floor.');
  spawn.y = state.y;
}
const nearby: ReturnType<typeof boxToAabb>[] = [];
const points = data.nav.filter((point) => {
  // A point hugging a wall moves up to 0.4 m clear (a chicken is wider than a Source player).
  for (const r of [0, 0.1, 0.2, 0.3, 0.4]) for (let k = 0; k < (r ? 8 : 1); k++) {
    const x = point.x + r * Math.cos(k * Math.PI / 4), z = point.z + r * Math.sin(k * Math.PI / 4);
    // Source navigation lies on slopes; the box approximation stands on the highest nearby step.
    let y = point.y;
    world.query(x - PLAYER.radius, z - PLAYER.radius, x + PLAYER.radius, z + PLAYER.radius, nearby);
    for (const b of nearby) {
      if (b.maxX <= x - PLAYER.radius || b.minX >= x + PLAYER.radius || b.maxZ <= z - PLAYER.radius || b.minZ >= z + PLAYER.radius) continue;
      if (b.maxY > y && b.maxY <= point.y + SOURCE_MOVE.stepHeight) y = b.maxY;
    }
    if (isSpaceFree(x, y, z, world)) {
      Object.assign(point, { x, y, z });
      return true;
    }
  }
  return false;
});
const links: number[][] = points.map(() => []);
for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
  const a = points[i]!, b = points[j]!;
  if (!a.links.includes(b.id) && !b.links.includes(a.id) && Math.hypot(a.x - b.x, a.z - b.z) > 4) continue;
  if (!walkable(a, b, world) || !walkable(b, a, world)) continue;
  links[i]!.push(j); links[j]!.push(i);
}
const graph = { links };
let largest = new Set<number>();
const seen = new Set<number>();
for (let i = 0; i < points.length; i++) {
  if (seen.has(i)) continue;
  const component = new Set([i]);
  const queue = [i];
  seen.add(i);
  for (const index of queue) for (const other of graph.links[index]!) {
    if (seen.has(other)) continue;
    seen.add(other); component.add(other); queue.push(other);
  }
  if (component.size > largest.size) largest = component;
}
data.nav = points.filter((p, i) => {
  p.links = graph.links[i]!.filter((j) => largest.has(j)).map((j) => points[j]!.id);
  return largest.has(i);
});
if (data.nav.length < 400 || !data.nav.some((p) => p.place === 'BombsiteA') || !data.nav.some((p) => p.place === 'BombsiteB')) throw new Error(`Mirage navigation lost a main route: ${data.nav.length} points, ${[...new Set(data.nav.map((p) => p.place))].join(', ')}.`);
writeFileSync(path, JSON.stringify(data));
const reportPath = new URL('./mirage-import-report.json', import.meta.url);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
report.connectedNavAreas = data.nav.length;
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Mirage navigation: ${data.nav.length} connected, standing-clear points.`);
