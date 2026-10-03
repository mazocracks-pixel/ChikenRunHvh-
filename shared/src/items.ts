import { DEFAULT_MELEE, WEAPONS, WEAPON_IDS, isMelee, type WeaponId } from './weapons';

export type CosmeticSlot = 'skin' | 'hat' | 'beak' | 'shoes';
export type ItemSlot = CosmeticSlot | 'weapon';

export interface ItemDef {
  /** Globally unique, prefixed with the slot: `hat:crown`, `weapon:smg`. */
  id: string;
  slot: ItemSlot;
  /** The id within the slot (`crown`, `smg`). */
  key: string;
  name: string;
  /** 0 = free, owned by everyone. */
  price: number;
  color?: number;
  /** Shiny metal look (golden/robot skins). */
  metal?: boolean;
}

function cosmetic(slot: CosmeticSlot, key: string, name: string, price: number, color?: number, metal?: boolean): ItemDef {
  return { id: `${slot}:${key}`, slot, key, name, price, color, metal };
}

const COSMETICS: ItemDef[] = [
  cosmetic('skin', 'white', 'White', 0, 0xfafafa),
  cosmetic('skin', 'brown', 'Brown', 0, 0x8d5a3b),
  cosmetic('skin', 'black', 'Black', 0, 0x3a3a3a),
  cosmetic('skin', 'blue', 'Sky Blue', 200, 0x6ab7ee),
  cosmetic('skin', 'pink', 'Pink', 200, 0xf49ac1),
  cosmetic('skin', 'purple', 'Purple', 300, 0xa77bd8),
  cosmetic('skin', 'fire', 'Fire', 600, 0xf06a35),
  cosmetic('skin', 'zombie', 'Zombie', 600, 0x7fb069),
  cosmetic('skin', 'golden', 'Golden', 800, 0xf2c14e, true),
  cosmetic('skin', 'robot', 'Robot', 1000, 0xa9b4bf, true),

  cosmetic('hat', 'none', 'No hat', 0),
  cosmetic('hat', 'cap', 'Cap', 100, 0xe53935),
  cosmetic('hat', 'party', 'Party Hat', 150, 0x8e44ad),
  cosmetic('hat', 'chef', 'Chef Hat', 250, 0xffffff),
  cosmetic('hat', 'cowboy', 'Cowboy Hat', 300, 0x8b5a2b),
  cosmetic('hat', 'helmet', 'Army Helmet', 400, 0x556b2f),
  cosmetic('hat', 'tophat', 'Top Hat', 500, 0x222222),
  cosmetic('hat', 'viking', 'Viking Helmet', 700, 0x9e9e9e),
  cosmetic('hat', 'crown', 'Crown', 1500, 0xffd54f, true),

  cosmetic('beak', 'orange', 'Orange Beak', 0, 0xf5a623),
  cosmetic('beak', 'black', 'Black Beak', 100, 0x262626),
  cosmetic('beak', 'red', 'Red Beak', 100, 0xd32f2f),
  cosmetic('beak', 'blue', 'Blue Beak', 150, 0x1e88e5),
  cosmetic('beak', 'golden', 'Golden Beak', 300, 0xffc107, true),

  cosmetic('shoes', 'none', 'Bare feet', 0),
  cosmetic('shoes', 'white', 'White Sneakers', 100, 0xf5f5f5),
  cosmetic('shoes', 'red', 'Red Sneakers', 150, 0xe53935),
  cosmetic('shoes', 'blue', 'Blue Sneakers', 150, 0x1e88e5),
  cosmetic('shoes', 'gold', 'Gold Sneakers', 600, 0xffc107, true),
];

const WEAPON_ITEMS: ItemDef[] = WEAPON_IDS.map((id) => ({
  id: `weapon:${id}`,
  slot: 'weapon',
  key: id,
  name: WEAPONS[id].name,
  price: WEAPONS[id].price,
}));

export const ITEMS: readonly ItemDef[] = [...COSMETICS, ...WEAPON_ITEMS];
export const ITEMS_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((item) => [item.id, item]));

export function itemId(slot: ItemSlot, key: string): string {
  return `${slot}:${key}`;
}

export function getItem(slot: ItemSlot, key: string): ItemDef | undefined {
  return ITEMS_BY_ID.get(itemId(slot, key));
}

export interface Appearance {
  skin: string;
  hat: string;
  beak: string;
  shoes: string;
}

export const DEFAULT_APPEARANCE: Appearance = { skin: 'white', hat: 'none', beak: 'orange', shoes: 'none' };
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['skin', 'hat', 'beak', 'shoes'];

/**
 * Keeps only items that exist and that the player owns (free items are always owned);
 * anything else falls back to the default for that slot.
 */
export function sanitizeAppearance(raw: unknown, owns: (itemId: string) => boolean): Appearance {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_APPEARANCE };
  for (const slot of COSMETIC_SLOTS) {
    const key = input[slot];
    if (typeof key !== 'string') continue;
    const item = getItem(slot, key);
    if (item && (item.price === 0 || owns(item.id))) out[slot] = key;
  }
  return out;
}

/** Up to LOADOUT_SIZE distinct, owned weapons; falls back to the default loadout when empty. */
/**
 * A player's weapons: up to `size` owned guns (keys 1-4), then exactly one melee weapon, always
 * last (the knife unless another owned one was picked).
 */
export function sanitizeLoadout(raw: unknown, owns: (itemId: string) => boolean, size: number, fallback: readonly WeaponId[]): WeaponId[] {
  const list = Array.isArray(raw) ? raw : [];
  const guns: WeaponId[] = [];
  let melee: WeaponId | null = null;
  for (const entry of list) {
    if (typeof entry !== 'string' || !(entry in WEAPONS)) continue;
    const id = entry as WeaponId;
    if (WEAPONS[id].price !== 0 && !owns(itemId('weapon', id))) continue;
    if (isMelee(id)) melee ??= id;
    else if (guns.length < size && !guns.includes(id)) guns.push(id);
  }
  return [...(guns.length > 0 ? guns : fallback.filter((id) => !isMelee(id))), melee ?? DEFAULT_MELEE];
}
