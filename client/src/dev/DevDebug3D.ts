import * as THREE from 'three';
import { CROUCH, HITBOX } from '@game/shared';
import type { GameSession } from '../game/GameSession';
import type { DevConfig } from './config';
import { ResolverSystem, type ShotCandidate } from '@game/shared';
import { HvhDebug } from './HvhDebug';

const BOX_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const HEAD_GEOMETRY = new THREE.WireframeGeometry(new THREE.SphereGeometry(HITBOX.headRadius, 10, 6));
const GLOW_GEOMETRY = new THREE.SphereGeometry(1, 16, 12);
/** Collision boxes are rebuilt this often (Sandbox blocks come and go). */
const COLLISION_REFRESH_MS = 1000;

const overlayLine = (color: string) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });

interface PlayerDebug {
  body: THREE.LineSegments;
  head: THREE.LineSegments;
  glow: THREE.Mesh;
}

/**
 * 3D developer visuals: hitbox wireframes (exactly the shapes the server tests shots against),
 * collision boxes, and a glow shell that shows chickens through walls. Drawn on top of everything.
 */
export class DevDebug3D {
  private readonly session: GameSession;
  private readonly root = new THREE.Group();
  private readonly players = new Map<number, PlayerDebug>();
  private readonly hitboxMaterial = overlayLine('#ffe14c');
  private readonly headMaterial = overlayLine('#ff4d5e');
  private readonly collisionMaterial = new THREE.LineBasicMaterial({ color: '#4dff88', transparent: true, opacity: 0.55, depthTest: false });
  private readonly glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private collision: THREE.LineSegments | null = null;
  private collisionBuiltAt = -Infinity;
  private readonly hvh: HvhDebug | null;

  constructor(session: GameSession, resolver?: ResolverSystem, focus: () => ShotCandidate | null = () => null) {
    this.session = session;
    this.root.renderOrder = 999;
    session.camera.parent?.add(this.root);
    this.hvh = session.mode.id === 'hvh' && resolver ? new HvhDebug(session, resolver, focus) : null;
  }

  update(config: DevConfig | null): void {
    const world = config?.visuals.world;
    const esp = config?.visuals.esp;
    const hitboxes = !!world?.hitboxes;
    const glow = !!(esp?.enabled && esp.glow);
    this.hvh?.update(hitboxes);
    this.updatePlayers(hitboxes && !this.hvh, glow, config);
    this.updateCollision(!!world?.collision);
  }

  private updatePlayers(hitboxes: boolean, glow: boolean, config: DevConfig | null): void {
    const s = this.session;
    const seen = new Set<number>();
    const entries: [number, THREE.Vector3, number, boolean, string, number][] = [];
    if (hitboxes || glow) {
      if (s.local.alive) entries.push([s.selfPid, s.local.position, s.mode.id === 'hvh' ? s.local.server.yaw : s.local.chicken.root.rotation.y, false, '#ffffff', s.local.state.crouching ? CROUCH.scale : 1]);
      for (const [pid, r] of s.remotes.players) {
        if (!r.alive) continue;
        const c = config!.visuals.colors;
        entries.push([pid, r.position, r.yaw, true, r.info.bot ? c.npc : s.isFriendly(r.info) ? c.friendly : c.enemy, r.latest?.crouching ? CROUCH.scale : 1]);
      }
    }
    for (const [pid, pos, yaw, remote, color, k] of entries) {
      seen.add(pid);
      let d = this.players.get(pid);
      if (!d) {
        d = {
          body: new THREE.LineSegments(BOX_EDGES, this.hitboxMaterial),
          head: new THREE.LineSegments(HEAD_GEOMETRY, this.headMaterial),
          glow: new THREE.Mesh(GLOW_GEOMETRY),
        };
        for (const o of [d.body, d.head, d.glow]) o.renderOrder = 999;
        this.root.add(d.body, d.head, d.glow);
        this.players.set(pid, d);
      }
      d.body.visible = d.head.visible = hitboxes;
      d.body.position.set(pos.x, pos.y + (HITBOX.bodyHeight * k) / 2, pos.z);
      d.body.scale.set(HITBOX.bodyRadius * 2 * k, HITBOX.bodyHeight * k, HITBOX.bodyRadius * 2 * k);
      d.head.position.set(pos.x - Math.sin(yaw) * HITBOX.headForward * k, pos.y + HITBOX.headHeight * k, pos.z - Math.cos(yaw) * HITBOX.headForward * k);
      d.head.scale.setScalar(k);
      d.glow.visible = glow && remote;
      if (d.glow.visible) {
        d.glow.material = this.glowMaterial(color, config!.visuals.colors.opacity);
        d.glow.position.set(pos.x, pos.y + 0.85, pos.z);
        d.glow.scale.set(0.62, 0.95, 0.72);
      }
    }
    for (const [pid, d] of this.players) {
      if (seen.has(pid)) continue;
      this.root.remove(d.body, d.head, d.glow);
      this.players.delete(pid);
    }
  }

  /** Additive, see-through-walls tint in a player's ESP colour. */
  private glowMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
    let m = this.glowMaterials.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
      this.glowMaterials.set(color, m);
    }
    m.opacity = 0.35 * opacity;
    return m;
  }

  private updateCollision(on: boolean): void {
    if (!on) {
      if (this.collision) this.collision.visible = false;
      return;
    }
    const now = performance.now();
    if (!this.collision || now - this.collisionBuiltAt > COLLISION_REFRESH_MS) {
      this.collisionBuiltAt = now;
      const positions: number[] = [];
      const edge = BOX_EDGES.getAttribute('position');
      for (const [, b] of this.session.collision.entries()) {
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        for (let i = 0; i < edge.count; i++) {
          positions.push(cx + edge.getX(i) * (b.maxX - b.minX), cy + edge.getY(i) * (b.maxY - b.minY), cz + edge.getZ(i) * (b.maxZ - b.minZ));
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (this.collision) {
        this.collision.geometry.dispose();
        this.collision.geometry = geometry;
      } else {
        this.collision = new THREE.LineSegments(geometry, this.collisionMaterial);
        this.collision.renderOrder = 998;
        this.collision.frustumCulled = false;
        this.root.add(this.collision);
      }
    }
    this.collision.visible = true;
  }

  dispose(): void {
    this.hvh?.dispose();
    this.root.removeFromParent();
    this.collision?.geometry.dispose();
    this.hitboxMaterial.dispose();
    this.headMaterial.dispose();
    this.collisionMaterial.dispose();
    for (const m of this.glowMaterials.values()) m.dispose();
  }
}
