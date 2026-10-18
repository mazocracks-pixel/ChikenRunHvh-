import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_TICKBASE, LATE_CSGO, stepTickbase, type CommandIntent, type TickbaseState } from '@game/shared/hvh/v2';
import { CommandChoker } from '@game/shared';
import { PredictedTickbase, TickClock, commandIntent, shotReference } from '../../src/hvh/PredictedTickbase';

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

  it('a dropped command (seq gap) leaves no mismatch', () => {
    const start = EMPTY_TICKBASE(0, era);
    const p = new PredictedTickbase(era, start);
    const seqs = [1, 2, 4, 5, 6]; // 3 lost in the network, never emitted
    const executed = seqs.map((q) => script[q - 1]!);
    seqs.forEach((q) => p.apply(q, script[q - 1]!));
    p.reconcile(serverRun(start, executed), 6);
    assert.equal(p.mismatches, 0);
  });

  it('a reordered batch leaves no mismatch', () => {
    const start = EMPTY_TICKBASE(0, era);
    const p = new PredictedTickbase(era, start);
    const emitted = [1, 2, 5, 6, 3, 4, 7]; // 3,4 arrive late: the server drops them
    const applied = emitted.filter((q) => p.apply(q, script[q - 1]!));
    assert.deepEqual(applied, [1, 2, 5, 6, 7]);
    p.reconcile(serverRun(start, applied.map((q) => script[q - 1]!)), 7);
    assert.equal(p.mismatches, 0);
  });

  it('choke bits follow the actual CommandChoker batches', () => {
    const choker = new CommandChoker();
    const N = 3;
    const bits: boolean[] = [];
    const batches: number[] = [];
    for (let seq = 1; seq <= 8; seq++) {
      const held = choker.wouldHold(N, false);
      bits.push(commandIntent({ seq, shotSeq: null, hitscan: true, held, exploit: 'off' }).choke);
      batches.push(choker.push({ seq } as never, N, false).length);
    }
    assert.deepEqual(bits, [true, true, true, false, true, true, true, false]);
    assert.deepEqual(batches, [0, 0, 0, 4, 0, 0, 0, 4]);
  });

  it('holding fire without a shot sets no fire intent; the shot command does', () => {
    const held = Array.from({ length: 10 }, (_, i) => commandIntent({ seq: i + 1, shotSeq: null, hitscan: true, held: false, exploit: 'doubleTap' }));
    assert.ok(held.every((i) => !i.fire));
    const shot = commandIntent({ seq: 4, shotSeq: 4, hitscan: true, held: true, exploit: 'doubleTap' });
    assert.equal(shot.fire, true);
    assert.equal(shot.choke, false);
    assert.equal(commandIntent({ seq: 4, shotSeq: 4, hitscan: false, held: false, exploit: 'off' }).fire, false);
  });

  it('clientTick lags the latest server tick by about the interpolation delay', () => {
    const clock = new TickClock(64);
    clock.sample(1000, 50_000);
    const now = 50_000;
    assert.equal(clock.viewedTick(now - 100), 993, 'floor(-6.4) ticks back');
    assert.equal(clock.viewedTick(now), 1000);
    assert.equal(clock.viewedTick(now + 1000 / 64 * 10 - 100), 1003);
  });

  it('legacy: fire references server.ack, no shot command, and a shot does not flush', () => {
    assert.deepEqual(shotReference(false, 50, 44), { command: 44, shotSeq: null });
    const choker = new CommandChoker();
    const out = [1, 2].map((seq) => choker.push({ seq } as never, 3, false).length); // fakeLagBreakOnShot off: flush=false
    assert.deepEqual(out, [0, 0]);
  });

  it('v2 with break-on-shot off: a shot during choke stays held and carries intent.fire when released', () => {
    const choker = new CommandChoker();
    const ref = shotReference(true, 2, 0);
    assert.deepEqual(ref, { command: 2, shotSeq: 2 });
    const sent: { seq: number; fire: boolean }[][] = [];
    for (let seq = 1; seq <= 4; seq++) {
      const held = choker.wouldHold(3, false);
      const intent = commandIntent({ seq, shotSeq: ref.shotSeq, hitscan: true, held, exploit: 'off' });
      const batch = choker.push({ seq, intent } as never, 3, false) as unknown as { seq: number; intent: CommandIntent }[];
      if (seq === 2) assert.equal(batch.length, 0, 'shot frame stays held');
      if (batch.length) sent.push(batch.map((c) => ({ seq: c.seq, fire: c.intent.fire })));
    }
    assert.deepEqual(sent, [[{ seq: 1, fire: false }, { seq: 2, fire: true }, { seq: 3, fire: false }, { seq: 4, fire: false }]]);
  });
});
