import type { Vec3, WeaponSound } from '@game/shared';
import { storage } from '../ui/dom';

export type SoundName =
  | WeaponSound
  | 'meleeHit'
  | 'beep'
  | 'bonk'
  | 'explosion'
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'hurt'
  | 'reload'
  | 'empty'
  | 'switch'
  | 'jump'
  | 'jet'
  | 'throw'
  | 'pickup'
  | 'death'
  | 'poof'
  | 'boxBreak'
  | 'smokePop'
  | 'click'
  | 'reward'
  | 'countdown'
  | 'engine';

const VOLUME_KEY = 'chikengun:volume';
/** Beyond this distance a sound is silent. */
const HEARING_RANGE = 70;
const MAX_VOICES = 64;

function safeVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.6;
}

interface Voice {
  sources: number;
  release: () => void;
}

interface Listener {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Synthesized sound effects (no audio files). Every sound is a short graph of oscillators
 * and filtered noise, panned and attenuated by distance from the camera.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private volumeValue = safeVolume(Number(storage.get(VOLUME_KEY) ?? '0.6'));
  private readonly voices = new WeakMap<AudioNode, Voice>();
  private activeVoices = 0;

  get volume(): number {
    return this.volumeValue;
  }

  set volume(v: number) {
    this.volumeValue = safeVolume(v);
    storage.set(VOLUME_KEY, String(this.volumeValue));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volumeValue, this.ctx.currentTime, 0.015);
  }

  /** Browsers only allow audio after a user gesture, so call this from a click handler. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volumeValue;
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 16;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      this.master.connect(compressor).connect(this.ctx.destination);
      this.noise = this.makeNoise();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, yaw };
  }

  /** Plays a sound, optionally at a world position (attenuated and panned). */
  play(name: SoundName, at?: Vec3, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.volumeValue === 0 || !Number.isFinite(volume) || volume <= 0) return;
    // Preserve local feedback when the arena is busy; distant shots are the first to be dropped.
    if (this.activeVoices >= MAX_VOICES && at) return;
    if (this.activeVoices >= MAX_VOICES * 2) return;
    let gain = Math.min(2, volume);
    let pan = 0;
    let distance = 0;
    if (at) {
      const dx = at.x - this.listener.x;
      const dz = at.z - this.listener.z;
      const dist = Math.hypot(dx, at.y - this.listener.y, dz);
      if (!Number.isFinite(dist) || dist >= HEARING_RANGE) return;
      distance = dist;
      gain *= (1 - (dist / HEARING_RANGE) ** 4) / (1 + dist * 0.12);
      // Project onto the listener's right vector for left/right panning.
      const rightX = Math.cos(this.listener.yaw);
      const rightZ = -Math.sin(this.listener.yaw);
      pan = dist > 0.5 ? Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / dist)) * 0.8 : 0;
    }
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    const distanceFilter = ctx.createBiquadFilter();
    distanceFilter.type = 'lowpass';
    distanceFilter.frequency.value = Math.max(1800, 18000 / (1 + distance * 0.07));
    distanceFilter.Q.value = 0.5;
    out.connect(distanceFilter).connect(panner).connect(this.master);
    this.activeVoices++;
    const voice: Voice = {
      sources: 0,
      release: () => {
        out.disconnect();
        distanceFilter.disconnect();
        panner.disconnect();
        this.voices.delete(out);
        this.activeVoices--;
      },
    };
    this.voices.set(out, voice);
    this.synth(name, ctx, out, ctx.currentTime);
    if (voice.sources === 0) voice.release();
  }

  /** Disconnect complete graphs after the final layer; automatic fire must not retain silent nodes. */
  private track(out: AudioNode, source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    const voice = this.voices.get(out)!;
    voice.sources++;
    source.onended = () => {
      for (const node of nodes) node.disconnect();
      source.onended = null;
      if (--voice.sources === 0) voice.release();
    };
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Filtered noise burst with an exponential decay. */
  private burst(ctx: AudioContext, out: AudioNode, t: number, o: { dur: number; type: BiquadFilterType; freq: number; to?: number; q?: number; gain?: number; delay?: number }): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q ?? 1;
    const start = t + (o.delay ?? 0);
    filter.frequency.setValueAtTime(o.freq, start);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, start + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain ?? 1, start);
    env.gain.exponentialRampToValueAtTime(0.001, start + o.dur);
    src.connect(filter).connect(env).connect(out);
    this.track(out, src, [src, filter, env]);
    src.start(start, Math.random() * 0.5);
    src.stop(start + o.dur + 0.05);
  }

  /** Oscillator sweep with an exponential decay. */
  private tone(ctx: AudioContext, out: AudioNode, t: number, o: { dur: number; type: OscillatorType; freq: number; to?: number; gain?: number; delay?: number }): void {
    const osc = ctx.createOscillator();
    osc.type = o.type;
    const start = t + (o.delay ?? 0);
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, start + o.dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(o.gain ?? 0.5, start);
    env.gain.exponentialRampToValueAtTime(0.001, start + o.dur);
    osc.connect(env).connect(out);
    this.track(out, osc, [osc, env]);
    osc.start(start);
    osc.stop(start + o.dur + 0.05);
  }

  /** A chicken squawk: a buzzy sawtooth through a vocal-ish filter, pitch up then down, with vibrato. */
  private squawk(ctx: AudioContext, out: AudioNode, t: number, o: { delay: number; freq: number; peak: number; end: number; dur: number; gain: number }): void {
    const start = t + o.delay;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.freq, start);
    osc.frequency.exponentialRampToValueAtTime(o.peak, start + o.dur * 0.3);
    osc.frequency.exponentialRampToValueAtTime(o.end, start + o.dur);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 34;
    const depth = ctx.createGain();
    depth.gain.value = o.peak * 0.06;
    vibrato.connect(depth).connect(osc.frequency);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 1700;
    formant.Q.value = 2.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(o.gain, start + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, start + o.dur);
    osc.connect(formant).connect(env).connect(out);
    this.track(out, osc, [osc, vibrato, depth, formant, env]);
    for (const n of [osc, vibrato]) {
      n.start(start);
      n.stop(start + o.dur + 0.05);
    }
  }

  private synth(name: SoundName, ctx: AudioContext, out: AudioNode, t: number): void {
    // Tiny pitch changes keep bursts from sounding like a machine repeating the same sample.
    const pitch = 0.96 + Math.random() * 0.08;
    switch (name) {
      case 'pistol':
        this.burst(ctx, out, t, { dur: 0.018, type: 'highpass', freq: 3300 * pitch, gain: 0.7 });
        this.burst(ctx, out, t, { dur: 0.1, type: 'bandpass', freq: 1700 * pitch, to: 600, q: 0.7, gain: 1 });
        this.tone(ctx, out, t, { dur: 0.085, type: 'sine', freq: 175 * pitch, to: 55, gain: 0.72 });
        this.burst(ctx, out, t, { dur: 0.025, type: 'bandpass', freq: 2400 * pitch, q: 3, gain: 0.15, delay: 0.065 });
        break;
      case 'rifle':
        this.burst(ctx, out, t, { dur: 0.012, type: 'highpass', freq: 4100 * pitch, gain: 0.65 });
        this.burst(ctx, out, t, { dur: 0.105, type: 'bandpass', freq: 1150 * pitch, to: 420, q: 0.6, gain: 1 });
        this.tone(ctx, out, t, { dur: 0.09, type: 'triangle', freq: 145 * pitch, to: 48, gain: 0.5 });
        this.burst(ctx, out, t, { dur: 0.018, type: 'bandpass', freq: 2300 * pitch, q: 4, gain: 0.12, delay: 0.043 });
        break;
      case 'smg':
        this.burst(ctx, out, t, { dur: 0.012, type: 'highpass', freq: 4400 * pitch, gain: 0.45 });
        this.burst(ctx, out, t, { dur: 0.045, type: 'bandpass', freq: 2100 * pitch, to: 1000, q: 0.9, gain: 0.8 });
        this.tone(ctx, out, t, { dur: 0.05, type: 'sine', freq: 190 * pitch, to: 75, gain: 0.48 });
        break;
      case 'minigun':
        this.burst(ctx, out, t, { dur: 0.035, type: 'bandpass', freq: 1450 * pitch, to: 700, q: 0.8, gain: 0.7 });
        this.tone(ctx, out, t, { dur: 0.055, type: 'triangle', freq: 98 * pitch, to: 65, gain: 0.3 });
        break;
      case 'shotgun':
        this.burst(ctx, out, t, { dur: 0.035, type: 'highpass', freq: 2800 * pitch, gain: 0.8 });
        this.burst(ctx, out, t, { dur: 0.32, type: 'lowpass', freq: 1800 * pitch, to: 160, gain: 1.35 });
        this.tone(ctx, out, t, { dur: 0.18, type: 'sine', freq: 120 * pitch, to: 35, gain: 1 });
        this.burst(ctx, out, t, { dur: 0.065, type: 'bandpass', freq: 850 * pitch, to: 2200, q: 2, gain: 0.32, delay: 0.26 });
        this.burst(ctx, out, t, { dur: 0.04, type: 'highpass', freq: 2500, gain: 0.28, delay: 0.34 });
        break;
      case 'sniper':
        this.burst(ctx, out, t, { dur: 0.025, type: 'highpass', freq: 3700 * pitch, gain: 0.95 });
        this.burst(ctx, out, t, { dur: 0.5, type: 'lowpass', freq: 1100 * pitch, to: 110, gain: 1.2 });
        this.tone(ctx, out, t, { dur: 0.24, type: 'sine', freq: 100 * pitch, to: 32, gain: 1 });
        this.burst(ctx, out, t, { dur: 0.12, type: 'bandpass', freq: 950, to: 330, q: 0.8, gain: 0.23, delay: 0.1 });
        this.burst(ctx, out, t, { dur: 0.05, type: 'highpass', freq: 2200, gain: 0.18, delay: 0.48 });
        break;
      case 'rocket':
        this.tone(ctx, out, t, { dur: 0.12, type: 'sine', freq: 100 * pitch, to: 40, gain: 0.8 });
        this.burst(ctx, out, t, { dur: 0.5, type: 'bandpass', freq: 400, to: 1800, q: 1.5, gain: 1 });
        break;
      // Melee swings: a filtered-noise whoosh sweeping down (quick and light, heavy, or long and ringing).
      case 'knife':
        this.burst(ctx, out, t, { dur: 0.16, type: 'bandpass', freq: 3200, to: 1100, q: 2.2, gain: 0.55 });
        break;
      case 'pan':
        this.burst(ctx, out, t, { dur: 0.26, type: 'bandpass', freq: 900, to: 300, q: 1.6, gain: 0.7 });
        break;
      case 'katana':
        this.burst(ctx, out, t, { dur: 0.22, type: 'bandpass', freq: 4200, to: 1400, q: 2.6, gain: 0.6 });
        this.tone(ctx, out, t, { dur: 0.3, type: 'sine', freq: 2600, to: 2400, gain: 0.05 });
        break;
      case 'meleeHit':
        this.burst(ctx, out, t, { dur: 0.09, type: 'lowpass', freq: 1800, to: 300, gain: 1.1 });
        this.tone(ctx, out, t, { dur: 0.08, type: 'sine', freq: 180, to: 70, gain: 0.6 });
        break;
      case 'beep':
        // The planted bomb.
        this.tone(ctx, out, t, { dur: 0.07, type: 'square', freq: 2050, gain: 0.12 });
        break;
      case 'bonk':
        // A frying pan on a chicken's head: a dull thud plus a metallic ring.
        this.tone(ctx, out, t, { dur: 0.06, type: 'sine', freq: 220, to: 90, gain: 0.9 });
        this.tone(ctx, out, t, { dur: 0.55, type: 'triangle', freq: 640, to: 610, gain: 0.35 });
        this.tone(ctx, out, t, { dur: 0.4, type: 'sine', freq: 1730, to: 1690, gain: 0.12 });
        break;
      case 'explosion':
        this.burst(ctx, out, t, { dur: 0.045, type: 'highpass', freq: 2600, gain: 0.7 });
        this.burst(ctx, out, t, { dur: 1.1, type: 'lowpass', freq: 1500, to: 80, gain: 1.8 });
        this.tone(ctx, out, t, { dur: 0.6, type: 'sine', freq: 70, to: 25, gain: 1.4 });
        this.burst(ctx, out, t, { dur: 0.4, type: 'bandpass', freq: 680, to: 130, gain: 0.25, delay: 0.18 });
        break;
      case 'hit':
        this.burst(ctx, out, t, { dur: 0.025, type: 'highpass', freq: 3000, gain: 0.13 });
        this.tone(ctx, out, t, { dur: 0.065, type: 'triangle', freq: 1450, to: 1100, gain: 0.23 });
        break;
      case 'headshot':
        this.tone(ctx, out, t, { dur: 0.08, type: 'triangle', freq: 1900, to: 1500, gain: 0.24 });
        this.tone(ctx, out, t, { dur: 0.12, type: 'sine', freq: 2850, gain: 0.16, delay: 0.035 });
        break;
      case 'kill':
        [880, 1320, 1760].forEach((f, i) => this.tone(ctx, out, t, { dur: 0.12, type: 'triangle', freq: f, gain: 0.3, delay: i * 0.07 }));
        break;
      case 'hurt':
        this.tone(ctx, out, t, { dur: 0.15, type: 'sine', freq: 220, to: 90, gain: 0.6 });
        this.burst(ctx, out, t, { dur: 0.1, type: 'lowpass', freq: 600, gain: 0.5 });
        break;
      case 'reload':
        this.burst(ctx, out, t, { dur: 0.04, type: 'highpass', freq: 2500, gain: 0.6 });
        this.burst(ctx, out, t, { dur: 0.05, type: 'highpass', freq: 1800, gain: 0.7, delay: 0.25 });
        break;
      case 'empty':
        this.burst(ctx, out, t, { dur: 0.03, type: 'highpass', freq: 3000, gain: 0.4 });
        break;
      case 'switch':
        this.burst(ctx, out, t, { dur: 0.05, type: 'bandpass', freq: 2200, gain: 0.4 });
        break;
      case 'jump':
        this.tone(ctx, out, t, { dur: 0.08, type: 'triangle', freq: 600, to: 950, gain: 0.25 });
        break;
      case 'jet':
        this.burst(ctx, out, t, { dur: 0.14, type: 'bandpass', freq: 700, q: 0.7, gain: 0.4 });
        break;
      case 'throw':
        this.burst(ctx, out, t, { dur: 0.18, type: 'bandpass', freq: 800, to: 2000, q: 2, gain: 0.5 });
        break;
      case 'pickup':
        [660, 880, 1100].forEach((f, i) => this.tone(ctx, out, t, { dur: 0.09, type: 'sine', freq: f, gain: 0.35, delay: i * 0.06 }));
        break;
      case 'death':
        // "BA-WAWK!" and a thud as it hits the ground, with a flurry of feathers.
        this.squawk(ctx, out, t, { delay: 0, freq: 780, peak: 1250, end: 520, dur: 0.16, gain: 0.32 });
        this.squawk(ctx, out, t, { delay: 0.17, freq: 900, peak: 1500, end: 380, dur: 0.34, gain: 0.36 });
        this.burst(ctx, out, t, { dur: 0.35, type: 'highpass', freq: 3500, gain: 0.18, delay: 0.05 });
        this.tone(ctx, out, t, { dur: 0.18, type: 'sine', freq: 130, to: 45, gain: 0.7, delay: 0.5 });
        this.burst(ctx, out, t, { dur: 0.12, type: 'lowpass', freq: 500, gain: 0.5, delay: 0.5 });
        break;
      case 'poof':
        this.burst(ctx, out, t, { dur: 0.35, type: 'bandpass', freq: 1800, to: 400, q: 0.8, gain: 0.6 });
        this.tone(ctx, out, t, { dur: 0.12, type: 'sine', freq: 520, to: 1400, gain: 0.25 });
        break;
      case 'boxBreak':
        this.burst(ctx, out, t, { dur: 0.25, type: 'bandpass', freq: 900, q: 0.6, gain: 0.8 });
        this.tone(ctx, out, t, { dur: 0.15, type: 'triangle', freq: 1200, to: 1800, gain: 0.15 });
        break;
      case 'smokePop':
        this.burst(ctx, out, t, { dur: 0.9, type: 'lowpass', freq: 2500, to: 300, gain: 0.7 });
        break;
      case 'click':
        this.tone(ctx, out, t, { dur: 0.04, type: 'sine', freq: 900, gain: 0.2 });
        break;
      case 'reward':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(ctx, out, t, { dur: 0.16, type: 'triangle', freq: f, gain: 0.3, delay: i * 0.09 }));
        break;
      case 'countdown':
        this.tone(ctx, out, t, { dur: 0.12, type: 'sine', freq: 740, gain: 0.3 });
        break;
      case 'engine':
        this.tone(ctx, out, t, { dur: 0.12, type: 'sawtooth', freq: 70, to: 80, gain: 0.12 });
        break;
    }
  }
}
