import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@game/shared';
import { startGameServer } from '../src/app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('With bots / Without bots', () => {
  it('keeps the two kinds of players in separate rooms; without bots has no bots and waits for people', async () => {
    const server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000 });
    const clients: Client[] = [];
    try {
      const base = `http://localhost:${server.port}`;
      const join = async () => {
        const { token } = (await (await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'x-session-transport': 'token' } })).json()) as { token: string };
        const c: Client = connect(base, { transports: ['websocket'], auth: { token }, reconnection: false });
        clients.push(c);
        await new Promise<void>((resolve, reject) => {
          c.once('connect', () => resolve());
          c.once('connect_error', reject);
        });
        return c;
      };
      const play = async (c: Client, noBots: boolean) => {
        const res = await c.timeout(3000).emitWithAck('quickPlay', { mode: 'ffa', map: 'farm', ...(noBots ? { noBots: true } : {}) });
        assert.ok(res.ok);
        return res.ok ? res : (undefined as never);
      };
      const [a, b, c] = [await join(), await join(), await join()];
      const without1 = await play(a, true);
      const withBots = await play(b, false);
      const without2 = await play(c, true);

      assert.notEqual(without1.room.id, withBots.room.id, 'different rooms');
      assert.equal(without2.room.id, without1.room.id, 'the second "without bots" player joins the first');
      assert.equal(without1.room.noBots, true);
      assert.equal(withBots.room.noBots, undefined);

      await new Promise((r) => setTimeout(r, 2500));
      const room = server.rooms.get(without1.room.id)!;
      assert.equal([...room.players.values()].filter((p) => p.info.bot).length, 0, 'no bots, even after waiting');
      const botRoom = server.rooms.get(withBots.room.id)!;
      assert.ok([...botRoom.players.values()].some((p) => p.info.bot), 'the "with bots" room has bots');
    } finally {
      for (const c of clients) c.disconnect();
      await server.close();
    }
  });

  it('a room without bots waits for 2 people in a mode that needs 2, and starts once they are there', async () => {
    const server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000 });
    const clients: Client[] = [];
    try {
      const base = `http://localhost:${server.port}`;
      const join = async () => {
        const { token } = (await (await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'x-session-transport': 'token' } })).json()) as { token: string };
        const c: Client = connect(base, { transports: ['websocket'], auth: { token }, reconnection: false });
        clients.push(c);
        await new Promise<void>((resolve, reject) => {
          c.once('connect', () => resolve());
          c.once('connect_error', reject);
        });
        return c;
      };
      const a = await join();
      const first = await a.timeout(3000).emitWithAck('quickPlay', { mode: 'tdm', map: 'farm', noBots: true });
      assert.ok(first.ok);
      if (!first.ok) return;
      assert.equal(first.match.phase, 'waiting');
      const phases: string[] = [];
      a.on('match', (m) => phases.push(m.phase));
      const b = await join();
      assert.ok((await b.timeout(3000).emitWithAck('joinRoom', { roomId: first.room.id })).ok);
      await new Promise((r) => setTimeout(r, 600));
      assert.ok(phases.includes('countdown'), `the second person starts the countdown (${phases.join(',')})`);
    } finally {
      for (const c of clients) c.disconnect();
      await server.close();
    }
  });
});
