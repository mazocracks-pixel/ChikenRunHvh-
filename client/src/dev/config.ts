import { DEFAULT_MODS, WEAPON_IDS, defaultHvhCore, defaultHvhLoadout, type HvhLoadout, type DevMods, type WeaponId } from '@game/shared';
import { defaultLook, type WorldLook } from '../game/look';
import { storage } from '../ui/dom';
import { SKEET_GROUPS, defaultSkeetConfig, type SkeetConfig } from './skeet/model';
import { HVH_STANCES, sanitizeSkeetAntiAim } from '@game/shared';
import { NATIVE_FIELDS } from './skeet/nativeFields';
import { DEFAULT_ERA_ID, ERAS } from '@game/shared/hvh/v2';

/** Config schema version. 2 = HvH v2 (tickbase intents); configs without it are migrated. */
export const CONFIG_VERSION = 2;

/**
 * Everything the developer menu can change. Plain JSON, so it can be saved, exported and
 * imported as a config. Gameplay-changing values only take effect when the server allows them.
 */
export interface DevConfig {
  version: number;
  skeet: SkeetConfig;
  hvh: HvhLoadout & {
    resolverPolicy: 'adaptive' | 'animation' | 'cycle';
    aim: { minDamage: number; hitchance: number; airHitchance: number; hpRelative: number; maxRecords: number;
      damageWeight: number; safetyWeight: number; accuracyWeight: number; confidenceWeight: number;
      forceSafe: boolean; preferSafe: boolean; multipoint: boolean; pointScale: number;
      bodyAim: 'off' | 'prefer' | 'lethal'; autowall: boolean; reaction: number; switchDelay: number; turnRate: number; damageOverride: number; overrideKey: string; bodyKey: string };
    movement: { autoStop: boolean; autoStopSlowWalk: boolean; autoStopBetweenShots: boolean; autoStopPredict: boolean; autoStopPredictMs: number;
      slowWalk: boolean; slowKey: string; peekAssist: boolean; peekKey: string; subtickStrafe: boolean };
    feedback: { shotLog: boolean; targetInfo: boolean; resolver: boolean };
    invertKey: string;
    /** Exploits tab: each press of defensiveKey asks for one defensive shift (v2 rooms only). */
    defensive: boolean;
    defensiveKey: string;
  };
  legit: {
    trigger: { enabled: boolean; delay: number; fov: number; key: string; visCheck: boolean };
    move: { bhop: boolean; autoStrafe: boolean; assist: boolean; jumpAssist: boolean };
    /** See chickens through walls as a silhouette (only the hidden parts). */
    wall: { enabled: boolean; enemies: boolean; teammates: boolean; enemyColor: string; teamColor: string; opacity: number };
  };
  rage: {
    aim: {
      enabled: boolean;
      lock: boolean;
      silent: boolean;
      instantSwitch: boolean;
      priority: 'health' | 'distance' | 'crosshair';
      hitbox: 'head' | 'body';
      fov: number;
      autoTarget: boolean;
    };
  };
  /** Colours of the level, sky and light (local, visual only). */
  world: WorldLook;
  weapons: { selected: WeaponId };
  visuals: {
    esp: { enabled: boolean; box: boolean; name: boolean; health: boolean; distance: boolean; weapon: boolean; skeleton: boolean; snaplines: boolean; headCircle: boolean; glow: boolean };
    world: { items: boolean; weapons: boolean; spawns: boolean; objectives: boolean; hitboxes: boolean; collision: boolean };
    colors: { enemy: string; friendly: string; npc: string; items: string; weapons: string; objectives: string; opacity: number };
  };
  misc: {
    crosshair: boolean;
    fpsCounter: boolean;
    ping: boolean;
    coords: boolean;
    velocity: boolean;
    speed: boolean;
    hitmarker: boolean;
    damageIndicator: boolean;
    autoJump: boolean;
    freeCam: boolean;
    spectator: boolean;
    mapInfo: boolean;
  };
  settings: {
    menuKey: string;
    scale: number;
    opacity: number;
    /** Multiplier on animation durations; 0 turns animations off. */
    animSpeed: number;
    theme: 'claude' | 'midnight' | 'carbon' | 'crimson' | 'ocean';
    accent: string;
    sounds: boolean;
    notifications: boolean;
  };
}

export function defaultConfig(panel: 'lab' | 'skeet' = 'lab'): DevConfig {
  const out: DevConfig = {
    version: CONFIG_VERSION,
    skeet: defaultSkeetConfig(),
    hvh: {
      ...defaultHvhLoadout(),
      resolverPolicy: panel === 'skeet' ? 'adaptive' : 'animation',
      aim: { minDamage: 20, hitchance: 60, airHitchance: 70, hpRelative: -1, maxRecords: 2, damageWeight: 1, safetyWeight: 20,
        forceSafe: false, preferSafe: true, multipoint: true, pointScale: 65,
        accuracyWeight: 15, confidenceWeight: 15, bodyAim: 'lethal', autowall: false, reaction: 120, switchDelay: 180, turnRate: 360, damageOverride: 1, overrideKey: 'KeyH', bodyKey: 'KeyJ' },
      movement: { autoStop: false, autoStopSlowWalk: false, autoStopBetweenShots: true, autoStopPredict: false, autoStopPredictMs: 200,
        slowWalk: false, slowKey: 'ShiftLeft', peekAssist: false, peekKey: 'KeyP', subtickStrafe: false },
      feedback: { shotLog: true, targetInfo: true, resolver: true }, invertKey: 'KeyK', defensive: false, defensiveKey: 'KeyO',
    },
    legit: {
      trigger: { enabled: false, delay: 120, fov: 1.5, key: '', visCheck: true },
      move: { bhop: false, autoStrafe: false, assist: false, jumpAssist: false },
      wall: { enabled: false, enemies: true, teammates: true, enemyColor: '#ff4d5e', teamColor: '#4dd2ff', opacity: 0.55 },
    },
    rage: {
      aim: { enabled: false, lock: true, silent: true, instantSwitch: false, priority: 'crosshair', hitbox: 'head', fov: 360, autoTarget: false },
    },
    world: defaultLook(),
    weapons: { selected: 'rifle' },
    visuals: {
      esp: { enabled: false, box: true, name: true, health: true, distance: true, weapon: false, skeleton: false, snaplines: false, headCircle: false, glow: false },
      world: { items: false, weapons: false, spawns: false, objectives: false, hitboxes: false, collision: false },
      colors: { enemy: '#ff4d5e', friendly: '#4dd2ff', npc: '#ffc94d', items: '#b46bff', weapons: '#ff9a3c', objectives: '#4dff88', opacity: 0.9 },
    },
    misc: {
      crosshair: true,
      fpsCounter: false,
      ping: false,
      coords: false,
      velocity: false,
      speed: false,
      hitmarker: true,
      damageIndicator: true,
      autoJump: false,
      freeCam: false,
      spectator: false,
      mapInfo: false,
    },
    settings: { menuKey: 'Insert', scale: 1, opacity: 0.97, animSpeed: 1, theme: 'claude', accent: '#d97757', sounds: true, notifications: true },
  };
  if (panel === 'skeet') Object.assign(out.settings, { theme: 'carbon', accent: '#b6d77a' });
  return out;
}

/** Numeric ranges (also used by the menu's sliders). */
export const RANGES: Record<string, { min: number; max: number; step: number }> = {
  'hvh.movement.autoStopPredictMs': { min: 50, max: 300, step: 10 },
  'hvh.aim.minDamage': { min: 1, max: 100, step: 1 },
  'hvh.aim.hitchance': { min: 0, max: 100, step: 1 },
  'hvh.aim.airHitchance': { min: 0, max: 100, step: 1 },
  'hvh.aim.pointScale': { min: 0, max: 85, step: 1 },
  'hvh.aim.hpRelative': { min: -1, max: 50, step: 1 },
  'hvh.aim.maxRecords': { min: 1, max: 6, step: 1 },
  'hvh.aim.damageWeight': { min: 0.1, max: 3, step: 0.1 },
  'hvh.aim.safetyWeight': { min: 0, max: 60, step: 1 },
  'hvh.aim.accuracyWeight': { min: 0, max: 60, step: 1 },
  'hvh.aim.confidenceWeight': { min: 0, max: 60, step: 1 },
  'hvh.aim.reaction': { min: 100, max: 350, step: 10 },
  'hvh.aim.switchDelay': { min: 100, max: 500, step: 10 },
  'hvh.aim.turnRate': { min: 90, max: 540, step: 10 },
  'hvh.aim.damageOverride': { min: 1, max: 100, step: 1 },
  'hvh.antiAim.desync': { min: 0, max: 58, step: 1 },
  // Choke limits follow the v2 era table (LATE_CSGO.maxChoke = 14); legacy rooms still clamp to 12.
  'hvh.core.fakeLag': { min: 0, max: ERAS[DEFAULT_ERA_ID]!.maxChoke, step: 1 },
  'skeet.fakeLag.limit': { min: 1, max: ERAS[DEFAULT_ERA_ID]!.maxChoke, step: 1 },
  'hvh.core.latencyMs': { min: 0, max: 150, step: 5 },
  'hvh.core.jitterMs': { min: 0, max: 50, step: 5 },
  'hvh.core.packetLoss': { min: 0, max: 0.1, step: 0.01 },
  'hvh.antiAim.jitter': { min: 0, max: 45, step: 1 },
  'hvh.antiAim.jitterInterval': { min: 1, max: 600, step: 1 },
  'hvh.antiAim.spinSpeed': { min: 90, max: 540, step: 10 },
  'legit.trigger.delay': { min: 100, max: 500, step: 10 },
  'legit.trigger.fov': { min: 0.25, max: 10, step: 0.25 },
  'legit.wall.opacity': { min: 0.1, max: 1, step: 0.05 },
  'rage.aim.fov': { min: 1, max: 360, step: 1 },
  'visuals.colors.opacity': { min: 0.1, max: 1, step: 0.05 },
  'world.clouds': { min: 0, max: 2, step: 0.05 },
  'world.fog': { min: 0.3, max: 3, step: 0.05 },
  'world.sunIntensity': { min: 0, max: 8, step: 0.1 },
  'world.ambient': { min: 0, max: 3, step: 0.05 },
  'world.exposure': { min: 0.3, max: 2.5, step: 0.05 },
  'settings.scale': { min: 0.7, max: 1.4, step: 0.05 },
  'settings.opacity': { min: 0.5, max: 1, step: 0.01 },
  'settings.animSpeed': { min: 0, max: 2, step: 0.1 },
};

/** Allowed values of the dropdowns. */
export const CHOICES: Record<string, readonly string[]> = {
  'skeet.fakeLag.mode': ['static','velocity','random','adaptive','peek'],
  'skeet.resolver.mode': ['adaptive', 'center'],
  'skeet.antiAim.jitterMode': ['center', 'offset', 'random', 'threeway'],
  'skeet.antiAim.desyncMode': ['static', 'alternate', 'sway'],
  'skeet.antiAim.visualPitch': ['look', 'down', 'up', 'zero'],
  'hvh.aim.bodyAim': ['off', 'prefer', 'lethal'],
  'hvh.resolverPolicy': ['adaptive', 'animation', 'cycle'],
  'hvh.antiAim.pitch': ['look', 'down', 'up', 'zero'],
  'hvh.antiAim.mode': ['backward', 'left', 'right', 'spin'],
  'hvh.exploit': ['off', 'doubleTap', 'hideShots'],
  'hvh.core.era': ['legacy', 'desync', 'tickbase', 'defensive'],
  'skeet.era': Object.keys(ERAS),
  'hvh.core.fakeLagMode': ['static', 'velocity', 'random', 'adaptive', 'peek'],
  'rage.aim.priority': ['health', 'distance', 'crosshair'],
  'rage.aim.hitbox': ['head', 'body'],
  'weapons.selected': WEAPON_IDS,
  'settings.theme': ['claude', 'midnight', 'carbon', 'crimson', 'ocean'],
};

Object.assign(RANGES, {
  'skeet.resolver.history': { min: 4, max: 16, step: 1 },
  'skeet.resolver.memoryMs': { min: 300, max: 1200, step: 50 },
  'skeet.resolver.preferBodyBelow': { min: 0, max: 100, step: 1 },
  'skeet.resolver.missedShots': { min: 0, max: 4, step: 1 },
  'skeet.antiAim.interval': { min: 1, max: 600, step: 1 },
});
for (const id of SKEET_GROUPS) {
  for (const [key, min, max] of [['minDamage', 1, 100], ['hitchance', 0, 100], ['pointScale', 0, 75]] as const)
    RANGES[`skeet.profiles.${id}.${key}`] = { min, max, step: 1 };
  CHOICES[`skeet.profiles.${id}.bodyAim`] = ['off', 'prefer', 'lethal'];
}
for (const id of HVH_STANCES) {
  for (const [key, min, max] of [['yawOffset', -180, 180], ['desync', 0, 58], ['jitter', 0, 45]] as const)
    RANGES[`skeet.antiAim.states.${id}.${key}`] = { min, max, step: 1 };
  CHOICES[`skeet.antiAim.states.${id}.mode`] = ['backward', 'left', 'right', 'spin'];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getPath(config: DevConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), config);
}

export function setPath(config: DevConfig, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  let o = config as unknown as Record<string, unknown>;
  for (const k of keys) o = o[k] as Record<string, unknown>;
  o[last] = value;
}

/**
 * Takes the defaults and copies over every value from `raw` that has the right type and is in
 * range. Unknown keys are dropped, so imported or old configs can never inject anything odd.
 */
export function sanitizeConfig(raw: unknown): DevConfig {
  const out = defaultConfig();
  const walk = (def: Record<string, unknown>, src: unknown, prefix: string) => {
    if (!src || typeof src !== 'object') return;
    const s = src as Record<string, unknown>;
    for (const [key, d] of Object.entries(def)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const v = path === 'skeet.resolver.mode' && (s[key] === 'real' || s[key] === 'visual') ? 'center' : s[key];
      if (d && typeof d === 'object') walk(d as Record<string, unknown>, v, path);
      else if (typeof d === 'boolean' && typeof v === 'boolean') def[key] = v;
      else if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) {
        const r = RANGES[path];
        def[key] = r ? Math.min(r.max, Math.max(r.min, v)) : v;
      } else if (typeof d === 'string' && typeof v === 'string') {
        const choices = CHOICES[path];
        if (choices) {
          if (choices.includes(v)) def[key] = v;
        } else if (d.startsWith('#')) {
          if (/^#[0-9a-f]{6}$/i.test(v)) def[key] = v.toLowerCase();
        } else if (v.length <= 32 && /^[A-Za-z0-9]*$/.test(v)) {
          def[key] = v; // key codes
        }
      }
    }
  };
  walk(out as unknown as Record<string, unknown>, raw, '');
  for (const f of NATIVE_FIELDS) {
    const v = Math.max(f.min,Math.min(f.max,out.skeet.native[f.key] ?? f.default));
    out.skeet.native[f.key] = f.kind === 'float' ? v : Math.round(v);
  }
  out.skeet.fakeLag.limit = Math.round(out.skeet.fakeLag.limit);
  const previous = raw as { skeet?: { fakeLag?: unknown }; hvh?: { core?: { fakeLag?: unknown } } } | null;
  const core = out.hvh.core ?? defaultHvhCore();
  if (previous?.skeet && previous.skeet.fakeLag === undefined && typeof previous.hvh?.core?.fakeLag === 'number' && core.fakeLag > 0) {
    out.skeet.fakeLag = {enabled:true,limit:core.fakeLag,mode:core.fakeLagMode,breakOnShot:core.fakeLagBreakOnShot};
  }
  out.skeet.antiAim = sanitizeSkeetAntiAim(out.skeet.antiAim);
  out.rage.aim.silent = true;
  out.rage.aim.instantSwitch = false;
  out.legit.trigger.visCheck = true;
  out.misc.freeCam = out.misc.spectator = false;
  out.world.wireframe = false;
  if (!out.settings.menuKey) out.settings.menuKey = 'Insert';
  out.version = CONFIG_VERSION;
  // Saved before the mega?dev look and never customised: move to the new default theme.
  if (out.settings.theme === 'midnight' && out.settings.accent === '#7c5cff') {
    out.settings.theme = 'claude';
    out.settings.accent = '#d97757';
  }
  return out;
}

/** Every leaf path of a config ("hvh.antiAim.desync", ...). */
function leafPaths(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

/**
 * Legacy settings with no v2 meaning: v2 runs anti-aim from AntiAimConfig (base, jitter, desync,
 * invert) and exploits from CommandIntent bits. Legacy rooms (the default until Task 15) still use
 * them, so migration keeps their values and only reports them as unused in v2 rooms.
 */
const UNMAPPED = [
  'hvh.core.defensive', // automatic defensive transition on threat; v2 uses the Exploits tab Defensive bind
  'hvh.core.antiBruteforce', // legacy server side flip; no AntiAimConfig field
  'hvh.core.fakeDuck', // no CommandIntent bit
  // Per-stance builder: AntiAimConfig has a single stance.
  'skeet.antiAim.enabled', 'skeet.antiAim.atTargets', 'skeet.antiAim.freestanding', 'skeet.antiAim.jitterMode',
  'skeet.antiAim.interval', 'skeet.antiAim.desyncMode', 'skeet.antiAim.states',
] as const;

/** True for a `reset` entry (optionally "<config name>: <path>") that names a kept legacy-only setting. */
function isLegacyOnly(entry: string): boolean {
  const path = entry.slice(entry.lastIndexOf(': ') + 1).trim();
  return UNMAPPED.some((p) => path === p || path.startsWith(`${p}.`));
}

/**
 * Brings any saved config to the current schema. Clean mappings are kept (anti-aim base, jitter and
 * desync, fake-lag limit clamped to maxChoke, the Double Tap / Hide Shots choice, and everything
 * that is not HvH mechanics). `reset` lists each customised setting v2 rooms cannot use; their
 * values are kept for legacy rooms. Unreadable values are dropped to defaults by sanitizeConfig.
 * A corrupt or non-object config gives the defaults with every field in `reset`.
 */
export function migrateConfig(old: unknown): { config: DevConfig; reset: string[] } {
  if (!old || typeof old !== 'object' || Array.isArray(old)) return { config: defaultConfig(), reset: leafPaths(defaultConfig()) };
  const config = sanitizeConfig(old);
  if ((old as { version?: unknown }).version === CONFIG_VERSION) return { config, reset: [] };
  const defaults = defaultConfig(), reset: string[] = [];
  for (const prefix of UNMAPPED) {
    for (const path of leafPaths(getPath(defaults, prefix), prefix)) {
      if (getPath(config, path) !== getPath(defaults, path)) reset.push(path);
    }
  }
  // The v2 era selection starts at the default; legacy hvh.core.era stays as loaded for legacy rooms.
  config.skeet.era = DEFAULT_ERA_ID;
  return { config, reset };
}

/** The gameplay modifiers this config asks the server for. */
export function toServerMods(c: DevConfig): Partial<DevMods> {
  void c;
  return { ...DEFAULT_MODS };
}

// ---------------------------------------------------------------------------
// Saved configs
// ---------------------------------------------------------------------------

const CURRENT_KEY = 'chikengun:dev';
const CONFIGS_KEY = 'chikengun:dev-configs';

export interface NamedConfig {
  name: string;
  config: DevConfig;
}

/** Ready-made configs, added the first time the menu opens. */
export function presetConfigs(panel: 'lab' | 'skeet' = 'lab'): NamedConfig[] {
  if (panel === 'skeet') {
    const balanced = defaultConfig('skeet'); balanced.rage.aim.enabled = balanced.visuals.esp.enabled = true;
    const scout = structuredClone(balanced); scout.rage.aim.fov = 20; scout.hvh.exploit = 'hideShots';
    scout.skeet.profiles.snipers.hitchance = 85;
    const aggressive = structuredClone(balanced); aggressive.rage.aim.autoTarget = aggressive.hvh.antiAim.enabled = true;
    aggressive.skeet.antiAim.freestanding = true; aggressive.hvh.exploit = 'doubleTap'; aggressive.hvh.defensive = true;
    return [{ name: 'Skeet Balanced', config: balanced }, { name: 'Skeet Scout', config: scout }, { name: 'Skeet Aggressive', config: aggressive }];
  }
  const balanced = defaultConfig();
  balanced.rage.aim.enabled = true;
  balanced.visuals.esp.enabled = true;
  balanced.hvh.movement.autoStop = true;
  const precision = structuredClone(balanced);
  Object.assign(precision.hvh.aim, { minDamage: 40, hitchance: 80, reaction: 180 });
  precision.rage.aim.fov = 20;
  precision.hvh.exploit = 'hideShots';
  const aggressive = structuredClone(balanced);
  Object.assign(aggressive.hvh.aim, { minDamage: 12, hitchance: 45 });
  aggressive.rage.aim.autoTarget = true;
  aggressive.hvh.antiAim.enabled = true;
  aggressive.hvh.exploit = 'doubleTap';
  aggressive.hvh.aim.autowall = true;
  aggressive.hvh.movement.peekAssist = true;
  const scout = defaultConfig();
  scout.visuals.esp.enabled = true;
  scout.visuals.esp.weapon = true;
  scout.misc.fpsCounter = scout.misc.ping = true;
  return [{ name: 'Balanced', config: balanced }, { name: 'Precision', config: precision }, { name: 'Aggressive', config: aggressive }, { name: 'Scout', config: scout }];
}

const panelKey = (key: string, panel: 'lab' | 'skeet') => panel === 'lab' ? key : `${key}:${panel}`;
/**
 * The saved current config, migrated. `reset` stays non-empty until the migrated config is saved
 * (saveCurrent), so the caller shows its notice once and then saves.
 */
export function loadCurrentMigrated(panel: 'lab' | 'skeet' = 'lab'): { config: DevConfig; reset: string[] } {
  const text = storage.get(panelKey(CURRENT_KEY, panel));
  if (!text) return { config: defaultConfig(panel), reset: [] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = undefined; }
  const out = migrateConfig(raw);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? out : { config: defaultConfig(panel), reset: out.reset };
}

export function loadCurrent(panel: 'lab' | 'skeet' = 'lab'): DevConfig {
  return loadCurrentMigrated(panel).config;
}

export function saveCurrent(config: DevConfig, panel: 'lab' | 'skeet' = 'lab'): void {
  storage.set(panelKey(CURRENT_KEY, panel), JSON.stringify(config));
}

/** Saved named configs, migrated; `reset` lists "<config name>: <field>" for each reset setting. */
export function loadConfigsMigrated(panel: 'lab' | 'skeet' = 'lab'): { configs: NamedConfig[]; reset: string[] } {
  try {
    const raw = JSON.parse(storage.get(panelKey(CONFIGS_KEY, panel)) ?? 'null') as unknown;
    if (!Array.isArray(raw)) return { configs: presetConfigs(panel), reset: [] };
    const reset: string[] = [];
    const configs = raw
      .filter((c): c is { name: string; config: unknown } => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string')
      .map((c) => {
        const name = cleanName(c.name), m = migrateConfig(c.config);
        reset.push(...m.reset.map((f) => `${name}: ${f}`));
        return { name, config: m.config };
      });
    return { configs, reset };
  } catch {
    return { configs: presetConfigs(panel), reset: [] };
  }
}

export function loadConfigs(panel: 'lab' | 'skeet' = 'lab'): NamedConfig[] {
  return loadConfigsMigrated(panel).configs;
}

export function saveConfigs(list: NamedConfig[], panel: 'lab' | 'skeet' = 'lab'): void {
  storage.set(panelKey(CONFIGS_KEY, panel), JSON.stringify(list));
}

export function cleanName(name: string): string {
  return name.replace(/[^\w \-.]/g, '').trim().slice(0, 24) || 'Config';
}

/** A config file to share: tagged, so importing random JSON is rejected politely. */
export function exportConfig(named: NamedConfig): string {
  // The format id predates the rename; kept so older exports still import.
  return JSON.stringify({ format: 'chikengun-dev-config', version: CONFIG_VERSION, name: named.name, config: named.config }, null, 2);
}

export function importConfig(text: string): NamedConfig & { reset: string[] } {
  const raw = JSON.parse(text) as { format?: unknown; name?: unknown; config?: unknown };
  if (!raw || raw.format !== 'chikengun-dev-config') throw new Error('Not a ChikenRunHvh developer config.');
  const { config, reset } = migrateConfig(raw.config);
  return { name: cleanName(typeof raw.name === 'string' ? raw.name : 'Imported'), config, reset };
}

/** One-line notice for a migration's `reset` entries. */
export function migrationNotice(reset: readonly string[]): string {
  if (leafPaths(defaultConfig()).every((f) => reset.includes(f))) return 'Saved config was unreadable: all settings were reset to defaults';
  const kept = reset.filter(isLegacyOnly), dropped = reset.filter((e) => !isLegacyOnly(e));
  return ['Config updated for HvH v2.', kept.length ? `Not used in v2 rooms (kept for legacy): ${kept.join(', ')}.` : '',
    dropped.length ? `Reset to defaults: ${dropped.join(', ')}.` : ''].filter(Boolean).join(' ');
}

const NOTICE_KEY = 'chikengun:dev-migration-notice';
/** Migration notice entries not shown yet; they survive reloads until clearMigrationNotice. */
export function pendingMigrationNotice(): string[] {
  try {
    const raw = JSON.parse(storage.get(NOTICE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}
/** Adds entries to the pending notice (deduplicated) and returns the whole pending list. */
export function queueMigrationNotice(entries: readonly string[]): string[] {
  const all = [...new Set([...pendingMigrationNotice(), ...entries])];
  if (entries.length) storage.set(NOTICE_KEY, JSON.stringify(all));
  return all;
}
export function clearMigrationNotice(): void {
  storage.remove(NOTICE_KEY);
}
