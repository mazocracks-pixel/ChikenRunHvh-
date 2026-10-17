import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wrapAngle } from '../../src/math';
import { LATE_CSGO } from '../../src/hvh/v2/era';
import {
  type AntiAimConfig,
  type Motion,
  type PoseState,
  INITIAL_POSE,
  maxDesync,
  publicObservation,
  stepPose,
} from '../../src/hvh/v2/pose';

const EPS = 1e-9;
const DEG = Math.PI / 180;

const STAND: Motion = { speedFraction: 0, duck: 0, onGround: true };
const RUN: Motion = { speedFraction: 1, duck: 0, onGround: true };
const AA: AntiAimConfig = { base: 'backward', jitterDeg: 0, desyncDeg: 58, inverted: false };

function desyncDeg(p: PoseState): number {
  return Math.abs(wrapAngle(p.bodyYaw - p.eyeYaw)) / DEG;
}

describe('Pose and desync (v2)', () => {
  it('maxDesync falls off linearly with speed', () => {
    assert.equal(maxDesync(0, LATE_CSGO), 58);
    assert.equal(maxDesync(1, LATE_CSGO), 29);
    assert.ok(Math.abs(maxDesync(0.5, LATE_CSGO) - 43.5) < EPS);
    assert.equal(maxDesync(2, LATE_CSGO), 29, 'speedFraction clamped to 1');
    assert.equal(maxDesync(-1, LATE_CSGO), 58, 'speedFraction clamped to 0');
  });

  it('desync clamps by speed', () => {
    const p = stepPose(INITIAL_POSE, 0, AA, RUN, 1, LATE_CSGO);
    assert.ok(desyncDeg(p) <= 29 + EPS, `desync ${desyncDeg(p)}`);
    assert.ok(Math.abs(desyncDeg(p) - 29) < EPS);
    const s = stepPose(INITIAL_POSE, 0, AA, STAND, 1, LATE_CSGO);
    assert.ok(Math.abs(desyncDeg(s) - 58) < EPS);
  });

  it('backward base faces away from aim', () => {
    const p = stepPose(INITIAL_POSE, 0.3, AA, STAND, 1, LATE_CSGO);
    assert.ok(Math.abs(wrapAngle(p.eyeYaw - (0.3 + Math.PI))) < EPS);
  });

  it('jitter alternates', () => {
    const aa: AntiAimConfig = { ...AA, jitterDeg: 30 };
    let p = INITIAL_POSE;
    let lastPhase = p.jitterPhase;
    for (let tick = 1; tick <= 6; tick++) {
      p = stepPose(p, 0, aa, STAND, tick, LATE_CSGO);
      assert.notEqual(p.jitterPhase, lastPhase, `phase flips at tick ${tick}`);
      lastPhase = p.jitterPhase;
      const offset = wrapAngle(p.eyeYaw - Math.PI) / DEG;
      assert.ok(Math.abs(Math.abs(offset) - 30) < EPS, `offset ${offset}`);
      assert.equal(Math.sign(offset), p.jitterPhase === 1 ? 1 : -1);
      const obs = publicObservation(p, STAND, tick);
      assert.ok(Math.abs(obs.eyeOffsetDeg - offset) < EPS);
    }
  });

  it('jitter is clamped to 0..45', () => {
    const p = stepPose(INITIAL_POSE, 0, { ...AA, jitterDeg: 90 }, STAND, 1, LATE_CSGO);
    assert.ok(Math.abs(Math.abs(wrapAngle(p.eyeYaw - Math.PI)) / DEG - 45) < EPS);
  });

  it('inverted flips side', () => {
    const a = stepPose(INITIAL_POSE, 0, AA, STAND, 1, LATE_CSGO);
    const b = stepPose(INITIAL_POSE, 0, { ...AA, inverted: true }, STAND, 1, LATE_CSGO);
    assert.notEqual(a.realSide, 'center');
    assert.notEqual(b.realSide, 'center');
    assert.notEqual(a.realSide, b.realSide);
  });

  it('zero desync is center', () => {
    const p = stepPose(INITIAL_POSE, 0, { ...AA, desyncDeg: 0 }, STAND, 1, LATE_CSGO);
    assert.equal(p.realSide, 'center');
    assert.ok(desyncDeg(p) < EPS);
  });

  it('observation hides body', () => {
    const p = stepPose(INITIAL_POSE, 0, { ...AA, jitterDeg: 20 }, RUN, 5, LATE_CSGO);
    const obs = publicObservation(p, RUN, 5);
    assert.ok(!('bodyYaw' in obs));
    assert.ok(!('realSide' in obs));
    assert.equal(obs.tick, 5);
    assert.equal(obs.eyeYaw, p.eyeYaw);
    assert.equal(obs.speedFraction, 1);
    assert.equal(obs.duck, 0);
  });

  it('does not mutate prev', () => {
    const prev = Object.freeze({ ...INITIAL_POSE });
    stepPose(prev, 1, { ...AA, jitterDeg: 30 }, RUN, 3, LATE_CSGO);
    assert.deepEqual(prev, INITIAL_POSE);
  });

  it('deterministic', () => {
    const aa: AntiAimConfig = { base: 'spin', jitterDeg: 15, desyncDeg: 40, inverted: true };
    const run = () => {
      let p = INITIAL_POSE;
      const out = [];
      for (let tick = 1; tick <= 20; tick++) {
        p = stepPose(p, tick * 0.01, aa, { speedFraction: 0.4, duck: 0.5, onGround: true }, tick, LATE_CSGO);
        out.push({ p, obs: publicObservation(p, RUN, tick) });
      }
      return out;
    };
    assert.deepEqual(run(), run());
  });
});
