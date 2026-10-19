import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollisionWorld, type Aabb } from '../../src/collision';
import { buildHvhMatrix } from '../../src/hvh/geometry';
import { enemyVisible } from '../../src/hvh/v2/visibility';

const EYE = { x: 0, y: 1, z: 0 };
const ENEMY = { x: 20, y: 0, z: 0, crouch: 0 };
const WALL: Aabb = { minX: 10, maxX: 11, minY: 0, maxY: 12, minZ: -5, maxZ: 5 };
const centre = (group: 'head' | 'chest', crouch = 0) =>
  buildHvhMatrix(ENEMY, 0, 1 - crouch * 0.3).boxes.find(b => b.group === group)!.center;
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
