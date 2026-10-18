import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LATE_CSGO, type TickbaseState } from '@game/shared/hvh/v2';
import { indicatorModel } from '../../src/ui/hvh/Indicators';

describe('indicatorModel', () => {
  const era = LATE_CSGO;

  it('bank 14 → dt "ready"', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: 14,
      choked: 0,
      ticksSinceShift: 16,
    };
    const toggles = { dt: true, hs: false };
    const res = indicatorModel(s, toggles, era);
    assert.equal(res.dt, 'ready');
    assert.equal(res.hs, 'off');
    assert.equal(res.choke, 0);
    assert.equal(res.defensive, true);
  });

  it('bank 6 → "charging"', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: 6,
      choked: 0,
      ticksSinceShift: 16,
    };
    const toggles = { dt: true, hs: false };
    const res = indicatorModel(s, toggles, era);
    assert.equal(res.dt, 'charging');
    assert.equal(res.hs, 'off');
    assert.equal(res.choke, 0);
    assert.equal(res.defensive, false);
  });

  it('ticksSinceShift < rechargeDelayTicks → "cooldown"', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: 14,
      choked: 0,
      ticksSinceShift: 10,
    };
    const toggles = { dt: true, hs: false };
    const res = indicatorModel(s, toggles, era);
    assert.equal(res.dt, 'cooldown');
  });

  it('choked 14 with bank 14 → dt "charging" (budget 2) and choke 14', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: 14,
      choked: 14,
      ticksSinceShift: 16,
    };
    const toggles = { dt: true, hs: false };
    const res = indicatorModel(s, toggles, era);
    assert.equal(res.dt, 'charging');
    assert.equal(res.choke, 14);
    assert.equal(res.defensive, false);
  });

  it('dt is "off" when toggles.dt is false even if bank is full', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: 14,
      choked: 0,
      ticksSinceShift: 16,
    };
    const toggles = { dt: false, hs: false };
    const res = indicatorModel(s, toggles, era);
    assert.equal(res.dt, 'off');
  });

  it('hs is "on" when toggles.hs is true, "off" when false', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: 0,
      choked: 0,
      ticksSinceShift: 16,
    };
    assert.equal(indicatorModel(s, { dt: false, hs: true }, era).hs, 'on');
    assert.equal(indicatorModel(s, { dt: false, hs: false }, era).hs, 'off');
  });

  it('defensive is true when shiftBudget >= era.defensiveShift', () => {
    const s: TickbaseState = {
      tickbase: 100,
      bank: era.defensiveShift,
      choked: 0,
      ticksSinceShift: 16,
    };
    assert.equal(indicatorModel(s, { dt: false, hs: false }, era).defensive, true);
  });
});
