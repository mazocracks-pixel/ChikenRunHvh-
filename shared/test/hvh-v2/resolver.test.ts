import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Observation, Side } from '../../src/hvh/v2/pose';
import {
  BREAK_CONFIDENCE,
  DEFAULT_SIDE,
  JITTER_MIN_RUN,
  NO_INFO_CONFIDENCE,
  START_CONFIDENCE,
  type VerdictCause,
  createResolverMemory,
  learnFromVerdict,
  resolve,
} from '../../src/hvh/v2/resolver';

function ob(tick: number, eyeOffsetDeg: number): Observation {
  return { tick, eyeYaw: 0, eyeOffsetDeg, speedFraction: 0, duck: 0 };
}

/** Observations at ticks 1..n with the given offsets. */
function seq(offsets: number[]): Observation[] {
  return offsets.map((o, i) => ob(i + 1, o));
}

const opposite = (s: Side): Side => (s === 'left' ? 'right' : s === 'right' ? 'left' : s);

describe('Resolver (v2)', () => {
  it('documented constants: start confidence is low, break is below 0.4', () => {
    assert.ok(START_CONFIDENCE < 0.4);
    assert.ok(NO_INFO_CONFIDENCE < 0.4);
    assert.ok(BREAK_CONFIDENCE < 0.4);
    assert.equal(JITTER_MIN_RUN, 3);
    assert.equal(DEFAULT_SIDE, 'left');
  });

  it('eye offset suggests the opposite side, at low confidence', () => {
    const mem = createResolverMemory();
    assert.deepEqual(resolve(mem, 'a', [ob(1, 20)], 1), { side: 'right', confidence: START_CONFIDENCE });
    assert.deepEqual(resolve(mem, 'b', [ob(1, -20)], 1), { side: 'left', confidence: START_CONFIDENCE });
  });

  it('no informative observations: deterministic default side at low confidence', () => {
    const mem = createResolverMemory();
    const expected = { side: DEFAULT_SIDE, confidence: NO_INFO_CONFIDENCE };
    assert.deepEqual(resolve(mem, 'a', [], 10), expected);
    assert.deepEqual(resolve(mem, 'a', seq([0, 0, 0]), 10), expected);
    assert.deepEqual(resolve(mem, 'a', seq([-0, -0, -0, -0]), 10), expected, '-0 is treated as 0');
  });

  it('flips after resolver miss', () => {
    const mem = createResolverMemory();
    const obs = seq([0, 0]);
    const first = resolve(mem, 'a', obs, 2);
    assert.equal(first.side, 'left');
    learnFromVerdict(mem, 'a', 'left', 'resolver');
    assert.equal(resolve(mem, 'a', obs, 2).side, 'right');
    assert.equal(resolve(mem, 'a', obs, 2).side, 'right', 'flip persists across calls');
    learnFromVerdict(mem, 'a', 'right', 'resolver');
    assert.equal(resolve(mem, 'a', obs, 2).side, 'left', 'next resolver miss flips back');
  });

  it('flip is cleared when the observed pattern changes', () => {
    const mem = createResolverMemory();
    const still = seq([0, 0]);
    assert.equal(resolve(mem, 'a', still, 2).side, 'left');
    learnFromVerdict(mem, 'a', 'left', 'resolver');
    assert.equal(resolve(mem, 'a', still, 2).side, 'right');
    // Target starts showing a static positive eye offset: a new pattern.
    const leaning = [...still, ob(3, 15), ob(4, 15)];
    assert.equal(resolve(mem, 'a', leaning, 4).side, 'right', 'offset +15 suggests right, unflipped');
    // Going back to the old pattern does not resurrect the old flip.
    const stillAgain = [...leaning, ob(5, 0), ob(6, 0)];
    assert.equal(resolve(mem, 'a', stillAgain, 6).side, 'left');
  });

  it('learns jitter', () => {
    const mem = createResolverMemory();
    const obs = seq([30, -30, 30, -30]);
    // The last observed offset is -30 at tick 4; the phase flips every tick, so tick 5 shows +30,
    // which suggests 'right'.
    const r = resolve(mem, 'a', obs, 5);
    assert.equal(r.side, 'right');
    assert.ok(r.confidence >= 0.6, `confidence ${r.confidence}`);
    // At tick 4 the phase is the observed one: -30 suggests 'left'.
    assert.equal(resolve(mem, 'a', obs, 4).side, 'left');
    // Two ticks ahead the phase is back to -30.
    assert.equal(resolve(mem, 'a', obs, 6).side, 'left');
  });

  it('jitter needs at least three alternating observations', () => {
    const mem = createResolverMemory();
    assert.ok(resolve(mem, 'a', seq([30, -30]), 3).confidence < 0.6);
    assert.ok(resolve(mem, 'b', seq([30, -30, 30]), 4).confidence >= 0.6);
  });

  it('a resolver miss on jitter inverts the phase mapping', () => {
    const mem = createResolverMemory();
    const obs = seq([30, -30, 30, -30]);
    const before5 = resolve(mem, 'a', obs, 5).side;
    learnFromVerdict(mem, 'a', before5, 'resolver');
    const after = [...obs, ob(5, 30), ob(6, -30)];
    // Tick 7 has phase +30 again (same phase as tick 5), so the flipped guess is the opposite.
    assert.equal(resolve(mem, 'a', after, 7).side, opposite(before5));
    assert.equal(resolve(mem, 'a', after, 6).side, before5);
  });

  it('pattern break lowers confidence', () => {
    const mem = createResolverMemory();
    const jitter = seq([30, -30, 30, -30]);
    assert.ok(resolve(mem, 'a', jitter, 5).confidence >= 0.6);
    const broken = [...jitter, ob(5, -30), ob(6, -30)];
    const r = resolve(mem, 'a', broken, 7);
    assert.ok(r.confidence < 0.4, `confidence ${r.confidence}`);
    assert.equal(r.confidence, BREAK_CONFIDENCE);
  });

  it('no future peeking', () => {
    const past = seq([30, -30, 30, -30]);
    const future = [ob(5, -30), ob(6, -30), ob(7, 0), ob(8, 12)];
    const a = resolve(createResolverMemory(), 'a', past, 4);
    const b = resolve(createResolverMemory(), 'a', [...past, ...future], 4);
    assert.deepEqual(b, a);
  });

  it('input order does not matter and the input is not mutated', () => {
    const sorted = seq([30, -30, 30, -30]);
    const shuffled = [sorted[2]!, sorted[0]!, sorted[3]!, sorted[1]!];
    const snapshot = JSON.stringify(shuffled);
    const a = resolve(createResolverMemory(), 'a', sorted, 5);
    const b = resolve(createResolverMemory(), 'a', shuffled, 5);
    assert.deepEqual(b, a);
    assert.equal(JSON.stringify(shuffled), snapshot);
  });

  it('spread miss teaches nothing', () => {
    const mem = createResolverMemory();
    const obs = seq([0, 0]);
    const before = resolve(mem, 'a', obs, 2);
    learnFromVerdict(mem, 'a', before.side, 'spread');
    assert.deepEqual(resolve(mem, 'a', obs, 2), before);
  });

  it('only resolver misses teach', () => {
    const others: VerdictCause[] = ['hit', 'spread', 'invalidRecord', 'obstruction', 'tickbase', 'rejected'];
    for (const cause of others) {
      const mem = createResolverMemory();
      const obs = seq([20, 20]);
      const before = resolve(mem, 'a', obs, 2);
      learnFromVerdict(mem, 'a', before.side, cause);
      learnFromVerdict(mem, 'a', before.side, cause);
      assert.deepEqual(resolve(mem, 'a', obs, 2), before, `cause ${cause}`);
    }
  });

  it('hit teaches nothing', () => {
    const mem = createResolverMemory();
    const obs = seq([30, -30, 30, -30]);
    const before = resolve(mem, 'a', obs, 5);
    learnFromVerdict(mem, 'a', before.side, 'hit');
    assert.deepEqual(resolve(mem, 'a', obs, 5), before);
  });

  it('targets are independent', () => {
    const mem = createResolverMemory();
    const obs = seq([0, 0]);
    const a0 = resolve(mem, 'a', obs, 2);
    const b0 = resolve(mem, 'b', obs, 2);
    learnFromVerdict(mem, 'a', a0.side, 'resolver');
    assert.notEqual(resolve(mem, 'a', obs, 2).side, a0.side);
    assert.deepEqual(resolve(mem, 'b', obs, 2), b0);
  });

  it('is deterministic across fresh memories', () => {
    const run = () => {
      const mem = createResolverMemory();
      const out: unknown[] = [];
      const obs: Observation[] = [];
      for (let t = 1; t <= 40; t++) {
        obs.push(ob(t, t % 7 === 0 ? 10 : t % 2 === 0 ? 25 : -25));
        const r = resolve(mem, 'x', obs, t + 1);
        out.push(r);
        if (t % 5 === 0) learnFromVerdict(mem, 'x', r.side, 'resolver');
      }
      return out;
    };
    assert.deepEqual(run(), run());
  });
});
