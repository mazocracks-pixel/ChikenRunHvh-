import * as THREE from 'three';
import {
  BLOCK_ID_BASE,
  BLOCK_KINDS,
  BLOCK_SIZE,
  BUILD_RANGE,
  CROUCH,
  INTERP_DELAY_MS,
  MODES,
  PLAYER,
  PROJECTILES,
  SIM_DT,
  TEAM_NAMES,
  WEAPONS,
  blockAabb,
  cellOf,
  createCollisionWorld,
  eyeHeightOf,
  hopMaxFor,
  heightOf,
  getItem,
  makeRay,
  meleeHit,
  normalize,
  pelletDirections,
  pointOnRay,
  rayChicken,
  raycastPenetrating,
  raycastWorld,
  softBoxTest,
  WALLBANG,
  shotSeed,
  spreadFor,
  unpackPlayer,
  unpackVehicle,
  wrapAngle,
  type BlockState,
  type ChatMessage,
  type CollisionWorld,
  type DamageEvent,
  type ExplosionEvent,
  type FlagEvent,
  type InputFrame,
  type MeleeTarget,
  type JoinSuccess,
  type KillCause,
  type KillEvent,
  type LootState,
  type MatchRewardEvent,
  type MatchState,
  type ModeDef,
  type PickupEvent,
  type PlayerInfo,
  type ProjectileSpawn,
  type RayHit,
  type RoomInfo,
  type ScoresEvent,
  type ServerToClientEvents,
  type ShotEvent,
  type SmokeEvent,
  type SpawnEvent,
  type Vec3,
  type WorldSnapshot,
} from '@game/shared';
import type { Network } from '../net/Network';
import { getSettings } from '../settings';
import type { Hud, ScoreLine } from '../ui/Hud';
import type { AudioEngine } from './Audio';
import { Blocks } from './Blocks';
import { CameraRig, zoomLookScale } from './CameraRig';
import { Effects } from './Effects';
import { Flags } from './Flags';
import type { Action, Input } from './Input';
import { LocalPlayer } from './LocalPlayer';
import { LootView } from './LootView';
import { ClientProjectiles } from './Projectiles';
import { RemotePlayers, type RemotePlayer } from './RemotePlayers';
import { Vehicles } from './Vehicles';
import { ViewModel } from './ViewModel';
import { WeaponController } from './WeaponController';
import type { World } from './World';

/** How strongly each snapshot nudges the server-clock estimate (lower = smoother, slower to adapt). */
const CLOCK_SMOOTHING = 0.05;
const HUD_INTERVAL = 1 / 15;
const AIM_RANGE = 250;
const PICKUP_TEXT: Record<string, string> = { medkit: '+50 Health', armor: '+50 Armor', fuel: 'Jetpack fuel!', eggs: '+2 Explosive eggs' };

export interface SessionContext {
  scene: THREE.Scene;
  /** Drawn on top of the world (the first-person gun). */
  overlay: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  input: Input;
  net: Network;
  audio: AudioEngine;
  hud: Hud;
  join: JoinSuccess;
  /** Coins changed (match reward). */
  onCoins: (total: number) => void;
  /** The server closed the room. */
  onClosed: (reason: string) => void;
  /** Developer tools, if loaded. */
  dev?: DevHooks;
}

/** How the developer system plugs into a match. Every hook is optional behaviour on top of normal play. */
export interface DevHooks {
  attach(session: GameSession): void;
  detach(session: GameSession): void;
  /** Start of every frame (aim assist, triggers). */
  beforeFrame(session: GameSession, dt: number, now: number): void;
  /** Adjust an input frame before it is predicted and sent (movement helpers, free camera). */
  modifyFrame(session: GameSession, frame: InputFrame): InputFrame;
  /** Extra trigger pull (trigger assist, auto fire). */
  wantsFire(): boolean;
  /** Replacement shot direction from the eye (aim lock), or null. */
  aimOverride(session: GameSession, eye: Vec3): Vec3 | null;
  /** Multiplier on camera recoil. */
  recoilScale(): number;
  /** No shooting while flying a free camera or spectating. */
  blocksShooting(): boolean;
  /** Free camera / spectating: return true if the camera was placed by the developer system. */
  controlCamera(session: GameSession, dt: number): boolean;
  /** End of every frame (overlays). */
  afterFrame(session: GameSession, dt: number): void;
  /** How your own chicken is drawn (spin bot), or null to face where you look. */
  bodyAngles(): { yaw: number; pitch: number } | null;
  /** Developer wallhack silhouette for a player, or null when the developer wallhack is off. */
  xrayFor(session: GameSession, player: RemotePlayer): THREE.Material | null;
}

/** HvH: everyone sees enemies through walls as a red silhouette. */
const HVH_XRAY = new THREE.MeshBasicMaterial({ color: 0xff3b4e, opacity: 0.6, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });

/** Everything that exists only while in a room. Created on join, disposed on leave. */
export class GameSession {
  readonly room: RoomInfo;
  readonly selfPid: number;
  readonly mode: ModeDef;

  private readonly ctx: SessionContext;
  // Public (read-only) for the developer tools.
  readonly infos = new Map<number, PlayerInfo>();
  readonly local: LocalPlayer;
  readonly remotes: RemotePlayers;
  readonly rig: CameraRig;
  private readonly effects: Effects;
  readonly projectiles: ClientProjectiles;
  readonly loot: LootView;
  readonly weapons: WeaponController;
  /** This session's own collision data (Sandbox blocks get added to it). */
  readonly collision: CollisionWorld;
  readonly vehicles: Vehicles;
  private readonly blocks: Blocks | null;
  readonly flags: Flags | null;
  /** Boxes bullets go through (wallbang), and how many per bullet in this mode. */
  private readonly isSoft: (id: number) => boolean;
  private readonly wallbangBoxes: number;
  private building = false;
  private blockIndex = 0;
  private fireWasDown = false;
  private aimWasDown = false;
  private readonly handlers: [keyof ServerToClientEvents, (...args: never[]) => void][] = [];

  private match: MatchState;
  private teamScores: [number, number] = [0, 0];
  private accumulator = 0;
  private nextSeq = 1;
  private throwSeq = 0;
  /** Estimated (server clock − performance.now()), in ms. */
  private clockOffset = 0;
  private hasClock = false;
  private aimingSent = false;
  private chatOpen = false;
  private hudTimer = 0;
  private lastJetFx = 0;
  private wasOnGround = true;
  private deathPos: THREE.Vector3 | null = null;
  private respawnAt = 0;
  private lastResultsKey = '';
  /** First-person gun, attached to the camera. */
  private readonly viewmodel: ViewModel;
  private readonly lastViewPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
    const { join } = ctx;
    this.room = join.room;
    this.selfPid = join.selfPid;
    this.mode = MODES[join.room.mode];
    this.match = join.match;
    this.teamScores = join.match.teamScores;
    for (const p of join.players) this.infos.set(p.pid, p);

    const mePacked = join.snapshot.p.find((p) => p[0] === join.selfPid);
    const meInfo = this.infos.get(join.selfPid);
    if (!mePacked || !meInfo) throw new Error('Join response did not include the local player');
    const me = unpackPlayer(mePacked);

    this.collision = createCollisionWorld(ctx.world.map);
    this.effects = new Effects(ctx.scene);
    this.vehicles = new Vehicles(ctx.scene);
    this.blocks = this.mode.building ? new Blocks(ctx.scene, this.collision) : null;
    for (const b of join.blocks) this.blocks?.add(b);
    this.flags = this.mode.id === 'ctf' ? new Flags(ctx.scene, ctx.world.map, join.flags) : null;
    this.isSoft = softBoxTest(ctx.world.map, (id) => this.blocks?.kindOf(id));
    this.wallbangBoxes = this.mode.wallbang ? WALLBANG.maxBoxes : 0;
    this.local = new LocalPlayer(ctx.scene, meInfo, me);
    this.remotes = new RemotePlayers(ctx.scene);
    this.rig = new CameraRig(ctx.camera, this.collision);
    this.projectiles = new ClientProjectiles(ctx.scene, this.collision, this.effects);
    this.loot = new LootView(ctx.scene, ctx.world.map, this.effects);
    this.loot.setAll(join.loot);
    for (const d of join.drops) this.loot.addDrop(d, false);
    this.loot.onBreak = (at) => ctx.audio.play('boxBreak', at);
    this.weapons = new WeaponController(meInfo.loadout);
    this.viewmodel = new ViewModel(ctx.overlay);
    ctx.input.yaw = me.yaw;
    ctx.input.pitch = -0.15;

    for (const info of join.players) if (info.pid !== this.selfPid) this.remotes.add(info, this.isFriendly(info));
    this.onSnapshot(join.snapshot);
    for (const p of join.projectiles) this.projectiles.spawn(p, this.selfPid, 0);
    for (const s of join.smokes) this.onSmoke(s);

    ctx.hud.setRoom(join.room);
    ctx.hud.setVisible(true);
    if (this.mode.wallhack) ctx.hud.toast('HvH: everyone sees enemies through walls', 'bad');
    this.refreshScores();
    this.bindNetwork();
    this.bindChat();
    ctx.dev?.attach(this);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.ctx.camera;
  }

  get map() {
    return this.ctx.world.map;
  }

  get playerCount(): number {
    return this.infos.size;
  }

  get self(): PlayerInfo {
    return this.infos.get(this.selfPid)!;
  }

  serverNow(): number {
    return performance.now() + this.clockOffset;
  }

  isFriendly(info: PlayerInfo): boolean {
    return this.mode.teams && info.team !== 0 && info.team === this.self?.team;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, fps: number): void {
    const { input, net, audio, hud } = this.ctx;
    const now = performance.now();

    for (const action of input.consumeActions()) this.handleAction(action, now);
    const dev = this.ctx.dev;
    dev?.beforeFrame(this, dt, now);

    // Fixed-timestep simulation: the same tick size the server uses, independent of frame rate.
    this.accumulator += dt;
    while (this.accumulator >= SIM_DT) {
      this.accumulator -= SIM_DT;
      if (!this.local.alive) continue;
      let frame = input.sample(this.nextSeq++);
      if (dev) frame = dev.modifyFrame(this, frame);
      this.local.predict(frame, this.collision, hopMaxFor(this.weapons.weapon));
      net.socket.emit('input', frame);
    }

    const state = this.local.state;
    if (this.local.alive) {
      if (this.wasOnGround && !state.onGround && state.vy > 1) audio.play('jump', undefined, 0.6);
      if (state.jetting && now - this.lastJetFx > 90) {
        this.lastJetFx = now;
        audio.play('jet', undefined, 0.5);
      }
    }
    this.wasOnGround = state.onGround;
    if (state.jetting) for (const side of [-0.1, 0.1]) this.effects.exhaust(this.jetNozzle(this.local.position, this.ctx.input.yaw, side));

    // Weapons.
    this.weapons.update(now);
    const def = this.weapons.def;
    const canShoot = this.local.alive && !this.local.car && !this.building && !dev?.blocksShooting();
    const aiming = input.aiming && canShoot && !this.weapons.reloading;
    if (aiming !== this.aimingSent) {
      this.aimingSent = aiming;
      net.socket.emit('aim', aiming);
    }
    if (canShoot && this.match.phase !== 'ended') {
      const result = this.weapons.trigger(input.firing || (dev?.wantsFire() ?? false), now);
      if (result === 'fire') this.fire(aiming);
      else if (result === 'empty') {
        audio.play('empty');
        this.startReload(now);
      }
      if (this.weapons.mag === 0 && !this.weapons.reloading) this.startReload(now);
    }

    if (this.building) this.updateBuilding(input.firing, input.aiming);
    this.fireWasDown = input.firing;
    this.aimWasDown = input.aiming;

    // Render everything.
    const renderTime = this.serverNow() - INTERP_DELAY_MS;
    this.vehicles.render(renderTime, dt, this.local.car ? { id: this.local.vehicleId, car: this.local.car } : null);
    const seat = this.local.car ? this.vehicles.seatOf(this.local.vehicleId, new THREE.Vector3()) : null;
    const body = dev?.bodyAngles() ?? null;
    this.local.render(this.accumulator / SIM_DT, dt, body?.yaw ?? input.yaw, body?.pitch ?? input.pitch, seat);
    this.remotes.render(renderTime, dt);
    for (const r of this.remotes.players.values()) {
      const v = r.latest?.vehicle;
      const remoteSeat = v ? this.vehicles.seatOf(v, new THREE.Vector3()) : null;
      if (remoteSeat && r.alive) r.sitAt(remoteSeat.position, remoteSeat.yaw);
    }
    this.flags?.update(dt, (pid) => this.drawnAt(pid));
    for (const r of this.remotes.players.values()) {
      if (r.latest?.jetting && r.alive) this.effects.exhaust(this.jetNozzle(r.position, r.yaw, Math.random() > 0.5 ? 0.1 : -0.1));
    }
    this.updateXray();
    this.projectiles.update(dt);
    this.loot.update(dt);
    this.effects.update(dt);

    const scoped = aiming && def.scope;
    const zoom = aiming ? def.zoom : 1;
    input.zoomScale = zoom > 1 ? zoomLookScale(zoom) * getSettings().zoomSensitivity : 1;
    if (dev?.controlCamera(this, dt)) {
      this.local.chicken.setBodyVisible(true);
      this.updateViewmodel(dt, false);
    } else if (this.local.alive) {
      this.rig.follow(this.local.position, input.yaw, input.pitch, zoom, dt, scoped, this.local.car !== null, this.local.eyeScale);
      this.local.chicken.setBodyVisible(!(this.rig.firstPerson || scoped));
      this.updateViewmodel(dt, this.rig.firstPerson && !scoped && !this.local.car, aiming);
    } else if (this.deathPos) {
      this.updateViewmodel(dt, false);
      this.rig.orbit(this.deathPos, dt);
      this.local.chicken.setBodyVisible(true);
    } else {
      this.rig.overview(dt, this.ctx.world.map.halfSize);
    }
    const cam = this.ctx.camera;
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, input.yaw);

    // HUD.
    hud.update();
    this.hudTimer += dt;
    if (this.hudTimer >= HUD_INTERVAL) {
      this.hudTimer = 0;
      this.updateHud(now, fps, aiming, scoped);
    }
    dev?.afterFrame(this, dt);
  }

  /** Silhouettes through walls: the developer wallhack wins, otherwise HvH shows enemies. */
  private updateXray(): void {
    const dev = this.ctx.dev;
    for (const r of this.remotes.players.values()) {
      const hvh = this.mode.wallhack && r.alive && !this.isFriendly(r.info) ? HVH_XRAY : null;
      r.chicken.setXray(dev?.xrayFor(this, r) ?? hvh);
    }
  }

  private updateViewmodel(dt: number, visible: boolean, aiming = false): void {
    const w = this.weapons;
    const now = performance.now();
    this.viewmodel.update({
      dt,
      camera: this.ctx.camera,
      weapon: w.weapon,
      visible,
      aiming,
      speed: this.local.alive ? Math.hypot(this.local.position.x - this.lastViewPos.x, this.local.position.z - this.lastViewPos.z) / Math.max(dt, 1e-3) : 0,
      onGround: this.local.onGround,
      reload: w.reloading ? w.reloadProgress(now) : null,
      yaw: this.ctx.input.yaw,
      pitch: this.ctx.input.pitch,
    });
    this.lastViewPos.copy(this.local.position);
  }


  private updateHud(now: number, fps: number, aiming: boolean, scoped: boolean): void {
    const { hud, input, net } = this.ctx;
    const server = this.local.server;
    const w = this.weapons;
    hud.setStats(net.ping, fps, this.infos.size);
    hud.setVitals(this.local.alive ? server.hp : 0, server.armor, this.local.state.fuel);
    hud.setWeapon(w.weapon, w.mag, w.reloading, w.reloadProgress(now), w.loadout, w.slot);
    hud.setGrenades(server.eggs, server.smokes);
    hud.setHop(this.local.alive && !this.local.car ? this.local.state.hop : 0, hopMaxFor(w.weapon));
    const spread = spreadFor(w.def, this.isMoving(), !this.local.onGround, aiming) * (w.mods?.spread ?? 1);
    const pixels = (spread / ((this.ctx.camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
    hud.setCrosshair(this.local.alive && input.active, pixels, scoped);
    hud.setMatch(this.match, this.serverNow(), this.infos.size);
    if (!this.local.alive) hud.setDeathTimer(this.respawnAt - now);
    hud.setHint(this.hintText());
    hud.setScoreboardVisible(input.scoreboardHeld && this.match.phase !== 'ended');
    if (input.scoreboardHeld) hud.renderScoreboard(this.scoreLines(), this.teamScores, net.ping);
    if (this.match.phase === 'ended' && this.match.endsAt !== null) hud.setResultsCountdown(this.match.endsAt - this.serverNow());
  }

  private isMoving(): boolean {
    const f = this.ctx.input.sample(0);
    return f.forward !== 0 || f.right !== 0;
  }

  private jetNozzle(pos: THREE.Vector3, yaw: number, side: number): Vec3 {
    const bx = Math.sin(yaw) * 0.42;
    const bz = Math.cos(yaw) * 0.42;
    return { x: pos.x + bx + Math.cos(yaw) * side, y: pos.y + 0.6, z: pos.z + bz - Math.sin(yaw) * side };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private handleAction(action: Action, now: number): void {
    const { net } = this.ctx;
    switch (action) {
      case 'reload':
        this.startReload(now);
        break;
      case 'slot1':
      case 'slot2':
      case 'slot3':
      case 'slot4':
      case 'slot5':
        this.switchWeapon(() => this.weapons.switchTo(Number(action.slice(4)) - 1, now));
        break;
      case 'nextWeapon':
        this.switchWeapon(() => this.weapons.cycle(1, now));
        break;
      case 'prevWeapon':
        this.switchWeapon(() => this.weapons.cycle(-1, now));
        break;
      case 'egg':
      case 'smoke':
        this.throwGrenade(action);
        break;
      case 'camera':
        this.ctx.hud.toast(this.rig.toggle() === 'first' ? 'First-person view (V)' : 'Third-person view (V)');
        break;
      case 'chat':
        this.openChat();
        break;
      case 'use':
        net.socket.emit('useVehicle');
        break;
      case 'build':
        if (this.mode.building && this.local.alive) {
          this.building = !this.building;
          if (!this.building) this.blocks?.showGhost(null, false);
          this.ctx.audio.play('switch');
        }
        break;
      case 'inspect':
        if (this.local.alive && !this.weapons.reloading) {
          this.viewmodel.inspect();
          this.local.chicken.inspect();
        }
        break;
      case 'nextBlock':
        if (this.building) {
          this.blockIndex = (this.blockIndex + 1) % BLOCK_KINDS.length;
          this.ctx.audio.play('click');
        }
        break;
    }
  }

  private switchWeapon(change: () => boolean): void {
    if (!this.local.alive || !change()) return;
    this.ctx.net.socket.emit('switchWeapon', this.weapons.slot);
    this.ctx.audio.play('switch');
  }

  private startReload(now: number): void {
    if (!this.local.alive || !this.weapons.reload(now)) return;
    this.ctx.net.socket.emit('reload');
    this.ctx.audio.play('reload');
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------

  /** Where the crosshair points: first thing the camera ray hits (beyond the player). */
  private aimDirection(eye: Vec3): Vec3 {
    const cam = this.ctx.camera;
    cam.getWorldDirection(this.camDir);
    const dir = { x: this.camDir.x, y: this.camDir.y, z: this.camDir.z };
    // Skip whatever is between a third-person camera and the chicken.
    const skip = Math.max(0, (eye.x - cam.position.x) * dir.x + (eye.y - cam.position.y) * dir.y + (eye.z - cam.position.z) * dir.z);
    const origin = { x: cam.position.x + dir.x * skip, y: cam.position.y + dir.y * skip, z: cam.position.z + dir.z * skip };
    const ray = makeRay(origin, dir);
    let t = this.raycastScene(ray, AIM_RANGE).t;
    if (t < 1.5) t = 1.5;
    const target = pointOnRay(ray, t);
    return normalize({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  }

  /** Nearest hit among the level, visible enemy chickens and loot boxes. */
  /**
   * Nearest hit among the level, visible enemy chickens and loot boxes. With `penetrate` (bullets),
   * crates/hay/wood don't stop the ray; the boxes passed through come back in `soft`.
   */
  raycastScene(ray: ReturnType<typeof makeRay>, range: number, penetrate = false): { t: number; pid: number; headshot: boolean; world: boolean; normal: Vec3; soft: RayHit[] } {
    const pen = raycastPenetrating(ray, this.collision, range, this.isSoft, penetrate ? this.wallbangBoxes : 0);
    const wall = pen.wall;
    const soft = pen.soft;
    const normal = wall ? { x: wall.nx, y: wall.ny, z: wall.nz } : { x: 0, y: 1, z: 0 };
    let best = { t: wall ? wall.t : range, pid: 0, headshot: false, world: !!wall, normal, soft };
    for (const [pid, r] of this.remotes.players) {
      if (!r.alive || this.isFriendly(r.info)) continue;
      const hit = rayChicken(ray, r.position.x, r.position.y, r.position.z, r.yaw, best.t, r.latest?.crouching ? CROUCH.scale : 1);
      if (hit) best = { t: hit.t, pid, headshot: hit.headshot, world: false, normal, soft };
    }
    const box = this.loot.raycast(ray, best.t);
    if (box >= 0) best = { t: box, pid: 0, headshot: false, world: false, normal, soft };
    return best;
  }

  eye(): Vec3 {
    const s = this.local.state;
    return { x: s.x, y: s.y + eyeHeightOf(s), z: s.z };
  }

  private fire(aiming: boolean): void {
    const { net, audio, input } = this.ctx;
    const w = this.weapons.def;
    const eye = this.eye();
    const aim = this.ctx.dev?.aimOverride(this, eye) ?? this.aimDirection(eye);
    net.socket.emit('fire', {
      shot: this.weapons.shotSeq,
      weapon: w.id,
      dx: aim.x,
      dy: aim.y,
      dz: aim.z,
      t: this.serverNow() - INTERP_DELAY_MS,
      aiming,
    });
    if (w.melee) {
      this.swing(eye, aim);
      return;
    }

    this.local.chicken.kick();
    this.viewmodel.fire();
    const recoil = w.recoil * (this.ctx.dev?.recoilScale() ?? 1);
    input.kick(recoil * (aiming ? 0.6 : 1), (Math.random() - 0.5) * recoil * 0.4);
    const muzzle = this.viewmodel.muzzleWorld(this.tmp) ?? this.local.chicken.muzzleWorldPosition(this.tmp);
    const muzzlePos = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
    this.effects.muzzleFlash(muzzlePos, w.pellets > 1 || w.id === 'sniper');
    audio.play(w.sound);
    if (w.projectile) return;
    this.effects.shell({ x: muzzlePos.x - aim.x * 0.3, y: muzzlePos.y - aim.y * 0.3, z: muzzlePos.z - aim.z * 0.3 }, input.yaw);

    // Draw our own tracers immediately, with the same pellet pattern the server will use.
    const spread = spreadFor(w, this.isMoving(), !this.local.onGround, aiming) * (this.weapons.mods?.spread ?? 1);
    for (const d of pelletDirections(w, aim, spread, shotSeed(this.selfPid, this.weapons.shotSeq))) {
      const ray = makeRay(eye, d);
      const hit = this.raycastScene(ray, w.range, true);
      const end = pointOnRay(ray, hit.t);
      this.effects.tracer(muzzlePos, end);
      // Holes in the boxes the bullet went through on the way.
      for (const s of hit.soft) {
        if (s.t >= hit.t) break;
        const at = pointOnRay(ray, s.t);
        this.effects.impact(at, 0xc28a4e);
        this.effects.bulletHole(at, { x: s.nx, y: s.ny, z: s.nz });
      }
      if (hit.pid) this.effects.feathers(end, this.skinColor(hit.pid), 4);
      else if (hit.world) {
        this.effects.impact(end);
        this.effects.bulletHole(end, hit.normal);
      }
    }
  }

  /** Our own melee swing: animate and give instant feedback. The server decides the damage. */
  private swing(eye: Vec3, aim: Vec3): void {
    const { audio, input } = this.ctx;
    const w = this.weapons.def;
    this.local.chicken.swing();
    this.viewmodel.fire();
    input.kick(w.recoil, 0);
    audio.play(w.sound);
    const targets: MeleeTarget<number>[] = [];
    for (const [pid, r] of this.remotes.players) {
      if (!r.alive || this.isFriendly(r.info)) continue;
      targets.push({ key: pid, x: r.position.x, y: r.position.y, z: r.position.z, yaw: r.yaw, scale: r.latest?.crouching ? CROUCH.scale : 1 });
    }
    const hit = meleeHit(eye, aim, w, targets, this.collision);
    if (!hit) return;
    this.effects.feathers(hit.point, this.skinColor(hit.key), 6);
    audio.play(w.id === 'pan' ? 'bonk' : 'meleeHit', hit.point);
  }

  private throwGrenade(kind: 'egg' | 'smoke'): void {
    const { net, audio, hud } = this.ctx;
    if (!this.local.alive) return;
    const count = kind === 'egg' ? this.local.server.eggs : this.local.server.smokes;
    if (count <= 0) {
      hud.toast(kind === 'egg' ? 'No eggs left — break boxes to find more' : 'No smoke grenades left', 'bad');
      audio.play('empty');
      return;
    }
    const eye = this.eye();
    const dir = this.aimDirection(eye);
    this.throwSeq++;
    net.socket.emit('throw', { kind, seq: this.throwSeq, dx: dir.x, dy: dir.y, dz: dir.z });
    const wall = raycastWorld(makeRay(eye, dir), this.collision, 0.6);
    const dist = wall ? Math.max(0, wall.t - 0.2) : 0.5;
    this.projectiles.predict(kind, this.selfPid, this.throwSeq, { x: eye.x + dir.x * dist, y: eye.y + dir.y * dist, z: eye.z + dir.z * dist }, dir);
    // Predict the count so a quick double tap doesn't show a stale number.
    this.local.server = { ...this.local.server, [kind === 'egg' ? 'eggs' : 'smokes']: count - 1 };
    audio.play('throw');
  }

  private skinColor(pid: number): number {
    const info = this.infos.get(pid);
    return (info && getItem('skin', info.appearance.skin)?.color) ?? 0xffffff;
  }

  // ---------------------------------------------------------------------------
  // Vehicles, building, flags
  // ---------------------------------------------------------------------------

  /** Where a player is drawn right now (flags ride on carriers). */
  private drawnAt(pid: number): { position: THREE.Vector3; yaw: number } | null {
    if (pid === this.selfPid) return this.local.alive ? { position: this.local.chicken.root.position, yaw: this.local.chicken.root.rotation.y } : null;
    const r = this.remotes.get(pid);
    return r && r.alive ? { position: r.chicken.root.position, yaw: r.chicken.root.rotation.y } : null;
  }

  private hintText(): string | null {
    if (!this.local.alive) return null;
    if (this.local.car) return 'Driving · E to get out · Space handbrake';
    if (this.building) {
      const kind = BLOCK_KINDS[this.blockIndex]!;
      return `Build mode · ${kind[0]!.toUpperCase()}${kind.slice(1)} (X to change) · Click place · Right-click remove · B to exit`;
    }
    if (this.flags && this.flags.carrierOf(this.self.team === 1 ? 2 : 1) === this.selfPid) return '🚩 You have the enemy flag! Bring it to your base';
    const s = this.local.state;
    if (s.y < 1.5 && this.vehicles.nearestFree(s.x, s.z)) return 'E · Drive the buggy';
    if (this.mode.building) return 'B · Build mode';
    return null;
  }

  private blockCentre(b: BlockState): Vec3 {
    const box = blockAabb(b.cx, b.cy, b.cz);
    return { x: box.minX + BLOCK_SIZE / 2, y: box.minY + BLOCK_SIZE / 2, z: box.minZ + BLOCK_SIZE / 2 };
  }

  /** Aims a ghost block at the crosshair; click places, right-click removes. */
  private updateBuilding(fireDown: boolean, aimDown: boolean): void {
    const blocks = this.blocks;
    if (!blocks || !this.local.alive || this.local.car) {
      blocks?.showGhost(null, false);
      return;
    }
    const cam = this.ctx.camera;
    cam.getWorldDirection(this.camDir);
    const eye = this.eye();
    const dir = { x: this.camDir.x, y: this.camDir.y, z: this.camDir.z };
    const skip = Math.max(0, (eye.x - cam.position.x) * dir.x + (eye.y - cam.position.y) * dir.y + (eye.z - cam.position.z) * dir.z);
    const origin = { x: cam.position.x + dir.x * skip, y: cam.position.y + dir.y * skip, z: cam.position.z + dir.z * skip };
    const ray = makeRay(origin, dir);
    const hit = raycastWorld(ray, this.collision, BUILD_RANGE + 2);
    if (!hit) {
      blocks.showGhost(null, false);
      return;
    }
    // The cell just in front of the surface we're pointing at.
    const p = pointOnRay(ray, hit.t);
    const cell = cellOf(p.x + hit.nx * 0.05, p.y + hit.ny * 0.05, p.z + hit.nz * 0.05);
    const box = blockAabb(cell.cx, cell.cy, cell.cz);
    const centre = { x: box.minX + BLOCK_SIZE / 2, y: box.minY + BLOCK_SIZE / 2, z: box.minZ + BLOCK_SIZE / 2 };
    const s = this.local.state;
    const r = PLAYER.radius;
    const insideMe = box.minX < s.x + r && box.maxX > s.x - r && box.minZ < s.z + r && box.maxZ > s.z - r && box.minY < s.y + heightOf(s) && box.maxY > s.y;
    const inReach = Math.hypot(centre.x - eye.x, centre.y - eye.y, centre.z - eye.z) <= BUILD_RANGE;
    const valid = inReach && !insideMe && cell.cy >= 0;
    const blockId = hit.id !== undefined && hit.id >= BLOCK_ID_BASE ? hit.id - BLOCK_ID_BASE : null;
    blocks.showGhost(cell, valid);

    if (fireDown && !this.fireWasDown && valid) this.ctx.net.socket.emit('build', { ...cell, kind: BLOCK_KINDS[this.blockIndex]! });
    if (aimDown && !this.aimWasDown && blockId !== null) this.ctx.net.socket.emit('unbuild', blockId);
  }

  private onFlag(e: FlagEvent): void {
    this.flags?.set(e.flags);
    // Flags resetting at the start of a match isn't news.
    if (e.kind === 'returned' && e.pid === 0 && this.match.phase !== 'playing') return;
    const who = this.infos.get(e.pid)?.name ?? 'Someone';
    const flagName = `${TEAM_NAMES[e.team]} flag`;
    const ours = e.team === this.self.team;
    const text: Record<FlagEvent['kind'], string> = {
      taken: `${who} took the ${flagName}!`,
      dropped: `${who} dropped the ${flagName}`,
      returned: `The ${flagName} is back home`,
      captured: `${who} captured the ${flagName}!`,
    };
    // Good news is yellow, bad news red: losing our flag is bad, taking theirs is good.
    const bad = ours ? e.kind === 'taken' || e.kind === 'captured' : e.kind === 'returned';
    this.ctx.hud.toast(text[e.kind], bad ? 'bad' : 'good');
    this.ctx.audio.play(e.kind === 'captured' ? 'reward' : 'pickup');
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  private bindChat(): void {
    const input = this.ctx.hud.chatInput;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) this.ctx.net.socket.emit('chat', text);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    };
  }

  private openChat(): void {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.ctx.input.enabled = false;
    this.ctx.hud.setChatOpen(true);
  }

  private closeChat(): void {
    this.chatOpen = false;
    this.ctx.input.enabled = true;
    this.ctx.hud.setChatOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Network events
  // ---------------------------------------------------------------------------

  private on<E extends keyof ServerToClientEvents>(event: E, fn: ServerToClientEvents[E]): void {
    // Socket.IO's typings for on/off with generic event names are awkward; the map above keeps them paired.
    (this.ctx.net.socket.on as (e: string, f: unknown) => void)(event, fn);
    this.handlers.push([event, fn as (...args: never[]) => void]);
  }

  private bindNetwork(): void {
    this.on('snapshot', (s) => this.onSnapshot(s));
    this.on('playerJoined', (info) => this.onPlayerInfo(info));
    this.on('playerUpdated', (info) => this.onPlayerInfo(info));
    this.on('playerLeft', (pid) => {
      this.infos.delete(pid);
      this.remotes.remove(pid);
      this.refreshScores();
    });
    this.on('shot', (e) => this.onShot(e));
    this.on('damage', (e) => this.onDamage(e));
    this.on('kill', (e) => this.onKill(e));
    this.on('spawn', (e) => this.onSpawn(e));
    this.on('projectile', (e) => this.onProjectile(e));
    this.on('explode', (e) => this.onExplode(e));
    this.on('smoke', (e) => this.onSmoke(e));
    this.on('loot', (e) => this.onLoot(e));
    this.on('pickup', (e) => this.onPickup(e));
    this.on('drop', (d) => this.loot.addDrop(d));
    this.on('dropGone', (e) => this.loot.removeDrop(e.id));
    this.on('scores', (e) => this.onScores(e));
    this.on('match', (e) => this.onMatch(e));
    this.on('chat', (m) => this.onChat(m));
    this.on('reward', (e) => this.onReward(e));
    this.on('roomClosed', (reason) => this.ctx.onClosed(reason));
    this.on('blockPlaced', (b: BlockState) => {
      this.blocks?.add(b);
      this.ctx.audio.play('click', this.blockCentre(b), 0.7);
    });
    this.on('blockRemoved', (id: number) => this.blocks?.remove(id));
    this.on('flag', (e) => this.onFlag(e));
  }

  private onSnapshot(snapshot: WorldSnapshot): void {
    const sample = snapshot.t - performance.now();
    if (!this.hasClock) {
      this.clockOffset = sample;
      this.hasClock = true;
    } else {
      this.clockOffset += (sample - this.clockOffset) * CLOCK_SMOOTHING;
    }
    const mine = snapshot.p.find((p) => p[0] === this.selfPid);
    if (mine) {
      const state = unpackPlayer(mine);
      const wasAlive = this.local.alive;
      const car = state.vehicle ? snapshot.v.map(unpackVehicle).find((v) => v.id === state.vehicle) : undefined;
      this.local.reconcile(state, this.collision, car);
      // A respawn we haven't seen the event for yet (e.g. just joined).
      if (!wasAlive && state.alive) this.respawned();
      this.weapons.sync(state, performance.now());
    }
    this.remotes.pushSnapshot(snapshot, this.selfPid);
    this.vehicles.pushSnapshot(snapshot.t, snapshot.v);
  }

  private onPlayerInfo(info: PlayerInfo): void {
    this.infos.set(info.pid, info);
    if (info.pid === this.selfPid) {
      this.weapons.setLoadout(info.loadout);
      this.local.chicken.setAppearance(info.appearance);
      this.local.chicken.setTeam(info.team);
    } else {
      this.remotes.add(info, this.isFriendly(info));
    }
    this.refreshScores();
  }

  private onShot(e: ShotEvent): void {
    if (e.pid === this.selfPid) return;
    const remote = this.remotes.get(e.pid);
    const origin = remote ? remote.chicken.muzzleWorldPosition(this.tmp) : new THREE.Vector3(e.ox, e.oy, e.oz);
    const from = { x: origin.x, y: origin.y, z: origin.z };
    const def = WEAPONS[e.weapon];
    if (def.melee) {
      remote?.chicken.swing();
      this.ctx.audio.play(def.sound, from, 0.9);
      if (e.hits.length > 0) {
        const at = { x: e.ends[0]!, y: e.ends[1]!, z: e.ends[2]! };
        this.effects.feathers(at, 0xffffff, 5);
        this.ctx.audio.play(def.id === 'pan' ? 'bonk' : 'meleeHit', at, 0.9);
      }
      return;
    }
    remote?.chicken.kick();
    this.effects.muzzleFlash(from);
    this.ctx.audio.play(remote?.latest ? WEAPONS[remote.latest.weapon].sound : 'rifle', from, 0.9);
    for (let i = 0; i < e.hits.length; i++) {
      const end = { x: e.ends[i * 3]!, y: e.ends[i * 3 + 1]!, z: e.ends[i * 3 + 2]! };
      this.effects.tracer(from, end);
      if (e.hits[i]) this.effects.feathers(end, 0xffffff, 3);
      else this.effects.impact(end);
      this.markWall(from, end);
    }
  }

  /** Leaves a bullet hole if a remote player's shot from `from` stopped at a wall at `end`. */
  private markWall(from: Vec3, end: Vec3): void {
    const d = { x: end.x - from.x, y: end.y - from.y, z: end.z - from.z };
    const length = Math.hypot(d.x, d.y, d.z);
    if (length < 0.1) return;
    const ray = makeRay(from, { x: d.x / length, y: d.y / length, z: d.z / length });
    const { soft, wall } = raycastPenetrating(ray, this.collision, length + 0.2, this.isSoft, this.wallbangBoxes);
    for (const s of soft) if (s.t < length - 0.05) this.effects.bulletHole(pointOnRay(ray, s.t), { x: s.nx, y: s.ny, z: s.nz });
    // Only if the wall really is where the shot ended (it could have hit a chicken or loot box instead).
    if (wall && Math.abs(wall.t - length) < 0.25) this.effects.bulletHole(end, { x: wall.nx, y: wall.ny, z: wall.nz });
  }

  private onDamage(e: DamageEvent): void {
    const { hud, audio } = this.ctx;
    if (e.victim === this.selfPid) {
      this.local.server = { ...this.local.server, hp: e.hp, armor: e.armor };
      audio.play('hurt');
      this.rig.addShake(0.15);
      if (e.attacker !== this.selfPid) {
        const angle = Math.atan2(-(e.fromX - this.local.position.x), -(e.fromZ - this.local.position.z));
        hud.damageFrom(-wrapAngle(angle - this.ctx.input.yaw));
      }
    } else if (e.attacker === this.selfPid) {
      hud.hit(e.headshot, e.hp <= 0);
      audio.play(e.headshot ? 'headshot' : 'hit');
    }
  }

  private onKill(e: KillEvent): void {
    const { hud, audio } = this.ctx;
    const killer = this.infos.get(e.killer);
    const victim = this.infos.get(e.victim);
    hud.kill(killer, victim, e.cause, e.headshot, this.selfPid);

    if (e.victim === this.selfPid) {
      this.died(killer, e.cause);
    } else {
      const remote = this.remotes.get(e.victim);
      if (remote) {
        remote.kill();
        remote.chicken.onVanish = (at) => this.vanished(at, e.victim);
        this.effects.feathers({ x: remote.position.x, y: remote.position.y + 0.8, z: remote.position.z }, this.skinColor(e.victim), 22);
        audio.play('death', remote.position, 0.8);
      }
      if (e.killer === this.selfPid) {
        audio.play('kill');
        hud.toast(`You plucked ${victim?.name ?? 'someone'}${e.headshot ? ' · headshot!' : ''}`, 'good');
      }
    }
  }

  private died(killer: PlayerInfo | undefined, cause: KillCause): void {
    this.local.server = { ...this.local.server, alive: false, hp: 0 };
    this.deathPos = this.local.position.clone();
    this.respawnAt = performance.now() + this.mode.respawnMs;
    this.effects.feathers({ x: this.deathPos.x, y: this.deathPos.y + 0.8, z: this.deathPos.z }, this.skinColor(this.selfPid), 22);
    this.local.chicken.onVanish = (at) => this.vanished(at, this.selfPid);
    this.ctx.audio.play('death');
    this.ctx.hud.showDeath(killer, cause, this.selfPid);
    if (this.chatOpen) this.closeChat();
  }

  /** The death animation ended: the body vanishes in a puff of feathers. */
  private vanished(at: THREE.Vector3, pid: number): void {
    const p = { x: at.x, y: at.y, z: at.z };
    this.effects.poof(p, this.skinColor(pid));
    this.ctx.audio.play('poof', p, 0.8);
  }

  private respawned(): void {
    this.deathPos = null;
    this.weapons.refill();
    this.ctx.hud.hideDeath();
  }

  private onSpawn(e: SpawnEvent): void {
    if (e.pid === this.selfPid) {
      this.local.respawnAt(e.x, e.y, e.z);
      this.ctx.input.yaw = e.yaw;
      this.ctx.input.pitch = -0.15;
      this.respawned();
    } else {
      this.remotes.get(e.pid)?.teleport(this.serverNow(), e.x, e.y, e.z, e.yaw);
    }
  }

  private onProjectile(e: ProjectileSpawn): void {
    this.projectiles.spawn(e, this.selfPid, (this.ctx.net.ping ?? 60) / 2);
  }

  private onExplode(e: ExplosionEvent): void {
    this.projectiles.explode(e);
    const at = { x: e.x, y: e.y, z: e.z };
    if (e.kind === 'smoke') {
      this.ctx.audio.play('smokePop', at);
      return;
    }
    this.effects.explosion(at, PROJECTILES[e.kind].splashRadius);
    this.ctx.audio.play('explosion', at);
    const dist = this.ctx.camera.position.distanceTo(this.tmp.set(e.x, e.y, e.z));
    this.rig.addShake(Math.max(0, 1 - dist / 25));
  }

  private onSmoke(e: SmokeEvent): void {
    const seconds = (e.until - this.serverNow()) / 1000;
    if (seconds > 0.5) this.effects.smokeCloud(e, seconds);
  }

  private onLoot(e: LootState): void {
    this.loot.set(e);
  }

  private onPickup(e: PickupEvent): void {
    if (e.pid !== this.selfPid) return;
    const text = PICKUP_TEXT[e.pickup] ?? 'Pickup!';
    this.ctx.hud.toast(e.lootId === -1 ? `Kill bonus: ${text}` : text, 'good');
    this.ctx.audio.play('pickup');
  }

  private onScores(e: ScoresEvent): void {
    for (const [pid, kills, deaths, score] of e.rows) {
      const info = this.infos.get(pid);
      if (info) this.infos.set(pid, { ...info, kills, deaths, score });
    }
    this.teamScores = e.teamScores;
    this.refreshScores();
  }

  private onMatch(m: MatchState): void {
    const { hud, audio } = this.ctx;
    const previous = this.match.phase;
    this.match = m;
    this.teamScores = m.teamScores;
    if (m.phase === 'playing' && previous !== 'playing') {
      hud.toast('Fight!', 'good');
      audio.play('reward');
    }
    if (m.phase === 'countdown') audio.play('countdown');
    if (m.phase === 'ended') {
      this.lastResultsKey = '';
      this.renderResults();
    }
    this.refreshScores();
  }

  private renderResults(): void {
    const m = this.match;
    const key = `${m.winnerPid}|${m.winnerTeam}|${m.mvpPid}`;
    if (key === this.lastResultsKey) return;
    this.lastResultsKey = key;
    const self = this.self;
    const won = this.mode.teams ? m.winnerTeam !== 0 && m.winnerTeam === self.team : m.winnerPid === this.selfPid;
    this.ctx.hud.renderResults(m, this.scoreLines(), this.teamScores, this.infos.get(m.winnerPid), this.infos.get(m.mvpPid), won);
  }

  private onChat(m: ChatMessage): void {
    this.ctx.hud.chat(m, m.pid === this.selfPid);
  }

  private onReward(e: MatchRewardEvent): void {
    this.ctx.hud.showReward(e.coins, e.total);
    this.ctx.hud.toast(`+${e.coins} coins`, 'good');
    this.ctx.audio.play('reward');
    this.ctx.onCoins(e.total);
  }

  private scoreLines(): ScoreLine[] {
    return [...this.infos.values()].map((info) => ({ info, self: info.pid === this.selfPid }));
  }

  private refreshScores(): void {
    this.ctx.hud.setTeamScores(this.teamScores, this.self?.team ?? 0);
  }

  // ---------------------------------------------------------------------------

  dispose(): void {
    this.ctx.dev?.detach(this);
    const socket = this.ctx.net.socket as unknown as { off: (e: string, f: unknown) => void };
    for (const [event, fn] of this.handlers) socket.off(event, fn);
    this.handlers.length = 0;
    if (this.chatOpen) this.closeChat();
    this.ctx.hud.chatInput.onkeydown = null;
    this.ctx.input.zoomScale = 1;
    this.viewmodel.dispose();
    this.local.dispose();
    this.remotes.dispose();
    this.projectiles.dispose();
    this.loot.dispose();
    this.vehicles.dispose();
    this.blocks?.dispose();
    this.flags?.dispose();
    this.effects.dispose();
    this.ctx.hud.setVisible(false);
    this.ctx.hud.hideDeath();
  }
}

