import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { SIM_DT } from '@game/shared';
import type { CommandIntent } from '@game/shared/hvh/v2';
import type { ServerPlayer } from '../../src/rooms/ServerPlayer';
import { HvhRoom, type HvhEngine } from '../../src/rooms/HvhRoom';
import { addPlayer, fakeIo, place, stepRoom } from '../helpers';

const TICK_MS = SIM_DT * 1000;
type Sent = { event: string; data: unknown };

function fakeSocket(p: ServerPlayer, sink: Sent[]): void {
  const socket = { emit(event: string, data: unknown) { sink.push({ event, data }); }, to() { return { emit() {} }; }, leave() {}, volatile: { emit() {} } };
  Object.defineProperty(p, 'socket', { value: socket });
}

const open: HvhRoom[] = [];
after(() => { for (const r of open) r.close(); });

function setup(engine: HvhEngine, isPrivate = true) {
  const { io } = fakeIo();
  const room = new HvhRoom(io, { id: 'dbg', code: 'DBG01', name: 'Debug', mode: 'hvh', map: 'flat', private: isPrivate, hvhEngine: engine }, {});
  open.push(room);
  const dev = addPlayer(room, 'Dev');
  const normal = addPlayer(room, 'Normal');
  const target = addPlayer(room, 'Target');
  dev.info.team = 1; normal.info.team = 1; target.info.team = 2;
  room.startNow();
  place(dev, 20, 20); place(normal, 22, 20); place(target, 20, 10);
  for (const p of [dev, normal, target]) { p.shieldUntil = 0; p.hvhEnabled = true; }
  const devSent: Sent[] = [];
  const normalSent: Sent[] = [];
  fakeSocket(dev, devSent);
  fakeSocket(normal, normalSent);
  return { room, dev, normal, target, devSent, normalSent };
}

function run(room: HvhRoom, players: ServerPlayer[], ticks: number): void {
  const seqs = new Map<number, number>();
  let now = performance.now();
  for (let i = 0; i < ticks; i++) {
    now += TICK_MS;
    for (const p of players) {
      const seq = (seqs.get(p.pid) ?? 0) + 1;
      seqs.set(p.pid, seq);
      room.handleInput(p, { seq, forward: 0, right: 0, jump: false, yaw: 0, pitch: 0, intent: { fire: false, choke: false, doubleTap: false, hideShots: false, defensive: false } as CommandIntent });
    }
    stepRoom(room, now);
  }
}

const debugMessages = (sent: Sent[]) => sent.filter((s) => s.event === 'hvhDebug');

describe('hvhDebug feed', () => {
  it('an authorized dev socket in a private v2 room receives hvhDebug for each other player', () => {
    const { room, dev, normal, target, devSent } = setup('v2');
    room.setDebugViewer(dev, () => true);
    run(room, [dev, normal, target], 5);
    const msgs = debugMessages(devSent).map((m) => m.data as { playerId: number; realPose: unknown; records: unknown[]; resolver: { side: string; confidence: number } });
    assert.ok(msgs.length > 0);
    assert.deepEqual([...new Set(msgs.map((m) => m.playerId))].sort(), [normal.pid, target.pid].sort());
    const last = msgs.filter((m) => m.playerId === target.pid).at(-1)!;
    assert.ok(last.records.length > 0);
    assert.ok(last.realPose && typeof last.resolver.confidence === 'number' && ['left', 'right', 'center'].includes(last.resolver.side));
  });

  it('sends at most one message per other player per tick', () => {
    const { room, dev, normal, target, devSent } = setup('v2');
    room.setDebugViewer(dev, () => true);
    run(room, [dev, normal, target], 1);
    assert.equal(debugMessages(devSent).length, 2);
  });

  it('a normal player never receives hvhDebug', () => {
    const { room, dev, normal, target, normalSent } = setup('v2');
    room.setDebugViewer(dev, () => true);
    run(room, [dev, normal, target], 5);
    assert.equal(debugMessages(normalSent).length, 0);
  });

  it('a viewer whose authorization is revoked, or in a public room, receives nothing', () => {
    const revoked = setup('v2');
    let ok = true;
    revoked.room.setDebugViewer(revoked.dev, () => ok);
    run(revoked.room, [revoked.dev, revoked.normal, revoked.target], 2);
    const before = debugMessages(revoked.devSent).length;
    ok = false;
    run(revoked.room, [revoked.dev, revoked.normal, revoked.target], 3);
    assert.equal(debugMessages(revoked.devSent).length, before);
    const pub = setup('v2', false);
    pub.room.setDebugViewer(pub.dev, () => true);
    run(pub.room, [pub.dev, pub.normal, pub.target], 3);
    assert.equal(debugMessages(pub.devSent).length, 0);
  });

  it('the v2 feed replaces any estimate message: no hvhEstimate-style event is sent', () => {
    const { room, dev, normal, target, devSent } = setup('v2');
    room.setDebugViewer(dev, () => true);
    run(room, [dev, normal, target], 3);
    assert.ok(devSent.every((s) => s.event !== 'hvhEstimate' && s.event !== 'hvhMatrices'));
  });

  it('a legacy room sends the feed to nobody and keeps its old behaviour', () => {
    const { room, dev, devSent } = setup('legacy');
    room.setDebugViewer(dev, () => true);
    for (let i = 0; i < 3; i++) stepRoom(room, performance.now() + i * TICK_MS);
    assert.equal(debugMessages(devSent).length, 0);
    assert.ok(devSent.every((s) => s.event !== 'hvhState'));
  });

  it('building the feed leaves resolver memory unchanged (peekResolve, not resolve)', () => {
    const { room, dev, normal, target } = setup('v2');
    run(room, [dev, normal, target], 4);
    const before = structuredClone(room.v2State(dev.pid)!.resolver);
    room.setDebugViewer(dev, () => true);
    run(room, [dev, normal, target], 4);
    assert.deepEqual(room.v2State(dev.pid)!.resolver, before);
  });
});
