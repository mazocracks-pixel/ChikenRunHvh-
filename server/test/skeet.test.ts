import assert from 'node:assert/strict';
import { it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { DEFAULT_MODS, defaultHvhLoadout, defaultSkeetAntiAim, hvhPose, type ClientToServerEvents, type JoinResponse, type ServerToClientEvents, type ShotEvent } from '@game/shared';
import { startGameServer } from '../src/app';
import { addPlayer, makeRoom } from './helpers';
it('Skeet is accepted by the shared access gate and Manual clears its pose without refilling resources', async t => {
  const server = await startGameServer({ port: 0, dbPath: ':memory:', publicHvhPanel: true, guestsPerHour: 1000 }); t.after(() => server.close());
  const base = `http://localhost:${server.port}`;
  const auth = await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'x-session-transport': 'token' } });
  const { token } = await auth.json() as { token: string };
  const c: Socket<ServerToClientEvents, ClientToServerEvents> = connect(base, { transports: ['websocket'], auth: { token }, reconnection: false }); t.after(() => c.disconnect());
  await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); });
  const joined: JoinResponse = await c.timeout(3000).emitWithAck('createRoom', { mode: 'hvh', map: 'farm', private: true, bots: 0 }); assert.ok(joined.ok); if (!joined.ok) return;
  const room = server.rooms.roomOf(c.id!)!, p = room.playerFor(c.id!)!;
  assert.equal(p.hvhPreparing, true); assert.equal(p.alive, false);
  const policy = defaultHvhLoadout(); policy.antiAim.enabled = true; policy.skeet = defaultSkeetAntiAim(); policy.skeet.states.standing.desync = 999;
  const configured = await c.timeout(3000).emitWithAck('devHvh', policy);
  assert.equal(configured.hvh?.skeet?.states.standing.desync, 58); assert.deepEqual(configured.mods, DEFAULT_MODS);
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady', 'skeet')).ok, true); assert.equal(p.hvhPanel, 'skeet'); assert.equal(p.hvhPreparing, false);
  p.hp = 40; p.mags.set(p.weapon, 5); const charge = p.exploit.readyAt;
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady', 'skeet')).ok, true);
  assert.equal(p.hp, 40); assert.equal(p.mag, 5); assert.equal(p.exploit.readyAt, charge);
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady', 'manual')).ok, true);
  assert.equal(p.hvh.skeet, undefined); assert.equal(p.fakeYaw, p.lookYaw); assert.equal(p.fakePitch, p.pitch);
  assert.equal(p.hp, 40); assert.equal(p.mag, 5); assert.equal(p.exploit.readyAt, charge);
  await c.timeout(3000).emitWithAck('createRoom', { mode: 'ffa', map: 'farm', private: true, bots: 0 });
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady', 'skeet')).ok, false);
});
it('the server derives Skeet stance from real movement and keeps visual pitch out of shot and hitbox state', t => {
  const { room } = makeRoom('hvh', 'flat'); t.after(() => room.close()); const p = addPlayer(room, 'A');
  p.hvhEnabled = true; p.hvh = defaultHvhLoadout(); p.hvh.antiAim.enabled = true; p.hvh.skeet = defaultSkeetAntiAim(); p.hvh.skeet.visualPitch = 'down';
  p.lookYaw = 0.2; p.pitch = 0.3; p.revealUntil = p.concealUntil = 0;
  for (const state of [{ onGround: true, crouching: false, horizontalSpeed: 0 }, { onGround: true, crouching: false, horizontalSpeed: 5 }, { onGround: true, crouching: true, horizontalSpeed: 5 }, { onGround: false, crouching: true, horizontalSpeed: 5 }]) {
    Object.assign(p.state, state); room.updateHvhPose(p, 1000);
    const expected = hvhPose(p.lookYaw, p.hvh, 1000, false, false, { speed: state.horizontalSpeed, ...state, seed: p.pid });
    assert.equal(p.yaw, expected.real); assert.equal(p.fakeYaw, expected.fake); assert.equal(p.pitch, 0.3); assert.equal(p.fakePitch, -0.65);
  }
  p.revealUntil = 2000; room.updateHvhPose(p, 1100); assert.equal(p.fakePitch, p.pitch); assert.equal(p.yaw, p.lookYaw);
});
it('accepted ranged shots carry their sequence and rejected shots produce no resolver feedback', t => {
  const { room, events } = makeRoom('hvh', 'flat'); t.after(() => room.close()); const p = addPlayer(room, 'A');
  const fire = (shot: number) => room.handleFire(p, { shot, weapon: p.weapon, dx: 1, dy: 0, dz: 0, t: performance.now(), aiming: false });
  fire(1); fire(2);
  const shots = events.filter(e => e.event === 'shot').map(e => e.args[0] as ShotEvent);
  assert.equal(shots.length, 1); assert.equal(shots[0]!.shot, 1); assert.equal(shots[0]!.pid, p.pid);
});
