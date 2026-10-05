import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import {
  MAPS,
  SIM_DT,
  createCollisionWorld,
  stepPlayer,
  unpackPlayer,
  type ChatMessage,
  type ClientToServerEvents,
  type InputFrame,
  type JoinSuccess,
  type ServerToClientEvents,
  type WorldSnapshot,
  type MoveState,
} from '@game/shared';
import { startGameServer, type RunningServer } from '../src/app';
import type { Profile } from '../src/db/Database';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: RunningServer;
let base: string;
const clients: Client[] = [];

before(async () => {
  server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000 });
  base = `http://localhost:${server.port}`;
});

after(async () => {
  for (const c of clients) c.disconnect();
  await server.close();
});

async function api<T = { profile: Profile; token?: string; error?: string }>(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? 'GET',
    // A non-browser client: ask for the session token in the body instead of only a cookie.
    headers: { 'content-type': 'application/json', 'x-session-transport': 'token', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function guest() {
  const { body } = await api('/api/auth/guest', { method: 'POST' });
  return { token: body.token!, profile: body.profile };
}

function client(token: string): Promise<Client> {
  const c: Client = connect(base, { transports: ['websocket'], auth: { token }, reconnection: false });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once('connect', () => resolve(c));
    c.once('connect_error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('accounts and shop', () => {
  it('creates guest accounts with starting coins', async () => {
    const { token, profile } = await guest();
    assert.ok(token.length > 20);
    assert.equal(profile.coins, 250);
    assert.match(profile.name, /^Chicken\d{4}$/);
    const me = await api('/api/me', { token });
    assert.equal(me.body.profile.id, profile.id);
    assert.equal((await api('/api/me', { token: 'nope' })).status, 401);
  });

  it('buys items once, only with enough coins', async () => {
    const { token } = await guest();
    const buy = (itemId: string) => api('/api/shop/buy', { method: 'POST', token, body: { itemId } });
    const ok = await buy('hat:cap');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.profile.coins, 150);
    assert.ok(ok.body.profile.owned.includes('hat:cap'));
    assert.equal((await buy('hat:cap')).status, 409);
    assert.equal((await buy('hat:crown')).status, 402);
    assert.equal((await buy('skin:white')).status, 404, 'free items are not for sale');
    assert.equal((await buy('hat:does-not-exist')).status, 404);
  });

  it('only equips owned items', async () => {
    const { token } = await guest();
    await api('/api/shop/buy', { method: 'POST', token, body: { itemId: 'hat:cap' } });
    const res = await api('/api/me', {
      method: 'PATCH',
      token,
      body: { name: '  Clucky  ', appearance: { hat: 'cap', skin: 'golden', beak: 'orange' }, loadout: ['smg', 'sniper', 'sniper'] },
    });
    assert.equal(res.body.profile.name, 'Clucky');
    assert.deepEqual(res.body.profile.appearance, { skin: 'white', hat: 'cap', beak: 'orange', shoes: 'none' });
    assert.deepEqual(res.body.profile.loadout, ['sniper', 'knife'], 'unowned smg dropped; everyone gets the knife');
  });

  it('registers, logs in elsewhere and rejects bad passwords', async () => {
    const { token, profile } = await guest();
    const reg = await api('/api/auth/register', { method: 'POST', token, body: { username: `hen_${profile.id}`, password: 'secret123' } });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.profile.username, `hen_${profile.id}`);
    const other = await guest();
    const dup = await api('/api/auth/register', { method: 'POST', token: other.token, body: { username: `HEN_${profile.id}`, password: 'secret123' } });
    assert.equal(dup.status, 409, 'usernames are case-insensitive');
    const login = await api('/api/auth/login', { method: 'POST', body: { username: `hen_${profile.id}`, password: 'secret123' } });
    assert.equal(login.body.profile.id, profile.id);
    assert.notEqual(login.body.token, token);
    const bad = await api('/api/auth/login', { method: 'POST', body: { username: `hen_${profile.id}`, password: 'wrong-password' } });
    assert.equal(bad.status, 401);
  });
});

describe('multiplayer over sockets', () => {
  it('refuses sockets without a valid session', async () => {
    await assert.rejects(client('garbage'), /unauthorized/);
  });

  it('puts quick-play players in the same room and keeps prediction in sync with command and idle ticks', async t => {
    const [ga, gb] = [await guest(), await guest()];
    const a = await client(ga.token);
    const b = await client(gb.token);
    const snaps: WorldSnapshot[] = [];
    a.on('snapshot', (s) => snaps.push(s));
    const joinedNames: string[] = [];
    // Quick Play may fill a seat with a bot while the second player's handshake is in flight.
    a.on('playerJoined', (p) => { if (!p.bot) joinedNames.push(p.name); });

    const ra = (await a.emitWithAck('quickPlay', { mode: 'duel' })) as JoinSuccess;
    assert.ok(ra.ok);
    const rb = (await b.emitWithAck('quickPlay', { mode: 'duel' })) as JoinSuccess;
    assert.ok(rb.ok);
    assert.equal(rb.room.id, ra.room.id);
    assert.equal(rb.players.length, 2);
    await sleep(100);
    assert.deepEqual(joinedNames, [gb.profile.name]);

    const listed = await a.emitWithAck('listRooms');
    assert.ok(listed.some((r) => r.id === ra.room.id && r.players === 2));

    // Walk forward for one second and compare with local prediction.
    const me = unpackPlayer(ra.snapshot.p.find((p) => p[0] === ra.selfPid)!);
    const world = createCollisionWorld(MAPS[ra.room.map]);
    const predicted = { ...me };
    // Account for authoritative idle ticks between packets, rather than assuming packet arrival is a physics step.
    const room=server.rooms.roomOf(a.id!)!,player=room.playerFor(a.id!)!;
    const timing=room as unknown as {fixedUpdate(now:number):void},original=timing.fixedUpdate;
    const inputs=new Map<number,InputFrame>(),samples=new Map<number,MoveState>();
    let previousAck=player.lastSeq,last:InputFrame={seq:0,forward:0,right:0,jump:false,yaw:me.yaw,pitch:0};
    timing.fixedUpdate=function(now:number){
      original.call(room,now);
      if(player.lastSeq!==previousAck){last=inputs.get(player.lastSeq)!;previousAck=player.lastSeq;stepPlayer(predicted,last,SIM_DT,world);}
      else stepPlayer(predicted,{...last,forward:0,right:0,jump:predicted.jumpHeld},SIM_DT,world);
      samples.set(now,{...predicted});
    };
    t.after(()=>{timing.fixedUpdate=original;});
    for (let seq = 1; seq <= 60; seq++) {
      const frame: InputFrame = { seq, forward: 1, right: 0.3, jump: seq % 25 === 0, yaw: me.yaw, pitch: 0 };
      inputs.set(seq,frame);
      a.emit('input', frame);
      await sleep(1000 / 60);
    }
    await sleep(250);
    const latest = unpackPlayer(snaps.at(-1)!.p.find((p) => p[0] === ra.selfPid)!);
    assert.equal(latest.ack, 60);
    const expected=samples.get(latest.simulationTime!)!;assert.ok(expected,'snapshot retains its authoritative simulation time');
    const err = Math.hypot(latest.x - expected.x, latest.y - expected.y, latest.z - expected.z);
    assert.ok(err < 0.01, `prediction error ${err}`);

    const heard: ChatMessage[] = [];
    b.on('chat', (m) => heard.push(m));
    a.emit('chat', '  hello <b>chickens</b>  ');
    await sleep(100);
    assert.ok(heard.some((m) => m.pid === ra.selfPid && m.text === 'hello <b>chickens</b>'), 'chat is relayed as plain text');

    const left: number[] = [];
    a.on('playerLeft', (pid) => left.push(pid));
    b.emit('leaveRoom');
    await sleep(100);
    assert.deepEqual(left, [rb.selfPid]);
  });

  it('lets friends join a private room by code', async () => {
    const [gh, gf] = [await guest(), await guest()];
    const host = await client(gh.token);
    const friend = await client(gf.token);
    const created = (await host.emitWithAck('createRoom', { mode: 'tdm', map: 'town', private: true })) as JoinSuccess;
    assert.ok(created.ok && created.room.private);
    assert.equal((await friend.emitWithAck('listRooms')).some((r) => r.id === created.room.id), false, 'private rooms are not listed');
    const joined = (await friend.emitWithAck('joinRoom', { code: created.room.code.toLowerCase() })) as JoinSuccess;
    assert.ok(joined.ok);
    assert.equal(joined.room.id, created.room.id);
    assert.notEqual(joined.players[0]!.team, joined.players[1]!.team, 'teams are balanced');
    const missing = await friend.emitWithAck('joinRoom', { code: 'ZZZZZ' });
    assert.equal(missing.ok, false);
    const badCombo = await friend.emitWithAck('createRoom', { mode: 'tdm', map: 'flat', private: false });
    assert.equal(badCombo.ok, false);
  });
});
