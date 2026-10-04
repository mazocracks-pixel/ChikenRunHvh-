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

const MODE_COPY: Record<ModeId, { tag: string; short: string; icon: string }> = {
  ffa: { tag: 'EVERY CHICKEN FOR ITSELF', short: '12 players · 25 eliminations', icon: 'M12 3 9 7H5v10h5v4h4v-4h5V7h-4l-3-4ZM9 11h.01M15 11h.01M10 14h4' },
  tdm: { tag: 'FIND YOUR FLOCK', short: '5v5 · 40 eliminations', icon: 'm4 3 17 17M20 3 3 20M3 3l4 1-3 3-1-4ZM21 3l-4 1 3 3 1-4ZM2 16l6 6M16 22l6-6' },
  hvh: { tag: 'SEE THROUGH THE CHAOS', short: '5v5 · Shared wall vision', icon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
  knife: { tag: 'HOP FAST. HIT HARD.', short: '3v3 · Knives only', icon: 'm4 20 5-5M7 17l-2-2M9 15l9-12 3 3-8 11-4-2Z' },
  bomb: { tag: 'ONE EGG. TWO SIDES.', short: '5v5 · Plant or defuse', icon: 'M15 4h3l2-2M15 4l-2 3M10 7a7 7 0 1 0 4 0M7 12l2-2' },
  duel: { tag: 'SETTLE IT IN THE ARENA', short: '1v1 · First to 10', icon: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z' },
  ctf: { tag: 'STEAL. ESCAPE. REPEAT.', short: 'Team objective · 3 captures', icon: 'M5 22V3M5 4c5-5 9 5 15 0v10c-6 5-10-5-15 0' },
  sandbox: { tag: 'YOUR WORLD. YOUR RULES.', short: 'Build freely · No score limit', icon: 'm12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10M7 4l9 5' },
};

/** Fixed, source-native art: no external assets and no player-provided markup. */
function svgNode(tag: string, attributes: Record<string, string>, ...children: SVGElement[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.append(...children);
  return el;
}

function icon(path: string, className = ''): SVGElement {
  return svgNode('svg', { viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svgNode('path', { d: path }));
}

function roosterArt(): SVGElement {
  const path = (d: string, fill: string, extra: Record<string, string> = {}) => svgNode('path', { d, fill, ...extra });
  return svgNode('svg', { class: 'hero-rooster', viewBox: '0 0 430 360', 'aria-hidden': 'true' },
    svgNode('ellipse', { cx: '220', cy: '325', rx: '108', ry: '17', fill: '#13202b', opacity: '.16' }),
    // The backpack, exhaust and boots give the mascot a jetpack silhouette.
    path('M110 182 86 177Q75 176 75 190v72l39 13 17-52Z', '#14202b'),
    path('m83 267 11 40 12-34', '#f4c34c'), path('m88 271 7 22 5-17', '#fff0cc'),
    path('m151 273-24 31 9 12h55l1-20-18-26', '#14202b'),
    path('m236 265 31 31-7 20h-56l-1-24', '#14202b'),
    path('M157 276c-41-24-56-57-43-91 16-43 89-62 133-21 44 40 33 103-12 121Z', '#fff0cc'),
    path('M132 222c-1 26 26 45 64 47l35-48-55-25Z', '#f5d9a2'),
    path('m116 211-30-22 9-32 51 41Z', '#fff0cc'),
    path('m130 167-39-32 3-18 43 25Z', '#fff0cc'),
    path('M186 99c-16-16-31-28-18-41 10-10 24 4 28 12-7-27 0-40 13-39 14 1 11 20 9 33 14-20 29-21 37-12 10 13-10 26-19 32l-1 34Z', '#db4037'),
    path('M170 99c-30 31-25 99 13 117 52 23 99-12 99-65 0-37-32-73-65-72-19 0-36 8-47 20Z', '#fff0cc'),
    path('M177 192c17 12 25 19 20 31-4 10-25 12-31-1-4-9 2-22 11-30Z', '#db4037'),
    path('m254 143 58 22-48 22-23-17Z', '#f4842b'),
    path('m264 166 44-1-44 18Z', '#d95b1f'),
    path('M156 126c1-44 37-66 71-61 36 6 58 33 58 70l-23-7-4-9-91 21Z', '#14202b'),
    path('M174 92c18-17 44-21 65-11', 'none', { stroke: '#617982', 'stroke-width': '8', 'stroke-linecap': 'round' }),
    path('m151 127 112-15 13 53-87 17c-18 3-32-6-34-23Z', '#152733'),
    path('m169 133 77-10 8 32-62 12c-8 1-13-1-15-7Z', '#94d7d6'),
    path('m185 131 12 31 10-2-11-30Zm31-4 12 30 17-3-10-29Z', '#dff5e5'),
    path('M129 213c22-17 51-13 79-5l-5 35c-31-1-64 0-74-13Z', '#fff0cc'),
    // A chunky toy blaster, angled forward.
    path('m198 208 96-17 12 13 45-8 8 31-152 28-13-17Z', '#14202b'),
    path('m278 200 46-8 2 11-45 8Z', '#617982'),
    path('m222 231 58-10 3 14-57 10Z', '#f4842b'),
    path('m222 252 10 25 23-5-9-25Z', '#14202b'),
    path('m340 177 16-16m-7 27 25-1m-22 13 19 13', 'none', { stroke: '#fff0cc', 'stroke-width': '5', 'stroke-linecap': 'round' }),
    path('m57 78 6 13 14 3-12 8-2 14-9-11-14 2 8-12-4-14Z', '#fff0cc'),
    path('m344 86 5 9 10 1-7 7 1 10-9-5-9 4 2-10-7-7 10-1Z', '#14202b'),
  );
}

/** The lobby keeps every game mode and account action one deliberate click away. */
export class MainMenu {
  readonly root: HTMLElement;
  private readonly name = h('span', { class: 'profile-name' }, 'Recruit');
  private readonly coins = h('span', { class: 'coins', 'aria-label': 'Coins' }, '0');
  private readonly accountBtn = h('button', { class: 'chip-btn', type: 'button' }, 'Save progress');
  private readonly status = h('p', { class: 'status lobby-status', role: 'status', 'aria-live': 'polite' });
  private readonly featuredTitle = h('h3', { class: 'featured-title' });
  private readonly featuredDescription = h('p', { class: 'featured-description' });
  private readonly featuredRules = h('span', { class: 'featured-rules' });
  private readonly playLabel = h('span');
  private readonly playNote = h('p', { class: 'quick-play-note' });
  private readonly modeButtons = new Map<ModeId, HTMLButtonElement>();
  private readonly buttons: HTMLButtonElement[] = [];
  private selectedMode: ModeId = 'hvh';
  private busy = false;

  constructor(container: HTMLElement, actions: MenuActions) {
    const button = (label: string, onClick: () => void, cls = '') => {
      const b = h('button', { class: cls, type: 'button', onclick: onClick }, label);
      this.buttons.push(b);
      return b;
    };
    const utility = (label: string, detail: string, path: string, action: () => void, cls = '') => {
      const b = button('', action, `lobby-utility ${cls}`);
      b.append(icon(path), h('span', null, h('strong', null, label), h('small', null, detail)), h('span', { class: 'utility-arrow', 'aria-hidden': 'true' }, '↗'));
      return b;
    };
    this.accountBtn.addEventListener('click', actions.account);
    this.buttons.push(this.accountBtn);

    const modes = h('div', { class: 'mode-grid', 'aria-label': 'Choose a game mode' });
    for (const id of MODE_IDS) {
      const m = MODES[id];
      const copy = MODE_COPY[id];
      const b = button('', () => this.selectMode(id), `mode-card mode-${id}`);
      b.setAttribute('aria-pressed', 'false');
      b.append(
        h('span', { class: 'mode-card-top' }, icon(copy.icon, 'mode-icon'), h('span', { class: 'mode-category' }, m.building ? 'CREATIVE' : m.bomb ? 'TACTICAL' : m.teams ? 'TEAM' : 'SOLO'), h('span', { class: 'mode-check', 'aria-hidden': 'true' }, '✓')),
        h('strong', { class: 'mode-title' }, m.name),
        h('span', { class: 'mode-summary' }, copy.short),
      );
      this.modeButtons.set(id, b);
      modes.append(b);
    }

    const quickPlay = button('', () => actions.quickPlay(this.selectedMode), 'quick-play');
    quickPlay.append(icon('m9 5 10 7-10 7V5Z'), this.playLabel, h('span', { 'aria-hidden': 'true', class: 'play-arrow' }, '→'));

    const guide = h('details', { class: 'lobby-guide' },
      h('summary', null, 'Flight school', h('span', null, 'Controls & movement')),
      h('div', { class: 'control-grid' },
        h('p', null, h('kbd', null, 'WASD'), ' Move ', h('kbd', null, 'Mouse'), ' Aim'),
        h('p', null, h('kbd', null, 'Space'), ' Jump; hold to bunny hop'),
        h('p', null, h('kbd', null, 'Space ×2'), ' Glide / jetpack in the air'),
        h('p', null, h('kbd', null, 'Click'), ' Shoot ', h('kbd', null, 'RMB'), ' Zoom ', h('kbd', null, 'R'), ' Reload'),
        h('p', null, h('kbd', null, '1–4'), ' Guns ', h('kbd', null, '5'), ' Melee & faster hops'),
        h('p', null, h('kbd', null, 'G'), ' Egg ', h('kbd', null, 'Q'), ' Smoke ', h('kbd', null, 'Ctrl / C'), ' Crouch'),
        h('p', null, h('kbd', null, 'V'), ' Camera ', h('kbd', null, 'F'), ' Inspect'),
        h('p', null, h('kbd', null, 'Tab'), ' Scores ', h('kbd', null, 'T'), ' Chat'),
      ),
      h('p', { class: 'touch-guide' }, 'On mobile, use the left stick to move, drag the right side to aim, and tap the on-screen action buttons.'),
    );

    this.root = h('div', { class: 'screen main-menu' },
      h('div', { class: 'lobby-shell' },
        h('header', { class: 'menu-header' },
          h('div', { class: 'brand-lockup' },
            h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon(MODE_COPY.ffa.icon)),
            h('h1', { class: 'logo' }, 'CHIKEN', h('span', null, 'RUN'), h('small', null, 'HVH')),
          ),
          h('div', { class: 'header-tools' },
            button('Armory', actions.customize, 'header-link'),
            button('Leaderboard', actions.leaderboard, 'header-link'),
            button('Settings', actions.settings, 'header-link'),
            h('div', { class: 'profile-chip' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, icon(MODE_COPY.ffa.icon)), this.name, h('span', { class: 'coin-symbol', 'aria-hidden': 'true' }, '◈'), this.coins, this.accountBtn),
          ),
        ),
        h('main', { class: 'lobby-content' },
          h('section', { class: 'hero-card', 'aria-labelledby': 'lobby-headline' },
            h('div', { class: 'hero-copy' },
              h('p', { class: 'eyebrow' }, h('span', { class: 'eyebrow-dot' }), 'THE CHICKEN ARENA'),
              h('h2', { id: 'lobby-headline' }, 'NO PECKING', h('br'), h('span', { class: 'hero-title-outline' }, 'ORDER.')),
              h('p', { class: 'hero-subtitle' }, 'Big wings. Bigger trouble. Hop, glide, and outplay the flock.'),
              h('div', { class: 'hero-tags' }, h('span', null, 'BUNNY HOPS'), h('span', null, 'JETPACKS'), h('span', null, 'PURE CHAOS')),
            ),
            h('div', { class: 'hero-art' }, h('div', { class: 'hero-target', 'aria-hidden': 'true' }), roosterArt(), h('span', { class: 'hero-sticker' }, 'FLY THE COOP', h('small', null, 'CAUSE A LITTLE CHAOS'))),
          ),
          h('section', { class: 'launch-panel', 'aria-label': 'Quick play' },
            h('div', { class: 'featured-copy' }, h('p', { class: 'eyebrow featured-eyebrow' }, 'YOUR NEXT MATCH'), h('div', { class: 'featured-heading' }, this.featuredTitle, this.featuredRules), this.featuredDescription),
            h('div', { class: 'launch-actions' }, quickPlay, this.playNote),
          ),
          h('section', { class: 'mode-section', 'aria-labelledby': 'mode-heading' },
            h('div', { class: 'section-heading' }, h('h2', { id: 'mode-heading' }, 'PICK YOUR FIGHT'), h('span', null, '8 ways to rule the roost')),
            modes,
          ),
          h('nav', { class: 'menu-actions', 'aria-label': 'Rooms and customization' },
            utility('Create a room', 'Your arena. Your rules.', 'M12 5v14M5 12h14', actions.createRoom),
            utility('Join with code', 'Meet your flock.', 'M8 15a5 5 0 1 1 4-4l-8 8H2v-3l6-6', actions.joinCode),
            utility('Browse arenas', 'Find your next match.', 'M3 6h18M3 12h18M3 18h18M7 4v4M17 10v4M10 16v4', actions.browse),
            utility('Make it yours', 'Colors, gear & attitude.', 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5', actions.customize, 'armory-utility'),
          ),
          this.status,
        ),
        h('footer', { class: 'lobby-footer' }, guide, h('p', { class: 'lobby-motto' }, 'SMALL CHICKEN. BIG ENERGY.'), button('Cookies & privacy', actions.privacy, 'link')),
      ),
    );
    this.selectMode(this.selectedMode);
    container.append(this.root);
  }

  private selectMode(id: ModeId): void {
    this.selectedMode = id;
    const mode = MODES[id];
    this.featuredTitle.textContent = mode.name;
    this.featuredRules.textContent = MODE_COPY[id].tag;
    this.featuredDescription.textContent = mode.description;
    this.playLabel.textContent = this.busy ? 'Joining arena…' : `Play ${mode.name}`;
    this.playNote.textContent = mode.building ? 'Jump straight in · Make your own playground' : 'Jump straight in · Bots join the fight';
    for (const [key, b] of this.modeButtons) {
      const selected = key === id;
      b.classList.toggle('selected', selected);
      b.setAttribute('aria-pressed', String(selected));
    }
  }

  setProfile(p: Profile): void {
    this.name.textContent = p.name;
    this.name.classList.toggle('rainbow', p.developer);
    this.coins.textContent = p.coins.toLocaleString();
    this.accountBtn.textContent = p.username ? 'Account' : 'Save progress';
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.root.setAttribute('aria-busy', String(busy));
    for (const b of this.buttons) b.disabled = busy;
    this.playLabel.textContent = busy ? 'Joining arena…' : `Play ${MODES[this.selectedMode].name}`;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }
}
