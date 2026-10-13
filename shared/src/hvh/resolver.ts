import { clamp, wrapAngle } from '../math';
import { MAX_REWIND_MS } from '../constants';
import { maximumBodyDelta, movementLayerWeight, copyObservableRecord, type ObservableRecord } from './animation';
export type HypothesisSource = 'CENTER' | 'LEFT' | 'RIGHT' | 'LEFT_LOW' | 'RIGHT_LOW' | 'LAST_MOVING' | 'BODY_UPDATE';
export interface ResolverHypothesis { yaw: number; source: HypothesisSource; probability: number }
export type ShotReason = 'HIT' | 'SPREAD' | 'RESOLVER' | 'RECORD_INVALID' | 'OCCLUSION' | 'TARGET_DIED' | 'SERVER_REJECTED' | 'PREDICTION';
interface Track { records: ObservableRecord[]; evidence: Map<string, number>; feedbackAt: number; misses: Map<string, number> }
export interface Resolution { hypotheses: ResolverHypothesis[]; confidence: number; state: string; misses: number; pattern: string }
export type ResolverPolicy = 'adaptive' | 'animation' | 'cycle';
function stance(r: ObservableRecord): string {
  return !r.grounded ? r.crouch > 0.5 ? 'AIR_CROUCH' : 'AIRBORNE' : r.crouch > 0.5 ? 'CROUCHING'
    : r.speed > 2 ? 'MOVING' : r.speed > 0.25 ? 'SLOW_MOVING' : 'STANDING';
}
function context(record: ObservableRecord, records: readonly ObservableRecord[]) {
  const state = stance(record), history = records.filter(r => r.t <= record.t);
  let start = 0;
  for (let i = 0; i < history.length; i++) if (stance(history[i]!) !== state || history[i]!.fired !== record.fired) start = i + 1;
  const recent = history.slice(start).slice(-8);
  const changes = recent.slice(1).map((r, i) => wrapAngle(r.eyeYaw - recent[i]!.eyeYaw));
  const turns = changes.filter(v => Math.abs(v) > 0.08);
  const flips = turns.filter((v, i) => i > 0 && v * turns[i - 1]! < 0).length;
  const pattern = changes.length < 2 ? 'UNKNOWN' : flips >= 1 ? 'JITTER'
    : changes.every(v => Math.abs(v) < 0.03) ? 'STATIC' : turns.length >= 3 && flips === 0 ? 'TURNING' : 'TRANSITION';
  const center = Math.atan2(recent.reduce((n, r) => n + Math.sin(r.eyeYaw), 0), recent.reduce((n, r) => n + Math.cos(r.eyeYaw), 0));
  const phase = pattern === 'JITTER' ? wrapAngle(record.eyeYaw - center) >= 0 ? 'HIGH' : 'LOW' : '';
  return { state, pattern, history, key: `${state}:${record.fired && !record.concealed ? 'SHOT' : pattern}:${phase}` };
}
export class ResolverSystem {
  private readonly tracks = new Map<number, Track>();
  clear(): void { this.tracks.clear(); }
  observe(record: ObservableRecord, options: { history: number; memoryMs: number } = { history: 32, memoryMs: 1500 }): void {
    let t = this.tracks.get(record.pid);
    const last = t?.records.at(-1);
    if (last && (record.t < last.t || (!last.alive && record.alive) || record.t - last.t > 1500
      || Math.hypot(record.origin.x - last.origin.x, record.origin.z - last.origin.z) > 8)) t = undefined;
    if (!t) { t = { records: [], evidence: new Map(), feedbackAt: record.t, misses: new Map() }; this.tracks.set(record.pid, t); }
    if (t.records.at(-1)?.t === record.t) return;
    t.records.push(copyObservableRecord(record));
    t.records = t.records.filter(r => record.t - r.t < clamp(options.memoryMs, 300, 1500)).slice(-clamp(Math.round(options.history), 4, 32));
    for (const [pid, track] of this.tracks) if (record.t - (track.records.at(-1)?.t ?? 0) > 5000) this.tracks.delete(pid);
  }
  records(pid: number, now: number): readonly ObservableRecord[] {
    return (this.tracks.get(pid)?.records ?? []).filter(r => recordValidity(r, now) === 'VALID').slice(-6).reverse();
  }
  feedback(pid: number, source: HypothesisSource, reason: ShotReason, now: number, informativeHit = true, recordT = now): void {
    const t = this.tracks.get(pid); if (!t) return;
    // Spread, stale records, rejection and cover never teach an orientation error.
    if (reason !== 'RESOLVER' && reason !== 'HIT') return;
    const record = [...t.records].reverse().find(r => r.t <= recordT); if (!record || recordT - record.t > 100) return;
    const key = context(record, t.records).key, evidenceKey = `${key}:${source}`;
    this.decay(t, now); t.feedbackAt = now;
    // Body overlap can confirm damage without distinguishing the hidden orientation.
    if (reason === 'HIT' && !informativeHit) { t.misses.set(key, 0); return; }
    t.evidence.set(evidenceKey, clamp((t.evidence.get(evidenceKey) ?? 0) + (reason === 'HIT' ? 1.1 : -2.4), -5, 4));
    t.misses.set(key, reason === 'HIT' ? 0 : (t.misses.get(key) ?? 0) + 1);
  }
  private decay(t: Track, now: number): void {
    if (now <= t.feedbackAt) return;
    const factor = Math.exp(-Math.max(0, now - t.feedbackAt) / 2500);
    for (const [key, value] of t.evidence) t.evidence.set(key, value * factor);
    t.feedbackAt = now;
  }
  resolve(record: ObservableRecord, enabled = true, side?: -1 | 0 | 1, policy: ResolverPolicy = 'adaptive'): Resolution {
    const t = this.tracks.get(record.pid); if (t) this.decay(t, record.t);
    const delta = maximumBodyDelta(record.speed, record.crouch, record.grounded, record.weaponSpeed, record.runFraction);
    const { state, pattern, history, key } = context(record, t?.records ?? []), misses = t?.misses.get(key) ?? 0;
    const previous = history.filter(r => r.t < record.t).at(-1);
    const compareLayer = record.movementWeight !== undefined && record.grounded && record.speed > 0.25 && previous
      && Math.abs(record.speed - previous.speed) < 0.5 && !record.concealed && !record.fired;
    const layerScore = (yaw: number) => compareLayer ? clamp(1 - Math.abs(record.movementWeight!
      - movementLayerWeight(yaw, record.velocity, record.speed, record.crouch, record.grounded, record.weaponSpeed)) / 0.12, -1, 1) * 1.5 : 0;
    const make = (source: HypothesisSource, yaw: number, prior: number) => {
      const bounded = wrapAngle(record.eyeYaw + clamp(wrapAngle(yaw - record.eyeYaw), -delta, delta));
      return { source, yaw: bounded, probability: prior + layerScore(bounded) + (t?.evidence.get(`${key}:${source}`) ?? 0) * (policy === 'animation' ? 0.25 : 1) };
    };
    if (!enabled || side !== undefined) return { hypotheses: [{ source: side === -1 ? 'LEFT' : side === 1 ? 'RIGHT' : 'CENTER', yaw: wrapAngle(record.eyeYaw + (side ?? 0) * delta), probability: 1 }], confidence: enabled ? 0.55 : 0.25, state, pattern, misses };
    let bodyUpdate: ObservableRecord | undefined;
    for (let i = 1; i < history.length; i++) if (Math.abs(wrapAngle(history[i]!.lowerBodyYaw - history[i - 1]!.lowerBodyYaw)) > 0.025) bodyUpdate = history[i];
    const age = record.t - (bodyUpdate?.t ?? -Infinity);
    const cue = !record.concealed && record.grounded && age <= 80 ? 0.8 : -0.8;
    const h = [make('LEFT', record.eyeYaw - delta, 0), make('RIGHT', record.eyeYaw + delta, 0), make('CENTER', record.eyeYaw, record.fired && !record.concealed ? 5 : -0.65),
      make('LEFT_LOW', record.eyeYaw - delta * 0.6, -0.4), make('RIGHT_LOW', record.eyeYaw + delta * 0.6, -0.4)];
    const lastMoving = [...history].reverse().find(r => r.speed > 2 && r.grounded && !r.concealed);
    if (lastMoving && state === 'STANDING' && record.t - lastMoving.t < 500) h.push(make('LAST_MOVING', lastMoving.lowerBodyYaw, 0.2));
    h.push(make('BODY_UPDATE', record.lowerBodyYaw, cue));
    if (policy === 'cycle' && !(record.fired && !record.concealed)) {
      const preferred = layerScore(record.eyeYaw + delta) > layerScore(record.eyeYaw - delta) ? 'RIGHT' : 'LEFT';
      const order: HypothesisSource[] = [preferred, preferred === 'LEFT' ? 'RIGHT' : 'LEFT', 'CENTER'], chosen = order[misses % 3]!;
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
    return { hypotheses: unique, confidence: clamp(agreement * (record.concealed || record.defensive ? 0.6 : 1) * (record.grounded ? 1 : 0.8), 0, 1), state, pattern, misses };
  }
}
export function recordValidity(r: ObservableRecord, now: number): 'VALID' | 'TOO_OLD' | 'TARGET_DIED' | 'FUTURE' {
  return !r.alive ? 'TARGET_DIED' : r.t > now + 16 ? 'FUTURE' : now - r.t > MAX_REWIND_MS ? 'TOO_OLD' : 'VALID';
}
