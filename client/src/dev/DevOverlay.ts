import * as THREE from 'three';
import { HITBOX, PLAYER, TEAM_COLORS, TEAM_NAMES, WEAPONS, type PickupKind } from '@game/shared';
import type { GameSession } from '../game/GameSession';
import { h, hex } from '../ui/dom';
import type { Dev } from './Dev';
import type { DevRuntime } from './DevRuntime';

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
    const esp = c.visuals.esp.enabled;
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
    const e = c.visuals.esp;
    const colors = c.visuals.colors;
    const g = this.ctx;
    const camPos = session.camera.position;
    for (const [pid, r] of session.remotes.players) {
      if (!r.alive) continue;
      const p = r.position;
      const feet = this.project(session, p.x, p.y, p.z, w, hgt);
      const top = this.project(session, p.x, p.y + PLAYER.height + 0.12, p.z, w, hgt);
      if (!feet || !top) continue;
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
        g.strokeStyle = color;
        g.strokeRect(left, top.y, boxW, boxH);
      }
      if (e.health) {
        const hp = Math.max(0, Math.min(1, (r.latest?.hp ?? PLAYER.maxHealth) / PLAYER.maxHealth));
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillRect(left - 6, top.y - 1, 4, boxH + 2);
        g.fillStyle = `hsl(${Math.round(hp * 120)}, 90%, 50%)`;
        g.fillRect(left - 5, top.y + boxH * (1 - hp), 2, boxH * hp);
      }
      if (e.skeleton) this.drawSkeleton(session, r.position, r.yaw, color, w, hgt);
      if (e.headCircle) {
        const hx = p.x - Math.sin(r.yaw) * HITBOX.headForward;
        const hz = p.z - Math.cos(r.yaw) * HITBOX.headForward;
        const head = this.project(session, hx, p.y + HITBOX.headHeight, hz, w, hgt);
        const rim = this.project(session, hx, p.y + HITBOX.headHeight + HITBOX.headRadius, hz, w, hgt);
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
      if (e.name) this.label(r.info.name + (r.info.bot ? ' [BOT]' : ''), feet.x, top.y - 9, color, 'center');
      labels.forEach((text, i) => this.label(text, feet.x, feet.y + 9 + i * 13, '#e8ecf4', 'center'));
    }
  }

  private drawSkeleton(session: GameSession, pos: THREE.Vector3, yaw: number, color: string, w: number, hgt: number): void {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const screen = {} as Record<Joint, { x: number; y: number } | null>;
    for (const name of Object.keys(JOINTS) as Joint[]) {
      const [x, y, z] = JOINTS[name];
      // Rotate the local joint by the chicken's yaw.
      screen[name] = this.project(session, pos.x + x * cos + z * sin, pos.y + y, pos.z - x * sin + z * cos, w, hgt);
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
