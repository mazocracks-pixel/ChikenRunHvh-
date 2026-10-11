import type { ZoneId } from './maps/types';
import type { ZombieKind } from './zombies';

/**
 * Zombie Apocalypse story events (Crystal Hunt). At a set wave everyone is taken to a sealed
 * level, gets a phone with a map, collects every purple crystal and leaves through the portal
 * that opens. Every number of the events lives here.
 */

export type HuntEventId = 'backrooms' | 'phoneMission';

export interface HuntEventDef {
  id: HuntEventId;
  name: string;
  /** The wave it happens at. */
  wave: number;
  /** Which sealed level of the map (see maps/zones.ts). */
  zone: ZoneId;
  crystals: number;
  timeMs: number;
  /** The monsters and how many of each. */
  enemies: Partial<Record<ZombieKind, number>>;
  /** Smarter monsters: half of them hunt you down instead of lurking at corners. */
  smart: boolean;
  /**
   * After the event: 'next' = it was this wave (the next wave comes after the shop); 'same' =
   * this wave is still to come (it starts after the shop).
   */
  then: 'next' | 'same';
  /** For everyone on success: money, back to full health, a free level for the gun in hand. */
  reward: { money: number; heal: boolean; freeUpgrade: boolean };
  /** A share of the time (0.5 = half way) when an extra scare comes (the power cuts out), or null. */
  extraScareAt: number | null;
}

export const CRYSTAL_HUNT = {
  /** The C build key during events (off, as asked; true turns it back on). */
  buildDuringEvents: false,
  /** When an event fails (time runs out, or everyone dies): lose a life, or game over at once. */
  onFail: 'loseLife' as 'loseLife' | 'gameOver',
  /** Team lives for failed events; at 0 it's game over. */
  lives: 2,
  /** How close you must get to take a crystal, and to use the portal (metres). */
  collectRadius: 1.3,
  portalRadius: 1.7,
  /** A monster that sees you this close stops lurking and charges (and the first one scares you). */
  spotRange: 11,
  /** How long the power stays out on the extra scare. */
  blackoutMs: 5000,
  events: {
    backrooms: {
      id: 'backrooms',
      name: 'The Backrooms',
      wave: 7,
      zone: 'backrooms',
      crystals: 12,
      timeMs: 240_000,
      enemies: { monkey: 6 },
      smart: false,
      then: 'next',
      reward: { money: 600, heal: true, freeUpgrade: true },
      extraScareAt: null,
    },
    phoneMission: {
      id: 'phoneMission',
      name: 'The Phone Mission',
      wave: 10,
      zone: 'facility',
      crystals: 16,
      timeMs: 200_000,
      enemies: { monkey: 10, sprinter: 4 },
      smart: true,
      then: 'same',
      reward: { money: 1000, heal: true, freeUpgrade: true },
      extraScareAt: 0.5,
    },
  } satisfies Record<HuntEventId, HuntEventDef>,
};

/** The event that happens at this wave, if any. */
export function huntEventAt(wave: number): HuntEventDef | null {
  return Object.values(CRYSTAL_HUNT.events).find((e) => e.wave === wave) ?? null;
}

export interface CrystalState {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** What everyone sees of a running event. */
export interface HuntState {
  id: HuntEventId;
  name: string;
  zone: ZoneId;
  /** When the time runs out (server clock, ms). */
  endsAt: number;
  total: number;
  /** The crystals still to find. */
  crystals: CrystalState[];
  /** The exit, once every crystal is taken. */
  portal: { x: number; z: number } | null;
  /** The power is out until then (the extra scare), or 0. */
  blackoutUntil: number;
}

/** Why a scare noise plays: a monster saw you first, the last crystal, the power cutting out. */
export type HuntScare = 'spotted' | 'lastCrystal' | 'blackout';
