import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@game/shared';
import { startGameServer } from '../src/app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('reporting a player', () => {
  it('saves one report per player per 10 minutes and refuses bad ones', async () => {
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
      const [a, b] = [await join(), await join()];
      const ra = await a.timeout(3000).emitWithAck('createRoom', { mode: 'ffa', map: 'farm', private: false, bots: 2 });
      assert.ok(ra.ok);
      if (!ra.ok) return;
      const rb = await b.timeout(3000).emitWithAck('joinRoom', { roomId: ra.room.id });
      assert.ok(rb.ok);
      if (!rb.ok) return;
      const send = (c: Client, pid: number, reason: string) => c.timeout(3000).emitWithAck('report', { pid, reason } as never);

      assert.deepEqual(await send(a, rb.selfPid, 'cheating'), { ok: true });
      assert.equal(server.db.reports().length, 1);
      assert.equal(server.db.reports()[0]!.reason, 'cheating');
      assert.equal(server.db.reports()[0]!.mode, 'ffa');

      assert.deepEqual(await send(a, rb.selfPid, 'abuse'), { ok: true }, 'repeat is accepted quietly');
      assert.equal(server.db.reports().length, 1, 'but not saved twice');

      assert.equal((await send(a, ra.selfPid, 'cheating')).ok, false, 'not yourself');
      assert.equal((await send(a, rb.selfPid, 'because')).ok, false, 'unknown reason');
      assert.equal((await send(a, 99999, 'cheating')).ok, false, 'nobody with that id');
      const bot = [...server.rooms.get(ra.room.id)!.players.values()].find((p) => p.info.bot);
      if (bot) assert.equal((await send(a, bot.pid, 'cheating')).ok, false, 'bots cannot be reported');
      assert.equal(server.db.reports().length, 1);
    } finally {
      for (const c of clients) c.disconnect();
      await server.close();
    }
  });
});
