import {
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
  moveSpeedFor,
  shotSeed,
  shotUsesAmmo,
  stepPlayer,
  type FireRequest,
  type InputFrame,
  type Vec3,
  type WeaponDef,
} from '@game/shared';
import {
  EMPTY_TICKBASE,
  INITIAL_POSE,
  LATE_CSGO,
  RecordHistory,
  collisionWorldTracer,
  createResolverMemory,
  learnFromVerdict,
  processShot,
  publicObservation,
  stepPose,
  stepTickbase,
  tickbaseVerdictReason,
  type AntiAimConfig,
  type CommandIntent,
  type EraTable,
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
 * - Queue cap 2 x maxProcessTicks; overflow drops the oldest with a 'rejected / command flood'
 *   verdict. The per-tick budget (refills 1 per tick, cap maxProcessTicks) replaces the legacy
 *   input token bucket: a burst of up to 16 runs at once, the sustained rate is one per tick.
 * - Records are keyed by server tick (RecordHistory needs strictly increasing ticks), so several
 *   commands in one tick produce one record: the state after the last recordable command.
 *   Choke and bank commands are not recordable. A command that fires with a hide-shots shift is
 *   not recordable either (its on-shot pose is skipped, not pushed invalid); a plain shot records
 *   the on-shot pose (eyes and body on the aim, side 'center').
 * - A bank command is not simulated (stepTickbase: it does not advance tickbase): it is
 *   acknowledged, but the player does not move and no pose step runs.
 * - Defensive shift of N ticks at server tick T: markDefensive(T - N) on the player's history,
 *   and records pushed for ticks T .. T + N - 1 are pushed valid:false / 'defensive'.
 * - Projectile and melee weapons are excluded from v2: their `fire` messages take the legacy
 *   GameRoom path (fire queue, executeFire), and intent fire / DT / HS are ignored for them.
 *   Hitscan `fire` messages (bots, older clients) are attached as intent.fire to the command
 *   they followed, aimed with the message's direction.
 * - Exploit intents (choke, DT, HS, defensive) need the HvH tools on (hvhEnabled); Manual play
 *   keeps plain fire only.
 * - Ack: hvhState.lastAckSeq is ServerPlayer.lastSeq, the same value as the snapshot's `ack`.
 */

export type HvhEngine = 'legacy' | 'v2';

/** HVH_ENGINE=v2 selects the v2 engine; anything else (or nothing) is legacy. */
export function hvhEngineFrom(env: Readonly<Record<string, string | undefined>>): HvhEngine {
  return env.HVH_ENGINE === 'v2' ? 'v2' : 'legacy';
}

const IDLE: CommandIntent = Object.freeze({ fire: false, choke: false, doubleTap: false, hideShots: false, defensive: false });
const TICK_MS = SIM_DT * 1000;
/** A target is picked when the aim passes this close to its body centre. */
const TARGET_PICK_RADIUS = 1;
const BODY_CENTRE_Y = PLAYER.eyeHeight * 0.6;
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
  shotTickbase: number;
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
  lastShotTickbase: number;
  /** Records pushed for server ticks below this are invalid ('defensive'). */
  defensiveUntilTick: number;
  /** A legacy `fire` message for a hitscan weapon, waiting for its command. */
  pendingFire: FireRequest | null;
  /** DT bullet 2, fired after every player has been simulated this tick. */
  pendingBullet: PendingBullet | null;
  /** Commands executed this tick. */
  executed: number;
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

export class HvhRoom extends GameRoom {
  readonly hvhEngine: HvhEngine;
  readonly era: EraTable = LATE_CSGO;
  private readonly v2Players = new Map<number, HvhPlayerV2>();
  private readonly verdictListeners = new Set<(v: ShotVerdict) => void>();
  private tracer: WorldTracer | null = null;

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
        lastShotTickbase: -Infinity,
        defensiveUntilTick: 0,
        pendingFire: null,
        pendingBullet: null,
        executed: 0,
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
    const assisted = p.hvhEnabled && !p.hvhPreparing;
    const frame: InputFrame = { ...parsed, autoHop: assisted && parsed.autoHop === true, subtickStrafe: assisted && parsed.subtickStrafe === true };
    const r = raw as Record<string, unknown>;
    const command: QueuedCommand = { frame: Object.freeze(frame), intent: parseIntent(r.intent) };
    if (isFiniteNumber(r.clientTick)) command.clientTick = Math.floor(r.clientTick);
    s.lastQueuedSeq = frame.seq;
    s.queue.push(command);
    while (s.queue.length > 2 * this.era.maxProcessTicks) {
      s.queue.shift();
      this.emitVerdict(p, { shooterId: String(p.pid), tick: this.hvhTick, bullet: 1, cause: 'rejected', reason: 'command flood' });
    }
  }

  override handleFire(p: ServerPlayer, raw: unknown): void {
    if (!this.v2) return super.handleFire(p, raw);
    // Projectile and melee weapons keep the legacy path.
    if (!hitscan(WEAPONS[p.weapon])) return super.handleFire(p, raw);
    this.enforceHvhRules(p);
    const req = parseFire(raw);
    if (!req || !p.alive || p.removedForCheating) return;
    const s = this.stateOf(p);
    if (req.shot <= p.lastShotSeq || (s.pendingFire && req.shot <= s.pendingFire.shot)) return;
    s.pendingFire = req;
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
    if (capture && p.alive) this.pushRecord(s, capture);
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
    if (s.pendingFire && (s.pendingFire.command === undefined || s.pendingFire.command <= frame.seq)) {
      fireReq = s.pendingFire;
      s.pendingFire = null;
      p.lastShotSeq = fireReq.shot;
      intent = { ...intent, fire: true };
    }
    if (!p.alive || p.hvhPreparing || p.removedForCheating) {
      this.move(p, frame);
      return null;
    }
    if (!hitscan(WEAPONS[p.weapon])) intent = { ...intent, fire: false, doubleTap: false, hideShots: false };
    if (!p.hvhEnabled) intent = { ...IDLE, fire: intent.fire };

    const before = s.tickbase;
    const { next, action } = stepTickbase(before, intent, this.era);
    s.tickbase = next;
    if (action.kind === 'reject') {
      this.emitVerdict(p, { shooterId: String(p.pid), tick: this.hvhTick, bullet: 1, cause: 'tickbase', reason: tickbaseVerdictReason(action.reason) });
    }
    if (action.kind === 'bank') {
      // Not simulated: acknowledged, but no movement, no pose step.
      this.acknowledge(p, frame);
      return null;
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
      const shotTickbase = dt ? before.tickbase + 1 : next.tickbase;
      const bullet = this.prepareBullet(p, s, frame, command, fireReq, shotTickbase, now);
      this.fireBullet(p, s, bullet, 1, now);
      if (dt) {
        s.pendingBullet = { ...bullet, ticksSinceLastShot: action.ticks, shotTickbase: next.tickbase };
      }
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

  private pushRecord(s: HvhPlayerV2, c: RecordCapture): void {
    const tick = this.hvhTick;
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
  }

  // ---------------------------------------------------------------------------
  // Shots
  // ---------------------------------------------------------------------------

  private prepareBullet(p: ServerPlayer, s: HvhPlayerV2, frame: Readonly<InputFrame>, command: QueuedCommand,
    fireReq: FireRequest | null, shotTickbase: number, now: number): PendingBullet {
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
      ticksSinceLastShot: shotTickbase - s.lastShotTickbase,
      shotTickbase,
      spread,
    };
    const intended = fireReq?.intent?.target;
    const targetPid = intended !== undefined && this.isEnemy(p, intended) ? intended : this.pickTarget(p, origin, dir, viewTick);
    if (targetPid !== undefined) bullet.targetPid = targetPid;
    return bullet;
  }

  private isEnemy(p: ServerPlayer, pid: number): boolean {
    const t = this.players.get(pid);
    return !!t && t !== p && !this.areTeammates(p, t);
  }

  /** The enemy whose body the aim passes closest in front, as of the shooter's view tick. */
  private pickTarget(p: ServerPlayer, origin: Vec3, dir: Vec3, viewTick: number): number | undefined {
    let best: { pid: number; along: number } | undefined;
    for (const t of this.players.values()) {
      if (t === p || !t.alive || this.areTeammates(p, t)) continue;
      const records = this.stateOf(t).history.records();
      let at: Vec3 = t.state;
      for (let i = records.length - 1; i >= 0; i--) {
        if (records[i]!.tick <= viewTick) { at = records[i]!.position; break; }
      }
      const cx = at.x - origin.x, cy = at.y + BODY_CENTRE_Y - origin.y, cz = at.z - origin.z;
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along <= 0) continue;
      const off = Math.hypot(cx - along * dir.x, cy - along * dir.y, cz - along * dir.z);
      if (off <= TARGET_PICK_RADIUS && (!best || along < best.along)) best = { pid: t.pid, along };
    }
    return best?.pid;
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
    if (verdict.cause !== 'rejected') {
      const w = WEAPONS[p.weapon];
      if (shotUsesAmmo(w, p.mods)) p.mags.set(p.weapon, p.mag - 1);
      s.lastShotTickbase = bullet.shotTickbase;
      p.lastFireAt = now;
      p.shieldUntil = 0;
      p.weaponHeat = Math.min(3, p.weaponHeat + 0.25);
    }
    this.emitVerdict(p, verdict, target);
    if (verdict.cause === 'hit' && target && verdict.damage !== undefined) {
      this.damage(target, p, verdict.damage, verdict.hitgroup === 'head', p.weapon, bullet.aim.origin, now);
    }
  }

  /** To the shooter, the target and spectators (players not alive), plus verdict listeners. */
  private emitVerdict(shooter: ServerPlayer, v: ShotVerdict, target?: ServerPlayer): void {
    for (const fn of this.verdictListeners) fn(v);
    const to = new Set<ServerPlayer>([shooter]);
    if (target) to.add(target);
    for (const q of this.players.values()) if (!q.alive) to.add(q);
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
    s.pendingFire = null;
    s.tickbase = EMPTY_TICKBASE(this.hvhTick, this.era);
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
    s.lastShotTickbase = -Infinity;
    s.defensiveUntilTick = 0;
    s.pendingFire = null;
    s.pendingBullet = null;
  }

  protected override onPlayerLeave(player: ServerPlayer): void {
    super.onPlayerLeave(player);
    this.v2Players.delete(player.pid);
  }
}
