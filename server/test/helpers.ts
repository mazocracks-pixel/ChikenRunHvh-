import { DEFAULT_APPEARANCE, DEFAULT_LOADOUT, type MapId, type ModeId } from '@game/shared';
import { GameRoom, type PlayerProfile, type RoomHooks } from '../src/rooms/GameRoom';
import type { GameServer } from '../src/types';

export interface RecordedEvent {
  event: string;
  args: unknown[];
}

/** A stand-in for Socket.IO that records every broadcast. */
export function fakeIo(): { io: GameServer; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const target = {
    emit: (event: string, ...args: unknown[]) => {
      events.push({ event, args });
      return true;
    },
  };
  const room = { ...target, volatile: target };
  return { io: { to: () => room } as unknown as GameServer, events };
}

export function makeRoom(mode: ModeId = 'ffa', map: MapId = 'farm', hooks: RoomHooks = {}) {
  const { io, events } = fakeIo();
  const room = new GameRoom(io, { id: 'test', code: 'TEST1', name: 'Test', mode, map, private: false }, hooks);
  return { room, events };
}

/** Advance one authoritative tick explicitly, without wall-clock sleeps. */
export function stepRoom(room: GameRoom, now = performance.now()): void {
  (room as unknown as { fixedUpdate(t: number): void }).fixedUpdate(now);
}

export function profile(name: string, userId: number | null = null): PlayerProfile {
  return { userId, name, appearance: { ...DEFAULT_APPEARANCE }, loadout: [...DEFAULT_LOADOUT] };
}

/** Adds a socket-less player and returns its server object. */
export function addPlayer(room: GameRoom, name: string, userId: number | null = null) {
  const res = room.join(null, profile(name, userId));
  if (!res.ok) throw new Error(res.error);
  const player = room.players.get(res.selfPid)!;
  player.shieldUntil = 0;
  return player;
}

export function place(p: { state: { x: number; y: number; z: number; onGround: boolean }; hvhMode?: boolean; history?: import('../src/rooms/History').History; yaw?: number }, x: number, z: number, y = 0): void {
  p.state.x = x;
  p.state.y = y;
  p.state.z = z;
  p.state.onGround = y === 0;
  if (p.hvhMode && p.history) { p.history.clear(); p.history.push({ t: performance.now(), x, y, z, yaw: p.yaw ?? 0, alive: true, scale: 1 }); }
}
