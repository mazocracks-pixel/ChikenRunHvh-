import { EMPTY_TICKBASE, LATE_CSGO, stepTickbase, type CommandIntent, type EraTable, type TickbaseState } from '@game/shared/hvh/v2';

/** Upper bound on commands kept while waiting for the server to execute them (about 2 s of ticks). */
export const MAX_UNACKED = 128;

interface Entry { seq: number; intent: CommandIntent; after: TickbaseState }

/**
 * Client-side prediction of the server's per-player tickbase. It holds no HvH rules: every step
 * is the shared `stepTickbase`, replayed exactly as the server runs it. Mirrors LocalPlayer's
 * movement reconciliation: drop acknowledged commands, snap to the server state, replay the rest.
 */
export class PredictedTickbase {
  private current: TickbaseState;
  private unacked: Entry[] = [];
  private mismatchCount = 0;
  private lastApplied = -Infinity;
  /** False until we hold a server state; until then nothing can be compared. */
  private synced: boolean;

  constructor(private readonly era: EraTable = LATE_CSGO, initial?: TickbaseState) {
    this.current = initial ? { ...initial } : EMPTY_TICKBASE(0, era);
    this.synced = initial !== undefined;
  }

  get state(): TickbaseState { return this.current; }
  get mismatches(): number { return this.mismatchCount; }
  get pendingCount(): number { return this.unacked.length; }

  /**
   * Run one command the server can execute, in seq order. The server drops a command whose seq is
   * not above the last one it accepted, so we skip those too; commands lost on the way (never
   * emitted) are simply never applied. Returns false when skipped.
   */
  apply(seq: number, intent: CommandIntent): boolean {
    if (seq <= this.lastApplied) return false;
    this.lastApplied = seq;
    this.current = stepTickbase(this.current, intent, this.era).next;
    this.unacked.push({ seq, intent, after: this.current });
    if (this.unacked.length > MAX_UNACKED) this.unacked.shift();
    return true;
  }

  /**
   * `server` is the state after the command `lastAckSeq`. The server serialises ticksSinceShift
   * capped at rechargeDelayTicks, so the prediction is capped the same way before comparing
   * (stepTickbase only ever tests ticksSinceShift >= rechargeDelayTicks, so the cap is lossless).
   */
  reconcile(server: TickbaseState, lastAckSeq: number): void {
    const at = this.unacked.find((e) => e.seq === lastAckSeq);
    if (this.synced && at) {
      const p = at.after;
      const same = p.tickbase === server.tickbase && p.bank === server.bank && p.choked === server.choked
        && Math.min(p.ticksSinceShift, this.era.rechargeDelayTicks) === Math.min(server.ticksSinceShift, this.era.rechargeDelayTicks);
      if (!same) this.mismatchCount++;
    }
    this.synced = true;
    this.unacked = this.unacked.filter((e) => e.seq > lastAckSeq);
    let s: TickbaseState = { ...server };
    for (const e of this.unacked) {
      s = stepTickbase(s, e.intent, this.era).next;
      e.after = s;
    }
    this.current = s;
  }
}

/**
 * Intent for one outgoing command.
 * - fire: only the command that carries a shot (`shotSeq` is the seq the `fire` message references),
 *   and only for hitscan weapons. Holding the trigger without a shot never sets it.
 * - choke: only a frame the CommandChoker holds back; the frame that releases a batch is not choke.
 */
export function commandIntent(o: {
  seq: number; shotSeq: number | null; hitscan: boolean; held: boolean;
  exploit: 'off' | 'doubleTap' | 'hideShots';
}): CommandIntent {
  const fire = o.hitscan && o.shotSeq === o.seq;
  return {
    fire,
    choke: o.held && !fire,
    doubleTap: o.exploit === 'doubleTap',
    hideShots: o.exploit === 'hideShots',
    defensive: false,
  };
}

/**
 * What a `fire` message's `command` points at. v2 hitscan: the next command to be built, which
 * carries intent.fire (`shotSeq`). Legacy HvH (and melee/projectile): the last acked seq, as before v2.
 */
export function shotReference(v2Hitscan: boolean, nextSeq: number, ack: number): { command: number; shotSeq: number | null } {
  return v2Hitscan ? { command: nextSeq, shotSeq: nextSeq } : { command: ack, shotSeq: null };
}

/**
 * Maps client server-time (ms) to the server's tick counter, which advances at the era tick rate.
 * Each hvhState gives (tick, arrival time). The state was produced one network delay before it
 * arrived, so the estimate lags the true tick by about that delay (the view tick is slightly
 * old, never ahead), small next to the interpolation delay it is used with.
 */
export class TickClock {
  private tick = 0;
  private at = 0;
  private known = false;
  constructor(private readonly tickRate: number = LATE_CSGO.tickRate) {}
  sample(tick: number, serverTimeMs: number): void { this.tick = tick; this.at = serverTimeMs; this.known = true; }
  /** The server tick the client is displaying at `renderTimeMs` (= serverNow() - INTERP_DELAY_MS). */
  viewedTick(renderTimeMs: number): number {
    return this.known ? Math.max(0, this.tick + Math.floor(((renderTimeMs - this.at) * this.tickRate) / 1000)) : 0;
  }
}
