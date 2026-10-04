import { h, storage } from './dom';
import { openModal } from './Modal';

const NOTICE_KEY = 'chikengun:cookie-notice';
/** Bump this when what the game stores changes, so everyone sees the notice again. */
const NOTICE_VERSION = '2';

/** "Cookies & privacy": what the game stores, where, for how long, and how to remove it. */
export function openPrivacy(): void {
  const section = (title: string, ...content: (Node | string)[]) => h('section', null, h('h3', null, title), ...content);
  const list = (...items: string[]) => h('ul', null, ...items.map((item) => h('li', null, item)));
  openModal(
    'Cookies & privacy',
    h(
      'div',
      { class: 'privacy' },
      section(
        '🍪 Cookies',
        h('p', null, 'We use one cookie, ', h('code', null, 'cg_session'), '. It keeps you signed in, so your coins and items are still there next time. The game needs it to work, so it can’t be switched off.'),
        list(
          'Scripts on the page can’t read it, and it’s never sent to other websites.',
          'It expires after 30 days without playing.',
          'No advertising, analytics or tracking cookies, and none from other companies.',
        ),
      ),
      section(
        '💾 Saved in your browser',
        h('p', null, 'Your settings (controls, crosshair, graphics, sound, camera view), HvH panel settings and saved configs, panel window positions, and that you closed the cookie notice. These stay in this browser until you clear site data. Each HvH panel keeps its own configs. Opponent overrides and resolver history last only for the current match and are not saved.'),
      ),
      section(
        '🗄️ Saved on our server',
        list(
          'Your player name, look, loadout, coins, items and match stats (kills, deaths, wins).',
          'If you register: your username and a scrambled (hashed) password. We never store the password itself.',
          'Once you’ve played a match, your name and stats can appear on the public leaderboard.',
          'Chat messages aren’t saved. Your IP address is only kept in memory for a short time to stop spam and attacks, never saved.',
          'Guest accounts nobody has played for 60 days are deleted.',
        ),
      ),
      section(
        '🧹 Your choices',
        list(
          'Account → Log out on all devices signs you out everywhere.',
          'Account → Delete account erases your account and everything above, for good.',
          'Clearing this site’s data in your browser removes the cookie and your settings (as a guest, that also means losing your guest account).',
        ),
      ),
    ),
  );
}

/**
 * The cookie notice bar. The only cookie is the strictly necessary login cookie, so there's
 * nothing to accept or refuse: the bar just says so, links to the details, and stays closed
 * once dismissed.
 */
export class CookieNotice {
  readonly root: HTMLElement;
  private dismissed = storage.get(NOTICE_KEY) === NOTICE_VERSION;
  /** Hidden until the menu shows (not over the loading screen). */
  private wanted = false;

  constructor(container: HTMLElement) {
    const ok = h('button', { type: 'button', class: 'cookie-ok' }, 'OK');
    ok.addEventListener('click', () => {
      this.dismissed = true;
      storage.set(NOTICE_KEY, NOTICE_VERSION);
      this.update();
    });
    this.root = h(
      'div',
      { class: 'cookie-notice panel', role: 'region', 'aria-label': 'Cookie notice' },
      h('span', { class: 'cookie-icon', 'aria-hidden': 'true' }, '🍪'),
      h(
        'p',
        null,
        'We use one cookie to keep you signed in: no ads or tracking. ',
        h('button', { type: 'button', class: 'link', onclick: openPrivacy }, 'Learn more'),
      ),
      ok,
    );
    container.append(this.root);
    this.update();
  }

  /** Shown on the menus until dismissed; never over a match. */
  setVisible(visible: boolean): void {
    this.wanted = visible;
    this.update();
  }

  private update(): void {
    this.root.hidden = this.dismissed || !this.wanted;
  }
}
