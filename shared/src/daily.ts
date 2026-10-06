import { mulberry32 } from './rng';

/** What a daily challenge counts. Progress adds up over every match played that (UTC) day. */
export type DailyKind = 'kills' | 'matches' | 'wins';

export interface DailyChallenge {
  id: DailyKind;
  label: string;
  goal: number;
  /** Coins paid once, the moment the goal is reached. */
  reward: number;
}

export interface DailyStatus {
  /** The day these challenges are for (UTC), "2026-10-06". */
  day: string;
  challenges: (DailyChallenge & { progress: number; done: boolean })[];
  /** Until new challenges appear (midnight UTC). */
  resetsInMs: number;
}

const KINDS: readonly DailyKind[] = ['kills', 'matches', 'wins'];
const GOALS: Record<DailyKind, readonly number[]> = { kills: [10, 15, 20, 30], matches: [2, 3, 5], wins: [1, 2, 3] };
/** Coins per point of goal: 20 kills pays 100, 3 matches 60, 2 wins 120. */
const COINS_PER: Record<DailyKind, number> = { kills: 5, matches: 20, wins: 60 };

const DAY_MS = 86_400_000;

/** The UTC day of `now`, as "YYYY-MM-DD". */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function msUntilNextDay(now: number): number {
  return DAY_MS - (now % DAY_MS);
}

function labelFor(kind: DailyKind, goal: number): string {
  if (kind === 'kills') return `Get ${goal} kills`;
  if (kind === 'matches') return `Play ${goal} matches`;
  return goal === 1 ? 'Win a match' : `Win ${goal} matches`;
}

/**
 * The three challenges of a player for a day: always one of each kind, with goals picked by a
 * seed from the player and the day, so the server and the client agree without storing them.
 */
export function dailyChallenges(userId: number, day: string): DailyChallenge[] {
  let seed = 2166136261 ^ userId;
  for (let i = 0; i < day.length; i++) seed = Math.imul(seed ^ day.charCodeAt(i), 16777619);
  const rand = mulberry32(seed >>> 0);
  return KINDS.map((id) => {
    const options = GOALS[id];
    const goal = options[Math.floor(rand() * options.length)]!;
    return { id, label: labelFor(id, goal), goal, reward: goal * COINS_PER[id] };
  });
}
