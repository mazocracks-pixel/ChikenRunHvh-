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

it('the Desert Eagle fires on the press', () => {
  const w = new WeaponController(['deserteagle']);
  assert.deepEqual(hold(w, 0, 450), [0]);
});
