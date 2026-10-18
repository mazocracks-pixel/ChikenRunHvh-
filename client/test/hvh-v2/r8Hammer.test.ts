import assert from 'node:assert/strict';
import { it } from 'node:test';
import { WeaponController } from '../../src/game/WeaponController';

/** Holds the trigger from `from` to `until` (exclusive) at 1 ms steps; returns the fire times. */
function hold(w: WeaponController, from: number, until: number): number[] {
  const shots: number[] = [];
  for (let now = from; now < until; now++) if (w.trigger(true, now) === 'fire') shots.push(now);
  return shots;
}

it('the R8 fires hammerMs after the press while the trigger is held', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 450), [400]);
  assert.equal(w.mag, 7);
});

it('releasing the R8 trigger before the hammer drops cancels the shot', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 300), []);
  assert.equal(w.trigger(false, 300), null);
  for (let now = 301; now < 1000; now++) assert.equal(w.trigger(false, now), null);
  assert.equal(w.mag, 8);
  // A new press starts a new pull.
  assert.deepEqual(hold(w, 1000, 1500), [1400]);
});

it('a hammer pulled during the cooldown fires once the R8 is ready, not never', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 410), [400]);
  assert.equal(w.trigger(false, 410), null);
  // Hammer back at 820, but the 500 ms cycle from the shot at 400 ends at 900.
  assert.deepEqual(hold(w, 420, 2000), [900]);
});

it('a hammer held through a reload fires when the reload ends', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 410), [400]);
  w.trigger(false, 410);
  assert.equal(w.reload(500), true);
  const shots: number[] = [];
  for (let now = 600; now < 3200; now++) {
    w.update(now);
    if (w.trigger(true, now) === 'fire') shots.push(now);
  }
  assert.deepEqual(shots, [2800]);
  assert.equal(w.mag, 7);
});

it('switching weapons drops the hammer', () => {
  const w = new WeaponController(['r8', 'deserteagle']);
  assert.deepEqual(hold(w, 0, 300), []);
  assert.equal(w.switchTo(1, 300), true);
  assert.equal(w.switchTo(0, 310), true);
  // Still held, but the pull was cancelled: no shot without a new press.
  assert.deepEqual(hold(w, 311, 1500), []);
});

it('the Desert Eagle fires on the press', () => {
  const w = new WeaponController(['deserteagle']);
  assert.deepEqual(hold(w, 0, 450), [0]);
});
