import type { Team } from './maps/types';
import type { WeaponId } from './weapons';

/** ChikenBomb: chikenT (team 1) plant the bomb, chikenCT (team 2) defuse it. */
export const BOMB = {
  /** Free play before the first round: respawns on, buying is free. */
  warmupMs: 40_000,
  /** Start of every round: everyone frozen in spawn, buy menu open. */
  buyMs: 15_000,
  /** The round itself (1:50). */
  roundMs: 110_000,
  /** Results banner between rounds. */
  roundEndMs: 5_000,
  plantMs: 3_000,
  /** Fuse once planted. */
  fuseMs: 40_000,
  defuseMs: 10_000,
  kitDefuseMs: 5_000,
  /** Reach to defuse (from the bomb) and to pick a dropped bomb up. */
  defuseRange: 1.9,
  pickupRange: 1.3,
  /** The explosion: kills anyone close, hurts further out. */
  blastRadius: 14,
  blastDamage: 500,
  /** Round wins needed to take the match. */
  roundsToWin: 6,
} as const;

export const ECONOMY = {
  start: 800,
  max: 16_000,
  kill: 300,
  /** Knife (any melee) kills pay much more. */
  meleeKill: 1_500,
  win: 3_250,
  /** Bomb wins (exploded / defused) pay a little extra. */
  bombWin: 3_500,
  loss: 1_400,
  /** Each round lost in a row adds this to the loss bonus, up to lossMax. */
  lossStep: 500,
  lossMax: 3_400,
  /** Every chikenT gets this when they lose a round after planting. */
  plantedLoss: 800,
  plant: 300,
  defuse: 300,
} as const;

export type BuyKind = 'weapon' | 'armor' | 'eggs' | 'smoke' | 'flash' | 'kit';

/** Buy menu columns. A pistol takes the pistol slot; every other gun is your one main gun. */
export type BuyCategory = 'pistol' | 'smg' | 'heavy' | 'rifle' | 'sniper' | 'special' | 'gear';

export const BUY_CATEGORIES: readonly { id: BuyCategory; name: string }[] = [
  { id: 'pistol', name: 'Pistols' },
  { id: 'smg', name: 'SMGs' },
  { id: 'heavy', name: 'Heavy' },
  { id: 'rifle', name: 'Rifles' },
  { id: 'sniper', name: 'Snipers' },
  { id: 'special', name: 'Explosive' },
  { id: 'gear', name: 'Gear' },
];

export interface BuyItem {
  id: string;
  name: string;
  price: number;
  kind: BuyKind;
  category: BuyCategory;
  weapon?: WeaponId;
  /** Only this team can buy it. */
  team?: 1 | 2;
}

const gun = (weapon: WeaponId, name: string, price: number, category: BuyCategory, team?: 1 | 2): BuyItem => ({ id: weapon, name, price, kind: 'weapon', category, weapon, ...(team ? { team } : {}) });

/** The buy menu, column by column (prices roughly like CS2's). */
export const BUY_ITEMS: readonly BuyItem[] = [
  gun('pistol', 'Pistol', 200, 'pistol'),
  gun('silenced', 'Silenced Pistol', 200, 'pistol'),
  gun('dualies', 'Dual Pistols', 300, 'pistol'),
  gun('fiveseven', 'Five-Seven', 500, 'pistol'),
  gun('mpistol', 'Machine Pistol', 500, 'pistol'),
  gun('revolver', 'Revolver', 600, 'pistol'),
  gun('deagle', 'Deagle', 700, 'pistol'),
  gun('smg', 'SMG', 1_250, 'smg'),
  gun('shotgun', 'Shotgun', 1_100, 'heavy'),
  gun('autoshotgun', 'Auto Shotgun', 2_000, 'heavy'),
  gun('lmg', 'LMG', 5_200, 'heavy'),
  gun('minigun', 'Minigun', 6_000, 'heavy'),
  gun('burst', 'Burst Rifle', 2_050, 'rifle'),
  gun('rifle', 'Rifle', 2_700, 'rifle', 1),
  gun('golden', 'Golden Rifle', 3_100, 'rifle', 2),
  gun('battle', 'Battle Rifle', 3_000, 'rifle'),
  gun('scout', 'Scout', 1_700, 'sniper'),
  gun('crossbow', 'Crossbow', 1_900, 'sniper'),
  gun('sniper', 'Sniper', 4_750, 'sniper'),
  gun('launcher', 'Egg Launcher', 3_500, 'special'),
  gun('rocket', 'Rocket Launcher', 5_000, 'special'),
  { id: 'armor', name: 'Armor', price: 650, kind: 'armor', category: 'gear' },
  { id: 'eggs', name: 'Explosive egg', price: 300, kind: 'eggs', category: 'gear' },
  { id: 'smoke', name: 'Smoke grenade', price: 300, kind: 'smoke', category: 'gear' },
  { id: 'flash', name: 'Flashbang', price: 200, kind: 'flash', category: 'gear' },
  { id: 'kit', name: 'Defuse kit', price: 400, kind: 'kit', category: 'gear', team: 2 },
];
export const BUY_ITEMS_BY_ID: ReadonlyMap<string, BuyItem> = new Map(BUY_ITEMS.map((i) => [i.id, i]));

/** Weapons that go in the pistol slot (the rest are main guns). */
const SIDEARMS = new Set<WeaponId>(BUY_ITEMS.filter((i) => i.category === 'pistol').map((i) => i.weapon!));

export function isSidearm(id: WeaponId): boolean {
  return SIDEARMS.has(id);
}

/** What everyone starts each life with (survivors keep what they bought). */
export const BOMB_START_LOADOUT: readonly WeaponId[] = ['pistol', 'knife'];

export type RoundPhase = 'warmup' | 'buy' | 'live' | 'planted' | 'over';
export type RoundEndReason = 'exploded' | 'defused' | 'eliminated' | 'time';
export type SiteId = 'A' | 'B';

export interface BombAction {
  pid: number;
  kind: 'plant' | 'defuse';
  /** Server times (ms). */
  startedAt: number;
  endsAt: number;
}

export interface BombState {
  /** pid carrying it, 0 if it's on the ground or planted. */
  carrier: number;
  /** Where it lies (dropped or planted); meaningless while carried. */
  x: number;
  y: number;
  z: number;
  site: SiteId | null;
  /** Server time of the explosion once planted. */
  explodeAt: number | null;
  /** Someone planting or defusing right now. */
  action: BombAction | null;
}

export interface RoundState {
  phase: RoundPhase;
  /** 0 during warmup, then 1, 2, ... */
  round: number;
  /** Server time (ms) the current phase ends, or null. */
  endsAt: number | null;
  bomb: BombState;
  /** Set while phase is 'over'. */
  winner: Team;
  reason: RoundEndReason | null;
}

export function noBomb(): BombState {
  return { carrier: 0, x: 0, y: 0, z: 0, site: null, explodeAt: null, action: null };
}

/** Can this team buy this item at all? */
export function canTeamBuy(item: BuyItem, team: Team): boolean {
  return item.team === undefined || item.team === team;
}
