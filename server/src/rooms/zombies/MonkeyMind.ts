import { MONKEYS, PLAYER, DEFAULT_MODS, makeRay, raycastWorld, sanitizeMods, type CollisionWorld, type MapZone, type NavPoint } from '@game/shared';
import type { ServerPlayer } from '../ServerPlayer';
import type { Zombie } from './ZombieBrain';

/** A sound a monkey can hear: where, how far it carries, and when it was made. */
export interface Noise {
  x: number;
  z: number;
  radius: number;
  at: number;
}

/**
 * What a monkey is doing. `sleep`: by a crystal, until woken. `ceiling`: in the crawlspace above
 * a hole in the ceiling, until you pass below. `patrol`: walking room to room. `investigate`:
 * running to a sound. `chase`: it sees you. `search`: it lost you, and looks where you were.
 */
export type MonkeyState = 'sleep' | 'ceiling' | 'patrol' | 'investigate' | 'chase' | 'search';

export interface MonkeyData {
  state: MonkeyState;
  /** Where it's going (patrol room, the sound, the last place it saw you, the ceiling hole). */
  goal: NavPoint | null;
  lastSeen: NavPoint | null;
  lastSeenAt: number;
  searchUntil: number;
  nextLeap: number;
  /** A ceiling one: the hole it drops through. A sleeping one: the room it guards. */
  spot: NavPoint | null;
  nextScreech: number;
}

/** What MonkeyMind needs from the room. */
export interface MonkeyHost {
  readonly world: CollisionWorld;
  zone(): MapZone | null;
  survivors(): ServerPlayer[];
  monkeys(): Iterable<Zombie>;
  noises(): readonly Noise[];
  /** The event's speed-ups make them faster too (1 = normal). */
  speedBoost(): number;
  /** It saw you (the first time is a scare), and it screeched to the pack. */
  spotted(z: Zombie, target: ServerPlayer): void;
  screech(z: Zombie): void;
}


/**
 * Monkey behaviour on top of the zombie AI: it decides where a monkey goes and how fast; the
 * zombie brain does the walking, the routes and the swipes. They hunt actively: they hear
 * footsteps and gunshots and run to them; one that sees you screeches and brings the pack, half
 * of them coming round the side; they leap at you from a distance; and when you break their
 * line of sight they search where they last saw you before going back to patrolling.
 */
export class MonkeyMind {
  constructor(private readonly host: MonkeyHost) {}

  static create(state: MonkeyState, now: number, spot: NavPoint | null = null): MonkeyData {
    return { state, goal: spot, lastSeen: null, lastSeenAt: 0, searchUntil: 0, nextLeap: now + 1500, spot, nextScreech: 0 };
  }

  /**
   * Called every tick by the brain. Returns where to go: a point, or null to go straight for
   * `target` (the chase, with the brain's surround and flanking). `think` is true on the brain's
   * thinking ticks (sight and hearing are checked then).
   */
  update(z: Zombie, target: ServerPlayer, dist: number, now: number, think: boolean, hit: boolean): NavPoint | null {
    const m = (z.monkey ??= MonkeyMind.create('patrol', now));
    const p = z.p;
    if (think) {
      const sees = m.state !== 'sleep' && m.state !== 'ceiling' && dist < MONKEYS.sightRange && this.canSee(p, target);
      if (sees || (hit && m.state !== 'chase')) this.startChase(z, target, now);
      else if (m.state === 'chase' && now - m.lastSeenAt > 700) {
        // Lost you: search where you were last seen.
        m.state = 'search';
        m.goal = m.lastSeen;
        m.searchUntil = now + MONKEYS.searchMs[0] + Math.random() * (MONKEYS.searchMs[1] - MONKEYS.searchMs[0]);
      }
      if (sees) {
        m.lastSeen = { x: target.state.x, z: target.state.z };
        m.lastSeenAt = now;
      }
      this.think(z, m, target, dist, now);
    }
    // Speed: patrolling is slow, anything with a purpose is a run.
    const speed = (m.state === 'chase' || m.state === 'investigate' || m.state === 'search' ? MONKEYS.chaseSpeed : MONKEYS.walkSpeed) * this.host.speedBoost();
    if (p.mods?.speed !== speed) p.mods = sanitizeMods({ speed }, DEFAULT_MODS);
    if (m.state === 'chase') {
      this.leap(z, m, target, dist, now);
      return null;
    }
    return m.goal ?? { x: p.state.x, z: p.state.z };
  }

  /** The pack: a monkey that sees you screeches, and every monkey in earshot comes. */
  private startChase(z: Zombie, target: ServerPlayer, now: number): void {
    const m = z.monkey!;
    const first = m.state !== 'chase';
    m.state = 'chase';
    m.lastSeen = { x: target.state.x, z: target.state.z };
    m.lastSeenAt = now;
    this.host.spotted(z, target);
    if (!first || now < m.nextScreech) return;
    m.nextScreech = now + 4000;
    this.host.screech(z);
    let n = 0;
    for (const o of this.host.monkeys()) {
      if (o === z || !o.p.alive || !o.monkey || o.monkey.state === 'chase') continue;
      if (Math.hypot(o.p.state.x - z.p.state.x, o.p.state.z - z.p.state.z) > MONKEYS.alertRadius) continue;
      // Sleepers and ceiling ones only wake if it's right by them.
      if ((o.monkey.state === 'sleep' || o.monkey.state === 'ceiling') && Math.hypot(o.p.state.x - target.state.x, o.p.state.z - target.state.z) > 10) continue;
      o.monkey.state = 'investigate';
      o.monkey.goal = { x: target.state.x, z: target.state.z };
      // Half of them come round the side: cutting off the way out.
      if (n++ % 2 === 0 && Math.random() < MONKEYS.flankShare * 2) {
        o.flank = Math.random() < 0.5 ? 1 : -1;
        o.flanking = true;
      }
    }
  }

  private think(z: Zombie, m: MonkeyData, target: ServerPlayer, dist: number, now: number): void {
    const p = z.p;
    const at = { x: p.state.x, z: p.state.z };
    const near = (g: NavPoint | null, r = 1.5) => g !== null && Math.hypot(g.x - at.x, g.z - at.z) < r;
    // Sound: the loudest recent one it can hear sends it running there (not while chasing).
    if (m.state !== 'chase') {
      for (const s of this.host.noises()) {
        const d = Math.hypot(s.x - at.x, s.z - at.z);
        // Asleep, only gunshots and footsteps right by it wake it.
        const radius = m.state === 'sleep' ? Math.min(s.radius, s.radius >= MONKEYS.hearing.gunshot ? s.radius * 0.6 : MONKEYS.wakeRange + 1) : s.radius;
        if (d > radius || m.state === 'ceiling') continue;
        m.state = 'investigate';
        m.goal = { x: s.x, z: s.z };
      }
    }
    switch (m.state) {
      case 'sleep':
        if (dist < MONKEYS.wakeRange) this.startChase(z, target, now);
        m.goal = at;
        break;
      case 'ceiling': {
        // You pass under its hole: it walks to the hole and drops through.
        const hole = m.spot!;
        const under = this.host.survivors().some((s) => Math.hypot(s.state.x - hole.x, s.state.z - hole.z) < MONKEYS.dropRange);
        m.goal = under ? hole : at;
        if (p.state.y < 1) this.startChase(z, target, now);
        break;
      }
      case 'investigate':
        if (near(m.goal)) {
          m.state = 'search';
          m.searchUntil = now + MONKEYS.searchMs[0];
          m.lastSeen = m.goal;
        }
        break;
      case 'search':
        if (now >= m.searchUntil) {
          m.state = 'patrol';
          m.goal = this.randomRoom(at, 40);
        } else if (near(m.goal)) {
          // Look about nearby.
          const c = m.lastSeen ?? at;
          m.goal = this.randomRoom(c, 10) ?? c;
        }
        break;
      case 'patrol':
        if (!m.goal || near(m.goal, 2)) m.goal = this.randomRoom(at, 30);
        break;
      case 'chase':
        break;
    }
  }

  /** The leap: in sight, at the right distance, every couple of seconds. */
  private leap(z: Zombie, m: MonkeyData, target: ServerPlayer, dist: number, now: number): void {
    const p = z.p;
    if (now < m.nextLeap || !p.state.onGround || dist < MONKEYS.leap.min || dist > MONKEYS.leap.max || now - m.lastSeenAt > 300) return;
    m.nextLeap = now + MONKEYS.leap.cooldownMs;
    const dx = target.state.x - p.state.x;
    const dz = target.state.z - p.state.z;
    const d = Math.hypot(dx, dz) || 1;
    const v = MONKEYS.leapSpeed * PLAYER.speed;
    p.state.vx += (dx / d) * v;
    p.state.vz += (dz / d) * v;
    p.state.vy = MONKEYS.leap.up;
    p.state.onGround = false;
  }

  private canSee(p: ServerPlayer, target: ServerPlayer): boolean {
    const eye = { x: p.state.x, y: p.state.y + 1.2, z: p.state.z };
    const dx = target.state.x - eye.x;
    const dy = target.state.y + 1.2 - eye.y;
    const dz = target.state.z - eye.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return !raycastWorld(makeRay(eye, { x: dx / d, y: dy / d, z: dz / d }), this.host.world, d);
  }

  /** A room of the level within `radius` of `from` (any room if none). */
  private randomRoom(from: NavPoint, radius: number): NavPoint | null {
    const cells = this.host.zone()?.cells;
    if (!cells || cells.length === 0) return null;
    const close = cells.filter((c) => Math.hypot(c.x - from.x, c.z - from.z) < radius);
    const pool = close.length > 1 ? close : cells;
    return pool[Math.floor(Math.random() * pool.length)]!;
  }
}
