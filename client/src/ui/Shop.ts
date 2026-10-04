import { DEFAULT_MELEE, ITEMS, LOADOUT_SIZE, NAME_MAX_LENGTH, WEAPONS, isMelee, type Appearance, type CosmeticSlot, type ItemDef, type ItemSlot, type Profile, type WeaponId } from '@game/shared';
import { ApiError, type Api } from '../net/Api';
import { clear, h, hex } from './dom';

const TABS: { slot: ItemSlot; label: string }[] = [
  { slot: 'skin', label: 'Feathers' },
  { slot: 'hat', label: 'Hats' },
  { slot: 'beak', label: 'Beaks' },
  { slot: 'shoes', label: 'Sneakers' },
  { slot: 'weapon', label: 'Weapons' },
];

const WEAPON_ICONS: Record<string, string> = { rocket: '🚀', golden: '✨', knife: '🔪', pan: '🍳', katana: '⚔️', goldknife: '🌟', crossbow: '🏹', launcher: '🥚', revolver: '🤠', lmg: '💥', scout: '🎯', deagle: '🦅', fiveseven: '🖐️', dualies: '✌️', silenced: '🤫', butterfly: '🦋', karambit: '🌙', m9: '🗡️', daggers: '🥷' };
const HAT_ICONS: Record<string, string> = { none: '∅', cap: '🧢', party: '🥳', chef: '👨‍🍳', cowboy: '🤠', helmet: '🪖', tophat: '🎩', viking: '⚔️', crown: '👑' };

/** Customize your chicken, buy items with coins, and pick your four weapons. */
export class ShopScreen {
  readonly root: HTMLElement;
  private readonly api: Api;
  private readonly onPreview: (appearance: Appearance, weapon: WeaponId) => void;
  private readonly grid = h('div', { class: 'item-grid' });
  private readonly tabs = h('div', { class: 'tabs' });
  private readonly coins = h('span', { class: 'coins' });
  private readonly message = h('p', { class: 'status' });
  private readonly nameInput = h('input', { maxlength: NAME_MAX_LENGTH, class: 'name-input', 'aria-label': 'Chicken name' });
  private tab: ItemSlot = 'skin';
  private busy = false;

  constructor(container: HTMLElement, api: Api, onPreview: (appearance: Appearance, weapon: WeaponId) => void, onBack: () => void) {
    this.api = api;
    this.onPreview = onPreview;
    const saveName = h('button', { type: 'button', class: 'secondary' }, 'Save name');
    saveName.addEventListener('click', () => void this.run(() => this.api.update({ name: this.nameInput.value }), 'Name saved!'));
    this.root = h(
      'div',
      { class: 'screen shop' },
      h(
        'div',
        { class: 'shop-panel panel' },
        h('header', null, h('button', { class: 'icon-btn', type: 'button', onclick: onBack, 'aria-label': 'Back' }, '←'), h('h2', null, 'Customize'), this.coins),
        h('div', { class: 'name-row' }, this.nameInput, saveName),
        this.tabs,
        this.grid,
        this.message,
      ),
    );
    this.root.hidden = true;
    container.append(this.root);
    api.onProfile(() => {
      if (!this.root.hidden) this.render();
    });
  }

  open(): void {
    this.root.hidden = false;
    this.message.textContent = '';
    this.nameInput.value = this.api.profile?.name ?? '';
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const p = this.api.profile;
    if (!p) return;
    this.coins.textContent = `🪙 ${p.coins.toLocaleString()}`;
    this.onPreview(p.appearance, p.loadout[0] ?? 'rifle');

    clear(this.tabs);
    for (const t of TABS) {
      this.tabs.append(h('button', { type: 'button', class: `tab${t.slot === this.tab ? ' active' : ''}`, onclick: () => ((this.tab = t.slot), this.render()) }, t.label));
    }

    clear(this.grid);
    if (this.tab === 'weapon') {
      this.grid.append(h('p', { class: 'muted wide' }, `Tap owned guns to put them in your loadout (up to ${LOADOUT_SIZE}, keys 1-${LOADOUT_SIZE}). Your melee weapon always comes last: bunny hop with it out for up to +80% speed.`));
    }
    for (const item of ITEMS.filter((i) => i.slot === this.tab)) this.grid.append(this.card(item, p));
  }

  private card(item: ItemDef, p: Profile): HTMLElement {
    const owned = item.price === 0 || p.owned.includes(item.id);
    const equipped = item.slot === 'weapon' ? p.loadout.includes(item.key as WeaponId) : p.appearance[item.slot as CosmeticSlot] === item.key;
    const status = equipped ? (item.slot === 'weapon' ? `Slot ${p.loadout.indexOf(item.key as WeaponId) + 1}` : 'Equipped') : owned ? 'Owned' : `🪙 ${item.price}`;
    const card = h('button', { type: 'button', class: `item-card${equipped ? ' equipped' : ''}${owned ? '' : ' locked'}` }, this.icon(item), h('b', null, item.name));
    if (item.slot === 'weapon') {
      const w = WEAPONS[item.key as WeaponId];
      const rpm = Math.round(60000 / w.fireInterval);
      const stats = w.melee ? `Melee · ${w.damage} dmg · ${w.range} m reach` : w.projectile === 'bolt' ? `Bolts · ${w.damage} dmg · drops with distance` : w.projectile ? 'Explosive' : `${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''} dmg · ${rpm} rpm · ${w.magazine} mag`;
      card.append(h('small', { class: 'stats' }, stats));
    }
    card.append(h('span', { class: 'status-tag' }, status));
    card.addEventListener('click', () => void this.choose(item, p, owned, equipped));
    return card;
  }

  private icon(item: ItemDef): HTMLElement {
    if (item.slot === 'hat') return h('div', { class: 'swatch emoji' }, HAT_ICONS[item.key] ?? '🎩');
    if (item.slot === 'weapon') return h('div', { class: 'swatch emoji' }, WEAPON_ICONS[item.key] ?? '🔫');
    if (item.slot === 'shoes' && item.key === 'none') return h('div', { class: 'swatch emoji' }, '🦶');
    return h('div', { class: `swatch${item.metal ? ' metal' : ''}`, style: `background:${hex(item.color ?? 0xffffff)}` });
  }

  private async choose(item: ItemDef, p: Profile, owned: boolean, equipped: boolean): Promise<void> {
    if (!owned) {
      if (p.coins < item.price) {
        this.say(`You need ${item.price - p.coins} more coins. Win matches to earn them!`, true);
        return;
      }
      if (!window.confirm(`Buy ${item.name} for ${item.price} coins?`)) return;
      const bought = await this.run(() => this.api.buy(item.id), `${item.name} unlocked!`);
      if (!bought) return;
      p = this.api.profile!;
    }
    if (item.slot === 'weapon') {
      const id = item.key as WeaponId;
      let guns = p.loadout.filter((w) => !isMelee(w));
      let melee = p.loadout.find((w) => isMelee(w)) ?? DEFAULT_MELEE;
      if (isMelee(id)) {
        if (id === melee) return this.say('Your melee weapon is always in the last slot. Pick another one to swap.', false);
        melee = id;
      } else if (equipped && owned) {
        if (guns.length === 1) return this.say('Keep at least one gun.', true);
        guns = guns.filter((w) => w !== id);
      } else if (!guns.includes(id)) {
        if (guns.length >= LOADOUT_SIZE) guns.pop();
        guns.push(id);
      }
      await this.run(() => this.api.update({ loadout: [...guns, melee] }), 'Loadout saved');
      return;
    }
    if (!equipped) await this.run(() => this.api.update({ appearance: { ...p.appearance, [item.slot]: item.key } }), null);
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
