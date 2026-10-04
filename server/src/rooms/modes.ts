import type { GameServer } from '../types';
import { BombRoom } from './BombRoom';
import { CtfRoom } from './CtfRoom';
import { GameRoom, type RoomHooks, type RoomOptions } from './GameRoom';
import { SandboxRoom } from './SandboxRoom';

/** Picks the room implementation for a mode. */
export function createRoom(io: GameServer, options: RoomOptions, hooks: RoomHooks): GameRoom {
  switch (options.mode) {
    case 'bomb':
      return new BombRoom(io, options, hooks);
    case 'ctf':
      return new CtfRoom(io, options, hooks);
    case 'sandbox':
      return new SandboxRoom(io, options, hooks);
    default:
      return new GameRoom(io, options, hooks);
  }
}
