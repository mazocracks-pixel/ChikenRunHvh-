import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MATCH, MODES, SIM_DT } from '@game/shared';
import { createRoom } from '../src/rooms/modes';
import type { GameRoom } from '../src/rooms/GameRoom';
import { addPlayer, fakeIo } from './helpers';

describe('Squad Up (real players only)', () => {
  it('has no bots, waits for 4 people, and keeps going if one leaves', () => {
    const { io } = fakeIo();
    // Asking for bots and quick-play filling changes nothing: this mode never has any.
    const room = createRoom(io, { id: 's', code: 'SQUAD', name: 'Squad', mode: 'squad', map: 'farm', private: false, bots: 6, fillBots: true }, {}) as GameRoom;
    clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
    assert.equal(MODES.squad.minPlayers, 4);
    let now = performance.now();
    const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
    const step = (ms: number) => {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + SIM_DT * 1000);
        update(now);
      }
    };
    const players = [addPlayer(room, 'A'), addPlayer(room, 'B'), addPlayer(room, 'C')];
    step(3000);
    assert.equal([...room.players.values()].filter((p) => p.info.bot).length, 0, 'no bots');
    assert.equal((room as unknown as { match: { phase: string } }).match.phase, 'waiting', '3 people are not enough');

    players.push(addPlayer(room, 'D'));
    step(100);
    assert.equal((room as unknown as { match: { phase: string } }).match.phase, 'countdown', 'the 4th person starts the countdown');
    step(MATCH.countdownMs + 200);
    assert.equal((room as unknown as { match: { phase: string } }).match.phase, 'playing');
    assert.equal([...room.players.values()].filter((p) => p.info.bot).length, 0);

    room.leave(players[3]!.socket?.id ?? '');
    (room as unknown as { players: Map<number, unknown> }).players.delete(players[3]!.pid);
    step(500);
    assert.equal((room as unknown as { match: { phase: string } }).match.phase, 'playing', 'the match goes on with 3');
    room.close();
  });
});
