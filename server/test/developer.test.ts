import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, JoinResponse, LeaderboardRow, ServerToClientEvents } from '@game/shared';
import { startGameServer, type RunningServer } from '../src/app';
import { isReservedName } from '../src/auth';
import { GameDatabase } from '../src/db/Database';
import { DevAccess } from '../src/dev/DevAccess';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('reserved names', () => {
  it('blocks staff names and their look-alikes, but not ordinary names', () => {
    for (const name of ['Developer', 'developer', 'D e v e l o p e r', 'D.e.v.e.l.o.p.e.r', 'Deve1oper', 'DЕVЕLОPЕR', 'xX_Developer_Xx', 'Admin', 'Moderator', 'Dev', '[DEV]', 'M0D']) {
      assert.equal(isReservedName(name), true, name);
    }
    for (const name of ['Devin', 'Chicken1234', 'Feathers', 'Cluckington', 'Modest', 'Develop']) {
      assert.equal(isReservedName(name), false, name);
    }
  });
});

describe('DevAccess for developer accounts only', () => {
  it('refuses other accounts without even checking the passkey', () => {
    const developers = new Set([1]);
    const dev = new DevAccess({ passkey: '2010', allowPublicRooms: false, isDeveloper: (id) => developers.has(id) });
    assert.equal(dev.tryUnlock(2, 'ip', '2010'), 'denied', 'the right passkey is not enough');
    assert.equal(dev.isGranted(2), false);
    // Denied tries don't use up the shared per-IP guess budget.
    for (let i = 0; i < 20; i++) dev.tryUnlock(2, 'ip', '2010');
    assert.equal(dev.tryUnlock(1, 'ip', '2010'), 'ok');
    assert.equal(dev.isGranted(1), true);
    developers.delete(1);
    assert.equal(dev.isGranted(1), false, 'removing developer status ends access at once');
  });
});

describe('developer accounts', () => {
  let server: RunningServer;
  let base: string;
  const sockets: Client[] = [];

  before(async () => {
    server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000, devPasskey: '2010', devAccountsOnly: true });
    base = `http://localhost:${server.port}`;
  });

  after(async () => {
    for (const s of sockets) s.disconnect();
    await server.close();
  });

  const api = async (path: string, method: string, cookie: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { cookie: `cg_session=${cookie}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('cg_session='));
    return { status: res.status, body: (await res.json()) as { error?: string; profile?: { id: number; name: string; developer: boolean } }, cookie: set?.slice(11).split(';')[0] };
  };
  const register = async (username: string) => {
    const guest = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    const cookie = guest.headers.getSetCookie()[0]!.slice(11).split(';')[0]!;
    const res = await api('/api/auth/register', 'POST', cookie, { username, password: 'correct-horse-7' });
    assert.equal(res.status, 200, res.body.error ?? `status ${res.status}`);
    return { cookie: res.cookie!, id: res.body.profile!.id };
  };
  const socket = (cookie: string) =>
    new Promise<Client>((resolve, reject) => {
      const s: Client = connect(base, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: `cg_session=${cookie}` } });
      sockets.push(s);
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  const call = <T>(fn: (ack: (r: T) => void) => void) => new Promise<T>((resolve) => fn(resolve));

  it('nobody can register or rename to a reserved name', async () => {
    const guest = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    const cookie = guest.headers.getSetCookie()[0]!.slice(11).split(';')[0]!;
    assert.equal((await api('/api/auth/register', 'POST', cookie, { username: 'Developer', password: 'correct-horse-7' })).body.error, 'That name is reserved.');
    const player = await register('plain_player');
    assert.equal((await api('/api/me', 'PATCH', player.cookie, { name: 'Deve1oper' })).body.error, 'That name is reserved.');
    assert.equal((await api('/api/me', 'PATCH', player.cookie, { name: 'Nugget' })).status, 200);
  });

  it('a developer gets the profile flag, a rainbow name in rooms, chat and the leaderboard, and the dev menu', async () => {
    const me = await register('owner_acct');
    const other = await register('other_acct');
    server.db.setDeveloper(me.id, true);
    server.db.updateProfile(me.id, { name: 'Developer' });
    server.db.setCoins(me.id, 9_999_999);

    const profile = (await api('/api/me', 'GET', me.cookie)).body.profile!;
    assert.equal(profile.developer, true);
    assert.equal(profile.name, 'Developer');
    assert.equal((profile as unknown as { coins: number }).coins, 9_999_999);
    assert.equal((await api('/api/me', 'PATCH', me.cookie, { name: 'Developer' })).status, 200, 'developers may keep the name');

    const devSocket = await socket(me.cookie);
    const otherSocket = await socket(other.cookie);
    const room = await call<JoinResponse>((ack) => devSocket.emit('createRoom', { mode: 'sandbox', map: 'flat', private: true }, ack));
    assert.ok(room.ok);
    const joined = await call<JoinResponse>((ack) => otherSocket.emit('joinRoom', { code: room.room.code! }, ack));
    assert.ok(joined.ok);
    const byName = new Map(joined.players.map((p) => [p.name, p]));
    assert.equal(byName.get('Developer')?.dev, true);
    assert.equal(byName.get('other_acct')?.dev, undefined, 'normal players have no flag');

    const heard = new Promise<{ dev?: boolean }>((resolve) => otherSocket.on('chat', (m) => m.pid !== 0 && resolve(m)));
    devSocket.emit('chat', 'hello');
    assert.equal((await heard).dev, true);

    // Dev menu: the developer unlocks it, another account can't even with the right passkey.
    assert.deepEqual(await call((ack) => devSocket.emit('devAuth', '2010', ack)), { ok: true });
    assert.deepEqual(await call((ack) => otherSocket.emit('devAuth', '2010', ack)), { ok: false, error: 'Developer tools are not available.' });

    server.db.recordMatch([{ userId: me.id, kills: 3, deaths: 1, won: true, coins: 0 }]);
    const rows = ((await (await fetch(`${base}/api/leaderboard`)).json()) as { rows: LeaderboardRow[] }).rows;
    assert.equal(rows.find((r) => r.name === 'Developer')?.dev, true);
  });
});

describe('npm run developer', () => {
  it('makes a registered account a developer, and back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-dev-'));
    const dbPath = join(dir, 'game.db');
    try {
      const db = new GameDatabase(dbPath);
      const id = db.createUser('Chicken1234', 250);
      db.setCredentials(id, 'beka_test', 'scrypt$placeholder');
      db.close();
      const script = fileURLToPath(new URL('../src/tools/developer.ts', import.meta.url));
      const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', script, ...args], { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

      assert.match(run('beka_test'), /beka_test is now a developer: name "Developer" \(rainbow\), 9,999,999 coins/);
      let check = new GameDatabase(dbPath);
      assert.deepEqual(
        (({ name, coins, developer }) => ({ name, coins, developer }))(check.profile(id)!),
        { name: 'Developer', coins: 9_999_999, developer: true },
      );
      check.close();
      assert.match(run('--list'), /beka_test {2}name: Developer {2}coins: 9,999,999/);

      assert.match(run('beka_test', '--remove'), /normal player again/);
      check = new GameDatabase(dbPath);
      assert.equal(check.profile(id)!.developer, false);
      assert.equal(check.profile(id)!.name, 'beka_test', 'the staff name is given back');
      check.close();

      assert.throws(() => run('nobody_here'), /No registered account/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
