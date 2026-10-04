import { DEFAULT_MODS, MOD_LIMITS, WEAPON_IDS, defaultHvhLoadout, type HvhLoadout, type DevMods, type WeaponId } from '@game/shared';
import { defaultLook, type WorldLook } from '../game/look';
import { storage } from '../ui/dom';

/**
 * Everything the developer menu can change. Plain JSON, so it can be saved, exported and
 * imported as a config. Gameplay-changing values only take effect when the server allows them.
 */
export interface DevConfig {
  hvh: HvhLoadout & {
    aim: { minDamage: number; hitchance: number; bodyAim: 'off' | 'prefer' | 'lethal'; autowall: boolean; reaction: number; switchDelay: number; turnRate: number; damageOverride: number; overrideKey: string; bodyKey: string };
    movement: { autoStop: boolean; slowWalk: boolean; slowKey: string; peekAssist: boolean; peekKey: string };
    feedback: { shotLog: boolean; targetInfo: boolean; resolver: boolean };
    invertKey: string;
  };
  legit: {
    aim: {
      enabled: boolean;
      /** Degrees from the crosshair a target must be within. */
      fov: number;
      /** 1 = snappy, 20 = very gentle. */
      smooth: number;
      /** 0-100 % of the correction applied each frame. */
      strength: number;
      /** ms a target must stay in view before assist kicks in. */
      reaction: number;
      target: 'head' | 'body' | 'nearest';
      visCheck: boolean;
      teamCheck: boolean;
      /** Hold-to-assist key; '' = always on. */
      key: string;
      whileFiring: boolean;
      whileAds: boolean;
    };
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
    weapon: { noRecoil: boolean; noSpread: boolean; infiniteAmmo: boolean; instantReload: boolean; rapidFire: boolean; automatic: boolean; infiniteMag: boolean; noRocketCooldown: boolean; noRocketDamage: boolean };
    move: { speed: number; jump: number; fly: boolean; noclip: boolean; infiniteStamina: boolean; lowGravity: boolean };
    antiAim: {
      /** Spin bot: your chicken's body spins for everyone else; your view and aim don't. */
      spin: boolean;
      /** Degrees per second. */
      speed: number;
      direction: 'right' | 'left' | 'jitter';
      /** Head tilt others see. */
      pitch: 'normal' | 'down' | 'up';
    };
  };
  /** Colours of the level, sky and light (local, visual only). */
  world: WorldLook;
  weapons: { selected: WeaponId; fireRate: number; damage: number; recoil: number; spread: number; projectileSpeed: number; magazine: number };
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

export function defaultConfig(): DevConfig {
  return {
    hvh: {
      ...defaultHvhLoadout(),
      aim: { minDamage: 20, hitchance: 60, bodyAim: 'lethal', autowall: false, reaction: 120, switchDelay: 180, turnRate: 360, damageOverride: 1, overrideKey: 'KeyH', bodyKey: 'KeyJ' },
      movement: { autoStop: false, slowWalk: false, slowKey: 'ShiftLeft', peekAssist: false, peekKey: 'KeyZ' },
      feedback: { shotLog: true, targetInfo: true, resolver: true }, invertKey: 'KeyK',
    },
    legit: {
      aim: { enabled: false, fov: 6, smooth: 8, strength: 60, reaction: 120, target: 'body', visCheck: true, teamCheck: true, key: '', whileFiring: false, whileAds: false },
      trigger: { enabled: false, delay: 120, fov: 1.5, key: '', visCheck: true },
      move: { bhop: false, autoStrafe: false, assist: false, jumpAssist: false },
      wall: { enabled: false, enemies: true, teammates: true, enemyColor: '#ff4d5e', teamColor: '#4dd2ff', opacity: 0.55 },
    },
    rage: {
      aim: { enabled: false, lock: true, silent: false, instantSwitch: false, priority: 'crosshair', hitbox: 'head', fov: 35, autoTarget: false },
      weapon: { noRecoil: false, noSpread: false, infiniteAmmo: false, instantReload: false, rapidFire: false, automatic: false, infiniteMag: false, noRocketCooldown: false, noRocketDamage: false },
      move: { speed: 1, jump: 1, fly: false, noclip: false, infiniteStamina: false, lowGravity: false },
      antiAim: { spin: false, speed: 720, direction: 'right', pitch: 'normal' },
    },
    world: defaultLook(),
    weapons: { selected: 'rifle', fireRate: 1, damage: 1, recoil: 1, spread: 1, projectileSpeed: 1, magazine: 1 },
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
}

/** Numeric ranges (also used by the menu's sliders). */
export const RANGES: Record<string, { min: number; max: number; step: number }> = {
  'hvh.aim.minDamage': { min: 1, max: 100, step: 1 },
  'hvh.aim.hitchance': { min: 0, max: 100, step: 1 },
  'hvh.aim.reaction': { min: 100, max: 350, step: 10 },
  'hvh.aim.switchDelay': { min: 100, max: 500, step: 10 },
  'hvh.aim.turnRate': { min: 90, max: 540, step: 10 },
  'hvh.aim.damageOverride': { min: 1, max: 100, step: 1 },
  'hvh.antiAim.desync': { min: 0, max: 58, step: 1 },
  'hvh.antiAim.jitter': { min: 0, max: 45, step: 1 },
  'hvh.antiAim.spinSpeed': { min: 90, max: 540, step: 10 },
  'legit.aim.fov': { min: 1, max: 30, step: 0.5 },
  'legit.aim.smooth': { min: 1, max: 20, step: 0.5 },
  'legit.aim.strength': { min: 0, max: 100, step: 1 },
  'legit.aim.reaction': { min: 100, max: 350, step: 10 },
  'legit.trigger.delay': { min: 100, max: 500, step: 10 },
  'legit.trigger.fov': { min: 0.25, max: 10, step: 0.25 },
  'legit.wall.opacity': { min: 0.1, max: 1, step: 0.05 },
  'rage.aim.fov': { min: 1, max: 60, step: 1 },
  'rage.antiAim.speed': { min: 60, max: 3600, step: 30 },
  'rage.move.speed': { ...MOD_LIMITS.speed, step: 0.05 },
  'rage.move.jump': { ...MOD_LIMITS.jump, step: 0.05 },
  'weapons.fireRate': { ...MOD_LIMITS.fireRate, step: 0.05 },
  'weapons.damage': { ...MOD_LIMITS.damage, step: 0.1 },
  'weapons.recoil': { min: 0, max: 3, step: 0.05 },
  'weapons.spread': { ...MOD_LIMITS.spread, step: 0.05 },
  'weapons.projectileSpeed': { ...MOD_LIMITS.projectileSpeed, step: 0.05 },
  'weapons.magazine': { ...MOD_LIMITS.magazine, step: 0.1 },
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
  'hvh.aim.bodyAim': ['off', 'prefer', 'lethal'],
  'hvh.antiAim.mode': ['backward', 'left', 'right', 'spin'],
  'hvh.exploit': ['off', 'doubleTap', 'hideShots'],
  'legit.aim.target': ['head', 'body', 'nearest'],
  'rage.aim.priority': ['health', 'distance', 'crosshair'],
  'rage.aim.hitbox': ['head', 'body'],
  'rage.antiAim.direction': ['right', 'left', 'jitter'],
  'rage.antiAim.pitch': ['normal', 'down', 'up'],
  'weapons.selected': WEAPON_IDS,
  'settings.theme': ['claude', 'midnight', 'carbon', 'crimson', 'ocean'],
};

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
      const v = s[key];
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
  const fresh = defaultConfig();
  // Old exports remain readable, but retired powers never survive migration.
  out.rage.weapon = fresh.rage.weapon;
  out.rage.move = fresh.rage.move;
  out.rage.antiAim = fresh.rage.antiAim;
  out.weapons = { ...fresh.weapons, selected: out.weapons.selected };
  out.rage.aim.silent = out.rage.aim.instantSwitch = false;
  out.legit.aim.enabled = false;
  out.legit.aim.teamCheck = out.legit.aim.visCheck = out.legit.trigger.visCheck = true;
  out.misc.freeCam = out.misc.spectator = false;
  out.world.wireframe = false;
  if (!out.settings.menuKey) out.settings.menuKey = 'Insert';
  // Saved before the mega?dev look and never customised: move to the new default theme.
  if (out.settings.theme === 'midnight' && out.settings.accent === '#7c5cff') {
    out.settings.theme = 'claude';
    out.settings.accent = '#d97757';
  }
  return out;
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
export function presetConfigs(): NamedConfig[] {
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

export function loadCurrent(): DevConfig {
  try {
    return sanitizeConfig(JSON.parse(storage.get(CURRENT_KEY) ?? 'null'));
  } catch {
    return defaultConfig();
  }
}

export function saveCurrent(config: DevConfig): void {
  storage.set(CURRENT_KEY, JSON.stringify(config));
}

export function loadConfigs(): NamedConfig[] {
  try {
    const raw = JSON.parse(storage.get(CONFIGS_KEY) ?? 'null') as unknown;
    if (!Array.isArray(raw)) return presetConfigs();
    return raw
      .filter((c): c is { name: string; config: unknown } => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string')
      .map((c) => ({ name: cleanName(c.name), config: sanitizeConfig(c.config) }));
  } catch {
    return presetConfigs();
  }
}

export function saveConfigs(list: NamedConfig[]): void {
  storage.set(CONFIGS_KEY, JSON.stringify(list));
}

export function cleanName(name: string): string {
  return name.replace(/[^\w \-.]/g, '').trim().slice(0, 24) || 'Config';
}

/** A config file to share: tagged, so importing random JSON is rejected politely. */
export function exportConfig(named: NamedConfig): string {
  // The format id predates the rename; kept so older exports still import.
  return JSON.stringify({ format: 'chikengun-dev-config', version: 1, name: named.name, config: named.config }, null, 2);
}

export function importConfig(text: string): NamedConfig {
  const raw = JSON.parse(text) as { format?: unknown; name?: unknown; config?: unknown };
  if (!raw || raw.format !== 'chikengun-dev-config') throw new Error('Not a ChikenRunHvh developer config.');
  return { name: cleanName(typeof raw.name === 'string' ? raw.name : 'Imported'), config: sanitizeConfig(raw.config) };
}
