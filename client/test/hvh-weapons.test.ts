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
it('exploit prediction and readiness use weapon eligibility, charge and burst recovery', () => {
  for (const exploit of ['doubleTap', 'hideShots'] as const) {
    const w = new WeaponController(['rifle']); w.tactical = true; w.hvh.exploit = exploit; w.hvh.core!.era = 'legacy';
    const start = performance.now();
    assert.equal(w.exploitState(start), 'Charging');
    for (let tick = 1; tick <= 129; tick++) w.update(start + tick * 1000 / 64, false);
    const now = start + 130 * 1000 / 64;
    assert.equal(w.exploitReady, true); assert.equal(w.exploitState(now), exploit === 'doubleTap' ? 'Burst ready' : 'Concealment ready');
    assert.equal(w.trigger(true, now, true), 'fire'); assert.equal(w.lastShotBurst, exploit === 'doubleTap' ? 2 : 1);
    assert.equal(w.mag, exploit === 'doubleTap' ? 28 : 29); assert.equal(w.exploitState(now), 'Cooldown');
    assert.equal(w.trigger(true, now, true), null);
  }
  const rocket = new WeaponController(['rocket']); rocket.tactical = true; rocket.hvh.exploit = 'doubleTap';
  assert.equal(rocket.exploitReady, false); assert.equal(rocket.exploitState(performance.now() + 2000), 'Unavailable for this weapon');
});
