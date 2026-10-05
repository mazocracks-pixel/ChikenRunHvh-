import assert from 'node:assert/strict';
import { it } from 'node:test';
import { type ShotEvent } from '@game/shared';
import { WeaponController } from '../src/game/WeaponController';

it('authoritative shot feedback corrects rejected ammo and gates autofire on the server timer', () => {
  const w = new WeaponController(['rifle']); w.tactical = true;
  const now = performance.now() + 200; w.update(now);
  assert.equal(w.trigger(true, now, true), 'fire'); assert.equal(w.mag, 29);
  const event: ShotEvent = {pid: 1, shot: w.shotSeq, weapon: 'rifle', ox: 0, oy: 0, oz: 0, ends: [], hits: [], mag: 30, charge: 0, readyAt: 1100};
  w.confirmShot(event, now, 1000);
  assert.equal(w.mag, 30); assert.equal(w.shotState(now + 80), 'Cooldown');
  assert.equal(w.trigger(true, now + 80, true), null);
  w.update(now + 160); assert.equal(w.shotState(now + 160), 'Ready');
});
it('late acknowledgements cannot overwrite ammunition for a newer predicted shot', () => {
  const w = new WeaponController(['rifle']); w.tactical = true;
  let now = performance.now() + 200; w.update(now); w.trigger(true, now, true);
  now += 160; w.update(now); w.trigger(true, now, true); assert.equal(w.shotSeq, 2);
  w.confirmShot({pid: 1, shot: 1, weapon: 'rifle', ox: 0, oy: 0, oz: 0, ends: [], hits: [], mag: 29, readyAt: 1000}, now, 900);
  assert.equal(w.mag, 28);
});
