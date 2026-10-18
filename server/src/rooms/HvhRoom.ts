import {
  MAX_PENDING_FIRES,
  MAX_REWIND_MS,
  PLAYER,
  PLAYER_HULL_WIDTH,
  SIM_DT,
  WEAPONS,
  clamp,
  defaultHvhCore,
  fakeLagTicks,
  hopMaxFor,
  hvhPitch,
  hvhSpread,
  hvhWeapon,
  hvhStateEvent,
  isWeaponId,
  makeRay,
  moveSpeedFor,
  packPlayer,
  rayHvhMatrix,
  shotSeed,
  shotUsesAmmo,
  stepPlayer,
  type FireRequest,
  type InputFrame,
  type PlayerState,
  type Vec3,
  type WeaponDef,
  type WorldSnapshot,
} from '@game/shared';
import {
  EMPTY_TICKBASE,
  INITIAL_POSE,
  LATE_CSGO,
  RecordHistory,
  collisionWorldTracer,
  createResolverMemory,
  guessedPose,
  learnFromVerdict,
  peekResolve,
  poseMatrix,
  processShot,
  publicObservation,
  stepPose,
  stepTickbase,
  tickbaseVerdictReason,
  type AntiAimConfig,
  type CommandIntent,
  type EraTable,
  type LagRecord,
  type Motion,
  type Observation,
  type PoseState,
  type ResolverMemory,
  type ShotTarget,
  type ShotVerdict,
  type TickbaseState,
  type WorldTracer,
} from '@game/shared/hvh/v2';
import type { GameServer } from '../types';
import { isFiniteNumber, isRecord as isPlainRecord } from '../util';
import { GameRoom, parseFire, parseInput, type RoomHooks, type RoomOptions } from './GameRoom';
import type { ServerPlayer } from './ServerPlayer';

/*
 * HvH room. With hvhEngine 'legacy' (the default) every override defers to GameRoom, so the room
 * behaves exactly as a plain GameRoom in HvH mode. With 'v2' the per-player tick runs the v2
 * pipeline (shared/src/hvh/v2) instead of GameRoom.simulatePlayer:
 *
 *   per server tick, per player: refill the command budget by 1 (cap maxProcessTicks), then for
 *   each dequeued command (at most maxProcessTicks): stepTickbase -> movement -> stepPose ->
 *   shots through processShot -> learnFromVerdict -> emit verdicts. At the end of the player's
 *   tick one LagRecord is pushed for the server tick (unless every command was choked / banked).
 *   DT bullet 2 is held until every player has been simulated, then fired in the same server tick.
 *
 * Decisions:
 * - Input passes the legacy per-player token limiter first (R25; rejected input is dropped
 *   silently, as in legacy). Queue cap 2 x maxProcessTicks; overflow drops the oldest with a
 *   'rejected / command flood' verdict sent to the sender only. A per-tick budget (refills 1 per
 *   tick, cap maxProcessTicks) bounds execution: a burst of up to 16 runs at once.
 * - Records are keyed by server tick (RecordHistory needs strictly increasing ticks), so several
 *   commands in one tick produce one record: the state after the last recordable command.
 *   Choke commands are not recordable. A command that fires with a hide-shots shift is
 *   not recordable either (its on-shot pose is skipped, not pushed invalid); a plain shot records
 *   the on-shot pose (eyes and body on the aim, side 'center').
 * - A bank command (R23) runs movement, pose and record capture like any other; only the
 *   tickbase counter does not advance (stepTickbase).
 * - Targets (R24): the first enemy body the un-deviated aim ray intersects, traced against each
 *   enemy's lag record at the view tick (real pose, crouch scale; poseMatrix, as processShot).
 *   A client-named target (legacy fire intent.target) is only a hint: used when it is that body,
 *   or when no body is intersected. Nothing intersected and no hint: no target ('spread').
 * - R26: an accepted fire request is never dropped silently. A pending fire consumed while the
 *   player is dead / preparing / removed, or fired while dead, is 'rejected / actions blocked';
 *   one whose weapon became projectile or melee, and a command-level intent.fire stripped for a
 *   projectile or melee weapon (R30), is 'rejected / wrong weapon'; pending fires
 *   cleared by death are 'actions blocked'; overflow beyond MAX_PENDING_FIRES is 'fire flood'.
 *   Silent drops are only malformed packets and stale or duplicate seq. (Projectile and melee
 *   weapons fire through the legacy `fire` message.)
 * - Snapshots (R28): other viewers get v2 public state: yaw from the last publicObservation (eye
 *   yaw, never bodyYaw), and while choking, the state frozen at the last pushed record. The
 *   legacy fakeLag cache does not apply in v2 rooms.
 * - A hit on a spawn-protected target is 'rejected / spawn protection' and deals no damage, but
 *   the shot was fired: ammo, fire interval and the shooter's own spawn shield are spent.
 * - Defensive shift of N ticks at server tick T: markDefensive(T - N) on the player's history,
 *   and records pushed for ticks T .. T + N - 1 are pushed valid:false / 'defensive'.
 * - Projectile and melee weapons are excluded from v2: their `fire` messages take the legacy
 *   GameRoom path (fire queue, executeFire), and intent fire / DT / HS are ignored for them.
 *   Hitscan `fire` messages (bots, older clients) are attached as intent.fire to the command
 *   they followed, aimed with the message's direction.
 * - Exploit intents (choke, DT, HS, defensive) need the HvH tools on (hvhEnabled); Manual play
 *   keeps plain fire only.
 * - Ack: hvhState.lastAckSeq is ServerPlayer.lastSeq, the same value as the snapshot's `ack`.
 * - R41: bullet 1's weapon fire interval is measured in server ticks since the shooter's last
 *   shot, not in tickbase, so bank ticks (which do not advance tickbase) never block firing. DT
 *   bullet 2 keeps ticksSinceLastShot = the shifted ticks (slow weapons still cannot double tap).
 *   Within one server tick, the first shot is accepted once the interval has passed in server
 *   ticks, however many queued commands (a choke batch, a burst) ran before it in that tick; a
 *   second bullet-1 shot in the same tick sees 0 ticks since the last shot and is rejected
 *   'fire interval' (DT bullet 2 is the only accepted same-tick second bullet).
 */

export type HvhEngine = 'legacy' | 'v2';

/** HVH_ENGINE=v2 selects the v2 engine; anything else (or nothing) is legacy. */
export function hvhEngineFrom(env: Readonly<Record<string, string | undefined>>): HvhEngine {
  return env.HVH_ENGINE === 'v2' ? 'v2' : 'legacy';
}

const IDLE: CommandIntent = Object.freeze({ fire: false, choke: false, doubleTap: false, hideShots: false, defensive: false });
const TICK_MS = SIM_DT * 1000;
const OBSERVATIONS_KEPT = 32;

interface QueuedCommand {
  frame: Readonly<InputFrame>;
  intent: CommandIntent;
  clientTick?: number;
}

interface PendingBullet {
  seq: number;
  weaponId: string;
  aim: { origin: Vec3; dir: Vec3 };
  viewTick: number;
  ticksSinceLastShot: number;
  spread: number;
  targetPid?: number;
}

interface RecordCapture {
  position: Vec3;
  pose: PoseState;
  duck: number;
  motion: Motion;
}

/** Everything v2 tracks about one player, in one object (debug feeds and headless matches read it). */
export interface HvhPlayerV2 {
  queue: QueuedCommand[];
  /** Highest seq accepted into the queue. */
  lastQueuedSeq: number;
  /** Commands that may still run this tick (refills 1 per tick, cap maxProcessTicks). */
  budget: number;
  tickbase: TickbaseState;
  pose: PoseState;
  history: RecordHistory;
  observations: Observation[];
  /** This player's resolver, as a shooter. Only the sim drives it. */
  resolver: ResolverMemory;
  /**
   * Server tick of the last shot fired (R41): bullet 1's fire interval counts server ticks since
   * it, not tickbase, so bank ticks (which freeze tickbase) never block firing.
   */
  lastShotTick: number;
  /** Records pushed for server ticks below this are invalid ('defensive'). */
  defensiveUntilTick: number;
  /** Legacy `fire` messages for a hitscan weapon, waiting for their command, oldest first. */
  pendingFires: FireRequest[];
  /** DT bullet 2, fired after every player has been simulated this tick. */
  pendingBullet: PendingBullet | null;
  /** Commands executed this tick. */
  executed: number;
  /** Server tick of the newest pushed record. */
  lastRecordTick: number;
  /** What other viewers saw at the newest pushed record (frozen while choking). */
  publicState: PlayerState | null;
}

function parseIntent(raw: unknown): CommandIntent {
  if (!isPlainRecord(raw)) return IDLE;
  return {
    fire: raw.fire === true,
    choke: raw.choke === true,
    doubleTap: raw.doubleTap === true,
    hideShots: raw.hideShots === true,
    defensive: raw.defensive === true,
  };
}

function hitscan(w: WeaponDef): boolean {
  return !w.projectile && !w.melee;
}

function aimFromAngles(yaw: number, pitch: number): Vec3 {
  // Inverse of the legacy reveal: yaw = atan2(-dx, -dz), pitch = asin(dy).
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** Newest lag records sent per target in the dev overlay feed. */
export const DEBUG_MAX_RECORDS = 24;

export class HvhRoom extends GameRoom {
  readonly hvhEngine: HvhEngine;
  readonly era: EraTable = LATE_CSGO;
  private readonly v2Players = new Map<number, HvhPlayerV2>();
  private readonly verdictListeners = new Set<(v: ShotVerdict) => void>();
  private tracer: WorldTracer | null = null;
  /** Dev overlay viewers (pid -> still-authorized check, re-evaluated every tick). */
  private readonly debugViewers = new Map<number, () => boolean>();

  constructor(io: GameServer, options: RoomOptions, hooks: RoomHooks = {}) {
    super(io, options, hooks);
    this.hvhEngine = options.hvhEngine === 'v2' ? 'v2' : 'legacy';
  }

  private get v2(): boolean {
    return this.hvhEngine === 'v2';
  }

  /** Every verdict the room emits (dev-only debug feeds, headless matches, tests). */
  addVerdictListener(fn: (v: ShotVerdict) => void): () => void {
    this.verdictListeners.add(fn);
    return () => this.verdictListeners.delete(fn);
  }

  /** The v2 state of a player (undefined on the legacy engine or for unknown players). */
  v2State(pid: number): Readonly<HvhPlayerV2> | undefined {
    const p = this.players.get(pid);
    return this.v2 && p ? this.stateOf(p) : undefined;
  }

  /**
   * Turns the authoritative debug feed (hvhDebug) on or off for a developer. `authorized` is the
   * caller's live DevAccess check; it is re-run every tick, and the feed only ever flows in
   * private v2 rooms. Pass null to stop.
   */
  setDebugViewer(p: ServerPlayer, authorized: (() => boolean) | null): void {
    if (authorized) this.debugViewers.set(p.pid, authorized);
    else this.debugViewers.delete(p.pid);
  }

  /** One hvhDebug message per other player per tick, to each authorized viewer. Pure reads: peekResolve, never resolve. */
  private sendDebugFeed(): void {
    if (this.debugViewers.size === 0 || !this.info.private) return;
    for (const [pid, authorized] of this.debugViewers) {
      const viewer = this.players.get(pid);
      if (!viewer?.socket) continue;
      if (!authorized()) { this.debugViewers.delete(pid); continue; }
      const memory = this.stateOf(viewer).resolver;
      for (const target of this.players.values()) {
        if (target === viewer || !target.alive) continue;
        const t = this.stateOf(target);
        // Volatile (like snapshots): a slow dev socket drops frames instead of buffering without bound.
        viewer.socket.volatile.emit('hvhDebug', {
          playerId: target.pid,
          realPose: { ...t.pose },
          records: t.history.records().slice(-DEBUG_MAX_RECORDS).map((r) => ({ ...r })),
          resolver: peekResolve(memory, String(target.pid), t.observations, this.hvhTick),
        });
      }
    }
  }

  queuedCommands(pid: number): number {
    return this.v2State(pid)?.queue.length ?? 0;
  }

  tickbaseOf(pid: number): Readonly<TickbaseState> | undefined {
    return this.v2State(pid)?.tickbase;
  }

  private stateOf(p: ServerPlayer): HvhPlayerV2 {
    let s = this.v2Players.get(p.pid);
    if (!s) {
      s = {
        queue: [],
        lastQueuedSeq: 0,
        budget: this.era.maxProcessTicks,
        tickbase: EMPTY_TICKBASE(this.hvhTick, this.era),
        pose: INITIAL_POSE,
        history: new RecordHistory(this.era, PLAYER_HULL_WIDTH),
        observations: [],
        resolver: createResolverMemory(),
        lastShotTick: -Infinity,
        defensiveUntilTick: 0,
        pendingFires: [],
        pendingBullet: null,
        executed: 0,
        lastRecordTick: -Infinity,
        publicState: null,
      };
      this.v2Players.set(p.pid, s);
    }
    return s;
  }

  private world2(): WorldTracer {
    return (this.tracer ??= collisionWorldTracer(this.world, this.isSoft,
      (id) => (id < 0 ? 'ground' : this.map.boxes[id]?.kind ?? 'world')));
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  override handleInput(p: ServerPlayer, raw: unknown): void {
    if (!this.v2) return super.handleInput(p, raw);
    this.enforceHvhRules(p);
    const parsed = parseInput(raw);
    const s = this.stateOf(p);
    if (!parsed || p.removedForCheating || parsed.seq <= Math.max(p.lastSeq, s.lastQueuedSeq)) return;
    if (!p.takeInputToken(performance.now())) return; // R25: the legacy limiter, silent as in legacy
    const assisted = p.hvhEnabled && !p.hvhPreparing;
    const frame: InputFrame = { ...parsed, autoHop: assisted && parsed.autoHop === true, subtickStrafe: assisted && parsed.subtickStrafe === true };
    const r = raw as Record<string, unknown>;
    const command: QueuedCommand = { frame: Object.freeze(frame), intent: parseIntent(r.intent) };
    if (isFiniteNumber(r.clientTick)) command.clientTick = Math.floor(r.clientTick);
    s.lastQueuedSeq = frame.seq;
    s.queue.push(command);
    while (s.queue.length > 2 * this.era.maxProcessTicks) {
      s.queue.shift();
      this.emitVerdict(p, this.rejected(p, 'command flood'), { senderOnly: true });
    }
  }

  override handleFire(p: ServerPlayer, raw: unknown): void {
    if (!this.v2) return super.handleFire(p, raw);
    // Projectile and melee weapons keep the legacy path.
    if (!hitscan(WEAPONS[p.weapon])) return super.handleFire(p, raw);
    this.enforceHvhRules(p);
    const req = parseFire(raw);
    if (!req) return;
    const s = this.stateOf(p);
    if (req.shot <= p.lastShotSeq || s.pendingFires.some((f) => f.shot >= req.shot)) return;
    if (!p.alive || p.removedForCheating || p.hvhPreparing) {
      p.lastShotSeq = req.shot;
      this.emitVerdict(p, this.rejected(p, 'actions blocked'));
      return;
    }
    s.pendingFires.push(req);
    while (s.pendingFires.length > MAX_PENDING_FIRES) {
      p.lastShotSeq = Math.max(p.lastShotSeq, s.pendingFires.shift()!.shot);
      this.emitVerdict(p, this.rejected(p, 'fire flood'), { senderOnly: true });
    }
  }

  private rejected(p: ServerPlayer, reason: string, bullet: 1 | 2 = 1): ShotVerdict {
    return { shooterId: String(p.pid), tick: this.hvhTick, bullet, cause: 'rejected', reason };
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  protected override fixedUpdate(now: number): void {
    super.fixedUpdate(now);
    if (!this.v2) return;
    this.flushPendingBullets(now);
    for (const p of this.players.values()) {
      const s = this.stateOf(p);
      if (s.executed > 0) p.socket?.emit('hvhState', hvhStateEvent(s.tickbase, this.era, p.lastSeq, this.hvhTick));
    }
    this.sendDebugFeed();
  }

  protected override simulatePlayer(p: ServerPlayer, now: number): void {
    if (!this.v2) return super.simulatePlayer(p, now);
    this.processPlayerTick(String(p.pid), now);
  }

  /** One player's v2 tick: up to maxProcessTicks queued commands, then one lag record. */
  processPlayerTick(playerId: string, now = performance.now()): void {
    const p = this.players.get(Number(playerId));
    if (!p) return;
    const s = this.stateOf(p);
    s.budget = Math.min(this.era.maxProcessTicks, s.budget + 1);
    s.executed = 0;
    let capture: RecordCapture | null = null;
    while (s.executed < this.era.maxProcessTicks && s.budget >= 1 && s.queue.length > 0) {
      const command = s.queue.shift()!;
      s.budget--;
      s.executed++;
      capture = this.runCommand(p, s, command, now) ?? capture;
    }
    if (s.executed === 0) this.coast(p);
    p.simulationTime = now;
    p.weaponHeat = Math.max(0, p.weaponHeat - SIM_DT * 1.5);
    // The legacy resource still times projectile and melee weapons (legacy executeFire).
    p.resource.step(this.hvhTick, p.fireQueue.length > 0 || now - p.lastFireAt < 250,
      p.hvhEnabled && fakeLagTicks(p.hvh.core ?? defaultHvhCore(), p.lastSeq, p.state.horizontalSpeed) > 0);
    // Snapshots: everyone sees the eyes; only the owner's snapshot carries the body (p.yaw).
    p.animation.eyeYaw = p.animation.lowerBodyYaw = p.fakeYaw = s.pose.eyeYaw;
    p.animation.bodyYaw = p.yaw = s.pose.bodyYaw;
    p.fakePitch = s.pose.pitch;
    if (capture && p.alive) this.pushRecord(p, s, capture);
  }

  /** DT bullet 2 for everyone still alive; a shooter killed since bullet 1 fires nothing. */
  flushPendingBullets(now = performance.now()): void {
    for (const p of this.players.values()) {
      const s = this.stateOf(p);
      const bullet = s.pendingBullet;
      s.pendingBullet = null;
      if (!bullet || !p.alive) continue;
      this.fireBullet(p, s, bullet, 2, now);
    }
  }

  private runCommand(p: ServerPlayer, s: HvhPlayerV2, command: QueuedCommand, now: number): RecordCapture | null {
    const frame = command.frame;
    let intent = command.intent;
    let fireReq: FireRequest | null = null;
    const queued = s.pendingFires[0];
    if (queued && (queued.command === undefined || queued.command <= frame.seq)) {
      fireReq = s.pendingFires.shift()!;
      p.lastShotSeq = fireReq.shot;
      intent = { ...intent, fire: true };
    }
    if (!p.alive || p.hvhPreparing || p.removedForCheating) {
      if (fireReq) this.emitVerdict(p, this.rejected(p, 'actions blocked'));
      this.move(p, frame);
      return null;
    }
    if (!hitscan(WEAPONS[p.weapon])) {
      // R26 / R30: a fire message or a command-level intent.fire stripped here is answered.
      if (fireReq || intent.fire) this.emitVerdict(p, this.rejected(p, 'wrong weapon'));
      fireReq = null;
      intent = { ...intent, fire: false, doubleTap: false, hideShots: false };
    }
    if (!p.hvhEnabled) intent = { ...IDLE, fire: intent.fire };

    const before = s.tickbase;
    const { next, action } = stepTickbase(before, intent, this.era);
    s.tickbase = next;
    if (action.kind === 'reject') {
      this.emitVerdict(p, { shooterId: String(p.pid), tick: this.hvhTick, bullet: 1, cause: 'tickbase', reason: tickbaseVerdictReason(action.reason) });
    }
    this.move(p, frame);
    const motion = this.motionOf(p);
    s.pose = this.stepPoseFor(p, s, frame, motion);

    if (action.kind === 'shift' && action.reason === 'defensive') {
      s.history.markDefensive(this.hvhTick - action.ticks);
      s.defensiveUntilTick = Math.max(s.defensiveUntilTick, this.hvhTick + action.ticks);
    }

    let recordPose = s.pose;
    if (intent.fire) {
      const dt = action.kind === 'shift' && action.reason === 'doubleTap';
      const bullet = this.prepareBullet(p, s, frame, command, fireReq, now);
      this.fireBullet(p, s, bullet, 1, now);
      // DT bullet 2: its interval is the shifted ticks (slow weapons cannot double tap).
      if (dt) s.pendingBullet = { ...bullet, ticksSinceLastShot: action.ticks };
      if (action.kind === 'shift' && action.reason === 'hideShots') return null;
      // On-shot pose: eyes and body on the aim.
      const aimYaw = Math.atan2(-bullet.aim.dir.x, -bullet.aim.dir.z);
      recordPose = { ...s.pose, eyeYaw: aimYaw, bodyYaw: aimYaw, realSide: 'center', eyeOffsetDeg: 0 };
    }
    if (action.kind === 'choke') return null;
    return {
      position: { x: p.state.x, y: p.state.y, z: p.state.z },
      pose: recordPose,
      duck: p.state.crouchAmount ?? (p.state.crouching ? 1 : 0),
      motion,
    };
  }

  private acknowledge(p: ServerPlayer, frame: Readonly<InputFrame>): void {
    p.lastSeq = frame.seq;
    p.useHeld = frame.use === true;
    p.yaw = p.lookYaw = frame.yaw;
    p.pitch = frame.pitch;
    p.lastInput = frame;
  }

  /** GameRoom.applyInput without the legacy pose step. */
  private move(p: ServerPlayer, input: Readonly<InputFrame>): void {
    let frame = input;
    if ((frame.autoHop || frame.subtickStrafe) && (!p.hvhEnabled || p.hvhPreparing)) frame = { ...frame, autoHop: false, subtickStrafe: false };
    if (this.movementLocked(p)) frame = { ...frame, forward: 0, right: 0, jump: false, crouch: true };
    this.acknowledge(p, frame);
    if (!p.alive || p.immobile) {
      p.state.horizontalSpeed = 0;
      return;
    }
    stepPlayer(p.state, frame, SIM_DT, this.world, p.moveMods(), hopMaxFor(p.weapon), moveSpeedFor(p.weapon), true);
  }

  /** GameRoom's missing-command step: no presses are invented. */
  private coast(p: ServerPlayer): void {
    if (!p.alive || p.immobile || p.vehicle || !p.lastInput) return;
    const held = p.state.jumpHeld;
    stepPlayer(p.state,
      { ...p.lastInput, forward: 0, right: 0, jump: held && !p.state.onGround, autoHop: false, subtickStrafe: false }, SIM_DT,
      this.world, p.moveMods(), hopMaxFor(p.weapon), moveSpeedFor(p.weapon), true);
    p.state.jumpHeld = held;
  }

  private motionOf(p: ServerPlayer): Motion {
    return {
      speedFraction: clamp(p.state.horizontalSpeed / (PLAYER.speed * moveSpeedFor(p.weapon)), 0, 1),
      duck: p.state.crouchAmount ?? (p.state.crouching ? 1 : 0),
      onGround: p.state.onGround,
    };
  }

  private stepPoseFor(p: ServerPlayer, s: HvhPlayerV2, frame: Readonly<InputFrame>, motion: Motion): PoseState {
    const pitch = hvhPitch(frame.pitch, p.hvh);
    const aa = p.hvh.antiAim;
    if (!p.hvhEnabled || !aa.enabled) {
      return { ...s.pose, eyeYaw: frame.yaw, bodyYaw: frame.yaw, pitch, realSide: 'center', eyeOffsetDeg: 0 };
    }
    const config: AntiAimConfig = { base: aa.mode, jitterDeg: aa.jitter, desyncDeg: aa.desync, inverted: frame.invert === true };
    return { ...stepPose(s.pose, frame.yaw, config, motion, s.tickbase.tickbase, this.era), pitch };
  }

  private pushRecord(p: ServerPlayer, s: HvhPlayerV2, c: RecordCapture): void {
    const tick = this.hvhTick;
    // One record per server tick, even if processPlayerTick runs twice in a tick (headless drivers).
    if (tick <= s.lastRecordTick) return;
    s.lastRecordTick = tick;
    const defensive = tick < s.defensiveUntilTick;
    s.history.push({
      tick,
      position: c.position,
      pose: c.pose,
      duck: c.duck,
      valid: !defensive,
      ...(defensive ? { invalidCause: 'defensive' as const } : {}),
    });
    s.observations.push(publicObservation(c.pose, c.motion, tick));
    if (s.observations.length > OBSERVATIONS_KEPT) s.observations.splice(0, s.observations.length - OBSERVATIONS_KEPT);
    s.publicState = this.publicView(p.toState(), c.pose.eyeYaw);
  }

  private publicView(state: PlayerState, eyeYaw: number): PlayerState {
    return { ...state, yaw: eyeYaw, fakeYaw: eyeYaw, lowerBodyYaw: eyeYaw };
  }

  /**
   * R28: other viewers see v2 public state. While choking, the state frozen at the last pushed
   * record (as the server's records); otherwise the live state with the last observed eye yaw.
   */
  private publicStateOf(p: ServerPlayer): PlayerState {
    const s = this.stateOf(p);
    if (s.tickbase.choked > 0 && s.publicState && s.publicState.alive === p.alive) return s.publicState;
    const live = p.toState();
    return this.publicView(live, s.observations.at(-1)?.eyeYaw ?? live.yaw);
  }

  override snapshot(now = performance.now(), viewer = 0): WorldSnapshot {
    if (!this.v2) return super.snapshot(now, viewer);
    return {
      t: now,
      p: [...this.players.values()].map((p) => packPlayer(p.pid === viewer ? { ...p.toState(), fakeYaw: p.yaw } : this.publicStateOf(p))),
      v: this.vehicles?.packed() ?? [],
    };
  }

  // ---------------------------------------------------------------------------
  // Shots
  // ---------------------------------------------------------------------------

  private prepareBullet(p: ServerPlayer, s: HvhPlayerV2, frame: Readonly<InputFrame>, command: QueuedCommand,
    fireReq: FireRequest | null, now: number): PendingBullet {
    const origin = this.eyeOf(p);
    let dir = aimFromAngles(frame.yaw, frame.pitch);
    if (fireReq) {
      const len = Math.hypot(fireReq.dx, fireReq.dy, fireReq.dz);
      dir = { x: fireReq.dx / len, y: fireReq.dy / len, z: fireReq.dz / len };
    }
    const tick = this.hvhTick;
    let viewTick = tick;
    if (command.clientTick !== undefined) viewTick = command.clientTick;
    else if (fireReq) viewTick = tick - Math.round(clamp(now - fireReq.t, 0, MAX_REWIND_MS) / TICK_MS);
    viewTick = Math.min(viewTick, tick);
    const w = WEAPONS[p.weapon];
    const spread = hvhSpread(hvhWeapon(w), p.state.horizontalSpeed, !p.state.onGround, p.aiming, p.weaponHeat) * (p.mods?.spread ?? 1);
    const bullet: PendingBullet = {
      seq: frame.seq,
      weaponId: fireReq && fireReq.weapon !== p.weapon ? fireReq.weapon : p.weapon,
      aim: { origin, dir },
      viewTick,
      ticksSinceLastShot: tick - s.lastShotTick,
      spread,
    };
    const targetPid = this.pickTarget(p, origin, dir, viewTick, bullet.weaponId, fireReq?.intent?.target);
    if (targetPid !== undefined) bullet.targetPid = targetPid;
    return bullet;
  }

  private isEnemy(p: ServerPlayer, pid: number): boolean {
    const t = this.players.get(pid);
    return !!t && t !== p && !this.areTeammates(p, t);
  }

  /**
   * R24 / R29: the first enemy body the un-deviated aim ray intersects, nearest along the ray,
   * traced against each enemy's lag record at the view tick (crouch scale), in both the real pose
   * and the pose this shooter's resolver would guess (peekResolve, pure; guessedPose as in
   * shot.ts), so a shot through only the fake body still names its target (a resolver miss).
   * `hint` (a client-named target) counts only when it is that body or when nothing is hit.
   */
  private pickTarget(p: ServerPlayer, origin: Vec3, dir: Vec3, viewTick: number, weaponId: string, hint?: number): number | undefined {
    const def = isWeaponId(weaponId) ? WEAPONS[weaponId] : undefined;
    const range = def ? hvhWeapon(def).range : 0;
    const ray = makeRay(origin, dir);
    const resolver = this.stateOf(p).resolver;
    let best: { pid: number; t: number } | undefined;
    for (const t of this.players.values()) {
      if (t === p || !t.alive || this.areTeammates(p, t)) continue;
      const records = this.stateOf(t).history.records();
      let record: LagRecord | undefined;
      for (let i = records.length - 1; i >= 0; i--) {
        if (records[i]!.tick <= viewTick) { record = records[i]; break; }
      }
      if (!record) continue;
      const side = peekResolve(resolver, String(t.pid), this.stateOf(t).observations, viewTick).side;
      for (const pose of [record.pose, guessedPose(record.pose, side)]) {
        const hit = rayHvhMatrix(ray, poseMatrix(record, pose), range);
        if (hit && (!best || hit.t < best.t)) best = { pid: t.pid, t: hit.t };
      }
    }
    if (best) return best.pid;
    return hint !== undefined && this.isEnemy(p, hint) ? hint : undefined;
  }

  private rejectReason(p: ServerPlayer, weaponId: string, now: number): string | null {
    if (this.phase === 'ended' || this.actionsBlocked()) return 'actions blocked';
    if (weaponId !== p.weapon) return 'wrong weapon';
    if (now < p.switchReadyAt) return 'weapon switch';
    if (p.reloadUntil > 0) return 'reloading';
    if (p.mag <= 0) return 'no ammo';
    return null;
  }

  private fireBullet(p: ServerPlayer, s: HvhPlayerV2, bullet: PendingBullet, n: 1 | 2, now: number): void {
    const tick = this.hvhTick;
    const target = bullet.targetPid !== undefined ? this.players.get(bullet.targetPid) : undefined;
    const reason = this.rejectReason(p, bullet.weaponId, now);
    let verdict: ShotVerdict;
    if (reason !== null) {
      verdict = { shooterId: String(p.pid), tick, bullet: n, cause: 'rejected', reason };
      if (target) verdict.targetId = String(target.pid);
    } else {
      const shotTarget: ShotTarget | undefined = target
        ? { id: String(target.pid), history: this.stateOf(target).history, alive: target.alive, hp: target.hp }
        : undefined;
      verdict = processShot({
        shooterId: String(p.pid),
        tick,
        bullet: n,
        aim: bullet.aim,
        weaponId: bullet.weaponId,
        ticksSinceLastShot: bullet.ticksSinceLastShot,
        viewTick: bullet.viewTick,
        resolver: s.resolver,
        observations: target ? this.stateOf(target).observations : [],
        world: this.world2(),
        spreadSeed: shotSeed(p.pid, bullet.seq * 2 + n),
        spread: bullet.spread,
        ...(shotTarget ? { target: shotTarget } : {}),
      });
      // Exactly once per resolve: resolve ran iff the verdict carries `guessed`.
      if (verdict.guessed !== undefined && verdict.targetId !== undefined) {
        learnFromVerdict(s.resolver, verdict.targetId, verdict.guessed, verdict.cause);
      }
    }
    // Bookkeeping for every shot that was really fired and traced (spawn-protected hits included).
    if (verdict.cause !== 'rejected') {
      const w = WEAPONS[p.weapon];
      if (shotUsesAmmo(w, p.mods)) p.mags.set(p.weapon, p.mag - 1);
      s.lastShotTick = tick;
      p.lastFireAt = now;
      p.shieldUntil = 0;
      p.weaponHeat = Math.min(3, p.weaponHeat + 0.25);
    }
    if (verdict.cause === 'hit' && target && now < target.shieldUntil) {
      verdict = { shooterId: String(p.pid), targetId: String(target.pid), tick, bullet: n, cause: 'rejected', reason: 'spawn protection' };
    }
    // R27: the verdict keeps `real` for the shooter too. The plan's hit-log copy ("Missed shot due
    // to resolver (guessed X, real Y)") needs it; the trade-off is that a shooter learns the
    // target's real side after each resolved shot (an oracle the in-game resolver never reads).
    this.emitVerdict(p, verdict, { target });
    if (verdict.cause === 'hit' && target && verdict.damage !== undefined) {
      this.damage(target, p, verdict.damage, verdict.hitgroup === 'head', p.weapon, bullet.aim.origin, now);
    }
  }

  /**
   * To the shooter, the target and spectators (players not alive), plus verdict listeners.
   * `senderOnly` (flood verdicts, R25): to the sender and listeners only.
   */
  private emitVerdict(shooter: ServerPlayer, v: ShotVerdict, opts: { target?: ServerPlayer; senderOnly?: boolean } = {}): void {
    for (const fn of this.verdictListeners) fn(v);
    const to = new Set<ServerPlayer>([shooter]);
    if (!opts.senderOnly) {
      if (opts.target) to.add(opts.target);
      for (const q of this.players.values()) if (!q.alive) to.add(q);
    }
    for (const q of to) q.socket?.emit('shotVerdict', v);
  }

  // ---------------------------------------------------------------------------
  // Life cycle
  // ---------------------------------------------------------------------------

  protected override onPlayerDeath(victim: ServerPlayer, now: number): void {
    super.onPlayerDeath(victim, now);
    if (!this.v2) return;
    const s = this.stateOf(victim);
    s.pendingBullet = null;
    this.blockPendingFires(victim, s);
    s.tickbase = EMPTY_TICKBASE(this.hvhTick, this.era);
  }

  /** R26: fire requests still waiting when a life ends are answered, not dropped. */
  private blockPendingFires(p: ServerPlayer, s: HvhPlayerV2): void {
    for (const f of s.pendingFires.splice(0)) {
      p.lastShotSeq = Math.max(p.lastShotSeq, f.shot);
      this.emitVerdict(p, this.rejected(p, 'actions blocked'));
    }
  }

  protected override spawn(p: ServerPlayer, now: number, announce: boolean): void {
    super.spawn(p, now, announce);
    if (!this.v2) return;
    const s = this.stateOf(p);
    // A new life: fresh bank, pose and lag records (the resolver keeps what it learned).
    s.queue.length = 0;
    s.budget = this.era.maxProcessTicks;
    s.tickbase = EMPTY_TICKBASE(this.hvhTick, this.era);
    s.pose = INITIAL_POSE;
    s.history = new RecordHistory(this.era, PLAYER_HULL_WIDTH);
    s.observations = [];
    s.lastShotTick = -Infinity;
    s.defensiveUntilTick = 0;
    this.blockPendingFires(p, s);
    s.pendingBullet = null;
    s.lastRecordTick = -Infinity;
    s.publicState = null;
  }

  protected override onPlayerLeave(player: ServerPlayer): void {
    super.onPlayerLeave(player);
    this.debugViewers.delete(player.pid);
    this.v2Players.delete(player.pid);
  }
}
