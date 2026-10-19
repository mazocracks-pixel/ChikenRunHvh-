import type { EraTable } from './era';

export interface TickbaseState {
  tickbase: number;
  /** Stored charge, 0..era.chargeTicks. */
  charge: number;
  choked: number;
  /** DT or hide shots was on last tick (a turn-off with full charge releases a burst). */
  armed: boolean;
}

export const EMPTY_TICKBASE = (tick: number): TickbaseState => ({
  tickbase: tick,
  charge: 0,
  choked: 0,
  armed: false,
});

export interface CommandIntent {
  fire: boolean;
  choke: boolean;
  doubleTap: boolean;
  hideShots: boolean;
}

export type TickbaseReject = 'dtNotCharged' | 'hsNotCharged';

export type BurstReason = 'doubleTap' | 'hideShots' | 'release';

export interface TickContext {
  /** An enemy is in actual line of sight (not the HvH wallhack). */
  enemyVisible: boolean;
}

export type TickAction =
  | { kind: 'run' }
  | { kind: 'choke' }
  /** The charging stop: the command sends but runs no movement, and tickbase does not advance. */
  | { kind: 'charge' }
  /** An enemy came into view mid-charge: the partial charge is lost and the command runs normally. */
  | { kind: 'cancel' }
  /**
   * Spend the whole charge. The command runs its own normal movement step plus `ticks` extra steps
   * in a row (1 + chargeTicks in all), matching `tickbase += 1 + ticks`. On a shot, the bullets
   * leave from the pre-burst position.
   */
  | { kind: 'burst'; ticks: number; reason: BurstReason }
  /** Shot with DT or hide shots on but not fully charged: the command still runs as a plain shot. */
  | { kind: 'reject'; reason: TickbaseReject };

// Pure and deterministic: same (s, intent, era, ctx) always yields the same result; inputs are never mutated.
// Rules in priority order (exploit = doubleTap || hideShots):
//   1. exploit and fire with full charge -> burst (doubleTap over hideShots).
//   2. exploit and fire with less than full -> reject; the charge is lost.
//   3. armed last tick, exploit now off, full charge -> burst 'release'.
//   4. exploit, below full, no enemy visible, not firing -> charge (+1; choke is ignored, tickbase holds).
//   5. exploit, partial charge (0 < charge < full), enemy visible -> cancel; the charge is lost.
//   6. intent.choke under maxChoke -> choke.
//   7. otherwise run.
// A full charge is kept while an enemy is visible; only a burst spends it. With the exploit off and
// no release, any charge is dropped. Any tick that is not 'choke' flushes choked to 0. tickbase
// advances +1 on run/choke/cancel/reject, +1 + ticks on a burst, and not at all on a charge tick.
export function stepTickbase(
  s: TickbaseState,
  intent: CommandIntent,
  era: EraTable,
  ctx: TickContext,
): { next: TickbaseState; action: TickAction } {
  const exploit = intent.doubleTap || intent.hideShots;
  const full = s.charge >= era.chargeTicks;
  const ran: TickbaseState = { tickbase: s.tickbase + 1, charge: s.charge, choked: 0, armed: exploit };
  const burst = (reason: BurstReason) => ({
    next: { ...ran, tickbase: s.tickbase + 1 + era.chargeTicks, charge: 0 },
    action: { kind: 'burst', ticks: era.chargeTicks, reason } as const,
  });

  if (exploit && intent.fire) {
    if (full) return burst(intent.doubleTap ? 'doubleTap' : 'hideShots');
    return {
      next: { ...ran, charge: 0 },
      action: { kind: 'reject', reason: intent.doubleTap ? 'dtNotCharged' : 'hsNotCharged' },
    };
  }

  if (!exploit) {
    if (s.armed && full) return burst('release');
    ran.charge = 0;
  } else if (!full && !ctx.enemyVisible) {
    return { next: { ...ran, tickbase: s.tickbase, charge: s.charge + 1 }, action: { kind: 'charge' } };
  } else if (!full && s.charge > 0) {
    return { next: { ...ran, charge: 0 }, action: { kind: 'cancel' } };
  }

  if (intent.choke && s.choked < era.maxChoke) {
    return { next: { ...ran, choked: s.choked + 1 }, action: { kind: 'choke' } };
  }

  return { next: ran, action: { kind: 'run' } };
}
