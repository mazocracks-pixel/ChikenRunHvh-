import {
  CRYSTAL_HUNT,
  round,
  type CrystalState,
  type HuntEventDef,
  type HuntScare,
  type HuntState,
  type MapZone,
  type ZombieKind,
} from '@game/shared';
import type { ServerPlayer } from '../ServerPlayer';
import type { Zombie } from './ZombieBrain';

/** What a Crystal Hunt needs from the room it runs in (the Zombie Apocalypse room). */
export interface HuntHost {
  readonly zones: readonly MapZone[];
  /** Survivors who are alive, and every survivor (dead ones too). */
  survivors(): ServerPlayer[];
  humans(): ServerPlayer[];
  /** Puts a survivor somewhere (alive, if they were dead), and tells everyone. */
  place(p: ServerPlayer, x: number, z: number, now: number): void;
  /** A monster for the event, standing at `at`. */
  spawnMonster(kind: ZombieKind, at: { x: number; z: number }, now: number): Zombie | null;
  /** Sends to everyone in the room, or to one player. */
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
  private readonly crystals = new Map<number, CrystalState>();
  private portal: { x: number; z: number } | null = null;
  /** Players a monster has already scared by spotting them. */
  private readonly spotted = new Set<number>();
  blackoutUntil = 0;
  /** Set when it's over: why. */
  result: { success: boolean; reason: string } | null = null;

  constructor(private readonly host: HuntHost, private readonly event: HuntEvent, now: number) {
    this.def = event.def;
    const zone = host.zones.find((z) => z.id === event.def.zone);
    if (!zone) throw new Error(`No level "${event.def.zone}" for ${event.def.name}`);
    this.zone = zone;
    this.startedAt = now;
    this.endsAt = now + event.def.timeMs;

    // Everyone in, side by side at the entrance.
    host.humans().forEach((p, i) => host.place(p, zone.start.x + (i % 2) * 1.2 - 0.6, zone.start.z + Math.floor(i / 2) * 1.2, now));

    // Crystals in random rooms, never the entrance or the exit (one per room while rooms last).
    const far = (c: { x: number; z: number }) => Math.hypot(c.x - zone.start.x, c.z - zone.start.z) > 4 && Math.hypot(c.x - zone.exit.x, c.z - zone.exit.z) > 2;
    const rooms = shuffle(zone.cells.filter(far));
    for (let i = 0; i < event.def.crystals; i++) {
      const room = rooms[i % rooms.length]!;
      // A second one in the same room sits off to the side.
      const off = i >= rooms.length ? 1.6 : 0;
      this.crystals.set(i + 1, { id: i + 1, x: round(room.x + off, 2), y: 0.9, z: round(room.z + off, 2) });
    }

    // Monsters: lurking in the dead ends (or anywhere far from the entrance if there are too few).
    const lairs = shuffle([...zone.corners.filter(far), ...rooms]);
    let k = 0;
    for (const [kind, count] of Object.entries(event.def.enemies) as [ZombieKind, number][]) {
      for (let i = 0; i < count; i++) {
        const z = host.spawnMonster(kind, lairs[k++ % lairs.length]!, now);
        if (!z) continue;
        z.lair = { x: z.p.state.x, z: z.p.state.z };
        // Smarter events: half the monkeys come looking for you instead of waiting.
        z.alerted = kind !== 'monkey' || (event.def.smart && i % 2 === 0);
      }
    }
    event.onStart?.(this, now);
    host.message(`📱 ${event.def.name}: find all ${event.def.crystals} purple crystals with your phone map, then get to the portal. ${Math.round(event.def.timeMs / 60000)} minutes!`);
    this.emit();
  }

  state(): HuntState {
    return {
      id: this.def.id,
      name: this.def.name,
      zone: this.zone.id,
      endsAt: this.endsAt,
      total: this.def.crystals,
      crystals: [...this.crystals.values()],
      portal: this.portal,
      blackoutUntil: this.blackoutUntil,
    };
  }

  emit(): void {
    this.host.broadcast('hunt', this.state());
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
    const r = CRYSTAL_HUNT.collectRadius;
    for (const p of alive) {
      for (const c of this.crystals.values()) {
        if (Math.hypot(p.state.x - c.x, p.state.z - c.z) > r || Math.abs(p.state.y + 0.9 - c.y) > 1.6) continue;
        this.crystals.delete(c.id);
        this.host.broadcast('crystal', { id: c.id, pid: p.pid, x: c.x, y: c.y, z: c.z });
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

  /** Is `p` inside this event's level? */
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
