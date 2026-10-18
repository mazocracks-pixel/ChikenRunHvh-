export interface EraTable {
  id: string;
  tickRate: 64;
  maxProcessTicks: number;
  doubleTapShift: number;
  doubleTapShiftOptions: readonly number[];
  maxChoke: number;
  lagCompWindowMs: number;
  maxDesyncDeg: number;
  desyncRunFalloff: number;
  lagCompBreakHulls: number;
  hideShotsShift: number;
  defensiveShift: number;
  rechargeDelayTicks: number;
}

export const LATE_CSGO: EraTable = Object.freeze({
  id: 'late-csgo',
  tickRate: 64,
  maxProcessTicks: 16,
  doubleTapShift: 14,
  doubleTapShiftOptions: Object.freeze([12, 14, 16]),
  maxChoke: 14,
  lagCompWindowMs: 200,
  maxDesyncDeg: 58,
  desyncRunFalloff: 0.5,
  lagCompBreakHulls: 2,
  hideShotsShift: 8,
  defensiveShift: 12,
  rechargeDelayTicks: 16,
});

export function validateEra(t: EraTable): string[] {
  const errors: string[] = [];
  // Written as !(ok) so a NaN field fails the check instead of slipping through a false comparison.
  if (!(t.maxChoke <= t.maxProcessTicks)) {
    errors.push('maxChoke exceeds maxProcessTicks');
  }
  if (!(t.doubleTapShift <= t.maxProcessTicks)) {
    errors.push('doubleTapShift exceeds maxProcessTicks');
  }
  if (!(t.desyncRunFalloff >= 0 && t.desyncRunFalloff <= 1)) {
    errors.push('desyncRunFalloff out of range [0,1]');
  }
  if (!(t.hideShotsShift <= t.doubleTapShift)) {
    errors.push('hideShotsShift exceeds doubleTapShift');
  }
  if (!(t.defensiveShift <= t.doubleTapShift)) {
    errors.push('defensiveShift exceeds doubleTapShift');
  }
  if (!t.doubleTapShiftOptions.includes(t.doubleTapShift)) {
    errors.push('doubleTapShift not in doubleTapShiftOptions');
  }
  return errors;
}

export function lagCompWindowTicks(t: EraTable): number {
  return Math.floor((t.lagCompWindowMs * t.tickRate) / 1000);
}
