import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type EraTable,
  LATE_CSGO,
  validateEra,
  lagCompWindowTicks,
} from '../../src/hvh/v2/era';

describe('Era table and validation (v2)', () => {
  it('defines LATE_CSGO with verbatim era values from global constraints', () => {
    assert.equal(LATE_CSGO.id, 'late-csgo');
    assert.equal(LATE_CSGO.tickRate, 64);
    assert.equal(LATE_CSGO.maxProcessTicks, 16);
    assert.equal(LATE_CSGO.doubleTapShift, 14);
    assert.deepEqual([...LATE_CSGO.doubleTapShiftOptions], [12, 14, 16]);
    assert.equal(LATE_CSGO.maxChoke, 14);
    assert.equal(LATE_CSGO.lagCompWindowMs, 200);
    assert.equal(LATE_CSGO.maxDesyncDeg, 58);
    assert.equal(LATE_CSGO.desyncRunFalloff, 0.5);
    assert.equal(LATE_CSGO.lagCompBreakHulls, 2);
    assert.equal(LATE_CSGO.hideShotsShift, 8);
    assert.equal(LATE_CSGO.defensiveShift, 12);
    assert.equal(LATE_CSGO.rechargeDelayTicks, 16);
  });

  it('validates LATE_CSGO cleanly with no errors', () => {
    const errors = validateEra(LATE_CSGO);
    assert.deepEqual(errors, []);
  });

  it('computes lag compensation window ticks correctly', () => {
    assert.equal(lagCompWindowTicks(LATE_CSGO), 12);
    const custom: EraTable = {
      ...LATE_CSGO,
      lagCompWindowMs: 250,
    };
    assert.equal(lagCompWindowTicks(custom), 16);
  });

  it('reports error when maxChoke exceeds maxProcessTicks', () => {
    const table: EraTable = {
      ...LATE_CSGO,
      maxChoke: 17,
    };
    const errors = validateEra(table);
    assert.ok(errors.includes('maxChoke exceeds maxProcessTicks'));
  });

  it('reports error when doubleTapShift exceeds maxProcessTicks', () => {
    const table: EraTable = {
      ...LATE_CSGO,
      doubleTapShift: 17,
      doubleTapShiftOptions: [12, 14, 17],
    };
    const errors = validateEra(table);
    assert.ok(errors.includes('doubleTapShift exceeds maxProcessTicks'));
  });

  it('reports error when desyncRunFalloff is out of range [0,1]', () => {
    const tableHigh: EraTable = {
      ...LATE_CSGO,
      desyncRunFalloff: 1.2,
    };
    const errorsHigh = validateEra(tableHigh);
    assert.ok(errorsHigh.includes('desyncRunFalloff out of range [0,1]'));

    const tableLow: EraTable = {
      ...LATE_CSGO,
      desyncRunFalloff: -0.1,
    };
    const errorsLow = validateEra(tableLow);
    assert.ok(errorsLow.includes('desyncRunFalloff out of range [0,1]'));
  });

  it('reports error when hideShotsShift exceeds doubleTapShift', () => {
    const table: EraTable = {
      ...LATE_CSGO,
      hideShotsShift: 15,
    };
    const errors = validateEra(table);
    assert.ok(errors.includes('hideShotsShift exceeds doubleTapShift'));
  });

  it('reports error when defensiveShift exceeds doubleTapShift', () => {
    const table: EraTable = {
      ...LATE_CSGO,
      defensiveShift: 15,
    };
    const errors = validateEra(table);
    assert.ok(errors.includes('defensiveShift exceeds doubleTapShift'));
  });

  it('reports error when doubleTapShift is not in doubleTapShiftOptions', () => {
    const table: EraTable = {
      ...LATE_CSGO,
      doubleTapShift: 10,
      doubleTapShiftOptions: [12, 14, 16],
    };
    const errors = validateEra(table);
    assert.ok(errors.includes('doubleTapShift not in doubleTapShiftOptions'));
  });
});

describe('validateEra NaN hardening', () => {
  for (const field of ['maxProcessTicks', 'maxChoke', 'doubleTapShift', 'desyncRunFalloff', 'hideShotsShift', 'defensiveShift'] as const) {
    it(`reports an error when ${field} is NaN`, () => {
      const table = { ...LATE_CSGO, [field]: Number.NaN } as EraTable;
      assert.ok(validateEra(table).length > 0, `${field}: NaN must not validate`);
    });
  }
});
