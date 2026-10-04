import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BOMB, DEFAULT_APPEARANCE, RANKED, SIM_DT, rankedPoints } from '@game/shared';
import { GameDatabase } from '../src/db/Database';
import type { BombRoom } from '../src/rooms/BombRoom';
import type { MatchResult, RoomHooks } from '../src/rooms/GameRoom';
import { createRoom } from '../src/rooms/modes';
import { RoomManager } from '../src/rooms/RoomManager';
import type { ServerPlayer } from '../src/rooms/ServerPlayer';
import type { GameSocket } from '../src/types';
import { fakeIo } from './helpers';

let current: BombRoom | null = null;
afterEach(() => current?.close());

/** A room with a stopped clock (see bomb.test.ts); players join with accounts and a chosen knife. */
function setup(mode: 'face' | 'bomb', players: number, hooks: RoomHooks = {}, fillBots = false) {
  const { io, events } = fakeIo();
  const room = createRoom(io, { id: 'f', code: 'FACE1', name: 'Face', mode, map: 'sandstown', private: false, fillBots }, hooks) as BombRoom;
  current = room;
  clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
  const all: ServerPlayer[] = [];
  for (let i = 0; i < players; i++) {
    const res = room.join(null, { userId: i + 1, name: `P${i}`, appearance: { ...DEFAULT_APPEARANCE }, loadout: ['rifle', 'karambit'] });
    if (!res.ok) throw new Error(res.error);
    const p = room.players.get(res.selfPid)!;
    p.shieldUntil = 0;
    all.push(p);
  }
  let now = performance.now();
  const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
  const step = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + SIM_DT * 1000);
      update(now);
    }
  };
  room.startNow();
  return { room, events, all, t: all.filter((p) => p.info.team === 1), ct: all.filter((p) => p.info.team === 2), step };
}

const killAll = (room: BombRoom, victims: ServerPlayer[], by: ServerPlayer) => {
  for (const v of victims) {
    v.shieldUntil = 0;
    room.damage(v, by, 1000, false, by.weapon, { x: 0, y: 0, z: 0 }, performance.now());
  }
};

describe('FaceChiken (ranked)', () => {
  it('never fills up with bots', () => {
    const s = setup('face', 2, {}, true);
    s.step(3000);
    assert.equal([...s.room.players.values()].filter((p) => p.info.bot).length, 0);
    // The same room as plain ChikenBomb does get bots.
    s.room.close();
    const plain = setup('bomb', 2, {}, true);
    plain.step(3000);
    assert.ok([...plain.room.players.values()].some((p) => p.info.bot));
  });

  it('a win and a loss move rank points, kills soften it', () => {
    let saved: MatchResult[] = [];
    const s = setup('face', 4, {
      onMatchEnd: (_room, results) => {
        saved = results;
        return new Map(results.map((r) => [r.userId, { coins: 0, xp: 0, levelCoins: 0 }]));
      },
    });
    s.step(BOMB.warmupMs + 50);
    for (let r = 0; r < s.room.mode.scoreLimit && saved.length === 0; r++) {
      for (let i = 0; i < 400 && s.room.roundState.phase !== 'live'; i++) s.step(100);
      s.t[0]!.info.kills = 3;
      killAll(s.room, s.ct, s.t[0]!);
      s.step(50);
    }
    assert.equal(saved.length, 4, 'the match ended and everyone was saved');
    const winner = saved.find((r) => r.pid === s.t[0]!.pid)!;
    assert.equal(winner.xp, rankedPoints(winner.kills, true));
    for (const ct of s.ct) assert.equal(saved.find((r) => r.pid === ct.pid)!.xp, rankedPoints(0, false));
  });

  it('leaving a match that is underway counts as a loss (not during warmup)', () => {
    const saved: MatchResult[] = [];
    const s = setup('face', 5, {
      onMatchEnd: (_room, results) => {
        saved.push(...results);
        return new Map();
      },
    });
    s.room.removePlayer(s.all[0]!);
    assert.equal(saved.length, 0, 'warmup: free to go');
    s.step(BOMB.warmupMs + 50);
    s.room.removePlayer(s.all[1]!);
    assert.deepEqual(saved.map((r) => [r.userId, r.won, r.xp]), [[s.all[1]!.userId, false, RANKED.leave]]);
  });

  it('your own knife skin comes along; pistols take the pistol slot, other guns the main slot', () => {
    const s = setup('bomb', 2);
    const p = s.all[0]!;
    assert.deepEqual(p.info.loadout, ['pistol', 'karambit']);
    assert.equal(s.room.handleBuy(p, 'deagle').ok, true, 'warmup: free');
    assert.deepEqual(p.info.loadout, ['deagle', 'karambit']);
    assert.equal(s.room.handleBuy(p, 'smg').ok, true);
    assert.deepEqual(p.info.loadout, ['smg', 'deagle', 'karambit']);
    assert.equal(p.weapon, 'smg', 'holding what you bought');
    assert.equal(s.room.handleBuy(p, 'fiveseven').ok, true);
    assert.deepEqual(p.info.loadout, ['smg', 'fiveseven', 'karambit'], 'the new pistol replaced the Deagle');
    assert.equal(s.room.handleBuy(p, 'scout').ok, true);
    assert.deepEqual(p.info.loadout, ['scout', 'fiveseven', 'karambit'], 'and a new main gun the SMG');
  });
});

describe('FaceChiken matchmaking', () => {
  const socket = (id: string, userId: number): GameSocket =>
    ({ id, data: { userId }, join: () => undefined, leave: () => undefined, emit: () => true, to: () => ({ emit: () => true }) }) as unknown as GameSocket;

  it('is for registered accounts only', () => {
    const db = new GameDatabase(':memory:');
    const { io } = fakeIo();
    const rooms = new RoomManager(io, db);
    const guest = db.createUser('Guest', 0);
    const member = db.createUser('Member', 0);
    db.setCredentials(member, 'member', 'hash');
    const res = rooms.join(socket('g', guest), rooms.quickPlay('face'));
    assert.equal(res.ok, false);
    assert.match(res.ok ? '' : res.error, /registered/);
    const ok = rooms.join(socket('m', member), rooms.quickPlay('face'));
    assert.equal(ok.ok, true);
    rooms.leave(socket('m', member));
    db.close();
  });
});
