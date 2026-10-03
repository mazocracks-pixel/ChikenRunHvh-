import { MODES, MODE_IDS, type ModeId, type Profile } from '@game/shared';
import { h } from './dom';

export interface MenuActions {
  quickPlay(mode: ModeId): void;
  browse(): void;
  createRoom(): void;
  joinCode(): void;
  customize(): void;
  leaderboard(): void;
  account(): void;
  settings(): void;
  privacy(): void;
}

const MODE_ICONS: Record<ModeId, string> = { ffa: '🐔', tdm: '⚔️', hvh: '👁️', knife: '🔪', duel: '🤺', ctf: '🚩', sandbox: '🧱' };

/** Title screen: profile, quick play per mode, and the rest of the menus. */
export class MainMenu {
  readonly root: HTMLElement;
  private readonly name = h('span', { class: 'profile-name' });
  private readonly coins = h('span', { class: 'coins' });
  private readonly accountBtn = h('button', { class: 'chip-btn', type: 'button' });
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(container: HTMLElement, actions: MenuActions) {
    const button = (label: string, onClick: () => void, cls = '') => {
      const b = h('button', { class: cls, type: 'button', onclick: onClick }, label);
      this.buttons.push(b);
      return b;
    };
    this.accountBtn.addEventListener('click', actions.account);

    const modes = h('div', { class: 'mode-grid' });
    for (const id of MODE_IDS) {
      const m = MODES[id];
      modes.append(
        h(
          'div',
          { class: `mode-card mode-${id}` },
          h('div', { class: 'mode-icon' }, MODE_ICONS[id]),
          h('h3', null, m.name),
          h('p', null, m.description),
          button('Play', () => actions.quickPlay(id), 'play'),
        ),
      );
    }

    this.root = h(
      'div',
      { class: 'screen main-menu' },
      h(
        'header',
        { class: 'menu-header' },
        h('h1', { class: 'logo' }, 'ChikenRun', h('span', { class: 'accent' }, 'Hvh')),
        h('div', { class: 'profile-chip' }, h('span', { class: 'avatar' }, '🐔'), this.name, this.coins, this.accountBtn),
      ),
      modes,
      h(
        'nav',
        { class: 'menu-actions' },
        button('🛒 Customize & Shop', actions.customize, 'secondary'),
        button('🌐 Server browser', actions.browse, 'secondary'),
        button('➕ Create room', actions.createRoom, 'secondary'),
        button('🔑 Join with code', actions.joinCode, 'secondary'),
        button('🏆 Leaderboard', actions.leaderboard, 'secondary'),
        button('⚙️ Settings', actions.settings, 'secondary'),
      ),
      this.status,
      h('footer', { class: 'controls-help' }, 'WASD move · Space jump (hold to bunny hop) · Space again in the air: glide / jetpack · Mouse aim · Click shoot · Right-click zoom · R reload · 1-4 guns · 5 melee (faster bunny hops) · F inspect · Ctrl/C crouch · G egg · Q smoke · V first/third person · Tab scores · T chat'),
      h('footer', { class: 'legal-links' }, h('button', { type: 'button', class: 'link', onclick: actions.privacy }, 'Cookies & privacy')),
    );
    container.append(this.root);
  }

  setProfile(p: Profile): void {
    this.name.textContent = p.name;
    this.name.classList.toggle('rainbow', p.developer);
    this.coins.textContent = `🪙 ${p.coins.toLocaleString()}`;
    this.accountBtn.textContent = p.username ? 'Account' : 'Save progress';
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }
}
