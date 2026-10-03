import type { CrosshairSettings } from '../settings';
import { h } from './dom';

/** Largest extra gap the spread can add, so a shotgun's crosshair stays on screen. */
const MAX_SPREAD_PX = 60;

/**
 * The aiming reticle: four lines, a centre dot and a ring, shown or hidden by style.
 * Sizes are whole pixels so thin lines stay crisp. Used by the HUD and the settings preview.
 */
export class CrosshairView {
  readonly root = h('div', { class: 'crosshair', 'aria-hidden': 'true' }, h('i', { class: 'top' }), h('i', { class: 'bottom' }), h('i', { class: 'left' }), h('i', { class: 'right' }), h('b'), h('span', { class: 'ring' }));
  private settings: CrosshairSettings | null = null;
  private spread = -1;

  apply(settings: CrosshairSettings): void {
    this.settings = settings;
    const s = this.root.style;
    const t = Math.round(settings.thickness);
    s.setProperty('--color', settings.color);
    s.setProperty('--len', `${Math.round(settings.size)}px`);
    s.setProperty('--thick', `${t}px`);
    // Offsets that centre a `t`-wide line on the middle pixel.
    s.setProperty('--half', `${-Math.floor(t / 2)}px`);
    const dot = settings.style === 'dot' ? t + 2 : Math.max(2, t);
    s.setProperty('--dot', `${dot}px`);
    s.setProperty('--dot-half', `${-Math.floor(dot / 2)}px`);
    s.setProperty('--outline', settings.outline ? 'rgba(0, 0, 0, 0.7)' : 'transparent');
    s.opacity = String(settings.opacity);
    this.root.dataset.style = settings.style;
    const spread = this.spread;
    this.spread = -1;
    this.setSpread(Math.max(0, spread));
  }

  /** How far the weapon's current spread reaches from the centre, in screen pixels. */
  setSpread(px: number): void {
    const c = this.settings;
    if (!c) return;
    const extra = c.dynamic ? Math.min(MAX_SPREAD_PX, Math.round(px)) : 0;
    if (extra === this.spread) return;
    this.spread = extra;
    const gap = Math.round(c.gap) + extra;
    this.root.style.setProperty('--gap', `${gap}px`);
    // The ring sits where the lines would start, so it grows with the spread too.
    const ring = 2 * (gap + Math.round(c.size / 2)) + 1;
    this.root.style.setProperty('--ring', `${ring}px`);
    this.root.style.setProperty('--ring-half', `${-Math.floor(ring / 2)}px`);
  }
}
