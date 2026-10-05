import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HVH_STANCES, createMoveState, defaultHvhLoadout, defaultSkeetAntiAim, hvhPose, hvhStance, packPlayer, sanitizeHvhLoadout, sanitizeSkeetAntiAim, unpackPlayer, wrapAngle, type PlayerState } from '../src';
const deg = Math.PI / 180;
it('Skeet sanitizes malformed imports without extending the shared ability caps', () => {
  const safe = sanitizeSkeetAntiAim({ interval: -1, jitterMode: 'evil', desyncMode: null, visualPitch: 'up',
    states: { standing: { mode: 'spin', yawOffset: -999, desync: 999, jitter: 999 }, airborne: { mode: 'evil', desync: NaN }, moving: null } });
  assert.equal(safe.interval, 1); assert.equal(safe.jitterMode, 'center'); assert.equal(safe.visualPitch, 'up');
  assert.deepEqual(safe.states.standing, { mode: 'spin', yawOffset: -180, desync: 58, jitter: 45 });
  assert.deepEqual(safe.states.airborne, defaultSkeetAntiAim().states.airborne);
  assert.deepEqual(sanitizeSkeetAntiAim(null), defaultSkeetAntiAim());
  assert.equal(sanitizeHvhLoadout({ skeet: safe, antiAim: { spinSpeed: 9999 } }).antiAim.spinSpeed, 540);
  assert.equal(defaultHvhLoadout().skeet, undefined, 'existing Lab loadouts stay independent');
});
it('movement states have explicit precedence and use independent stance settings', () => {
  assert.equal(hvhStance({}), 'standing'); assert.equal(hvhStance({ speed: 1 }), 'slowwalking');
  assert.equal(hvhStance({ speed: 5, crouching: true }), 'crouching');
  assert.equal(hvhStance({ speed: 5, crouching: true, onGround: false }), 'aircrouch');
  const l = defaultHvhLoadout(); l.antiAim.enabled = true; l.skeet = defaultSkeetAntiAim(); l.skeet.desyncMode = 'static';
  const contexts = [{}, { speed: 5 }, { speed: 1 }, { crouching: true }, { onGround: false }, { onGround: false, crouching: true }];
  for (const [i, state] of HVH_STANCES.entries()) {
    const p = hvhPose(0, l, 0, false, false, contexts[i]);
    assert.ok(Math.abs(wrapAngle(p.fake - p.real) / deg - l.skeet.states[state].desync) < 1e-8);
  }
  l.skeet.states.moving.desync = 2;
  assert.equal(l.skeet.states.standing.desync, 45, 'editing one stance cannot mutate another');
});
it('random jitter is deterministic per player, inverted desync stays bounded, and reveals override every state', () => {
  const l = defaultHvhLoadout(); l.antiAim.enabled = true; l.skeet = defaultSkeetAntiAim(); l.skeet.jitterMode = 'random';
  for (const pattern of ['static', 'alternate', 'sway'] as const) {
    l.skeet.desyncMode = pattern;
    for (let t = 0; t < 10000; t += 137) {
      const a = hvhPose(0.7, l, t, false, false, { seed: 9 });
      assert.deepEqual(a, hvhPose(0.7, l, t, false, false, { seed: 9 }));
      const b = hvhPose(0.7, l, t, true, false, { seed: 9 });
      assert.ok(Math.abs(wrapAngle(a.fake - a.real)) <= 58 * deg + 1e-8);
      assert.ok(Math.abs(wrapAngle(a.fake - a.real) + wrapAngle(b.fake - b.real)) < 1e-8);
      assert.deepEqual(hvhPose(0.7, l, t, true, true, { onGround: false }), { real: 0.7, fake: 0.7 });
    }
  }
  assert.notEqual(hvhPose(0, l, 1000, false, false, { seed: 1 }).real, hvhPose(0, l, 1000, false, false, { seed: 2 }).real);
});
it('target base and cover side use server evidence, while disabling the builder keeps the Lab fallback', () => {
  const l = defaultHvhLoadout(); l.antiAim.enabled = true; l.skeet = defaultSkeetAntiAim();
  l.skeet.atTargets = l.skeet.freestanding = true; l.skeet.states.standing.jitter = 0;
  const p = hvhPose(0, l, 1000, false, false, { targetYaw: 0.5, coverSide: 1 });
  assert.ok(Math.abs(wrapAngle(p.real - (0.5 + Math.PI))) < 1e-8);
  assert.ok(wrapAngle(p.fake - p.real) > 0, 'freestanding chooses a body side rather than rotating the entire stance');
  l.skeet.enabled = false;
  assert.deepEqual(hvhPose(0, l, 1000, false, false), hvhPose(0, { ...l, skeet: undefined }, 1000, false, false));
});
it('cosmetic pitch appends to snapshots and legacy packets retain real pitch and existing field positions', () => {
  const s: PlayerState = { ...createMoveState(1, 0, 2), pid: 4, yaw: 0.2, pitch: 0.3, fakeYaw: 1, fakePitch: -0.65,
    alive: true, reloading: false, shielded: false, aiming: false, carryingFlag: false, hp: 100, armor: 0,
    weapon: 'pistol', mag: 12, eggs: 0, smokes: 0, ack: 12, vehicle: 0, frozen: false, hvhPreparing: true };
  const packed = packPlayer(s), decoded = unpackPlayer(packed);
  assert.equal(packed[26], 1); assert.equal(decoded.pitch, 0.3); assert.equal(decoded.fakePitch, -0.65);
  assert.equal(decoded.fakeYaw, 1); assert.equal(decoded.ack, 12);
  assert.equal(unpackPlayer(packed.slice(0, 27)).fakePitch, 0.3);
});
