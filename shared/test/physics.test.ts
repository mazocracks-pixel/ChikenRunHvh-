import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CROUCH,
  CollisionWorld,
  HOP,
  JETPACK,
  MAPS,
  PLAYER,
  SIM_DT,
  createCollisionWorld,
  createMoveState,
  heightOf,
  stepPlayer,
  type Aabb,
  type InputFrame,
  type MoveMods,
} from '../src/index';

const farm = createCollisionWorld(MAPS.farm);
const frame = (seq: number, extra: Partial<InputFrame> = {}): InputFrame => ({
  seq,
  forward: 0,
  right: 0,
  jump: false,
  yaw: 0,
  pitch: 0,
  ...extra,
});

describe('stepPlayer', () => {
  it('jumps to about v²/2g and lands', () => {
    const s = createMoveState(0, 0, 20);
    stepPlayer(s, frame(1, { jump: true }), SIM_DT, farm);
    let peak = s.y;
    for (let i = 2; i < 200; i++) {
      stepPlayer(s, frame(i), SIM_DT, farm);
      peak = Math.max(peak, s.y);
    }
    assert.ok(Math.abs(peak - PLAYER.jumpVelocity ** 2 / (2 * PLAYER.gravity)) < 0.15, `peak ${peak}`);
    assert.equal(s.y, 0);
    assert.ok(s.onGround);
  });

  it('stops flush against a wall', () => {
    // East cover wall spans x = 11.5..12.5.
    const s = createMoveState(9, 0, 0);
    for (let i = 0; i < 120; i++) stepPlayer(s, frame(i, { right: 1 }), SIM_DT, farm);
    assert.ok(Math.abs(s.x - (11.5 - PLAYER.radius)) < 1e-9, `x=${s.x}`);
  });

  it('can hop up crate → tower', () => {
    const s = createMoveState(6, 0, 0);
    for (let i = 0; i < 90; i++) stepPlayer(s, frame(i, { right: -1, jump: i < 30 }), SIM_DT, farm);
    assert.ok(s.onGround && s.y > 2, `y=${s.y}`);
  });

  it('normalizes diagonal movement', () => {
    const s = createMoveState(20, 0, -5);
    stepPlayer(s, frame(1, { forward: 1, right: 1 }), SIM_DT, farm);
    assert.ok(Math.abs(Math.hypot(s.x - 20, s.z + 5) - PLAYER.speed * SIM_DT) < 1e-9);
  });

  it('glides after a fresh jump press in the air', () => {
    const s = createMoveState(20, 10, 20);
    s.onGround = false;
    for (let i = 0; i < 60; i++) stepPlayer(s, frame(i, { jump: true }), SIM_DT, farm);
    assert.ok(s.gliding);
    assert.equal(s.vy, -PLAYER.glideFallSpeed);
    const t = createMoveState(20, 10, 20);
    t.onGround = false;
    for (let i = 0; i < 30; i++) stepPlayer(t, frame(i), SIM_DT, farm);
    assert.ok(t.vy < -PLAYER.glideFallSpeed * 2);
  });

  it('auto bunny hops while jump is held, building speed up to the cap', () => {
    const s = createMoveState(-20, 0, 25);
    let jumps = 0;
    let lastHop = 0;
    let wasGround = true;
    // Hold forward + jump, running along the clear north lane (-X direction is yaw π/2).
    for (let i = 0; i < 60 * 5; i++) {
      stepPlayer(s, frame(i, { forward: 1, jump: true, yaw: -Math.PI / 2 }), SIM_DT, farm);
      if (wasGround && !s.onGround) {
        jumps++;
        assert.ok(s.hop >= lastHop, 'speed bonus never drops while chaining');
        lastHop = s.hop;
      }
      wasGround = s.onGround;
      if (s.x > 20) break;
    }
    assert.ok(jumps >= 4, `jumped ${jumps} times`);
    assert.ok(s.hop > HOP.gain * 2, `hop bonus ${s.hop}`);
    assert.ok(s.hop <= HOP.max);
    assert.equal(s.gliding, false, 'holding jump hops instead of gliding');
  });

  it('loses the bunny-hop bonus when you stop hopping or hit a wall', () => {
    const s = createMoveState(-20, 0, 25);
    s.hop = HOP.max;
    for (let i = 0; i < 30; i++) stepPlayer(s, frame(i, { forward: 1, yaw: -Math.PI / 2 }), SIM_DT, farm);
    assert.equal(s.hop, 0, 'walking without jumping fades it');

    // Mid-air (where the bonus doesn't fade), flying into the east cover wall (x = 11.5).
    const w = createMoveState(10.5, 1, 0);
    w.onGround = false;
    w.hop = 0.4;
    for (let i = 0; i < 12; i++) stepPlayer(w, frame(i, { right: 1 }), SIM_DT, farm);
    assert.equal(w.hop, 0, 'bumping into the cover wall resets it');
  });

  it('moves faster with a bunny-hop bonus', () => {
    const a = createMoveState(-20, 0, 25);
    const b = createMoveState(-20, 0, 25);
    b.hop = 0.5;
    a.onGround = b.onGround = false;
    a.y = b.y = 3;
    stepPlayer(a, frame(1, { forward: 1, yaw: -Math.PI / 2 }), SIM_DT, farm);
    stepPlayer(b, frame(1, { forward: 1, yaw: -Math.PI / 2 }), SIM_DT, farm);
    assert.ok(Math.abs((b.x + 20) / (a.x + 20) - 1.5) < 1e-9);
  });

  it('only fires the jetpack on a fresh press in the air, while there is fuel', () => {
    const s = createMoveState(16, 0, -18);
    s.fuel = JETPACK.maxFuel;
    // Holding jump from the ground: a normal jump, no jetpack.
    for (let i = 0; i < 10; i++) stepPlayer(s, frame(i, { jump: true }), SIM_DT, farm);
    assert.equal(s.jetting, false);
    assert.equal(s.fuel, JETPACK.maxFuel);
    // Release, then press again in the air.
    stepPlayer(s, frame(10), SIM_DT, farm);
    const yBefore = s.y;
    for (let i = 11; i < 71; i++) stepPlayer(s, frame(i, { jump: true }), SIM_DT, farm);
    assert.ok(s.y > yBefore + 3, `rose from ${yBefore} to ${s.y}`);
    assert.ok(s.fuel < JETPACK.maxFuel - 0.9);
    // Empty tank: no more thrust.
    s.fuel = 0;
    stepPlayer(s, frame(72, { jump: true }), SIM_DT, farm);
    assert.equal(s.jetting, false);
  });

  it('carries knockback velocity and lets it decay', () => {
    const s = createMoveState(-20, 0, 5);
    s.vx = 10;
    s.vy = 5;
    s.onGround = false;
    for (let i = 0; i < 10; i++) stepPlayer(s, frame(i), SIM_DT, farm);
    assert.ok(s.x > -20 + 1);
    for (let i = 0; i < 300; i++) stepPlayer(s, frame(i), SIM_DT, farm);
    assert.equal(s.vx, 0);
  });

  it('is deterministic for the same inputs', () => {
    const a = createMoveState(25, 0, 25);
    const b = createMoveState(25, 0, 25);
    for (let i = 0; i < 600; i++) {
      const f = frame(i, { forward: Math.sin(i * 0.1), right: Math.cos(i * 0.07), jump: i % 50 < 20, yaw: i * 0.013 });
      stepPlayer(a, f, SIM_DT, farm);
      stepPlayer(b, f, SIM_DT, farm);
    }
    assert.deepEqual(a, b);
  });
});

describe('CollisionWorld', () => {
  const box = (x: number, z: number): Aabb => ({ minX: x, maxX: x + 1, minY: 0, maxY: 1, minZ: z, maxZ: z + 1 });

  it('returns nearby boxes in ascending id order, without duplicates', () => {
    const w = new CollisionWorld(50);
    w.add(7, box(0, 0));
    w.add(3, { minX: -5, maxX: 5, minY: 0, maxY: 1, minZ: -5, maxZ: 5 });
    w.add(5, box(30, 30));
    const out: Aabb[] = [];
    w.query(-1, -1, 2, 2, out);
    assert.equal(out.length, 2);
    assert.equal(out[0], w.get(3));
    assert.equal(out[1], w.get(7));
  });

  it('removes boxes from every cell', () => {
    const w = new CollisionWorld(50);
    w.add(1, { minX: -9, maxX: 9, minY: 0, maxY: 1, minZ: -9, maxZ: 9 });
    assert.ok(w.remove(1));
    assert.equal(w.query(-9, -9, 9, 9, []).length, 0);
    assert.equal(w.size, 0);
  });
});

describe('developer movement modifiers', () => {
  const flat = new CollisionWorld(40, []);
  const mods = (extra: Partial<MoveMods>): MoveMods => ({ speed: 1, jump: 1, gravity: 1, fly: false, noclip: false, infiniteFuel: false, ...extra });

  it('speed and jump multipliers scale walking and jump height', () => {
    const a = createMoveState(0, 0, 0);
    const b = createMoveState(0, 0, 0);
    for (let i = 1; i <= 60; i++) {
      stepPlayer(a, frame(i, { forward: 1 }), SIM_DT, flat);
      stepPlayer(b, frame(i, { forward: 1 }), SIM_DT, flat, mods({ speed: 2 }));
    }
    assert.ok(Math.abs(b.z / a.z - 2) < 0.01, `ratio ${b.z / a.z}`);

    const j = createMoveState(0, 0, 0);
    stepPlayer(j, frame(1, { jump: true }), SIM_DT, flat, mods({ jump: 2 }));
    assert.equal(j.vy, PLAYER.jumpVelocity * 2 - PLAYER.gravity * SIM_DT);
  });

  it('fly follows the look direction and noclip passes through walls', () => {
    const s = createMoveState(0, 0, 0);
    // Looking 45° up while flying forward climbs.
    for (let i = 1; i <= 30; i++) stepPlayer(s, frame(i, { forward: 1, pitch: Math.PI / 4 }), SIM_DT, flat, mods({ fly: true }));
    assert.ok(s.y > 3, `climbed to ${s.y}`);
    assert.equal(s.vy, 0, 'no gravity while flying');

    const wall: Aabb = { minX: -5, maxX: 5, minY: 0, maxY: 5, minZ: -3, maxZ: -2 };
    const world = new CollisionWorld(40, [wall]);
    const walker = createMoveState(0, 0, 0);
    const ghost = createMoveState(0, 0, 0);
    for (let i = 1; i <= 60; i++) {
      stepPlayer(walker, frame(i, { forward: 1 }), SIM_DT, world, mods({ fly: true }));
      stepPlayer(ghost, frame(i, { forward: 1 }), SIM_DT, world, mods({ noclip: true }));
    }
    assert.ok(walker.z > -2, `fly is blocked by the wall (z ${walker.z})`);
    assert.ok(ghost.z < -5, `noclip went through (z ${ghost.z})`);
  });

  it('infinite fuel keeps the jetpack full', () => {
    const s = createMoveState(0, 0, 0);
    stepPlayer(s, frame(1, { jump: true }), SIM_DT, flat, mods({ infiniteFuel: true }));
    for (let i = 2; i <= 120; i++) stepPlayer(s, frame(i, { jump: i % 2 === 0 }), SIM_DT, flat, mods({ infiniteFuel: true }));
    // Topped up every tick, so it never drops below one tick of thrust from full.
    assert.ok(s.fuel >= JETPACK.maxFuel - SIM_DT - 1e-9, `fuel ${s.fuel}`);
    assert.ok(s.y > 2, `still flying at ${s.y}`);
  });
});

describe('crouching', () => {
  const open = new CollisionWorld(40, []);

  it('is slower and shorter, and needs headroom to stand up', () => {
    const walk = createMoveState(0, 0, 0);
    const sneak = createMoveState(0, 0, 0);
    for (let i = 1; i <= 60; i++) {
      stepPlayer(walk, frame(i, { forward: 1 }), SIM_DT, open);
      stepPlayer(sneak, frame(i, { forward: 1, crouch: true }), SIM_DT, open);
    }
    assert.ok(sneak.crouching);
    assert.ok(Math.abs(sneak.z / walk.z - CROUCH.speed) < 0.01, `ratio ${sneak.z / walk.z}`);
    assert.ok(Math.abs(heightOf(sneak) - PLAYER.height * CROUCH.scale) < 1e-9);

    // Under a low ceiling (1.2 m), letting go of crouch keeps you crouched until you're out.
    const ceiling: Aabb = { minX: -2, maxX: 2, minY: 1.2, maxY: 2, minZ: -2, maxZ: 2 };
    const world = new CollisionWorld(40, [ceiling]);
    const s = createMoveState(0, 0, 0);
    stepPlayer(s, frame(1, { crouch: true }), SIM_DT, world);
    stepPlayer(s, frame(2), SIM_DT, world);
    assert.ok(s.crouching, 'stays crouched under the ceiling');
    for (let i = 3; i < 200 && s.crouching; i++) stepPlayer(s, frame(i, { right: 1 }), SIM_DT, world);
    assert.ok(!s.crouching && s.x > 2, 'stands up once clear');
  });
});
