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
import { buildGun } from '../game/models/Guns';
import { clear, h } from './dom';

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

const GEAR_ICONS: Record<string, string> = { armor: '🛡️', eggs: '🥚', smoke: '💨', flash: '⚡', kit: '✂️' };
const GEAR_TEXT: Record<string, string> = {
  armor: 'Takes most of the damage from hits until it’s used up.',
  eggs: 'Explosive egg (G): area damage and knockback.',
  smoke: 'Smoke grenade (Q): a cloud nobody can see through.',
  flash: 'Flashbang (Z): blinds whoever looks at it. Turn away when you throw it!',
  kit: 'Defuse in 5 seconds instead of 10.',
};
const THUMB_W = 240;
const THUMB_H = 120;
/** Gun pictures, rendered once from the real models and kept for the whole visit. */
const thumbs = new Map<WeaponId, string>();

/**
 * ChikenBomb buy menu (B): your chicken on the left (holding whatever you point at), every gun
 * and piece of gear on the right. The mouse is free while it's open: click to buy. B or Esc closes.
 */
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
      { class: 'buy-window', role: 'dialog', 'aria-label': 'Buy menu' },
      h('header', { class: 'buy-head' }, h('h2', null, '🛒 Buy'), this.timer, h('span', { class: 'buy-spacer' }), this.money, close),
      h('div', { class: 'buy-body' }, h('aside', { class: 'buy-side' }, this.stage, this.detail, this.loadoutEl), this.columns),
      h('footer', { class: 'buy-foot' }, this.status, h('small', null, 'Click to buy · B or Esc to close')),
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
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.root.hidden = !open;
    if (open) {
      this.say('');
      this.ensurePreview();
      window.addEventListener('keydown', this.onKey, true);
    } else {
      window.removeEventListener('keydown', this.onKey, true);
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

  /** Spins and draws the chicken (called every frame while open). */
  update(dt: number): void {
    if (!this.open || !this.renderer || !this.chicken) return;
    if (this.dragX === null) this.spin += dt * 0.5;
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
    this.timer.textContent = v.secondsLeft === null ? '' : over ? 'Buy time is over' : `⏱ ${v.secondsLeft}s`;
    this.timer.classList.toggle('over', over);
    for (const item of this.items()) {
      const card = this.cards.get(item.id);
      if (!card) continue;
      const blocked = v.blocked(item);
      const price = v.secondsLeft === null ? 0 : item.price;
      const poor = !blocked && price > v.money;
      card.classList.toggle('owned', blocked !== null);
      card.classList.toggle('poor', poor);
      card.classList.toggle('locked', over);
      card.disabled = over;
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
    for (const cat of BUY_CATEGORIES) {
      const items = this.items().filter((i) => i.category === cat.id);
      if (items.length === 0) continue;
      const grid = h('div', { class: 'buy-grid' });
      for (const item of items) {
        const pic = item.weapon ? h('img', { class: 'buy-pic', alt: '', src: thumbs.get(item.weapon) ?? '', 'data-weapon': item.weapon }) : h('span', { class: 'buy-pic emoji' }, GEAR_ICONS[item.id] ?? '📦');
        const card = h(
          'button',
          { type: 'button', class: `buy-card${item.team ? ` team${item.team}` : ''}`, 'data-item': item.id },
          pic,
          h('span', { class: 'buy-name' }, item.name),
          h('span', { class: 'buy-price' }, `$${item.price.toLocaleString()}`),
        );
        card.addEventListener('click', () => this.onBuy?.(item));
        card.addEventListener('pointerenter', () => this.showItem(item));
        card.addEventListener('focus', () => this.showItem(item));
        card.addEventListener('pointerleave', () => this.showItem(null));
        this.cards.set(item.id, card);
        grid.append(card);
      }
      this.columns.append(h('section', { class: `buy-cat cat-${cat.id}` }, h('h3', null, cat.name), grid));
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
      this.detail.append(h('h4', null, `${GEAR_ICONS[item.id] ?? ''} ${item.name}`), h('p', null, GEAR_TEXT[item.id] ?? ''));
      return;
    }
    const w = WEAPONS[holding];
    const bar = (label: string, value: number, text: string) =>
      h('div', { class: 'buy-stat' }, h('span', null, label), h('i', null, h('b', { style: `width:${Math.round(Math.max(0.04, Math.min(1, value)) * 100)}%` })), h('em', null, text));
    const dmg = w.damage * w.pellets;
    const rpm = Math.round(60_000 / w.fireInterval);
    const shots = w.burst ? `${w.burst.count}-round burst` : w.automatic ? 'automatic' : 'semi-auto';
    this.detail.append(
      h('h4', null, item ? w.name : `In your hands: ${w.name}`),
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
      h('div', { class: `buy-slot${id ? '' : ' empty'}` }, id && thumbs.get(id) ? h('img', { src: thumbs.get(id)!, alt: '' }) : null, h('small', null, label), h('b', null, id ? WEAPONS[id].name : '—'));
    this.loadoutEl.append(
      h('h4', null, 'Your loadout'),
      slot('Main', main),
      slot('Pistol', pistol),
      slot('Melee', melee),
      h(
        'div',
        { class: 'buy-gear' },
        h('span', { class: v.armor > 0 ? 'on' : '' }, `🛡️ ${v.armor}`),
        h('span', { class: v.eggs > 0 ? 'on' : '' }, `🥚 ${v.eggs}`),
        h('span', { class: v.smokes > 0 ? 'on' : '' }, `💨 ${v.smokes}`),
        h('span', { class: v.flashes > 0 ? 'on' : '' }, `⚡ ${v.flashes}`),
        v.team === 2 ? h('span', { class: v.hasKit ? 'on' : '' }, `✂️ ${v.hasKit ? 'Kit' : 'No kit'}`) : null,
      ),
    );
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyB' && e.key !== 'Escape') return;
    if (e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.onClose?.();
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

    this.renderThumbs();
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

  /** Pictures of every gun, from the same models you see in the game. */
  private renderThumbs(): void {
    const r = this.renderer!;
    const missing = BUY_ITEMS.filter((i) => i.weapon && !thumbs.has(i.weapon));
    if (missing.length > 0) {
      const scene = new THREE.Scene();
      scene.environment = this.envTexture;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x666055, 1.4));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(1, 3, 4);
      scene.add(key);
      const cam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.01, 20);
      r.setPixelRatio(1);
      r.setSize(THUMB_W, THUMB_H, false);
      const box = new THREE.Box3();
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      for (const item of missing) {
        const gun = buildGun(item.weapon!);
        const holder = new THREE.Group();
        holder.add(gun.group);
        // Side on, muzzle to the right, tipped a little towards the camera.
        gun.group.rotation.set(0.12, -Math.PI / 2, 0);
        // A pair: the left one just behind and below, so both show.
        gun.offhand?.position.set(-0.1, -0.05, 0.07);
        scene.add(holder);
        holder.updateMatrixWorld(true);
        box.setFromObject(holder).getSize(size);
        box.getCenter(centre);
        gun.group.position.sub(centre);
        const aspect = THUMB_W / THUMB_H;
        let halfW = (size.x * 1.12) / 2;
        let halfH = halfW / aspect;
        if (size.y * 1.2 > halfH * 2) {
          halfH = (size.y * 1.2) / 2;
          halfW = halfH * aspect;
        }
        cam.left = -halfW;
        cam.right = halfW;
        cam.top = halfH;
        cam.bottom = -halfH;
        cam.position.set(0, 0, 5);
        cam.lookAt(0, 0, 0);
        cam.updateProjectionMatrix();
        r.render(scene, cam);
        thumbs.set(item.weapon!, r.domElement.toDataURL('image/png'));
        scene.remove(holder);
      }
      r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    for (const img of this.columns.querySelectorAll<HTMLImageElement>('img[data-weapon]')) img.src = thumbs.get(img.dataset.weapon as WeaponId) ?? '';
    this.lastKey = '';
  }
}
