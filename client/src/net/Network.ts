import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, CreateRoomRequest, JoinResponse, MapId, ModeId, RoomSummary, ServerToClientEvents } from '@game/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const REQUEST_TIMEOUT_MS = 6000;
const PING_INTERVAL_MS = 2000;

export class Network {
  readonly socket: GameSocket;
  /** Last measured round-trip time in ms, or null before the first measurement. */
  ping: number | null = null;
  private pingTimer: number | undefined;

  /** The session cookie goes along with every (re)connect, so a new session is picked up automatically. */
  constructor() {
    // Same-origin: in dev Vite proxies /socket.io to the game server, in production the
    // game server hosts the page itself. WebSocket-only avoids long-polling fallbacks.
    this.socket = io({
      autoConnect: false,
      transports: ['websocket'],
    });
    this.socket.on('connect', () => this.startPinging());
    this.socket.on('disconnect', () => this.stopPinging());
  }

  connect(): void {
    if (!this.socket.connected) this.socket.connect();
  }

  /** Reconnects with a fresh token (after logging in as someone else). */
  reconnect(): void {
    this.socket.disconnect();
    this.socket.connect();
  }

  listRooms(): Promise<RoomSummary[]> {
    return this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('listRooms');
  }

  quickPlay(mode: ModeId, map?: MapId): Promise<JoinResponse> {
    return this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('quickPlay', map ? { mode, map } : { mode });
  }

  createRoom(req: CreateRoomRequest): Promise<JoinResponse> {
    return this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('createRoom', req);
  }

  joinRoom(req: { roomId?: string; code?: string }): Promise<JoinResponse> {
    return this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('joinRoom', req);
  }

  leaveRoom(): void {
    this.socket.emit('leaveRoom');
  }

  private startPinging(): void {
    this.stopPinging();
    const measure = async () => {
      const start = performance.now();
      try {
        await this.socket.timeout(PING_INTERVAL_MS).emitWithAck('latency');
        this.ping = Math.round(performance.now() - start);
      } catch {
        // Timed out; keep the previous value and try again next interval.
      }
    };
    void measure();
    this.pingTimer = window.setInterval(measure, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    window.clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.ping = null;
  }
}
