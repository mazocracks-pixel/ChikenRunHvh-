import type { ShotVerdict } from './shot';
import type { TickbaseReject } from './tickbase';

/*
 * Hit-log copy for every VerdictCause. Damage and remaining HP are rounded to integers for
 * display (GameRoom rounds damage the same way, Math.round); the verdict keeps exact values.
 * Missing fields render as '?' so a malformed verdict still produces a line.
 */

const TICKBASE_REASONS: Record<TickbaseReject, string> = {
  dtNotCharged: 'double tap not charged',
  hsNotCharged: 'hide shots not charged',
  defensiveNotCharged: 'defensive not charged',
  chokeTooHigh: 'choke too high',
};

/** The `reason` to put on a 'tickbase' verdict built from a tickbase reject. */
export function tickbaseVerdictReason(reject: TickbaseReject): string {
  return TICKBASE_REASONS[reject];
}

function int(n: number | undefined): string {
  return n === undefined || !Number.isFinite(n) ? '?' : String(Math.round(n));
}

export function formatVerdict(v: ShotVerdict, nameOf: (id: string) => string): string {
  switch (v.cause) {
    case 'hit':
      return `Hit ${v.targetId === undefined ? '?' : nameOf(v.targetId)} in the ${v.hitgroup ?? '?'} for ${int(v.damage)} (${int(v.remainingHp)} remaining)`;
    case 'resolver':
      return `Missed shot due to resolver (guessed ${v.guessed ?? '?'}, real ${v.real ?? '?'})`;
    case 'spread':
      return 'Missed shot due to spread';
    case 'invalidRecord':
      return `Missed shot: target record invalid (${v.invalidCause ?? '?'})`;
    case 'obstruction':
      return `Missed shot: blocked by ${v.material ?? '?'}`;
    case 'tickbase':
      return `Shot not fired: ${v.reason ?? '?'}`;
    case 'rejected':
      return `Shot rejected: ${v.reason ?? '?'}`;
    default: {
      const unreachable: never = v.cause;
      return unreachable;
    }
  }
}
