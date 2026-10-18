import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatVerdict, tickbaseVerdictReason } from '../../src/hvh/v2/hitlog';
import type { VerdictCause } from '../../src/hvh/v2/resolver';
import type { ShotVerdict } from '../../src/hvh/v2/shot';
import type { TickbaseReject } from '../../src/hvh/v2/tickbase';

const names: Record<string, string> = { t1: 'Bob' };
const nameOf = (id: string): string => names[id] ?? id;
const base = { shooterId: 's1', targetId: 't1', tick: 100, bullet: 1 as const };

// A Record keyed by VerdictCause: adding a cause without a case here fails compilation.
const CASES: Record<VerdictCause, [ShotVerdict, string]> = {
  hit: [
    { ...base, cause: 'hit', damage: 38.4, hitgroup: 'chest', remainingHp: 61.6, guessed: 'left', real: 'left' },
    'Hit Bob in the chest for 38 (62 remaining)',
  ],
  resolver: [
    { ...base, cause: 'resolver', guessed: 'right', real: 'left' },
    'Missed shot due to resolver (guessed right, real left)',
  ],
  spread: [{ ...base, cause: 'spread', guessed: 'left', real: 'left' }, 'Missed shot due to spread'],
  invalidRecord: [
    { ...base, cause: 'invalidRecord', invalidCause: 'expired' },
    'Missed shot: target record invalid (expired)',
  ],
  obstruction: [{ ...base, cause: 'obstruction', material: 'concrete' }, 'Missed shot: blocked by concrete'],
  tickbase: [
    { ...base, cause: 'tickbase', reason: tickbaseVerdictReason('dtNotCharged') },
    'Shot not fired: double tap not charged',
  ],
  rejected: [{ ...base, cause: 'rejected', reason: 'fire interval' }, 'Shot rejected: fire interval'],
};

describe('Hit log text (v2)', () => {
  it('hitlog covers every cause', () => {
    for (const [cause, [verdict, text]] of Object.entries(CASES)) {
      assert.equal(verdict.cause, cause);
      assert.equal(formatVerdict(verdict, nameOf), text);
    }
  });

  it('tickbase reasons use the exact copy', () => {
    const expected: Record<TickbaseReject, string> = {
      dtNotCharged: 'double tap not charged',
      hsNotCharged: 'hide shots not charged',
      defensiveNotCharged: 'defensive not charged',
      chokeTooHigh: 'choke too high',
    };
    for (const [reject, reason] of Object.entries(expected) as [TickbaseReject, string][]) {
      assert.equal(tickbaseVerdictReason(reject), reason);
      assert.equal(
        formatVerdict({ ...base, cause: 'tickbase', reason: tickbaseVerdictReason(reject) }, nameOf),
        `Shot not fired: ${reason}`,
      );
    }
  });

  it('hit with zero remaining and target name lookup', () => {
    const v: ShotVerdict = { ...base, cause: 'hit', damage: 115.2, hitgroup: 'head', remainingHp: 0 };
    assert.equal(formatVerdict(v, nameOf), 'Hit Bob in the head for 115 (0 remaining)');
  });
});
