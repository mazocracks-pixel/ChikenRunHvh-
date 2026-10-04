import { BUY_ITEMS, canTeamBuy, type BuyItem, type Team } from '@game/shared';
import { clear, h } from './dom';

export interface BuyMenuView {
  money: number;
  team: Team;
  /** Seconds of buy time left, or null in warmup (free, no limit). */
  secondsLeft: number | null;
  /** Why an item can't be bought right now (already owned...), or null. */
  blocked: (item: BuyItem) => string | null;
}

/**
 * ChikenBomb buy menu. Works with the keyboard while the game keeps the mouse (1-9 buys,
 * B closes), and with clicks or taps when the pointer is free.
 */
export class BuyMenu {
  readonly root = h('div', { class: 'buy-menu panel' });
  private readonly header = h('div', { class: 'buy-header' });
  private readonly list = h('ol', { class: 'buy-list' });
  private readonly status = h('div', { class: 'buy-status' });
  private lastKey = '';
  private team: Team = 0;
  onBuy: ((item: BuyItem) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root.append(h('h2', null, '🛒 Buy menu'), this.header, this.list, this.status, h('small', { class: 'buy-help' }, 'Press 1–9 to buy · B to close'));
    this.root.hidden = true;
    container.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (open) this.say('');
  }

  /** The item on key `n` (1-based) for your team. */
  itemFor(n: number): BuyItem | undefined {
    return this.items()[n - 1];
  }

  say(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
  }

  render(v: BuyMenuView): void {
    this.team = v.team;
    const items = this.items();
    const key = `${v.money}|${v.team}|${v.secondsLeft}|${items.map((i) => v.blocked(i) ?? '').join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.header.textContent = v.secondsLeft === null ? 'Warmup: everything is free' : `$${v.money.toLocaleString()} · ${v.secondsLeft}s left to buy`;
    clear(this.list);
    items.forEach((item, i) => {
      const blocked = v.blocked(item);
      const price = v.secondsLeft === null ? 0 : item.price;
      const poor = !blocked && price > v.money;
      const row = h(
        'li',
        { class: `buy-item${blocked || poor ? ' disabled' : ''}${item.team ? ' exclusive' : ''}` },
        h('kbd', null, String(i + 1)),
        h('span', { class: 'buy-name' }, item.name),
        h('span', { class: 'buy-price' }, blocked ?? (price === 0 ? 'Free' : `$${price.toLocaleString()}`)),
      );
      row.addEventListener('click', () => this.onBuy?.(item));
      this.list.append(row);
    });
  }

  /** Your team's items: the other team's exclusives are left out, so the numbers stay put. */
  private items(): BuyItem[] {
    return BUY_ITEMS.filter((i) => canTeamBuy(i, this.team));
  }
}
