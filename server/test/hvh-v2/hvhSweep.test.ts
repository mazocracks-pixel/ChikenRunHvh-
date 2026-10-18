/*
 * Task 14: the balance sweep's rule (checkBalance) on synthetic matrices, and a tiny determinism
 * check of runSweep (two configs, a few rounds). The full and quick sweeps run through
 * `npm run sweep` / `npm run sweep:quick`, never in `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cellSE, checkBalance, classifyCounters, fieldSE, runSweep, threeCycles, type SweepConfig, type WinMatrix } from '../../../tools/hvh-sweep';

/** rate[i][j] for i < j from `upper`; rate[j][i] = 1 - rate[i][j]; the diagonal is unused (NaN). */
function matrix(configs: string[], upper: Record<string, number>, rounds = 10): WinMatrix {
  const n = configs.length;
  const rate = configs.map(() => configs.map(() => Number.NaN));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = upper[`${configs[i]}>${configs[j]}`];
      assert.ok(r !== undefined, `pair ${configs[i]} vs ${configs[j]} given`);
      rate[i]![j] = r;
      rate[j]![i] = 1 - r;
    }
  }
  return { configs, rate, rounds: configs.map(() => configs.map(() => rounds)) };
}

describe('checkBalance', () => {
  it('flags a config that wins 0.70 against the field as dominant', () => {
    // A beats B and C 0.70 each (field rate 0.70); B and C split 0.50.
    const m = matrix(['A', 'B', 'C'], { 'A>B': 0.7, 'A>C': 0.7, 'B>C': 0.5 });
    const r = checkBalance(m);
    assert.equal(r.ok, false);
    assert.deepEqual(r.dominant, ['A']);
    // Nobody beats A by 0.55, so A is also uncountered; B and C are countered by A.
    assert.deepEqual(r.uncountered, ['A']);
  });

  it('flags a config nobody beats by at least 0.55 as uncountered, even when it is not dominant', () => {
    // Rock-paper-scissors among A, B, C (each 0.60 over the next), plus D that every config beats
    // only 0.52 (D's best opponent wins 0.52 < 0.55) while D loses on average (field rate 0.48).
    const m = matrix(['A', 'B', 'C', 'D'], {
      'A>B': 0.6, 'B>C': 0.6, 'A>C': 0.4, // C beats A 0.60
      'A>D': 0.52, 'B>D': 0.52, 'C>D': 0.52,
    });
    const r = checkBalance(m);
    assert.equal(r.ok, false);
    assert.deepEqual(r.dominant, []);
    assert.deepEqual(r.uncountered, ['D']);
  });

  it('a counter at exactly 0.55 counts; a field rate of exactly 0.55 is not dominant', () => {
    const m = matrix(['A', 'B', 'C'], { 'A>B': 0.45, 'A>C': 0.65, 'B>C': 0.45 });
    // Field: A (0.45 + 0.65) / 2 = 0.55; B (0.55 + 0.45) / 2 = 0.50; C (0.35 + 0.55) / 2 = 0.45.
    // Counters: A by B (0.55), B by C (0.55), C by A (0.65).
    const r = checkBalance(m);
    assert.deepEqual(r, { ok: true, dominant: [], uncountered: [] });
  });

  it('a balanced matrix (a cycle of counters, every field rate 0.50) is ok', () => {
    const m = matrix(['A', 'B', 'C'], { 'A>B': 0.6, 'B>C': 0.6, 'A>C': 0.4 });
    assert.deepEqual(checkBalance(m), { ok: true, dominant: [], uncountered: [] });
  });

  it('ignores the diagonal (mirror matches are excluded)', () => {
    const m = matrix(['A', 'B', 'C'], { 'A>B': 0.6, 'B>C': 0.6, 'A>C': 0.4 });
    m.rate[0]![0] = 1;
    m.rate[1]![1] = 0;
    assert.deepEqual(checkBalance(m), { ok: true, dominant: [], uncountered: [] });
  });
});

describe('report statistics', () => {
  it('cellSE is the binomial SE; fieldSE combines the cells', () => {
    const m = matrix(['A', 'B', 'C'], { 'A>B': 0.6, 'B>C': 0.6, 'A>C': 0.4 }, 100);
    assert.ok(Math.abs(cellSE(m, 0, 1) - Math.sqrt(0.24 / 100)) < 1e-12);
    assert.ok(Math.abs(fieldSE(m, 0) - Math.sqrt(2 * 0.24 / 100) / 2) < 1e-12);
  });

  it('classifies counters with a 1 SE margin around 0.55', () => {
    // 100 rounds, SE about 0.05. Best counters: A <- B 0.62 (>= 0.55 + 0.049: countered);
    // B <- C 0.52 (within 0.55 +- 0.050: inconclusive); C <- B 0.48 (< 0.55 - 0.050: uncountered).
    const m = matrix(['A', 'B', 'C'], { 'A>B': 0.38, 'A>C': 0.4, 'B>C': 0.48 }, 100);
    assert.deepEqual(classifyCounters(m), { countered: ['A'], uncountered: ['C'], inconclusive: ['B'] });
  });

  it('counts 3-cycles at >= 0.55 (none in a transitive matrix)', () => {
    assert.equal(threeCycles(matrix(['A', 'B', 'C'], { 'A>B': 0.6, 'B>C': 0.6, 'A>C': 0.4 })), 1);
    assert.equal(threeCycles(matrix(['A', 'B', 'C'], { 'A>B': 0.6, 'B>C': 0.6, 'A>C': 0.7 })), 0);
  });
});

describe('runSweep determinism', () => {
  const grid: SweepConfig[] = [
    { base: 'backward', jitter: 0, exploit: 'dt' },
    { base: 'spin', jitter: 45, exploit: 'defensive' },
  ];

  it('the same seed gives the same WinMatrix; the matrix is complementary', () => {
    const a = runSweep(grid, 8, 0x14);
    const b = runSweep(grid, 8, 0x14);
    assert.deepStrictEqual(b, a);
    assert.deepEqual(a.configs, ['backward/j0/dt', 'spin/j45/defensive']);
    assert.equal(a.rounds[0]![1], 8);
    assert.ok(a.rate[0]![1]! >= 0 && a.rate[0]![1]! <= 1);
    assert.equal(a.rate[0]![1]! + a.rate[1]![0]!, 1);
    assert.notDeepStrictEqual(runSweep(grid, 8, 0x15), a, 'a different seed changes the matrix');
  });
});
