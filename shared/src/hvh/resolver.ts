import { clamp, wrapAngle } from '../math';
import { MAX_REWIND_MS } from '../constants';
import { maximumBodyDelta, copyObservableRecord, type ObservableRecord } from './animation';
export const HYPOTHESIS_SOURCES = ['CENTER', 'LEFT', 'RIGHT', 'LEFT_LOW', 'RIGHT_LOW', 'LEFT_MIN', 'RIGHT_MIN', 'LAST_MOVING', 'BODY_UPDATE', 'JITTER_CENTER'] as const;
export type HypothesisSource = typeof HYPOTHESIS_SOURCES[number];
export interface ResolverHypothesis { yaw: number; source: HypothesisSource; probability: number }
export type ShotReason = 'HIT' | 'SPREAD' | 'RESOLVER' | 'RECORD_INVALID' | 'OCCLUSION' | 'TARGET_DIED' | 'SERVER_REJECTED' | 'PREDICTION';
interface Track { records: ObservableRecord[]; evidence: Map<string, number>; feedbackAt: number; misses: number }
export interface Resolution { hypotheses: ResolverHypothesis[]; confidence: number; state: string; misses: number; pattern: string }
export type ResolverPolicy = 'adaptive' | 'animation' | 'cycle';
export class ResolverSystem {
  private readonly tracks = new Map<number, Track>();
  clear(): void { this.tracks.clear(); }
  observe(record: ObservableRecord, options: { history: number; memoryMs: number } = { history: 32, memoryMs: 1500 }): void {
    let t = this.tracks.get(record.pid);
    const last = t?.records.at(-1);
    if (last && (record.t < last.t || Math.hypot(record.origin.x - last.origin.x, record.origin.z - last.origin.z) > 8)) t = undefined;
    if (!t) { t = { records: [], evidence: new Map(), feedbackAt: record.t, misses: 0 }; this.tracks.set(record.pid, t); }
    if (t.records.at(-1)?.t === record.t) return;
    t.records.push(copyObservableRecord(record));
    t.records = t.records.filter(r => record.t - r.t < clamp(options.memoryMs, 300, 1500)).slice(-clamp(Math.round(options.history), 4, 32));
    for (const [pid, track] of this.tracks) if (record.t - (track.records.at(-1)?.t ?? 0) > 5000) this.tracks.delete(pid);
  }
  records(pid: number, now: number): readonly ObservableRecord[] {
    return (this.tracks.get(pid)?.records ?? []).filter(r => recordValidity(r, now) === 'VALID').slice(-6).reverse();
  }
  feedback(pid: number, source: HypothesisSource, reason: ShotReason, now: number, informativeHit = true, recordT = Infinity): void {
    const t = this.tracks.get(pid); if (!t) return;
    // Spread, stale records, rejection and cover never teach an orientation error.
    if (reason !== 'RESOLVER' && reason !== 'HIT') return;
    this.decay(t, now); t.feedbackAt = now;
    // Body overlap can confirm damage without distinguishing the hidden orientation.
    if (reason === 'HIT' && !informativeHit) { t.misses = 0; return; }
    const history = t.records.filter(r => r.t <= recordT), record = history.at(-1);
    if (!record) return;
    const key = `${reading(record, history).context}:${source}`;
    t.evidence.set(key, clamp((t.evidence.get(key) ?? 0) + (reason === 'HIT' ? 1.1 : -2.4), -5, 4));
    t.misses = reason === 'HIT' ? 0 : t.misses + 1;
  }
  private decay(t: Track, now: number): void {
    if (now <= t.feedbackAt) return;
    const factor = Math.exp(-Math.max(0, now - t.feedbackAt) / 2500);
    for (const [key, value] of t.evidence) t.evidence.set(key, value * factor);
    t.feedbackAt = now;
  }
  resolve(record: ObservableRecord, enabled = true, side?: -1 | 0 | 1, policy: ResolverPolicy = 'adaptive'): Resolution {
    const t = this.tracks.get(record.pid); if (t) this.decay(t, record.t);
    const delta = maximumBodyDelta(record.speed, record.crouch, record.grounded);
    const history = (t?.records ?? []).filter(r => r.t <= record.t);
    const { state, pattern, context, center } = reading(record, history);
    const make = (source: HypothesisSource, yaw: number, prior: number) => ({ source, yaw: wrapAngle(record.eyeYaw + clamp(wrapAngle(yaw - record.eyeYaw), -delta, delta)), probability: prior + (t?.evidence.get(`${context}:${source}`) ?? 0) * (policy === 'animation' ? 0.25 : 1) });
    if (!enabled || side !== undefined) return { hypotheses: [{ source: side === -1 ? 'LEFT' : side === 1 ? 'RIGHT' : 'CENTER', yaw: wrapAngle(record.eyeYaw + (side ?? 0) * delta), probability: 1 }], confidence: enabled ? 0.55 : 0.25, state, pattern, misses: t?.misses ?? 0 };
    // Body-yaw updates are a public animation cue. Moving records refresh it every tick.
    const previous = history.filter(r => r.t < record.t).at(-1);
    const updated = previous && Math.abs(wrapAngle(previous.lowerBodyYaw - record.lowerBodyYaw)) > 0.025;
    const movingBody = record.grounded && record.speed > 0.3;
    const h = [make('LEFT', record.eyeYaw - delta, 0), make('RIGHT', record.eyeYaw + delta, 0), make('CENTER', record.eyeYaw, -0.65),
      make('LEFT_LOW', record.eyeYaw - delta * 0.65, -0.4), make('RIGHT_LOW', record.eyeYaw + delta * 0.65, -0.4),
      make('LEFT_MIN', record.eyeYaw - delta * 0.3, -0.6), make('RIGHT_MIN', record.eyeYaw + delta * 0.3, -0.6)];
    const lastMoving = [...history].reverse().find(r => r.grounded && r.speed > 0.3 && record.t - r.t <= 300);
    if (lastMoving && state === 'STANDING') {
      const settled = history.filter(r => r.t > lastMoving.t).every(r => r.turnWeight === 0 && r.grounded && !r.defensive);
      h.push(make('LAST_MOVING', lastMoving.lowerBodyYaw, settled ? 3.4 - (record.t - lastMoving.t) / 150 : -0.4));
    }
    h.push(make('BODY_UPDATE', record.lowerBodyYaw, movingBody ? 5.2 : updated && record.grounded ? record.turnWeight === 0 ? 3.8 : 2.4 : -0.65));
    if (pattern === 'JITTER') h.push(make('JITTER_CENTER', center, -0.25));
    if (policy === 'cycle') {
      const order: HypothesisSource[] = ['LEFT', 'RIGHT', 'CENTER'], chosen = order[(t?.misses ?? 0) % 3]!;
      h.forEach(v => v.probability = v.source === chosen ? 1.4 : -0.2);
    }
    // Duplicate guesses must not inflate certainty or crowd out other orientations in the scanner.
    const unique: ResolverHypothesis[] = [];
    for (const v of h.sort((a, b) => b.probability - a.probability)) {
      if (!unique.some(u => Math.abs(wrapAngle(u.yaw - v.yaw)) < 0.06)) unique.push(v);
    }
    const max = Math.max(...unique.map(v => v.probability));
    const sum = unique.reduce((n, v) => n + Math.exp(v.probability - max), 0);
    unique.forEach(v => v.probability = Math.exp(v.probability - max) / sum);
    const agreement = unique.filter(v => Math.abs(wrapAngle(v.yaw - unique[0]!.yaw)) < 0.15).reduce((sum, v) => sum + v.probability, 0);
    return { hypotheses: unique, confidence: clamp(agreement * (record.defensive ? 0.6 : 1) * (record.grounded ? 1 : 0.8), 0, 1), state, pattern, misses: t?.misses ?? 0 };
  }
}
function reading(record: ObservableRecord, history: readonly ObservableRecord[]) {
  const state = !record.grounded ? 'AIRBORNE' : record.crouch > 0.5 ? 'CROUCHING' : record.speed > 1 ? 'MOVING' : record.speed > 0.2 ? 'SLOW_MOVING' : 'STANDING';
  const recent = history.filter(r => record.t - r.t <= 500).slice(-8);
  const changes = recent.slice(1).map((r, i) => wrapAngle(r.eyeYaw - recent[i]!.eyeYaw));
  const turns = changes.filter(v => Math.abs(v) > 0.08);
  const flips = turns.slice(1).filter((v, i) => v * turns[i]! < 0).length;
  const pattern = turns.length >= 4 && flips >= (turns.length - 1) * 0.7 ? 'JITTER'
    : changes.every(v => Math.abs(v) < 0.03) ? 'STATIC'
    : turns.length >= 3 && flips === 0 ? 'TURNING' : 'TRANSITION';
  const center = Math.atan2(recent.reduce((n, r) => n + Math.sin(r.eyeYaw), 0), recent.reduce((n, r) => n + Math.cos(r.eyeYaw), 0));
  const phase = pattern === 'JITTER' ? Math.sign(wrapAngle(record.eyeYaw - center)) : 0;
  return { state, pattern, center, context: `${state}:${pattern}:${phase}` };
}
export function recordValidity(r: ObservableRecord, now: number): 'VALID' | 'TOO_OLD' | 'TARGET_DIED' | 'FUTURE' {
  return !r.alive ? 'TARGET_DIED' : r.t > now + 16 ? 'FUTURE' : now - r.t > MAX_REWIND_MS ? 'TOO_OLD' : 'VALID';
}
