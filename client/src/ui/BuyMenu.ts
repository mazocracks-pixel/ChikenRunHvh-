import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BUY_CATEGORIES,
  BUY_ITEMS,
  WEAPONS,
  canTeamBuy,
  isMelee,
  isSidearm,
  type Appearance,
  type BuyItem,
  type Team,
  type WeaponId,
} from '@game/shared';
import { Chicken } from '../game/models/Chicken';
import { gunIcon, prepareGunIcons } from './GunIcons';
import { clear, formatTime, h } from './dom';
import { icon, type IconName } from './icons';

export interface BuyMenuView {
  money: number;
  team: Team;
  /** Seconds of buy time left, null in warmup (free, no limit), or 0 once buy time is over. */
  secondsLeft: number | null;
  /** Why an item can't be bought right now (already owned...), or null. */
  blocked: (item: BuyItem) => string | null;
  loadout: readonly WeaponId[];
  armor: number;
  eggs: number;
  smokes: number;
  flashes: number;
  hasKit: boolean;
}

const GEAR_ICONS: Record<string, IconName> = { armor: 'vest', eggs: 'egg', smoke: 'grenade', flash: 'flash', kit: 'kit' };
const GEAR_TEXT: Record<string, string> = {
  armor: 'Absorbs half of incoming damage while armor remains.',
  eggs: 'Explosive egg (G): area damage and knockback.',
  smoke: 'Smoke grenade (Q): a cloud nobody can see through.',
  flash: 'Flashbang (Z): blinds whoever looks at it. Turn away when you throw it!',
  kit: 'Defuse in 5 seconds instead of 10.',
};

/** Five-column round shop with the player's chicken holding the selected gun. */
export class BuyMenu {
  readonly root = h('div', { class: 'buy-overlay' });
  private readonly money = h('span', { class: 'buy-money' });
  private readonly timer = h('span', { class: 'buy-timer' });
  private readonly status = h('div', { class: 'buy-status', role: 'status', 'aria-live': 'polite' });
  private readonly stage = h('div', { class: 'buy-stage' });
  private readonly detail = h('div', { class: 'buy-detail' });
  private readonly loadoutEl = h('div', { class: 'buy-loadout' });
  private readonly columns = h('div', { class: 'buy-columns' });
  private readonly cards = new Map<string, HTMLButtonElement>();
  private lastKey = '';
  private team: Team = 0;
  private view: BuyMenuView | null = null;
  private hovered: BuyItem | null = null;
  private categoryIndex: number | null = null;
  private previousFocus: HTMLElement | null = null;
  onBuy: ((item: BuyItem) => void) | null = null;
  onClose: (() => void) | null = null;

  // The 3D chicken (its own small renderer, made the first time the menu opens).
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private envTexture: THREE.Texture | null = null;
  private chicken: Chicken | null = null;
  private spin = Math.PI + 0.6;
  private dragX: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private failed = false;

  constructor(
    container: HTMLElement,
    private appearance: Appearance,
  ) {
    const close = h('button', { type: 'button', class: 'buy-close', 'aria-label': 'Close the buy menu' }, '✕');
    close.addEventListener('click', () => this.onClose?.());
    const window_ = h(
      'div',
      { class: 'buy-window', role: 'dialog', 'aria-label': 'Buy menu', 'aria-modal': 'true' },
      h('header', { class: 'buy-head' }, this.money, this.timer, close),
      h('div', { class: 'buy-body' }, this.columns, h('aside', { class: 'buy-side', 'aria-label': 'Chicken and weapon preview' }, this.stage, this.detail)),
      this.loadoutEl,
      h('footer', { class: 'buy-foot' }, this.status, h('small', null, '1–5 category · 1–7 item · B / Esc close')),
    );
    this.root.append(window_);
    // A click on the dim area around the window closes it too.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose?.();
    });
    this.root.hidden = true;
    container.append(this.root);
    this.buildColumns();
    this.stage.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.spin += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
    });
    this.stage.addEventListener('pointerup', () => (this.dragX = null));
    this.stage.addEventListener('pointercancel', () => (this.dragX = null));
    this.stage.addEventListener('lostpointercapture', () => (this.dragX = null));
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.root.hidden = !open;
    if (open) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.categoryIndex = null;
      this.say('');
      prepareGunIcons();
      this.ensurePreview();
      window.addEventListener('keydown', this.onKey, true);
      this.root.querySelector<HTMLButtonElement>('.buy-close')?.focus();
    } else {
      window.removeEventListener('keydown', this.onKey, true);
      this.previousFocus?.focus();
      this.columns.querySelector('.selected')?.classList.remove('selected');
    }
  }

  setAppearance(a: Appearance, team: Team): void {
    this.appearance = a;
    this.chicken?.setAppearance(a);
    this.chicken?.setTeam(team);
  }

  say(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
  }

  /** Draws the idle chicken; dragging the preview turns it. */
  update(dt: number): void {
    if (!this.open) return;
    for (const img of this.root.querySelectorAll<HTMLImageElement>('img[data-weapon]')) {
      const picture = gunIcon(img.dataset.weapon as WeaponId);
      if (picture && img.getAttribute('src') !== picture.url) img.src = picture.url;
    }
    if (!this.renderer || !this.chicken) return;
    this.chicken.root.rotation.y = this.spin;
    this.chicken.animate(dt, 0, true);
    this.renderer.render(this.scene!, this.camera!);
  }

  render(v: BuyMenuView): void {
    this.view = v;
    if (v.team !== this.team) {
      this.team = v.team;
      this.buildColumns();
    }
    const over = v.secondsLeft === 0;
    const key = `${v.money}|${v.team}|${v.secondsLeft}|${v.loadout.join(',')}|${v.armor}|${v.eggs}|${v.smokes}|${v.flashes}|${v.hasKit}|${BUY_ITEMS.map((i) => v.blocked(i) ?? '').join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.money.textContent = v.secondsLeft === null ? 'Warmup: free' : `$${v.money.toLocaleString()}`;
    this.timer.replaceChildren(h('span', null, v.secondsLeft === null ? 'Warmup' : over ? 'Buy time is over' : 'Buy Time Remaining'), h('b', null, v.secondsLeft === null || over ? '' : formatTime(v.secondsLeft * 1000)));
    this.timer.classList.toggle('over', over);
    for (const item of this.items()) {
      const card = this.cards.get(item.id);
      if (!card) continue;
      const blocked = v.blocked(item);
      const price = v.secondsLeft === null ? 0 : item.price;
      const poor = !blocked && price > v.money;
      card.classList.toggle('owned', blocked === 'Owned' || blocked === 'Full');
      card.classList.toggle('poor', poor);
      card.classList.toggle('locked', over || blocked !== null);
      card.setAttribute('aria-disabled', String(over || blocked !== null || poor));
      card.querySelector('.buy-price')!.textContent = blocked ?? (price === 0 ? 'Free' : `$${price.toLocaleString()}`);
    }
    this.renderLoadout(v);
    if (!this.hovered) this.showItem(null);
  }

  dispose(): void {
    this.setOpen(false);
    this.resizeObserver?.disconnect();
    this.chicken?.dispose();
    this.envTexture?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.root.remove();
  }

  // ---------------------------------------------------------------------------

  /** Your team's items: the other team's exclusives are left out. */
  private items(): BuyItem[] {
    return BUY_ITEMS.filter((i) => canTeamBuy(i, this.team));
  }

  private buildColumns(): void {
    clear(this.columns);
    this.cards.clear();
    for (const [categoryIndex, cat] of BUY_CATEGORIES.entries()) {
      const items = this.items().filter((i) => i.category === cat.id);
      if (items.length === 0) continue;
      const grid = h('div', { class: 'buy-grid' });
      for (const [itemIndex, item] of items.entries()) {
        const pic = item.weapon ? h('img', { class: 'buy-pic', alt: '', src: gunIcon(item.weapon)?.url ?? '', 'data-weapon': item.weapon }) : icon(GEAR_ICONS[item.id]!, 'buy-pic');
        const card = h(
          'button',
          { type: 'button', class: `buy-card${item.team ? ` team${item.team}` : ''}`, 'data-item': item.id },
          h('span', { class: 'buy-number', 'aria-hidden': 'true' }, itemIndex + 1),
          pic,
          h('span', { class: 'buy-name' }, item.name),
          h('span', { class: 'buy-price' }, `$${item.price.toLocaleString()}`),
        );
        card.addEventListener('click', () => {
          this.categoryIndex = null;
          this.columns.querySelector('.selected')?.classList.remove('selected');
          if (card.getAttribute('aria-disabled') !== 'true') this.onBuy?.(item);
          else this.say(this.view?.blocked(item) ?? (this.view?.secondsLeft === 0 ? 'Buy time is over.' : 'Not enough money.'), true);
        });
        card.addEventListener('pointerenter', () => this.showItem(item));
        card.addEventListener('focus', () => this.showItem(item));
        card.addEventListener('pointerleave', () => this.showItem(null));
        this.cards.set(item.id, card);
        grid.append(card);
      }
      this.columns.append(h('section', { class: `buy-cat cat-${cat.id}` }, h('h3', null, h('span', { 'aria-hidden': 'true' }, categoryIndex + 1), cat.name), grid));
    }
    this.lastKey = '';
  }

  /** The chicken holds what you point at; the panel under it shows the numbers. */
  private showItem(item: BuyItem | null): void {
    this.hovered = item;
    const loadout = this.view?.loadout ?? [];
    const holding = item?.weapon ?? loadout.find((w) => !isMelee(w)) ?? loadout[0] ?? 'pistol';
    this.chicken?.setWeapon(holding);
    clear(this.detail);
    if (item && !item.weapon) {
      this.detail.append(h('h4', null, item.name), h('p', null, GEAR_TEXT[item.id] ?? ''));
      return;
    }
    const w = WEAPONS[holding];
    const bar = (label: string, value: number, text: string) =>
      h('div', { class: 'buy-stat' }, h('span', null, label), h('i', null, h('b', { style: `width:${Math.round(Math.max(0.04, Math.min(1, value)) * 100)}%` })), h('em', null, text));
    const dmg = w.damage * w.pellets;
    const rpm = Math.round(60_000 / w.fireInterval);
    const shots = w.burst ? `${w.burst.count}-round burst` : w.automatic ? 'automatic' : 'semi-auto';
    this.detail.append(
      h('h4', null, w.name),
      w.projectile
        ? h('p', { class: 'buy-note' }, w.projectile === 'bolt' ? 'Fires bolts that drop with distance.' : 'Fires explosives: area damage, knockback.')
        : bar('Damage', dmg / 100, `${dmg}${w.pellets > 1 ? ` (${w.pellets}×${w.damage})` : ''}`),
      bar('Fire rate', rpm / 900, `${rpm}/min · ${shots}`),
      bar('Accuracy', 1 - w.spread / 0.09, w.scope ? 'scope' : `${Math.round((1 - w.spread / 0.09) * 100)}%`),
      bar('Range', w.range / 250, `${w.range} m`),
      h('p', { class: 'buy-note' }, `Magazine ${w.magazine} · ${isSidearm(holding) ? 'pistol slot' : 'main gun'}${w.moveSpeed && w.moveSpeed < 1 ? ' · heavy (slower)' : ''}`),
    );
  }

  private renderLoadout(v: BuyMenuView): void {
    clear(this.loadoutEl);
    const main = v.loadout.find((w) => !isMelee(w) && !isSidearm(w));
    const pistol = v.loadout.find((w) => isSidearm(w));
    const melee = v.loadout.find((w) => isMelee(w));
    const slot = (label: string, id: WeaponId | undefined) =>
      h('div', { class: `buy-slot${id ? '' : ' empty'}` }, id ? h('img', { src: gunIcon(id)?.url ?? '', 'data-weapon': id, alt: '' }) : null, h('small', null, label), h('b', null, id ? WEAPONS[id].name : '—'));
    this.loadoutEl.append(
      h('h4', null, 'Your loadout'),
      slot('Main', main),
      slot('Pistol', pistol),
      slot('Melee', melee),
      h(
        'div',
        { class: 'buy-gear' },
        h('span', { class: v.armor > 0 ? 'on' : '' }, icon('vest'), ` ${v.armor}`),
        h('span', { class: v.eggs > 0 ? 'on' : '' }, icon('egg'), ` ${v.eggs}`),
        h('span', { class: v.smokes > 0 ? 'on' : '' }, icon('grenade'), ` ${v.smokes}`),
        h('span', { class: v.flashes > 0 ? 'on' : '' }, icon('flash'), ` ${v.flashes}`),
        v.team === 2 ? h('span', { class: v.hasKit ? 'on' : '' }, icon('kit'), ` ${v.hasKit ? 'Kit' : 'No kit'}`) : null,
      ),
    );
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat && e.key !== 'Tab') return;
    if (e.key === 'Tab') {
      const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(current + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    } else if (/^[1-7]$/.test(e.key)) {
      const index = Number(e.key) - 1;
      if (this.categoryIndex === null) {
        if (index >= BUY_CATEGORIES.length) return;
        this.categoryIndex = index;
        this.columns.children[index]?.classList.add('selected');
        this.say(`${BUY_CATEGORIES[index]!.name}: choose an item.`);
      } else {
        this.columns.children[this.categoryIndex]?.querySelectorAll<HTMLButtonElement>('button')[index]?.click();
      }
    } else if (e.code === 'KeyB' || e.key === 'Escape') {
      this.onClose?.();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // ---------------------------------------------------------------------------
  // The 3D preview
  // ---------------------------------------------------------------------------

  private ensurePreview(): void {
    if (this.renderer || this.failed) return;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.setClearColor(0x000000, 0);
      this.renderer = renderer;
    } catch {
      // No WebGL for a second canvas: the menu still works, just without pictures.
      this.failed = true;
      return;
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    this.scene = new THREE.Scene();
    this.scene.environment = this.envTexture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    this.scene.add(floor);
    this.chicken = new Chicken(this.appearance, this.team);
    this.scene.add(this.chicken.root);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.25, 3.9);
    this.camera.lookAt(0, 0.82, 0);

    this.stage.append(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.fitStage());
    this.resizeObserver.observe(this.stage);
    this.fitStage();
    this.showItem(this.hovered);
  }

  private fitStage(): void {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(1, this.stage.clientWidth);
    const hgt = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

}
