import {
  CRYSTAL_HUNT,
  MONKEYS,
  SMALL_TEST,
  makeRay,
  raycastWorld,
  round,
  type CollisionWorld,
  type CrystalState,
  type HuntEventDef,
  type HuntScare,
  type HuntState,
  type MapZone,
  type NavPoint,
  type ZombieKind,
} from '@game/shared';
import type { ServerPlayer } from '../ServerPlayer';
import { MonkeyMind, type MonkeyState, type Noise } from './MonkeyMind';
import type { Zombie } from './ZombieBrain';

/** What a Crystal Hunt needs from the room it runs in (the Zombie Apocalypse room). */
export interface HuntHost {
  readonly zones: readonly MapZone[];
  readonly world: CollisionWorld;
  /** Survivors who are alive, and every survivor (dead ones too). */
  survivors(): ServerPlayer[];
  humans(): ServerPlayer[];
  /** The event's monsters still standing. */
  monsters(): Zombie[];
  /** Puts a survivor somewhere (alive, if they were dead), and tells everyone. */
  place(p: ServerPlayer, x: number, z: number, now: number): void;
  /** A monster for the event, standing at `at` (`y` up, for one in the ceiling). */
  spawnMonster(kind: ZombieKind, at: { x: number; z: number }, now: number, y?: number): Zombie | null;
  /** Sends to everyone in the room. */
  broadcast<E extends 'hunt' | 'crystal' | 'huntEnd'>(event: E, payload: unknown): void;
  scare(p: ServerPlayer, kind: HuntScare): void;
  message(text: string): void;
}

/** One running event's own extras (each event file adds its own on top of the hunt). */
export interface HuntEvent {
  def: HuntEventDef;
  /** Once, when it starts (after the monsters are out). */
  onStart?(hunt: CrystalHunt, now: number): void;
  /** Every tick while it runs. */
  onUpdate?(hunt: CrystalHunt, now: number): void;
}

/** `small`: a quick test run (a few crystals near the entrance, a few monkeys, no reinforcements). */
export type HuntVariant = 'full' | 'small';

/** How often footsteps are heard (ms), and how long a sound hangs about for monkeys to hear. */
const STEP_MS = 200;
const NOISE_MS = 400;

/**
 * Crystal Hunt, shared by every story event: everyone is taken into the event's sealed level,
 * the purple crystals are scattered about, walking into one takes it; the last one opens the
 * portal, and stepping into the portal ends the event. Time running out, or everybody dying,
 * fails it. The room decides what success and failure mean for the waves.
 */
export class CrystalHunt {
  readonly def: HuntEventDef;
  readonly zone: MapZone;
  readonly endsAt: number;
  readonly startedAt: number;
  readonly variant: HuntVariant;
  private readonly crystals = new Map<number, CrystalState>();
  private portal: { x: number; z: number } | null = null;
  /** Players a monster has already scared by spotting them. */
  private readonly spotted = new Set<number>();
  private readonly noiseList: Noise[] = [];
  private nextStep = 0;
  private nextReinforcement = 0;
  blackoutUntil = 0;
  /** Set when it's over: why. */
  result: { success: boolean; reason: string } | null = null;

  constructor(private readonly host: HuntHost, private readonly event: HuntEvent, now: number, variant: HuntVariant = 'full') {
    this.def = event.def;
    this.variant = variant;
    const zone = host.zones.find((z) => z.id === event.def.zone);
    if (!zone) throw new Error(`No level "${event.def.zone}" for ${event.def.name}`);
    this.zone = zone;
    this.startedAt = now;
    const small = variant === 'small';
    this.endsAt = now + (small ? SMALL_TEST.timeMs : event.def.timeMs);
    const pack = small ? undefined : event.def.pack;
    this.nextReinforcement = now + (pack?.respawnMs ?? Infinity);

    // Everyone in, side by side at the entrance.
    host.humans().forEach((p, i) => host.place(p, zone.start.x + (i % 2) * 1.2 - 0.6, zone.start.z + Math.floor(i / 2) * 1.2, now));

    const rooms = this.placeCrystals(small ? SMALL_TEST.crystals : event.def.crystals, small);
    const fromStart = (c: NavPoint) => Math.hypot(c.x - zone.start.x, c.z - zone.start.z);

    if (small) {
      for (let i = 0; i < SMALL_TEST.monkeys; i++) this.spawn('monkey', rooms[(i * 5 + 3) % rooms.length]!, now, 'patrol');
    } else if (pack) {
      const total = Math.max(3, Math.round(zone.cells.length * pack.perRoom));
      let left = total;
      // Asleep by some of the crystals (take one and it may wake).
      const sleepers = Math.min(left, Math.round(this.crystals.size * pack.sleepShare));
      [...this.crystals.values()].slice(0, sleepers).forEach((c) => {
        this.spawn('monkey', { x: c.x + 1.3, z: c.z }, now, 'sleep', { x: c.x, z: c.z });
        left--;
      });
      // Up in the ceiling, beside a hole, waiting for you to pass under.
      for (const hole of shuffle(zone.gaps).slice(0, Math.min(pack.ceiling, left))) {
        this.spawn('monkey', { x: hole.x + zone.roomSize / 2 + 0.7, z: hole.z }, now, 'ceiling', hole, 3.4);
        left--;
      }
      // The rest patrol, starting well away from the entrance.
      const far = shuffle(zone.cells.filter((c) => fromStart(c) > 30));
      for (let i = 0; i < left; i++) this.spawn('monkey', far[i % far.length]!, now, 'patrol');
    }
    // The event's fixed cast (the Phone Mission), on top.
    const lairs = shuffle([...zone.corners.filter((c) => fromStart(c) > 6), ...rooms]);
    let k = 0;
    if (!small) {
      for (const [kind, count] of Object.entries(event.def.enemies) as [ZombieKind, number][]) {
        for (let i = 0; i < count; i++) {
          const at = lairs[k++ % lairs.length]!;
          // Monkeys hunt about; some keep to their dead end until something comes.
          this.spawn(kind, at, now, kind === 'monkey' ? (event.def.smart && i % 2 === 0 ? 'patrol' : 'search') : null);
        }
      }
    }
    event.onStart?.(this, now);
    host.message(`📱 ${event.def.name}: find all ${this.crystals.size} purple crystals with your phone map, then get to the portal. ${Math.round((this.endsAt - now) / 60000)} minutes!${small ? ' (small test)' : ''}`);
    this.emit();
  }

  /**
   * Crystals one per room, spread over the whole level: a share of them far from the entrance,
   * the rest anywhere (never the entrance or the exit). A small test keeps them close.
   */
  private placeCrystals(count: number, small: boolean): NavPoint[] {
    const zone = this.zone;
    const fromStart = (c: NavPoint) => Math.hypot(c.x - zone.start.x, c.z - zone.start.z);
    const ok = (c: NavPoint) => fromStart(c) > 4 && Math.hypot(c.x - zone.exit.x, c.z - zone.exit.z) > 2;
    let rooms = shuffle(zone.cells.filter(ok));
    if (small) rooms = rooms.sort((a, b) => fromStart(a) - fromStart(b)).slice(0, Math.max(count, 8));
    const farCfg = small ? undefined : this.def.farCrystals;
    const far = farCfg ? rooms.filter((c) => fromStart(c) >= farCfg.distance) : [];
    const wantFar = farCfg ? Math.min(far.length, Math.ceil(count * farCfg.share)) : 0;
    const chosen = [...far.slice(0, wantFar)];
    // The rest spread out: each time the room farthest from the ones already picked (of a few tries).
    const pool = rooms.filter((c) => !chosen.includes(c));
    while (chosen.length < count && pool.length > 0) {
      let best = 0;
      let bestD = -1;
      for (let t = 0; t < 6; t++) {
        const i = Math.floor(Math.random() * pool.length);
        const d = Math.min(fromStart(pool[i]!), ...chosen.map((c) => Math.hypot(c.x - pool[i]!.x, c.z - pool[i]!.z)));
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      }
      chosen.push(pool.splice(best, 1)[0]!);
    }
    chosen.forEach((room, i) => this.crystals.set(i + 1, { id: i + 1, x: round(room.x, 2), y: 0.9, z: round(room.z, 2) }));
    return rooms;
  }

  private spawn(kind: ZombieKind, at: NavPoint, now: number, state: MonkeyState | null, spot: NavPoint | null = null, y = 0): void {
    const z = this.host.spawnMonster(kind, at, now, y);
    if (!z || kind !== 'monkey') return;
    z.monkey = MonkeyMind.create(state ?? 'patrol', now, spot ?? (state === 'search' ? at : null));
    if (state === 'search') {
      // Keeps to its dead end for a while, ready to pounce.
      z.monkey.lastSeen = at;
      z.monkey.searchUntil = now + 60_000;
    }
  }

  state(): HuntState {
    return {
      id: this.def.id,
      name: this.def.name,
      zone: this.zone.id,
      endsAt: this.endsAt,
      total: this.total,
      crystals: [...this.crystals.values()],
      portal: this.portal,
      blackoutUntil: this.blackoutUntil,
    };
  }

  private total = 0;

  emit(): void {
    this.total ||= this.crystals.size;
    this.host.broadcast('hunt', this.state());
  }

  /** Sounds the monkeys can hear right now. */
  noises(): readonly Noise[] {
    return this.noiseList;
  }

  /** A sound at (x, z) that carries `radius` metres (footsteps, a gunshot). */
  noise(x: number, z: number, radius: number, now: number): void {
    this.noiseList.push({ x, z, radius, at: now });
  }

  /** A monster saw `p`: the first time (per player), it's a scare. */
  onSpotted(p: ServerPlayer): void {
    if (this.spotted.has(p.pid)) return;
    this.spotted.add(p.pid);
    this.host.scare(p, 'spotted');
  }

  /** The extra scare: the power goes out for a few seconds. */
  blackout(now: number): void {
    this.blackoutUntil = now + CRYSTAL_HUNT.blackoutMs;
    for (const p of this.host.humans()) this.host.scare(p, 'blackout');
    this.host.message('⚡ The power is out...');
    this.emit();
  }

  update(now: number): void {
    if (this.result) return;
    const alive = this.host.survivors();
    if (alive.length === 0) return this.end(false, 'Everyone is down.');
    if (now >= this.endsAt) return this.end(false, 'Time ran out.');
    while (this.noiseList.length > 0 && now - this.noiseList[0]!.at > NOISE_MS) this.noiseList.shift();
    if (now >= this.nextStep) {
      this.nextStep = now + STEP_MS;
      for (const p of alive) this.footsteps(p, now);
    }
    this.reinforce(now);
    const r = CRYSTAL_HUNT.collectRadius;
    for (const p of alive) {
      for (const c of this.crystals.values()) {
        if (Math.hypot(p.state.x - c.x, p.state.z - c.z) > r || Math.abs(p.state.y + 0.9 - c.y) > 1.6) continue;
        this.crystals.delete(c.id);
        this.host.broadcast('crystal', { id: c.id, pid: p.pid, x: c.x, y: c.y, z: c.z });
        // Taking a crystal right next to a sleeping monkey wakes it.
        for (const m of this.host.monsters()) {
          if (m.monkey?.state === 'sleep' && Math.hypot(m.p.state.x - c.x, m.p.state.z - c.z) < 4) {
            m.monkey.state = 'investigate';
            m.monkey.goal = { x: c.x, z: c.z };
          }
        }
        if (this.crystals.size === 0) {
          this.portal = { ...this.zone.exit };
          for (const s of this.host.humans()) this.host.scare(s, 'lastCrystal');
          this.host.message('🌀 The last crystal! The exit portal is open: get to it!');
        }
        this.emit();
      }
      if (this.portal && Math.hypot(p.state.x - this.portal.x, p.state.z - this.portal.z) < CRYSTAL_HUNT.portalRadius) {
        return this.end(true, `${p.info.name} made it out!`);
      }
    }
    this.event.onUpdate?.(this, now);
  }

  /** Footsteps: slow-walking or crouching is quiet, running carries, splashing carries further. */
  private footsteps(p: ServerPlayer, now: number): void {
    const s = p.state;
    if (s.horizontalSpeed < 1 || !s.onGround) return;
    const quiet = p.lastInput?.slowWalk === true || s.crouching;
    const f = this.zone.flood;
    const wet = f !== null && s.x > f.minX && s.x < f.maxX && s.z > f.minZ && s.z < f.maxZ;
    const h = MONKEYS.hearing;
    this.noise(s.x, s.z, wet ? (quiet ? h.run : h.splash) : quiet ? h.quiet : h.run, now);
  }

  /** One more monkey every so often, somewhere nobody can see, far from everyone, up to the cap. */
  private reinforce(now: number): void {
    const pack = this.variant === 'full' ? this.def.pack : undefined;
    if (!pack || now < this.nextReinforcement) return;
    this.nextReinforcement = now + pack.respawnMs;
    if (this.host.monsters().filter((m) => m.kind === 'monkey').length >= pack.cap) return;
    const people = this.host.survivors();
    const hidden = (c: NavPoint) =>
      people.every((p) => {
        const dx = c.x - p.state.x;
        const dz = c.z - p.state.z;
        const d = Math.hypot(dx, dz);
        if (d < 25) return false;
        if (d > MONKEYS.sightRange * 1.5) return true;
        return raycastWorld(makeRay({ x: p.state.x, y: 1.3, z: p.state.z }, { x: dx / d, y: 0, z: dz / d }), this.host.world, d) !== null;
      });
    const spot = shuffle(this.zone.cells).find(hidden);
    if (spot) this.spawn('monkey', spot, now, 'patrol');
  }

  /** Is (x, z) inside this event's level? */
  contains(x: number, z: number): boolean {
    const b = this.zone;
    return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  }

  private end(success: boolean, reason: string): void {
    this.result = { success, reason };
    this.host.broadcast('huntEnd', { success, reason });
    this.host.broadcast('hunt', null);
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
