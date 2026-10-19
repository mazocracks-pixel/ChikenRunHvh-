import { LATE_CSGO, type EraTable, type ShotVerdict, type TickbaseState } from '@game/shared/hvh/v2';
import { h } from '../dom';
import type { HitLog } from './HitLog';

export interface IndicatorToggles {
  dt: boolean;
  hs: boolean;
}

/** DT and hide shots share one charge: 'ready' at a full charge, else 'charging'. */
export type ExploitIndicator = 'ready' | 'charging' | 'off';

export interface IndicatorState {
  dt: ExploitIndicator;
  hs: ExploitIndicator;
  choke: number;
}

export function indicatorModel(
  s: TickbaseState,
  toggles: IndicatorToggles,
  era: EraTable = LATE_CSGO,
): IndicatorState {
  const charge: ExploitIndicator = s.charge >= era.chargeTicks ? 'ready' : 'charging';
  return {
    dt: toggles.dt ? charge : 'off',
    hs: toggles.hs ? charge : 'off',
    choke: s.choked,
  };
}

export class Indicators {
  readonly root?: HTMLElement;
  private readonly dtEl?: HTMLElement;
  private readonly hsEl?: HTMLElement;
  private readonly chokeEl?: HTMLElement;

  constructor(container?: HTMLElement) {
    if (typeof document === 'undefined') return;

    this.dtEl = h('div', { class: 'hvh-ind-dt' });
    this.hsEl = h('div', { class: 'hvh-ind-hs' });
    this.chokeEl = h('div', { class: 'hvh-ind-choke' });

    this.root = h(
      'div',
      {
        class: 'hvh-indicators',
        style:
          'position:absolute;bottom:220px;left:24px;display:flex;flex-direction:column;gap:3px;font-family:monospace;font-size:13px;font-weight:bold;text-shadow:1px 1px 1px #000;pointer-events:none;z-index:30;',
      },
      this.dtEl,
      this.hsEl,
      this.chokeEl,
    );

    if (container) container.append(this.root);
  }

  setVisible(visible: boolean): void {
    if (this.root) this.root.hidden = !visible;
  }

  render(model: IndicatorState): void {
    if (!this.root || !this.dtEl || !this.hsEl || !this.chokeEl) return;

    // DT and HS indicators
    const colors: Record<ExploitIndicator, string> = {
      ready: '#a4d052',
      charging: '#e5b842',
      off: '#666666',
    };
    for (const [el, label, state] of [[this.dtEl, 'DT', model.dt], [this.hsEl, 'HS', model.hs]] as const) {
      el.textContent = label;
      el.style.color = colors[state];
      el.hidden = state === 'off';
    }

    // Choke indicator
    this.chokeEl.textContent = `CHOKE: ${model.choke}`;
    this.chokeEl.style.color = model.choke > 0 ? '#89c6dc' : '#666666';
    this.chokeEl.hidden = model.choke === 0;
  }

  dispose(): void {
    this.root?.remove();
  }
}

export interface HvhV2UiTarget {
  hitLog: HitLog | null;
  indicators: Indicators | null;
}

/**
 * Lazily creates HitLog and Indicators on the first v2 hvhState event and registers the shotVerdict listener.
 * In legacy rooms and non-HvH rooms where hvhState never arrives, this is never called.
 * Verdicts that arrive before the first hvhState are dropped because hitLog is null until then.
 */
export function initHvhV2Ui(
  target: HvhV2UiTarget,
  create: () => { hitLog: HitLog; indicators: Indicators },
  registerShotVerdict: (handler: (v: ShotVerdict) => void) => void,
): boolean {
  if (target.hitLog !== null || target.indicators !== null) {
    return false;
  }
  const created = create();
  target.hitLog = created.hitLog;
  target.indicators = created.indicators;
  // Verdicts that arrive before the first hvhState are dropped because hitLog is null until now.
  registerShotVerdict((v) => target.hitLog?.push(v));
  return true;
}
