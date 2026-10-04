import { clamp, wrapAngle } from './math';
import type { WeaponDef } from './weapons';

export const HVH_PANEL_IDS = ['lab', 'skeet', 'manual'] as const;
export type HvhPanelId = typeof HVH_PANEL_IDS[number];

export const HVH_STANCES = ['standing', 'moving', 'crouching', 'airborne'] as const;
export type HvhStance = typeof HVH_STANCES[number];
export interface SkeetStance {
  mode: HvhLoadout['antiAim']['mode'];
  yawOffset: number;
  desync: number;
  jitter: number;
}
export interface SkeetAntiAim {
  enabled: boolean;
  atTargets: boolean;
  freestanding: boolean;
  jitterMode: 'center' | 'offset' | 'random';
  interval: number;
  desyncMode: 'static' | 'alternate' | 'sway';
  visualPitch: 'look' | 'down' | 'up' | 'zero';
  states: Record<HvhStance, SkeetStance>;
}
export interface HvhPoseContext {
  speed?: number;
  onGround?: boolean;
  crouching?: boolean;
  targetYaw?: number;
  coverSide?: number;
  seed?: number;
}
export function hvhStance(context: HvhPoseContext): HvhStance {
  return context.onGround === false ? 'airborne' : context.crouching ? 'crouching' : (context.speed ?? 0) > 0.25 ? 'moving' : 'standing';
}
export function defaultSkeetAntiAim(): SkeetAntiAim {
  return { enabled: true, atTargets: false, freestanding: false, jitterMode: 'center', interval: 180,
    desyncMode: 'alternate', visualPitch: 'look', states: {
      standing: { mode: 'backward', yawOffset: 0, desync: 45, jitter: 20 },
      moving: { mode: 'backward', yawOffset: 0, desync: 30, jitter: 12 },
      crouching: { mode: 'left', yawOffset: 0, desync: 40, jitter: 15 },
      airborne: { mode: 'backward', yawOffset: 0, desync: 25, jitter: 30 },
    } };
}
export function sanitizeSkeetAntiAim(raw: unknown): SkeetAntiAim {
  const out = defaultSkeetAntiAim();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of ['enabled', 'atTargets', 'freestanding'] as const) if (typeof r[key] === 'boolean') out[key] = r[key];
  for (const [key, choices] of [['jitterMode', ['center', 'offset', 'random']], ['desyncMode', ['static', 'alternate', 'sway']], ['visualPitch', ['look', 'down', 'up', 'zero']]] as const) {
    if (choices.includes(r[key] as never)) (out as unknown as Record<string, unknown>)[key] = r[key];
  }
  if (typeof r.interval === 'number' && Number.isFinite(r.interval)) out.interval = clamp(r.interval, 150, 600);
  if (r.states && typeof r.states === 'object') for (const stance of HVH_STANCES) {
    const state = (r.states as Record<string, unknown>)[stance];
    if (!state || typeof state !== 'object') continue;
    const s = state as Record<string, unknown>, target = out.states[stance];
    if (['backward', 'left', 'right', 'spin'].includes(String(s.mode))) target.mode = s.mode as SkeetStance['mode'];
    for (const [key, min, max] of [['yawOffset', -180, 180], ['desync', 0, 58], ['jitter', 0, 45]] as const) {
      if (typeof s[key] === 'number' && Number.isFinite(s[key])) target[key] = clamp(s[key], min, max);
    }
  }
  return out;
}

export interface HvhLoadout {
  antiAim: { enabled: boolean; mode: 'backward' | 'left' | 'right' | 'spin'; desync: number; jitter: number; spinSpeed: number };
  exploit: 'off' | 'doubleTap' | 'hideShots';
  skeet?: SkeetAntiAim;
}
export const HVH = { maxDesync: 58, maxJitter: 45, doubleTapRecharge: 8000, hideShotsRecharge: 6000, burstWindow: 500, revealMs: 300, hideMs: 150 } as const;
export function defaultHvhLoadout(): HvhLoadout {
  return { antiAim: { enabled: false, mode: 'backward', desync: 40, jitter: 20, spinSpeed: 180 }, exploit: 'off' };
}
/** Public game mechanics. These never become developer stat multipliers. */
export function sanitizeHvhLoadout(raw: unknown): HvhLoadout {
  const out = defaultHvhLoadout();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.skeet && typeof r.skeet === 'object') out.skeet = sanitizeSkeetAntiAim(r.skeet);
  if (['off', 'doubleTap', 'hideShots'].includes(String(r.exploit))) out.exploit = r.exploit as HvhLoadout['exploit'];
  if (r.antiAim && typeof r.antiAim === 'object') {
    const a = r.antiAim as Record<string, unknown>;
    out.antiAim.enabled = a.enabled === true;
    if (['backward', 'left', 'right', 'spin'].includes(String(a.mode))) out.antiAim.mode = a.mode as HvhLoadout['antiAim']['mode'];
    for (const [key, min, max] of [['desync', 0, HVH.maxDesync], ['jitter', 0, HVH.maxJitter], ['spinSpeed', 90, 540]] as const) {
      const v = a[key];
      if (typeof v === 'number' && Number.isFinite(v)) out.antiAim[key] = clamp(v, min, max);
    }
  }
  return out;
}
/** Real heading drives hitboxes; fake heading drives the body and is separately replicated. */
export function hvhPose(lookYaw: number, loadout: HvhLoadout, now: number, inverted: boolean, revealed: boolean, context: HvhPoseContext = {}): { real: number; fake: number } {
  const a = loadout.antiAim;
  if (!a.enabled || revealed) return { real: lookYaw, fake: lookYaw };
  const skeet = loadout.skeet;
  if (skeet?.enabled) {
    const state = skeet.states[hvhStance(context)];
    const cycle = Math.floor(now / skeet.interval);
    const alternate = cycle % 2 ? 1 : -1;
    const target = skeet.atTargets && context.targetYaw !== undefined ? context.targetYaw : lookYaw;
    const base = state.mode === 'spin' ? now * a.spinSpeed * Math.PI / 180000 : target + ({ backward: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[state.mode]);
    const noise = ((Math.imul(cycle ^ (context.seed ?? 0), 1103515245) + 12345) >>> 0) / 0xffffffff * 2 - 1;
    const factor = skeet.jitterMode === 'random' ? noise : skeet.jitterMode === 'offset' ? (alternate + 1) / 2 : alternate;
    const side = (inverted ? -1 : 1) * (skeet.desyncMode === 'alternate' ? alternate : skeet.desyncMode === 'sway' ? Math.sin(now * Math.PI / 1000) : 1);
    const cover = skeet.freestanding ? clamp(context.coverSide ?? 0, -1, 1) * Math.PI / 2 : 0;
    const real = wrapAngle(base + (state.yawOffset + state.jitter * factor) * Math.PI / 180 + cover);
    return { real, fake: wrapAngle(real + state.desync * side * Math.PI / 180) };
  }
  const side = inverted ? -1 : 1;
  const base = a.mode === 'spin' ? now * a.spinSpeed * Math.PI / 180000 : lookYaw + ({ backward: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[a.mode]);
  const jitter = (Math.floor(now / 180) % 2 ? 1 : -1) * a.jitter * Math.PI / 180;
  const real = wrapAngle(base + jitter);
  return { real, fake: wrapAngle(real + a.desync * side * Math.PI / 180) };
}

/** One shared charge. Switching modes, reloading or changing guns cannot reset it. */
export class HvhExploitClock {
  readyAt = 0;
  burstUntil = 0;
  private bonusUsed = true;
  reset(now: number): void { this.readyAt = now + HVH.doubleTapRecharge; this.burstUntil = 0; this.bonusUsed = true; }
  charge(now: number): number { return clamp(1 - (this.readyAt - now) / HVH.doubleTapRecharge, 0, 1); }
  interval(w: WeaponDef, mode: HvhLoadout['exploit'], now: number): number {
    return mode === 'doubleTap' && !w.projectile && !w.melee && !w.burst && !this.bonusUsed && now <= this.burstUntil ? Math.max(80, w.fireInterval * 0.2) : w.fireInterval;
  }
  /** Called only after an accepted shot; rejected requests spend nothing. */
  fired(w: WeaponDef, mode: HvhLoadout['exploit'], now: number): boolean {
    if (!this.bonusUsed && now <= this.burstUntil) { this.bonusUsed = true; return false; }
    if (w.projectile || w.melee || w.burst) return false;
    if (mode === 'off' || now < this.readyAt) return false;
    this.readyAt = now + (mode === 'doubleTap' ? HVH.doubleTapRecharge : HVH.hideShotsRecharge);
    this.bonusUsed = mode !== 'doubleTap';
    this.burstUntil = mode === 'doubleTap' ? now + HVH.burstWindow : 0;
    return mode === 'hideShots';
  }
  get burst(): boolean { return !this.bonusUsed; }
}
