import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LATE_CSGO, type ShotVerdict, type TickbaseState } from '@game/shared/hvh/v2';
import { HitLog } from '../../src/ui/hvh/HitLog';
import { Indicators, indicatorModel, initHvhV2Ui } from '../../src/ui/hvh/Indicators';

describe('indicatorModel', () => {
  const era = LATE_CSGO;
  const state = (charge: number, choked = 0): TickbaseState => ({ tickbase: 100, charge, choked, armed: true });

  it('a full charge is "ready" for the exploit that is on', () => {
    assert.deepEqual(indicatorModel(state(era.chargeTicks), { dt: true, hs: false }, era), { dt: 'ready', hs: 'off', choke: 0 });
    assert.deepEqual(indicatorModel(state(era.chargeTicks), { dt: false, hs: true }, era), { dt: 'off', hs: 'ready', choke: 0 });
  });

  it('a partial or empty charge is "charging"', () => {
    for (const charge of [0, 1, era.chargeTicks - 1]) {
      assert.equal(indicatorModel(state(charge), { dt: true, hs: false }, era).dt, 'charging', `charge ${charge}`);
      assert.equal(indicatorModel(state(charge), { dt: false, hs: true }, era).hs, 'charging', `charge ${charge}`);
    }
  });

  it('an exploit that is off shows "off", even with a full charge', () => {
    assert.deepEqual(indicatorModel(state(era.chargeTicks), { dt: false, hs: false }, era), { dt: 'off', hs: 'off', choke: 0 });
  });

  it('choke shows the choked commands', () => {
    assert.equal(indicatorModel(state(0, 14), { dt: false, hs: false }, era).choke, 14);
  });

  it('there is no defensive indicator (defensive is an anti-aim pattern, not a tickbase shift)', () => {
    assert.equal('defensive' in indicatorModel(state(era.chargeTicks), { dt: true, hs: false }, era), false);
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
