import { type EraTable, LATE_CSGO } from './era';

export interface TickbaseState {
  tickbase: number;
  bank: number;
  choked: number;
  ticksSinceShift: number;
}

export const EMPTY_TICKBASE = (tick: number, era: EraTable = LATE_CSGO): TickbaseState => ({
  tickbase: tick,
  bank: 0,
  choked: 0,
  ticksSinceShift: era.rechargeDelayTicks,
});

export interface CommandIntent {
  fire: boolean;
  choke: boolean;
  doubleTap: boolean;
  hideShots: boolean;
  defensive: boolean;
}

export type TickbaseReject = 'dtNotCharged' | 'hsNotCharged' | 'defensiveNotCharged' | 'chokeTooHigh';

export type ShiftReason = 'doubleTap' | 'hideShots' | 'defensive';

export type TickAction =
  | { kind: 'run' }
  | { kind: 'bank' }
  | { kind: 'choke' }
  | { kind: 'shift'; ticks: number; reason: ShiftReason }
  | { kind: 'reject'; reason: TickbaseReject };

/** Ticks available to shift right now: banked ticks, capped by what choke leaves of maxProcessTicks. */
export function shiftBudget(s: TickbaseState, era: EraTable): number {
  return Math.max(0, Math.min(s.bank, era.maxProcessTicks - s.choked));
}

function requestedShift(
  intent: CommandIntent,
  era: EraTable,
): { reason: ShiftReason; ticks: number; notCharged: TickbaseReject } | null {
  if (intent.defensive) return { reason: 'defensive', ticks: era.defensiveShift, notCharged: 'defensiveNotCharged' };
  if (intent.fire && intent.doubleTap) return { reason: 'doubleTap', ticks: era.doubleTapShift, notCharged: 'dtNotCharged' };
  if (intent.fire && intent.hideShots) return { reason: 'hideShots', ticks: era.hideShotsShift, notCharged: 'hsNotCharged' };
  return null;
}

// Pure and deterministic: same (s, intent, era) always yields the same result; inputs are never mutated.
// shiftBudget is computed from the incoming state s, before this tick's choke flush (R7).
// Shift priority: defensive > doubleTap > hideShots; DT/HS only when intent.fire, defensive whether firing or not (R10).
// Any tick that is not 'choke' flushes choked to 0 (run, bank, shift and reject all send).
// ticksSinceShift increments on every non-shift tick (including reject) and resets to 0 on a shift.
// tickbase advances +1 for run/choke/reject/shift ticks, plus the shifted ticks for DT only; a bank tick does not advance tickbase.
// A reject tick still runs the command (state evolves as 'run': no bank, no choke) but returns the reject action.
// Reject reason is chokeTooHigh when bank alone would have covered the shift, else the matching *NotCharged.
// Choke and bank are mutually exclusive: intent.choke blocks banking even when the choke cap is reached (that tick runs).
export function stepTickbase(
  s: TickbaseState,
  intent: CommandIntent,
  era: EraTable,
): { next: TickbaseState; action: TickAction } {
  const ran: TickbaseState = {
    tickbase: s.tickbase + 1,
    bank: s.bank,
    choked: 0,
    ticksSinceShift: s.ticksSinceShift + 1,
  };

  const shift = requestedShift(intent, era);
  if (shift) {
    if (shiftBudget(s, era) >= shift.ticks) {
      return {
        next: {
          tickbase: s.tickbase + 1 + (shift.reason === 'doubleTap' ? shift.ticks : 0),
          bank: s.bank - shift.ticks,
          choked: 0,
          ticksSinceShift: 0,
        },
        action: { kind: 'shift', ticks: shift.ticks, reason: shift.reason },
      };
    }
    const reason: TickbaseReject = s.bank >= shift.ticks ? 'chokeTooHigh' : shift.notCharged;
    return { next: ran, action: { kind: 'reject', reason } };
  }

  if (intent.choke && s.choked < era.maxChoke) {
    return {
      next: { ...ran, choked: s.choked + 1 },
      action: { kind: 'choke' },
    };
  }

  if (
    !intent.fire &&
    !intent.choke &&
    s.ticksSinceShift >= era.rechargeDelayTicks &&
    s.bank < era.doubleTapShift
  ) {
    return {
      next: { ...ran, tickbase: s.tickbase, bank: s.bank + 1 },
      action: { kind: 'bank' },
    };
  }

  return { next: ran, action: { kind: 'run' } };
}
