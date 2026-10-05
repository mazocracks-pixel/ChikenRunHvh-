import { clamp } from '@game/shared';
import { keyboardLockSupported } from './fullscreen';
import { storage } from './ui/dom';

export type Quality = 'low' | 'medium' | 'high';
export type CrosshairStyle = 'cross' | 'crossDot' | 'dot' | 'circle' | 'circleDot' | 'tee';

export interface CrosshairSettings {
  style: CrosshairStyle;
  /** CSS hex colour, e.g. '#ffffff'. */
  color: string;
  /** Line length in px (or the ring's size). */
  size: number;
  thickness: number;
  /** Gap between the centre and the lines, in px. */
  gap: number;
  outline: boolean;
  opacity: number;
  /** Lines open up with the weapon's current spread. */
  dynamic: boolean;
}

export interface Settings {
  /** Multiplier on the base mouse speed (1 = default). */
  mouseSensitivity: number;
  /** Multiplier while zoomed / scoped, on top of the automatic zoom scaling. */
  zoomSensitivity: number;
  /** Multiplier on the base drag-to-look speed on touch screens. */
  touchSensitivity: number;
  invertY: boolean;
  /** Play matches full screen; in Chrome / Edge that also stops Ctrl+W (crouch + forward) closing the tab. */
  fullscreen: boolean;
  quality: Quality;
  /** Vertical field of view in degrees. */
  fov: number;
  crosshair: CrosshairSettings;
  /** Show developer jumpscares (a mega?dev prank); off shows a small note instead. */
  jumpscares: boolean;
}

export const CROSSHAIR_STYLES: { id: CrosshairStyle; label: string }[] = [
  { id: 'cross', label: 'Cross' },
  { id: 'crossDot', label: 'Cross + dot' },
  { id: 'dot', label: 'Dot' },
  { id: 'circle', label: 'Circle' },
  { id: 'circleDot', label: 'Circle + dot' },
  { id: 'tee', label: 'T-shape' },
];

export const CROSSHAIR_COLORS = ['#ffffff', '#4cff4c', '#ffe14c', '#4cf0ff', '#ff4cf5', '#ff4c4c'];

/** Radians of turn per pixel of mouse movement at sensitivity 1. */
export const MOUSE_BASE = 0.0022;
/** Radians of turn per pixel of finger drag at sensitivity 1. */
export const TOUCH_BASE = 0.0048;

export const LIMITS = {
  sensitivity: { min: 0.1, max: 5, step: 0.05 },
  zoomSensitivity: { min: 0.2, max: 2, step: 0.05 },
  fov: { min: 60, max: 100, step: 1 },
  size: { min: 2, max: 24, step: 1 },
  thickness: { min: 1, max: 6, step: 1 },
  gap: { min: 0, max: 20, step: 1 },
  opacity: { min: 0.2, max: 1, step: 0.05 },
} as const;

const KEY = 'chikengun:settings';
/** Before the settings store existed, sensitivity was saved alone, in radians per pixel. */
const LEGACY_SENSITIVITY_KEY = 'chikengun:sensitivity';

function prefersLowPower(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function defaultCrosshair(): CrosshairSettings {
  return { style: 'cross', color: '#ffffff', size: 8, thickness: 2, gap: 4, outline: true, opacity: 1, dynamic: true };
}

export function defaultSettings(): Settings {
  return {
    mouseSensitivity: 1,
    zoomSensitivity: 1,
    touchSensitivity: 1,
    invertY: false,
    // On by default only where it fixes Ctrl+W (Keyboard Lock); never on touch screens.
    fullscreen: keyboardLockSupported() && !prefersLowPower(),
    quality: prefersLowPower() ? 'medium' : 'high',
    fov: 70,
    crosshair: defaultCrosshair(),
    jumpscares: true,
  };
}

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback);
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const color = (value: unknown, fallback: string) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);

/** Fills in anything missing or out of range, so a hand-edited or old save can't break the game. */
function sanitize(raw: Partial<Settings> | null): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const c = (raw.crosshair ?? {}) as Partial<CrosshairSettings>;
  const L = LIMITS;
  return {
    mouseSensitivity: num(raw.mouseSensitivity, d.mouseSensitivity, L.sensitivity.min, L.sensitivity.max),
    zoomSensitivity: num(raw.zoomSensitivity, d.zoomSensitivity, L.zoomSensitivity.min, L.zoomSensitivity.max),
    touchSensitivity: num(raw.touchSensitivity, d.touchSensitivity, L.sensitivity.min, L.sensitivity.max),
    invertY: raw.invertY === true,
    fullscreen: typeof raw.fullscreen === 'boolean' ? raw.fullscreen : d.fullscreen,
    quality: pick(raw.quality, ['low', 'medium', 'high'], d.quality),
    fov: num(raw.fov, d.fov, L.fov.min, L.fov.max),
    crosshair: {
      style: pick(c.style, CROSSHAIR_STYLES.map((s) => s.id), d.crosshair.style),
      color: color(c.color, d.crosshair.color),
      size: num(c.size, d.crosshair.size, L.size.min, L.size.max),
      thickness: num(c.thickness, d.crosshair.thickness, L.thickness.min, L.thickness.max),
      gap: num(c.gap, d.crosshair.gap, L.gap.min, L.gap.max),
      outline: typeof c.outline === 'boolean' ? c.outline : d.crosshair.outline,
      opacity: num(c.opacity, d.crosshair.opacity, L.opacity.min, L.opacity.max),
      dynamic: typeof c.dynamic === 'boolean' ? c.dynamic : d.crosshair.dynamic,
    },
    jumpscares: typeof raw.jumpscares === 'boolean' ? raw.jumpscares : d.jumpscares,
  };
}

function load(): Settings {
  let raw: Partial<Settings> | null = null;
  try {
    raw = JSON.parse(storage.get(KEY) ?? 'null') as Partial<Settings> | null;
  } catch {
    raw = null;
  }
  const legacy = Number(storage.get(LEGACY_SENSITIVITY_KEY));
  if (!raw && legacy > 0) raw = { mouseSensitivity: legacy / MOUSE_BASE };
  return sanitize(raw);
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

/** Merges a change (crosshair fields can be given individually), saves it, and notifies listeners. */
export function updateSettings(patch: Partial<Omit<Settings, 'crosshair'>> & { crosshair?: Partial<CrosshairSettings> }): Settings {
  current = sanitize({ ...current, ...patch, crosshair: { ...current.crosshair, ...patch.crosshair } });
  storage.set(KEY, JSON.stringify(current));
  storage.remove(LEGACY_SENSITIVITY_KEY);
  for (const fn of listeners) fn(current);
  return current;
}

/** Calls `fn` now and after every change. Returns an unsubscribe function. */
export function watchSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}
