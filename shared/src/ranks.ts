/**
 * Ranks: every finished match gives experience (XP) and enough XP moves you up a level, from
 * level 1 (Egg) to level 10 (Chicken King). XP is only ever added by the server.
 */

export interface Rank {
  level: number;
  name: string;
  icon: string;
  /** Total XP needed to reach this level. */
  xp: number;
}

export const RANKS: readonly Rank[] = [
  { level: 1, name: 'Egg', icon: '🥚', xp: 0 },
  { level: 2, name: 'Chick', icon: '🐣', xp: 150 },
  { level: 3, name: 'Hatchling', icon: '🐥', xp: 400 },
  { level: 4, name: 'Pullet', icon: '🐤', xp: 800 },
  { level: 5, name: 'Hen', icon: '🐔', xp: 1400 },
  { level: 6, name: 'Rooster', icon: '🐓', xp: 2200 },
  { level: 7, name: 'Eagle', icon: '🦅', xp: 3300 },
  { level: 8, name: 'Phoenix', icon: '🔥', xp: 4800 },
  { level: 9, name: 'Legend', icon: '🏆', xp: 6800 },
  { level: 10, name: 'Chicken King', icon: '👑', xp: 9500 },
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = RANKS.length;

/** XP for one finished match. */
export const XP = {
  perMatch: 25,
  perKill: 10,
  win: 60,
  maxPerMatch: 400,
} as const;

export function matchXp(kills: number, won: boolean): number {
  return Math.min(XP.maxPerMatch, XP.perMatch + XP.perKill * Math.max(0, kills) + (won ? XP.win : 0));
}

/** The rank for a level, clamped to 1–10. */
export function rankOf(level: number): Rank {
  const i = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.floor(level) || MIN_LEVEL)) - 1;
  return RANKS[i]!;
}

export function levelFor(xp: number): number {
  let level = MIN_LEVEL;
  for (const r of RANKS) if (xp >= r.xp) level = r.level;
  return level;
}

export interface RankProgress {
  rank: Rank;
  /** Null at the top level. */
  next: Rank | null;
  /** 0–1 of the way to the next level (1 at the top). */
  progress: number;
}

export function rankProgress(xp: number): RankProgress {
  const rank = rankOf(levelFor(xp));
  const next = rank.level < MAX_LEVEL ? RANKS[rank.level]! : null;
  const progress = next ? Math.max(0, Math.min(1, (xp - rank.xp) / (next.xp - rank.xp))) : 1;
  return { rank, next, progress };
}
