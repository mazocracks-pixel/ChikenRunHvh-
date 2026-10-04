import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';
import {
  MAPS,
  MAP_IDS,
  MAX_LEVEL,
  RANKS,
  XP,
  createCollisionWorld,
  eyeHeightOf,
  isSpaceFree,
  levelFor,
  makeRay,
  matchXp,
  openSpots,
  rankProgress,
  raycastWorld,
  type PlayerInfo,
} from '@game/shared';
import { GameDatabase } from '../src/db/Database';
import type { GameRoom } from '../src/rooms/GameRoom';
import { createRoom } from '../src/rooms/modes';
import type { ServerPlayer } from '../src/rooms/ServerPlayer';
import { addPlayer, fakeIo, place } from './helpers';

let current: GameRoom | null = null;
afterEach(() => current?.close());

describe('ranks', () => {
  it('go from level 1 to level 10', () => {
    assert.equal(MAX_LEVEL, 10);
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(RANKS[1]!.xp - 1), 1);
    assert.equal(levelFor(RANKS[1]!.xp), 2);
    assert.equal(levelFor(1e9), 10, 'never past 10');
    assert.equal(rankProgress(1e9).next, null);
    assert.equal(rankProgress(RANKS[1]!.xp + (RANKS[2]!.xp - RANKS[1]!.xp) / 2).progress, 0.5);
  });

  it('a match gives XP per match, per kill and for a win, up to a cap', () => {
    assert.equal(matchXp(0, false), XP.perMatch);
    assert.equal(matchXp(3, true), XP.perMatch + 3 * XP.perKill + XP.win);
    assert.equal(matchXp(1000, true), XP.maxPerMatch);
  });
});

describe('saved progress', () => {
  it('records XP and per-mode stats, and fills the leaderboard for each mode', () => {
    const db = new GameDatabase(':memory:');
    const hen = db.createUser('Hen', 0);
    const rooster = db.createUser('Rooster', 0);
    const totals = db.recordMatch(
      [
        { userId: hen, kills: 5, deaths: 2, won: true, coins: 10, xp: matchXp(5, true) },
        { userId: rooster, kills: 9, deaths: 1, won: false, coins: 10, xp: matchXp(9, false) },
      ],
      'arms',
    );
    assert.deepEqual(totals.get(hen), { coins: 10, xp: matchXp(5, true) });
    db.recordMatch([{ userId: rooster, kills: 2, deaths: 4, won: true, coins: 0, xp: 100 }], 'ffa');
    assert.equal(db.profile(rooster)!.xp, matchXp(9, false) + 100);

    const arms = db.leaderboard(20, 'arms');
    assert.deepEqual(arms.map((r) => r.name), ['Hen', 'Rooster'], 'wins first');
    assert.equal(arms[1]!.kills, 9, 'only the Arms Race kills');
    assert.deepEqual(db.leaderboard(20, 'ffa').map((r) => r.name), ['Rooster']);
    assert.deepEqual(db.leaderboard(20, 'duel'), []);
    const all = db.leaderboard(20);
    assert.equal(all[0]!.name, 'Rooster', 'overall: by XP');
    assert.equal(all[0]!.kills, 11);
    assert.equal(all[0]!.level, levelFor(matchXp(9, false) + 100));
    db.close();
  });

  it('accounts from before ranks get XP for the matches they already played', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ranks-'));
    const path = join(dir, 'game.db');
    try {
      let db = new GameDatabase(path);
      const id = db.createUser('Veteran', 0);
      db.close();
      // Roll the file back to the schema before ranks, with some old stats.
      const raw = new DatabaseSync(path);
      raw.exec(`DROP INDEX users_xp; DROP INDEX mode_stats_board; DROP TABLE mode_stats; ALTER TABLE users DROP COLUMN xp;
        UPDATE users SET kills = 40, wins = 3, matches = 10; PRAGMA user_version = 3;`);
      raw.close();
      db = new GameDatabase(path);
      assert.equal(db.profile(id)!.xp, 10 * 25 + 40 * 10 + 3 * 60);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ranks in a room', () => {
  it('players and bots carry a rank, and a rank-up at the end of a match is announced', () => {
    const { io, events } = fakeIo();
    const room = createRoom(io, { id: 'r', code: 'RANK1', name: 'Ranks', mode: 'ffa', map: 'farm', private: true }, {
      onMatchEnd: (_room, results) => new Map(results.map((r) => [r.userId, { coins: 100, xp: 5000 }])),
    });
    current = room;
    const a = addPlayer(room, 'Alice', 1);
    const b = addPlayer(room, 'Bob', 2);
    assert.equal(a.info.rank, 1);
    room.startNow();
    for (const p of [a, b]) p.shieldUntil = 0;
    a.info.kills = room.mode.scoreLimit - 1;
    room.damage(b, a, 500, false, 'rifle', { x: 0, y: 0, z: 0 }, performance.now());
    assert.equal(room.phase, 'ended');
    assert.equal(a.info.rank, levelFor(5000));
    const updates = events.filter((e) => e.event === 'playerUpdated').map((e) => e.args[0] as PlayerInfo);
    assert.ok(updates.some((u) => u.pid === a.pid && u.rank === levelFor(5000)), 'everyone hears about it');
  });
});

describe('spread spawns', () => {
  const sees = (room: GameRoom, viewer: ServerPlayer, x: number, z: number) => {
    const eye = { x: viewer.state.x, y: viewer.state.y + eyeHeightOf(viewer.state), z: viewer.state.z };
    const d = { x: x - eye.x, y: 0.9 - eye.y, z: z - eye.z };
    const len = Math.hypot(d.x, d.y, d.z);
    return !raycastWorld(makeRay(eye, { x: d.x / len, y: d.y / len, z: d.z / len }), room.world, len);
  };

  for (const map of ['factory', 'harbor', 'farm'] as const) {
    it(`Arms Race on ${MAPS[map].name}: away from enemies and out of their sight, with longer protection`, () => {
      const { io } = fakeIo();
      const room = createRoom(io, { id: 's', code: 'SPRD1', name: 'Spread', mode: 'arms', map, private: true }, {});
      current = room;
      const a = addPlayer(room, 'Alice');
      const b = addPlayer(room, 'Bob');
      room.startNow();
      const spots = new Set<string>();
      for (const [x, z] of [[0, 0], [-15, 10], [12, -14]] as const) {
        place(b, x, z);
        for (let i = 0; i < 8; i++) {
          const now = performance.now();
          room.respawnPlayer(a, now);
          spots.add(`${a.state.x},${a.state.z}`);
          assert.ok(Math.hypot(a.state.x - b.state.x, a.state.z - b.state.z) > 12, `spawned ${a.state.x},${a.state.z} next to the enemy at ${x},${z}`);
          assert.ok(!sees(room, b, a.state.x, a.state.z), `the enemy at ${x},${z} can see the spawn ${a.state.x},${a.state.z}`);
          assert.ok(a.shieldUntil - now >= 2400, 'spawn protection');
        }
      }
      assert.ok(spots.size >= 4, `not always the same spot (${spots.size})`);
    });
  }

  it('open spots cover each map and are all clear ground', () => {
    for (const id of MAP_IDS) {
      const map = MAPS[id];
      const world = createCollisionWorld(map);
      const spots = openSpots(map.spawns, world, map.halfSize);
      assert.ok(spots.length >= 25, `${id}: only ${spots.length} spots`);
      for (const s of spots) assert.ok(isSpaceFree(s.x, 0, s.z, world), `${id}: ${s.x},${s.z} is blocked`);
      const xs = spots.map((s) => s.x);
      const zs = spots.map((s) => s.z);
      assert.ok(Math.max(...xs) - Math.min(...xs) > map.halfSize, `${id}: spread east-west`);
      assert.ok(Math.max(...zs) - Math.min(...zs) > map.halfSize, `${id}: spread north-south`);
    }
  });
});
