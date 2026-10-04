import { MODES, levelFor, type JoinResponse, type MapId, type ModeId, type RoomSummary } from '@game/shared';
import type { GameDatabase } from '../db/Database';
import type { GameServer, GameSocket } from '../types';
import { randomRoomCode, randomString } from '../util';
import type { AntiCheatMode } from './AntiCheat';
import { GameRoom, type PlayerProfile, type RoomHooks } from './GameRoom';
import { createRoom } from './modes';

export const MAX_ROOMS = 200;

/** Creates, finds and cleans up rooms, and remembers which room each socket is in. */
export class RoomManager {
  private readonly io: GameServer;
  private readonly db: GameDatabase;
  private readonly rooms = new Map<string, GameRoom>();
  private readonly socketRooms = new Map<string, GameRoom>();
  private readonly hooks: RoomHooks;
  private publicCounter = 1;

  private readonly antiCheat: AntiCheatMode;

  constructor(io: GameServer, db: GameDatabase, options: { antiCheat?: AntiCheatMode } = {}) {
    this.io = io;
    this.db = db;
    this.antiCheat = options.antiCheat ?? 'enforce';
    this.hooks = {
      onMatchEnd: (room, results) => this.db.recordMatch(results, room.mode.id),
      onEmpty: (room) => this.close(room),
      onCheat: (room, player, reason, details, remove) => {
        if (!remove) return;
        if (player.userId !== null) this.db.addStrike(player.userId, reason, { ...details, room: room.info.id, map: room.info.map });
        const socket = player.socket;
        if (!socket) return room.removePlayer(player);
        socket.emit('roomClosed', `Removed by the FaceChiken anti-cheat (${reason}). That counts as a loss, and a strike: strikes ban you from FaceChiken for a while.`);
        void socket.leave(room.channel);
        this.leave(socket);
      },
    };
  }

  get count(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.humanCount;
    return n;
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => !r.info.private).map((r) => r.summary());
  }

  get(id: string): GameRoom | undefined {
    return this.rooms.get(id);
  }

  byCode(code: string): GameRoom | undefined {
    const wanted = code.trim().toUpperCase();
    for (const room of this.rooms.values()) if (room.info.code === wanted) return room;
    return undefined;
  }

  roomOf(socketId: string): GameRoom | undefined {
    return this.socketRooms.get(socketId);
  }

  /** The busiest public room of this mode that still has space, or a brand new one. */
  /** The busiest open public room for a mode (and map, if one is asked for), or a new one. */
  quickPlay(mode: ModeId, map?: MapId): GameRoom | null {
    let best: GameRoom | null = null;
    for (const room of this.rooms.values()) {
      if (room.info.private || room.info.mode !== mode || room.isFull || (map && room.info.map !== map)) continue;
      if (!best || room.humanCount > best.humanCount) best = room;
    }
    if (best) return best;
    const maps = MODES[mode].maps;
    return this.create(mode, map ?? maps[Math.floor(Math.random() * maps.length)]!, false, undefined, 0, true);
  }

  create(mode: ModeId, map: MapId, isPrivate: boolean, hostName?: string, bots = 0, fillBots = false): GameRoom | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    let id = randomString(8);
    while (this.rooms.has(id)) id = randomString(8);
    let code = randomRoomCode();
    while (this.byCode(code)) code = randomRoomCode();
    const name = isPrivate && hostName ? `${hostName}'s room` : `${MODES[mode].name} #${this.publicCounter++}`;
    const room = createRoom(this.io, { id, code, name, mode, map, private: isPrivate, bots, fillBots, antiCheat: this.antiCheat }, this.hooks);
    this.rooms.set(id, room);
    return room;
  }

  /** Moves a socket into a room (leaving any previous one) using its account profile. */
  join(socket: GameSocket, room: GameRoom | null): JoinResponse {
    if (!room) return { ok: false, error: 'The server is busy, try again soon.' };
    const profile = this.db.profile(socket.data.userId);
    if (!profile) return { ok: false, error: 'Account not found. Reload the page.' };
    if (this.socketRooms.get(socket.id) === room) return { ok: false, error: 'Already in this room.' };
    // Ranked is for real, registered players.
    if (MODES[room.info.mode].ranked && !profile.username) {
      if (room.humanCount === 0) this.close(room);
      return { ok: false, error: 'FaceChiken is for registered players: tap “Save progress” to register (it’s free).' };
    }
    const ban = MODES[room.info.mode].ranked ? this.db.rankedBan(profile.id) : null;
    if (ban) {
      if (room.humanCount === 0) this.close(room);
      const until = Number.isFinite(ban.until) ? `until ${new Date(ban.until).toUTCString()}` : 'for good';
      return { ok: false, error: `You're banned from FaceChiken ${until} (anti-cheat: ${ban.reason}). Other modes are open.` };
    }

    this.leave(socket);
    const playerProfile: PlayerProfile = {
      userId: profile.id,
      name: profile.name,
      appearance: profile.appearance,
      loadout: profile.loadout,
      dev: profile.developer,
      rank: levelFor(profile.xp),
    };
    const res = room.join(socket, playerProfile);
    if (res.ok) this.socketRooms.set(socket.id, room);
    else if (room.humanCount === 0) this.close(room);
    return res;
  }

  leave(socket: GameSocket): void {
    const room = this.socketRooms.get(socket.id);
    if (!room) return;
    this.socketRooms.delete(socket.id);
    room.leave(socket.id);
  }

  close(room: GameRoom): void {
    if (!this.rooms.delete(room.info.id)) return;
    for (const [socketId, r] of this.socketRooms) if (r === room) this.socketRooms.delete(socketId);
    room.close();
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.close(room);
  }
}
