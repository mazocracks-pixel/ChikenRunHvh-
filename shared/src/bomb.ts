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

export type BuyKind = 'weapon' | 'armor' | 'eggs' | 'smoke' | 'kit';

export interface BuyItem {
  id: string;
  name: string;
  price: number;
  kind: BuyKind;
  weapon?: WeaponId;
  /** Only this team can buy it. */
  team?: 1 | 2;
}

/** The buy menu, in display order (keys 1-9 while it's open). */
export const BUY_ITEMS: readonly BuyItem[] = [
  { id: 'armor', name: 'Armor', price: 650, kind: 'armor' },
  { id: 'eggs', name: 'Explosive egg', price: 300, kind: 'eggs' },
  { id: 'smoke', name: 'Smoke grenade', price: 300, kind: 'smoke' },
  { id: 'kit', name: 'Defuse kit', price: 400, kind: 'kit', team: 2 },
  { id: 'smg', name: 'SMG', price: 1_250, kind: 'weapon', weapon: 'smg' },
  { id: 'shotgun', name: 'Shotgun', price: 1_100, kind: 'weapon', weapon: 'shotgun' },
  { id: 'rifle', name: 'Rifle', price: 2_700, kind: 'weapon', weapon: 'rifle', team: 1 },
  { id: 'golden', name: 'Golden Rifle', price: 3_100, kind: 'weapon', weapon: 'golden', team: 2 },
  { id: 'sniper', name: 'Sniper', price: 4_750, kind: 'weapon', weapon: 'sniper' },
];
export const BUY_ITEMS_BY_ID: ReadonlyMap<string, BuyItem> = new Map(BUY_ITEMS.map((i) => [i.id, i]));

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
