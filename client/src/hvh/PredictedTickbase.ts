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
  /** False until we hold a server state; until then nothing can be compared. */
  private synced: boolean;

  constructor(private readonly era: EraTable = LATE_CSGO, initial?: TickbaseState) {
    this.current = initial ? { ...initial } : EMPTY_TICKBASE(0, era);
    this.synced = initial !== undefined;
  }

  get state(): TickbaseState { return this.current; }
  get mismatches(): number { return this.mismatchCount; }
  get pendingCount(): number { return this.unacked.length; }

  /** Run one outgoing command locally. Call once per command, in seq order. */
  apply(seq: number, intent: CommandIntent): void {
    this.current = stepTickbase(this.current, intent, this.era).next;
    this.unacked.push({ seq, intent, after: this.current });
    if (this.unacked.length > MAX_UNACKED) this.unacked.shift();
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
