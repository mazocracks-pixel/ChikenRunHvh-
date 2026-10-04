/**
 * Ranks, level 1 (Egg) to level 10 (Chicken King), set by rank points. Points only move in
 * FaceChiken (the ranked mode): a win gives some, a loss takes some, and you never drop below the
 * level you've reached. Only the server changes them. Reaching a new level pays coins.
 */

export interface Rank {
  level: number;
  name: string;
  icon: string;
  /** Total rank points needed to reach this level. */
  xp: number;
}

export const RANKS: readonly Rank[] = [
  { level: 1, name: 'Egg', icon: '🥚', xp: 0 },
  { level: 2, name: 'Chick', icon: '🐣', xp: 100 },
  { level: 3, name: 'Hatchling', icon: '🐥', xp: 250 },
  { level: 4, name: 'Pullet', icon: '🐤', xp: 450 },
  { level: 5, name: 'Hen', icon: '🐔', xp: 700 },
  { level: 6, name: 'Rooster', icon: '🐓', xp: 1000 },
  { level: 7, name: 'Eagle', icon: '🦅', xp: 1350 },
  { level: 8, name: 'Phoenix', icon: '🔥', xp: 1750 },
  { level: 9, name: 'Legend', icon: '🏆', xp: 2200 },
  { level: 10, name: 'Chicken King', icon: '👑', xp: 2700 },
];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = RANKS.length;

/** FaceChiken rank points for one match. */
export const RANKED = {
  win: 30,
  loss: -20,
  /** Plus this per kill, up to killBonusMax (so a good game softens a loss). */
  perKill: 1,
  killBonusMax: 10,
  /** Leaving a ranked match that's underway counts as a loss. */
  leave: -25,
  /** Coins for reaching each new level. */
  levelCoins: 250,
} as const;

export function rankedPoints(kills: number, won: boolean): number {
  return (won ? RANKED.win : RANKED.loss) + Math.min(RANKED.killBonusMax, Math.max(0, kills) * RANKED.perKill);
}

/** New points after a change: never below the start of the level you're on. */
export function applyRankPoints(xp: number, change: number): number {
  return Math.max(rankOf(levelFor(xp)).xp, xp + change);
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
