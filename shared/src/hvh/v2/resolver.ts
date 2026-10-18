import type { Observation, Side } from './pose';

/*
 * Deterministic learning resolver. It sees only what an opponent can observe (Observation:
 * tick, eyeYaw, eyeOffsetDeg, speedFraction, duck) and never bodyYaw or realSide.
 *
 * Mappings (R17):
 * - "The side the eye offset suggests": the side OPPOSITE the visible eye swing. A positive
 *   eyeOffsetDeg (eyes swung left, pose.ts: positive yaw = left) suggests the body is on the
 *   'right'; a negative offset suggests 'left'. This is the classic "body lags the opposite way"
 *   heuristic. An offset of 0 (including -0) is uninformative.
 * - Jitter: period-2 jitter is detected when the trailing run of consecutive observations (sorted
 *   by tick) with non-zero offsets of alternating sign is at least JITTER_MIN_RUN long. The
 *   predicted phase at atTick assumes one phase flip per tick (pose.ts flips once per command):
 *   the last observed offset sign, negated if (atTick - lastTick) is odd. The predicted offset
 *   then maps to a side with the eye-offset rule above.
 * - Pattern break: a jitter run of >= JITTER_MIN_RUN ended fewer than BREAK_WINDOW observations
 *   ago. The side comes from the last observed offset, at BREAK_CONFIDENCE.
 * - Otherwise: the last observation's offset suggests the side at START_CONFIDENCE, or, if it is
 *   0 / there are no observations, DEFAULT_SIDE at NO_INFO_CONFIDENCE.
 *
 * Learning: only a 'resolver' miss changes memory. It toggles a per-target flip that inverts the
 * guess. The flip is bound to the observed pattern (signature: jitter / break / pos / neg / none)
 * seen by the most recent resolve for that target, and persists until the next resolver miss
 * (toggles again) or until resolve sees a different pattern (the flip is cleared). All other
 * causes leave memory untouched. Targets have independent memories.
 *
 * resolve() only records the current pattern signature (and clears a stale flip); calling it
 * repeatedly with the same inputs returns the same result. No randomness, no clock.
 */

export type VerdictCause =
  | 'hit'
  | 'resolver'
  | 'spread'
  | 'invalidRecord'
  | 'obstruction'
  | 'tickbase'
  | 'rejected';

type Signature = 'jitter' | 'break' | 'pos' | 'neg' | 'none';

interface TargetMemory {
  flipped: boolean;
  /** Pattern the flip was learned under. */
  flipSignature: Signature | null;
  /** Pattern seen by the latest resolve. */
  lastSignature: Signature | null;
}

export interface ResolverMemory {
  byTarget: Map<string, TargetMemory>;
}

export const DEFAULT_SIDE: Side = 'left';
export const NO_INFO_CONFIDENCE = 0.2;
export const START_CONFIDENCE = 0.3;
export const BREAK_CONFIDENCE = 0.2;
export const JITTER_MIN_RUN = 3;
export const JITTER_BASE_CONFIDENCE = 0.6;
export const JITTER_CONFIDENCE_STEP = 0.05;
export const JITTER_MAX_CONFIDENCE = 0.85;
/** A finished jitter run counts as a "break" while fewer than this many observations follow it. */
export const BREAK_WINDOW = 3;

export function createResolverMemory(): ResolverMemory {
  return { byTarget: new Map() };
}

function target(mem: ResolverMemory, id: string): TargetMemory {
  let t = mem.byTarget.get(id);
  if (!t) {
    t = { flipped: false, flipSignature: null, lastSignature: null };
    mem.byTarget.set(id, t);
  }
  return t;
}

/** -1, 0 or +1; -0 and NaN count as 0. */
function sign(x: number): -1 | 0 | 1 {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function suggested(s: -1 | 1): Side {
  return s > 0 ? 'right' : 'left';
}

function opposite(s: Side): Side {
  return s === 'left' ? 'right' : s === 'right' ? 'left' : s;
}

function alternates(a: -1 | 0 | 1, b: -1 | 0 | 1): boolean {
  return a !== 0 && b !== 0 && a !== b;
}

interface Analysis {
  signature: Signature;
  side: Side;
  confidence: number;
}

function analyse(obs: readonly Observation[], atTick: number): Analysis {
  const seen = obs
    .filter((o) => o.tick <= atTick)
    .map((o) => ({ tick: o.tick, s: sign(o.eyeOffsetDeg) }))
    .sort((a, b) => a.tick - b.tick);
  const n = seen.length;
  if (n === 0) return { signature: 'none', side: DEFAULT_SIDE, confidence: NO_INFO_CONFIDENCE };

  // Run lengths of alternating observations ending at each index.
  const run: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    run[i] = i > 0 && alternates(seen[i - 1]!.s, seen[i]!.s) ? run[i - 1]! + 1 : seen[i]!.s !== 0 ? 1 : 0;
  }
  const last = seen[n - 1]!;
  const trailing = run[n - 1]!;

  if (trailing >= JITTER_MIN_RUN && last.s !== 0) {
    const gap = atTick - last.tick;
    const predicted = (gap % 2 === 0 ? last.s : -last.s) as -1 | 1;
    const confidence = Math.min(
      JITTER_MAX_CONFIDENCE,
      JITTER_BASE_CONFIDENCE + JITTER_CONFIDENCE_STEP * (trailing - JITTER_MIN_RUN),
    );
    return { signature: 'jitter', side: suggested(predicted), confidence };
  }

  for (let i = n - 2; i >= 0 && n - 1 - i < BREAK_WINDOW; i--) {
    if (run[i]! >= JITTER_MIN_RUN) {
      const side = last.s !== 0 ? suggested(last.s) : DEFAULT_SIDE;
      return { signature: 'break', side, confidence: BREAK_CONFIDENCE };
    }
  }

  if (last.s === 0) return { signature: 'none', side: DEFAULT_SIDE, confidence: NO_INFO_CONFIDENCE };
  return { signature: last.s > 0 ? 'pos' : 'neg', side: suggested(last.s), confidence: START_CONFIDENCE };
}

export function resolve(
  mem: ResolverMemory,
  targetId: string,
  obs: readonly Observation[],
  atTick: number,
): { side: Side; confidence: number } {
  const t = target(mem, targetId);
  const a = analyse(obs, atTick);
  if (t.flipped && t.flipSignature !== a.signature) {
    t.flipped = false;
    t.flipSignature = null;
  }
  t.lastSignature = a.signature;
  return { side: t.flipped ? opposite(a.side) : a.side, confidence: a.confidence };
}

export function learnFromVerdict(
  mem: ResolverMemory,
  targetId: string,
  guessed: Side,
  cause: VerdictCause,
): void {
  if (cause !== 'resolver' || guessed === 'center') return;
  const t = target(mem, targetId);
  t.flipped = !t.flipped;
  t.flipSignature = t.flipped ? (t.lastSignature ?? 'none') : null;
}
