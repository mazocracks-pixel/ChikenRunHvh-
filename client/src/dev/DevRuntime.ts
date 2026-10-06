import * as THREE from 'three';
import { getKeybinds } from '../keybinds';
import { HITBOX, PLAYER, chickenHeadCenter, defaultHvhLoadout, hvhPose, makeRay, normalize, raycastWorld, raycastPenetrating, softBoxTest, wallbangScale, WALLBANG, wrapAngle, type InputFrame, type Vec3, type ShotEvent } from '@game/shared';
import type { DevHooks, GameSession } from '../game/GameSession';
import type { RemotePlayer } from '../game/RemotePlayers';
import { h } from '../ui/dom';
import type { Dev } from './Dev';
import { HVH_PANELS } from './panels';
import { DevDebug3D } from './DevDebug3D';
import { DevOverlay } from './DevOverlay';
import { estimateShot, peekSteering, shotGate, type ShotTarget } from './tactics';
import type { DevConfig } from './config';
import { shotRecordUsable } from '@game/shared';
import { nativeOn, nativeValue, nativeColor } from './skeet/visualValues';
import { skeetEffectiveConfig, skeetProfile } from './skeet/model';
import { skeetPointOffsets, skeetSafeRay } from './skeet/points';
import { ResolverSystem, scanRage, buildHvhMatrix, hvhHitchance, afterArmor, directionFromAngles, DEFAULT_RAGE, defaultHvhCore, HvhExtensionHost, airStrafeInput, moveSpeedFor, SIM_DT,
  autoStopInput, planAutoStop, predictEnemyPeek, type AutoStopPlan, type PeekForecast, type ObservableRecord, type ShotCandidate, type ShotIntent } from '@game/shared';

const DEG = Math.PI / 180;
export interface Candidate { pid: number; r: RemotePlayer; point: THREE.Vector3; angle: number; distance: number; hp: number; visible: boolean; part: 'head' | 'body'; target: ShotTarget; offset?: Vec3 }
const xrayMaterial = () => new THREE.MeshBasicMaterial({ depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });

/** Bounded assists plus explicit, server-governed HvH abilities. */
export class DevRuntime implements DevHooks {
  readonly coreResolver = new ResolverSystem();
  readonly extensions = new HvhExtensionHost();
  private coreTarget: ShotCandidate | null = null;
  private coreReady = false;
  private coreScanAt = -Infinity;
  private coreShot: ShotIntent | undefined;
  private coreScoped = false;
  private peekForecast: PeekForecast | null = null;
  private peekForecastAt = -Infinity;
  private autoStopShotAt = -Infinity;
  private autoStopText = 'Inactive';
  readonly overlay: DevOverlay;
  private session: GameSession | null = null;
  private debug3d: DevDebug3D | null = null;
  private pid = 0;
  private acquiredAt = 0;
  private switchingUntil = 0;
  private ready = false;
  private target: Candidate | null = null;
  private lastScanAt = -Infinity;
  private nextEstimateAt = 0;
  private configVersion: unknown;
  private weaponVersion = '';
  /** Useful for verifying that expensive work follows shot opportunities, not display Hz. */
  evaluations = 0;
  private lastJump = false;
  private jumpBufferUntil = 0;
  private lastYaw = 0;
  private peekHeld = false;
  private peekAnchor: Vec3 | null = null;
  private returning = false;
  private peekReturnAt = 0;
  private readonly enemy = xrayMaterial();
  private readonly friendly = xrayMaterial();
  private readonly chams = new Map<string, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>();
  private nativeRenderValues: unknown;
  private readonly styledPlayers = new Set<number>();
  private readonly hiddenTeammates = new Set<number>();
  private readonly info = h('div', { class: 'dev-tactical', role: 'status', 'aria-live': 'off' });
  private infoKey = '';
  private lastInfoAt = 0;
  private readonly logs: string[] = [];
  private readonly playerRules = new Map<number, { ignore: boolean; body: boolean }>();
  private policySource: DevConfig | undefined;
  private policyWeapon = '';
  private policyValue: DevConfig | undefined;
  private readonly binds = h('div', { class: 'skeet-binds', 'aria-label': 'Active panel binds' });
  private readonly watermark = h('div', { class: 'skeet-watermark' });
  diagnostics = { target: 'No target', damage: 0, chance: 0, state: 'Idle' };

  constructor(private readonly dev: Dev) {
    this.overlay = new DevOverlay(dev);
    this.info.hidden = true;
    (document.getElementById('hud-layer') ?? document.body).append(this.info);
    this.binds.hidden = this.watermark.hidden = true;
    (document.getElementById('hud-layer') ?? document.body).append(this.binds, this.watermark);
  }
  get currentSession(): GameSession | null { return this.session; }
  get focusPid(): number { return this.coreTarget?.target ?? this.pid; }
  get peekState(): string { return this.returning ? 'Returning' : this.peekAnchor ? 'Anchor set' : 'Inactive'; }
  get autoStopState(): string { return this.autoStopText; }
  get shotLog(): readonly string[] { return this.logs; }
  get resolverInfo(): string {
    if (this.coreTarget) { const r = this.coreResolver.resolve(this.coreTarget.record); return `${r.state} · ${r.pattern} · ${this.coreTarget.source} · ${Math.round(r.confidence * 100)}% confidence · ${Math.round(this.coreTarget.safety * 100)}% safety`; }
    return 'Awaiting a target';
  }
  playerRule(pid: number): { ignore: boolean; body: boolean } { return this.playerRules.get(pid) ?? { ignore: false, body: false }; }
  setPlayerRule(pid: number, key: 'ignore' | 'body', value: boolean): void { this.playerRules.set(pid, { ...this.playerRule(pid), [key]: value }); this.lastScanAt = -Infinity; this.ready = false; }
  panelChanged(): void { this.policySource = undefined; this.reset(); }
  private get policy(): DevConfig {
    const c = this.dev.config, weapon = this.session?.weapons.def;
    if (this.dev.panelId !== 'skeet' || !weapon) return c;
    if (this.policySource !== c || this.policyWeapon !== weapon.id) {
      this.policySource = c; this.policyWeapon = weapon.id; this.policyValue = skeetEffectiveConfig(c, weapon);
    }
    return this.policyValue!;
  }
  private get active(): boolean { return this.dev.active && this.session?.mode.id === 'hvh'; }
  private get rageTiming(): boolean { return this.policy.rage.aim.enabled; }
  private get playing(): boolean { return this.active && this.dev.input.active && !this.dev.menuOpen && this.session!.local.alive && !this.session!.local.car; }
  attach(session: GameSession): void { this.session = session; this.debug3d = new DevDebug3D(session, this.coreResolver, () => this.coreTarget); this.reset(); this.dev.sessionStarted(); }
  detach(session: GameSession): void {
    if (this.session !== session) return;
    session.setSkeetVisuals(null);
    this.debug3d?.dispose(); this.debug3d = null; this.session = null;
    for (const material of this.chams.values()) material.dispose();
    this.chams.clear();
    this.styledPlayers.clear();this.hiddenTeammates.clear();this.nativeRenderValues=undefined;
    this.overlay.clear(); this.reset(); this.dev.sessionEnded();
  }
  private reset(): void {
    this.target = null; this.lastScanAt = -Infinity; this.nextEstimateAt = 0;
    this.pid = 0; this.ready = false; this.acquiredAt = this.switchingUntil = 0;
    this.peekAnchor = null; this.returning = this.peekHeld = false;
    this.logs.length = 0; this.info.hidden = true;
    this.playerRules.clear();
    this.coreResolver.clear(); this.coreTarget = null; this.coreReady = this.coreScoped = false; this.coreScanAt = -Infinity; this.coreShot = undefined;
    this.peekForecast = null; this.peekForecastAt = this.autoStopShotAt = -Infinity; this.autoStopText = 'Inactive';
    this.binds.hidden = this.watermark.hidden = true; this.dev.input.assistedAds = false;
    this.diagnostics = { target: 'No target', damage: 0, chance: 0, state: 'Idle' };
  }
  applyServerMods(): void {
    if (!this.session) return;
    // HvH keeps baseline stats. Outside it, the private classic panel owns prediction.
    if (this.session.mode.id === 'hvh') this.session.local.mods = this.session.weapons.mods = null;
    this.session.weapons.hvh = this.session.mode.id === 'hvh' && this.dev.status.profile === 'hvh' ? this.dev.status.hvh ?? defaultHvhLoadout() : defaultHvhLoadout();
    this.session.weapons.tactical = this.session.mode.id === 'hvh';
  }
  beforeFrame(session: GameSession, _dt: number, now: number): void {
    const native=this.active&&this.dev.panelId==='skeet'?this.dev.config.skeet.native:null;
    session.setSkeetVisuals(native);
    session.weapons.forceAutomatic = false;
    if(native)session.weapons.forceAutomatic=nativeOn(native,'Misc.automaticWeapons');
    this.dev.input.assistedAds = false;
    const c = this.policy;
    this.dev.hud.showCrosshair = !this.active || c.misc.crosshair;
    this.dev.hud.showHitmarker = !this.active || c.misc.hitmarker;
    this.dev.hud.showDamageIndicators = !this.active || c.misc.damageIndicator;
    if (session.mode.id === 'hvh') { this.beforeHvh(session, now); return; }
    if (!this.playing) {
      this.target = null; this.pid = 0; this.ready = false; this.lastScanAt = -Infinity;
      this.peekAnchor = null; this.returning = false; this.diagnostics.state = 'Paused'; return;
    }
    const a = c.rage.aim, trigger = c.legit.trigger;
    if (!a.enabled && (!trigger.enabled || !this.keyHeld(trigger.key))) {
      this.target = null; this.pid = 0; this.ready = false;
      this.diagnostics = { target: 'No target', damage: 0, chance: 0, state: 'Idle' }; return;
    }
    if (this.configVersion !== c || this.weaponVersion !== session.weapons.weapon) {
      this.configVersion = c; this.weaponVersion = session.weapons.weapon;
      this.lastScanAt = -Infinity; this.nextEstimateAt = 0; this.ready = false;
    }
    const forceBody = this.keyHeld(c.hvh.aim.bodyKey, false);
    const part = forceBody || c.hvh.aim.bodyAim === 'prefer' ? 'body' : a.enabled ? a.hitbox : 'nearest';
    const fov = (a.enabled ? a.fov / 2 : trigger.fov) * DEG;
    if (now - this.lastScanAt >= 100) {
      this.lastScanAt = now;
      const list = this.candidates(session, part, true).filter(t => t.visible && t.angle <= fov);
      const rank = (t: Candidate) => a.priority === 'health' ? t.hp : a.priority === 'distance' ? t.distance : t.angle;
      let target = (a.lock && list.find(t => t.pid === this.pid)) || list.reduce<Candidate | undefined>((best,t) => !best || rank(t)<rank(best) ? t : best, undefined);
      // Evaluate body-if-lethal for the chosen opponent rather than sampling every opponent.
      if (target && !forceBody && a.enabled && c.hvh.aim.bodyAim === 'lethal') {
        const body = this.candidates(session, 'body', true, target.pid)[0];
        if (body?.visible) {
          const eye = session.eye();
          const direction = normalize({ x:body.point.x-eye.x, y:body.point.y-eye.y, z:body.point.z-eye.z });
          const estimate = estimateShot(session.weapons.def, eye, direction, body.target, session.horizontalSpeed(), !session.local.onGround, this.dev.input.aiming, session.collision, c.hvh.aim.autowall && session.mode.wallbang ? softBoxTest(session.map) : undefined);
          if (estimate.damage >= body.hp) target = body;
        }
      }
      if (target && target.pid !== this.pid) {
        this.switchingUntil = !this.rageTiming && this.pid ? now + c.hvh.aim.switchDelay : now;
        this.pid = target.pid; this.acquiredAt = now; this.nextEstimateAt = 0; this.ready = false;
      }
      this.target = target ?? null;
    }
    const target = this.target;
    if (!target) { this.pid = 0; this.ready = false; this.diagnostics = {target:'No target',damage:0,chance:0,state:'Waiting for sight'}; return; }
    const trackingPart = target.part;
    const live = this.candidates(session, forceBody ? 'body' : trackingPart, true, target.pid)[0];
    if (!live?.visible || live.angle > fov) {
      this.target = null; this.pid = 0; this.ready = false; this.diagnostics.state = 'Waiting for sight'; return;
    }
    this.target = live;
    this.dev.input.assistedAds = this.dev.panelId === 'skeet' && a.enabled && session.weapons.def.scope && live.distance > 12 && skeetProfile(c, session.weapons.def).autoScope;
  }

  /** Called after movement, remote interpolation and the camera have updated for this frame. */
  wantsFire(now = performance.now()): boolean {
    const session = this.session, c = this.policy, a = c.rage.aim, trigger = c.legit.trigger;
    if (session?.mode.id === 'hvh') {
      const enabled = (a.enabled && a.autoTarget) || (trigger.enabled && this.keyHeld(trigger.key));
      if (!this.playing || !enabled || !this.coreTarget || !this.coreReady || this.coreTarget.scope) return false;
      if (!shotRecordUsable(this.coreTarget.record.t, session.serverNow(), this.dev.ping() ?? 0) || session.remotes.players.get(this.coreTarget.target)?.latest?.alive === false) {
        this.coreScanAt = -Infinity; this.diagnostics.state = 'Waiting for a fresh record'; return false;
      }
      const w = session.weapons;
      if (w.shotState(now) !== 'Ready' || w.reloading) return false;
      // The shooter may have moved since the bounded scan. Validate the shot from the current eye.
      const target = this.coreTarget, eye = session.eye(), skeet = this.dev.panelId === 'skeet';
      const direction = a.enabled ? normalize({x:target.point.x-eye.x,y:target.point.y-eye.y,z:target.point.z-eye.z})
        : directionFromAngles(this.dev.input.yaw,this.dev.input.pitch);
      const resolution = this.coreResolver.resolve(target.record, c.hvh.feedback.resolver && (!skeet || c.skeet.resolver.mode === 'adaptive'), undefined, c.hvh.resolverPolicy);
      const hypotheses = resolution.hypotheses.map(h => ({probability:h.probability,
        matrix:buildHvhMatrix(target.record.origin,h.yaw,1-target.record.crouch*0.3,target.record.pitch)}));
      const estimate = hvhHitchance(w.def,eye,direction,buildHvhMatrix(target.record.origin,target.yaw,1-target.record.crouch*0.3,target.record.pitch),
        session.horizontalSpeed(),!session.local.onGround,this.dev.input.aiming || this.dev.input.assistedAds,session.collision,
        c.hvh.aim.autowall && session.mode.wallbang ? softBoxTest(session.map) : undefined,32,w.heat,hypotheses);
      const overridden=this.keyHeld(c.hvh.aim.overrideKey,false);
      const requiredDamage = !overridden && c.hvh.aim.hpRelative >= 0 ? target.record.hp+c.hvh.aim.hpRelative
        : Math.min(target.record.hp,overridden ? c.hvh.aim.damageOverride : c.hvh.aim.minDamage);
      return estimate.chance+1e-9 >= (session.local.onGround ? c.hvh.aim.hitchance : c.hvh.aim.airHitchance)/100
        && afterArmor(estimate.damage,target.record.armor)+1e-9 >= requiredDamage;
    }
    if (!this.playing || !session || !this.target) return false;
    const auto = a.enabled && a.autoTarget;
    const assisting = auto || (!a.enabled && trigger.enabled && this.keyHeld(trigger.key));
    if (!assisting) { this.ready = false; this.diagnostics.state = 'Aim only'; return false; }
    const part = this.keyHeld(c.hvh.aim.bodyKey, false) ? 'body' : this.target.part;
    const target = this.candidates(session, part, true, this.pid)[0];
    if (!target?.visible || target.angle > (auto ? a.fov / 2 : trigger.fov)*DEG) {
      this.ready = false; this.diagnostics.state = 'Waiting for sight'; return false;
    }
    const w = session.weapons.def;
    if (w.projectile || w.melee) { this.ready = false; this.diagnostics.state = 'Manual weapon'; return false; }
    const reaction = this.rageTiming ? 0 : auto ? c.hvh.aim.reaction : Math.max(a.enabled ? c.hvh.aim.reaction : 0, trigger.delay);
    if (!this.rageTiming && (now < this.switchingUntil || now-this.acquiredAt < Math.max(100, reaction))) {
      this.ready = false; this.diagnostics.state = now < this.switchingUntil ? 'Switching target' : 'Acquiring target'; return false;
    }
    const weaponState = session.weapons.shotState(now);
    if (weaponState !== 'Ready') {
      this.diagnostics.state = weaponState;
      // Hold an assisted burst through its gap, but validate the next bullet when it is due.
      return weaponState === 'Cooldown' && this.ready;
    }
    if (now < this.nextEstimateAt) return false;
    this.nextEstimateAt = now + 50; this.evaluations++;
    const eye = session.eye(), direction = a.enabled ? normalize({ x: target.point.x - eye.x, y: target.point.y - eye.y, z: target.point.z - eye.z }) : session.aimDirection(eye);
    const safe = this.dev.panelId === 'skeet' && skeetProfile(c, w).safePoints;
    const uncertainty = 0;
    const autowall = c.hvh.aim.autowall && session.mode.wallbang;
    const estimate = estimateShot(w, eye, direction, target.target, session.horizontalSpeed(), !session.local.onGround, this.dev.input.aiming,
      undefined, undefined, (ray, range) => {
        const hit = session.raycastScene(ray, range, autowall);
        if (safe && !skeetSafeRay(eye, { x: ray.dx, y: ray.dy, z: ray.dz }, target.target, uncertainty, range)) return null;
        return hit.pid === target.pid ? { t:hit.t, headshot:hit.headshot, scale:wallbangScale(hit.soft,hit.t) } : null;
      });
    const minimum = this.keyHeld(c.hvh.aim.overrideKey, false) ? c.hvh.aim.damageOverride : c.hvh.aim.minDamage;
    const state = shotGate(estimate, minimum, c.hvh.aim.hitchance, target.hp, now-this.acquiredAt, reaction);
    this.diagnostics = { target:target.r.info.name, damage:Math.round(estimate.damage), chance:Math.round(estimate.chance), state };
    this.ready = state === 'Ready';
    return this.ready;
  }
  onShot(session: GameSession, assisted = false): void {
    if (!this.active) return;
    this.autoStopShotAt = performance.now();
    if (this.peekAnchor && this.peekHeld) { this.returning = true; this.peekReturnAt = performance.now(); }
    const d = this.diagnostics;
    if (session.mode.id === 'hvh' && assisted && this.coreTarget) {
      const c = this.coreTarget;
      this.coreShot = { target: c.target, recordT: c.record.t, source: c.source, yaw: c.yaw, safety: c.safety };
      this.extensions.shot(this.coreShot);
      this.logs.unshift(`#${session.weapons.shotSeq} ${c.source} · ${c.group} · ${Math.round(c.safety * 100)}% safe · ${Math.round(c.chance * 100)}% chance`);
      this.logs.length = Math.min(this.logs.length, 5); this.coreScanAt = -Infinity; return;
    }
    const text = `${session.weapons.def.name} → ${d.target} · ~${d.damage} HP / ${d.chance}%`;
    this.logs.unshift(text); if (this.logs.length > 5) this.logs.pop();
  }
  onServerShot(session: GameSession, shot: ShotEvent): void {
    this.overlay.sound(shot);
    if (session.mode.id === 'hvh' && shot.pid === session.selfPid && shot.audit) {
      const a = shot.audit;
      this.extensions.result(a);
      this.coreResolver.feedback(a.target, a.source, a.reason, session.serverNow(), a.headshot === true);
      this.logs.unshift(`#${shot.shot} ${a.reason} · ${shot.burst === 2 ? 'DT burst · ' : ''}${Math.round(a.damage)} damage`);
      this.logs.length = Math.min(this.logs.length, 5); this.coreScanAt = -Infinity; return;
    }
  }
  modifyFrame(session: GameSession, frame: InputFrame): InputFrame {
    if (session.mode.id !== 'hvh' || !this.playing) return frame;
    const c = this.policy, s = session.local.state;
    const out = this.extensions.command({ ...frame, invert: this.keyHeld(c.hvh.invertKey, false) });
    const core = c.hvh.core ?? defaultHvhCore();
    if (session.mode.id === 'hvh' && core.fakeDuck && core.fakeLag > 1) out.crouch = frame.seq % (core.fakeLag + 1) < (core.fakeLag + 1) / 2;
    const now = performance.now();
    const moving = frame.forward !== 0 || frame.right !== 0;
    if (c.legit.move.jumpAssist) {
      if (frame.jump && !this.lastJump && !s.onGround) this.jumpBufferUntil = now + 160;
      if (s.onGround && now < this.jumpBufferUntil) { out.jump = out.autoHop = true; this.jumpBufferUntil = 0; }
    }
    this.lastJump = frame.jump;
    if (c.legit.move.bhop && frame.jump) out.autoHop = true;
    if (c.misc.autoJump && moving) out.jump = out.autoHop = true;
    out.subtickStrafe = c.hvh.movement.subtickStrafe && !s.onGround;
    if (c.legit.move.autoStrafe && !s.onGround && !out.subtickStrafe) Object.assign(out, airStrafeInput(out,s,wrapAngle(out.yaw-this.lastYaw),SIM_DT,PLAYER.speed*moveSpeedFor(session.weapons.weapon)));
    this.lastYaw = frame.yaw;
    const held = c.hvh.movement.peekAssist && this.keyHeld(c.hvh.movement.peekKey, false);
    if (held && !this.peekHeld && s.onGround) this.peekAnchor = { x:s.x, y:s.y, z:s.z };
    this.peekHeld = held;
    if (!held || !s.onGround || frame.jump || session.local.car) { this.peekAnchor = null; this.returning = false; }
    if (this.returning && this.peekAnchor) {
      if (moving) {
        if (now-this.peekReturnAt<150) return out;
        this.returning = false; this.peekAnchor = null;
      }
      else {
        const steering = peekSteering(s, this.peekAnchor, frame.yaw);
        const dx=this.peekAnchor.x-s.x, dz=this.peekAnchor.z-s.z, distance=Math.hypot(dx,dz);
        const block = distance > 0.2 ? raycastWorld(makeRay({x:s.x,y:s.y+0.5,z:s.z},{x:dx/distance,y:0,z:dz/distance}),session.collision,Math.min(distance,PLAYER.radius+0.5)) : null;
        if (!steering || block) { this.returning=false; this.peekAnchor=null; }
        else { out.forward=steering.forward; out.right=steering.right; return out; }
      }
    }
    const stop = this.autoStopPlan(session,out,now);
    const action = stop.kind === 'slowwalk' ? 'Slow walking' : stop.kind === 'counter' ? 'Counter-strafing' : 'Inactive';
    this.autoStopText = action + (stop.reason === 'predicted-peek' ? ` · predicted peek ~${Math.round(this.peekForecast?.etaMs ?? 0)} ms`
      : stop.reason === 'between-shots' ? ' · between shots' : '');
    return autoStopInput(out,s,stop);
  }
  private autoStopPlan(session: GameSession, frame: Pick<InputFrame,'jump'>, now: number): AutoStopPlan {
    const c = this.policy, phase = session.weapons.shotState(now), target = this.coreTarget;
    const validEnemy = (pid: number) => { const remote=session.remotes.players.get(pid); return !!remote?.latest?.alive && !remote.latest.shielded
      && !remote.latest.vehicle && !session.isFriendly(remote.info) && !this.playerRule(pid).ignore; };
    const forecast = this.peekForecast && now-this.peekForecastAt<=120 && session.serverNow()-this.peekForecast.observedAt<=200
      && this.peekForecast.etaMs<=c.hvh.movement.autoStopPredictMs
      && validEnemy(this.peekForecast.target) ? this.peekForecast : null;
    const recentShot = c.hvh.movement.autoStopBetweenShots && phase === 'Cooldown' && now-this.autoStopShotAt<session.weapons.fireInterval+300;
    return planAutoStop(c.hvh.movement,{assistedHvh:this.playing && session.mode.id==='hvh' && !session.weapons.def.melee && !session.weapons.def.projectile,
      grounded:session.local.onGround,jumping:frame.jump,occupied:!!this.peekAnchor || !!session.local.car,
      engaged:c.rage.aim.enabled && (c.rage.aim.autoTarget || this.dev.input.firing || c.hvh.movement.autoStopPredict || recentShot),weaponState:phase,
      target:!!target && session.serverNow()-target.record.t<=300 && validEnemy(target.target),stopSpeed:target?.stopSpeed,forecast});
  }
  aimOverride(): Vec3 | null {
    const session = this.session;
    if (!session || !this.playing || !this.policy.rage.aim.enabled || session.weapons.def.melee || session.weapons.def.projectile) return null;
    if (session.mode.id === 'hvh') {
      const target = this.coreTarget;
      return this.coreReady && target && shotRecordUsable(target.record.t, session.serverNow(), this.dev.ping() ?? 0) && session.remotes.players.get(target.target)?.latest?.alive
        ? normalize({ x: target.point.x - session.eye().x, y: target.point.y - session.eye().y, z: target.point.z - session.eye().z }) : null;
    }
    const target = this.target, eye = session.eye();
    return target?.r.alive && target.visible ? normalize({ x: target.point.x - eye.x, y: target.point.y - eye.y, z: target.point.z - eye.z }) : null;
  }
  shotIntent(): ShotIntent | undefined { return this.coreShot; }

  private beforeHvh(session: GameSession, now: number): void {
    const c = this.policy;
    if (!this.playing) { this.coreTarget = null; this.coreReady = false; this.coreShot = undefined; this.peekForecast = null; this.autoStopText='Inactive'; this.pid = 0; this.diagnostics.state = 'Paused'; return; }
    const serverNow = session.serverNow(), records: ObservableRecord[] = [];
    for (const [pid, remote] of session.remotes.players) {
      const s = remote.latest;
      if (!s?.alive || s.shielded || s.vehicle || session.isFriendly(remote.info) || this.playerRule(pid).ignore) continue;
      const t = s.simulationTime || remote.latestAt;
      const record: ObservableRecord = { pid, tick: Math.round(t / (1000 / 64)), t,
        origin: { x: s.x, y: s.y, z: s.z }, velocity: { x: (s.walkVx ?? 0) + s.vx, y: s.vy, z: (s.walkVz ?? 0) + s.vz },
        eyeYaw: s.yaw, pitch: s.fakePitch ?? s.pitch, lowerBodyYaw: s.lowerBodyYaw ?? s.yaw, speed: s.horizontalSpeed, crouch: s.crouchAmount ?? (s.crouching ? 1 : 0),
        grounded: s.onGround, turnWeight: s.turnWeight ?? 0, hp: s.hp, armor: s.armor, alive: s.alive,
        fired: false, concealed: s.hvhConcealed ?? false, defensive: s.hvhDefensive ?? false };
      this.coreResolver.observe(record, this.dev.panelId === 'skeet' ? c.skeet.resolver : { history: 16, memoryMs: 1000 });
      this.extensions.observe(record);
      records.push(...this.coreResolver.records(pid, serverNow));
    }
    const a = c.rage.aim;
    if (c.hvh.movement.autoStop && c.hvh.movement.autoStopPredict && a.enabled && !session.weapons.def.melee && !session.weapons.def.projectile) {
      if (now-this.peekForecastAt>=100) {
        this.peekForecastAt=now;
        const yaw=this.dev.input.yaw,pitch=this.dev.input.pitch;
        this.peekForecast=predictEnemyPeek({now:serverNow,eye:session.eye(),view:{x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)},
          fov:a.fov,range:session.weapons.def.range,horizonMs:c.hvh.movement.autoStopPredictMs,records,world:session.collision});
      }
    } else { this.peekForecast=null; this.peekForecastAt=-Infinity; }
    const trigger = c.legit.trigger, triggering = trigger.enabled && this.keyHeld(trigger.key);
    if (!a.enabled && !triggering) { this.coreTarget = null; this.coreReady = false; this.pid = 0; return; }
    if (now - this.coreScanAt >= 100) {
      this.coreScanAt = now; this.evaluations++;
      const profile = skeetProfile(c, session.weapons.def), skeet = this.dev.panelId === 'skeet';
      const eye = session.eye(), yaw = this.dev.input.yaw, pitch = this.dev.input.pitch;
      const visible = records.filter(r => {
        if (!shotRecordUsable(r.t, serverNow, this.dev.ping() ?? 0)) return false;
        const dx = r.origin.x - eye.x, dz = r.origin.z - eye.z, dy = r.origin.y + 0.8 - eye.y;
        const angle = Math.acos(Math.max(-1, Math.min(1, (dx * -Math.sin(yaw) * Math.cos(pitch) + dz * -Math.cos(yaw) * Math.cos(pitch) + dy * Math.sin(pitch)) / Math.hypot(dx, dy, dz))));
        return angle <= (a.enabled ? a.fov / 2 : trigger.fov) * DEG;
      });
      const next = scanRage({ now: serverNow, eye, w: session.weapons.def, speed: session.horizontalSpeed(), airborne: !session.local.onGround,
        heat: session.weapons.heat, playerRules: this.playerRules,
        scoreCandidate: candidate => this.extensions.score(candidate),
        allowScope: !skeet || profile.autoScope,
        allowStop: c.hvh.movement.autoStop,
        stopSpeed: c.hvh.movement.autoStopSlowWalk ? PLAYER.speed*moveSpeedFor(session.weapons.weapon)*PLAYER.slowWalkSpeed : 0,
        viewDirection: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
        forceDirection: !a.enabled && triggering ? { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) } : undefined,
        ads: this.dev.input.aiming || this.coreScoped, world: session.collision, records: visible, resolver: this.coreResolver, currentTarget: this.coreTarget?.target,
        isSoft: c.hvh.aim.autowall && session.mode.wallbang ? softBoxTest(session.map) : undefined,
        settings: { ...DEFAULT_RAGE, resolver: c.hvh.feedback.resolver && (!skeet || c.skeet.resolver.mode === 'adaptive'),
          resolverPolicy: c.hvh.resolverPolicy, preferBodyBelow: skeet ? c.skeet.resolver.preferBodyBelow / 100 : 0.5,
          bodyAfterMisses: skeet ? c.skeet.resolver.missedShots : 2,
          minDamage: this.keyHeld(c.hvh.aim.overrideKey, false) ? c.hvh.aim.damageOverride : c.hvh.aim.minDamage,
          hitchance: (session.local.onGround ? c.hvh.aim.hitchance : c.hvh.aim.airHitchance) / 100,
          forceSafe: skeet ? profile.safePoints : c.hvh.aim.forceSafe, preferSafe: c.hvh.aim.preferSafe,
          hpRelative: this.keyHeld(c.hvh.aim.overrideKey, false) || c.hvh.aim.hpRelative < 0 ? undefined : c.hvh.aim.hpRelative,
          damageWeight: c.hvh.aim.damageWeight, safetyWeight: c.hvh.aim.safetyWeight, accuracyWeight: c.hvh.aim.accuracyWeight, confidenceWeight: c.hvh.aim.confidenceWeight,
          groups: a.hitbox === 'body' ? ['stomach', 'chest', 'pelvis'] : a.hitbox === 'head' ? ['head', 'stomach', 'chest'] : ['head', 'chest', 'stomach', 'pelvis', 'arm', 'leg'],
          priority: a.priority, burstReady: c.hvh.exploit === 'doubleTap' && (session.local.server.hvhCharge ?? 0) >= 1 && session.weapons.def.fireInterval <= 500,
          body: this.keyHeld(c.hvh.aim.bodyKey, false) ? 'force' : c.hvh.aim.bodyAim,
          pointScale: skeet ? profile.multipoint ? profile.pointScale / 100 : 0 : c.hvh.aim.multipoint ? c.hvh.aim.pointScale / 100 : 0, maxRecords: c.hvh.aim.maxRecords } });
      if (next && next.target !== this.coreTarget?.target) { this.acquiredAt = now; this.switchingUntil = !this.rageTiming && this.coreTarget ? now + c.hvh.aim.switchDelay : now; }
      this.coreTarget = next; this.pid = next?.target ?? 0;
    }
    const target = this.coreTarget;
    if (!target) { this.coreReady = false; this.coreScoped = false; this.diagnostics = { target: 'No valid candidate', damage: 0, chance: 0, state: this.peekForecast ? 'Preparing for predicted peek' : 'Scanning' }; return; }
    const bodyRule = this.playerRule(target.target).body;
    if (bodyRule && target.group === 'head') { this.coreReady = false; this.coreScanAt = -Infinity; return; }
    this.coreScoped = session.weapons.def.scope && (this.coreScoped || target.scope);
    this.dev.input.assistedAds = this.coreScoped;
    const stable = this.rageTiming || (now >= this.switchingUntil && now - this.acquiredAt >= Math.max(c.hvh.aim.reaction, triggering ? trigger.delay : 0));
    const stop = this.autoStopPlan(session,{jump:this.dev.input.isDown(getKeybinds().jump)},now);
    const stopLimit = stop.kind === 'slowwalk' ? PLAYER.speed*moveSpeedFor(session.weapons.weapon)*PLAYER.slowWalkSpeed+0.1 : 0.5;
    this.coreReady = stable && !target.scope && !target.stop && (stop.kind === 'off' || session.horizontalSpeed() <= stopLimit);
    // Both manual and automatic assisted shots use shot angles; the view stays under player control.
    this.diagnostics = { target: session.remotes.players.get(target.target)?.info.name ?? 'Opponent', damage: Math.round(target.damage),
      chance: Math.round(target.chance * 100), state: target.scope ? 'Scoping' : !stable ? 'Acquiring target' : this.coreReady ? 'Ready' : stop.kind==='slowwalk' ? 'Slow walking for accuracy' : 'Waiting for accuracy' };
  }
  recoilScale(): number { return 1; }
  blocksShooting(): boolean { return false; }
  controlCamera(): boolean { return false; }
  bodyAngles(): { yaw:number; pitch:number } | null {
    const s = this.session;
    if (!this.playing || !s || this.dev.status.profile !== 'hvh') return null;
    if (!this.dev.status.hvh?.antiAim.enabled) return null;
    const pose = hvhPose(this.dev.input.yaw, this.dev.status.hvh ?? defaultHvhLoadout(), s.serverNow(), this.keyHeld(this.dev.config.hvh.invertKey,false), false);
    return { yaw: s.local.server.fakeYaw ?? pose.fake, pitch: s.local.server.fakePitch ?? this.dev.input.pitch };
  }
  afterFrame(session: GameSession): void {
    if (this.playing && session.mode.id === 'hvh') this.extensions.render();
    const skeet = this.active && this.dev.panelId === 'skeet';
    this.binds.hidden = !skeet || !this.dev.config.skeet.indicators.binds;
    this.watermark.hidden = !skeet || !this.dev.config.skeet.indicators.watermark;
    const native=skeet ? this.dev.config.skeet.native : null;
    if(this.nativeRenderValues!==native){this.nativeRenderValues=native;this.styledPlayers.clear();}
    const weaponChams=nativeOn(native,'Visuals.ColoredModels.weapons');
    session.setWeaponTint(weaponChams ? nativeColor(native!,'Color.ColoredModels.weapons') : skeet && this.dev.config.skeet.cosmetics.enabled ? this.dev.config.skeet.cosmetics.tint : null,
      weaponChams ? nativeValue(native,'Visuals.ColoredModels.weaponsMaterial') : 0, weaponChams ? nativeValue(native,'Color.ColoredModels.weapons_3',1) : 1);
    for (const r of session.remotes.players.values()) {
      const team=session.isFriendly(r.info);
      if(native && team && nativeOn(native,'Visuals.Effects.disableRenderingOfTeammates')){r.chicken.root.visible=false;this.hiddenTeammates.add(r.info.pid);}
      else if(this.hiddenTeammates.delete(r.info.pid))r.chicken.root.visible=r.alive;
      if(!this.styledPlayers.has(r.info.pid)){r.chicken.root.traverse(node => { if (node instanceof THREE.Mesh) node.frustumCulled=!nativeOn(native,'Visuals.ColoredModels.disableModelOcclusion'); });this.styledPlayers.add(r.info.pid);}
      const enabled=native && nativeOn(native,'Visuals.ColoredModels.player') && (!team || nativeOn(native,'Visuals.ColoredModels.teammates'));
      r.chicken.setChams(enabled ? this.chamsFor(team?'team':'enemy',native!,nativeValue(native,'Visuals.ColoredModels.playerMaterial'),team?'Color.ColoredModels.teammates':'Color.ColoredModels.player') : null);
      r.chicken.setShadow(nativeOn(native,'Visuals.ColoredModels.shadow') ? nativeColor(native!,'Color.ColoredModels.shadow') : null,nativeValue(native,'Color.ColoredModels.shadow_3',.25));
    }
    session.local.chicken.setShadow(nativeOn(native,'Visuals.ColoredModels.shadow') ? nativeColor(native!,'Color.ColoredModels.shadow') : null,nativeValue(native,'Color.ColoredModels.shadow_3',.25));
    session.projectiles.setGlow(nativeOn(native,'Visuals.Other.glowGrenades') ? nativeColor(native!,'Color.Other.glowGrenades') : null,nativeValue(native,'Color.Other.glowGrenades_3',1));
    this.debug3d?.update(this.active ? this.dev.config : null);
    this.overlay.render(this.active ? session : null, this);
    this.info.hidden = !this.active || !(this.dev.config.hvh.feedback.targetInfo || this.dev.config.hvh.feedback.shotLog || (skeet && this.dev.config.skeet.indicators.resolver));
    if (performance.now()-this.lastInfoAt<150) return;
    this.lastInfoAt=performance.now();
    if (!this.watermark.hidden) this.watermark.textContent = `skeet · chicken hvh · ${Math.round(this.dev.fps())} fps · ${this.dev.ping() ?? '—'} ms`;
    const c=this.dev.config.hvh, d=this.diagnostics;
    const charge=Math.round((session.local.server.hvhCharge??0)*100);
    const stopText = this.policy.hvh.movement.autoStop ? `\n${this.autoStopText}` : '';
    const lines=[c.feedback.targetInfo ? `${d.target} · ~${d.damage} HP · ${d.chance}%\n${d.state} · ${this.peekState}${stopText}\n${c.exploit === 'off' ? 'EXPLOIT OFF' : c.exploit === 'doubleTap' ? 'DOUBLE TAP' : 'HIDE SHOTS'} · ${charge}% charge` : '', skeet && this.dev.config.skeet.indicators.resolver ? this.resolverInfo : '', c.feedback.shotLog ? this.logs.slice(0,3).join('\n') : ''].filter(Boolean);
    if (!this.binds.hidden) {
      const h = this.dev.config.hvh, active = (key: string) => this.keyHeld(key, false) ? 'active' : 'hold';
      this.binds.textContent = ['keybinds', `body aim · ${active(h.aim.bodyKey)}`, `damage override · ${active(h.aim.overrideKey)}`,
        `slow walk · ${this.dev.input.isDown('ShiftLeft') || this.dev.input.isDown('ShiftRight') ? 'active' : 'hold Shift'}`, `auto peek · ${h.movement.peekAssist ? this.peekState : 'off'}`, `invert · ${active(h.invertKey)}`].join('\n');
    }
    const key=lines.join('\n');
    if(key!==this.infoKey){this.infoKey=key;this.info.textContent=key;}
  }
  private chamsFor(slot: string, n: Readonly<Record<string,number>>, kind: number, color: string): THREE.MeshStandardMaterial | THREE.MeshBasicMaterial {
    const key=`${slot}/${kind}`;let m=this.chams.get(key);
    if(!m){m=kind===1||kind===4 ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial({roughness:kind===3?.15:.8,metalness:kind===3?1:0,wireframe:kind===5});this.chams.set(key,m);}
    m.color.set(nativeColor(n,color));m.opacity=nativeValue(n,`${color}_3`,1);const transparent=m.opacity<1||kind===4;if(m.transparent!==transparent)m.needsUpdate=true;m.transparent=transparent;m.depthWrite=!m.transparent;m.blending=kind===4?THREE.AdditiveBlending:THREE.NormalBlending;
    if(m instanceof THREE.MeshStandardMaterial && kind===3){m.emissive.set(nativeColor(n,'Color.ColoredModels.playerReflectivityColor'));m.emissiveIntensity=.15;}
    return m;
  }
  xrayFor(session: GameSession, r: RemotePlayer): THREE.Material | null {
    const native=session.hvhVisuals;
    if(native && r.alive && nativeOn(native,'Visuals.ColoredModels.player') && nativeOn(native,'Visuals.ColoredModels.playerBehindWall')) {
      const team=session.isFriendly(r.info);if(team && !nativeOn(native,'Visuals.ColoredModels.teammates'))return null;
      const m=team?this.friendly:this.enemy;m.color.set(nativeColor(native,'Color.ColoredModels.playerBehindWall'));m.opacity=nativeValue(native,'Color.ColoredModels.playerBehindWall_3',1);return m;
    }
    const w=this.dev.config.legit.wall;
    if (!this.active || !w.enabled || !r.alive) return null;
    const team=session.isFriendly(r.info); if(team ? !w.teammates : !w.enemies) return null;
    const m=team?this.friendly:this.enemy; m.color.set(team?w.teamColor:w.enemyColor); m.opacity=w.opacity; return m;
  }
  candidates(session: GameSession, part:'head'|'body'|'nearest', _skipFriendly:boolean, onlyPid?:number): Candidate[] {
    const config = this.policy, skeet = this.dev.panelId === 'skeet', profile = skeetProfile(config, session.weapons.def);
    const out:Candidate[]=[], eye=session.eye();
    const yaw=this.dev.input.yaw,pitch=this.dev.input.pitch;
    const forward=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    for(const [pid,r] of session.remotes.players){
      if(onlyPid !== undefined && onlyPid !== pid) continue;
      if(skeet && this.playerRule(pid).ignore) continue;
      if(!r.alive || r.latest?.alive === false || session.serverNow()-r.latestAt>500 || session.isFriendly(r.info) || r.latest?.shielded || r.latest?.vehicle) continue;
      const k=r.scale;
      const heading=HVH_PANELS[this.dev.panelId].resolveYaw(r,this.dev.config);
      const head=new THREE.Vector3().copy(chickenHeadCenter(r.position,heading,k,r.pitch));
      const body=new THREE.Vector3(r.position.x,r.position.y+HITBOX.bodyHeight*0.55*k,r.position.z);
      const angleTo=(point:THREE.Vector3)=>forward.angleTo(point.clone().sub(session.camera.position));
      const preferBody = skeet && this.playerRule(pid).body;
      const center=preferBody ? body : part==='head'?head:part==='nearest'&&angleTo(head)<angleTo(body)?head:body;
      const targetPart = center === head ? 'head' : 'body';
      const tracked = onlyPid !== undefined && this.target?.pid === pid && this.target.part === targetPart ? this.target.offset : undefined;
      const offsets = tracked ? [tracked] : skeetPointOffsets(targetPart, k, profile.pointScale, skeet && profile.multipoint);
      let point = center, offset: Vec3 | undefined, visible = false;
      for (const candidate of offsets) {
        const p = center.clone().add(new THREE.Vector3(candidate.x, candidate.y, candidate.z));
        const delta = p.clone().sub(new THREE.Vector3(eye.x, eye.y, eye.z)), length = delta.length();
        if (length < 0.01) continue;
        const path = makeRay(eye, { x: delta.x / length, y: delta.y / length, z: delta.z / length });
        const cover = config.hvh.aim.autowall && session.mode.wallbang ? raycastPenetrating(path, session.collision, length, softBoxTest(session.map), WALLBANG.maxBoxes).wall : raycastWorld(path, session.collision, length);
        const clear = !cover || cover.t >= length - 0.01;
        if (!visible || (clear && angleTo(p) < angleTo(point))) { point = p; offset = candidate; visible = clear; }
        if (clear && candidate.x === 0 && candidate.y === 0 && candidate.z === 0) break;
      }
      const distance=point.distanceTo(new THREE.Vector3(eye.x,eye.y,eye.z));
      if(distance<0.01)continue;
      out.push({pid,r,point,part:targetPart,offset,angle:angleTo(point),distance,hp:r.latest?.hp??100,visible,target:{x:r.position.x,y:r.position.y,z:r.position.z,yaw:heading,pitch:r.pitch,scale:k,hp:r.latest?.hp??100,armor:r.latest?.armor??0}});
    }
    return out;
  }
  private keyHeld(code:string, emptyMeansAlways=true):boolean { return code ? this.dev.input.isDown(code) : emptyMeansAlways; }
}
