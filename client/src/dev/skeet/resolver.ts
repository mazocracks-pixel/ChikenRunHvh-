import { clamp, wrapAngle } from '@game/shared';
import type { SkeetConfig } from './model';

export interface StanceObservation {
  t: number; yaw: number; fakeYaw: number; speed: number; crouching: boolean; onGround: boolean; x: number; z: number;
}
export interface ResolverDecision { yaw: number; confidence: number; uncertainty: number; state: string; misses: number; body: boolean }
interface Track { samples: StanceObservation[]; misses: number; lastMiss: number }
/**
 * Chicken HvH publishes real stance to every player. Use that public evidence and its stability,
 * rather than importing CSGO animation offsets, lower-body timers or unverifiable brute force.
 */
export class SkeetResolver {
  private readonly tracks = new Map<number, Track>();
  clear(): void { this.tracks.clear(); }
  observe(pid: number, observation: StanceObservation, config: SkeetConfig['resolver']): void {
    let track = this.tracks.get(pid);
    const previous = track?.samples.at(-1);
    if (previous && (observation.t < previous.t || Math.hypot(observation.x - previous.x, observation.z - previous.z) > 4)) track = undefined;
    if (!track) { track = { samples: [], misses: 0, lastMiss: -Infinity }; this.tracks.set(pid, track); }
    if (track.samples.at(-1)?.t === observation.t) return;
    track.samples.push(observation);
    track.samples = track.samples.filter(s => observation.t - s.t <= config.memoryMs).slice(-Math.round(config.history));
    for (const [id, value] of this.tracks) if (observation.t - (value.samples.at(-1)?.t ?? 0) > 2000) this.tracks.delete(id);
  }
  acceptedShot(pid: number, hit: boolean, now: number): void {
    const track = this.tracks.get(pid);
    if (!track) return;
    track.misses = hit ? 0 : Math.min(4, (now - track.lastMiss < 3000 ? track.misses : 0) + 1);
    track.lastMiss = now;
  }
  resolve(pid: number, renderedYaw: number, renderedFakeYaw: number, now: number, config: SkeetConfig['resolver']): ResolverDecision {
    const track = this.tracks.get(pid), samples = track?.samples ?? [], last = samples.at(-1);
    const misses = track && now - track.lastMiss < 3000 ? track.misses : 0;
    if (config.mode === 'visual') return { yaw: renderedFakeYaw, confidence: 25, uncertainty: 25, state: 'Visual stance', misses, body: false };
    if (config.mode === 'real') return { yaw: renderedYaw, confidence: last && now - last.t < 500 ? 100 : 0, uncertainty: 0, state: 'Public real stance', misses, body: false };
    const changes = samples.slice(1).map((s, i) => wrapAngle(s.yaw - samples[i]!.yaw));
    const age = last ? Math.max(0, now - last.t) : 500;
    const uncertainty = clamp(Math.max(0, ...changes.map(Math.abs)) * 180 / Math.PI * 0.35 + Math.max(0, age - 100) * 0.03, 0, 25);
    const confidence = Math.round(clamp(100 - uncertainty * 1.8 - age * 0.04 - misses * 12 - (last?.onGround === false ? 8 : 0) - (samples.length < 2 ? 15 : 0), 0, 100));
    const jitter = changes.some((d, i) => i > 0 && Math.abs(d) > 0.12 && d * changes[i - 1]! < 0);
    const reveal = last && Math.abs(wrapAngle(last.yaw - last.fakeYaw)) < 0.02;
    const state = !last ? 'Awaiting stance' : reveal ? 'Shot reveal / neutral' : jitter ? 'Jitter tracking' : !last.onGround ? 'Airborne' : last.crouching ? 'Crouching' : last.speed > 0.25 ? 'Moving' : 'Standing';
    return { yaw: renderedYaw, confidence, uncertainty, state, misses,
      body: confidence < config.preferBodyBelow || (config.missedShots > 0 && misses >= config.missedShots) };
  }
}
