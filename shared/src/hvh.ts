import { clamp, wrapAngle } from './math';
import type { WeaponDef } from './weapons';

export interface HvhLoadout {
  antiAim: { enabled: boolean; mode: 'backward' | 'left' | 'right' | 'spin'; desync: number; jitter: number; spinSpeed: number };
  exploit: 'off' | 'doubleTap' | 'hideShots';
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
export function hvhPose(lookYaw: number, loadout: HvhLoadout, now: number, inverted: boolean, revealed: boolean): { real: number; fake: number } {
  const a = loadout.antiAim;
  if (!a.enabled || revealed) return { real: lookYaw, fake: lookYaw };
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
    return mode === 'doubleTap' && !w.projectile && !w.melee && !this.bonusUsed && now <= this.burstUntil ? Math.max(80, w.fireInterval * 0.2) : w.fireInterval;
  }
  /** Called only after an accepted shot; rejected requests spend nothing. */
  fired(w: WeaponDef, mode: HvhLoadout['exploit'], now: number): boolean {
    if (!this.bonusUsed && now <= this.burstUntil) { this.bonusUsed = true; return false; }
    if (w.projectile || w.melee) return false;
    if (mode === 'off' || now < this.readyAt) return false;
    this.readyAt = now + (mode === 'doubleTap' ? HVH.doubleTapRecharge : HVH.hideShotsRecharge);
    this.bonusUsed = mode !== 'doubleTap';
    this.burstUntil = mode === 'doubleTap' ? now + HVH.burstWindow : 0;
    return mode === 'hideShots';
  }
  get burst(): boolean { return !this.bonusUsed; }
}
