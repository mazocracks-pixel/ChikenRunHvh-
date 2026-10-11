import * as THREE from 'three';
import { boxToAabb, type CrystalState, type HuntScare, type HuntState, type MapDef, type MapZone } from '@game/shared';
import { getKeybinds, keyLabel } from '../keybinds';
import { h } from '../ui/dom';
import type { AudioEngine } from './Audio';
import type { Effects } from './Effects';

const PURPLE = 0xb04dff;
const PHONE_PX = 220;

/**
 * Story events (Crystal Hunt) on screen: the purple crystals and the exit portal in the level,
 * the phone with the level's map (you, your team, the crystals left, the portal), the crystal
 * counter and the time, and the scares (a sting, a shake and one red pulse: never a strobe).
 * Everything here goes away when the event ends.
 */
export class HuntView {
  private readonly root = new THREE.Group();
  private readonly crystals = new Map<number, THREE.Group>();
  private portal: THREE.Group | null = null;
  private state: HuntState | null = null;
  private zone: MapZone | null = null;
  private time = 0;
  /** The level's walls drawn once per level (top-down), for the phone. */
  private readonly maps = new Map<string, HTMLCanvasElement>();
  private readonly canvas = h('canvas', { class: 'hunt-map', width: PHONE_PX, height: PHONE_PX });
  private readonly title = h('b');
  private readonly counter = h('span', { class: 'hunt-count' });
  private readonly timer = h('span', { class: 'hunt-time' });
  private readonly phone = h('div', { class: 'hunt-phone', hidden: true });
  private readonly pulse = h('div', { class: 'hunt-pulse' });
  private readonly crystalGeo = new THREE.OctahedronGeometry(0.28, 0);
  private readonly crystalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PURPLE).multiplyScalar(1.5), fog: false });
  private readonly haloMat: THREE.SpriteMaterial;

  constructor(
    scene: THREE.Scene,
    hudRoot: HTMLElement,
    private readonly audio: AudioEngine,
    private readonly effects: Effects,
    private readonly map: MapDef,
    private readonly shake: (amount: number) => void,
  ) {
    scene.add(this.root);
    this.phone.append(
      h('div', { class: 'hunt-phone-top' }, this.title, this.timer),
      this.canvas,
      h('div', { class: 'hunt-phone-bottom' }, this.counter, h('small', null, `${keyLabel(getKeybinds().phone)}: bigger map`)),
    );
    hudRoot.append(this.phone, this.pulse);
    // A soft purple glow round each crystal, so they show from across a dark room.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(200, 120, 255, 0.9)');
    grad.addColorStop(1, 'rgba(160, 60, 255, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.haloMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  }

  get active(): boolean {
    return this.state !== null;
  }

  togglePhone(): void {
    if (this.state) this.phone.classList.toggle('big');
  }

  setState(s: HuntState | null): void {
    const was = this.state;
    this.state = s;
    this.phone.hidden = !s;
    if (!s) {
      this.clear();
      return;
    }
    this.zone = this.map.zones?.find((z) => z.id === s.zone) ?? null;
    this.title.textContent = s.name;
    const ids = new Set(s.crystals.map((c) => c.id));
    for (const [id, g] of this.crystals) if (!ids.has(id)) this.removeCrystal(id, g);
    for (const c of s.crystals) if (!this.crystals.has(c.id)) this.addCrystal(c);
    if (s.portal && !this.portal) {
      this.portal = this.buildPortal(s.portal);
      if (was) this.audio.play('portal', { x: s.portal.x, y: 1, z: s.portal.z }, 1);
    }
  }

  /** A crystal was taken: a sparkle and a chime where it was. */
  collect(e: { id: number; x: number; y: number; z: number }): void {
    const g = this.crystals.get(e.id);
    if (g) this.removeCrystal(e.id, g);
    this.effects.feathers({ x: e.x, y: e.y, z: e.z }, PURPLE, 24);
    this.audio.play('crystal', { x: e.x, y: e.y, z: e.z }, 1);
  }

  /** The scare: a loud sting, a short shake and a single red pulse. */
  scare(kind: HuntScare): void {
    this.audio.play(kind === 'blackout' ? 'powerDown' : 'scareSting', undefined, 1.2);
    if (kind === 'blackout') window.setTimeout(() => this.audio.play('scareSting', undefined, 1.1), 900);
    this.shake(kind === 'spotted' ? 0.5 : 0.8);
    this.pulse.classList.remove('on');
    void this.pulse.offsetWidth;
    this.pulse.classList.add('on');
  }

  /** Every frame: spin the crystals, swirl the portal, draw the phone. */
  update(dt: number, me: THREE.Vector3, yaw: number, mates: readonly THREE.Vector3[], serverNow: number): boolean {
    this.time += dt;
    for (const g of this.crystals.values()) {
      g.children[0]!.rotation.y += dt * 1.6;
      g.position.y = g.userData.y + Math.sin(this.time * 2 + g.userData.y * 7) * 0.08;
    }
    if (this.portal) this.portal.children[1]!.rotation.z -= dt * 2.4;
    const s = this.state;
    if (!s) return false;
    const left = Math.max(0, Math.ceil((s.endsAt - serverNow) / 1000));
    this.timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('urgent', left <= 30);
    this.counter.textContent = s.portal ? 'Portal open: get out!' : `Crystals ${s.total - s.crystals.length}/${s.total}`;
    this.drawPhone(me, yaw, mates);
    return serverNow < s.blackoutUntil;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.phone.remove();
    this.pulse.remove();
    this.crystalGeo.dispose();
    this.crystalMat.dispose();
    this.haloMat.map?.dispose();
    this.haloMat.dispose();
  }

  // ---------------------------------------------------------------------------

  private addCrystal(c: CrystalState): void {
    const g = new THREE.Group();
    const gem = new THREE.Mesh(this.crystalGeo, this.crystalMat);
    gem.scale.set(1, 1.6, 1);
    const halo = new THREE.Sprite(this.haloMat);
    halo.scale.setScalar(1.6);
    g.add(gem, halo);
    g.position.set(c.x, c.y, c.z);
    g.userData.y = c.y;
    this.root.add(g);
    this.crystals.set(c.id, g);
  }

  private removeCrystal(id: number, g: THREE.Group): void {
    g.removeFromParent();
    this.crystals.delete(id);
  }

  private buildPortal(at: { x: number; z: number }): THREE.Group {
    const g = new THREE.Group();
    g.position.set(at.x, 1.3, at.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 10, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9b5cff).multiplyScalar(1.6), fog: false }));
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40, 0, Math.PI * 1.6), new THREE.MeshBasicMaterial({ color: 0x6a2bd9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false, depthWrite: false }));
    const halo = new THREE.Sprite(this.haloMat);
    halo.scale.setScalar(4);
    g.add(ring, swirl, halo);
    this.root.add(g);
    return g;
  }

  private clear(): void {
    for (const [id, g] of this.crystals) this.removeCrystal(id, g);
    if (this.portal) {
      this.portal.removeFromParent();
      for (const o of this.portal.children) {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      }
      this.portal = null;
    }
    this.phone.classList.remove('big');
    this.zone = null;
  }

  /** The level's walls, drawn once, top-down. */
  private wallsOf(zone: MapZone): HTMLCanvasElement {
    let c = this.maps.get(zone.id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = PHONE_PX;
    const g = c.getContext('2d')!;
    const k = PHONE_PX / Math.max(zone.maxX - zone.minX, zone.maxZ - zone.minZ);
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, PHONE_PX, PHONE_PX);
    g.fillStyle = '#6f8fbf';
    for (const b of this.map.boxes) {
      const a = boxToAabb(b);
      if (b.kind === 'roof' || a.maxX < zone.minX || a.minX > zone.maxX || a.maxZ < zone.minZ || a.minZ > zone.maxZ) continue;
      g.fillRect((a.minX - zone.minX) * k, (a.minZ - zone.minZ) * k, Math.max(1.5, (a.maxX - a.minX) * k), Math.max(1.5, (a.maxZ - a.minZ) * k));
    }
    this.maps.set(zone.id, c);
    return c;
  }

  private drawPhone(me: THREE.Vector3, yaw: number, mates: readonly THREE.Vector3[]): void {
    const zone = this.zone;
    const s = this.state;
    if (!zone || !s) return;
    const g = this.canvas.getContext('2d')!;
    g.drawImage(this.wallsOf(zone), 0, 0);
    const k = PHONE_PX / Math.max(zone.maxX - zone.minX, zone.maxZ - zone.minZ);
    const px = (x: number) => (x - zone.minX) * k;
    const pz = (z: number) => (z - zone.minZ) * k;
    // Crystals left (they pulse), the portal once open.
    const beat = 3 + Math.sin(this.time * 5) * 1;
    g.fillStyle = '#c070ff';
    for (const c of s.crystals) {
      g.beginPath();
      g.arc(px(c.x), pz(c.z), beat, 0, Math.PI * 2);
      g.fill();
    }
    if (s.portal) {
      g.strokeStyle = '#6ef0ff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px(s.portal.x), pz(s.portal.z), 6 + Math.sin(this.time * 4) * 1.5, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#66dd77';
    for (const m of mates) {
      g.beginPath();
      g.arc(px(m.x), pz(m.z), 3, 0, Math.PI * 2);
      g.fill();
    }
    // You: an arrow pointing the way you face.
    g.save();
    g.translate(px(me.x), pz(me.z));
    g.rotate(-yaw);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(0, 2);
    g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}
