import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CollisionWorld, MAPS, SIM_DT, createCollisionWorld, createMoveState, stepPlayer, type InputFrame } from '../src/index';

// A 3 m wall (its far side is a ledge to climb onto) with a ladder against its near face.
function wallWithLadder() {
  const world = new CollisionWorld(20, [{ minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: -4, maxZ: -1 }]);
  world.ladders = [{ minX: -0.3, maxX: 0.3, minY: 0, maxY: 3.1, minZ: -1.05, maxZ: -0.95 }];
  return world;
}
const input = (seq: number, forward: number, pitch = 0, extra: Partial<InputFrame> = {}): InputFrame => ({ seq, forward, right: 0, jump: false, yaw: 0, pitch, ...extra });
const run = (s: ReturnType<typeof createMoveState>, world: CollisionWorld, ticks: number, make: (i: number) => InputFrame) => { for (let i = 0; i < ticks; i++) stepPlayer(s, make(i), SIM_DT, world); };

it('walking into a ladder climbs it, and you step off onto the ledge at the top', () => {
  const world = wallWithLadder();
  const s = createMoveState(0, 0, 0);
  run(s, world, 120, (i) => input(i, 1, 0.2));
  assert.ok(s.y >= 3 - 1e-6 && s.z < -1, `on the ledge (${s.y.toFixed(2)}, z ${s.z.toFixed(2)})`);
});

it('looking down and walking climbs down; jumping lets go; walking past does not grab', () => {
  const world = wallWithLadder();
  const s = createMoveState(0, 0, -0.5);
  run(s, world, 30, (i) => input(i, 1, 0.2));
  const high = s.y;
  assert.ok(high > 1, `climbed (${high.toFixed(2)})`);
  run(s, world, 10, (i) => input(100 + i, 1, -1));
  assert.ok(s.y < high - 0.3, 'went down');
  run(s, world, 5, (i) => input(200 + i, 0, 0, { jump: true }));
  run(s, world, 60, (i) => input(300 + i, 0));
  assert.equal(s.y, 0, 'let go and fell');
  // Strafing along the wall past the ladder: no climbing.
  const past = createMoveState(-2, 0, -0.5);
  run(past, world, 60, (i) => ({ ...input(400 + i, 0), right: 1 }));
  assert.equal(past.y, 0);
});

it('Mirage has ladders, and its street ladders stand on the floor', () => {
  const world = createCollisionWorld(MAPS.mirage);
  assert.ok(world.ladders.length >= 2);
  assert.ok(world.ladders.filter((l) => l.minY < 6.5).length >= 2, 'at least two reachable from the street');
});
