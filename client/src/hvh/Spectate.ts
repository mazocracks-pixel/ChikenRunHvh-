/*
 * v2 HvH rounds (R63): a dead player watches a living teammate until they respawn. This is the pure
 * choice of whom to watch; GameSession places the camera. The order is by pid, so cycling is stable
 * while players come and go.
 */

export interface SpectateCandidate {
  readonly pid: number;
  readonly team: number;
  readonly alive: boolean;
}

/** The living players on `team`, in pid order. Team 0 (no teams) has no teammates. */
export function livingTeammates(team: number, players: Iterable<SpectateCandidate>): number[] {
  if (team === 0) return [];
  const pids: number[] = [];
  for (const p of players) if (p.team === team && p.alive) pids.push(p.pid);
  return pids.sort((a, b) => a - b);
}

export class SpectateTarget {
  private pid: number | null = null;

  /** The teammate being watched, or null. */
  get current(): number | null {
    return this.pid;
  }

  /**
   * Keeps the watched teammate while they live. Otherwise the next living teammate after them in
   * pid order (the first one when nobody was watched); null when no teammate lives.
   */
  update(team: number, players: Iterable<SpectateCandidate>): number | null {
    const living = livingTeammates(team, players);
    if (this.pid === null || !living.includes(this.pid)) this.pid = this.after(living, 1);
    return this.pid;
  }

  /** A click: the next (`dir` 1) or previous (-1) living teammate, wrapping around. */
  cycle(team: number, players: Iterable<SpectateCandidate>, dir: 1 | -1 = 1): number | null {
    this.pid = this.after(livingTeammates(team, players), dir);
    return this.pid;
  }

  /** The player respawned: spectating ends. */
  reset(): void {
    this.pid = null;
  }

  /** The living teammate `dir` steps from the watched pid (which may have died or left). */
  private after(living: readonly number[], dir: 1 | -1): number | null {
    if (living.length === 0) return null;
    if (this.pid === null) return living[0]!;
    const from = this.pid;
    if (dir === 1) return living.find((pid) => pid > from) ?? living[0]!;
    return [...living].reverse().find((pid) => pid < from) ?? living[living.length - 1]!;
  }
}
