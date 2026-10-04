import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HITBOX,
  MAPS,
  PROJECTILES,
  WEAPONS,
  WEAPON_IDS,
  createCollisionWorld,
  damageAt,
  makeRay,
  packPlayer,
  pelletDirections,
  rayAabb,
  rayChicken,
  raySphere,
  raycastWorld,
  shotSeed,
  stepProjectile,
  unpackPlayer,
  type PlayerState,
} from '../src/index';

describe('raycasts', () => {
  it('hits a box and reports the face normal', () => {
    const hit = { t: 0, nx: 0, ny: 0, nz: 0 };
    const t = rayAabb(makeRay({ x: -5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }), { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }, 100, hit);
    assert.equal(t, 5);
    assert.deepEqual([hit.nx, hit.ny, hit.nz], [-1, 0, 0]);
  });

  it('misses a box beside the ray', () => {
    const t = rayAabb(makeRay({ x: -5, y: 3, z: 0.5 }, { x: 1, y: 0, z: 0 }), { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }, 100);
    assert.equal(t, -1);
  });

  it('hits spheres', () => {
    assert.equal(raySphere(makeRay({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }), 0, 0, 0, 1, 100), 9);
    assert.equal(raySphere(makeRay({ x: 5, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }), 0, 0, 0, 1, 100), -1);
  });

  it('tells headshots from body shots', () => {
    // Chicken at the origin facing -Z; its head sits forward at z = -headForward.
    const head = rayChicken(makeRay({ x: 0, y: HITBOX.headHeight, z: -10 }, { x: 0, y: 0, z: 1 }), 0, 0, 0, 0, 100);
    assert.ok(head?.headshot);
    const body = rayChicken(makeRay({ x: 0, y: 0.5, z: -10 }, { x: 0, y: 0, z: 1 }), 0, 0, 0, 0, 100);
    assert.ok(body && !body.headshot);
    assert.equal(rayChicken(makeRay({ x: 3, y: 0.5, z: -10 }, { x: 0, y: 0, z: 1 }), 0, 0, 0, 0, 100), null);
  });

  it('stops at walls and the ground', () => {
    const farm = createCollisionWorld(MAPS.farm);
    const wall = raycastWorld(makeRay({ x: 5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }), farm, 100);
    assert.ok(wall && Math.abs(wall.t - 6.5) < 1e-9);
    const ground = raycastWorld(makeRay({ x: 16, y: 2, z: -18 }, { x: 0, y: -1, z: 0 }), farm, 100);
    assert.ok(ground && ground.t === 2 && ground.ny === 1);
  });
});

describe('weapons', () => {
  it('produces the right number of pellets inside the spread cone', () => {
    const w = WEAPONS.shotgun;
    const dirs = pelletDirections(w, { x: 0, y: 0, z: -1 }, w.spread, 1234);
    assert.equal(dirs.length, w.pellets);
    for (const d of dirs) {
      assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
      assert.ok(Math.acos(-d.z) <= w.spread + 1e-9);
    }
  });

  it('uses the same pellet pattern for the same seed', () => {
    const w = WEAPONS.shotgun;
    const seed = shotSeed(3, 17);
    assert.deepEqual(pelletDirections(w, { x: 1, y: 0.2, z: 0 }, 0.05, seed), pelletDirections(w, { x: 1, y: 0.2, z: 0 }, 0.05, seed));
    assert.notDeepEqual(pelletDirections(w, { x: 1, y: 0, z: 0 }, 0.05, shotSeed(3, 18)), pelletDirections(w, { x: 1, y: 0, z: 0 }, 0.05, seed));
  });

  it('drops damage off with distance', () => {
    const w = WEAPONS.shotgun;
    assert.equal(damageAt(w, 1), w.damage);
    assert.ok(damageAt(w, 30) < w.damage * 0.6);
    assert.equal(damageAt(WEAPONS.sniper, 200), WEAPONS.sniper.damage);
  });

  it('defines every weapon in the id list', () => {
    for (const id of WEAPON_IDS) assert.equal(WEAPONS[id].id, id);
  });
});

describe('projectiles', () => {
  const farm = createCollisionWorld(MAPS.farm);

  it('explodes an egg when it lands', () => {
    const egg = { x: 16, y: 1.3, z: -18, vx: 10, vy: 3, vz: 0 };
    let ticks = 0;
    while (!stepProjectile(egg, PROJECTILES.egg, 1 / 60, farm) && ticks < 600) ticks++;
    assert.ok(ticks < 120, `took ${ticks} ticks`);
    assert.ok(egg.y >= 0 && egg.y < 0.5);
  });

  it('bounces a smoke grenade and lets it come to rest', () => {
    const smoke = { x: -20, y: 1.3, z: 5, vx: 6, vy: 2, vz: 0 };
    for (let i = 0; i < 300; i++) assert.equal(stepProjectile(smoke, PROJECTILES.smoke, 1 / 60, farm), false);
    assert.ok(smoke.y >= 0 && smoke.y < 0.3);
    assert.ok(Math.hypot(smoke.vx, smoke.vy, smoke.vz) < 1);
  });
});

describe('protocol packing', () => {
  it('round-trips player state', () => {
    const p: PlayerState = {
      pid: 7,
      horizontalSpeed: 2.7, hvhPreparing: false, x: 1.23456, y: 2, z: -3.5, vx: 0.1, vy: -4, vz: 0, yaw: 1.5, pitch: -0.2, onGround: false,
      fuel: 1.5, jumpHeld: true, jetting: true, alive: true, reloading: false, shielded: true, aiming: false,
      carryingFlag: true, hp: 55, armor: 20, weapon: 'sniper', mag: 3, eggs: 2, smokes: 1, ack: 991, vehicle: 0,
      gliding: true, hop: 0.24, groundTicks: 3, frozen: true, crouching: true,
      fakeYaw: 2, hvhCharge: 0.5, hvhBurst: true, hvhConcealed: true,
    };
    const back = unpackPlayer(packPlayer(p));
    assert.deepEqual(back, { ...p, x: 1.235, fakePitch: p.pitch });
  });
});
