import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CollisionWorld, makeRay, traceHitscan, type HvhMatrix } from '../src';

const ray = makeRay({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
const target = (key: number, z: number) => ({ key, matrix: { origin: { x: 0, y: 0, z }, yaw: 0, scale: 1,
  boxes: [{ group: 'head', center: { x: 0, y: 1, z }, radius: 0.5, yaw: 0 }] } as HvhMatrix });

it('hits only the nearest contact regardless of actor order, with walls and props stopping the ray', () => {
  const world = new CollisionWorld(50), targets = [target(2, -20), target(1, -10)];
  const first = traceHitscan(ray, world, 40, targets);
  assert.equal(first.target, 1); assert.equal(first.hit?.group, 'head');
  assert.equal(first.t, 9.5); assert.deepEqual(first.point, { x: 0, y: 1, z: -9.5 });
  assert.equal(traceHitscan(ray, world, 40, [...targets].reverse()).target, 1);
  const prop = traceHitscan(ray, world, 40, targets, { blockers: [{ t: 3, id: 8, kind: 'loot' }] });
  assert.equal(prop.surface, 'loot'); assert.equal(prop.target, undefined); assert.equal(prop.blocker, 8);
  world.add(5, { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -8, maxZ: -7 });
  const blocked = traceHitscan(ray, world, 40, targets);
  assert.equal(blocked.surface, 'world'); assert.equal(blocked.t, 7); assert.equal(blocked.target, undefined);
  assert.deepEqual(blocked.normal, { x: 0, y: 0, z: 1 });
});

it('uses the same bounded penetration policy for shot prediction and execution', () => {
  const world = new CollisionWorld(50);
  world.add(5, { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -6, maxZ: -5 });
  const targets = [target(1, -10)], isSoft = (id: number) => id === 5;
  assert.equal(traceHitscan(ray, world, 40, targets, { isSoft }).surface, 'world');
  const simple = traceHitscan(ray, world, 40, targets, { penetration: 'simple', isSoft });
  const thickness = traceHitscan(ray, world, 40, targets, { penetration: 'thickness', isSoft });
  for (const hit of [simple, thickness]) { assert.equal(hit.target, 1); assert.equal(hit.t, 9.5); assert.equal(hit.soft.length, 1); }
  assert.equal(simple.damageScale, 0.65);
  assert.ok(thickness.damageScale > 0.65 && thickness.damageScale < 0.66);
  const hard = traceHitscan(ray, world, 40, targets, { penetration: 'thickness', isSoft: () => false });
  assert.equal(hard.surface, 'world'); assert.equal(hard.t, 5);
});

it('returns a range endpoint for empty space and a real normal for ground contact', () => {
  const world = new CollisionWorld(50);
  const missed = traceHitscan(ray, world, 8, [target(1, -10)]);
  assert.equal(missed.surface, 'none'); assert.equal(missed.hit, undefined);
  assert.deepEqual(missed.point, { x: 0, y: 1, z: -8 });
  const ground = traceHitscan(makeRay({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }), world, 8, []);
  assert.equal(ground.t, 2); assert.equal(ground.surface, 'world');
  assert.deepEqual(ground.normal, { x: 0, y: 1, z: 0 });
});
