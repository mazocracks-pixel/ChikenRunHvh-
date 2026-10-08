import { clamp, wrapAngle } from './math';
import { CHICKEN_POSE } from './chickenPose';

export const HVH_PANEL_IDS = ['lab', 'skeet', 'manual'] as const;
export type HvhPanelId = typeof HVH_PANEL_IDS[number];

export const HVH_STANCES = ['standing', 'moving', 'slowwalking', 'crouching', 'airborne', 'aircrouch'] as const;
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
  jitterMode: 'center' | 'offset' | 'random' | 'threeway';
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
  return context.onGround === false ? context.crouching ? 'aircrouch' : 'airborne' : context.crouching ? 'crouching'
    : (context.speed ?? 0) > 2 ? 'moving' : (context.speed ?? 0) > 0.25 ? 'slowwalking' : 'standing';
}
export function defaultSkeetAntiAim(): SkeetAntiAim {
  return { enabled: true, atTargets: false, freestanding: false, jitterMode: 'center', interval: 180,
    desyncMode: 'alternate', visualPitch: 'look', states: {
      standing: { mode: 'backward', yawOffset: 0, desync: 45, jitter: 20 },
      moving: { mode: 'backward', yawOffset: 0, desync: 30, jitter: 12 },
      slowwalking: { mode: 'backward', yawOffset: 0, desync: 45, jitter: 10 },
      crouching: { mode: 'left', yawOffset: 0, desync: 40, jitter: 15 },
      airborne: { mode: 'backward', yawOffset: 0, desync: 25, jitter: 30 },
      aircrouch: { mode: 'left', yawOffset: 0, desync: 20, jitter: 18 },
    } };
}
export function sanitizeSkeetAntiAim(raw: unknown): SkeetAntiAim {
  const out = defaultSkeetAntiAim();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of ['enabled', 'atTargets', 'freestanding'] as const) if (typeof r[key] === 'boolean') out[key] = r[key];
  for (const [key, choices] of [['jitterMode', ['center', 'offset', 'random', 'threeway']], ['desyncMode', ['static', 'alternate', 'sway']], ['visualPitch', ['look', 'down', 'up', 'zero']]] as const) {
    if (choices.includes(r[key] as never)) (out as unknown as Record<string, unknown>)[key] = r[key];
  }
  if (typeof r.interval === 'number' && Number.isFinite(r.interval)) out.interval = clamp(r.interval, 1, 600);
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
  core?: HvhCoreSettings;
  antiAim: { enabled: boolean; mode: 'backward' | 'left' | 'right' | 'spin'; desync: number; jitter: number; jitterInterval?: number; spinSpeed: number; pitch?: SkeetAntiAim['visualPitch'] };
  exploit: 'off' | 'doubleTap' | 'hideShots';
  skeet?: SkeetAntiAim;
}
export interface HvhCoreSettings {
  era: 'legacy' | 'desync' | 'tickbase' | 'defensive';
  fakeLag: number; fakeLagMode: 'static' | 'velocity' | 'random' | 'adaptive' | 'peek';
  fakeLagBreakOnShot: boolean;
  fakeDuck: boolean; antiBruteforce: boolean; defensive: boolean;
  latencyMs: number; jitterMs: number; packetLoss: number;
}
export function defaultHvhCore(): HvhCoreSettings {
  return { era: 'tickbase', fakeLag: 0, fakeLagMode: 'static', fakeLagBreakOnShot: true, fakeDuck: false, antiBruteforce: true,
    defensive: false, latencyMs: 0, jitterMs: 0, packetLoss: 0 };
}
export const HVH = { maxDesync: 58, maxJitter: 45, revealMs: 300, hideMs: 150 } as const;
export function defaultHvhLoadout(): HvhLoadout {
  return { core: defaultHvhCore(), antiAim: { enabled: false, mode: 'backward', desync: 40, jitter: 20, jitterInterval: 180, spinSpeed: 180, pitch: 'look' }, exploit: 'off' };
}
/** Public game mechanics. These never become developer stat multipliers. */
export function sanitizeHvhLoadout(raw: unknown): HvhLoadout {
  const out = defaultHvhLoadout();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.core && typeof r.core === 'object') {
    const core = r.core as Record<string, unknown>, c = out.core!;
    if (['legacy', 'desync', 'tickbase', 'defensive'].includes(String(core.era))) c.era = core.era as HvhCoreSettings['era'];
    if (['static', 'velocity', 'random', 'adaptive', 'peek'].includes(String(core.fakeLagMode))) c.fakeLagMode = core.fakeLagMode as HvhCoreSettings['fakeLagMode'];
    for (const key of ['fakeDuck', 'antiBruteforce', 'defensive', 'fakeLagBreakOnShot'] as const) if (typeof core[key] === 'boolean') c[key] = core[key];
    for (const [key, max] of [['fakeLag', 12], ['latencyMs', 150], ['jitterMs', 50], ['packetLoss', 0.1]] as const)
      if (typeof core[key] === 'number' && Number.isFinite(core[key])) c[key] = clamp(core[key], 0, max);
    c.fakeLag = Math.round(c.fakeLag);
  }
  if (r.skeet && typeof r.skeet === 'object') out.skeet = sanitizeSkeetAntiAim(r.skeet);
  if (['off', 'doubleTap', 'hideShots'].includes(String(r.exploit))) out.exploit = r.exploit as HvhLoadout['exploit'];
  if (r.antiAim && typeof r.antiAim === 'object') {
    const a = r.antiAim as Record<string, unknown>;
    out.antiAim.enabled = a.enabled === true;
    if (['backward', 'left', 'right', 'spin'].includes(String(a.mode))) out.antiAim.mode = a.mode as HvhLoadout['antiAim']['mode'];
    if (['look', 'down', 'up', 'zero'].includes(String(a.pitch))) out.antiAim.pitch = a.pitch as SkeetAntiAim['visualPitch'];
    for (const [key, min, max] of [['desync', 0, HVH.maxDesync], ['jitter', 0, HVH.maxJitter], ['jitterInterval', 1, 600], ['spinSpeed', 90, 540]] as const) {
      const v = a[key];
      if (typeof v === 'number' && Number.isFinite(v)) out.antiAim[key] = clamp(v, min, max);
    }
  }
  return out;
}
/** A physical head pose. Shot direction and the player's camera remain independent. */
export function hvhPitch(lookPitch: number, loadout: HvhLoadout, revealed = false): number {
  // Skeet's Pitch setting applies with or without its state builder (it has no separate fallback pitch).
  const mode = loadout.skeet ? loadout.skeet.visualPitch : loadout.antiAim.pitch;
  const pitch = !loadout.antiAim.enabled || revealed || !mode || mode === 'look' ? lookPitch
    : mode === 'down' ? -1.15 : mode === 'up' ? 0.85 : 0;
  return clamp(Number.isFinite(pitch) ? pitch : 0, -CHICKEN_POSE.pitchLimit, CHICKEN_POSE.pitchLimit);
}
/** Requested eye/body angles. Authoritative animation constrains the body before combat; only eyes are public. */
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
    const factor = skeet.jitterMode === 'random' ? noise : skeet.jitterMode === 'threeway' ? cycle % 3 - 1 : skeet.jitterMode === 'offset' ? (alternate + 1) / 2 : alternate;
    const coverSide = skeet.freestanding ? clamp(context.coverSide ?? 0, -1, 1) : 0;
    const side = (inverted ? -1 : 1) * (coverSide || (skeet.desyncMode === 'alternate' ? alternate : skeet.desyncMode === 'sway' ? Math.sin(now * Math.PI / 1000) : 1));
    const real = wrapAngle(base + (state.yawOffset + state.jitter * factor) * Math.PI / 180);
    return { real, fake: wrapAngle(real + state.desync * side * Math.PI / 180) };
  }
  const side = inverted ? -1 : 1;
  const base = a.mode === 'spin' ? now * a.spinSpeed * Math.PI / 180000 : lookYaw + ({ backward: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[a.mode]);
  const jitter = (Math.floor(now / (a.jitterInterval ?? 180)) % 2 ? 1 : -1) * a.jitter * Math.PI / 180;
  const real = wrapAngle(base + jitter);
  return { real, fake: wrapAngle(real + a.desync * side * Math.PI / 180) };
}
