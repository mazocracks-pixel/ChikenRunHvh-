import {
  DEFAULT_APPEARANCE,
  PLAYER,
  TRAINING_GUNS,
  TRAINING_KNIVES,
  isSpaceFree,
  openSpots,
  trainingLoadout,
  trainingMods,
  walkable,
  wrapAngle,
  type KillCause,
  type SpawnPoint,
  type TrainingGiveRequest,
  type Vec3,
} from '@game/shared';
import { isRecord } from '../util';
import { GameRoom, type RoomHooks, type RoomOptions } from './GameRoom';
import type { ServerPlayer } from './ServerPlayer';
import type { GameServer } from '../types';

/** How many practice targets, and how many of them strafe. */
const TARGETS = 8;
const MOVERS = 3;
/** A strafing target walks this far each way, this fast (m, m/s). */
const STRAFE = 3;
const STRAFE_SPEED = 1.4;
/** A hit target heals back to full after this long without being hit. */
const HEAL_MS = 3000;

interface Target {
  home: SpawnPoint;
  /** Strafing direction (unit vector) for movers, or null for a still target. */
  along: { x: number; z: number } | null;
  phase: number;
  lastHitAt: number;
}

/**
 * Training: one player alone (their own private room) with practice targets that never shoot.
 * You can't be hurt, kills count for nothing, the match never ends, ammo never runs out, and the
 * B menu hands out any gun or knife (checked here). Nothing reaches the database: the only place
 * results are recorded is the match end, which never comes.
 */
export class TrainingRoom extends GameRoom {
  private readonly targets = new Map<number, Target>();
  private readonly homes: Target[];
  private readonly start: SpawnPoint;

  constructor(io: GameServer, options: RoomOptions, hooks: RoomHooks) {
    super(io, options, hooks);
    this.start = this.map.spawns[0]!;
    this.homes = this.placeTargets();
    // Targets join before you do (a Training room holds one human, and then counts as full).
    for (let i = 0; i < this.homes.length; i++) {
      this.join(null, { userId: null, name: `Target ${i + 1}`, appearance: { ...DEFAULT_APPEARANCE, skin: 'brown' }, loadout: ['pistol'], bot: true });
    }
  }

  /** The B menu: a gun or knife from the lists, or a full stack of one grenade. Returns an error or null. */
  give(p: ServerPlayer, raw: unknown): string | null {
    if (!isRecord(raw) || p.info.bot) return 'Nothing to give.';
    const req = raw as TrainingGiveRequest;
    if (req.grenade !== undefined) {
      if (req.grenade === 'egg') p.eggs = PLAYER.maxEggs;
      else if (req.grenade === 'smoke') p.smokes = PLAYER.maxSmokes;
      else if (req.grenade === 'flash') p.flashes = PLAYER.maxFlashes;
      else return 'Unknown grenade.';
      return null;
    }
    const pick = req.weapon;
    if (!pick || (!TRAINING_GUNS.includes(pick) && !TRAINING_KNIVES.includes(pick))) return 'Unknown weapon.';
    p.info.loadout = trainingLoadout(p.info.loadout, pick);
    p.weaponSlot = p.info.loadout.indexOf(pick);
    p.mags.set(pick, p.magazineSize(pick));
    p.reloadUntil = 0;
    this.announcePlayer(p);
    return null;
  }

  /** You can't be hurt (not by targets, not by your own eggs or rockets); targets can. */
  override damage(victim: ServerPlayer, attacker: ServerPlayer | null, amount: number, headshot: boolean, cause: KillCause, from: Vec3, now: number, flags = 0): void {
    const target = this.targets.get(victim.pid);
    if (!target) return;
    target.lastHitAt = now;
    super.damage(victim, attacker, amount, headshot, cause, from, now, flags);
  }

  /** A target going down scores nothing (no kills, no points); it comes back after respawnMs. */
  protected override kill(victim: ServerPlayer, attacker: ServerPlayer | null, cause: KillCause, headshot: boolean, now: number, flags = 0): void {
    super.kill(victim, attacker, cause, headshot, now, flags, false);
  }

  /** No time or score limit, so this never runs, but Training must never record a result. */
  protected override endMatch(): void {}

  protected override onPlayerJoin(p: ServerPlayer, now: number): void {
    if (p.info.bot) return;
    // One gun and your own knife to start with; the B menu changes either.
    p.info.loadout = trainingLoadout(p.info.loadout, TRAINING_GUNS[0]!);
    p.weaponSlot = 0;
    for (const id of p.info.loadout) p.mags.set(id, p.magazineSize(id));
    p.eggs = PLAYER.maxEggs;
    p.smokes = PLAYER.maxSmokes;
    p.flashes = PLAYER.maxFlashes;
    super.onPlayerJoin(p, now);
  }

  /** You start at the map's first spawn facing the targets; each target at its own spot. */
  protected override pickSpawn(p: ServerPlayer): SpawnPoint {
    if (!p.info.bot) return this.start;
    let t = this.targets.get(p.pid);
    if (!t) {
      t = this.homes[this.targets.size % this.homes.length]!;
      this.targets.set(p.pid, t);
    }
    return t.home;
  }

  protected override fixedUpdate(now: number): void {
    const human = [...this.players.values()].find((p) => !p.info.bot);
    for (const p of this.players.values()) {
      if (!p.info.bot) {
        // Infinite ammo and instant reload, on top of any developer modifiers.
        if (!p.mods?.infiniteAmmo || !p.mods.instantReload || !p.mods.infiniteFlashes) p.mods = trainingMods(p.mods);
        continue;
      }
      const t = this.targets.get(p.pid);
      if (!t || !p.alive) continue;
      if (t.along) {
        t.phase += (STRAFE_SPEED / STRAFE) * (1 / 60);
        const offset = Math.sin(t.phase) * STRAFE;
        p.state.x = t.home.x + t.along.x * offset;
        p.state.z = t.home.z + t.along.z * offset;
      }
      if (human) p.lookYaw = p.yaw = wrapAngle(Math.atan2(-(human.state.x - p.state.x), -(human.state.z - p.state.z)));
      if (p.hp < PLAYER.maxHealth && now - t.lastHitAt > HEAL_MS) p.hp = PLAYER.maxHealth;
    }
    super.fixedUpdate(now);
  }

  /**
   * Target spots: open ground 7–35 m from your start, spread out, the nearest first. Movers get a
   * strafing line across your view that stays on open ground.
   */
  private placeTargets(): Target[] {
    const s = this.start;
    // Imported maps (Mirage) have floors at many heights: their own nav points, not a flat fill.
    const open: SpawnPoint[] = this.map.navLinks ? this.map.nav!.slice(0, this.map.navLinks.length) : openSpots([s], this.world, this.map.halfSize, 3);
    const spots = open
      .map((p) => ({ ...p, d: Math.hypot(p.x - s.x, p.z - s.z) }))
      .filter((p) => p.d >= 7 && p.d <= 35)
      .sort((a, b) => a.d - b.d);
    const chosen: SpawnPoint[] = [];
    for (const spot of spots) {
      if (chosen.length >= TARGETS) break;
      if (chosen.every((c) => Math.hypot(c.x - spot.x, c.z - spot.z) >= 5)) chosen.push(spot);
    }
    // The first ones with room to strafe move (narrow streets leave few).
    let movers = 0;
    return chosen.map((home, i) => {
      // Across the line of sight from your start.
      const d = Math.hypot(home.x - s.x, home.z - s.z) || 1;
      const across = { x: -(home.z - s.z) / d, z: (home.x - s.x) / d };
      const end = (k: number) => ({ x: home.x + across.x * k, y: home.y, z: home.z + across.z * k });
      // Raised floors (Mirage) slope and streets are tight: the line must keep to level ground,
      // and a half-width strafe (or one out to a side and back) will do where the full one doesn't fit.
      const side = (k: number) => home.y === undefined
        ? [k / 2, k].every((j) => isSpaceFree(home.x + across.x * j, 0, home.z + across.z * j, this.world))
        : walkable(home, end(k), this.world);
      let scale = 0, shift = 0;
      if (i > 0 && movers < MOVERS) {
        if (side(STRAFE) && side(-STRAFE)) scale = 1;
        else if (home.y !== undefined) {
          if (side(STRAFE / 2) && side(-STRAFE / 2)) scale = 0.5;
          else for (const k of [STRAFE, -STRAFE]) if (!scale && side(k)) { scale = 0.5; shift = k / 2; }
        }
      }
      if (scale) movers++;
      const centre = { ...home, x: home.x + across.x * shift, z: home.z + across.z * shift };
      return { home: centre, along: scale ? { x: across.x * scale, z: across.z * scale } : null, phase: i, lastHitAt: -Infinity };
    });
  }
}
