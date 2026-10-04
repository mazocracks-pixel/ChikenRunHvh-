import type { MapId, Team } from './maps/types';
import type { WeaponId } from './weapons';

export type ModeId = 'ffa' | 'tdm' | 'duel' | 'ctf' | 'sandbox' | 'hvh' | 'knife' | 'bomb' | 'arms' | 'face';

export interface ModeDef {
  id: ModeId;
  name: string;
  description: string;
  teams: boolean;
  maxPlayers: number;
  /** Kills (or captures in CTF) needed to win; 0 = no limit. */
  scoreLimit: number;
  /** 0 = no time limit. */
  timeLimitMs: number;
  respawnMs: number;
  /** Players needed before a match starts. */
  minPlayers: number;
  maps: readonly MapId[];
  /** Sandbox: free building, no scoring. */
  building: boolean;
  /** Drivable buggies on the map. */
  vehicles: boolean;
  /** Every kill scores a point for the killer's team. */
  teamKills?: boolean;
  /** Everyone sees enemy chickens through walls (HvH). */
  wallhack?: boolean;
  /** Bullets go through boxes (crates, hay, wood) with less damage. */
  wallbang?: boolean;
  /** Everyone starts with only these weapons, and there are no free grenades or egg pickups. */
  weapons?: readonly WeaponId[];
  /** Team names instead of Red / Blue (ChikenBomb: chikenT / chikenCT). */
  teamNames?: readonly [string, string];
  /** No random bonus pickups where chickens die (they'd break a buy-menu economy). */
  noDrops?: boolean;
  /** Rounds, bomb, money and the buy menu (ChikenBomb). */
  bomb?: boolean;
  /** Every kill gives you the next weapon on the ladder (Arms Race). */
  armsRace?: boolean;
  /** Free for all: spawn anywhere open on the map, away from and out of sight of enemies. */
  spreadSpawns?: boolean;
  /** Spawn protection, if not the usual PLAYER.spawnProtectionMs. */
  spawnProtectionMs?: number;
  /** Quick play tops the room up with bots to this many players (default 4, 2 in duels). */
  fillBots?: number;
  /**
   * Ranked (FaceChiken): the only mode that moves your level. Real players only (no bots,
   * registered accounts), matchmaking only (no private rooms), developer tools off.
   */
  ranked?: boolean;
}

const DEFS: ModeDef[] = [
  {
    id: 'ffa', name: 'Against All', description: 'Everyone for themselves. First to 25 kills wins.',
    teams: false, maxPlayers: 12, scoreLimit: 25, timeLimitMs: 5 * 60_000, respawnMs: 3000, minPlayers: 2,
    maps: ['farm', 'town', 'sandstown', 'harbor', 'frostbite', 'factory'], building: false, vehicles: true, wallbang: true,
    spreadSpawns: true,
  },
  {
    id: 'tdm', name: 'Team Fight', description: 'Red vs Blue, 5 vs 5. First team to 40 kills wins.',
    teams: true, maxPlayers: 10, scoreLimit: 40, timeLimitMs: 6 * 60_000, respawnMs: 3000, minPlayers: 2,
    maps: ['farm', 'town', 'sandstown', 'harbor', 'frostbite', 'factory'], building: false, vehicles: true, teamKills: true, wallbang: true,
  },
  {
    id: 'hvh', name: 'HvH', description: 'Red vs Blue, 5 vs 5, and everyone sees enemies through walls. First to 40 kills.',
    teams: true, maxPlayers: 10, scoreLimit: 40, timeLimitMs: 6 * 60_000, respawnMs: 3000, minPlayers: 2,
    maps: ['farm', 'town', 'sandstown', 'harbor', 'frostbite', 'factory'], building: false, vehicles: true, teamKills: true, wallhack: true, wallbang: true,
  },
  {
    id: 'bomb', name: 'ChikenBomb', description: 'chikenT plant the bomb, chikenCT defuse it. 5 vs 5 rounds with money and a buy menu. First to 6 rounds.',
    teams: true, maxPlayers: 10, scoreLimit: 6, timeLimitMs: 0, respawnMs: 2000, minPlayers: 2,
    maps: ['sandstown', 'harbor'], building: false, vehicles: false, wallbang: true, fillBots: 10,
    weapons: ['pistol', 'knife'], teamNames: ['chikenT', 'chikenCT'], noDrops: true, bomb: true,
  },
  {
    id: 'face', name: 'FaceChiken', description: 'Ranked 5 vs 5 bomb. Real players only, anti-cheat on, no bots, no dev tools. The only mode that moves your level.',
    teams: true, maxPlayers: 10, scoreLimit: 6, timeLimitMs: 0, respawnMs: 2000, minPlayers: 4,
    maps: ['sandstown', 'harbor'], building: false, vehicles: false, wallbang: true,
    weapons: ['pistol', 'knife'], teamNames: ['chikenT', 'chikenCT'], noDrops: true, bomb: true, ranked: true,
  },
  {
    id: 'arms', name: 'Arms Race', description: 'Every kill gives you the next gun, 17 in all. First kill with the Golden Knife wins.',
    teams: false, maxPlayers: 12, scoreLimit: 0, timeLimitMs: 10 * 60_000, respawnMs: 1000, minPlayers: 2,
    maps: ['factory', 'farm', 'town', 'sandstown', 'harbor', 'frostbite'], building: false, vehicles: false, wallbang: true, fillBots: 6, noDrops: true, armsRace: true,
    spreadSpawns: true, spawnProtectionMs: 2500,
  },
  {
    id: 'knife', name: 'Knife Fight', description: 'Red vs Blue, 3 vs 3, knives only. Bunny hop in fast. First team to 15 kills.',
    teams: true, maxPlayers: 6, scoreLimit: 15, timeLimitMs: 5 * 60_000, respawnMs: 2500, minPlayers: 2,
    maps: ['factory', 'farm', 'town', 'sandstown', 'frostbite'], building: false, vehicles: false, teamKills: true, weapons: ['knife'], fillBots: 6,
  },
  {
    id: 'duel', name: 'Duel', description: 'One on one. First to 10 kills wins.',
    teams: false, maxPlayers: 2, scoreLimit: 10, timeLimitMs: 5 * 60_000, respawnMs: 2000, minPlayers: 2,
    maps: ['factory', 'farm', 'town', 'sandstown', 'frostbite'], building: false, vehicles: false, wallbang: true,
  },
  {
    id: 'ctf', name: 'Capture the Flag', description: 'Steal the enemy flag and bring it home. 3 captures win.',
    teams: true, maxPlayers: 10, scoreLimit: 3, timeLimitMs: 8 * 60_000, respawnMs: 4000, minPlayers: 2,
    maps: ['farm', 'town', 'frostbite'], building: false, vehicles: true, wallbang: true,
  },
  {
    id: 'sandbox', name: 'Sandbox', description: 'Build anything with blocks. No score, no rules.',
    teams: false, maxPlayers: 16, scoreLimit: 0, timeLimitMs: 0, respawnMs: 1500, minPlayers: 1,
    maps: ['flat', 'farm', 'town'], building: true, vehicles: true, wallbang: true,
  },
];

export const MODES = Object.fromEntries(DEFS.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;
export const MODE_IDS = DEFS.map((m) => m.id);

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && value in MODES;
}

export const MATCH = {
  /** Countdown once enough players are present. */
  countdownMs: 5000,
  /** How long the results screen shows before the next match. */
  resultsMs: 10000,
} as const;

export const TEAM_NAMES: Record<Team, string> = { 0: 'None', 1: 'Red', 2: 'Blue' };

/** A team's name in a mode (Red / Blue, or e.g. chikenT / chikenCT). */
export function teamName(mode: ModeDef, team: Team): string {
  return team !== 0 && mode.teamNames ? mode.teamNames[team - 1]! : TEAM_NAMES[team];
}
export const TEAM_COLORS: Record<Team, number> = { 0: 0xffffff, 1: 0xe53935, 2: 0x1e88e5 };

export const COINS = {
  perMatch: 10,
  perKill: 4,
  win: 30,
  /** Upper bound per match, so long matches can't be farmed. */
  max: 150,
} as const;
