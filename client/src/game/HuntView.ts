import * as THREE from 'three';
import { PHONE, boxToAabb, type CrystalState, type HuntScare, type HuntState, type MapDef, type MapZone } from '@game/shared';
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
  /** Every crystal still lying about (purple and red), by id. */
  private readonly crystals = new Map<number, CrystalState>();
  /**
   * Hundreds of crystals: one instanced mesh for the purple gems, one for the red ones, and one
   * point cloud for all the glows. Three draw calls, however many there are.
   */
  private purple: THREE.InstancedMesh | null = null;
  private red: THREE.InstancedMesh | null = null;
  private halos: THREE.Points | null = null;
  private dirty = true;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3(1, 1.6, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private portal: THREE.Group | null = null;
  private state: HuntState | null = null;
  private zone: MapZone | null = null;
  private time = 0;
  /** The level's walls drawn once per level (top-down), for the phone. */
  private readonly maps = new Map<string, HTMLCanvasElement>();
  /** Fog of war: the map shows only where you've been (a mask, the same size as the map). */
  private seen: HTMLCanvasElement | null = null;
  private readonly rooms = new Set<number>();
  private zoomLevel = 0;
  private readonly canvas = h('canvas', { class: 'hunt-map', width: PHONE_PX, height: PHONE_PX });
  private readonly title = h('b');
  private readonly counter = h('span', { class: 'hunt-count' });
  private readonly timer = h('span', { class: 'hunt-time' });
  private readonly phone = h('div', { class: 'hunt-phone', hidden: true });
  private readonly pulse = h('div', { class: 'hunt-pulse' });
  /** Scratch canvas: the walls cut down to what's been seen. */
  private readonly layer = Object.assign(document.createElement('canvas'), { width: PHONE_PX, height: PHONE_PX });
  private readonly crystalGeo = new THREE.OctahedronGeometry(0.28, 0);
  private readonly crystalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PURPLE).multiplyScalar(1.5), fog: false });
  private readonly redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a2a).multiplyScalar(1.6), fog: false });
  private readonly pointsMat: THREE.PointsMaterial;
  /** Red crystal reveal: "Monkeys visible 1:12", and speed-up level. */
  private readonly revealBar = h('div', { class: 'hunt-reveal', hidden: true });
  private readonly speed = h('span', { class: 'hunt-speed' });
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
      h('div', { class: 'hunt-phone-top' }, this.title, this.speed, this.timer),
      this.revealBar,
      this.canvas,
      h('div', { class: 'hunt-phone-bottom' }, this.counter, h('small', null, `${keyLabel(getKeybinds().phone)}: bigger · +/-: zoom`)),
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
    const glow = new THREE.CanvasTexture(c);
    this.haloMat = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.pointsMat = new THREE.PointsMaterial({ map: glow, size: 1.6, sizeAttenuation: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, vertexColors: true });
  }

  /** The red crystal's reveal is on (every monkey shows through walls). */
  revealing(serverNow: number): boolean {
    return this.state !== null && serverNow < this.state.revealUntil;
  }

  get active(): boolean {
    return this.state !== null;
  }

  togglePhone(): void {
    if (this.state) this.phone.classList.toggle('big');
  }

  /** + / -: closer in, or out to the whole level. */
  zoom(step: 1 | -1): void {
    this.zoomLevel = Math.max(0, Math.min(PHONE.zooms.length - 1, this.zoomLevel - step));
  }

  setState(s: HuntState | null): void {
    const was = this.state;
    this.state = s;
    this.phone.hidden = !s;
    if (!s) {
      this.clear();
      return;
    }
    const zone = this.map.zones?.find((z) => z.id === s.zone) ?? null;
    if (zone !== this.zone) {
      this.seen = null;
      this.rooms.clear();
      this.zoomLevel = 0;
    }
    this.zone = zone;
    this.title.textContent = s.name;
    this.speed.textContent = s.speedLevel > 0 ? `Speed Lv ${s.speedLevel}` : '';
    // The full list comes at the start (and when you join); after that, only what's taken.
    if (s.crystals) {
      this.crystals.clear();
      for (const c of s.crystals) this.crystals.set(c.id, c);
      this.dirty = true;
    }
    if (s.portal && !this.portal) {
      this.portal = this.buildPortal(s.portal);
      if (was) this.audio.play('portal', { x: s.portal.x, y: 1, z: s.portal.z }, 1);
    }
  }

  /** A crystal was taken: a sparkle and a chime where it was. */
  collect(e: { id: number; x: number; y: number; z: number; red?: boolean }): void {
    if (this.crystals.delete(e.id)) this.dirty = true;
    this.effects.feathers({ x: e.x, y: e.y, z: e.z }, e.red ? 0xff3030 : PURPLE, e.red ? 40 : 24);
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
  update(dt: number, me: THREE.Vector3, yaw: number, mates: readonly THREE.Vector3[], monkeys: readonly THREE.Vector3[], serverNow: number): boolean {
    this.time += dt;
    this.drawCrystals();
    if (this.portal) this.portal.children[1]!.rotation.z -= dt * 2.4;
    const s = this.state;
    if (!s) return false;
    const left = Math.max(0, Math.ceil((s.endsAt - serverNow) / 1000));
    this.timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('urgent', left <= 30);
    this.counter.textContent = s.portal ? 'Portal open: get out!' : `Crystals ${s.total - s.left}/${s.needed}`;
    const seen = Math.max(0, Math.ceil((s.revealUntil - serverNow) / 1000));
    this.revealBar.hidden = seen <= 0;
    if (seen > 0) this.revealBar.textContent = `Monkeys visible ${Math.floor(seen / 60)}:${String(seen % 60).padStart(2, '0')}`;
    this.drawPhone(me, yaw, mates, seen > 0 ? monkeys : []);
    return serverNow < s.blackoutUntil;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
    this.phone.remove();
    this.pulse.remove();
    this.crystalGeo.dispose();
    this.crystalMat.dispose();
    this.redMat.dispose();
    this.pointsMat.dispose();
    this.haloMat.map?.dispose();
    this.haloMat.dispose();
  }

  // ---------------------------------------------------------------------------

  /** Rebuilds the instance lists when crystals come or go, and spins them all every frame. */
  private drawCrystals(): void {
    const list = [...this.crystals.values()];
    const purple = list.filter((c) => !c.red);
    const red = list.filter((c) => c.red);
    if (this.dirty) {
      this.dirty = false;
      this.purple = this.instances(this.purple, this.crystalMat, purple.length);
      this.red = this.instances(this.red, this.redMat, red.length);
      if (this.halos) {
        this.halos.removeFromParent();
        this.halos.geometry.dispose();
      }
      const positions = new Float32Array(list.length * 3);
      const colors = new Float32Array(list.length * 3);
      list.forEach((c, i) => {
        positions.set([c.x, c.y, c.z], i * 3);
        colors.set(c.red ? [1, 0.25, 0.25] : [0.75, 0.45, 1], i * 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.halos = new THREE.Points(geo, this.pointsMat);
      this.halos.frustumCulled = false;
      this.root.add(this.halos);
    }
    const spin = this.time * 1.6;
    const place = (mesh: THREE.InstancedMesh | null, items: CrystalState[], big: number) => {
      if (!mesh) return;
      items.forEach((c, i) => {
        this.quat.setFromAxisAngle(this.up, spin + c.id);
        this.pos.set(c.x, c.y + Math.sin(this.time * 2 + c.id) * 0.08, c.z);
        this.scl.set(big, 1.6 * big, big);
        mesh.setMatrixAt(i, this.matrix.compose(this.pos, this.quat, this.scl));
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.purple, purple, 1);
    place(this.red, red, 1.3);
  }

  private instances(old: THREE.InstancedMesh | null, material: THREE.Material, count: number): THREE.InstancedMesh | null {
    if (old && old.count >= count && count > 0) {
      old.count = count;
      return old;
    }
    if (old) {
      old.removeFromParent();
      old.dispose();
    }
    if (count === 0) return null;
    const mesh = new THREE.InstancedMesh(this.crystalGeo, material, count);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    return mesh;
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
    this.crystals.clear();
    for (const m of [this.purple, this.red]) {
      m?.removeFromParent();
      m?.dispose();
    }
    this.purple = this.red = null;
    if (this.halos) {
      this.halos.removeFromParent();
      this.halos.geometry.dispose();
      this.halos = null;
    }
    this.dirty = true;
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

  /** Where you (and your team) are and have been: uncovered on the fog-of-war mask. */
  private reveal(zone: MapZone, points: readonly THREE.Vector3[]): HTMLCanvasElement {
    if (!this.seen) {
      this.seen = document.createElement('canvas');
      this.seen.width = this.seen.height = PHONE_PX;
    }
    const k = PHONE_PX / Math.max(zone.maxX - zone.minX, zone.maxZ - zone.minZ);
    const g = this.seen.getContext('2d')!;
    g.fillStyle = '#fff';
    const r = PHONE.revealRadius;
    for (const p of points) {
      // The rooms seen, too (crystals in them show on the map).
      for (let x = p.x - r; x <= p.x + r; x += zone.roomSize / 2) for (let z = p.z - r; z <= p.z + r; z += zone.roomSize / 2) {
        if (Math.hypot(x - p.x, z - p.z) <= r) this.rooms.add(this.roomOf(zone, x, z));
      }
      g.beginPath();
      g.arc((p.x - zone.minX) * k, (p.z - zone.minZ) * k, PHONE.revealRadius * k, 0, Math.PI * 2);
      g.fill();
    }
    return this.seen;
  }

  private roomOf(zone: MapZone, x: number, z: number): number {
    return Math.floor((x - zone.minX) / zone.roomSize) * 1000 + Math.floor((z - zone.minZ) / zone.roomSize);
  }

  private drawPhone(me: THREE.Vector3, yaw: number, mates: readonly THREE.Vector3[], monkeys: readonly THREE.Vector3[]): void {
    const zone = this.zone;
    const s = this.state;
    if (!zone || !s) return;
    const g = this.canvas.getContext('2d')!;
    const size = Math.max(zone.maxX - zone.minX, zone.maxZ - zone.minZ);
    // The whole level, or a window round you (metres across).
    const span = PHONE.zooms[this.zoomLevel] || size;
    const scale = size / span;
    const k = (PHONE_PX / size) * scale;
    const cx = span >= size ? zone.minX + size / 2 : me.x;
    const cz = span >= size ? zone.minZ + size / 2 : me.z;
    const px = (x: number) => (x - cx) * k + PHONE_PX / 2;
    const pz = (z: number) => (z - cz) * k + PHONE_PX / 2;
    // Walls, only where someone has been (the rest is dark).
    const seen = this.reveal(zone, [me, ...mates]);
    const ox = px(zone.minX);
    const oz = pz(zone.minZ);
    const w = PHONE_PX * scale;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, PHONE_PX, PHONE_PX);
    const layer = this.layer;
    const lg = layer.getContext('2d')!;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, PHONE_PX, PHONE_PX);
    lg.drawImage(this.wallsOf(zone), 0, 0);
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(seen, 0, 0);
    g.drawImage(layer, ox, oz, w, w);
    // Crystals: the ones in rooms you've seen, and any close enough for the phone to pick up.
    const beat = 3 + Math.sin(this.time * 5) * 1;
    for (const c of this.crystals.values()) {
      const close = Math.hypot(c.x - me.x, c.z - me.z) < PHONE.detectRange;
      if (!close && !this.rooms.has(this.roomOf(zone, c.x, c.z))) continue;
      g.fillStyle = c.red ? '#ff4b4b' : '#c070ff';
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
    // A red crystal's reveal: every monkey on the map.
    g.fillStyle = '#ff2a2a';
    for (const m of monkeys) {
      g.beginPath();
      g.arc(px(m.x), pz(m.z), 3.5, 0, Math.PI * 2);
      g.fill();
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
