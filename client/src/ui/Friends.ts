import { MODES, SOCIAL, rankOf, type FriendEntry, type FriendsState, type JoinSuccess, type PartyInvite, type PartyState, type SocialResult } from '@game/shared';
import type { GameSocket } from '../net/Network';
import { clear, h } from './dom';
import { openModal, type ModalHandle } from './Modal';

const REQUEST_TIMEOUT_MS = 6000;

export interface FriendsCallbacks {
  /** Something to tell the player ("Bob accepted your friend request"). */
  notice(text: string): void;
  /** The party leader started a match and the server put us in it. */
  joined(join: JoinSuccess): void;
  /** Guests: open the account dialog to register. */
  register(): void;
}

/**
 * Friends and parties on the client: keeps the state the server pushes, draws the Friends
 * panel, and shows party invites. Every button just asks the server, which checks it.
 */
export class Friends {
  state: FriendsState = { registered: false, friends: [], incoming: [], outgoing: [] };
  party: PartyState | null = null;
  /** Party invites not answered yet. */
  invites: (PartyInvite & { until: number })[] = [];
  selfId = 0;
  /** In a match: invites come as a toast (the mouse is locked) instead of a popup card. */
  inGame = false;

  private readonly socket: GameSocket;
  private readonly callbacks: FriendsCallbacks;
  private readonly popups = h('div', { class: 'party-popups' });
  private readonly listeners = new Set<() => void>();
  private modal: ModalHandle | null = null;
  private body: HTMLElement | null = null;
  private addInput: HTMLInputElement | null = null;
  private message = '';
  private messageBad = false;

  constructor(socket: GameSocket, container: HTMLElement, callbacks: FriendsCallbacks) {
    this.socket = socket;
    this.callbacks = callbacks;
    container.append(this.popups);
    socket.on('connect', () => void this.refresh());
    socket.on('friends', (s) => {
      this.state = s;
      this.changed();
    });
    socket.on('party', (p) => {
      this.party = p;
      this.changed();
    });
    socket.on('partyInvited', (invite) => {
      this.invites = [...this.invites.filter((i) => i.partyId !== invite.partyId), { ...invite, until: Date.now() + SOCIAL.inviteMs }];
      if (this.inGame) callbacks.notice(`📨 ${invite.from.name} invited you to their party: answer in 👥 Friends on the menu.`);
      this.showPopups();
      this.changed();
    });
    socket.on('partyJoined', (join) => callbacks.joined(join));
    socket.on('notice', (text) => callbacks.notice(text));
  }

  /** Asks for the current lists (after connecting or signing in). */
  async refresh(): Promise<void> {
    try {
      const [state, party] = await Promise.all([
        this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('friendsList'),
        this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('partyState'),
      ]);
      this.state = state;
      this.party = party;
      this.changed();
    } catch {
      // Offline: try again on the next connect.
    }
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Requests and invites waiting for you (the menu button's badge). */
  get waiting(): number {
    return this.state.incoming.length + this.liveInvites().length;
  }

  get isLeader(): boolean {
    return this.party !== null && this.party.leader === this.selfId;
  }

  setInGame(inGame: boolean): void {
    this.inGame = inGame;
    this.showPopups();
  }

  open(): void {
    if (this.modal) return;
    this.body = h('div', { class: 'friends' });
    this.modal = openModal('👥 Friends', this.body, {
      wide: true,
      onClose: () => {
        this.modal = null;
        this.body = null;
        this.addInput = null;
      },
    });
    this.message = '';
    void this.refresh();
    this.render();
    this.addInput?.focus();
  }

  // ---------------------------------------------------------------------------

  private changed(): void {
    this.render();
    this.showPopups();
    for (const fn of this.listeners) fn();
  }

  private liveInvites(): (PartyInvite & { until: number })[] {
    const now = Date.now();
    this.invites = this.invites.filter((i) => i.until > now && i.partyId !== this.party?.id);
    return this.invites;
  }

  private async ask(event: 'friendRequest' | 'friendRespond' | 'friendRemove' | 'partyInvite' | 'partyAnswer' | 'partyLeave' | 'partyKick', arg?: unknown, done?: string): Promise<boolean> {
    let res: SocialResult;
    try {
      const s = this.socket.timeout(REQUEST_TIMEOUT_MS) as unknown as { emitWithAck(e: string, ...a: unknown[]): Promise<SocialResult> };
      res = await (arg === undefined ? s.emitWithAck(event) : s.emitWithAck(event, arg));
    } catch {
      res = { ok: false, error: 'Could not reach the server.' };
    }
    this.message = res.ok ? (done ?? '') : (res.error ?? 'That didn’t work.');
    this.messageBad = !res.ok;
    this.render();
    return res.ok;
  }

  private answerInvite(invite: PartyInvite, accept: boolean): void {
    this.invites = this.invites.filter((i) => i.partyId !== invite.partyId);
    void this.ask('partyAnswer', { partyId: invite.partyId, accept }, accept ? `You joined ${invite.from.name}’s party.` : '');
    this.showPopups();
  }

  /** Invite cards in the corner of the menu. */
  private showPopups(): void {
    clear(this.popups);
    if (this.inGame) return;
    for (const invite of this.liveInvites()) {
      this.popups.append(
        h(
          'div',
          { class: 'party-popup panel' },
          h('div', null, h('b', null, `📨 ${invite.from.name}`), ' invited you to their party', h('small', null, ` (${invite.size}/${SOCIAL.partySize})`)),
          h(
            'div',
            { class: 'row' },
            h('button', { type: 'button', class: 'play', onclick: () => this.answerInvite(invite, true) }, 'Join'),
            h('button', { type: 'button', class: 'secondary', onclick: () => this.answerInvite(invite, false) }, 'No thanks'),
          ),
        ),
      );
    }
  }

  private render(): void {
    const body = this.body;
    if (!body) return;
    const typed = this.addInput?.value ?? '';
    const typing = this.addInput !== null && document.activeElement === this.addInput;
    clear(body);
    if (!this.state.registered) {
      body.append(
        h('p', null, 'Friends need a username, so they can find you.'),
        h('button', { type: 'button', class: 'play', onclick: () => (this.modal?.close(), this.callbacks.register()) }, 'Save progress (free)'),
      );
      return;
    }

    // Your party.
    const party = this.party;
    const partyBox = h('section', { class: 'friends-party' });
    if (party) {
      partyBox.append(h('h3', null, `Your party · ${party.members.length}/${SOCIAL.partySize}`));
      const chips = h('div', { class: 'party-chips' });
      for (const m of party.members) {
        const kick =
          this.isLeader && m.userId !== this.selfId
            ? h('button', { type: 'button', class: 'chip-x', title: `Remove ${m.name}`, onclick: () => void this.ask('partyKick', m.userId) }, '✕')
            : null;
        chips.append(h('span', { class: `party-chip${m.online ? '' : ' off'}` }, m.userId === party.leader ? '👑 ' : '', m.name, m.mode ? h('small', null, ` · ${MODES[m.mode].name}`) : null, kick));
      }
      for (const inv of party.invited) chips.append(h('span', { class: 'party-chip invited' }, `${inv.name}…`));
      partyBox.append(
        chips,
        h('p', { class: 'muted' }, this.isLeader ? 'You lead: pick a mode and press Play, and everyone comes along, on your team.' : 'Your leader picks the mode and presses Play; you’ll join together, on one team.'),
        h('button', { type: 'button', class: 'secondary', onclick: () => void this.ask('partyLeave', undefined, 'You left the party.') }, 'Leave party'),
      );
    } else {
      partyBox.append(h('h3', null, 'Party'), h('p', { class: 'muted' }, `Invite up to ${SOCIAL.partySize - 1} friends: you queue together and play on the same team.`));
    }
    body.append(partyBox);

    // Party invites.
    const invites = this.liveInvites();
    if (invites.length) {
      const box = h('section', null, h('h3', null, 'Party invites'));
      for (const inv of invites) {
        box.append(
          h(
            'div',
            { class: 'friend-row' },
            h('span', { class: 'friend-name' }, `📨 ${inv.from.name}`, h('small', null, ` · party of ${inv.size}`)),
            h('button', { type: 'button', class: 'play small', onclick: () => this.answerInvite(inv, true) }, 'Join'),
            h('button', { type: 'button', class: 'secondary small', onclick: () => this.answerInvite(inv, false) }, 'No'),
          ),
        );
      }
      body.append(box);
    }

    // Add a friend.
    const input = h('input', { class: 'friend-input', placeholder: 'Their username', maxlength: 16, autocomplete: 'off', 'aria-label': 'Username to add' });
    input.value = typed;
    this.addInput = input;
    const add = () => {
      const name = input.value.trim();
      if (!name) return;
      void this.ask('friendRequest', name, `Request sent to ${name}.`).then((sent) => {
        // The panel has been redrawn by now: empty the box that's showing.
        if (sent && this.addInput) this.addInput.value = '';
      });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });
    body.append(
      h('section', null, h('h3', null, 'Add a friend'), h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'play', onclick: add }, 'Add'))),
      h('p', { class: `status${this.messageBad ? ' error' : ''}`, role: 'status' }, this.message),
    );
    if (typing) queueMicrotask(() => input.focus());

    // Requests for you.
    if (this.state.incoming.length) {
      const box = h('section', null, h('h3', null, `Requests · ${this.state.incoming.length}`));
      for (const r of this.state.incoming) {
        box.append(
          h(
            'div',
            { class: 'friend-row' },
            h('span', { class: 'friend-name' }, r.name, h('small', null, ` @${r.username}`)),
            h('button', { type: 'button', class: 'play small', onclick: () => void this.ask('friendRespond', { userId: r.userId, accept: true }, `You and ${r.name} are friends.`) }, 'Accept'),
            h('button', { type: 'button', class: 'secondary small', onclick: () => void this.ask('friendRespond', { userId: r.userId, accept: false }) }, 'Decline'),
          ),
        );
      }
      body.append(box);
    }

    // Friends: online first.
    const friends = [...this.state.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const online = friends.filter((f) => f.online).length;
    const box = h('section', null, h('h3', null, `Friends · ${online} online of ${friends.length}`));
    if (!friends.length) box.append(h('p', { class: 'muted' }, 'No friends yet: add someone by their username.'));
    for (const f of friends) box.append(this.friendRow(f));
    body.append(box);

    if (this.state.outgoing.length) {
      const sent = h('section', null, h('h3', null, 'Sent'));
      for (const r of this.state.outgoing) {
        sent.append(
          h(
            'div',
            { class: 'friend-row' },
            h('span', { class: 'friend-name' }, r.name, h('small', null, ` @${r.username} · waiting`)),
            h('button', { type: 'button', class: 'secondary small', onclick: () => void this.ask('friendRemove', r.userId) }, 'Cancel'),
          ),
        );
      }
      body.append(sent);
    }
  }

  private friendRow(f: FriendEntry): HTMLElement {
    const rank = rankOf(f.rank);
    const status = !f.online ? 'Offline' : f.mode ? `Playing ${MODES[f.mode].name}` : 'Online';
    const canInvite = f.online && !f.inParty && (!this.party || this.isLeader);
    let confirmRemove = false;
    const remove = h('button', { type: 'button', class: 'secondary small', title: `Remove ${f.name}` }, '✕');
    remove.addEventListener('click', () => {
      if (!confirmRemove) {
        confirmRemove = true;
        remove.textContent = 'Remove?';
        return;
      }
      void this.ask('friendRemove', f.userId, `Removed ${f.name}.`);
    });
    return h(
      'div',
      { class: `friend-row${f.online ? ' online' : ''}` },
      h('span', { class: `presence ${!f.online ? 'off' : f.mode ? 'busy' : 'on'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'friend-name' }, h('span', { title: `Level ${rank.level} · ${rank.name}` }, `${rank.icon} `), f.dev ? h('span', { class: 'rainbow' }, f.name) : f.name, h('small', null, ` @${f.username} · ${status}`)),
      f.inParty ? h('span', { class: 'muted small' }, 'In your party') : canInvite ? h('button', { type: 'button', class: 'play small', onclick: () => void this.ask('partyInvite', f.userId, `Invited ${f.name}.`) }, 'Invite') : null,
      remove,
    );
  }
}
