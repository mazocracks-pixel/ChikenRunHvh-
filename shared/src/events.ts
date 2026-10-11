import type { ZoneId } from './maps/types';
import type { ZombieKind } from './zombies';

/**
 * Zombie Apocalypse story events (Crystal Hunt). At a set wave everyone is taken to a sealed
 * level, gets a phone with a map, collects every purple crystal and leaves through the portal
 * that opens. Every number of the events lives here.
 */

export type HuntEventId = 'backrooms' | 'phoneMission';

/**
 * The Backrooms level itself (built from these when the server and the game start; change them
 * and both build the same new level).
 */
export const BACKROOMS_LEVEL = {
  /** Rooms across and down, and how big each room is (metres): 20 x 20 x 6 m = 120 m square. */
  gridWidth: 20,
  gridHeight: 20,
  roomSize: 6,
  wallHeight: 3,
  seed: 707,
  /** Share of the maze's walls knocked out afterwards (loops). */
  extraOpen: 0.14,
  /** Big open halls with pillars, long straight hallways, a ring hallway that loops. */
  halls: { count: 6, size: 3 },
  hallways: 6,
  loop: { w: 6, h: 5 },
  /** The "wrong" spots: a flooded section, and a room in a sickly pink light. */
  flood: { w: 5, h: 4 },
  wrongRoom: { w: 3, h: 2, color: 0xff3a78 },
  /** Holes in the ceiling where monkeys wait to drop on you. */
  ceilingGaps: 10,
};

/** How monkeys hunt (both events). Speeds are shares of a player's running speed. */
export const MONKEYS = {
  /** Patrolling, chasing (about your run, faster than slow-walking), and the leap. */
  walkSpeed: 0.5,
  chaseSpeed: 0.97,
  leapSpeed: 2.4,
  /** The leap: from this far (metres), then not again for a while. */
  leap: { min: 3.5, max: 8, cooldownMs: 2600, up: 5.5 },
  /** A swipe in reach this often, and the stun it gives you (you can't move for a moment). */
  attackMs: 460,
  stunMs: 300,
  /** How far they see you (with a clear line), and hear you through walls. */
  sightRange: 22,
  hearing: { quiet: 4, run: 14, splash: 22, gunshot: 40, silenced: 12 },
  /** One that spots you screeches: the pack within this range comes too, half of them round the side. */
  alertRadius: 30,
  flankShare: 0.5,
  /** After losing you, they search where you were last seen for this long (ms). */
  searchMs: [8000, 10_000] as readonly [number, number],
  /** A sleeping one wakes when you come this close (or make noise, or take its crystal). */
  wakeRange: 2.6,
  /** A ceiling one drops when you pass under its hole this close. */
  dropRange: 4.5,
  /** Routes worked out per server tick, all monkeys together (the rest keep their old route). */
  pathsPerTick: 3,
} as const;

/** The phone's map (Backrooms-size levels): what it shows and how far it zooms. */
export const PHONE = {
  /** You see the map only where you've been: this far round you. */
  revealRadius: 9,
  /** Crystals this close always show, even in rooms you haven't seen. */
  detectRange: 14,
  /** Zoom levels: metres across the screen (0 = the whole level). */
  zooms: [30, 60, 0] as readonly number[],
};

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
  /**
   * Monkeys that scale with the level: this many per room at the start, part of them asleep by
   * crystals and some in the ceiling, then one more every `respawnMs` (out of sight) up to `cap`.
   * Without it, `enemies` is the whole cast.
   */
  pack?: { perRoom: number; respawnMs: number; cap: number; sleepShare: number; ceiling: number };
  /** Some crystals this far (metres) or more from the entrance. */
  farCrystals?: { share: number; distance: number };
  /** Red crystals (in dangerous spots): taking one shows every monkey through walls for a while. */
  redCrystals?: number;
}

/** A quicker run of an event for testing (dev: /backrooms small). */
export const SMALL_TEST = { crystals: 4, monkeys: 3, timeMs: 180_000 } as const;

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
  /**
   * Every `every` crystals the team picks up, everyone runs faster (`player` more of their speed
   * each level), and so do the monkeys (`monkey` more), up to `maxLevel` levels.
   */
  speedUp: { every: 50, player: 0.03, monkey: 0.025, maxLevel: 10 },
  /** A red crystal shows every monkey through walls (and on the phone) for this long. */
  redRevealMs: 90_000,
  events: {
    backrooms: {
      id: 'backrooms',
      name: 'The Backrooms',
      wave: 7,
      zone: 'backrooms',
      crystals: 500,
      timeMs: 1_500_000,
      enemies: { monkey: 0 },
      smart: true,
      then: 'next',
      reward: { money: 1500, heal: true, freeUpgrade: true },
      extraScareAt: null,
      pack: { perRoom: 0.05, respawnMs: 30_000, cap: 32, sleepShare: 0.02, ceiling: 7 },
      farCrystals: { share: 0.3, distance: 70 },
      redCrystals: 6,
    },
    phoneMission: {
      id: 'phoneMission',
      name: 'The Phone Mission',
      wave: 10,
      zone: 'facility',
      crystals: 20,
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
  /** A red one: it shows the monkeys through walls. */
  red?: boolean;
}

/** What everyone sees of a running event. */
export interface HuntState {
  id: HuntEventId;
  name: string;
  zone: ZoneId;
  /** When the time runs out (server clock, ms). */
  endsAt: number;
  total: number;
  /** Crystals still to find (purple ones; red ones don't count). */
  left: number;
  /**
   * Every crystal still lying about: sent when the event starts (and to anyone joining); after
   * that the `crystal` events take them away one by one, so it's left out.
   */
  crystals?: CrystalState[];
  /** Speed-up levels so far (see CRYSTAL_HUNT.speedUp). */
  speedLevel: number;
  /** Every monkey shows through walls until then (a red crystal), or 0. */
  revealUntil: number;
  /** The exit, once every crystal is taken. */
  portal: { x: number; z: number } | null;
  /** The power is out until then (the extra scare), or 0. */
  blackoutUntil: number;
}

/** Why a scare noise plays: a monster saw you first, the last crystal, the power cutting out. */
export type HuntScare = 'spotted' | 'lastCrystal' | 'blackout';
