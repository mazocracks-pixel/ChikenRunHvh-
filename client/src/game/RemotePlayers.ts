import * as THREE from 'three';
import { TEAM_COLORS, damp, lerp, lerpAngle, unpackPlayer, type PlayerInfo, type PlayerState, type WeaponId, type WorldSnapshot } from '@game/shared';
import { Chicken } from './models/Chicken';
import { NameTag } from './models/NameTag';

/** Upper bound on buffered snapshots per player (~3 s at 20 Hz), e.g. while the tab is hidden. */
const MAX_BUFFER = 60;

interface Sample {
  t: number;
  s: PlayerState;
}

export class RemotePlayer {
  info: PlayerInfo;
  readonly chicken: Chicken;
  private tag: NameTag;
  private readonly buffer: Sample[] = [];
  private readonly lastPosition = new THREE.Vector3();
  private hasRendered = false;
  private speed = 0;
  /** The most recent state (for HUD, aim checks...). */
  latest: PlayerState | null = null;
  /** Position as currently drawn. */
  readonly position = new THREE.Vector3();
  yaw = 0;
  alive = true;

  constructor(info: PlayerInfo, friendly: boolean) {
    this.info = info;
    this.chicken = new Chicken(info.appearance, info.team);
    this.tag = new NameTag(info.name, friendly || info.team === 0 ? 0xffffff : TEAM_COLORS[info.team], info.dev);
    this.chicken.root.add(this.tag.sprite);
    // Hidden until the first snapshot tells us where it is.
    this.chicken.root.visible = false;
  }

  update(info: PlayerInfo, friendly: boolean): void {
    const nameChanged = info.name !== this.info.name || info.team !== this.info.team || info.dev !== this.info.dev;
    this.info = info;
    this.chicken.setAppearance(info.appearance);
    this.chicken.setTeam(info.team);
    if (nameChanged) {
      this.tag.dispose();
      this.tag = new NameTag(info.name, friendly || info.team === 0 ? 0xffffff : TEAM_COLORS[info.team], info.dev);
      this.chicken.root.add(this.tag.sprite);
    }
  }

  push(t: number, s: PlayerState): void {
    this.buffer.push({ t, s });
    this.latest = s;
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
  }

  /** After a respawn, forget the old trail so we don't slide across the map. */
  teleport(t: number, x: number, y: number, z: number, yaw: number): void {
    const base = this.latest ?? null;
    if (!base) return;
    this.buffer.length = 0;
    this.push(t, { ...base, x, y, z, yaw, alive: true });
    this.alive = true;
    this.chicken.setDead(false);
  }

  /** Drivers are drawn in their buggy's seat instead of where the snapshot says. */
  sitAt(position: THREE.Vector3, yaw: number): void {
    this.chicken.root.position.copy(position);
    this.chicken.root.rotation.y = yaw;
    this.position.copy(position);
  }

  kill(): void {
    this.alive = false;
    this.chicken.setDead(true);
  }

  /** Renders the player as it was at `renderTime` (server clock), interpolating between snapshots. */
  render(renderTime: number, dt: number): void {
    const buf = this.buffer;
    // Drop samples we've fully moved past, keeping the one just before renderTime.
    while (buf.length >= 2 && buf[1]!.t <= renderTime) buf.shift();
    const a = buf[0];
    if (!a) return;
    const b = buf[1];
    let s = a.s;
    const root = this.chicken.root;

    if (!b || renderTime <= a.t) {
      this.position.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
      this.chicken.setAim(s.pitch);
    } else {
      const t = (renderTime - a.t) / (b.t - a.t);
      this.position.set(lerp(a.s.x, b.s.x, t), lerp(a.s.y, b.s.y, t), lerp(a.s.z, b.s.z, t));
      this.yaw = lerpAngle(a.s.yaw, b.s.yaw, t);
      this.chicken.setAim(lerp(a.s.pitch, b.s.pitch, t));
      if (t >= 0.5) s = b.s;
    }
    root.position.copy(this.position);
    if (this.alive) root.rotation.y = this.yaw;
    // Kill events or snapshots can mark a player dead; only a spawn event (teleport) revives them.
    // Otherwise the delayed, interpolated samples would briefly bring the corpse back to life.
    if (!s.alive && this.alive) this.kill();
    if (!this.chicken.isDead) root.visible = true;
    this.tag.sprite.visible = this.alive;
    this.tag.animate(performance.now() / 1000);
    this.chicken.setWeapon(s.weapon as WeaponId);
    this.chicken.setJetpack(s.fuel > 0, s.jetting);
    this.chicken.setCrouch(s.crouching);

    if (this.hasRendered && dt > 0) {
      const moved = Math.hypot(this.position.x - this.lastPosition.x, this.position.z - this.lastPosition.z);
      this.speed = damp(this.speed, moved / dt, 10, dt);
    }
    this.lastPosition.copy(this.position);
    this.hasRendered = true;
    this.chicken.animate(dt, this.speed, s.onGround);
  }

  dispose(): void {
    this.tag.dispose();
    this.chicken.dispose();
  }
}

/** Everyone except the local player, rendered slightly in the past for smooth motion. */
export class RemotePlayers {
  private readonly scene: THREE.Scene;
  readonly players = new Map<number, RemotePlayer>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get size(): number {
    return this.players.size;
  }

  get(pid: number): RemotePlayer | undefined {
    return this.players.get(pid);
  }

  add(info: PlayerInfo, friendly: boolean): void {
    const existing = this.players.get(info.pid);
    if (existing) {
      existing.update(info, friendly);
      return;
    }
    const player = new RemotePlayer(info, friendly);
    this.players.set(info.pid, player);
    this.scene.add(player.chicken.root);
  }

  remove(pid: number): void {
    this.players.get(pid)?.dispose();
    this.players.delete(pid);
  }

  pushSnapshot(snapshot: WorldSnapshot, selfPid: number): void {
    for (const packed of snapshot.p) {
      if (packed[0] === selfPid) continue;
      const state = unpackPlayer(packed);
      this.players.get(state.pid)?.push(snapshot.t, state);
    }
  }

  render(renderTime: number, dt: number): void {
    for (const player of this.players.values()) player.render(renderTime, dt);
  }

  dispose(): void {
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
  }
}
