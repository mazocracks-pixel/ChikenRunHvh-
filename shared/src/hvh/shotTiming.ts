import { MAX_REWIND_MS, SIM_DT } from '../constants';

/** Fire travels directly; simulated movement latency must not age a queued shot. */
export function shotRecordUsable(recordT: number, estimatedServerNow: number, roundTripMs = 0): boolean {
  const ageAtArrival = estimatedServerNow + Math.max(0, roundTripMs) / 2 - recordT;
  return Number.isFinite(ageAtArrival) && ageAtArrival >= -16 && ageAtArrival <= MAX_REWIND_MS - SIM_DT * 2000;
}
