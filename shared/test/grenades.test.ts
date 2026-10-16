import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollisionWorld, FLASH, PROJECTILES, SIM_DT, atRest, flashBlindMs, fuseDone, launchVelocity, predictThrow, stepProjectile, type ProjectileBody } from '../src/index';

// Open ground (y = 0), and a 12 m wall across x = 10.
const open = () => new CollisionWorld(200, []);
const walled = () => new CollisionWorld(200, [{ minX: 10, maxX: 11, minY: 0, maxY: 12, minZ: -20, maxZ: 20 }]);
const eye = { x: 0, y: 1.3, z: 0 };
const ahead = { x: 1, y: 0.2, z: 0 };

describe('grenade throws', () => {
  it('left click goes far, both medium, right click a short toss', () => {
    const def = PROJECTILES.he;
    const land = (power: 0 | 0.5 | 1) => predictThrow(def, eye, launchVelocity(def, ahead, power), open()).end.x;
    const far = land(1), medium = land(0.5), soft = land(0);
    assert.ok(far > medium && medium > soft, `far ${far.toFixed(1)} > medium ${medium.toFixed(1)} > soft ${soft.toFixed(1)}`);
    assert.ok(soft > 1 && soft < 8, `an underhand toss lands close (${soft.toFixed(1)} m)`);
  });

  it('running and jumping add your own speed', () => {
    const def = PROJECTILES.smoke;
    const still = predictThrow(def, eye, launchVelocity(def, ahead, 1), open()).end.x;
    const running = predictThrow(def, eye, launchVelocity(def, ahead, 1, { x: 6, y: 0, z: 0 }), open()).end.x;
    const jumping = launchVelocity(def, ahead, 1, { x: 0, y: 4, z: 0 }).y;
    assert.ok(running > still + 3, `a running throw goes further (${still.toFixed(1)} → ${running.toFixed(1)} m)`);
    assert.ok(jumping > launchVelocity(def, ahead, 1).y, 'a jumping throw goes higher');
  });

  it('bounces off the floor losing speed each time, rolls and stops', () => {
    const def = PROJECTILES.he;
    const b: ProjectileBody = { ...eye, ...(({ x, y, z }) => ({ vx: x, vy: y, vz: z }))(launchVelocity(def, { x: 1, y: 0.5, z: 0 }, 1)) };
    const world = open();
    const peaks: number[] = [];
    let falling = false, top = b.y;
    for (let i = 0; i < 60 * 10 && !atRest(b); i++) {
      stepProjectile(b, def, SIM_DT, world);
      if (b.vy < 0) falling = true;
      if (falling && b.vy > 0) {
        peaks.push(top);
        falling = false;
        top = 0;
      }
      top = Math.max(top, b.y);
    }
    assert.ok(peaks.length >= 2, `bounced (${peaks.length} times)`);
    for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i]! < peaks[i - 1]!, 'each bounce lower');
    assert.ok(atRest(b), 'and comes to rest');
    assert.ok(b.y < 0.2, 'on the floor');
  });

  it('bounces back off a wall', () => {
    const def = PROJECTILES.flash;
    const b: ProjectileBody = { ...eye, ...(({ x, y, z }) => ({ vx: x, vy: y, vz: z }))(launchVelocity(def, ahead, 1)) };
    const world = walled();
    for (let i = 0; i < 90; i++) stepProjectile(b, def, SIM_DT, world);
    assert.ok(b.x < 10, `never through the wall (x ${b.x.toFixed(2)})`);
    assert.ok(b.vx <= 0, 'coming back off it');
  });

  it('fuses: the HE egg 1.5 s after it lands, the flash 1.5 s after the throw, the smoke once it stops', () => {
    const still: ProjectileBody = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const moving: ProjectileBody = { ...still, vx: 3 };
    assert.equal(fuseDone(PROJECTILES.he, still, 5000, null), false, 'not while it is in the air');
    assert.equal(fuseDone(PROJECTILES.he, still, 2000, 1400), false);
    assert.equal(fuseDone(PROJECTILES.he, still, 2000, 1500), true);
    assert.equal(fuseDone(PROJECTILES.flash, moving, 1499, null), false);
    assert.equal(fuseDone(PROJECTILES.flash, moving, 1500, null), true);
    assert.equal(fuseDone(PROJECTILES.smoke, moving, 2000, null), false, 'smoke: not while rolling');
    assert.equal(fuseDone(PROJECTILES.smoke, still, 2000, null), true);
    assert.equal(PROJECTILES.egg.explodeOnImpact, true, 'the Egg Launcher still bursts on impact');
  });

  it('the aiming line ends where the grenade goes off', () => {
    const def = PROJECTILES.he;
    const v = launchVelocity(def, ahead, 0.5);
    const { path, end } = predictThrow(def, eye, v, walled());
    assert.ok(path.length > 10);
    // Step it the long way, as the server does.
    const b: ProjectileBody = { ...eye, vx: v.x, vy: v.y, vz: v.z };
    let landedAt: number | null = null;
    for (let i = 1; ; i++) {
      stepProjectile(b, def, SIM_DT, walled());
      if (b.landed && landedAt === null) landedAt = i;
      if (fuseDone(def, b, i * SIM_DT * 1000, landedAt === null ? null : (i - landedAt) * SIM_DT * 1000)) break;
    }
    assert.deepEqual(end, { x: b.x, y: b.y, z: b.z });
  });
});

describe('flashbang blindness', () => {
  const at = { x: 0, y: 1.3, z: -3 };
  const toward = { x: 0, y: 0, z: -1 };
  it('1 to 3 seconds looking at it, longer up close; barely anything facing away', () => {
    const close = flashBlindMs(eye, toward, at);
    const far = flashBlindMs(eye, toward, { x: 0, y: 1.3, z: -(FLASH.range - 1) });
    const away = flashBlindMs(eye, { x: 0, y: 0, z: 1 }, at);
    assert.ok(close > 2500 && close <= 3000, `close and looking: ${close} ms`);
    assert.ok(far >= 1000 && far < close, `far but looking: ${far} ms`);
    assert.ok(away < 500, `facing away: ${away} ms`);
  });
});
