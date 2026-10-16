import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BOMB, MAPS, PLAYER, PROJECTILES, SIM_DT, SMOKE_DURATION_MS, createCollisionWorld, predictThrow, type ProjectileSpawn } from '@game/shared';
import type { BombRoom } from '../src/rooms/BombRoom';
import type { GameRoom } from '../src/rooms/GameRoom';
import { createRoom } from '../src/rooms/modes';
import type { ServerPlayer } from '../src/rooms/ServerPlayer';
import { addPlayer, fakeIo, makeRoom, place, type RecordedEvent } from './helpers';

let current: GameRoom | null = null;
afterEach(() => current?.close());

const named = (events: RecordedEvent[], name: string) => events.filter((e) => e.event === name).map((e) => e.args[0] as Record<string, unknown>);
let seq = 0;
const toss = (room: GameRoom, p: ServerPlayer, kind: 'egg' | 'smoke' | 'flash', power: 0 | 0.5 | 1 = 1, dir = { dx: 0, dy: 0.1, dz: -1 }) => {
  p.nextThrowAt = 0;
  room.handleThrow(p, { kind, seq: ++seq, ...dir, power });
};
/** Runs the projectiles (only) until `done`, 60 times a second; returns the ms it took. */
function fly(room: GameRoom, done: () => boolean, maxMs = 10_000): number {
  const start = performance.now();
  for (let t = 0; t <= maxMs; t += SIM_DT * 1000) {
    room.projectiles.update(start + t);
    if (done()) return t;
  }
  return Infinity;
}

function ffa(map: 'farm' | 'flat' = 'farm') {
  const made = makeRoom('ffa', map);
  current = made.room;
  const a = addPlayer(made.room, 'Alice');
  const b = addPlayer(made.room, 'Bob');
  made.room.startNow();
  // The clear lane on the farm, looking down -Z.
  place(a, 20, -5);
  place(b, 60, 60);
  a.yaw = 0;
  a.shieldUntil = b.shieldUntil = 0;
  return { ...made, a, b };
}

describe('grenade rules', () => {
  it('carry limits: 1 HE egg, 1 smoke, 2 flashbangs', () => {
    assert.deepEqual([PLAYER.maxEggs, PLAYER.maxSmokes, PLAYER.maxFlashes], [1, 1, 2]);
  });

  it('each throw (far, medium, soft) flies as the server works it out, landing further for harder throws', () => {
    const { room, events, a } = ffa('flat');
    const ends: number[] = [];
    for (const power of [1, 0.5, 0] as const) {
      a.flashes = 2;
      const before = named(events, 'explode').length;
      toss(room, a, 'flash', power);
      fly(room, () => named(events, 'explode').length > before);
      ends.push(-(named(events, 'explode').at(-1)!.z as number));
    }
    assert.ok(ends[0]! > ends[1]! && ends[1]! > ends[2]!, `far ${ends[0]} > medium ${ends[1]} > soft ${ends[2]}`);
  });

  it('everyone gets the same throw: replaying the broadcast launch lands where the server set it off', () => {
    const { room, events, a } = ffa();
    a.state.walkVx = 3; // running sideways while throwing
    toss(room, a, 'egg', 0.5);
    const spawn = named(events, 'projectile').at(-1) as unknown as ProjectileSpawn;
    assert.equal(spawn.kind, 'he');
    fly(room, () => named(events, 'explode').length > 0);
    const boom = named(events, 'explode')[0]!;
    const client = predictThrow(PROJECTILES.he, spawn, { x: spawn.vx, y: spawn.vy, z: spawn.vz }, createCollisionWorld(MAPS.farm)).end;
    for (const k of ['x', 'y', 'z'] as const) assert.ok(Math.abs(client[k] - (boom[k] as number)) < 0.02, `${k}: ${client[k]} vs ${boom[k]}`);
  });

  it('smoke lasts 15 seconds; the flash goes off 1.5 s after the throw', () => {
    const { room, events, a } = ffa();
    toss(room, a, 'flash');
    const ms = fly(room, () => named(events, 'explode').length > 0);
    assert.ok(Math.abs(ms - 1500) <= 17, `flash after ${ms} ms`);
    toss(room, a, 'smoke', 0);
    fly(room, () => named(events, 'smoke').length > 0);
    const smoke = named(events, 'smoke')[0]!;
    assert.equal(SMOKE_DURATION_MS, 15_000);
    assert.ok((smoke.until as number) - performance.now() > 14_000, 'hangs about 15 s');
  });

  it('the server checks the throw: bad power is ignored, and you need the grenade', () => {
    const { room, events, a } = ffa();
    room.handleThrow(a, { kind: 'egg', seq: ++seq, dx: 0, dy: 0, dz: -1, power: 2 as 1 });
    assert.equal(named(events, 'projectile').length, 0, 'made-up power: nothing thrown');
    a.eggs = 0;
    toss(room, a, 'egg');
    assert.equal(named(events, 'projectile').length, 0, 'no egg: nothing thrown');
    room.handlePin(a, 'egg');
    assert.equal(a.pinned, null, 'and no pin to pull');
  });

  it('dying with the pin pulled drops the grenade at your feet, and an HE egg still goes off', () => {
    const { room, events, a, b } = ffa();
    room.handlePin(a, 'egg');
    assert.equal(a.pinned, 'egg');
    place(b, 21.5, -5);
    room.damage(a, b, 1000, false, 'pistol', { x: 0, y: 0, z: 0 }, performance.now());
    const dropped = named(events, 'projectile').at(-1)!;
    assert.equal(dropped.kind, 'he');
    assert.ok(Math.hypot((dropped.x as number) - 20, (dropped.z as number) + 5) < 0.01, 'at the feet');
    assert.equal(a.eggs, 0, 'used up');
    const hp = b.hp;
    const ms = fly(room, () => named(events, 'explode').length > 0);
    assert.ok(ms >= 1500 && ms < 1800, `went off ${ms} ms later`);
    assert.ok(b.hp < hp, 'and hurt whoever stood next to it');
  });

  it('putting the pin back (or no pin) means nothing drops', () => {
    const { room, events, a, b } = ffa();
    room.handlePin(a, 'smoke');
    room.handlePin(a, null);
    room.damage(a, b, 1000, false, 'pistol', { x: 0, y: 0, z: 0 }, performance.now());
    assert.equal(named(events, 'projectile').length, 0);
  });

  it('Training: grenades never run out', () => {
    const { io, events } = fakeIo();
    const room = createRoom(io, { id: 't', code: 'TRN9', name: 'Training', mode: 'training', map: 'flat', private: true }, {}) as GameRoom;
    current = room;
    clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
    const p = addPlayer(room, 'Me');
    room.startNow();
    for (let i = 0; i < 5; i++) toss(room, p, 'egg');
    assert.equal(named(events, 'projectile').filter((e) => e.kind === 'he').length, 5);
    assert.equal(p.eggs, PLAYER.maxEggs, 'still a full stack');
  });
});

describe('ChikenBomb grenades', () => {
  function bomb() {
    const { io } = fakeIo();
    const room = createRoom(io, { id: 'b', code: 'BOMB9', name: 'Bomb', mode: 'bomb', map: 'sandstown', private: true }, {}) as BombRoom;
    current = room;
    clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
    const all = [addPlayer(room, 'T'), addPlayer(room, 'CT')];
    let now = performance.now();
    const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
    const step = (ms: number) => {
      const end = now + ms;
      while (now < end) update((now = Math.min(end, now + SIM_DT * 1000)));
    };
    room.startNow();
    step(BOMB.warmupMs + 50);
    return { room, t: all.find((p) => p.info.team === 1)!, step, get now() { return now; } };
  }

  it('cost money, stop at the carry limit, and stay with you into the next round', () => {
    const s = bomb();
    const t = s.t;
    t.money = 10_000;
    assert.equal(t.eggs + t.smokes + t.flashes, 0, 'no free grenades');
    assert.equal(s.room.handleBuy(t, 'eggs', s.now).ok, true);
    assert.equal(s.room.handleBuy(t, 'eggs', s.now).error, 'You can’t carry more eggs.');
    assert.equal(s.room.handleBuy(t, 'smoke', s.now).ok, true);
    assert.equal(s.room.handleBuy(t, 'smoke', s.now).ok, false);
    assert.equal(s.room.handleBuy(t, 'flash', s.now).ok, true);
    assert.equal(s.room.handleBuy(t, 'flash', s.now).ok, true);
    assert.equal(s.room.handleBuy(t, 'flash', s.now).ok, false, 'two flashbangs at most');
    assert.ok(t.money < 10_000, 'paid for');
    // Win the round alive: unused grenades come along.
    const r = s.room.roundState;
    s.step(r.endsAt! - s.now + BOMB.roundMs + BOMB.roundEndMs + 500);
    assert.ok(s.room.roundState.round >= 2, 'next round');
    assert.ok(t.alive, 'survived the round');
    assert.deepEqual([t.eggs, t.smokes, t.flashes], [1, 1, 2]);
  });
});
