import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@game/shared';

export interface SocketData {
  userId: number;
  /** Client IP (for per-IP limits). */
  ip: string;
}

type NoInterServerEvents = Record<string, never>;

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, NoInterServerEvents, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, NoInterServerEvents, SocketData>;
