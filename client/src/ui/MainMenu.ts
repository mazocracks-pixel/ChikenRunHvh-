import { MAPS, MODES, MODE_IDS, isMapId, rankProgress, type MapId, type ModeDef, type ModeId, type Profile } from '@game/shared';
import { h, storage } from './dom';

export interface MenuActions {
  /** `map` undefined: any map. */
  quickPlay(mode: ModeId, map?: MapId): void;
  browse(): void;
  createRoom(): void;
  joinCode(): void;
  customize(): void;
  /** Opens on that mode's tab, or overall. */
  leaderboard(mode?: ModeId): void;
  account(): void;
  settings(): void;
  privacy(): void;
}

export const MODE_ICONS: Record<ModeId, string> = { ffa: '🐔', tdm: '⚔️', hvh: '👁️', knife: '🔪', bomb: '💣', arms: '🏁', duel: '🤺', ctf: '🚩', sandbox: '🧱' };

/** Mode tabs. Any mode not listed lands in the last one. */
const CATEGORIES: { id: string; label: string; modes: ModeId[] }[] = [
  { id: 'casual', label: '🐔 Casual', modes: ['ffa', 'tdm', 'duel'] },
  { id: 'competitive', label: '🏆 Competitive', modes: ['bomb', 'hvh'] },
  { id: 'fun', label: '🎉 Fun', modes: ['arms', 'knife', 'ctf', 'sandbox'] },
];
for (const id of MODE_IDS) if (!CATEGORIES.some((c) => c.modes.includes(id))) CATEGORIES.at(-1)!.modes.push(id);

const TAB_KEY = 'chikengun:menu-tab';
const mapKey = (mode: ModeId) => `chikengun:map:${mode}`;

/** "5 vs 5", "1 vs 1", "Free for all · 12"… */
function playersLine(m: ModeDef): string {
  if (m.building) return `Build together · up to ${m.maxPlayers}`;
  if (m.teams) return `${m.maxPlayers / 2} vs ${m.maxPlayers / 2}`;
  if (m.maxPlayers === 2) return '1 vs 1';
  return `Free for all · up to ${m.maxPlayers}`;
}

/** Title screen: profile, the modes by tab (each with a map choice), and the rest of the menus. */
export class MainMenu {
  readonly root: HTMLElement;
  private readonly name = h('span', { class: 'profile-name' });
  private readonly coins = h('span', { class: 'coins' });
  private readonly record = h('span', { class: 'record' });
  private readonly rank = h('span', { class: 'rank-chip' });
  private readonly xpFill = h('i');
  private readonly xpBar = h('span', { class: 'xp-bar small' }, this.xpFill);
  private readonly accountBtn = h('button', { class: 'chip-btn', type: 'button' });
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly tabs = h('div', { class: 'tabs menu-tabs', role: 'tablist' });
  private readonly cards = new Map<ModeId, HTMLElement>();

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
      const picker = h('select', { class: 'map-pick', 'aria-label': `${m.name} map` }, h('option', { value: '' }, '🎲 Any map'), ...m.maps.map((map) => h('option', { value: map }, MAPS[map].name)));
      const saved = storage.get(mapKey(id));
      picker.value = saved && m.maps.includes(saved as MapId) ? saved : '';
      picker.addEventListener('change', () => storage.set(mapKey(id), picker.value));
      const card = h(
        'div',
        { class: `mode-card mode-${id}` },
        h(
          'div',
          { class: 'mode-top' },
          h('div', { class: 'mode-icon' }, MODE_ICONS[id]),
          h('span', { class: 'mode-players' }, playersLine(m)),
          m.building ? null : h('button', { type: 'button', class: 'mode-board', title: `${m.name} leaderboard`, 'aria-label': `${m.name} leaderboard`, onclick: () => actions.leaderboard(id) }, '🏆'),
        ),
        h('h3', null, m.name),
        h('p', null, m.description),
        m.maps.length > 1 ? picker : h('div', { class: 'map-pick single' }, `🗺️ ${MAPS[m.maps[0]!].name}`),
        button('Play', () => actions.quickPlay(id, isMapId(picker.value) ? picker.value : undefined), 'play'),
      );
      this.cards.set(id, card);
      modes.append(card);
    }
    for (const c of CATEGORIES) {
      this.tabs.append(h('button', { type: 'button', class: 'tab', role: 'tab', 'data-tab': c.id, onclick: () => this.showTab(c.id) }, c.label));
    }

    this.root = h(
      'div',
      { class: 'screen main-menu' },
      h(
        'header',
        { class: 'menu-header' },
        h('h1', { class: 'logo' }, 'ChikenRun', h('span', { class: 'accent' }, 'Hvh')),
        h('div', { class: 'profile-chip' }, this.rank, h('span', { class: 'who' }, this.name, this.record, this.xpBar), this.coins, this.accountBtn),
      ),
      this.tabs,
      modes,
      h(
        'nav',
        { class: 'menu-actions' },
        button('🛒 Customize & Shop', actions.customize, 'secondary'),
        button('🌐 Server browser', actions.browse, 'secondary'),
        button('➕ Create room', actions.createRoom, 'secondary'),
        button('🔑 Join with code', actions.joinCode, 'secondary'),
        button('🏆 Leaderboard', () => actions.leaderboard(), 'secondary'),
        button('⚙️ Settings', actions.settings, 'secondary'),
      ),
      this.status,
      h('footer', { class: 'controls-help' }, 'WASD move · Space jump (hold to bunny hop) · Space again in the air: glide / jetpack · Mouse aim · Click shoot · Right-click zoom · R reload · 1-4 guns · 5 melee (faster bunny hops) · F inspect · Ctrl/C crouch · G egg · Q smoke · V first/third person · Tab scores · T chat'),
      h('footer', { class: 'legal-links' }, h('button', { type: 'button', class: 'link', onclick: actions.privacy }, 'Cookies & privacy')),
    );
    container.append(this.root);
    const saved = storage.get(TAB_KEY);
    this.showTab(CATEGORIES.some((c) => c.id === saved) ? saved! : CATEGORIES[0]!.id);
  }

  /** Shows one tab's modes. */
  showTab(id: string): void {
    const cat = CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]!;
    storage.set(TAB_KEY, cat.id);
    for (const b of this.tabs.children) {
      const on = (b as HTMLElement).dataset.tab === cat.id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const [mode, card] of this.cards) card.hidden = !cat.modes.includes(mode);
  }

  /** Shows the tab with this mode (for tests and links). */
  showMode(mode: ModeId): void {
    const cat = CATEGORIES.find((c) => c.modes.includes(mode));
    if (cat) this.showTab(cat.id);
  }

  setProfile(p: Profile): void {
    this.name.textContent = p.name;
    this.name.classList.toggle('rainbow', p.developer);
    const { rank, next, progress } = rankProgress(p.xp);
    this.rank.textContent = rank.icon;
    this.rank.dataset.level = String(rank.level);
    this.rank.title = next ? `Level ${rank.level} · ${rank.name} — ${p.xp - rank.xp}/${next.xp - rank.xp} XP to ${next.name}` : `Level ${rank.level} · ${rank.name} (top rank)`;
    this.record.textContent = `Lv ${rank.level} ${rank.name}` + (p.stats.matches > 0 ? ` · ${p.stats.wins} wins · ${p.stats.kills} kills` : '');
    this.xpFill.style.width = `${Math.round(progress * 100)}%`;
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
