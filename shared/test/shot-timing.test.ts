import test from 'node:test';
import assert from 'node:assert/strict';
import { shotRecordUsable } from '../src';

test('assisted fire reserves arrival time and two server ticks before record expiry', () => {
  assert.equal(shotRecordUsable(1000, 1240, 40), true);
  assert.equal(shotRecordUsable(1000, 1240, 80), false);
  assert.equal(shotRecordUsable(1000, 1270), false);
  assert.equal(shotRecordUsable(1020, 1000), false);
  assert.equal(shotRecordUsable(NaN, 1000), false);
});
