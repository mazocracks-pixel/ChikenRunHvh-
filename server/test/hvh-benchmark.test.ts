import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runHvhBenchmark } from '../src/tools/hvhBenchmark';
it('runs 1,000 deterministic adversarial bot duels and resolving beats the center-only controller', () => {
  const result = runHvhBenchmark(1000);
  assert.equal(result.duels, 1000);
  assert.ok(result.adaptive.wins > 700);
  assert.ok(result.adaptive.accuracy > result.centerOnly.accuracy * 1.5);
  assert.ok(result.adaptive.resolverMisses > 0, 'estimation stays imperfect');
  assert.deepEqual(runHvhBenchmark(10, 45), runHvhBenchmark(10, 45));
});
