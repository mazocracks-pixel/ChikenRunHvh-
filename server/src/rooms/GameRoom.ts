import {
  CHAT_MAX_LENGTH,
  COINS,
  MAPS,
  MATCH,
  MAX_REWIND_MS,
  MODES,
  PLAYER,
  SIM_DT,
  SNAPSHOT_RATE,
  WEAPONS,
  WEAPON_SWITCH_MS,
  bodyScale,
  clamp,
  createCollisionWorld,
  damageAt,
  eyeHeightOf,
  fireIntervalFor,
  hopMaxFor,
  hvhPose,
  HVH,
  isWeaponId,
  makeRay,
  meleeHit,
  packPlayer,
  pelletDirections,
  pointOnRay,
  rayChicken,
  raycastPenetrating,
  raycastWorld,
  round,
  softBoxTest,
  wallbangScale,
  WALLBANG,
  shotSeed,
  shotUsesAmmo,
  spreadFor,
  stepPlayer,
  wrapAngle,
  type Appearance,
  type BlockKind,
  type BuyResult,
  type BlockState,
  type CollisionWorld,
  type FireRequest,
  type FlagState,
  type InputFrame,
  type JoinResponse,
  type KillCause,
  type MapDef,
  type MapId,
  type MatchPhase,
  type MatchState,
  type ModeDef,
  type ModeId,
  type PlayerInfo,
  type RoomInfo,
  type RoomSummary,
  type ScoreRow,
  type SpawnPoint,
  type Team,
  type ThrowRequest,
  type MeleeTarget,
  type RoundState,
  type Vec3,
  type WeaponDef,
  type WeaponId,
  type WorldSnapshot,
} from '@game/shared';
import type { GameServer, GameSocket } from '../types';
import { isFiniteNumber, isRecord, sanitizeText } from '../util';
import { BotSystem } from './BotSystem';
import { LootSystem } from './LootSystem';
import { ProjectileSystem } from './ProjectileSystem';
import { ServerPlayer } from './ServerPlayer';
import { VehicleSystem } from './VehicleSystem';

export interface RoomOptions {
  id: string;
  code: string;
  name: string;
  mode: ModeId;
  map: MapId;
  private: boolean;
  /** AI players to keep in the room. */
  bots?: number;
  /** Public quick-play rooms top themselves up with bots while few humans are around. */
  fillBots?: boolean;
}

/** What the room needs to know about a player joining (loaded from their account). */
/** Where a bot should go for the mode, and whether to hold use (E) once there. */
export interface BotGoal {
  x: number;
  z: number;
  /** Hold use here (plant / defuse) instead of walking. */
  use?: boolean;
}

export interface PlayerProfile {
  userId: number | null;
  name: string;
  appearance: Appearance;
  loadout: WeaponId[];
  bot?: boolean;
  /** Developer account: the name glows rainbow for everyone. */
  dev?: boolean;
}

export interface MatchResult {
  userId: number;
  pid: number;
  kills: number;
  deaths: number;
  won: boolean;
  coins: number;
}

export interface RoomHooks {
  /** Persist rewards; returns each user's new coin total. */
  onMatchEnd?(room: GameRoom, results: MatchResult[]): Map<number, number>;
  /** Called when the last human leaves. */
  onEmpty?(room: GameRoom): void;
}

const THROW_COOLDOWN_MS = 600;
/** Fire-rate checks allow a little jitter: packets bunch up on the way to the server. */
const FIRE_RATE_TOLERANCE = 0.8;
const KILL_SCORE = 100;
const HEADSHOT_BONUS = 25;
const SUICIDE_PENALTY = 50;

export class GameRoom {
  readonly info: RoomInfo;
  readonly mode: ModeDef;
  readonly map: MapDef;
  readonly world: CollisionWorld;
  /** Socket.IO room name for broadcasts. */
  readonly channel: string;
  readonly io: GameServer;
  readonly players = new Map<number, ServerPlayer>();
  readonly projectiles: ProjectileSystem;
  readonly loot: LootSystem;
  readonly vehicles: VehicleSystem | null;
  readonly bots: BotSystem;

  private readonly hooks: RoomHooks;
  /** Whether a collision id is a box bullets go through (wallbang). */
  protected readonly isSoft: (id: number) => boolean;
  private readonly botTarget: number | null;
  private readonly fillBots: boolean;
  private nextBotCheck = 0;
  private readonly bySocket = new Map<string, ServerPlayer>();
  private nextPid = 1;
  private match: MatchState;
  private readonly tickTimer: NodeJS.Timeout;
  private readonly snapshotTimer: NodeJS.Timeout;
  private lastTick = performance.now();
  private accumulator = 0;
  private closed = false;

  constructor(io: GameServer, options: RoomOptions, hooks: RoomHooks = {}) {
    this.io = io;
    this.hooks = hooks;
    this.mode = MODES[options.mode];
    this.map = MAPS[options.map];
    this.world = createCollisionWorld(this.map);
    this.isSoft = softBoxTest(this.map, (id) => this.blockKind(id));
    this.channel = `room:${options.id}`;
    this.info = {
      id: options.id,
      code: options.code,
      name: options.name,
      mode: options.mode,
      map: options.map,
      maxPlayers: this.mode.maxPlayers,
      private: options.private,
    };
    this.projectiles = new ProjectileSystem(this);
    this.loot = new LootSystem(this);
    this.vehicles = this.mode.vehicles && this.map.vehicles.length > 0 ? new VehicleSystem(this) : null;
    this.bots = new BotSystem(this);
    this.botTarget = options.bots && options.bots > 0 ? Math.min(options.bots, this.mode.maxPlayers - 1) : null;
    this.fillBots = options.fillBots === true;
    this.match = {
      phase: this.mode.building ? 'playing' : 'waiting',
      endsAt: null,
      teamScores: [0, 0],
      winnerTeam: 0,
      winnerPid: 0,
      mvpPid: 0,
    };
    this.tickTimer = setInterval(() => this.tick(), 1000 / 60);
    this.snapshotTimer = setInterval(() => this.broadcastSnapshot(), 1000 / SNAPSHOT_RATE);
  }

  get playerCount(): number {
    return this.players.size;
  }

  get humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.info.bot) n++;
    return n;
  }

  /** Bots step aside for humans, so only humans count towards full. */
  get isFull(): boolean {
    return this.humanCount >= this.mode.maxPlayers;
  }

  get phase(): MatchPhase {
    return this.match.phase;
  }

  summary(): RoomSummary {
    return {
      id: this.info.id,
      name: this.info.name,
      mode: this.info.mode,
      map: this.info.map,
      players: this.players.size,
      maxPlayers: this.mode.maxPlayers,
      phase: this.match.phase,
    };
  }

  playerFor(socketId: string): ServerPlayer | undefined {
    return this.bySocket.get(socketId);
  }

  areTeammates(a: ServerPlayer, b: ServerPlayer): boolean {
    return this.mode.teams && a !== b && a.info.team !== 0 && a.info.team === b.info.team;
  }

  /** Defense at the rules layer, even when an internal caller bypasses socket authorization. */
  enforceHvhRules(p: ServerPlayer): void {
    if (this.mode.id !== 'hvh') return;
    p.mods = null;
    p.frozen = false;
    for (const [id, mag] of p.mags) p.mags.set(id, Math.min(mag, WEAPONS[id].magazine));
  }

  updateHvhPose(p: ServerPlayer, now: number): void {
    if (this.mode.id !== 'hvh' || !p.hvhEnabled) return;
    const pose = hvhPose(p.lookYaw, p.hvh, now, p.lastInput?.invert === true, !p.alive || p.vehicle !== 0 || (now >= p.concealUntil && now < p.revealUntil));
    p.yaw = pose.real;
    p.fakeYaw = pose.fake;
  }

  // ---------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------

  join(socket: GameSocket | null, profile: PlayerProfile): JoinResponse {
    if (this.closed) return { ok: false, error: 'That room has closed.' };
    if (this.isFull) return { ok: false, error: 'That room is full.' };
    if (this.players.size >= this.mode.maxPlayers && !this.bots.removeOne()) return { ok: false, error: 'That room is full.' };
    if (socket && this.bySocket.has(socket.id)) return { ok: false, error: 'Already in this room.' };

    const info: PlayerInfo = {
      pid: this.nextPid++,
      name: profile.name,
      team: this.mode.teams ? this.pickTeam() : 0,
      appearance: profile.appearance,
      loadout: this.mode.weapons ? [...this.mode.weapons] : profile.loadout.length > 0 ? profile.loadout : ['pistol'],
      bot: profile.bot ?? false,
      kills: 0,
      deaths: 0,
      score: 0,
      ...(profile.dev ? { dev: true } : {}),
    };
    const player = new ServerPlayer(info, socket, profile.userId);
    const now = performance.now();
    this.spawn(player, now, false);
    this.players.set(info.pid, player);
    if (socket) {
      this.bySocket.set(socket.id, player);
      void socket.join(this.channel);
      socket.to(this.channel).emit('playerJoined', info);
    } else {
      this.io.to(this.channel).emit('playerJoined', info);
    }
    this.systemMessage(`${info.name} joined`);
    this.onPlayerJoin(player, now);
    this.updateMatch(now);

    const { projectiles, smokes } = this.projectiles.joinState(now);
    return {
      ok: true,
      selfPid: info.pid,
      room: this.info,
      players: [...this.players.values()].map((p) => p.info),
      snapshot: this.snapshot(now),
      match: this.match,
      loot: this.loot.states(),
      drops: this.loot.dropStates(),
      projectiles,
      smokes,
      blocks: [],
      flags: [],
      round: null,
      money: 0,
      ...this.joinExtras(player),
    };
  }

  /** Kind of a Sandbox block by id (only the Sandbox room has blocks). */
  protected blockKind(_blockId: number): BlockKind | undefined {
    return undefined;
  }

  /** Mode-specific state for players joining mid-match (blocks, flags, the bomb round). */
  protected joinExtras(_player: ServerPlayer): Partial<{ blocks: BlockState[]; flags: FlagState[]; round: RoundState | null; money: number }> {
    return {};
  }

  /** Hook for mode rules about a player who just joined (ChikenBomb: wait for the next round). */
  protected onPlayerJoin(_player: ServerPlayer, _now: number): void {}

  /** What a bot should go and do for the mode (ChikenBomb: plant / defuse), or null to just roam and fight. */
  botGoal(_p: ServerPlayer): BotGoal | null {
    return null;
  }

  /** ChikenBomb buy menu; nothing to buy anywhere else. */
  handleBuy(p: ServerPlayer, _itemId: unknown): BuyResult {
    return { ok: false, error: 'There is no buy menu in this mode.', money: p.money };
  }

  /** Shooting and throwing are off (ChikenBomb buy time). */
  protected actionsBlocked(): boolean {
    return false;
  }

  leave(socketId: string): void {
    const player = this.bySocket.get(socketId);
    if (!player) return;
    this.bySocket.delete(socketId);
    void player.socket?.leave(this.channel);
    this.removePlayer(player);
  }

  removePlayer(player: ServerPlayer): void {
    if (!this.players.has(player.pid)) return;
    this.vehicles?.eject(player);
    this.onPlayerLeave(player);
    this.players.delete(player.pid);
    this.bots.forget(player.pid);
    this.io.to(this.channel).emit('playerLeft', player.pid);
    this.systemMessage(`${player.info.name} left`);
    this.emitScores();
    this.updateMatch(performance.now());
    if (this.humanCount === 0) this.hooks.onEmpty?.(this);
  }

  close(reason = 'Room closed'): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tickTimer);
    clearInterval(this.snapshotTimer);
    this.io.to(this.channel).emit('roomClosed', reason);
    for (const p of this.players.values()) void p.socket?.leave(this.channel);
    this.players.clear();
    this.bySocket.clear();
  }

  private pickTeam(): 1 | 2 {
    let red = 0;
    let blue = 0;
    for (const p of this.players.values()) {
      if (p.info.team === 1) red++;
      else if (p.info.team === 2) blue++;
    }
    if (red !== blue) return red < blue ? 1 : 2;
    const [rs, bs] = this.match.teamScores;
    if (rs !== bs) return rs < bs ? 1 : 2;
    return Math.random() < 0.5 ? 1 : 2;
  }

  // ---------------------------------------------------------------------------
  // Client messages
  // ---------------------------------------------------------------------------

  handleInput(p: ServerPlayer, raw: unknown): void {
    this.enforceHvhRules(p);
    const frame = parseInput(raw);
    if (!frame || frame.seq <= p.lastSeq) return;
    if (!p.takeInputToken(performance.now())) return; // over budget: the client's reconciliation corrects it

    p.lastSeq = frame.seq;
    p.useHeld = frame.use === true;
    p.yaw = frame.yaw;
    p.lookYaw = frame.yaw;
    p.pitch = frame.pitch;
    p.lastInput = frame;
    this.updateHvhPose(p, performance.now());
    // Dead chickens don't move, but we still acknowledge the input so the client can drop it.
    if (!p.alive || p.frozen) return;
    if (p.vehicle && this.vehicles) {
      this.vehicles.drive(p, frame);
      return;
    }
    stepPlayer(p.state, frame, SIM_DT, this.world, p.mods, hopMaxFor(p.weapon));
  }

  handleFire(p: ServerPlayer, raw: unknown): void {
    this.enforceHvhRules(p);
    const req = parseFire(raw);
    if (!req || !p.alive || p.vehicle || this.match.phase === 'ended' || this.actionsBlocked()) return;
    if (req.shot <= p.lastShotSeq || req.weapon !== p.weapon) return;
    const w = WEAPONS[req.weapon];
    const now = performance.now();
    const mods = p.mods;
    if (now < p.switchReadyAt || p.reloadUntil > 0 || p.mag <= 0) return;
    const interval = this.mode.id === 'hvh' && p.hvhEnabled ? p.exploit.interval(w, p.hvh.exploit, now) : fireIntervalFor(w, mods);
    const burst = this.mode.id === 'hvh' && p.hvhEnabled && p.hvh.exploit === 'doubleTap' && p.exploit.burst && now <= p.exploit.burstUntil;
    if (now - p.lastFireAt < interval * (burst ? 1 : FIRE_RATE_TOLERANCE)) return;

    p.lastShotSeq = req.shot;
    p.lastFireAt = now;
    if (shotUsesAmmo(w, mods)) p.mags.set(req.weapon, p.mag - 1);
    p.shieldUntil = 0;
    p.aiming = req.aiming;
    if (this.mode.id === 'hvh' && p.hvhEnabled) {
      const hidden = p.exploit.fired(w, p.hvh.exploit, now);
      p.concealUntil = hidden ? now + HVH.hideMs : 0;
      p.revealUntil = now + HVH.revealMs + (hidden ? HVH.hideMs : 0);
      this.updateHvhPose(p, now);
    }

    const eye = { x: p.state.x, y: p.state.y + eyeHeightOf(p.state), z: p.state.z };
    const len = Math.hypot(req.dx, req.dy, req.dz);
    const aim = { x: req.dx / len, y: req.dy / len, z: req.dz / len };

    if (w.projectile) {
      this.projectiles.launch(w.projectile, p, this.safeLaunchPoint(eye, aim), aim, req.shot, now, mods?.projectileSpeed ?? 1);
      this.io.to(this.channel).emit('shot', { pid: p.pid, weapon: req.weapon, ox: eye.x, oy: eye.y, oz: eye.z, ends: [], hits: [] });
      return;
    }
    const rewindTo = clamp(req.t, now - MAX_REWIND_MS, now);
    if (w.melee) {
      this.swing(p, w, eye, aim, rewindTo, now);
      return;
    }

    const spread = spreadFor(w, p.moving, !p.state.onGround, req.aiming) * (mods?.spread ?? 1);
    const dirs = pelletDirections(w, aim, spread, shotSeed(p.pid, req.shot));
    const targets = this.targetsAt(p, rewindTo);

    const ends: number[] = [];
    const hits: number[] = [];
    const damageByVictim = new Map<ServerPlayer, { amount: number; headshot: boolean }>();
    for (const d of dirs) {
      const ray = makeRay(eye, d);
      // Wallbang: crates, hay and wood don't stop bullets, they just weaken them.
      const { soft, wall } = raycastPenetrating(ray, this.world, w.range, this.isSoft, this.mode.wallbang ? WALLBANG.maxBoxes : 0);
      let maxT = wall ? wall.t : w.range;
      let kind = 0;
      let victim: ServerPlayer | null = null;
      let headshot = false;

      for (const t of targets) {
        const hit = rayChicken(ray, t.x, t.y, t.z, t.yaw, maxT, t.scale);
        if (hit) {
          maxT = hit.t;
          victim = t.key;
          headshot = hit.headshot;
          kind = hit.headshot ? 2 : 1;
        }
      }
      const box = this.loot.raycast(ray, maxT);
      if (box) {
        maxT = box.t;
        victim = null;
        kind = 0;
        this.loot.smash(box.id, now);
      }
      const car = this.vehicles?.raycast(ray, maxT);
      if (car) {
        maxT = car.t;
        victim = null;
        kind = 0;
        this.vehicles!.damage(car.id, damageAt(w, car.t) * wallbangScale(soft, car.t), p, now);
      }

      if (victim) {
        const entry = damageByVictim.get(victim) ?? { amount: 0, headshot: false };
        entry.amount += damageAt(w, maxT) * (headshot ? w.headshotMultiplier : 1) * wallbangScale(soft, maxT);
        entry.headshot ||= headshot;
        damageByVictim.set(victim, entry);
      }
      const end = pointOnRay(ray, maxT);
      ends.push(round(end.x, 2), round(end.y, 2), round(end.z, 2));
      hits.push(kind);
    }

    this.io.to(this.channel).emit('shot', {
      pid: p.pid,
      weapon: req.weapon,
      ox: round(eye.x, 2),
      oy: round(eye.y, 2),
      oz: round(eye.z, 2),
      ends,
      hits,
    });
    for (const [victim, { amount, headshot }] of damageByVictim) this.damage(victim, p, amount, headshot, req.weapon, eye, now);
  }

  /** Every enemy `p` could hit, where they were at `rewindTo` (lag compensation). */
  private targetsAt(p: ServerPlayer, rewindTo: number): MeleeTarget<ServerPlayer>[] {
    const targets: MeleeTarget<ServerPlayer>[] = [];
    for (const t of this.players.values()) {
      if (t === p || !t.alive || t.vehicle || this.areTeammates(p, t)) continue;
      const past = t.history.at(rewindTo);
      if (past && !past.alive) continue;
      targets.push({ key: t, x: past?.x ?? t.state.x, y: past?.y ?? t.state.y, z: past?.z ?? t.state.z, yaw: past?.yaw ?? t.yaw, scale: past?.scale ?? bodyScale(t.state) });
    }
    return targets;
  }

  /** A melee swing: hits the chicken in front (see meleeHit), or smashes a loot box in reach. */
  private swing(p: ServerPlayer, w: WeaponDef, eye: Vec3, aim: Vec3, rewindTo: number, now: number): void {
    const hit = meleeHit(eye, aim, w, this.targetsAt(p, rewindTo), this.world);
    if (!hit) {
      const box = this.loot.raycast(makeRay(eye, aim), w.range);
      if (box) this.loot.smash(box.id, now);
    }
    this.io.to(this.channel).emit('shot', {
      pid: p.pid,
      weapon: w.id,
      ox: round(eye.x, 2),
      oy: round(eye.y, 2),
      oz: round(eye.z, 2),
      ends: hit ? [round(hit.point.x, 2), round(hit.point.y, 2), round(hit.point.z, 2)] : [],
      hits: hit ? [hit.headshot ? 2 : 1] : [],
    });
    if (hit) this.damage(hit.key, p, w.damage * (hit.headshot ? w.headshotMultiplier : 1), hit.headshot, w.id, eye, now);
  }

  handleReload(p: ServerPlayer): void {
    this.enforceHvhRules(p);
    const w = WEAPONS[p.weapon];
    if (!p.alive || p.reloadUntil > 0 || p.mag >= p.magazineSize(w.id)) return;
    p.reloadUntil = performance.now() + (p.mods?.instantReload ? 0.001 : w.reloadTime);
    p.aiming = false;
  }

  handleSwitch(p: ServerPlayer, slot: unknown): void {
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= p.info.loadout.length) return;
    if (slot === p.weaponSlot) return;
    p.weaponSlot = slot as number;
    p.reloadUntil = 0;
    p.aiming = false;
    p.switchReadyAt = performance.now() + WEAPON_SWITCH_MS;
  }

  handleAim(p: ServerPlayer, aiming: unknown): void {
    if (typeof aiming === 'boolean') p.aiming = aiming && p.alive;
  }

  handleThrow(p: ServerPlayer, raw: unknown): void {
    const req = parseThrow(raw);
    const now = performance.now();
    if (!req || !p.alive || p.vehicle || this.match.phase === 'ended' || this.actionsBlocked() || req.seq <= p.lastThrowSeq || now < p.nextThrowAt) return;
    if (req.kind === 'egg' ? p.eggs <= 0 : p.smokes <= 0) return;
    if (req.kind === 'egg') p.eggs--;
    else p.smokes--;
    p.lastThrowSeq = req.seq;
    p.nextThrowAt = now + THROW_COOLDOWN_MS;
    p.shieldUntil = 0;
    const eye = { x: p.state.x, y: p.state.y + eyeHeightOf(p.state), z: p.state.z };
    const dir = { x: req.dx, y: req.dy, z: req.dz };
    this.projectiles.launch(req.kind, p, this.safeLaunchPoint(eye, dir), dir, req.seq, now);
  }

  /** Enter or leave the nearest vehicle (rooms with vehicles override this). */
  handleUseVehicle(p: ServerPlayer): void {
    this.vehicles?.use(p);
  }

  /** Sandbox building (the Sandbox room overrides these). */
  handleBuild(_p: ServerPlayer, _raw: unknown): void {}
  handleUnbuild(_p: ServerPlayer, _raw: unknown): void {}

  handleChat(p: ServerPlayer, raw: unknown): void {
    const text = sanitizeText(raw, CHAT_MAX_LENGTH);
    if (!text || !p.chatLimiter.take()) return;
    this.io.to(this.channel).emit('chat', { pid: p.pid, name: p.info.name, text, team: p.info.team, ...(p.info.dev ? { dev: true } : {}) });
  }

  /** Throws start half a metre in front of the eye, unless a wall is right there. */
  private safeLaunchPoint(eye: Vec3, dir: Vec3): Vec3 {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const wall = raycastWorld(makeRay(eye, d), this.world, 0.6);
    const dist = wall ? Math.max(0, wall.t - 0.2) : 0.5;
    return { x: eye.x + d.x * dist, y: eye.y + d.y * dist, z: eye.z + d.z * dist };
  }

  // ---------------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------------

  /** Applies damage (armor first), reports it to both sides, and kills when health runs out. */
  damage(victim: ServerPlayer, attacker: ServerPlayer | null, amount: number, headshot: boolean, cause: KillCause, from: Vec3, now: number): void {
    this.enforceHvhRules(victim);
    if (attacker) this.enforceHvhRules(attacker);
    if (!victim.alive || amount <= 0 || this.match.phase === 'ended') return;
    if (now < victim.shieldUntil) return;
    if (attacker && this.areTeammates(attacker, victim)) return;
    if (cause === 'rocket' && victim.mods?.noRocketDamage) return;
    // Developer damage multiplier (bullets, rockets, eggs, buggies alike).
    if (attacker?.mods) amount *= attacker.mods.damage;
    if (amount <= 0) return;

    let remaining = amount;
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, remaining * PLAYER.armorAbsorb);
      victim.armor -= absorbed;
      remaining -= absorbed;
    }
    victim.hp -= remaining;

    const event = {
      victim: victim.pid,
      attacker: attacker?.pid ?? 0,
      amount: Math.round(amount),
      hp: Math.max(0, Math.ceil(victim.hp)),
      armor: Math.ceil(victim.armor),
      headshot,
      fromX: round(from.x, 1),
      fromZ: round(from.z, 1),
    };
    victim.socket?.emit('damage', event);
    if (attacker && attacker !== victim) attacker.socket?.emit('damage', event);

    if (victim.hp <= 0) this.kill(victim, attacker, cause, headshot, now);
  }

  protected kill(victim: ServerPlayer, attacker: ServerPlayer | null, cause: KillCause, headshot: boolean, now: number): void {
    victim.alive = false;
    victim.hp = 0;
    victim.reloadUntil = 0;
    victim.aiming = false;
    victim.respawnAt = now + this.mode.respawnMs;
    this.onPlayerDeath(victim, now);
    this.onKill(victim, attacker, cause, now);

    const scoring = this.match.phase === 'playing' && !this.mode.building;
    if (scoring) {
      victim.info.deaths++;
      if (attacker && attacker !== victim) {
        attacker.info.kills++;
        attacker.info.score += KILL_SCORE + (headshot ? HEADSHOT_BONUS : 0);
        if (this.mode.teams && this.mode.teamKills && attacker.info.team !== 0) this.match.teamScores[attacker.info.team - 1]++;
      } else {
        victim.info.score = Math.max(0, victim.info.score - SUICIDE_PENALTY);
      }
    }

    this.io.to(this.channel).emit('kill', { killer: attacker?.pid ?? 0, victim: victim.pid, cause, headshot });
    // Every kill leaves a random bonus where the victim fell (not in buy-menu modes).
    if (!this.mode.noDrops) this.loot.dropBonus({ x: victim.state.x, y: victim.state.y, z: victim.state.z }, now);
    if (scoring) {
      this.emitScores();
      this.checkScoreLimit(now);
    }
  }

  /** Hook for systems that care about deaths (dropping a carried flag, leaving a vehicle). */
  protected onPlayerDeath(victim: ServerPlayer, _now: number): void {
    this.vehicles?.eject(victim);
  }

  /** Hook for kill rewards (ChikenBomb money). Runs after onPlayerDeath. */
  protected onKill(_victim: ServerPlayer, _attacker: ServerPlayer | null, _cause: KillCause, _now: number): void {}

  /** Hook for systems that care about a player leaving the room (CTF drops the flag). */
  protected onPlayerLeave(_player: ServerPlayer): void {}

  /** Hook for systems hit by explosions other than players and loot (vehicles). */
  onBlast(centre: Vec3, radius: number, damage: number, owner: ServerPlayer | null, now: number): void {
    this.vehicles?.blast(centre, radius, damage, owner, now);
  }

  /** Puts a player back at a spawn point right away (developer tools). */
  respawnPlayer(p: ServerPlayer, now: number): void {
    this.vehicles?.eject(p);
    this.spawn(p, now, true);
  }

  /** Tells everyone a player's info changed (e.g. their loadout). */
  announcePlayer(p: ServerPlayer): void {
    this.io.to(this.channel).emit('playerUpdated', p.info);
  }

  protected spawn(p: ServerPlayer, now: number, announce: boolean): void {
    this.enforceHvhRules(p);
    const point = this.pickSpawn(p);
    p.respawn(point.x, point.z, Math.atan2(point.x, point.z), now);
    // Weapon-restricted modes (Knife Fight) have no grenades either.
    if (this.mode.weapons) p.eggs = p.smokes = 0;
    if (announce) this.io.to(this.channel).emit('spawn', { pid: p.pid, x: point.x, y: 0, z: point.z, yaw: p.yaw });
  }

  /** Team spawns in team modes; otherwise the free spot furthest from living enemies. */
  private pickSpawn(p: ServerPlayer): SpawnPoint {
    const all = this.map.spawns;
    const team = p.info.team;
    const pool = this.mode.teams && team !== 0 ? all.filter((s) => s.team === team) : all;
    let best = pool[0] ?? all[0]!;
    let bestScore = -Infinity;
    for (const spawn of pool) {
      let nearest = 1000;
      for (const other of this.players.values()) {
        if (other === p || !other.alive || this.areTeammates(p, other)) continue;
        nearest = Math.min(nearest, Math.hypot(other.state.x - spawn.x, other.state.z - spawn.z));
      }
      // Never on top of someone already standing there (a whole team spawns at once in rounds).
      let taken = false;
      for (const other of this.players.values()) {
        if (other !== p && other.alive && Math.hypot(other.state.x - spawn.x, other.state.z - spawn.z) < PLAYER.radius * 3) taken = true;
      }
      const score = nearest + Math.random() * 4 - (taken ? 1000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = spawn;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Match flow
  // ---------------------------------------------------------------------------

  private updateMatch(now: number): void {
    if (this.mode.building || this.closed) return;
    const m = this.match;
    const enough = this.players.size >= this.mode.minPlayers;
    switch (m.phase) {
      case 'waiting':
        if (enough) this.setPhase('countdown', now + MATCH.countdownMs);
        break;
      case 'countdown':
        if (!enough) this.setPhase('waiting', null);
        else if (now >= (m.endsAt ?? 0)) this.startMatch(now);
        break;
      case 'playing':
        if (!enough) this.setPhase('waiting', null);
        else if (m.endsAt !== null && now >= m.endsAt) this.endMatch(now);
        break;
      case 'ended':
        if (now >= (m.endsAt ?? 0)) {
          if (enough) this.startMatch(now);
          else this.setPhase('waiting', null);
        }
        break;
    }
  }

  /** Skips waiting/countdown (private-room hosts, tests). */
  startNow(): void {
    if (!this.mode.building) this.startMatch(performance.now());
  }

  private setPhase(phase: MatchPhase, endsAt: number | null): void {
    this.match = { ...this.match, phase, endsAt };
    this.io.to(this.channel).emit('match', this.match);
  }

  private startMatch(now: number): void {
    for (const p of this.players.values()) {
      p.info.kills = 0;
      p.info.deaths = 0;
      p.info.score = 0;
      this.spawn(p, now, true);
    }
    this.projectiles.clear();
    this.vehicles?.reset();
    this.loot.reset();
    for (const state of this.loot.states()) this.io.to(this.channel).emit('loot', state);
    this.onMatchStart(now);
    this.match = {
      phase: 'playing',
      endsAt: this.mode.timeLimitMs > 0 ? now + this.mode.timeLimitMs : null,
      teamScores: [0, 0],
      winnerTeam: 0,
      winnerPid: 0,
      mvpPid: 0,
    };
    this.io.to(this.channel).emit('match', this.match);
    this.emitScores();
  }

  /** Hook for mode systems to reset their state at the start of a match. */
  protected onMatchStart(_now: number): void {}

  protected checkScoreLimit(now: number): void {
    const limit = this.mode.scoreLimit;
    if (limit <= 0 || this.match.phase !== 'playing') return;
    const reached = this.mode.teams
      ? this.match.teamScores.some((s) => s >= limit)
      : [...this.players.values()].some((p) => p.info.kills >= limit);
    if (reached) this.endMatch(now);
  }

  protected addTeamScore(team: Team, amount: number): void {
    if (team === 0) return;
    this.match.teamScores[team - 1] += amount;
    this.emitScores();
  }

  private endMatch(now: number): void {
    const players = [...this.players.values()];
    const byScore = [...players].sort((a, b) => b.info.score - a.info.score || b.info.kills - a.info.kills);
    let winnerTeam: Team = 0;
    let winnerPid = 0;
    if (this.mode.teams) {
      const [red, blue] = this.match.teamScores;
      winnerTeam = red === blue ? 0 : red > blue ? 1 : 2;
    } else {
      const byKills = [...players].sort((a, b) => b.info.kills - a.info.kills || b.info.score - a.info.score);
      const top = byKills[0];
      if (top && top.info.kills > 0 && top.info.kills !== byKills[1]?.info.kills) winnerPid = top.pid;
    }
    this.match = {
      phase: 'ended',
      endsAt: now + MATCH.resultsMs,
      teamScores: this.match.teamScores,
      winnerTeam,
      winnerPid,
      mvpPid: byScore[0] && byScore[0].info.score > 0 ? byScore[0].pid : 0,
    };
    this.projectiles.clear();
    this.io.to(this.channel).emit('match', this.match);
    this.awardCoins(players);
  }

  private awardCoins(players: ServerPlayer[]): void {
    const results: MatchResult[] = [];
    for (const p of players) {
      if (p.userId === null) continue;
      const won = this.mode.teams ? p.info.team === this.match.winnerTeam && p.info.team !== 0 : p.pid === this.match.winnerPid;
      const coins = Math.min(COINS.max, COINS.perMatch + COINS.perKill * p.info.kills + (won ? COINS.win : 0));
      results.push({ userId: p.userId, pid: p.pid, kills: p.info.kills, deaths: p.info.deaths, won, coins });
    }
    if (results.length === 0 || !this.hooks.onMatchEnd) return;
    const totals = this.hooks.onMatchEnd(this, results);
    for (const r of results) {
      const total = totals.get(r.userId);
      if (total === undefined) continue;
      this.players.get(r.pid)?.socket?.emit('reward', { coins: r.coins, total, kills: r.kills, won: r.won });
    }
  }

  emitScores(): void {
    const rows: ScoreRow[] = [...this.players.values()].map((p) => [p.pid, p.info.kills, p.info.deaths, p.info.score]);
    this.io.to(this.channel).emit('scores', { rows, teamScores: this.match.teamScores });
  }

  systemMessage(text: string): void {
    this.io.to(this.channel).emit('chat', { pid: 0, name: '', text, team: 0 });
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private tick(): void {
    const now = performance.now();
    this.accumulator += now - this.lastTick;
    this.lastTick = now;
    let steps = 0;
    while (this.accumulator >= SIM_DT * 1000 && steps < 4) {
      this.fixedUpdate(now);
      this.accumulator -= SIM_DT * 1000;
      steps++;
    }
    // Way behind (e.g. the process was suspended): drop the backlog instead of fast-forwarding.
    if (steps === 4) this.accumulator = 0;
  }

  protected fixedUpdate(now: number): void {
    for (const p of this.players.values()) {
      this.enforceHvhRules(p);
      this.updateHvhPose(p, now);
      p.history.push({ t: now, x: p.state.x, y: p.state.y, z: p.state.z, yaw: p.yaw, alive: p.alive, scale: bodyScale(p.state) });
      if (p.reloadUntil > 0 && now >= p.reloadUntil) {
        p.reloadUntil = 0;
        p.mags.set(p.weapon, p.magazineSize(p.weapon));
      }
      if (!p.alive && now >= p.respawnAt && this.match.phase !== 'ended') this.spawn(p, now, true);
    }
    this.maintainBots(now);
    this.bots.update(now);
    this.vehicles?.update(now);
    this.projectiles.update(now);
    this.loot.update(now);
    this.updateMatch(now);
  }

  /** Keeps the bot count on target: fixed for practice rooms, filling empty seats in public ones. */
  private maintainBots(now: number): void {
    if (now < this.nextBotCheck || this.closed || this.humanCount === 0) return;
    this.nextBotCheck = now + 1000;
    let wanted = 0;
    if (this.botTarget !== null) wanted = this.botTarget;
    else if (this.fillBots && !this.mode.building) wanted = Math.max(0, (this.mode.fillBots ?? (this.mode.maxPlayers === 2 ? 2 : 4)) - this.humanCount);
    wanted = Math.min(wanted, this.mode.maxPlayers - this.humanCount);
    // Fill all empty seats at once; leave one at a time so a match doesn't empty out suddenly.
    while (this.bots.count < wanted && this.bots.add());
    if (this.bots.count > wanted) this.bots.removeOne();
  }

  snapshot(now = performance.now()): WorldSnapshot {
    return { t: now, p: [...this.players.values()].map((p) => packPlayer(p.toState())), v: this.vehicles?.packed() ?? [] };
  }

  private broadcastSnapshot(): void {
    if (this.players.size === 0) return;
    this.io.to(this.channel).volatile.emit('snapshot', this.snapshot());
  }
}

// ---------------------------------------------------------------------------
// Validation of untrusted client messages
// ---------------------------------------------------------------------------

function parseInput(raw: unknown): InputFrame | null {
  if (!isRecord(raw)) return null;
  const { seq, forward, right, jump, yaw, pitch } = raw;
  if (!Number.isSafeInteger(seq) || !isFiniteNumber(forward) || !isFiniteNumber(right) || !isFiniteNumber(yaw)) return null;
  if (typeof jump !== 'boolean') return null;
  return {
    seq: seq as number,
    forward: clamp(forward, -1, 1),
    right: clamp(right, -1, 1),
    jump,
    yaw: wrapAngle(yaw),
    pitch: isFiniteNumber(pitch) ? clamp(pitch, -1.5, 1.5) : 0,
    crouch: raw.crouch === true,
    use: raw.use === true,
    invert: raw.invert === true,
  };
}

function parseFire(raw: unknown): FireRequest | null {
  if (!isRecord(raw)) return null;
  const { shot, weapon, dx, dy, dz, t, aiming } = raw;
  if (!Number.isSafeInteger(shot) || !isWeaponId(weapon)) return null;
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy) || !isFiniteNumber(dz) || !isFiniteNumber(t)) return null;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5 || len > 1.5) return null;
  return { shot: shot as number, weapon, dx, dy, dz, t, aiming: aiming === true };
}

function parseThrow(raw: unknown): ThrowRequest | null {
  if (!isRecord(raw)) return null;
  const { kind, seq, dx, dy, dz } = raw;
  if ((kind !== 'egg' && kind !== 'smoke') || !Number.isSafeInteger(seq)) return null;
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy) || !isFiniteNumber(dz)) return null;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5 || len > 1.5) return null;
  return { kind, seq: seq as number, dx: dx / len, dy: dy / len, dz: dz / len };
}
