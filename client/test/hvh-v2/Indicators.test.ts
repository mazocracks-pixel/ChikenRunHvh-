import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LATE_CSGO, type ShotVerdict, type TickbaseState } from '@game/shared/hvh/v2';
import { HitLog } from '../../src/ui/hvh/HitLog';
import { Indicators, indicatorModel, initHvhV2Ui } from '../../src/ui/hvh/Indicators';

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

describe('initHvhV2Ui gating', () => {
  it('legacy room (no hvhState) creates nothing and registers no listener', () => {
    const target: { hitLog: HitLog | null; indicators: Indicators | null } = {
      hitLog: null,
      indicators: null,
    };
    let createdCount = 0;
    let registeredCount = 0;
    const create = () => {
      createdCount++;
      return {
        hitLog: new HitLog((id) => id, { now: () => 0 }),
        indicators: new Indicators(),
      };
    };
    const register = () => {
      registeredCount++;
    };

    // Mirror of the GameSession hvhState handler: only v2 rooms call initHvhV2Ui.
    const onHvhState = (hvhV2: boolean) => {
      if (hvhV2) initHvhV2Ui(target, create, register);
    };
    // Legacy HvH room: hvhState arrives but hvhV2 is false; non-HvH rooms get no event at all.
    onHvhState(false);
    onHvhState(false);
    assert.equal(target.hitLog, null);
    assert.equal(target.indicators, null);
    assert.equal(createdCount, 0);
    assert.equal(registeredCount, 0);
  });

  it('first v2 hvhState creates exactly one of each and registers shotVerdict', () => {
    const target: { hitLog: HitLog | null; indicators: Indicators | null } = {
      hitLog: null,
      indicators: null,
    };
    let createdCount = 0;
    let registeredHandler: ((v: ShotVerdict) => void) | null = null;
    const create = () => {
      createdCount++;
      return {
        hitLog: new HitLog((id) => id, { now: () => 0 }),
        indicators: new Indicators(),
      };
    };
    const register = (handler: (v: ShotVerdict) => void) => {
      registeredHandler = handler;
    };

    // First hvhState arrives: creates exactly one of each
    const firstResult = initHvhV2Ui(target, create, register);
    assert.equal(firstResult, true);
    assert.equal(createdCount, 1);
    assert.notEqual(target.hitLog, null);
    assert.notEqual(target.indicators, null);
    assert.notEqual(registeredHandler, null);

    // Second hvhState arrives: does not create again
    const secondResult = initHvhV2Ui(target, create, register);
    assert.equal(secondResult, false);
    assert.equal(createdCount, 1);

    // shotVerdict arrives and routes to hitLog
    registeredHandler!({
      shooterId: 'me',
      targetId: 'enemy',
      tick: 50,
      bullet: 1,
      cause: 'spread',
    });
    assert.equal(target.hitLog?.lines.length, 1);
    assert.equal(target.hitLog?.lines[0], 'Missed shot due to spread');
  });
});
