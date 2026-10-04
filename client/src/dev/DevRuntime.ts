import * as THREE from 'three';
import { CROUCH, HITBOX, PLAYER, defaultHvhLoadout, hvhPose, makeRay, normalize, raycastWorld, raycastPenetrating, softBoxTest, wallbangScale, WALLBANG, wrapAngle, type InputFrame, type Vec3 } from '@game/shared';
import type { DevHooks, GameSession } from '../game/GameSession';
import type { RemotePlayer } from '../game/RemotePlayers';
import { h } from '../ui/dom';
import type { Dev } from './Dev';
import { HVH_PANELS } from './panels';
import { DevDebug3D } from './DevDebug3D';
import { DevOverlay } from './DevOverlay';
import { boundedTurn, estimateShot, peekSteering, shotGate, type ShotTarget } from './tactics';

const DEG = Math.PI / 180;
export interface Candidate { pid: number; r: RemotePlayer; point: THREE.Vector3; angle: number; distance: number; hp: number; visible: boolean; part: 'head' | 'body'; target: ShotTarget }
const xrayMaterial = () => new THREE.MeshBasicMaterial({ depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });

/** Bounded assists plus explicit, server-governed HvH abilities. */
export class DevRuntime implements DevHooks {
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
  private readonly info = h('div', { class: 'dev-tactical', role: 'status', 'aria-live': 'off' });
  private infoKey = '';
  private lastInfoAt = 0;
  private readonly logs: string[] = [];
  diagnostics = { target: 'No target', damage: 0, chance: 0, state: 'Idle' };

  constructor(private readonly dev: Dev) {
    this.overlay = new DevOverlay(dev);
    this.info.hidden = true;
    (document.getElementById('hud-layer') ?? document.body).append(this.info);
  }
  get currentSession(): GameSession | null { return this.session; }
  get focusPid(): number { return this.pid; }
  get peekState(): string { return this.returning ? 'Returning' : this.peekAnchor ? 'Anchor set' : 'Inactive'; }
  get shotLog(): readonly string[] { return this.logs; }
  private get active(): boolean { return this.dev.active && this.session !== null; }
  private get playing(): boolean { return this.active && this.dev.input.active && !this.dev.menuOpen && this.session!.local.alive && !this.session!.local.car; }
  attach(session: GameSession): void { this.session = session; this.debug3d = new DevDebug3D(session); this.reset(); this.dev.sessionStarted(); }
  detach(session: GameSession): void {
    if (this.session !== session) return;
    this.debug3d?.dispose(); this.debug3d = null; this.session = null;
    this.overlay.clear(); this.reset(); this.dev.sessionEnded();
  }
  private reset(): void {
    this.target = null; this.lastScanAt = -Infinity; this.nextEstimateAt = 0;
    this.pid = 0; this.ready = false; this.acquiredAt = this.switchingUntil = 0;
    this.peekAnchor = null; this.returning = this.peekHeld = false;
    this.logs.length = 0; this.info.hidden = true;
    this.diagnostics = { target: 'No target', damage: 0, chance: 0, state: 'Idle' };
  }
  applyServerMods(): void {
    if (!this.session) return;
    // The panel never predicts stat changes, even in a legacy admin test room.
    this.session.local.mods = this.session.weapons.mods = null;
    this.session.weapons.hvh = this.session.mode.id === 'hvh' && this.dev.status.profile === 'hvh' ? this.dev.status.hvh ?? defaultHvhLoadout() : defaultHvhLoadout();
  }
  beforeFrame(session: GameSession, dt: number, now: number): void {
    session.weapons.forceAutomatic = false;
    const c = this.dev.config;
    this.dev.hud.showCrosshair = !this.active || c.misc.crosshair;
    this.dev.hud.showHitmarker = !this.active || c.misc.hitmarker;
    this.dev.hud.showDamageIndicators = !this.active || c.misc.damageIndicator;
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
    const fov = (a.enabled ? a.fov : trigger.fov) * DEG;
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
        this.switchingUntil = this.pid ? now + c.hvh.aim.switchDelay : now;
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
    if (a.enabled && now >= this.switchingUntil && now - this.acquiredAt >= c.hvh.aim.reaction) {
      const eye = session.camera.position, p = live.point;
      const wantYaw = Math.atan2(-(p.x-eye.x), -(p.z-eye.z));
      const wantPitch = Math.atan2(p.y-eye.y, Math.hypot(p.x-eye.x,p.z-eye.z));
      this.dev.input.yaw = boundedTurn(this.dev.input.yaw, wantYaw, c.hvh.aim.turnRate, dt);
      const step = c.hvh.aim.turnRate * DEG * Math.max(0, Math.min(0.05, dt));
      this.dev.input.pitch = Math.max(-1.25, Math.min(1.1, this.dev.input.pitch + Math.max(-step, Math.min(step, wantPitch-this.dev.input.pitch))));
    }
  }

  /** Called after movement, remote interpolation and the camera have updated for this frame. */
  wantsFire(now = performance.now()): boolean {
    const session = this.session, c = this.dev.config, a = c.rage.aim, trigger = c.legit.trigger;
    if (!this.playing || !session || !this.target) return false;
    const assisting = a.enabled ? a.autoTarget : trigger.enabled && this.keyHeld(trigger.key);
    if (!assisting) { this.ready = false; this.diagnostics.state = 'Aim only'; return false; }
    const part = this.keyHeld(c.hvh.aim.bodyKey, false) ? 'body' : this.target.part;
    const target = this.candidates(session, part, true, this.pid)[0];
    if (!target?.visible || target.angle > (a.enabled ? a.fov : trigger.fov)*DEG) {
      this.ready = false; this.diagnostics.state = 'Waiting for sight'; return false;
    }
    const w = session.weapons.def;
    if (w.projectile || w.melee) { this.ready = false; this.diagnostics.state = 'Manual weapon'; return false; }
    const reaction = a.enabled ? c.hvh.aim.reaction : trigger.delay;
    if (now < this.switchingUntil || now-this.acquiredAt < Math.max(100, reaction)) {
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
    const eye = session.eye(), direction = session.aimDirection(eye);
    const autowall = c.hvh.aim.autowall && session.mode.wallbang;
    const estimate = estimateShot(w, eye, direction, target.target, session.horizontalSpeed(), !session.local.onGround, this.dev.input.aiming,
      undefined, undefined, (ray, range) => {
        const hit = session.raycastScene(ray, range, autowall);
        return hit.pid === target.pid ? { t:hit.t, headshot:hit.headshot, scale:wallbangScale(hit.soft,hit.t) } : null;
      });
    const minimum = this.keyHeld(c.hvh.aim.overrideKey, false) ? c.hvh.aim.damageOverride : c.hvh.aim.minDamage;
    const state = shotGate(estimate, minimum, c.hvh.aim.hitchance, target.hp, now-this.acquiredAt, reaction);
    this.diagnostics = { target:target.r.info.name, damage:Math.round(estimate.damage), chance:Math.round(estimate.chance), state };
    this.ready = state === 'Ready';
    return this.ready;
  }
  onShot(session: GameSession): void {
    if (!this.active) return;
    if (this.peekAnchor && this.peekHeld) { this.returning = true; this.peekReturnAt = performance.now(); }
    const d = this.diagnostics;
    const text = `${session.weapons.def.name} → ${d.target} · ~${d.damage} HP / ${d.chance}%`;
    this.logs.unshift(text); if (this.logs.length > 5) this.logs.pop();
  }
  modifyFrame(session: GameSession, frame: InputFrame): InputFrame {
    if (!this.playing) return frame;
    const c = this.dev.config, s = session.local.state;
    const out = { ...frame, invert: this.keyHeld(c.hvh.invertKey, false) };
    const now = performance.now();
    const moving = frame.forward !== 0 || frame.right !== 0;
    if (c.legit.move.jumpAssist) {
      if (frame.jump && !this.lastJump && !s.onGround) this.jumpBufferUntil = now + 160;
      if (s.onGround && now < this.jumpBufferUntil) { out.jump = true; this.jumpBufferUntil = 0; }
    }
    this.lastJump = frame.jump;
    if (s.onGround && ((c.legit.move.bhop && moving) || c.misc.autoJump)) out.jump = true;
    if (c.legit.move.autoStrafe && !s.onGround && out.right === 0) {
      const turn = wrapAngle(out.yaw-this.lastYaw); if (Math.abs(turn)>0.002) out.right = turn < 0 ? 1 : -1;
    }
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
    if (c.hvh.movement.autoStop && c.rage.aim.enabled && (c.rage.aim.autoTarget || this.dev.input.firing) && this.pid && !this.peekAnchor && s.onGround && !frame.jump) out.forward=out.right=0;
    else if (c.hvh.movement.slowWalk && this.keyHeld(c.hvh.movement.slowKey,false) && s.onGround) { out.forward*=0.45; out.right*=0.45; }
    return out;
  }
  aimOverride(): Vec3 | null { return null; }
  recoilScale(): number { return 1; }
  blocksShooting(): boolean { return false; }
  controlCamera(): boolean { return false; }
  bodyAngles(): { yaw:number; pitch:number } | null {
    const s = this.session;
    if (!this.playing || !s || this.dev.status.profile !== 'hvh') return null;
    if (!this.dev.status.hvh?.antiAim.enabled) return null;
    const pose = hvhPose(this.dev.input.yaw, this.dev.status.hvh ?? defaultHvhLoadout(), s.serverNow(), this.keyHeld(this.dev.config.hvh.invertKey,false), false);
    return { yaw: s.local.server.hvhConcealed ? pose.fake : s.local.server.fakeYaw ?? pose.fake, pitch:this.dev.input.pitch };
  }
  afterFrame(session: GameSession): void {
    this.debug3d?.update(this.active ? this.dev.config : null);
    this.overlay.render(this.active ? session : null, this);
    this.info.hidden = !this.active || !(this.dev.config.hvh.feedback.targetInfo || this.dev.config.hvh.feedback.shotLog);
    if (this.info.hidden || performance.now()-this.lastInfoAt<150) return;
    this.lastInfoAt=performance.now();
    const c=this.dev.config.hvh, d=this.diagnostics;
    const charge=Math.round((session.local.server.hvhCharge??0)*100);
    const lines=[c.feedback.targetInfo ? `${d.target} · ~${d.damage} HP · ${d.chance}%\n${d.state} · ${this.peekState}\n${c.exploit === 'off' ? 'EXPLOIT OFF' : c.exploit === 'doubleTap' ? 'DOUBLE TAP' : 'HIDE SHOTS'} · ${charge}% charge` : '',c.feedback.shotLog ? this.logs.slice(0,3).join('\n') : ''].filter(Boolean);
    const key=lines.join('\n');
    if(key!==this.infoKey){this.infoKey=key;this.info.textContent=key;}
  }
  xrayFor(session: GameSession, r: RemotePlayer): THREE.Material | null {
    const w=this.dev.config.legit.wall;
    if (!this.active || !w.enabled || !r.alive) return null;
    const team=session.isFriendly(r.info); if(team ? !w.teammates : !w.enemies) return null;
    const m=team?this.friendly:this.enemy; m.color.set(team?w.teamColor:w.enemyColor); m.opacity=w.opacity; return m;
  }
  candidates(session: GameSession, part:'head'|'body'|'nearest', _skipFriendly:boolean, onlyPid?:number): Candidate[] {
    const out:Candidate[]=[], eye=session.eye();
    const yaw=this.dev.input.yaw,pitch=this.dev.input.pitch;
    const forward=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    for(const [pid,r] of session.remotes.players){
      if(onlyPid !== undefined && onlyPid !== pid) continue;
      if(!r.alive || r.latest?.alive === false || session.serverNow()-r.latestAt>500 || session.isFriendly(r.info) || r.latest?.shielded || r.latest?.vehicle) continue;
      const k=r.latest?.crouching?CROUCH.scale:1;
      const heading=HVH_PANELS[this.dev.panelId].resolveYaw(r,this.dev.config);
      const head=new THREE.Vector3(r.position.x-Math.sin(heading)*HITBOX.headForward*k,r.position.y+HITBOX.headHeight*k,r.position.z-Math.cos(heading)*HITBOX.headForward*k);
      const body=new THREE.Vector3(r.position.x,r.position.y+HITBOX.bodyHeight*0.55*k,r.position.z);
      const angleTo=(point:THREE.Vector3)=>forward.angleTo(point.clone().sub(session.camera.position));
      const point=part==='head'?head:part==='nearest'&&angleTo(head)<angleTo(body)?head:body;
      const distance=point.distanceTo(new THREE.Vector3(eye.x,eye.y,eye.z));
      if(distance<0.01)continue;
      const dir=normalize({x:point.x-eye.x,y:point.y-eye.y,z:point.z-eye.z});
      const ray=makeRay(eye,dir);
      const cover=this.dev.config.hvh.aim.autowall && session.mode.wallbang ? raycastPenetrating(ray,session.collision,distance,softBoxTest(session.map),WALLBANG.maxBoxes).wall : raycastWorld(ray,session.collision,distance);
      out.push({pid,r,point,part:point===head?'head':'body',angle:angleTo(point),distance,hp:r.latest?.hp??100,visible:!cover||cover.t>=distance-0.01,target:{x:r.position.x,y:r.position.y,z:r.position.z,yaw:heading,scale:k,hp:r.latest?.hp??100,armor:r.latest?.armor??0}});
    }
    return out;
  }
  private keyHeld(code:string, emptyMeansAlways=true):boolean { return code ? this.dev.input.isDown(code) : emptyMeansAlways; }
}
