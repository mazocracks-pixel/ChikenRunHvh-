import type { CreateRoomRequest, JoinResponse, JoinSuccess, ModeId } from '@game/shared';
import { Dev } from '../dev/Dev';
import { exitPlayFullscreen } from '../fullscreen';
import { Game } from '../game/Game';
import { Api } from '../net/Api';
import { Network } from '../net/Network';
import { openAccount, openCreateRoom, openJoinCode, openLeaderboard, openServerBrowser, openSettings } from '../ui/Dialogs';
import { byId, h } from '../ui/dom';
import { MainMenu } from '../ui/MainMenu';
import { CookieNotice, openPrivacy } from '../ui/Privacy';
import { anyModalOpen, setModalLayer } from '../ui/Modal';
import { ShopScreen } from '../ui/Shop';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';

type Screen = 'boot' | 'menu' | 'shop' | 'game';

/** Top-level controller: boot, menus, joining rooms, pause and reconnects. */
export class App {
  private readonly api = new Api();
  private readonly net = new Network();
  private readonly game: Game;
  private readonly dev: Dev;
  private readonly menu: MainMenu;
  private readonly shop: ShopScreen;
  private readonly touch: TouchControls | null;
  private readonly pause: HTMLElement;
  private readonly loading: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly cookieNotice: CookieNotice;
  private screen: Screen = 'boot';
  private joining = false;
  private touchPaused = false;
  /** The room to get back into after a dropped connection. */
  private lastRoom: { id: string; mode: ModeId } | null = null;
  private rejoinOnConnect = false;

  constructor() {
    const ui = byId('ui-layer');
    setModalLayer(byId('modal-layer'));
    this.game = new Game(byId<HTMLCanvasElement>('game'), byId('hud-layer'));

    this.menu = new MainMenu(ui, {
      quickPlay: (mode, map) => this.enter(() => this.net.quickPlay(mode, map)),
      browse: () => openServerBrowser(() => this.net.listRooms(), (roomId) => this.enter(() => this.net.joinRoom({ roomId }), true)),
      createRoom: () => openCreateRoom((req: CreateRoomRequest) => this.enter(() => this.net.createRoom(req), true)),
      joinCode: () => openJoinCode((code) => this.enter(() => this.net.joinRoom({ code }), true)),
      customize: () => this.showShop(),
      leaderboard: () => void openLeaderboard(this.api),
      account: () => openAccount(this.api, () => this.net.reconnect()),
      settings: () => openSettings(this.game.audio),
      privacy: () => openPrivacy(),
    });
    this.cookieNotice = new CookieNotice(ui);
    // Developer menu: the menu key (Insert by default), or tap the logo five times on touch screens.
    this.dev = new Dev({
      socket: this.net.socket,
      input: this.game.input,
      hud: this.game.hud,
      audio: this.game.audio,
      fps: () => this.game.fps,
      ping: () => this.net.ping,
      openCrosshairSettings: () => openSettings(this.game.audio, 'crosshair'),
      inGame: () => this.screen === 'game',
      onMenuChange: () => this.refreshOverlays(),
      applyWorldLook: (look) => this.game.setLook(look),
    });
    this.game.dev = this.dev.runtime;
    this.bindSecretTaps();
    // Ctrl is crouch, and windowed (or outside Chrome / Edge) Ctrl+W can't be blocked: ask before leaving a match.
    window.addEventListener('beforeunload', (e) => {
      if (this.screen !== 'game') return;
      e.preventDefault();
      e.returnValue = '';
    });
    this.shop = new ShopScreen(ui, this.api, (appearance, weapon) => this.game.setPreview(appearance, weapon), () => this.showMenu());

    this.loading = h('div', { class: 'loading' }, h('div', { class: 'egg-spinner' }, '🥚'), h('p', null, 'Hatching…'));
    ui.append(this.loading);

    const resume = h('button', { type: 'button' }, this.isTouch ? 'Resume' : 'Click to play');
    resume.addEventListener('click', () => {
      this.touchPaused = false;
      this.game.audio.unlock();
      void this.game.input.requestLock();
      this.refreshOverlays();
    });
    this.pause = h(
      'div',
      { class: 'overlay pause' },
      h(
        'div',
        { class: 'panel card' },
        h('h2', null, 'Paused'),
        resume,
        h('button', { type: 'button', class: 'secondary', onclick: () => openSettings(this.game.audio) }, 'Settings'),
        h('button', { type: 'button', class: 'secondary', onclick: () => this.leave() }, 'Leave match'),
      ),
    );
    this.pause.hidden = true;
    ui.append(this.pause);

    this.pauseButton = h('button', { class: 'touch-pause icon-btn', type: 'button', 'aria-label': 'Pause' }, '❚❚');
    this.pauseButton.hidden = true;
    this.pauseButton.addEventListener('click', () => {
      this.touchPaused = true;
      this.refreshOverlays();
    });
    ui.append(this.pauseButton);

    this.touch = this.isTouch ? new TouchControls(byId('hud-layer'), this.game.input) : null;
    this.game.input.touchMode = this.isTouch;
    this.game.input.onLockChange = () => this.refreshOverlays();
    this.api.onProfile((p) => this.menu.setProfile(p));
    this.bindConnection();
    this.menu.setVisible(false);
  }

  /** Five quick taps on the title open the developer menu (there is no Insert key on phones). */
  private bindSecretTaps(): void {
    const logo = document.querySelector('.main-menu .logo');
    let taps: number[] = [];
    logo?.addEventListener('click', () => {
      const now = performance.now();
      taps = [...taps.filter((t) => now - t < 3000), now];
      if (taps.length >= 5) {
        taps = [];
        void this.dev.openMenu();
      }
    });
  }

  private get isTouch(): boolean {
    return isTouchDevice();
  }

  async start(): Promise<void> {
    try {
      await this.api.ensureSession();
    } catch {
      this.showServerDown();
      return;
    }
    this.net.connect();
    this.loading.hidden = true;
    this.showMenu();
  }

  private showServerDown(): void {
    const retry = h('button', { type: 'button' }, 'Retry');
    retry.addEventListener('click', () => {
      this.loading.replaceChildren(h('div', { class: 'egg-spinner' }, '🥚'), h('p', null, 'Hatching…'));
      void this.start();
    });
    this.loading.replaceChildren(
      h(
        'div',
        { class: 'panel card server-down' },
        h('h2', null, "Can't reach the game server"),
        h('p', null, 'The page loaded, but the game server is not answering.'),
        h('p', { class: 'muted' }, 'Developing locally? Start everything from the project folder with ', h('code', null, 'npm run dev'), ', then press Retry.'),
        retry,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  private showMenu(status = '', error = false): void {
    this.screen = 'menu';
    this.shop.close();
    this.game.setPreview(null);
    this.menu.setVisible(true);
    this.menu.setStatus(status, error);
    this.game.input.releaseLock();
    exitPlayFullscreen();
    this.refreshOverlays();
  }

  private showShop(): void {
    this.screen = 'shop';
    this.menu.setVisible(false);
    this.shop.open();
    void this.api.refresh().catch(() => undefined);
    this.refreshOverlays();
  }

  private refreshOverlays(): void {
    const inGame = this.screen === 'game';
    const locked = this.game.input.isLocked;
    const paused = inGame && (this.isTouch ? this.touchPaused : !locked);
    const devMenu = this.dev.menuOpen;
    this.pause.hidden = !paused || anyModalOpen() || devMenu;
    this.pauseButton.hidden = !inGame || !this.isTouch || paused || devMenu;
    this.touch?.setVisible(inGame && !paused && !devMenu);
    this.cookieNotice.setVisible(this.screen === 'menu' || this.screen === 'shop');
  }

  // ---------------------------------------------------------------------------
  // Joining and leaving
  // ---------------------------------------------------------------------------

  /** Must be called from a click: pointer lock and audio need a user gesture. */
  private enter(request: () => Promise<JoinResponse>, explicitRoom = false): void {
    if (this.joining) return;
    this.joining = true;
    this.game.audio.unlock();
    void this.game.input.requestLock();
    this.menu.setBusy(true);
    this.menu.setStatus(explicitRoom ? 'Joining room…' : 'Finding a match…');
    void request()
      .then((res) => {
        if (!res.ok) {
          this.showMenu(res.error, true);
          return;
        }
        this.startGame(res);
      })
      .catch(() => this.showMenu('Could not reach the game server.', true))
      .finally(() => {
        this.joining = false;
        this.menu.setBusy(false);
      });
  }

  private startGame(join: JoinSuccess): void {
    this.lastRoom = { id: join.room.id, mode: join.room.mode };
    this.touch?.setBombMode(join.room.mode === 'bomb');
    this.screen = 'game';
    this.touchPaused = false;
    this.menu.setVisible(false);
    this.shop.close();
    this.game.startSession(this.net, join, {
      onCoins: (total) => this.api.setCoins(total),
      onClosed: (reason) => {
        this.lastRoom = null;
        this.game.endSession();
        this.showMenu(reason, true);
      },
    });
    this.refreshOverlays();
  }

  private leave(): void {
    this.lastRoom = null;
    this.net.leaveRoom();
    this.game.endSession();
    this.showMenu();
    void this.api.refresh().catch(() => undefined);
  }

  private bindConnection(): void {
    const socket = this.net.socket;
    socket.on('disconnect', (reason) => {
      if (this.screen === 'game') {
        this.game.endSession();
        this.rejoinOnConnect = this.lastRoom !== null;
        this.showMenu('Connection lost. Reconnecting…', true);
      }
      // Socket.IO reconnects by itself unless the server closed the connection on purpose.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect', () => {
      if (!this.rejoinOnConnect || !this.lastRoom || this.screen !== 'menu') return;
      this.rejoinOnConnect = false;
      const { id, mode } = this.lastRoom;
      this.menu.setStatus('Reconnected, rejoining…');
      void this.net
        .joinRoom({ roomId: id })
        .then((res) => (res.ok ? res : this.net.quickPlay(mode)))
        .then((res) => (res.ok ? this.startGame(res) : this.showMenu(res.error, true)))
        .catch(() => this.showMenu('Could not rejoin.', true));
    });
    socket.on('connect_error', (err) => {
      // Our session expired (e.g. the database was reset): start over as a guest.
      if (err.message !== 'unauthorized') return;
      void this.api.startGuest().then(() => this.net.reconnect());
    });
  }
}
