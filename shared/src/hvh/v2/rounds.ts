/*
 * Round flow of a v2 HvH match (CS:GO short match): warmup, then rounds of freeze -> live -> over
 * until a team has won roundsToWin rounds or maxRounds have been played. Pure: the room counts
 * alive players and team sizes and passes its clock.
 *
 * - Warmup's clock starts once both teams have players and stops if a team empties.
 * - A live round ends when a team has 0 alive (an empty team has 0 alive and loses); both teams at
 *   0 alive is a draw. On time-out the team with more alive wins; equal alive is a draw.
 * - A team with no players goes back to a fresh warmup ('reset'; the room restarts the match):
 *   at once during freeze, or when the round-end banner runs out, instead of playing more rounds.
 * - Halftime: starting round halfAfter + 1 swaps the sides, and the score with them (score is by
 *   team id, and the room swaps every player's team). Drawn rounds count as played.
 * - Match end: right at the round end where a team reaches roundsToWin, or once maxRounds have
 *   been played. Phase 'ended' is final; there `winner` is the match winner (0: a draw, which is
 *   any match without a team at roundsToWin) and `reason` is the last round's.
 */

export const HVH_ROUNDS = { warmupMs: 15000, freezeMs: 5000, roundMs: 115000, roundEndMs: 5000, roundsToWin: 13, maxRounds: 24, halfAfter: 12 } as const;

export type HvhRoundPhase = 'warmup' | 'freeze' | 'live' | 'over' | 'ended';

export type HvhRoundEvent = 'roundStart' | 'goLive' | 'roundEnd' | 'halftime' | 'matchEnd' | 'reset';

export interface HvhRoundState {
  phase: HvhRoundPhase;
  /** 0 during warmup, then 1, 2, ... */
  round: number;
  /** Room time (ms) the current phase ends, or null (warmup waiting for players, ended). */
  endsAt: number | null;
  /** Rounds won, by team id. */
  score: { 1: number; 2: number };
  /** Round winner while 'over' (0: drawn); match winner once 'ended'. */
  winner: 0 | 1 | 2;
  reason: 'eliminated' | 'time' | 'draw' | null;
}

export type TeamCounts = { 1: number; 2: number };

export function hvhWarmup(): HvhRoundState {
  return { phase: 'warmup', round: 0, endsAt: null, score: { 1: 0, 2: 0 }, winner: 0, reason: null };
}

/** One step of the round flow. Returns the same state object when nothing changed. */
export function stepHvhRound(s: HvhRoundState, alive: TeamCounts, players: TeamCounts, now: number): { state: HvhRoundState; events: HvhRoundEvent[] } {
  const same = { state: s, events: [] };
  const staffed = players[1] > 0 && players[2] > 0;
  switch (s.phase) {
    case 'warmup': {
      if (players[1] === 0 || players[2] === 0) return s.endsAt === null ? same : { state: { ...s, endsAt: null }, events: [] };
      if (s.endsAt === null) return { state: { ...s, endsAt: now + HVH_ROUNDS.warmupMs }, events: [] };
      return now >= s.endsAt ? startRound(s, 1, now) : same;
    }
    case 'freeze':
      if (!staffed) return reset();
      return now >= (s.endsAt ?? 0) ? { state: { ...s, phase: 'live', endsAt: now + HVH_ROUNDS.roundMs }, events: ['goLive'] } : same;
    case 'live': {
      if (alive[1] === 0 && alive[2] === 0) return endRound(s, 0, 'draw', now);
      if (alive[2] === 0) return endRound(s, 1, 'eliminated', now);
      if (alive[1] === 0) return endRound(s, 2, 'eliminated', now);
      if (now < (s.endsAt ?? Infinity)) return same;
      return alive[1] === alive[2] ? endRound(s, 0, 'draw', now) : endRound(s, alive[1] > alive[2] ? 1 : 2, 'time', now);
    }
    case 'over':
      if (now < (s.endsAt ?? 0)) return same;
      return staffed ? startRound(s, s.round + 1, now) : reset();
    case 'ended':
      return same;
  }
}

function reset(): { state: HvhRoundState; events: HvhRoundEvent[] } {
  return { state: hvhWarmup(), events: ['reset'] };
}

function startRound(s: HvhRoundState, round: number, now: number): { state: HvhRoundState; events: HvhRoundEvent[] } {
  const halftime = round === HVH_ROUNDS.halfAfter + 1;
  const score = halftime ? { 1: s.score[2], 2: s.score[1] } : s.score;
  return {
    state: { phase: 'freeze', round, endsAt: now + HVH_ROUNDS.freezeMs, score, winner: 0, reason: null },
    events: halftime ? ['halftime', 'roundStart'] : ['roundStart'],
  };
}

function endRound(s: HvhRoundState, winner: 0 | 1 | 2, reason: 'eliminated' | 'time' | 'draw', now: number): { state: HvhRoundState; events: HvhRoundEvent[] } {
  const score = winner === 0 ? s.score : { ...s.score, [winner]: s.score[winner] + 1 } as TeamCounts;
  const champion = score[1] >= HVH_ROUNDS.roundsToWin ? 1 : score[2] >= HVH_ROUNDS.roundsToWin ? 2 : 0;
  if (champion !== 0 || s.round >= HVH_ROUNDS.maxRounds) {
    return { state: { ...s, phase: 'ended', endsAt: null, score, winner: champion, reason }, events: ['roundEnd', 'matchEnd'] };
  }
  return { state: { ...s, phase: 'over', endsAt: now + HVH_ROUNDS.roundEndMs, score, winner, reason }, events: ['roundEnd'] };
}
