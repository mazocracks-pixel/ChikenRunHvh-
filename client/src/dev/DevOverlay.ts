import * as THREE from 'three';
import { CHICKEN_POSE, chickenHeadCenter, chickenHeadPose, HITBOX, PLAYER, TEAM_COLORS, TEAM_NAMES, WEAPONS, PROJECTILES, SIM_DT, stepProjectile, hvhSpread, directionFromAngles, makeRay, type PickupKind, type ShotEvent } from '@game/shared';
import type { GameSession } from '../game/GameSession';
import { h, hex } from '../ui/dom';
import type { Dev } from './Dev';
import type { DevRuntime } from './DevRuntime';
import { nativeOn, nativeValue, nativeColor, type NativeValues } from './skeet/visualValues';

const PICKUP_NAMES: Record<PickupKind, string> = { medkit: 'Medkit', armor: 'Armor', fuel: 'Jetpack fuel', eggs: 'Eggs' };

/** Chicken "bones" in its own space (origin at the feet, facing -Z), for the skeleton ESP. */
const JOINTS = {
  footL: [-0.14, 0.02, -0.05],
  footR: [0.14, 0.02, -0.05],
  hipL: [-0.14, 0.45, 0.02],
  hipR: [0.14, 0.45, 0.02],
  pelvis: [0, 0.55, 0.05],
  chest: [0, 0.88, -0.05],
  neck: [0, 1.06, -0.24],
  head: [0, HITBOX.headHeight, -HITBOX.headForward],
  beak: [0, 1.22, -0.6],
  wingL: [-0.42, 0.82, 0.02],
  wingR: [0.42, 0.82, 0.02],
  tail: [0, 1.02, 0.45],
} as const;
type Joint = keyof typeof JOINTS;
const BONES: [Joint, Joint][] = [
  ['footL', 'hipL'],
  ['footR', 'hipR'],
  ['hipL', 'pelvis'],
  ['hipR', 'pelvis'],
  ['pelvis', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['head', 'beak'],
  ['chest', 'wingL'],
  ['chest', 'wingR'],
  ['pelvis', 'tail'],
];

/**
 * Screen-space developer visuals drawn on a 2D canvas over the game (ESP boxes, names, lines,
 * world markers) plus a small text panel (fps, ping, coordinates, speed, map info).
 */
export class DevOverlay {
  private readonly dev: Dev;
  private readonly canvas = h('canvas', { class: 'dev-overlay' });
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel = h('div', { class: 'dev-info' });
  private readonly fps = h('div', { class: 'dev-fps' });
  private readonly v = new THREE.Vector3();
  private readonly viewPos = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private lastTime = 0;
  private drewSomething = false;
  private panelKey = '';
  private sounds: {x:number;y:number;z:number;at:number}[] = [];

  sound(shot: ShotEvent): void {
    if(!this.dev.active||this.dev.panelId!=='skeet'||shot.pid===this.dev.runtime.currentSession?.selfPid)return;
    this.sounds.push({x:shot.ox,y:shot.oy,z:shot.oz,at:performance.now()});
    if(this.sounds.length>32)this.sounds.shift();
  }

  constructor(dev: Dev) {
    this.dev = dev;
    this.ctx = this.canvas.getContext('2d')!;
    this.panel.hidden = true;
    this.fps.hidden = true;
    const layer = document.getElementById('hud-layer') ?? document.body;
    layer.prepend(this.canvas);
    layer.append(this.panel, this.fps);
  }

  clear(): void {
    this.sounds.length = 0;
    if (this.drewSomething) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drewSomething = false;
    this.panel.hidden = true;
    this.fps.hidden = true;
  }

  render(session: GameSession | null, runtime: DevRuntime): void {
    if (!session) {
      this.clear();
      return;
    }
    const c = this.dev.config;
    this.updatePanel(session);
    const native=this.dev.panelId==='skeet'?c.skeet.native:null;
    const esp = native ? true : c.visuals.esp.enabled;
    const world = c.visuals.world;
    const anyWorld = world.items || world.weapons || world.spawns || world.objectives;
    if (!esp && !anyWorld) {
      if (this.drewSomething) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drewSomething = false;
      }
      return;
    }

    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hgt * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hgt * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    g.globalAlpha = c.visuals.colors.opacity;
    g.font = '600 11px system-ui, "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    this.drewSomething = true;
    session.camera.updateMatrixWorld();

    if (anyWorld) this.drawWorld(session, w, hgt);
    if (esp) this.drawPlayers(session, runtime, w, hgt);
    g.globalAlpha=c.visuals.colors.opacity;
    if(native)this.drawNative(session,native,w,hgt);
    g.globalAlpha = 1;
  }

  /** World point → CSS pixels, or null when behind the camera / far off screen. */
  private project(session: GameSession, x: number, y: number, z: number, w: number, hgt: number): { x: number; y: number } | null {
    const cam = session.camera;
    this.viewPos.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    if (this.viewPos.z > -0.1) return null;
    this.v.set(x, y, z).project(cam);
    if (Math.abs(this.v.x) > 1.5 || Math.abs(this.v.y) > 1.5) return null;
    return { x: (this.v.x * 0.5 + 0.5) * w, y: (-this.v.y * 0.5 + 0.5) * hgt };
  }

  private drawPlayers(session: GameSession, runtime: DevRuntime, w: number, hgt: number): void {
    const c = this.dev.config;
    const n=this.dev.panelId==='skeet'?c.skeet.native:null;
    const e = n ? {...c.visuals.esp,box:nativeOn(n,'Visuals.Players.boundingBox'),health:nativeOn(n,'Visuals.Players.healthBar'),name:nativeOn(n,'Visuals.Players.name'),weapon:nativeOn(n,'Visuals.Players.weaponText'),distance:nativeOn(n,'Visuals.Players.distance'),skeleton:nativeOn(n,'Visuals.Players.skeleton'),snaplines:false,headCircle:false} : c.visuals.esp;
    const colors = c.visuals.colors;
    const g = this.ctx;
    const camPos = session.camera.position;
    for (const [pid, r] of session.remotes.players) {
      if (!r.alive || (n && session.isFriendly(r.info)&&!nativeOn(n,'Visuals.Players.teammates'))) continue;
      const stale=session.serverNow()-r.latestAt>250 || r.culled;
      if(n&&stale&&!nativeOn(n,'Visuals.Players.dormant'))continue;
      g.globalAlpha=colors.opacity*(stale ? .4 : 1);
      const p = r.position;
      const feet = this.project(session, p.x, p.y, p.z, w, hgt);
      const top = this.project(session, p.x, p.y + PLAYER.height + 0.12, p.z, w, hgt);
      if (!feet || !top) {
        if(n&&nativeOn(n,'Visuals.Players.outOfFOVArrow')){
          const bearing=Math.atan2(p.x-camPos.x,p.z-camPos.z)+session.camera.rotation.y;
          const distance=Math.min(w,hgt)*.45*nativeValue(n,'Visuals.Players.arrowDistance',75)/100,size=nativeValue(n,'Visuals.Players.arrowSize',12);
          const x=w/2+Math.sin(bearing)*distance,y=hgt/2+Math.cos(bearing)*distance;
          g.save();g.translate(x,y);g.rotate(-bearing);g.fillStyle=nativeColor(n,'Color.Players.outOfFOVArrow');g.beginPath();g.moveTo(0,size);g.lineTo(-size*.55,-size*.6);g.lineTo(size*.55,-size*.6);g.closePath();g.fill();g.restore();
        }
        continue;
      }
      const color = r.info.bot ? colors.npc : session.isFriendly(r.info) ? colors.friendly : colors.enemy;
      const boxH = Math.max(6, feet.y - top.y);
      const boxW = boxH * 0.62;
      const left = feet.x - boxW / 2;
      const focused = runtime.focusPid === pid;

      if (e.snaplines) this.line(w / 2, hgt, feet.x, feet.y, color, 1);
      if (e.box) {
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeRect(left, top.y, boxW, boxH);
        g.lineWidth = focused ? 2 : 1;
        g.strokeStyle = n?nativeColor(n,'Color.Players.boundingBox'):color;
        g.strokeRect(left, top.y, boxW, boxH);
      }
      if (e.health) {
        const hp = Math.max(0, Math.min(1, (r.latest?.hp ?? PLAYER.maxHealth) / PLAYER.maxHealth));
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillRect(left - 6, top.y - 1, 4, boxH + 2);
        g.fillStyle = `hsl(${Math.round(hp * 120)}, 90%, 50%)`;
        g.fillRect(left - 5, top.y + boxH * (1 - hp), 2, boxH * hp);
      }
      const scale = r.scale;
      if (e.skeleton) this.drawSkeleton(session, r.position, r.yaw, n?nativeColor(n,'Color.Players.skeleton'):color, w, hgt, r.pitch, scale);
      if(n&&nativeOn(n,'Visuals.Players.lineOfSight')){
        const dir=directionFromAngles(r.yaw,r.pitch),end=this.project(session,p.x+dir.x*4,p.y+1+dir.y*4,p.z+dir.z*4,w,hgt);
        if(end)this.line(feet.x,top.y+boxH*.25,end.x,end.y,nativeColor(n,'Color.Players.lineOfSight'),1.5);
      }
      if(n&&nativeOn(n,'Visuals.Players.flags')&&r.latest){
        const s=r.latest,flags=[s.shielded?'SHIELD':'',s.crouching?'DUCK':'',!s.onGround?'AIR':'',s.reloading?'RELOAD':'',s.aiming?'ADS':'',s.carryingFlag?'FLAG':''].filter(Boolean);
        flags.forEach((flag,i)=>this.label(flag,left+boxW+5,top.y+7+i*12,color,'left'));
      }
      if(n&&nativeOn(n,'Visuals.Players.ammo')&&r.latest){const mag=r.latest.mag,max=WEAPONS[r.latest.weapon].magazine;g.fillStyle='#101010';g.fillRect(left,feet.y+2,boxW,3);g.fillStyle=nativeColor(n,'Color.Players.ammo');g.fillRect(left,feet.y+2,boxW*Math.max(0,Math.min(1,mag/max)),3);}
      if(n&&nativeOn(n,'Visuals.Players.weaponIcon')&&r.latest)this.label(WEAPONS[r.latest.weapon].melee?'†':WEAPONS[r.latest.weapon].scope?'⌖':'━',feet.x,feet.y+10,nativeColor(n,'Color.Players.weaponIcon'),'center');
      if (e.headCircle) {
        const center = chickenHeadCenter(p,r.yaw,scale,r.pitch);
        const head = this.project(session, center.x, center.y, center.z, w, hgt);
        const rim = this.project(session, center.x, center.y + HITBOX.headRadius * scale, center.z, w, hgt);
        if (head && rim) {
          g.beginPath();
          g.arc(head.x, head.y, Math.max(2, head.y - rim.y), 0, Math.PI * 2);
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      const labels: string[] = [];
      if (e.distance) labels.push(`${Math.round(camPos.distanceTo(p))} m`);
      if (e.weapon && r.latest) labels.push(WEAPONS[r.latest.weapon].name);
      if (e.name) this.label(r.info.name + (r.info.bot ? ' [BOT]' : ''), feet.x, top.y - 9, n?nativeColor(n,'Color.Players.name'):color, 'center');
      labels.forEach((text, i) => this.label(text, feet.x, feet.y + (n?19:9) + i * 13, '#e8ecf4', 'center'));
    }
    g.globalAlpha=colors.opacity;
  }

  private drawNative(s: GameSession,n: NativeValues,w:number,hgt:number):void {
    const g=this.ctx,now=performance.now();
    if(nativeOn(n,'Visuals.Other.radar')){
      const size=140,cx=90,cy=hgt-180;g.fillStyle='rgba(12,12,12,.75)';g.fillRect(cx-size/2,cy-size/2,size,size);g.strokeStyle='#5d5d5d';g.strokeRect(cx-size/2,cy-size/2,size,size);g.fillStyle='#fff';g.fillRect(cx-2,cy-2,4,4);
      for(const r of s.remotes.players.values()){if(!r.alive||r.culled)continue;const x=Math.max(-65,Math.min(65,(r.position.x-s.local.position.x)*2)),y=Math.max(-65,Math.min(65,(r.position.z-s.local.position.z)*2));g.fillStyle=s.isFriendly(r.info)?'#75b8eb':'#d96262';g.beginPath();g.arc(cx+x,cy+y,3,0,Math.PI*2);g.fill();}
      this.label('RADAR · N ↑',cx,cy-size/2-9,'#d0d0d0','center');
    }
    if(nativeOn(n,'Visuals.Other.inaccuracyOverlay')){const spread=hvhSpread(s.weapons.def,s.horizontalSpeed(),!s.local.onGround,this.dev.input.aiming,s.weapons.heat),radius=Math.min(hgt*.45,Math.max(2,spread/Math.tan(s.camera.fov*Math.PI/360)*hgt/2));g.strokeStyle=nativeColor(n,'Color.Other.inaccuracyOverlay');g.beginPath();g.arc(w/2,hgt/2,radius,0,Math.PI*2);g.stroke();}
    if(nativeOn(n,'Visuals.Other.recoilOverlay')){const dir=directionFromAngles(this.dev.input.yaw,this.dev.input.pitch),eye=s.eye(),p=this.project(s,eye.x+dir.x*100,eye.y+dir.y*100,eye.z+dir.z*100,w,hgt);if(p){this.line(p.x-4,p.y,p.x+4,p.y,'#ffcc55',2);this.line(p.x,p.y-4,p.x,p.y+4,'#ffcc55',2);}}
    if(nativeOn(n,'Visuals.Other.penetrationReticle')){const hit=s.raycastScene(makeRay(s.eye(),directionFromAngles(this.dev.input.yaw,this.dev.input.pitch)),s.weapons.def.range,true);g.fillStyle=hit.soft.length?'#a7d66f':'#ef8888';g.fillRect(w/2-1,hgt/2-1,3,3);}
    if(nativeOn(n,'Visuals.Other.spectators')){const dead=[...s.remotes.players.values()].filter(p=>!p.alive).map(p=>p.info.name);if(dead.length)this.label(`Dead players: ${dead.join(', ')}`,w-15,90,'#ccc','right');}
    if(nativeOn(n,'Misc.lowFpsWarning')&&this.dev.fps()<30)this.label(`LOW FPS · ${this.dev.fps()}`,w/2,80,'#e8b854','center');
    if(nativeValue(n,'Visuals.Other.droppedWeapons')>0)for(const m of s.loot.markers()){if(m.phase!==1)continue;const p=this.project(s,m.x,m.y,m.z,w,hgt);if(p){const type=nativeValue(n,'Visuals.Other.droppedWeapons');this.label(type===1?'◇':m.pickup?PICKUP_NAMES[m.pickup]:'Loot box',p.x,p.y,type===3?'#b3dd78':'#ddd','center');if(nativeOn(n,'Visuals.Other.droppedWeaponsAmmo'))this.label(m.pickup?'Pickup':'Open for supplies',p.x,p.y+13,'#aaa','center');}}
    if(nativeOn(n,'Visuals.Other.grenades')||nativeOn(n,'Visuals.Other.grenadeProximityWarning'))for(const m of s.projectiles.markers()){
      const p=this.project(s,m.x,m.y,m.z,w,hgt),distance=Math.hypot(m.x-s.local.position.x,m.y-s.local.position.y,m.z-s.local.position.z);
      if(p&&nativeOn(n,'Visuals.Other.grenades'))this.label(`${m.kind} · ${Math.round(distance)}m`,p.x,p.y,nativeColor(n,'Color.Other.grenades'),'center');
      if(nativeOn(n,'Visuals.Other.grenadeProximityWarning')&&PROJECTILES[m.kind].damage>0&&distance<PROJECTILES[m.kind].splashRadius+5)this.label(`GRENADE NEARBY · ${Math.round(distance)}m`,w/2,hgt*.65,'#ef805d','center');
    }
    if(nativeOn(n,'Visuals.Other.grenadeTrajectory')){
      const dir=directionFromAngles(this.dev.input.yaw,this.dev.input.pitch),eye=s.eye(),def=PROJECTILES.egg;
      const body={x:eye.x+dir.x*.5,y:eye.y+dir.y*.5,z:eye.z+dir.z*.5,vx:dir.x*def.speed,vy:dir.y*def.speed+def.upBoost,vz:dir.z*def.speed};let last=this.project(s,body.x,body.y,body.z,w,hgt);
      for(let i=0;i<160;i++){const hit=stepProjectile(body,def,SIM_DT,s.collision);if(i%3===0||hit){const p=this.project(s,body.x,body.y,body.z,w,hgt);if(last&&p)this.line(last.x,last.y,p.x,p.y,nativeColor(n,'Color.Other.grenadeTrajectory'),1);last=p;}if(hit)break;}
    }
    this.sounds=this.sounds.filter(sound=>now-sound.at<1200);
    if(nativeOn(n,'Visuals.Players.visualizeSounds'))for(const sound of this.sounds){const p=this.project(s,sound.x,sound.y,sound.z,w,hgt);if(p){g.strokeStyle=nativeColor(n,'Color.Players.visualizeSounds');g.beginPath();g.arc(p.x,p.y,8+(now-sound.at)*.035,0,Math.PI*2);g.stroke();}}
  }

  private drawSkeleton(session: GameSession, pos: THREE.Vector3, yaw: number, color: string, w: number, hgt: number, pitch = 0, scale = 1): void {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const screen = {} as Record<Joint, { x: number; y: number } | null>;
    const {tilt,tuck}=chickenHeadPose(pitch);
    for (const name of Object.keys(JOINTS) as Joint[]) {
      const [x, originalY, originalZ] = JOINTS[name];
      let y:number=originalY,z:number=originalZ;
      if (name==='head'||name==='beak'||name==='neck') {
        const dy=y-CHICKEN_POSE.neckHeight,dz=z+CHICKEN_POSE.neckForward;
        y=CHICKEN_POSE.neckHeight-tuck+dy*Math.cos(tilt)-dz*Math.sin(tilt);
        z=-CHICKEN_POSE.neckForward+dy*Math.sin(tilt)+dz*Math.cos(tilt);
      }
      // Rotate the local joint by the chicken's yaw.
      screen[name] = this.project(session, pos.x + (x * cos + z * sin)*scale, pos.y + y*scale, pos.z + (-x * sin + z * cos)*scale, w, hgt);
    }
    for (const [a, b] of BONES) {
      const pa = screen[a];
      const pb = screen[b];
      if (pa && pb) this.line(pa.x, pa.y, pb.x, pb.y, color, 1.5);
    }
  }

  private drawWorld(session: GameSession, w: number, hgt: number): void {
    const world = this.dev.config.visuals.world;
    const colors = this.dev.config.visuals.colors;
    const cam = session.camera.position;
    const marker = (x: number, y: number, z: number, text: string, color: string, shape: 'diamond' | 'square' | 'circle') => {
      const s = this.project(session, x, y, z, w, hgt);
      if (!s) return;
      const g = this.ctx;
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      if (shape === 'diamond') {
        g.moveTo(s.x, s.y - 5);
        g.lineTo(s.x + 5, s.y);
        g.lineTo(s.x, s.y + 5);
        g.lineTo(s.x - 5, s.y);
        g.closePath();
      } else if (shape === 'square') {
        g.rect(s.x - 4, s.y - 4, 8, 8);
      } else {
        g.arc(s.x, s.y, 4, 0, Math.PI * 2);
      }
      g.fill();
      g.stroke();
      this.label(`${text} · ${Math.round(cam.distanceTo(this.v.set(x, y, z)))}m`, s.x + 8, s.y, color, 'left');
    };

    if (world.items) {
      for (const m of session.loot.markers()) {
        if (m.phase === 2) marker(m.x, m.y, m.z, 'Box (respawning)', 'rgba(180,180,180,0.8)', 'diamond');
        else marker(m.x, m.y, m.z, m.phase === 1 && m.pickup ? PICKUP_NAMES[m.pickup] : 'Mystery box', colors.items, 'diamond');
      }
    }
    if (world.weapons) {
      for (const v of session.vehicles.markers()) marker(v.x, 1, v.z, `Buggy ${Math.ceil(v.hp)} HP${v.driver ? ' (driven)' : ''}`, colors.weapons, 'square');
      for (const p of session.projectiles.markers()) marker(p.x, p.y, p.z, p.kind === 'egg' ? 'Egg' : p.kind === 'rocket' ? 'Rocket' : 'Smoke', colors.weapons, 'circle');
    }
    if (world.spawns) {
      for (const s of session.map.spawns) marker(s.x, 0.2, s.z, s.team ? `${TEAM_NAMES[s.team]} spawn` : 'Spawn', s.team ? hex(TEAM_COLORS[s.team]) : '#d0d6e2', 'circle');
    }
    if (world.objectives && session.flags) {
      for (const f of session.flags.markers()) marker(f.position.x, f.position.y + 2.2, f.position.z, `${TEAM_NAMES[f.team]} flag${f.atBase ? '' : f.carrier ? ' (carried)' : ' (dropped)'}`, colors.objectives, 'diamond');
      for (const base of session.map.flags) marker(base.x, 0.3, base.z, `${TEAM_NAMES[base.team]} base`, hex(TEAM_COLORS[base.team]), 'square');
    }
  }

  private line(x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }

  private label(text: string, x: number, y: number, color: string, align: CanvasTextAlign): void {
    const g = this.ctx;
    g.textAlign = align;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  /** The Misc readouts. Rebuilt only when the text changes. */
  private updatePanel(session: GameSession): void {
    const m = this.dev.config.misc;
    const now = performance.now();
    const pos = session.local.position;
    if (this.lastTime) {
      const dt = Math.max(1e-3, (now - this.lastTime) / 1000);
      const raw = new THREE.Vector3().subVectors(pos, this.lastPos).divideScalar(dt);
      // Large jumps are teleports/respawns, not speed.
      if (raw.length() < 80) this.velocity.lerp(raw, Math.min(1, dt * 8));
    }
    this.lastTime = now;
    this.lastPos.copy(pos);

    this.fps.hidden = !m.fpsCounter;
    if (m.fpsCounter) this.fps.textContent = `${this.dev.fps()} FPS`;

    const lines: string[] = [];
    if (m.ping) lines.push(`Ping ${this.dev.ping() ?? '–'} ms`);
    if (m.coords) lines.push(`Pos ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`);
    if (m.velocity) lines.push(`Vel ${this.velocity.x.toFixed(1)}, ${this.velocity.y.toFixed(1)}, ${this.velocity.z.toFixed(1)}`);
    if (m.speed) {
      const hop = Math.round(session.local.state.hop * 100);
      lines.push(`Speed ${Math.hypot(this.velocity.x, this.velocity.z).toFixed(1)} m/s${hop ? ` (hop +${hop}%)` : ''}`);
    }
    if (m.mapInfo) {
      const map = session.map;
      lines.push(`Map ${map.name} · ${map.halfSize * 2}×${map.halfSize * 2} m`);
      lines.push(`${map.boxes.length} boxes · ${map.spawns.length} spawns · ${map.loot.length} loot · ${map.vehicles.length} buggies`);
      lines.push(`${session.mode.name} · ${session.infos.size} players`);
    }
    const key = lines.join('\n');
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel.hidden = lines.length === 0;
    this.panel.replaceChildren(...lines.map((l) => h('div', null, l)));
  }
}
