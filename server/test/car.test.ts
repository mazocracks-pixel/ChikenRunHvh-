import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BUGGY, HITBOX, MAPS, PLAYER, SIM_DT, createCollisionWorld, newCar, seatPosition, stepCar, type InputFrame } from '@game/shared';
import type { GameRoom } from '../src/rooms/GameRoom';
import { createRoom } from '../src/rooms/modes';
import type { ServerPlayer } from '../src/rooms/ServerPlayer';
import { addPlayer, fakeIo, place } from './helpers';

let current: GameRoom | null = null;
afterEach(() => current?.close());

// Open ground with no edge in sight.
const flat = createCollisionWorld({ ...MAPS.flat, halfSize: 2000, boxes: [] });
const frame = (f: Partial<InputFrame> = {}): InputFrame => ({ seq: 0, forward: 0, right: 0, jump: false, yaw: 0, pitch: 0, ...f });
const drive = (car: ReturnType<typeof newCar>, f: Partial<InputFrame>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) stepCar(car, frame(f), SIM_DT, flat);
};

describe('buggy handling', () => {
  it('slides a little in fast turns, drifts with the handbrake, then grips again', () => {
    const grip = newCar(0, 0, 0);
    drive(grip, { forward: 1 }, 2.5);
    drive(grip, { forward: 1, right: 1 }, 0.4);
    const drift = newCar(0, 0, 0);
    drive(drift, { forward: 1 }, 2.5);
    drive(drift, { forward: 1, right: 1, jump: true }, 0.4);
    assert.ok(Math.abs(drift.slip) > Math.abs(grip.slip) * 2, `drift slip ${drift.slip.toFixed(2)} vs ${grip.slip.toFixed(2)}`);
    assert.ok(Math.abs(drift.slip) > 3, 'a real slide');
    drive(drift, { forward: 1 }, 1.5);
    assert.ok(Math.abs(drift.slip) < 0.5, 'tyres grip again');
  });

  it('nitro goes faster than the normal top speed, runs out, and refills', () => {
    const car = newCar(0, 0, 0);
    drive(car, { forward: 1 }, 3);
    assert.ok(car.speed <= BUGGY.maxSpeed + 1e-6);
    drive(car, { forward: 1, boost: true }, 1.2);
    assert.ok(car.speed > BUGGY.maxSpeed + 2, `boosted to ${car.speed.toFixed(1)}`);
    drive(car, { forward: 1, boost: true }, 3);
    assert.ok(car.boost < BUGGY.boostMin, 'tank empty');
    assert.ok(car.speed <= BUGGY.maxSpeed + 0.5, 'back to normal speed');
    drive(car, { forward: 0 }, 4);
    assert.ok(car.boost > 0.3, 'refilling');
  });

  it('is deterministic (the driver predicts it exactly)', () => {
    const a = newCar(1, 2, 0.3);
    const b = newCar(1, 2, 0.3);
    const script: Partial<InputFrame>[] = [{ forward: 1 }, { forward: 1, right: -1, jump: true }, { forward: 1, boost: true, right: 0.5 }, { forward: -1 }];
    for (const s of script) {
      drive(a, s, 0.7);
      drive(b, s, 0.7);
    }
    assert.deepEqual(a, b);
  });
});

describe('shooting from the buggy', () => {
  function setup() {
    const { io, events } = fakeIo();
    const r = createRoom(io, { id: 'c', code: 'CAR01', name: 'Car', mode: 'ffa', map: 'farm', private: true }, {});
    current = r;
    const driver = addPlayer(r, 'Driver');
    const other = addPlayer(r, 'Other');
    // Start first: a new match puts every car back where it belongs.
    r.startNow();
    const spot = MAPS.farm.vehicles[0]!;
    place(driver, spot.x - 2, spot.z);
    r.handleUseVehicle(driver);
    assert.ok(driver.vehicle, 'in the car');
    for (const p of [driver, other]) p.shieldUntil = 0;
    return { r, events, driver, other, spot };
  }
  let shot = 0;
  const fire = (r: GameRoom, p: ServerPlayer, d: { x: number; y: number; z: number }, weapon = p.weapon) => {
    p.lastFireAt = -Infinity;
    p.switchReadyAt = 0;
    p.mags.set(weapon, 30);
    r.handleFire(p, { shot: ++shot, weapon, dx: d.x, dy: d.y, dz: d.z, t: performance.now(), aiming: false });
  };
  const towards = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => {
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const l = Math.hypot(d.x, d.y, d.z);
    return { x: d.x / l, y: d.y / l, z: d.z / l };
  };

  it('the driver shoots from the seat, and their own car never gets in the way', () => {
    const { r, driver, other, spot } = setup();
    place(other, spot.x, spot.z + 7);
    const eye = r.eyeOf(driver);
    const seat = seatPosition({ x: spot.x, z: spot.z, yaw: spot.yaw });
    assert.ok(Math.abs(eye.y - (seat.y + PLAYER.eyeHeight)) < 1e-6, 'eyes in the seat');
    const hp = other.hp;
    // Low through the car's own body, at the other chicken's chest.
    fire(r, driver, towards(eye, { x: other.state.x, y: 0.7, z: other.state.z }));
    assert.ok(other.hp < hp, `hit (${other.hp})`);
  });

  it('a body shot hits the car, a head above it hits the driver; no knifing from the seat', () => {
    const { r, driver, other, spot } = setup();
    place(other, spot.x + 6, spot.z);
    const eye = r.eyeOf(other);
    const seat = seatPosition({ x: spot.x, z: spot.z, yaw: spot.yaw });
    const hp = driver.hp;
    fire(r, other, towards(eye, { x: seat.x, y: 0.6, z: seat.z }));
    assert.equal(driver.hp, hp, 'the car took that one');
    // The head sits well above the car's sides (a little ahead of the body, the way it faces).
    driver.yaw = 0;
    fire(r, other, towards(eye, { x: seat.x, y: seat.y + HITBOX.headHeight, z: seat.z - HITBOX.headForward }));
    assert.ok(driver.hp < hp, `headshot through the open top (${driver.hp})`);

    other.hp = PLAYER.maxHealth;
    place(other, seat.x + 1, seat.z);
    driver.info.loadout = [...driver.info.loadout.filter((w) => w !== 'knife'), 'knife'];
    driver.weaponSlot = driver.info.loadout.indexOf('knife');
    fire(r, driver, towards(r.eyeOf(driver), { x: other.state.x, y: 1, z: other.state.z }), 'knife');
    assert.equal(other.hp, PLAYER.maxHealth, 'no melee from the car');
  });
});
