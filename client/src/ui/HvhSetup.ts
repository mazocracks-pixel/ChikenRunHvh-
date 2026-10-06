import { HVH_PANEL_IDS, type HvhPanelId } from '@game/shared';
import type { Dev } from '../dev/Dev';
import { HVH_PANELS } from '../dev/panels';
import { h } from './dom';
import { presetConfigs } from '../dev/config';

/** A personal pre-match pause. The server spawns this player only after Begin succeeds. */
export class HvhSetup {
  readonly root: HTMLElement;
  private selected: HvhPanelId = 'manual';
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly begin = h('button', { type: 'button' }, 'Begin match');
  private readonly configure = h('button', { type: 'button', class: 'secondary' }, 'Configure panel');
  private readonly choices = new Map<HvhPanelId, HTMLInputElement>();
  private disposed = false;
  private busy = false;
  private hasChosen = false;
  private readonly preset = h('select', { 'aria-label': 'Quick config' });
  private presetPanel: HvhPanelId = 'manual';

  constructor(dev: Dev, start: (panel: HvhPanelId) => Promise<string | null>, leave: () => void) {
    this.preset.addEventListener('change', () => {
      if (this.selected === 'manual' || !this.preset.value) return;
      const chosen = presetConfigs(this.selected)[Number(this.preset.value)];
      if (!chosen) return;
      dev.selectPanel(this.selected); dev.replaceConfig(structuredClone(chosen.config));
      this.status.textContent = `${chosen.name} loaded. You can adjust it before beginning.`;
    });
    const options = HVH_PANEL_IDS.map(id => {
      const p = HVH_PANELS[id];
      const radio = h('input', { type: 'radio', name: 'hvh-panel', value: id });
      radio.addEventListener('change', () => { this.hasChosen = true; this.selected = id; this.refresh(); });
      this.choices.set(id, radio);
      return h('label', { class: 'hvh-panel-choice' }, radio,
        h('span', null, h('strong', null, p.name), h('span', { class: 'muted' }, p.description)));
    });
    this.root = h('div', { class: 'overlay hvh-setup' },
      h('section', { class: 'panel card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'HvH setup' },
        h('h2', null, 'Choose your HvH panel'),
        h('p', { class: 'muted' }, 'Finish setup before entering combat. The rest of the match continues.'),
        h('fieldset', { class: 'hvh-panel-options' }, h('legend', null, 'Panel'), ...options),
        this.status, this.preset, this.configure, this.begin,
        h('button', { type: 'button', class: 'secondary', onclick: leave }, 'Leave match')));
    this.configure.addEventListener('click', () => {
      dev.selectPanel(this.selected);
      void dev.openMenu().then(() => {
        if (!this.disposed) this.status.textContent = dev.status.allowedHere
          ? 'Panel access confirmed. Configure your tools, then close the panel to begin.'
          : 'This server requires the developer passkey for assisted panels. Manual play is available.';
      });
    });
    this.begin.addEventListener('click', () => {
      if (this.busy) return;
      this.busy = true; this.refresh();
      this.status.textContent = 'Entering combat…';
      void start(this.selected).then(error => {
        if (!this.disposed && error) this.status.textContent = error;
      }).catch(() => {
        if (!this.disposed) this.status.textContent = 'The server did not answer. Try again.';
      }).finally(() => { if (!this.disposed) { this.busy = false; this.refresh(); } });
    });
    this.refresh();
    void dev.refreshStatus().then(s => {
      if (this.disposed || this.busy) return;
      if (!this.hasChosen) this.selected = s.allowedHere ? dev.panelId : 'manual';
      this.status.textContent = s.allowedHere
        ? 'Assisted panels are available. Every panel uses the same weapon and movement rules.'
        : 'Manual play is available. Assisted panels require access on this server.';
      this.refresh();
    });
  }

  private refresh(): void {
    this.preset.hidden = this.selected === 'manual'; this.preset.disabled = this.busy;
    if (this.presetPanel !== this.selected) {
      this.presetPanel = this.selected;
      this.preset.replaceChildren(h('option', { value: '' }, 'Keep my current settings'),
        ...(this.selected === 'manual' ? [] : presetConfigs(this.selected).map((c, i) => h('option', { value: String(i) }, c.name))));
    }
    for (const [id, radio] of this.choices) { radio.checked = id === this.selected; radio.disabled = this.busy; }
    this.begin.disabled = this.configure.disabled = this.busy;
    this.configure.hidden = this.selected === 'manual';
    this.configure.textContent = `Configure ${HVH_PANELS[this.selected].name}`;
  }
  dispose(): void { this.disposed = true; this.root.remove(); }
}
