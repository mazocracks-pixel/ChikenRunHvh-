import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LATE_CSGO } from '../../src/hvh/v2/era';
import {
  type CommandIntent,
  type TickbaseState,
  EMPTY_TICKBASE,
  shiftBudget,
  stepTickbase,
} from '../../src/hvh/v2/tickbase';

const IDLE: CommandIntent = {
  fire: false,
  choke: false,
  doubleTap: false,
  hideShots: false,
  defensive: false,
};

function state(partial: Partial<TickbaseState>): TickbaseState {
  return { ...EMPTY_TICKBASE(100), ...partial };
}

describe('Tickbase (v2)', () => {
  it('EMPTY_TICKBASE starts with no bank, no choke, recharge delay elapsed', () => {
    assert.deepEqual(EMPTY_TICKBASE(7), {
      tickbase: 7,
      bank: 0,
      choked: 0,
      ticksSinceShift: 16,
    });
  });

  it('shiftBudget = max(0, min(bank, maxProcessTicks - choked))', () => {
    assert.equal(shiftBudget(state({ bank: 14, choked: 0 }), LATE_CSGO), 14);
    assert.equal(shiftBudget(state({ bank: 14, choked: 4 }), LATE_CSGO), 12);
    assert.equal(shiftBudget(state({ bank: 14, choked: 14 }), LATE_CSGO), 2);
    assert.equal(shiftBudget(state({ bank: 5, choked: 0 }), LATE_CSGO), 5);
  });

  it('banks to full', () => {
    let s = EMPTY_TICKBASE(0);
    for (let i = 0; i < 16 + 14; i++) {
      s = stepTickbase(s, IDLE, LATE_CSGO).next;
    }
    assert.equal(s.bank, 14);
    const r = stepTickbase(s, IDLE, LATE_CSGO);
    assert.equal(r.next.bank, 14);
  });

  it('dt shifts 14', () => {
    const s = state({ bank: 14 });
    const r = stepTickbase(s, { ...IDLE, fire: true, doubleTap: true }, LATE_CSGO);
    assert.deepEqual(r.action, { kind: 'shift', ticks: 14, reason: 'doubleTap' });
    assert.equal(r.next.bank, 0);
    assert.equal(r.next.ticksSinceShift, 0);
    assert.equal(r.next.tickbase, s.tickbase + 1 + 14);
  });

  it('dt rejected when choke eats budget', () => {
    const s = state({ bank: 14, choked: 14 });
    const r = stepTickbase(s, { ...IDLE, fire: true, doubleTap: true }, LATE_CSGO);
    assert.deepEqual(r.action, { kind: 'reject', reason: 'chokeTooHigh' });
    assert.equal(r.next.bank, 14);
  });

  it('dt not charged', () => {
    const s = state({ bank: 6 });
    const r = stepTickbase(s, { ...IDLE, fire: true, doubleTap: true }, LATE_CSGO);
    assert.deepEqual(r.action, { kind: 'reject', reason: 'dtNotCharged' });
    assert.equal(r.next.bank, 6);
  });

  it('choke caps at 14', () => {
    let s = EMPTY_TICKBASE(0);
    const choke: CommandIntent = { ...IDLE, choke: true };
    for (let i = 1; i <= 20; i++) {
      const r = stepTickbase(s, choke, LATE_CSGO);
      s = r.next;
      assert.ok(s.choked <= 14, `choked ${s.choked} at tick ${i}`);
      if (i === 15) assert.deepEqual(r.action, { kind: 'run' });
    }
  });

  it('no recharge while firing', () => {
    let s = EMPTY_TICKBASE(0);
    for (let i = 0; i < 40; i++) {
      s = stepTickbase(s, { ...IDLE, fire: true }, LATE_CSGO).next;
      assert.equal(s.bank, 0);
    }
  });

  it('hide shots and defensive reject with their own reasons', () => {
    const s = state({ bank: 2 });
    assert.deepEqual(
      stepTickbase(s, { ...IDLE, fire: true, hideShots: true }, LATE_CSGO).action,
      { kind: 'reject', reason: 'hsNotCharged' },
    );
    assert.deepEqual(stepTickbase(s, { ...IDLE, defensive: true }, LATE_CSGO).action, {
      kind: 'reject',
      reason: 'defensiveNotCharged',
    });
  });

  it('defensive takes priority and fires without intent.fire; only dt advances tickbase extra', () => {
    const s = state({ bank: 14 });
    const all: CommandIntent = { fire: true, choke: false, doubleTap: true, hideShots: true, defensive: true };
    const r = stepTickbase(s, all, LATE_CSGO);
    assert.deepEqual(r.action, { kind: 'shift', ticks: 12, reason: 'defensive' });
    assert.equal(r.next.bank, 2);
    assert.equal(r.next.tickbase, s.tickbase + 1);
    const d = stepTickbase(s, { ...IDLE, defensive: true }, LATE_CSGO);
    assert.deepEqual(d.action, { kind: 'shift', ticks: 12, reason: 'defensive' });
  });

  it('dt toggled on but not firing is a normal tick and can bank', () => {
    const s = state({ bank: 3 });
    const r = stepTickbase(s, { ...IDLE, doubleTap: true }, LATE_CSGO);
    assert.deepEqual(r.action, { kind: 'bank' });
    assert.equal(r.next.bank, 4);
  });

  it('no banking until rechargeDelayTicks after a shift', () => {
    let s = stepTickbase(state({ bank: 14 }), { ...IDLE, fire: true, doubleTap: true }, LATE_CSGO).next;
    for (let i = 0; i < 16; i++) {
      const r = stepTickbase(s, IDLE, LATE_CSGO);
      assert.deepEqual(r.action, { kind: 'run' });
      s = r.next;
    }
    assert.deepEqual(stepTickbase(s, IDLE, LATE_CSGO).action, { kind: 'bank' });
  });

  it('is pure: does not mutate input state', () => {
    const s = Object.freeze(state({ bank: 14, choked: 3 }));
    stepTickbase(s, { ...IDLE, fire: true, doubleTap: true }, LATE_CSGO);
    stepTickbase(s, { ...IDLE, choke: true }, LATE_CSGO);
    assert.equal(s.bank, 14);
  });
});
