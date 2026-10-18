import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_TICKBASE, LATE_CSGO, stepTickbase, type CommandIntent, type TickbaseState } from '@game/shared/hvh/v2';
import { PredictedTickbase } from '../../src/hvh/PredictedTickbase';

const era = LATE_CSGO;
const NONE: CommandIntent = { fire: false, choke: false, doubleTap: false, hideShots: false, defensive: false };
const FIRE_DT: CommandIntent = { ...NONE, fire: true, doubleTap: true };
const CHOKE: CommandIntent = { ...NONE, choke: true };

/** Server side: runs stepTickbase and serialises like hvhStateEvent (ticksSinceShift capped). */
function serverRun(start: TickbaseState, intents: CommandIntent[]): TickbaseState {
  let s = start;
  for (const i of intents) s = stepTickbase(s, i, era).next;
  return { ...s, ticksSinceShift: Math.min(s.ticksSinceShift, era.rechargeDelayTicks) };
}

const script: CommandIntent[] = [
  ...Array.from({ length: 30 }, () => NONE), CHOKE, CHOKE, FIRE_DT, NONE, NONE, FIRE_DT,
  ...Array.from({ length: 20 }, () => NONE),
];

describe('PredictedTickbase', () => {
  it('prediction matches server', () => {
    const start = EMPTY_TICKBASE(100, era);
    const p = new PredictedTickbase(era, start);
    script.forEach((intent, i) => p.apply(i + 1, intent));
    for (const ack of [5, 12, script.length]) {
      p.reconcile(serverRun(start, script.slice(0, ack)), ack);
    }
    assert.equal(p.mismatches, 0);
    assert.deepEqual(p.state, serverRun(start, script));
  });

  it('reconcile replays unacked', () => {
    const start = EMPTY_TICKBASE(0, era);
    const p = new PredictedTickbase(era, start);
    const intents = script.slice(0, 14);
    intents.forEach((intent, i) => p.apply(i + 1, intent));
    p.reconcile(serverRun(start, intents.slice(0, 10)), 10);
    // Uncapped full replay (the server's cap only applies on the wire).
    let expected = serverRun(start, intents.slice(0, 10));
    for (const i of intents.slice(10)) expected = stepTickbase(expected, i, era).next;
    assert.deepEqual(p.state, expected);
    assert.equal(p.mismatches, 0);
  });

  it('mismatch counted and snaps to server', () => {
    const start = EMPTY_TICKBASE(0, era);
    const p = new PredictedTickbase(era, start);
    const intents = script.slice(0, 14);
    intents.forEach((intent, i) => p.apply(i + 1, intent));
    const bad = { ...serverRun(start, intents.slice(0, 10)), bank: 3 };
    p.reconcile(bad, 10);
    assert.equal(p.mismatches, 1);
    let expected = bad;
    for (const i of intents.slice(10)) expected = stepTickbase(expected, i, era).next;
    assert.deepEqual(p.state, expected);
  });

  it('capped ticksSinceShift on the server is not a mismatch', () => {
    const start = EMPTY_TICKBASE(0, era);
    const p = new PredictedTickbase(era, start);
    const intents = Array.from({ length: 40 }, () => NONE);
    intents.forEach((intent, i) => p.apply(i + 1, intent));
    p.reconcile(serverRun(start, intents), 40);
    assert.equal(p.mismatches, 0);
  });

  it('bounds the unacked buffer', () => {
    const p = new PredictedTickbase(era, EMPTY_TICKBASE(0, era));
    for (let i = 1; i <= 500; i++) p.apply(i, NONE);
    assert.ok(p.pendingCount <= 128);
  });

  it('first reconcile without prior prediction is not a mismatch', () => {
    const p = new PredictedTickbase(era);
    p.reconcile({ tickbase: 50, bank: 4, choked: 0, ticksSinceShift: 3 }, 7);
    assert.equal(p.mismatches, 0);
    assert.equal(p.state.tickbase, 50);
  });
});
