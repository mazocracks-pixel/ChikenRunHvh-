import {
  WEAPONS,
  ZOMBIE,
  ZOMBIE_SHOP,
  upgradePrice,
  type WeaponId,
  type ZombieGear,
  type ZombieShopItem,
  type ZombieState,
} from '@game/shared';
import { clear, h } from './dom';

/** What the HUD needs to know about you to label the shop. */
export interface ZombieShopView {
  money: number;
  weapon: WeaponId;
  loadout: readonly WeaponId[];
}

/**
 * Zombie Apocalypse on screen: the wave and its countdown, the boss's health bar, the shop (B,
 * open between waves) and the game-over panel with Restart. Pure DOM; the session feeds it.
 */
export class ZombieHud {
  readonly root = h('div', { class: 'zb-root' });
  private readonly wave = h('div', { class: 'zb-wave' });
  private readonly sub = h('div', { class: 'zb-sub' });
  private readonly timer = h('div', { class: 'zb-timer' });
  private readonly bossName = h('span', { class: 'zb-boss-name' });
  private readonly bossFill = h('i');
  private readonly boss = h('div', { class: 'zb-boss', hidden: true }, this.bossName, h('div', { class: 'zb-boss-bar' }, this.bossFill));
  private readonly shop = h('div', { class: 'zb-shop-overlay', hidden: true });
  private readonly shopMoney = h('span', { class: 'zb-shop-money' });
  private readonly shopTimer = h('span', { class: 'zb-shop-timer' });
  private readonly shopStatus = h('div', { class: 'zb-shop-status', role: 'status', 'aria-live': 'polite' });
  private readonly shopGrid = h('div', { class: 'zb-shop-grid' });
  private readonly over = h('div', { class: 'zb-over', hidden: true });
  private state: ZombieState | null = null;
  private gear: ZombieGear = { upgrades: {} };
  private lastShopKey = '';
  private overKey = '';
  onBuy: ((item: ZombieShopItem) => void) | null = null;
  onRestart: (() => void) | null = null;
  onShopClose: (() => void) | null = null;

  constructor(container: HTMLElement) {
    const close = h('button', { type: 'button', class: 'zb-shop-close', 'aria-label': 'Close the shop' }, '✕');
    close.addEventListener('click', () => this.onShopClose?.());
    this.shop.append(
      h(
        'div',
        { class: 'zb-shop', role: 'dialog', 'aria-label': 'Zombie shop' },
        h('header', null, h('h2', null, '🛒 Shop'), this.shopTimer, h('span', { class: 'zb-spacer' }), this.shopMoney, close),
        this.shopGrid,
        h('footer', null, this.shopStatus, h('small', null, 'Click to buy · B or Esc to close')),
      ),
    );
    this.shop.addEventListener('click', (e) => {
      if (e.target === this.shop) this.onShopClose?.();
    });
    this.root.append(h('div', { class: 'zb-top' }, this.wave, this.sub, this.timer), this.boss, this.shop, this.over);
    container.append(this.root);
  }

  get shopOpen(): boolean {
    return !this.shop.hidden;
  }

  setShopOpen(open: boolean): void {
    if (open === this.shopOpen) return;
    this.shop.hidden = !open;
    this.shopStatus.textContent = '';
    this.lastShopKey = '';
    if (open) window.addEventListener('keydown', this.onKey, true);
    else window.removeEventListener('keydown', this.onKey, true);
  }

  setState(state: ZombieState): void {
    this.state = state;
    if (state.phase !== 'prep' && this.shopOpen) {
      this.say('The shop closed: the wave is here!', true);
      this.onShopClose?.();
    }
  }

  setGear(gear: ZombieGear): void {
    this.gear = gear;
    this.lastShopKey = '';
  }

  say(text: string, bad = false): void {
    this.shopStatus.textContent = text;
    this.shopStatus.classList.toggle('bad', bad);
  }

  /** Called every frame-ish: `now` is the server clock, `bossHealth` 0–1 (or null when there is no boss). */
  update(now: number, view: ZombieShopView, bossHealth: number | null): void {
    const s = this.state;
    if (!s) return;
    const secondsLeft = s.endsAt === null ? 0 : Math.max(0, Math.ceil((s.endsAt - now) / 1000));
    if (s.phase === 'prep' && s.endsAt === null) {
      // The match hasn't started yet (the room's own countdown is running).
      this.wave.textContent = '🧟 Get ready!';
      this.sub.textContent = 'The first wave comes soon';
      this.timer.hidden = true;
      this.root.dataset.phase = 'prep';
    } else if (s.phase === 'prep') {
      this.wave.textContent = s.wave === 1 ? '🧟 Get ready!' : `✅ Wave ${s.wave - 1} cleared`;
      this.sub.textContent = `Wave ${s.wave} starts in`;
      this.timer.textContent = String(secondsLeft);
      this.timer.hidden = false;
      this.timer.classList.toggle('urgent', secondsLeft <= 3);
      this.root.dataset.phase = 'prep';
    } else if (s.phase === 'wave') {
      this.wave.textContent = `🧟 Wave ${s.wave}`;
      this.sub.textContent = `${s.left} ${s.left === 1 ? 'zombie' : 'zombies'} left · ${s.kills} killed`;
      this.timer.hidden = true;
      this.root.dataset.phase = 'wave';
    } else {
      this.wave.textContent = '💀 Game over';
      this.sub.textContent = '';
      this.timer.hidden = true;
      this.root.dataset.phase = 'over';
    }

    const boss = s.boss;
    this.boss.hidden = !boss || bossHealth === null;
    if (boss && bossHealth !== null) {
      this.bossName.textContent = boss.name;
      this.bossFill.style.width = `${Math.max(0, Math.min(100, bossHealth * 100))}%`;
    }

    if (this.shopOpen) this.renderShop(view, secondsLeft);
    this.renderOver(s);
  }

  // ---------------------------------------------------------------------------

  private renderShop(view: ZombieShopView, secondsLeft: number): void {
    this.shopMoney.textContent = `🪙 ${view.money}`;
    this.shopTimer.textContent = `Next wave in ${secondsLeft}s`;
    const level = this.gear.upgrades[view.weapon] ?? 0;
    const key = `${view.money}|${view.weapon}|${view.loadout.join(',')}|${level}|${JSON.stringify(this.gear.upgrades)}`;
    if (key === this.lastShopKey) return;
    this.lastShopKey = key;
    clear(this.shopGrid);
    for (const item of ZOMBIE_SHOP) {
      let price = item.price;
      let name = item.name;
      let note = item.text;
      let blocked: string | null = null;
      if (item.kind === 'weapon' && view.loadout.includes(item.weapon!)) blocked = 'Owned';
      if (item.kind === 'upgrade') {
        const gun = WEAPONS[view.weapon];
        const next = upgradePrice(level);
        name = `Upgrade ${gun.name}`;
        note = gun.melee ? 'Take out a gun first.' : level >= ZOMBIE.upgrade.max ? 'Fully upgraded.' : `Level ${level} → ${level + 1}: +${Math.round(ZOMBIE.upgrade.perLevel * 100)}% damage.`;
        if (gun.melee) blocked = 'Hold a gun';
        else if (next === null) blocked = 'Maxed';
        else price = next;
      }
      const poor = view.money < price;
      const card = h(
        'button',
        { type: 'button', class: `zb-card${blocked ? ' blocked' : ''}${!blocked && poor ? ' poor' : ''}`, disabled: blocked !== null },
        h('span', { class: 'zb-card-icon' }, item.icon),
        h('span', { class: 'zb-card-name' }, name),
        h('span', { class: 'zb-card-text' }, note),
        h('span', { class: 'zb-card-price' }, blocked ?? `🪙 ${price}`),
      );
      card.addEventListener('click', () => this.onBuy?.(item));
      this.shopGrid.append(card);
    }
  }

  private renderOver(s: ZombieState): void {
    this.over.hidden = s.phase !== 'over';
    if (s.phase !== 'over') {
      this.overKey = '';
      return;
    }
    const key = `${s.wave}|${s.kills}`;
    if (key === this.overKey) return;
    this.overKey = key;
    const restart = h('button', { type: 'button', class: 'play' }, '↻ Restart');
    restart.addEventListener('click', () => this.onRestart?.());
    clear(this.over);
    this.over.append(
      h(
        'div',
        { class: 'zb-over-card', role: 'dialog', 'aria-label': 'Game over' },
        h('h2', null, '💀 Game over'),
        h('div', { class: 'zb-over-stats' }, h('div', null, h('b', null, String(s.wave)), h('span', null, 'Wave reached')), h('div', null, h('b', null, String(s.kills)), h('span', null, 'Zombies killed'))),
        restart,
        h('small', { class: 'muted' }, 'A new game also starts by itself in a few seconds.'),
      ),
    );
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'KeyB' && e.key !== 'Escape') return;
    if (e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.onShopClose?.();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
  }
}
