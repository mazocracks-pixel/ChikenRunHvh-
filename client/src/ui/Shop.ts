import {
  DEFAULT_MELEE,
  ITEMS,
  LOADOUT_SIZE,
  NAME_MAX_LENGTH,
  RARITY_COLORS,
  UPGRADES,
  UPGRADE_MAX_LEVEL,
  WEAPONS,
  dailyDeals,
  getItem,
  isMelee,
  msUntilNextDay,
  rarityOf,
  upgradeLevels,
  type Appearance,
  type CosmeticSlot,
  type Deal,
  type ItemDef,
  type Profile,
  type UpgradeDef,
  type WeaponId,
} from '@game/shared';
import { ApiError, type Api } from '../net/Api';
import { clear, h, hex } from './dom';
import { gunIcon, prepareGunIcons } from './GunIcons';
import { icon, type IconName } from './icons';
import { openModal } from './Modal';

type Tab = 'upgrades' | 'skins' | 'guns' | 'knives' | 'gunskins';
export type ShopSection = 'inventory' | 'loadout' | 'store';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'upgrades', label: 'Chicken Upgrades', icon: 'medal' },
  { id: 'skins', label: 'Skins', icon: 'chicken' },
  { id: 'guns', label: 'Guns', icon: 'target' },
  { id: 'knives', label: 'Knives', icon: 'knife' },
  { id: 'gunskins', label: 'Gun Skins', icon: 'dice' },
];

/** The Skins tab: every chicken cosmetic, in sections. */
const SKIN_SECTIONS: { slot: CosmeticSlot; label: string }[] = [
  { slot: 'skin', label: 'Feathers' },
  { slot: 'hat', label: 'Hats' },
  { slot: 'beak', label: 'Beaks' },
  { slot: 'shoes', label: 'Sneakers' },
];

const RARITY_NAMES = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' } as const;

function tabOf(item: ItemDef): Tab {
  if (item.slot === 'upgrade') return 'upgrades';
  if (item.slot === 'gun') return 'gunskins';
  if (item.slot === 'weapon') return isMelee(item.key as WeaponId) ? 'knives' : 'guns';
  return 'skins';
}

/**
 * Customize & Shop: chicken upgrades, skins, guns, knives and gun skins, with today's deals on
 * top. Picking anything tries it on the chicken next to the panel; buying always asks first.
 * Prices, coins and what you own all come from the server (it checks every purchase).
 */
export class ShopScreen {
  readonly root: HTMLElement;
  private readonly api: Api;
  private readonly onPreview: (appearance: Appearance, weapon: WeaponId) => void;
  private readonly body = h('div', { class: 'shop-body' });
  private readonly tabs = h('div', { class: 'tabs shop-tabs' });
  private readonly deals = h('div', { class: 'shop-deals' });
  private readonly detail = h('div', { class: 'shop-detail', hidden: true });
  private readonly coins = h('span', { class: 'shop-coins' });
  private readonly message = h('p', { class: 'status' });
  private readonly nameInput = h('input', { maxlength: NAME_MAX_LENGTH, class: 'name-input', 'aria-label': 'Chicken name' });
  private tab: Tab = 'upgrades';
  private section: ShopSection = 'store';
  private readonly title = h('h2', null, 'Store');
  /** The lobby's top bar, so the shop screens feel like the same place (the open one underlined). */
  private readonly navButtons = new Map<ShopSection, HTMLButtonElement>();
  /** What you're trying on (null: what you're wearing). */
  private selected: ItemDef | null = null;
  private busy = false;
  private iconTimer = 0;

  constructor(container: HTMLElement, api: Api, onPreview: (appearance: Appearance, weapon: WeaponId) => void, onBack: () => void) {
    this.api = api;
    this.onPreview = onPreview;
    const saveName = h('button', { type: 'button', class: 'secondary' }, 'Save name');
    saveName.addEventListener('click', () => void this.run(() => this.api.update({ name: this.nameInput.value }), 'Name saved!'));
    const navButton = (label: string, run: () => void) => h('button', { type: 'button', onclick: run }, label);
    const nav = h('nav', { class: 'cs-nav', 'aria-label': 'Main menu' });
    for (const [section, label] of [['inventory', 'Inventory'], ['loadout', 'Loadout'], ['play', 'Play'], ['store', 'Store']] as const) {
      const b = navButton(label, section === 'play' ? onBack : () => this.open(section));
      if (section !== 'play') this.navButtons.set(section, b);
      nav.append(b);
    }
    this.root = h(
      'div',
      { class: 'screen shop cs-shop' },
      h('header', { class: 'cs-shop-bar' }, nav),
      h(
        'div',
        { class: 'shop-panel panel' },
        h('header', null, h('button', { class: 'icon-btn', type: 'button', onclick: onBack, 'aria-label': 'Back' }, '←'), this.title, this.coins),
        h('div', { class: 'name-row' }, this.nameInput, saveName),
        this.deals,
        this.tabs,
        this.body,
        this.detail,
        this.message,
      ),
    );
    this.root.hidden = true;
    container.append(this.root);
    api.onProfile(() => {
      if (!this.root.hidden) this.render();
    });
  }

  open(section: ShopSection = 'store'): void {
    this.section = section;
    this.tab = section === 'inventory' ? 'skins' : section === 'loadout' ? 'guns' : 'upgrades';
    this.title.textContent = section === 'inventory' ? 'Inventory' : section === 'loadout' ? 'Loadout' : 'Store';
    for (const [id, b] of this.navButtons) b.classList.toggle('active', id === section);
    this.root.hidden = false;
    this.message.textContent = '';
    this.selected = null;
    this.nameInput.value = this.api.profile?.name ?? '';
    // Gun pictures are drawn a few per frame; show them once they're ready.
    prepareGunIcons();
    window.clearTimeout(this.iconTimer);
    this.iconTimer = window.setTimeout(() => !this.root.hidden && this.render(), 900);
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  // ---------------------------------------------------------------------------

  private render(): void {
    const p = this.api.profile;
    if (!p) return;
    clear(this.coins);
    this.coins.append(icon('coin', 'coin-icon'), h('b', null, p.coins.toLocaleString()));
    this.preview(p);
    this.deals.hidden = this.section !== 'store';
    if (!this.deals.hidden) this.renderDeals(p);

    clear(this.tabs);
    for (const t of TABS) {
      if (this.section === 'inventory' && t.id === 'upgrades') continue;
      if (this.section === 'loadout' && t.id !== 'guns' && t.id !== 'knives') continue;
      this.tabs.append(h('button', { type: 'button', class: `tab${t.id === this.tab ? ' active' : ''}`, onclick: () => this.pickTab(t.id) }, icon(t.icon, 'tab-icon'), t.label));
    }

    clear(this.body);
    if (this.tab === 'upgrades') this.renderUpgrades(p);
    else if (this.tab === 'skins') {
      for (const s of SKIN_SECTIONS) {
        this.body.append(h('h3', { class: 'shop-section' }, s.label), this.grid(ITEMS.filter((i) => i.slot === s.slot), p));
      }
    } else if (this.tab === 'gunskins') {
      this.body.append(h('p', { class: 'muted shop-note' }, 'A gun skin paints the body of every gun you carry. Everyone sees it.'), this.grid(ITEMS.filter((i) => i.slot === 'gun'), p));
    } else {
      const knives = this.tab === 'knives';
      this.body.append(
        h('p', { class: 'muted shop-note' }, knives ? 'Your knife uses key 3.' : `Tap an owned gun to put it in your loadout (up to ${LOADOUT_SIZE}). Primary: 1 · Pistol: 2 · Knife: 3 · Grenades: 4. Use the wheel for additional guns.`),
        this.grid(ITEMS.filter((i) => i.slot === 'weapon' && isMelee(i.key as WeaponId) === knives), p),
      );
    }
    this.renderDetail(p);
  }

  private pickTab(tab: Tab): void {
    this.tab = tab;
    this.selected = null;
    this.render();
  }

  /** The chicken next to the panel, wearing whatever you're trying on. */
  private preview(p: Profile): void {
    const s = this.selected;
    const look = { ...p.appearance };
    let weapon = p.loadout[0] ?? 'rifle';
    if (s && s.slot !== 'weapon' && s.slot !== 'upgrade') look[s.slot] = s.key;
    if (s?.slot === 'weapon') weapon = s.key as WeaponId;
    this.onPreview(look, weapon);
  }

  private renderDeals(p: Profile): void {
    clear(this.deals);
    const left = msUntilNextDay(Date.now());
    const hours = Math.floor(left / 3_600_000);
    const minutes = Math.floor((left % 3_600_000) / 60_000);
    this.deals.append(h('div', { class: 'shop-deals-head' }, h('b', null, 'Daily Deals'), h('span', { class: 'muted' }, `New deals in ${hours}h ${minutes}m`)));
    const row = h('div', { class: 'shop-deals-row' });
    for (const d of dailyDeals(Date.now())) {
      const item = ITEMS.find((i) => i.id === d.itemId)!;
      const owned = p.owned.includes(item.id);
      const card = h(
        'button',
        { type: 'button', class: `deal-card rarity-${rarityOf(item)}${owned ? ' owned' : ''}`, style: `--rarity:${RARITY_COLORS[rarityOf(item)]}` },
        h('span', { class: 'deal-off' }, `-${Math.round(d.discount * 100)}%`),
        this.picture(item),
        h('b', null, item.name),
        owned ? h('small', null, 'Owned') : h('small', null, h('s', null, item.price.toLocaleString()), ' ', h('b', null, d.price.toLocaleString())),
      );
      card.addEventListener('click', () => {
        this.tab = tabOf(item);
        this.selected = item;
        this.render();
      });
      row.append(card);
    }
    this.deals.append(row);
  }

  private renderUpgrades(p: Profile): void {
    const levels = upgradeLevels(p.owned);
    this.body.append(
      h('p', { class: 'shop-fair' }, icon('help', 'fair-icon'), h('span', null, 'Upgrades only work in ', h('b', null, 'Zombie Apocalypse'), ' and ', h('b', null, 'Training'), '. In PvP modes (FaceChiken, ChikenBomb, HvH, Team Fight, Duel and the rest) every chicken has the same stats, so it stays fair.')),
    );
    const list = h('div', { class: 'upgrade-list' });
    for (const u of UPGRADES) list.append(this.upgradeRow(u, levels[u.id], p));
    this.body.append(list);
  }

  private upgradeRow(u: UpgradeDef, level: number, p: Profile): HTMLElement {
    const max = level >= UPGRADE_MAX_LEVEL;
    const next = max ? null : getItem('upgrade', `${u.id}:${level + 1}`)!;
    const pips = h('span', { class: 'upgrade-pips', 'aria-label': `Level ${level} of ${UPGRADE_MAX_LEVEL}` }, ...Array.from({ length: UPGRADE_MAX_LEVEL }, (_, i) => h('i', { class: i < level ? 'on' : '' })));
    const button = h('button', { type: 'button', class: max ? 'secondary' : 'primary', disabled: max || p.coins < next!.price }, max ? 'Max level' : h('span', null, `Level ${level + 1} · `, icon('coin', 'coin-icon'), next!.price.toLocaleString()));
    if (next) button.addEventListener('click', () => void this.buy(next, p));
    return h(
      'div',
      { class: `upgrade-row rarity-${next ? rarityOf(next) : 'legendary'}`, style: `--rarity:${RARITY_COLORS[next ? rarityOf(next) : 'legendary']}` },
      h('div', { class: 'upgrade-info' }, h('b', null, u.name), h('span', { class: 'muted' }, u.text), pips),
      h('div', { class: 'upgrade-next' }, h('small', null, level > 0 ? `Now: ${u.effect(level)}` : 'Not bought yet'), h('small', null, max ? 'Fully upgraded' : `Next: ${u.effect(level + 1)}`)),
      button,
    );
  }

  private grid(items: readonly ItemDef[], p: Profile): HTMLElement {
    const grid = h('div', { class: 'item-grid' });
    const deals = new Map(dailyDeals(Date.now()).map((d) => [d.itemId, d]));
    for (const item of items) {
      if (this.section !== 'store' && item.price > 0 && !p.owned.includes(item.id)) continue;
      grid.append(this.card(item, p, deals.get(item.id)));
    }
    if (!grid.children.length) grid.append(h('p', { class: 'muted' }, 'No owned items in this category yet.'));
    return grid;
  }

  private card(item: ItemDef, p: Profile, deal: Deal | undefined): HTMLElement {
    const owned = item.price === 0 || p.owned.includes(item.id);
    const equipped = this.isEquipped(item, p);
    const rarity = rarityOf(item);
    const status = equipped
      ? item.slot === 'weapon' && !isMelee(item.key as WeaponId) ? `Slot ${p.loadout.indexOf(item.key as WeaponId) + 1}` : 'Equipped'
      : owned
        ? 'Owned'
        : null;
    const price = deal ? h('span', null, h('s', null, item.price.toLocaleString()), ' ', deal.price.toLocaleString()) : item.price.toLocaleString();
    const card = h(
      'button',
      {
        type: 'button',
        class: `item-card rarity-${rarity}${equipped ? ' equipped' : ''}${owned ? '' : ' locked'}${this.selected?.id === item.id ? ' selected' : ''}`,
        style: `--rarity:${RARITY_COLORS[rarity]}`,
      },
      h('span', { class: 'rarity-tag' }, RARITY_NAMES[rarity]),
      this.picture(item),
      h('b', null, item.name),
    );
    if (item.slot === 'weapon') {
      const w = WEAPONS[item.key as WeaponId];
      const rpm = Math.round(60000 / w.fireInterval);
      card.append(h('small', { class: 'stats' }, w.melee ? `${w.damage} dmg · ${w.range} m reach` : w.projectile ? 'Explosive' : `${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''} dmg · ${rpm} rpm · ${w.magazine} mag`));
    }
    card.append(h('span', { class: 'status-tag' }, status ?? h('span', null, icon('coin', 'coin-icon'), price)));
    if (deal && !owned) card.append(h('span', { class: 'deal-badge' }, `-${Math.round(deal.discount * 100)}%`));
    card.addEventListener('click', () => {
      this.selected = this.selected?.id === item.id ? null : item;
      this.render();
    });
    return card;
  }

  private picture(item: ItemDef): HTMLElement {
    if (item.slot === 'weapon') {
      const pic = gunIcon(item.key as WeaponId);
      if (pic) return h('div', { class: 'swatch gun-pic' }, h('img', { src: pic.url, alt: '' }));
      return h('div', { class: 'swatch gun-pic' }, icon(isMelee(item.key as WeaponId) ? 'knife' : 'target'));
    }
    if (item.slot === 'upgrade') return h('div', { class: 'swatch' }, icon('medal'));
    if ((item.slot === 'hat' || item.slot === 'shoes' || item.slot === 'gun') && item.key === 'none') return h('div', { class: 'swatch none' }, icon('close'));
    return h('div', { class: `swatch${item.metal ? ' metal' : ''}${item.slot === 'gun' ? ' gun-skin' : ''}`, style: `background:${hex(item.color ?? 0xffffff)}` });
  }

  private isEquipped(item: ItemDef, p: Profile): boolean {
    if (item.slot === 'weapon') return p.loadout.includes(item.key as WeaponId);
    if (item.slot === 'upgrade') return false;
    return (p.appearance[item.slot] ?? 'none') === item.key;
  }

  /** The bar under the list: the item you picked, its rarity and price, and what you can do. */
  private renderDetail(p: Profile): void {
    clear(this.detail);
    const item = this.selected;
    this.detail.hidden = !item || item.slot === 'upgrade';
    if (!item || item.slot === 'upgrade') return;
    const owned = item.price === 0 || p.owned.includes(item.id);
    const equipped = this.isEquipped(item, p);
    const rarity = rarityOf(item);
    const deal = dailyDeals(Date.now()).find((d) => d.itemId === item.id);
    const price = deal?.price ?? item.price;
    let action: HTMLElement;
    if (!owned) {
      const short = price - p.coins;
      action = h('button', { type: 'button', class: 'primary', disabled: short > 0 }, short > 0 ? `Need ${short.toLocaleString()} more` : h('span', null, 'Buy · ', icon('coin', 'coin-icon'), price.toLocaleString()));
      action.addEventListener('click', () => void this.buy(item, p));
    } else if (item.slot === 'weapon') {
      const melee = isMelee(item.key as WeaponId);
      action = h('button', { type: 'button', class: equipped && !melee ? 'secondary' : 'primary', disabled: equipped && melee }, equipped ? (melee ? 'Equipped' : 'Take out of loadout') : 'Put in loadout');
      action.addEventListener('click', () => void this.toggleWeapon(item, p));
    } else {
      action = h('button', { type: 'button', class: 'primary', disabled: equipped }, equipped ? 'Equipped' : 'Equip');
      action.addEventListener('click', () => void this.equip(item, p));
    }
    this.detail.append(
      h('div', { class: 'shop-detail-info' }, h('b', null, item.name), h('span', { class: `rarity-chip rarity-${rarity}`, style: `--rarity:${RARITY_COLORS[rarity]}` }, RARITY_NAMES[rarity]), owned ? null : h('span', { class: 'muted' }, 'Trying it on')),
      action,
    );
  }

  // ---------------------------------------------------------------------------

  /** Asks first, then buys on the server (which checks the price and your coins again). */
  private async buy(item: ItemDef, p: Profile): Promise<void> {
    const price = dailyDeals(Date.now()).find((d) => d.itemId === item.id)?.price ?? item.price;
    if (p.coins < price) {
      this.say(`You need ${price - p.coins} more coins. Play to earn them (Zombie Apocalypse pays the most).`, true);
      return;
    }
    if (!(await confirmBuy(item.name, price, p.coins))) return;
    const bought = await this.run(() => this.api.buy(item.id), `${item.name} unlocked!`);
    if (!bought || item.slot === 'upgrade') return;
    // Wear (or carry) what you just bought.
    const now = this.api.profile!;
    if (item.slot === 'weapon') {
      if (!now.loadout.includes(item.key as WeaponId)) await this.toggleWeapon(item, now);
    } else await this.equip(item, now);
  }

  private async equip(item: ItemDef, p: Profile): Promise<void> {
    if (item.slot === 'weapon' || item.slot === 'upgrade' || this.isEquipped(item, p)) return;
    await this.run(() => this.api.update({ appearance: { ...p.appearance, [item.slot]: item.key } }), `${item.name} equipped`);
  }

  private async toggleWeapon(item: ItemDef, p: Profile): Promise<void> {
    const id = item.key as WeaponId;
    let guns = p.loadout.filter((w) => !isMelee(w));
    let melee = p.loadout.find((w) => isMelee(w)) ?? DEFAULT_MELEE;
    if (isMelee(id)) melee = id;
    else if (p.loadout.includes(id)) {
      if (guns.length === 1) return this.say('Keep at least one gun.', true);
      guns = guns.filter((w) => w !== id);
    } else {
      if (guns.length >= LOADOUT_SIZE) guns.pop();
      guns.push(id);
    }
    await this.run(() => this.api.update({ loadout: [...guns, melee] }), 'Loadout saved');
  }

  private async run(fn: () => Promise<unknown>, success: string | null): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      await fn();
      if (success) this.say(success, false);
      return true;
    } catch (err) {
      this.say(err instanceof ApiError ? err.message : 'Something went wrong.', true);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private say(text: string, error: boolean): void {
    this.message.textContent = text;
    this.message.classList.toggle('error', error);
  }
}

/** "Buy X for Y coins?" in the game's own dialog. */
function confirmBuy(name: string, price: number, coins: number): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const yes = h('button', { type: 'button', class: 'primary' }, 'Buy');
    const no = h('button', { type: 'button', class: 'secondary' }, 'Cancel');
    const content = h(
      'div',
      { class: 'confirm-buy' },
      h('p', null, 'Buy ', h('b', null, name), ' for ', icon('coin', 'coin-icon'), h('b', null, price.toLocaleString()), ' coins?'),
      h('p', { class: 'muted' }, `You have ${coins.toLocaleString()}; ${(coins - price).toLocaleString()} left after.`),
      h('div', { class: 'confirm-actions' }, no, yes),
    );
    const modal = openModal('Confirm purchase', content, { onClose: () => !answered && resolve(false) });
    const answer = (ok: boolean) => {
      answered = true;
      modal.close();
      resolve(ok);
    };
    yes.addEventListener('click', () => answer(true));
    no.addEventListener('click', () => answer(false));
    yes.focus();
  });
}
