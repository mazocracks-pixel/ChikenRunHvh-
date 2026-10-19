import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollisionWorld, type Aabb } from '../../src/collision';
import { buildHvhMatrix } from '../../src/hvh/geometry';
import { enemyVisible, snapshotSightTargets } from '../../src/hvh/v2/visibility';
import { packPlayer, unpackPlayer } from '../../src/protocol';

const EYE = { x: 0, y: 1, z: 0 };
const ENEMY = { x: 20, y: 0, z: 0, crouch: 0 };
const WALL: Aabb = { minX: 10, maxX: 11, minY: 0, maxY: 12, minZ: -5, maxZ: 5 };
const centre = (group: 'head' | 'chest', crouch = 0, yaw = 0) =>
  buildHvhMatrix(ENEMY, yaw, 1 - crouch * 0.3).boxes.find(b => b.group === group)!.center;
/** A thin slab just in front of the enemy, covering only `point` (±0.12 m). */
const cover = (point: { y: number; z: number }): Aabb =>
  ({ minX: 19, maxX: 19.2, minY: point.y - 0.12, maxY: point.y + 0.12, minZ: point.z - 0.12, maxZ: point.z + 0.12 });

describe('enemyVisible', () => {
  it('an open field gives true', () => {
    assert.equal(enemyVisible(EYE, [ENEMY], new CollisionWorld(200)), true);
  });
  it('a box fully between eye and enemy gives false', () => {
    assert.equal(enemyVisible(EYE, [ENEMY], new CollisionWorld(200, [WALL])), false);
  });
  it('a box covering only the head point leaves the chest visible', () => {
    const head = centre('head');
    const world = new CollisionWorld(200, [cover(head)]);
    assert.equal(enemyVisible(EYE, [ENEMY], world), true);
    // Covering the chest point too hides the enemy, so the head box really does sit on the head point.
    assert.equal(enemyVisible(EYE, [ENEMY], new CollisionWorld(200, [cover(head), cover(centre('chest'))])), false);
  });
  it('uses the crouched (scaled) points for a crouching enemy', () => {
    const crouched = { ...ENEMY, crouch: 1 };
    const standing = new CollisionWorld(200, [cover(centre('head')), cover(centre('chest'))]);
    assert.equal(enemyVisible(EYE, [crouched], standing), true);
    const low = new CollisionWorld(200, [cover(centre('head', 1)), cover(centre('chest', 1))]);
    assert.equal(enemyVisible(EYE, [crouched], low), false);
  });
  it('the head point follows the enemy yaw (R53)', () => {
    const turned = { ...ENEMY, yaw: Math.PI };
    assert.ok(Math.abs(centre('head', 0, Math.PI).z - centre('head').z) > 0.24, 'precondition: turning moves the head out of a 0.24 m slab');
    // Covering the yaw-0 head and the chest hides a yaw-0 enemy, but not one facing the other way.
    const yaw0 = new CollisionWorld(200, [cover(centre('head')), cover(centre('chest'))]);
    assert.equal(enemyVisible(EYE, [ENEMY], yaw0), false);
    assert.equal(enemyVisible(EYE, [turned], yaw0), true);
    const yawPi = new CollisionWorld(200, [cover(centre('head', 0, Math.PI)), cover(centre('chest', 0, Math.PI))]);
    assert.equal(enemyVisible(EYE, [turned], yawPi), false);
  });
  it('a see-through box does not block', () => {
    const world = new CollisionWorld(200, [WALL]);
    world.seeThrough.add(0);
    assert.equal(enemyVisible(EYE, [ENEMY], world), true);
  });
  it('one visible enemy among hidden ones gives true', () => {
    const world = new CollisionWorld(200, [WALL]);
    assert.equal(enemyVisible(EYE, [ENEMY, { x: -20, y: 0, z: 0, crouch: 0 }], world), true);
  });
  it('no enemies gives false', () => {
    assert.equal(enemyVisible(EYE, [], new CollisionWorld(200)), false);
  });
});

describe('snapshotSightTargets (R56)', () => {
  it('lists the living enemies of a snapshot at their packed public position, crouch and yaw', () => {
    const base = unpackPlayer([]);
    const packed = [
      packPlayer({ ...base, pid: 1, alive: true, x: 1, y: 0, z: 2 }),
      packPlayer({ ...base, pid: 2, alive: true, x: 3.25, y: 0.5, z: -4, yaw: 1.5, crouching: true, crouchAmount: 0.5 }),
      packPlayer({ ...base, pid: 3, alive: false, x: 9, y: 0, z: 9 }),
      packPlayer({ ...base, pid: 4, alive: true, x: 7, y: 0, z: 7 }),
    ];
    const s2 = unpackPlayer(packed[1]!);
    const targets = snapshotSightTargets(packed, (pid) => pid !== 1 && pid !== 4);
    assert.deepEqual(targets, [{ x: s2.x, y: s2.y, z: s2.z, crouch: s2.crouchAmount, yaw: s2.yaw }]);
    assert.equal(targets[0]!.crouch, 0.5);
  });
});
