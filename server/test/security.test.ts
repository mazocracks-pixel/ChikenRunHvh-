import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@game/shared';
import { startGameServer, type RunningServer } from '../src/app';
import { hashToken, validatePassword } from '../src/auth';
import { DATA_RETENTION, GameDatabase } from '../src/db/Database';
import { LoginGuard } from '../src/security';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: RunningServer;
let base: string;
const sockets: Client[] = [];

before(async () => {
  server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000 });
  base = `http://localhost:${server.port}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

interface Reply {
  status: number;
  body: { token?: string; error?: string; profile?: { id: number; username: string | null } };
  cookie: string | null;
  headers: Headers;
}

/** A browser-like request: cookies only, no token in the body unless `token` asks for it. */
async function call(path: string, init: { method?: string; cookie?: string; bearer?: string; body?: unknown; origin?: string; raw?: string; wantToken?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined || init.raw !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = `cg_session=${init.cookie}`;
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  if (init.origin) headers.origin = init.origin;
  if (init.wantToken) headers['x-session-transport'] = 'token';
  const res = await fetch(base + path, { method: init.method ?? 'GET', headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('cg_session=')) ?? null;
  const cookie = setCookie ? setCookie.slice('cg_session='.length).split(';')[0]! : null;
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Reply['body'], cookie, headers: res.headers };
}

/** A new guest; returns its session (cookie value). */
async function guest(): Promise<string> {
  const res = await call('/api/auth/guest', { method: 'POST' });
  assert.ok(res.cookie, 'guest gets a session cookie');
  return res.cookie;
}

let nameCounter = 0;
async function registered(password = 'correct-horse-7'): Promise<{ cookie: string; username: string; password: string }> {
  const username = `sec_${process.pid % 1000}_${nameCounter++}`;
  const res = await call('/api/auth/register', { method: 'POST', cookie: await guest(), body: { username, password } });
  assert.equal(res.status, 200, res.body.error ?? `status ${res.status}`);
  return { cookie: res.cookie!, username, password };
}

describe('session cookie', () => {
  it('is HttpOnly + SameSite=Strict, and the token is never in a browser response body', async () => {
    const res = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('cg_session='))!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    const body = (await res.json()) as { token?: string };
    assert.equal(body.token, undefined, 'scripts never see the token');
    const token = cookie.slice('cg_session='.length).split(';')[0]!;
    assert.equal((await call('/api/me', { cookie: token })).status, 200);
    assert.equal((await call('/api/me')).status, 401);
  });

  it('page load resumes the session, or starts a guest when there is none', async () => {
    const first = await call('/api/auth/start', { method: 'POST' });
    assert.equal(first.status, 200);
    assert.ok(first.cookie, 'new guest session');
    const again = await call('/api/auth/start', { method: 'POST', cookie: first.cookie! });
    assert.equal(again.body.profile?.id, first.body.profile?.id);
    assert.equal(again.cookie, null, 'same session, no new cookie');
  });

  it('moves an old localStorage (Bearer) login over to a cookie', async () => {
    const { body } = await call('/api/auth/guest', { method: 'POST', wantToken: true });
    const res = await call('/api/auth/session', { method: 'POST', bearer: body.token });
    assert.equal(res.status, 200);
    assert.ok(res.cookie);
    assert.equal((await call('/api/me', { bearer: body.token })).status, 401, 'the old token is retired');
    assert.equal((await call('/api/me', { cookie: res.cookie! })).status, 200);
  });
});

describe('browser protections', () => {
  it('sends security headers and never caches API answers', async () => {
    const res = await call('/api/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /'wasm-unsafe-eval'/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('refuses cross-site requests (CSRF) but accepts same-site ones', async () => {
    const cookie = await guest();
    const evil = await call('/api/me', { method: 'PATCH', cookie, origin: 'https://evil.example', body: { name: 'pwned' } });
    assert.equal(evil.status, 403);
    const own = await call('/api/me', { method: 'PATCH', cookie, origin: base, body: { name: 'Fine' } });
    assert.equal(own.status, 200);
  });

  it('answers bad JSON with a short message, not a stack trace', async () => {
    const res = await call('/api/auth/login', { method: 'POST', raw: '{"username": ' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Bad request.' });
  });

  it('refuses sockets from other sites and accepts the session cookie', async () => {
    const cookie = await guest();
    const open = (headers: Record<string, string>) =>
      new Promise<string>((resolve) => {
        const s: Client = connect(base, { transports: ['websocket'], reconnection: false, extraHeaders: headers });
        sockets.push(s);
        s.once('connect', () => resolve('connected'));
        s.once('connect_error', (e) => resolve(e.message));
      });
    assert.equal(await open({ cookie: `cg_session=${cookie}`, origin: 'https://evil.example' }), 'forbidden origin');
    assert.equal(await open({ cookie: `cg_session=${cookie}`, origin: base }), 'connected');
    assert.equal(await open({ origin: base }), 'unauthorized');
  });
});

describe('passwords and logins', () => {
  it('refuses weak passwords', () => {
    assert.ok(validatePassword('short1'));
    assert.ok(validatePassword('12345678'));
    assert.ok(validatePassword('aaaaaaaaaa'), 'too few different characters');
    assert.ok(validatePassword('henrietta99', 'henrietta'), 'contains the username');
    assert.equal(validatePassword('correct-horse-7', 'henrietta'), null);
  });

  it('locks an account after repeated wrong passwords, whatever the IP', async () => {
    const { username, password } = await registered();
    for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/login', { method: 'POST', body: { username, password: `wrong-${i}-pass` } })).status, 401);
    const locked = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(locked.status, 429, 'even the right password waits now');
    // Different capitalisation is the same account.
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: username.toUpperCase(), password } })).status, 429);
  });

  it('LoginGuard keeps its memory bounded under a flood of made-up usernames', () => {
    const guard = new LoginGuard();
    for (let i = 0; i < 60_000; i++) guard.fail(`flood${i}`, 1000);
    assert.ok(guard.size <= 50_001, `tracking ${guard.size}`);
  });

  it('LoginGuard unlocks after the lock time', () => {
    const guard = new LoginGuard(3, 1000, 5000);
    for (let i = 0; i < 3; i++) guard.fail('hen', 100);
    assert.ok(guard.lockedFor('hen', 200) > 0);
    assert.equal(guard.lockedFor('hen', 6000), 0);
  });

  it('gives a new session on register, and the guest one stops working', async () => {
    const guestCookie = await guest();
    const res = await call('/api/auth/register', { method: 'POST', cookie: guestCookie, body: { username: `rot_${nameCounter++}`, password: 'correct-horse-7' } });
    assert.equal(res.status, 200);
    assert.notEqual(res.cookie, guestCookie);
    assert.equal((await call('/api/me', { cookie: guestCookie })).status, 401);
    assert.equal((await call('/api/me', { cookie: res.cookie! })).status, 200);
  });

  it('changing the password signs out every other device', async () => {
    const { cookie: a, username, password } = await registered();
    const b = (await call('/api/auth/login', { method: 'POST', body: { username, password } })).cookie!;
    const wrong = await call('/api/auth/password', { method: 'POST', cookie: a, body: { current: 'not-it-123', next: 'brand-new-pass-9' } });
    assert.equal(wrong.status, 401);
    const changed = await call('/api/auth/password', { method: 'POST', cookie: a, body: { current: password, next: 'brand-new-pass-9' } });
    assert.equal(changed.status, 200);
    assert.equal((await call('/api/me', { cookie: b })).status, 401, 'other device signed out');
    assert.equal((await call('/api/me', { cookie: a })).status, 401, 'old session replaced');
    assert.equal((await call('/api/me', { cookie: changed.cookie! })).status, 200);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { username, password: 'brand-new-pass-9' } })).status, 200);
  });

  it('"log out everywhere" ends every session', async () => {
    const { cookie: a, username, password } = await registered();
    const b = (await call('/api/auth/login', { method: 'POST', body: { username, password } })).cookie!;
    assert.equal((await call('/api/auth/logout-all', { method: 'POST', cookie: b })).status, 200);
    assert.equal((await call('/api/me', { cookie: a })).status, 401);
    assert.equal((await call('/api/me', { cookie: b })).status, 401);
  });

  it('deletes an account (with its password) and all its data', async () => {
    const { cookie, username, password } = await registered();
    assert.equal((await call('/api/me', { method: 'DELETE', cookie, body: { password: 'nope-nope-1' } })).status, 401);
    assert.equal((await call('/api/me', { method: 'DELETE', cookie, body: { password } })).status, 200);
    assert.equal((await call('/api/me', { cookie })).status, 401);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { username, password } })).status, 401);
  });
});

describe('stored sessions', () => {
  it('expire when unused, are capped per account, and old guests are cleaned up', () => {
    const db = new GameDatabase(':memory:');
    const user = db.createUser('Hen', 0);
    const hashes = Array.from({ length: DATA_RETENTION.sessionsPerUser + 2 }, (_, i) => hashToken(`token-${i}-xxxxxxxxxxxxxxxxxxxx`));
    for (const h of hashes) db.createSession(user, h);
    const live = hashes.filter((h) => db.userIdForSession(h) === user);
    assert.equal(live.length, DATA_RETENTION.sessionsPerUser, 'oldest sessions were dropped');

    const later = Date.now() + DATA_RETENTION.sessionIdleMs + 1000;
    const removed = db.cleanup(later);
    assert.equal(removed.sessions, DATA_RETENTION.sessionsPerUser);
    assert.equal(db.userIdForSession(hashes.at(-1)!), undefined);
    assert.equal(db.cleanup(Date.now() + DATA_RETENTION.guestIdleMs + 1000).guests, 1, 'the idle guest account is gone');
    db.close();
  });
});
