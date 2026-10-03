import { lerp, lerpAngle } from '@game/shared';

export interface HistorySample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  alive: boolean;
  /** Body scale (smaller while crouched). */
  scale: number;
}

/**
 * Recent positions of one player, recorded every server tick. Used to rewind targets to the
 * moment a shooter saw them (lag compensation).
 */
export class History {
  private readonly samples: HistorySample[] = [];
  private readonly capacity: number;

  constructor(capacity = 90) {
    this.capacity = capacity;
  }

  push(sample: HistorySample): void {
    this.samples.push(sample);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Interpolated state at time `t`, clamped to the recorded range. */
  at(t: number): HistorySample | null {
    const s = this.samples;
    if (s.length === 0) return null;
    if (t <= s[0]!.t) return s[0]!;
    const last = s[s.length - 1]!;
    if (t >= last.t) return last;
    // Binary search for the last sample at or before t.
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid]!.t <= t) lo = mid;
      else hi = mid;
    }
    const a = s[lo]!;
    const b = s[hi]!;
    const k = (t - a.t) / (b.t - a.t);
    return {
      t,
      x: lerp(a.x, b.x, k),
      y: lerp(a.y, b.y, k),
      z: lerp(a.z, b.z, k),
      yaw: lerpAngle(a.yaw, b.yaw, k),
      alive: a.alive && b.alive,
      scale: lerp(a.scale, b.scale, k),
    };
  }
}
