import { MAPS, MODES, MODE_IDS, isMapId, rankProgress, type DailyStatus, type FriendEntry, type MapId, type ModeDef, type ModeId, type Profile } from '@game/shared';
import { clear, formatTime, h, storage } from './dom';
import { anyModalOpen } from './Modal';
import { MODE_ICON, icon, type IconName } from './icons';

export interface MenuActions {
  /** `map` undefined: any map. `noBots`: the "No bots" choice (wait for real players). */
  quickPlay(mode: ModeId, map?: MapId, noBots?: boolean): void;
  /** Stops a search started with Play (or a room being joined). */
  cancelSearch(): void;
  browse(): void;
  createRoom(): void;
  joinCode(): void;
  customize(section: 'inventory' | 'loadout' | 'store'): void;
  friends(): void;
  /** Invites a friend to your party (the server checks). */
  invite(friend: FriendEntry): void;
  /** Opens on that mode's tab, or overall. */
  leaderboard(mode?: ModeId): void;
  daily(): void;
  account(): void;
  settings(): void;
  privacy(): void;
  /** The how-to-play guide (also F1). */
  guide(): void;
  /** Today's challenges, for the card on the title screen. */
  dailyStatus(): Promise<DailyStatus>;
  /** How many people are playing right now. */
  online(): Promise<number>;
  /** Music on or off; returns whether it's now muted. */
  toggleMusic(): boolean;
  musicMuted(): boolean;
  /** Dragging the scene turns your chicken; a click on it makes it react. */
  turnChicken(dx: number): void;
  pokeChicken(x: number, y: number): void;
}

/** Mode tabs. Any mode not listed lands in the last one. */
const CATEGORIES: { id: string; label: string; modes: ModeId[] }[] = [
  { id: 'casual', label: 'Casual', modes: ['ffa', 'tdm', 'squad', 'duel', 'training'] },
  { id: 'competitive', label: 'Competitive', modes: ['face', 'bomb', 'hvh'] },
  { id: 'fun', label: 'Fun', modes: ['zombie', 'backrooms', 'arms', 'knife', 'ctf', 'sandbox'] },
];
for (const id of MODE_IDS) if (!CATEGORIES.some((c) => c.modes.includes(id))) CATEGORIES.at(-1)!.modes.push(id);

/** "What's new" (the NEWS tab, and the newest one on the title screen): newest first. Edit freely. */
const WHATS_NEW: readonly { title: string; text: string }[] = [
  { title: 'New main menu', text: 'A warm Mirage lobby: the play panel on the right, daily challenges and news on the left, and your party next to your chicken. Drag your chicken to turn it, click it to say hi.' },
  { title: 'Mirage', text: 'A lighter Mirage joins the classic maps. Choose your map in the play panel.' },
  { title: 'Buy menu', text: 'Five columns, weapon previews and your chicken. Press B in a buy zone during buy time.' },
  { title: 'Your lobby', text: 'Choose a loadout, invite friends and take your chicken into the next match.' },
];

const TAB_KEY = 'chikengun:menu-tab';
const BOTS_KEY = 'chikengun:menu-no-bots';
const MODE_KEY = 'chikengun:menu-mode';
const mapKey = (mode: ModeId) => `chikengun:map:${mode}`;
/** How often the "playing now" count is refreshed while the title screen is up. */
const ONLINE_EVERY_MS = 20_000;
/** A press that moves less than this is a click (on the chicken), not a drag. */
const CLICK_SLOP_PX = 5;

/** "5 vs 5", "1 vs 1", "Free for all · 12"… */
function playersLine(m: ModeDef): string {
  if (m.training) return 'Solo · practice';
  if (m.building) return `Build together · up to ${m.maxPlayers}`;
  if (m.zombies) return `Co-op survival · up to ${m.maxHumans ?? m.maxPlayers}`;
  if (m.ranked) return `Ranked ${m.maxPlayers / 2} vs ${m.maxPlayers / 2}`;
  if (m.teams) return `${m.maxPlayers / 2} vs ${m.maxPlayers / 2}`;
  if (m.maxPlayers === 2) return '1 vs 1';
  return `Free for all · up to ${m.maxPlayers}`;
}

/** The Mirage lobby: your chicken in the scene, the play panel, profile, challenges, news and friends. */
export class MainMenu {
  readonly root: HTMLElement;
  // Profile: the top bar chip and the plate under the chicken.
  private readonly name = h('span', { class: 'profile-name' });
  private readonly chipName = h('span', { class: 'cs-me-name' });
  private readonly chipRank = h('span', { class: 'rank-chip small' });
  private readonly chipLevel = h('small');
  private readonly coins = h('span', { class: 'coins', title: 'Coins', 'aria-label': 'Coins' });
  private readonly rank = h('span', { class: 'rank-chip' });
  private readonly record = h('span', { class: 'record' });
  private readonly xpFill = h('i');
  private readonly xpText = h('span', { class: 'xp-text' });
  private readonly accountLink = h('button', { type: 'button', class: 'link' });
  private readonly musicButton = h('button', { type: 'button', class: 'cs-tool' });
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly buttons: HTMLButtonElement[] = [];
  // Play panel.
  private readonly tabs = h('div', { class: 'tabs menu-tabs', role: 'tablist', 'aria-label': 'Mode type' });
  private readonly cards = new Map<ModeId, HTMLButtonElement>();
  private readonly mapRow = h('div', { class: 'cs-map-row' });
  private readonly botsRow = h('div', { class: 'cs-bots-row' });
  private readonly botsButtons = new Map<boolean, HTMLButtonElement>();
  private readonly botsNote = h('p', { class: 'bots-note' });
  private readonly modeInfo = h('p', { class: 'cs-mode-info' });
  private readonly playButton: HTMLButtonElement;
  private readonly playLabel = h('span', null, 'Play');
  private readonly cancelButton: HTMLButtonElement;
  private readonly playPanel: HTMLElement;
  // Friends and party.
  private readonly friendsBadge = h('span', { class: 'badge', hidden: true });
  private readonly friendList = h('div', { class: 'cs-friend-list' });
  private readonly friendCount = h('span', { class: 'cs-friend-count' }, '0');
  private readonly partyStrip = h('div', { class: 'cs-party' });
  // Left column and the News page.
  private readonly daily = h('section', { class: 'cs-card cs-daily', 'aria-label': 'Daily challenges' });
  private readonly newsPage: HTMLElement;
  private readonly navButtons = new Map<string, HTMLButtonElement>();
  private readonly online = h('span', { class: 'lobby-online' }, h('i'), 'Connecting…');
  private onlineTimer = 0;
  private searchTimer = 0;
  private searching = false;
  /** The lobby choice: play with bots (default) or wait for real players. */
  private withoutBots = storage.get(BOTS_KEY) === '1';
  private selected: ModeId = this.savedMode();
  private readonly canInvite: (f: FriendEntry) => boolean;

  get noBots(): boolean {
    return this.withoutBots;
  }

  /** The News page covers the whole scene (so it needn't be drawn). */
  get coversScene(): boolean {
    return !this.root.hidden && !this.newsPage.hidden;
  }

  constructor(container: HTMLElement, private readonly actions: MenuActions, canInvite: (f: FriendEntry) => boolean = () => false) {
    this.canInvite = canInvite;
    const button = (label: string, onClick: () => void, cls = '', title = '') => {
      const b = h('button', { class: cls, type: 'button', onclick: onClick }, label);
      if (title) {
        b.title = title;
        b.setAttribute('aria-label', title);
      }
      this.buttons.push(b);
      return b;
    };
    /** An icon button with a tooltip and screen-reader name; `label` also shows as text when given. */
    const tool = (name: IconName, title: string, run: () => void, label = '') => {
      const b = button('', run, `cs-tool${label ? ' labelled' : ''}`, title);
      b.append(icon(name));
      if (label) b.append(h('span', null, label));
      return b;
    };

    // ---- Play panel: mode tabs, mode cards, map, bots, PLAY, rooms.
    const grid = h('div', { class: 'cs-mode-grid', role: 'listbox', 'aria-label': 'Modes' });
    for (const id of MODE_IDS) {
      const m = MODES[id];
      const card = button('', () => this.select(id), `cs-mode mode-${id}${m.ranked ? ' ranked' : ''}`);
      card.setAttribute('role', 'option');
      card.title = m.description;
      card.append(h('span', { class: 'mode-icon' }, icon(MODE_ICON[id])), h('b', null, m.name), h('small', null, playersLine(m)));
      card.addEventListener('dblclick', () => this.play(id));
      // Cards sit in their tab's order (FaceChiken first among the competitive ones).
      card.style.order = String(CATEGORIES.find((c) => c.modes.includes(id))?.modes.indexOf(id) ?? 0);
      this.cards.set(id, card);
      grid.append(card);
    }
    for (const c of CATEGORIES) {
      this.tabs.append(h('button', { type: 'button', class: 'tab', role: 'tab', 'data-tab': c.id, onclick: () => this.showTab(c.id) }, c.label));
    }
    this.botsRow.append(
      h('span', { class: 'cs-label' }, 'Bots'),
      h('div', { class: 'bots-toggle', role: 'radiogroup', 'aria-label': 'Bots' }, this.botsOption(false, 'bot', 'On'), this.botsOption(true, 'person', 'Off')),
    );
    this.playButton = button('', () => this.play(this.selected), 'cs-play-big');
    this.playButton.append(icon('play'), this.playLabel);
    // Cancel stays usable while everything else is busy.
    this.cancelButton = h('button', { type: 'button', class: 'cs-cancel', hidden: true, onclick: () => this.actions.cancelSearch() }, 'Cancel');
    const playPanel = (this.playPanel = h(
      'section',
      { class: 'cs-play', 'aria-label': 'Play' },
      this.status,
      this.tabs,
      grid,
      this.modeInfo,
      h('div', { class: 'cs-play-options' }, this.mapRow, this.botsRow),
      this.botsNote,
      h('div', { class: 'cs-play-go' }, this.playButton, this.cancelButton),
      h(
        'div',
        { class: 'cs-rooms' },
        tool('globe', 'Server browser', actions.browse, 'Server browser'),
        tool('plus', 'Create room', actions.createRoom, 'Create room'),
        tool('key', 'Join with code', actions.joinCode, 'Join with code'),
      ),
    ));
    playPanel.addEventListener('animationend', (e) => {
      if (e.animationName === 'cs-glow') playPanel.classList.remove('glow');
    });

    // ---- Top bar.
    const logo = button('', () => this.home(), 'logo', 'ChikenRunHvh · home');
    logo.append(icon('chicken'), h('span', null, 'ChikenRunHvh'));
    const nav = h('nav', { class: 'cs-nav', 'aria-label': 'Main menu' });
    for (const [id, label, run] of [
      ['inventory', 'Inventory', () => actions.customize('inventory')],
      ['loadout', 'Loadout', () => actions.customize('loadout')],
      ['play', 'Play', () => this.showPlay()],
      ['store', 'Store', () => actions.customize('store')],
      ['news', 'News', () => this.openNews(true)],
    ] as const) {
      const b = button(label, run);
      this.navButtons.set(id, b);
      nav.append(b);
    }
    const me = button('', actions.account, 'cs-me', 'Your account');
    me.append(this.chipRank, h('span', { class: 'cs-me-text' }, this.chipName, this.chipLevel));
    this.musicButton.addEventListener('click', () => this.refreshMusic(this.actions.toggleMusic()));
    this.buttons.push(this.musicButton);
    const topbar = h(
      'header',
      { class: 'cs-topbar' },
      logo,
      nav,
      h('div', { class: 'cs-top-right' }, this.coins, me, this.musicButton, tool('gear', 'Settings', actions.settings)),
    );

    // ---- Left column: challenges, the newest news, leaderboard and guide.
    const latest = WHATS_NEW[0]!;
    const newsCard = button('', () => this.openNews(true), 'cs-card cs-news-card', 'Open the News tab');
    newsCard.append(h('span', { class: 'cs-card-head' }, icon('news'), 'Latest update'), h('b', null, latest.title), h('span', { class: 'cs-news-text' }, latest.text), h('span', { class: 'link' }, 'Read the news →'));
    const left = h(
      'aside',
      { class: 'cs-left', 'aria-label': 'Challenges and news' },
      this.daily,
      newsCard,
      h(
        'div',
        { class: 'cs-left-tools' },
        tool('trophy', 'Leaderboard', () => actions.leaderboard(), 'Leaderboard'),
        tool('help', 'How to play (F1)', actions.guide, 'How to play'),
        // Narrow screens hide the challenges card: this opens them instead.
        Object.assign(tool('calendar', 'Daily challenges', actions.daily, 'Daily'), { className: 'cs-tool labelled cs-narrow-only' }),
      ),
    );

    // ---- Right sidebar: friends and party.
    const friendsHead = button('', actions.friends, 'cs-friends-head', 'Friends and party');
    friendsHead.append(icon('team'), h('span', null, 'Friends'), this.friendCount, this.friendsBadge);
    const friends = h('aside', { class: 'cs-friends', 'aria-label': 'Friends' }, friendsHead, this.partyStrip, this.friendList, tool('plus', 'Add friends', actions.friends, 'Add friends'));

    // ---- Under the chicken: name, rank, level and XP.
    const plate = h('div', { class: 'cs-profile' }, this.name, this.rank, this.record, h('span', { class: 'xp-bar' }, this.xpFill), this.xpText);

    // ---- The News page.
    const closeNews = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close the news', title: 'Close (Esc)', onclick: () => this.openNews(false) }, icon('close'));
    this.newsPage = h(
      'section',
      { class: 'cs-news-page', hidden: true, 'aria-label': 'News' },
      h('div', { class: 'cs-news-inner' }, h('header', null, h('h2', null, "What's new"), closeNews), ...WHATS_NEW.map((n) => h('article', null, h('h3', null, n.title), h('p', null, n.text)))),
    );

    // ---- The scene: drag to turn the chicken, click it to make it react.
    const stage = h('div', { class: 'cs-stage', 'aria-hidden': 'true' });
    let drag: { id: number; x: number; moved: number } | null = null;
    stage.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, moved: 0 };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      drag.x = e.clientX;
      drag.moved += Math.abs(dx);
      if (dx) this.actions.turnChicken(dx);
    });
    const release = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.type === 'pointerup' && drag.moved < CLICK_SLOP_PX) this.actions.pokeChicken(e.clientX, e.clientY);
      drag = null;
      stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    const unhide = h('button', { type: 'button', class: 'cs-unhide', onclick: () => this.root.classList.remove('scene-only') }, icon('eye'), 'Show menu');
    this.root = h(
      'div',
      { class: 'screen cs-lobby' },
      stage,
      topbar,
      left,
      plate,
      friends,
      playPanel,
      h(
        'footer',
        { class: 'cs-bottom' },
        this.online,
        this.accountLink,
        button('Privacy', actions.privacy, 'link'),
        button('Hide menu', () => this.root.classList.add('scene-only'), 'link', 'Hide the menu to look at the scene'),
      ),
      unhide,
      this.newsPage,
    );
    this.accountLink.addEventListener('click', actions.account);
    this.buttons.push(this.accountLink);
    container.append(this.root);
    this.refreshBots();
    this.refreshPlay();
    this.refreshMusic(actions.musicMuted());
    this.setFriends(0, null, []);
    const saved = storage.get(TAB_KEY);
    this.showTab(CATEGORIES.find((c) => c.modes.includes(this.selected))?.id ?? (CATEGORIES.some((c) => c.id === saved) ? saved! : CATEGORIES[0]!.id));
    this.renderDaily(null);

    // Enter plays, Esc goes back (the News page, a hidden menu, a search).
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden || anyModalOpen() || e.repeat) return;
      const interactive = e.target instanceof HTMLElement && Boolean(e.target.closest('button, a, input, select, textarea'));
      if (e.key === 'Escape') {
        if (!this.newsPage.hidden) this.openNews(false);
        else if (this.root.classList.contains('scene-only')) this.root.classList.remove('scene-only');
        else if (this.searching) this.actions.cancelSearch();
      } else if (e.key === 'Enter' && !interactive && this.newsPage.hidden && !this.playButton.disabled) {
        e.preventDefault();
        this.play(this.selected);
      }
    });
  }

  private savedMode(): ModeId {
    const saved = storage.get(MODE_KEY);
    return saved && MODE_IDS.includes(saved as ModeId) ? (saved as ModeId) : 'bomb';
  }

  /** Back to the lobby itself (the PLAY tab). */
  private home(): void {
    this.openNews(false);
    this.root.classList.remove('scene-only');
  }

  /** The PLAY tab: back to the lobby, then point at the play panel (a short glow, focus on PLAY). */
  private showPlay(): void {
    this.home();
    this.playPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.playPanel.classList.remove('glow');
    void this.playPanel.offsetWidth; // restart the animation
    this.playPanel.classList.add('glow');
    this.playButton.focus({ preventScroll: true });
  }

  private openNews(open: boolean): void {
    this.newsPage.hidden = !open;
    for (const [id, b] of this.navButtons) b.classList.toggle('active', id === (open ? 'news' : 'play'));
  }

  /** Picks the mode PLAY starts (remembered). */
  private select(mode: ModeId): void {
    this.selected = mode;
    storage.set(MODE_KEY, mode);
    for (const [id, card] of this.cards) {
      card.classList.toggle('selected', id === mode);
      card.setAttribute('aria-selected', String(id === mode));
    }
    this.refreshPlay();
  }

  private play(mode: ModeId): void {
    if (this.playButton.disabled) return;
    this.select(mode);
    const map = storage.get(mapKey(mode));
    this.actions.quickPlay(mode, isMapId(map) && MODES[mode].maps.includes(map) ? map : undefined, this.withoutBots);
  }

  /** The selected mode's description, map choice and bots choice. */
  private refreshPlay(): void {
    const m = MODES[this.selected];
    this.modeInfo.replaceChildren(h('b', null, m.name), ` · ${m.description}`);
    clear(this.mapRow);
    this.mapRow.append(h('span', { class: 'cs-label' }, 'Map'));
    if (m.maps.length > 1) {
      const picker = h('select', { class: 'map-pick', 'aria-label': `${m.name} map` }, h('option', { value: '' }, 'Any map'), ...m.maps.map((map) => h('option', { value: map }, MAPS[map].name)));
      const saved = storage.get(mapKey(this.selected));
      picker.value = saved && m.maps.includes(saved as MapId) ? saved : '';
      const mode = this.selected;
      picker.addEventListener('change', () => storage.set(mapKey(mode), picker.value));
      this.mapRow.append(picker);
    } else {
      // Zombie Apocalypse, the Backrooms and friends: one fixed map, nothing to choose.
      this.mapRow.append(h('span', { class: 'map-pick single' }, m.huntOnly ? m.name : MAPS[m.maps[0]!].name));
    }
    const fixed = m.noBots || m.ranked;
    this.botsRow.hidden = Boolean(fixed);
    this.botsNote.textContent = fixed
      ? m.ranked ? 'Ranked: real players only.' : 'This mode has no bots.'
      : this.withoutBots
        ? 'Real players only: the match starts when enough people join.'
        : 'Bots fill the empty spots, so a match starts right away.';
  }

  private renderDaily(status: DailyStatus | null): void {
    clear(this.daily);
    const open = h('button', { type: 'button', class: 'link', onclick: () => this.actions.daily() }, 'All');
    this.daily.append(h('header', { class: 'cs-card-head' }, icon('calendar'), 'Daily challenges', open));
    if (!status) {
      this.daily.append(h('p', { class: 'muted' }, 'Loading your challenges…'));
      return;
    }
    for (const c of status.challenges) {
      this.daily.append(
        h(
          'div',
          { class: `cs-daily-row${c.done ? ' done' : ''}` },
          h('span', { class: 'cs-daily-label' }, c.label),
          h('span', { class: 'cs-daily-reward', title: `${c.reward} coins` }, icon('coin'), String(c.reward)),
          h('span', { class: 'daily-bar' }, h('i', { style: `width:${Math.round((Math.min(c.progress, c.goal) / c.goal) * 100)}%` })),
          h('small', null, c.done ? 'Done' : `${Math.min(c.progress, c.goal)} / ${c.goal}`),
        ),
      );
    }
  }

  private refreshLive(): void {
    this.actions
      .dailyStatus()
      .then((s) => this.renderDaily(s))
      .catch(() => this.renderDaily(null));
    this.actions
      .online()
      .then((n) => {
        // People in matches right now (you on this screen aren't counted yet). Hidden when there are none.
        this.online.hidden = n === 0;
        this.online.lastChild!.textContent = `${n} ${n === 1 ? 'player' : 'players'} in matches`;
        this.online.classList.add('live');
      })
      .catch(() => {
        this.online.hidden = false;
        this.online.lastChild!.textContent = 'Offline';
        this.online.classList.remove('live');
      });
  }

  private refreshMusic(muted: boolean): void {
    this.musicButton.replaceChildren(icon(muted ? 'mute' : 'music'));
    const label = muted ? 'Music off · click to turn it on' : 'Music on · click to mute';
    this.musicButton.title = label;
    this.musicButton.setAttribute('aria-label', label);
    this.musicButton.setAttribute('aria-pressed', String(!muted));
  }

  private botsOption(withoutBots: boolean, name: IconName, label: string): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'bots-opt', role: 'radio', title: withoutBots ? 'No bots: wait for real players' : 'Bots fill the empty spots', onclick: () => this.setBots(withoutBots) }, icon(name), label);
    this.botsButtons.set(withoutBots, b);
    return b;
  }

  private setBots(withoutBots: boolean): void {
    this.withoutBots = withoutBots;
    storage.set(BOTS_KEY, withoutBots ? '1' : '0');
    this.refreshBots();
    this.refreshPlay();
  }

  private refreshBots(): void {
    for (const [value, b] of this.botsButtons) {
      b.classList.toggle('active', value === this.withoutBots);
      b.setAttribute('aria-checked', String(value === this.withoutBots));
    }
  }

  /**
   * Friends and party: the badge (requests and invites waiting), each friend with their status
   * and an Invite button, who's in your party, and what Play does (the leader brings everyone).
   */
  setFriends(waiting: number, party: { names: string[]; leader: string; isLeader: boolean } | null, friends: readonly FriendEntry[] = []): void {
    this.friendsBadge.hidden = waiting === 0;
    this.friendsBadge.textContent = String(waiting);
    this.friendsBadge.title = `${waiting} waiting`;
    this.friendCount.textContent = String(friends.filter((f) => f.online).length);
    clear(this.friendList);
    for (const f of [...friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))) {
      const status = f.online ? (f.mode ? `Playing ${MODES[f.mode].name}` : 'In lobby') : 'Offline';
      const row = h('div', { class: `cs-friend${f.online ? ' online' : ''}${f.inParty ? ' in-party' : ''}` });
      row.append(
        h('button', { type: 'button', class: 'cs-friend-main', title: `${f.name} · ${status}`, 'aria-label': `${f.name} · ${status}`, onclick: this.actions.friends }, h('span', { class: 'cs-avatar' }, Array.from(f.name)[0]?.toUpperCase() ?? '?', h('i')), h('span', { class: 'cs-friend-text' }, h('b', null, f.name), h('small', null, f.inParty ? 'In your party' : status))),
      );
      if (this.canInvite(f)) row.append(h('button', { type: 'button', class: 'cs-invite', title: `Invite ${f.name} to your party`, 'aria-label': `Invite ${f.name} to your party`, onclick: () => this.actions.invite(f) }, icon('plus'), h('span', null, 'Invite')));
      this.friendList.append(row);
    }
    if (friends.length === 0) this.friendList.append(h('p', { class: 'muted cs-no-friends' }, 'No friends yet. Add some to play together.'));
    clear(this.partyStrip);
    if (party) {
      this.partyStrip.append(
        h('span', { class: 'party-title' }, `Party · ${party.names.length}`),
        ...party.names.map((n) => h('span', { class: 'party-chip' }, n === party.leader ? `${n} (lead)` : n)),
        h('span', { class: 'muted' }, party.isLeader ? 'You pick the mode: everyone plays with you.' : `${party.leader} picks the mode.`),
      );
    } else {
      this.partyStrip.append(h('span', { class: 'party-title' }, 'Lobby'), h('span', { class: 'muted' }, 'Solo · ready'));
    }
    const label = !party ? 'Play' : party.isLeader ? `Play with party (${party.names.length})` : 'Leader picks';
    if (!this.searching) this.playLabel.textContent = label;
    this.playLabel.dataset.label = label;
  }

  /** While a match is being found: "Searching… 0:12" and Cancel; null when it's over. */
  setSearching(on: boolean): void {
    this.searching = on;
    window.clearInterval(this.searchTimer);
    this.cancelButton.hidden = !on;
    this.playButton.classList.toggle('searching', on);
    const label = this.playLabel.dataset.label ?? 'Play';
    if (!on) {
      this.playLabel.textContent = label;
      return;
    }
    const start = Date.now();
    const tick = () => {
      const ms = Date.now() - start;
      this.playLabel.textContent = `Searching… ${formatTime(ms - (ms % 1000))}`;
    };
    tick();
    this.searchTimer = window.setInterval(tick, 1000);
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
    for (const [mode, card] of this.cards) {
      card.hidden = !cat.modes.includes(mode);
      card.classList.toggle('selected', mode === this.selected);
      card.setAttribute('aria-selected', String(mode === this.selected));
    }
  }

  /** Shows the tab with this mode and selects it (for tests and links). */
  showMode(mode: ModeId): void {
    const cat = CATEGORIES.find((c) => c.modes.includes(mode));
    if (cat) this.showTab(cat.id);
    this.select(mode);
  }

  setProfile(p: Profile): void {
    const { rank, next, progress } = rankProgress(p.xp);
    for (const el of [this.name, this.chipName]) {
      el.textContent = p.name;
      el.classList.toggle('rainbow', p.developer);
    }
    for (const el of [this.rank, this.chipRank]) {
      el.textContent = String(rank.level);
      el.dataset.level = String(rank.level);
      el.title = (next ? `Level ${rank.level} · ${rank.name}: ${next.xp - p.xp} rank points to ${next.name}` : `Level ${rank.level} · ${rank.name} (top rank)`) + '. Levels move in FaceChiken.';
    }
    this.chipLevel.textContent = `Lv ${rank.level} ${rank.name}`;
    this.record.textContent = `Lv ${rank.level} ${rank.name}` + (p.stats.matches > 0 ? ` · ${p.stats.wins} wins` : '');
    this.xpFill.style.width = `${Math.round(progress * 100)}%`;
    this.xpText.textContent = next ? `${p.xp - rank.xp} / ${next.xp - rank.xp} XP` : `${p.xp} XP · top rank`;
    this.coins.replaceChildren(icon('coin'), p.coins.toLocaleString());
    this.accountLink.textContent = p.username ? 'Account' : 'Save progress';
  }

  /** Where the chicken's feet are on screen (0..1): the name plate sits right under them. */
  setAnchor(x: number, y: number): void {
    const px = `${(x * 100).toFixed(2)}%`;
    const py = `${(y * 100).toFixed(2)}%`;
    if (this.root.style.getPropertyValue('--chick-x') === px && this.root.style.getPropertyValue('--chick-y') === py) return;
    this.root.style.setProperty('--chick-x', px);
    this.root.style.setProperty('--chick-y', py);
  }

  /** Before Mirage has loaded: a plain backdrop and a note where the scene will be. */
  setSceneLoading(loading: boolean): void {
    this.root.classList.toggle('scene-loading', loading);
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
    window.clearInterval(this.onlineTimer);
    if (!visible) {
      this.openNews(false);
      return;
    }
    this.openNews(false);
    // Open on the selected mode's tab, with its card highlighted (not whichever tab was open last).
    this.showMode(this.selected);
    // While the title screen is up: today's challenges and the player count, kept fresh.
    this.refreshLive();
    this.onlineTimer = window.setInterval(() => this.refreshLive(), ONLINE_EVERY_MS);
  }
}
