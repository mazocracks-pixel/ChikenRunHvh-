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
  RANKED,
  RANKS,
  createCollisionWorld,
  eyeHeightOf,
  isSpaceFree,
  levelFor,
  makeRay,
  applyRankPoints,
  openSpots,
  rankProgress,
  rankedPoints,
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
  it('go from level 1 to level 10, and the top is a long way up', () => {
    assert.equal(MAX_LEVEL, 10);
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(RANKS[1]!.xp - 1), 1);
    assert.equal(levelFor(RANKS[1]!.xp), 2);
    assert.equal(levelFor(1e9), 10, 'never past 10');
    assert.equal(rankProgress(1e9).next, null);
    assert.equal(rankProgress(RANKS[1]!.xp + (RANKS[2]!.xp - RANKS[1]!.xp) / 2).progress, 0.5);
    // Winning 55% of games with 5 kills a game: well over 150 matches to the top.
    const perMatch = 0.55 * rankedPoints(5, true) + 0.45 * rankedPoints(5, false);
    assert.ok(RANKS[9]!.xp / perMatch > 150, `${Math.round(RANKS[9]!.xp / perMatch)} matches`);
  });

  it('ranked points: a win gives, a loss takes, kills soften it', () => {
    assert.equal(rankedPoints(0, true), RANKED.win);
    assert.equal(rankedPoints(0, false), RANKED.loss);
    assert.equal(rankedPoints(4, false), RANKED.loss + 4);
    assert.equal(rankedPoints(1000, true), RANKED.win + RANKED.killBonusMax);
  });

  it('you never drop below the level you reached', () => {
    assert.equal(applyRankPoints(0, -20), 0);
    assert.equal(applyRankPoints(RANKS[3]!.xp + 10, -50), RANKS[3]!.xp);
    assert.equal(applyRankPoints(RANKS[3]!.xp + 10, 30), RANKS[3]!.xp + 40);
  });
});

describe('saved progress', () => {
  it('records rank points and per-mode stats, pays coins per new level, and fills each mode leaderboard', () => {
    const db = new GameDatabase(':memory:');
    const hen = db.createUser('Hen', 0);
    const rooster = db.createUser('Rooster', 0);
    // Hen is just short of level 2.
    db.recordMatch([{ userId: hen, kills: 0, deaths: 0, won: true, coins: 0, xp: RANKS[1]!.xp - 10 }], 'face');
    const totals = db.recordMatch(
      [
        { userId: hen, kills: 5, deaths: 2, won: true, coins: 10, xp: rankedPoints(5, true) },
        { userId: rooster, kills: 9, deaths: 1, won: false, coins: 10, xp: rankedPoints(9, false) },
      ],
      'face',
    );
    const henXp = RANKS[1]!.xp - 10 + rankedPoints(5, true);
    assert.deepEqual(totals.get(hen), { coins: 10 + RANKED.levelCoins, xp: henXp, levelCoins: RANKED.levelCoins }, 'level 2: +250 coins');
    assert.deepEqual(totals.get(rooster), { coins: 10, xp: 0, levelCoins: 0 }, 'a loss at level 1 stays at 0');
    // Other modes don't touch rank points.
    db.recordMatch([{ userId: rooster, kills: 2, deaths: 4, won: true, coins: 0, xp: 0 }], 'ffa');
    db.recordMatch([{ userId: rooster, kills: 2, deaths: 4, won: true, coins: 0, xp: 0 }], 'ffa');
    assert.equal(db.profile(rooster)!.xp, 0);

    assert.deepEqual(db.leaderboard(20, 'face').map((r) => r.name), ['Hen', 'Rooster'], 'FaceChiken: by rank points');
    assert.equal(db.leaderboard(20, 'face')[0]!.level, 2);
    assert.deepEqual(db.leaderboard(20, 'ffa').map((r) => r.name), ['Rooster']);
    assert.deepEqual(db.leaderboard(20, 'duel'), []);
    const all = db.leaderboard(20);
    assert.equal(all[0]!.name, 'Rooster', 'overall: by wins');
    assert.equal(all[0]!.kills, 13);
    db.close();
  });

  it('everyone starts again at level 1 now that ranks only move in FaceChiken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ranks-'));
    const path = join(dir, 'game.db');
    try {
      let db = new GameDatabase(path);
      const id = db.createUser('Veteran', 0);
      db.close();
      const raw = new DatabaseSync(path);
      // Back to schema v4 (before the reset, the anti-cheat and friends tables), with some XP.
      raw.exec('DROP INDEX reports_target; DROP TABLE reports; DROP INDEX friends_incoming; DROP TABLE friends; DROP INDEX ac_strikes_user; DROP TABLE ac_strikes; UPDATE users SET xp = 900; PRAGMA user_version = 4;');
      raw.close();
      db = new GameDatabase(path);
      assert.equal(db.profile(id)!.xp, 0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ranks in a room', () => {
  it('players carry their rank, and other modes give no rank points', () => {
    const { io, events } = fakeIo();
    let sent: number[] = [];
    const room = createRoom(io, { id: 'r', code: 'RANK1', name: 'Ranks', mode: 'ffa', map: 'farm', private: true }, {
      onMatchEnd: (_room, results) => {
        sent = results.map((r) => r.xp);
        return new Map(results.map((r) => [r.userId, { coins: 100, xp: 1000, levelCoins: 0 }]));
      },
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
    assert.deepEqual(sent, [0, 0], 'no rank points outside FaceChiken');
    assert.equal(a.info.rank, levelFor(1000), 'the badge follows the saved total');
    const updates = events.filter((e) => e.event === 'playerUpdated').map((e) => e.args[0] as PlayerInfo);
    assert.ok(updates.some((u) => u.pid === a.pid && u.rank === levelFor(1000)), 'everyone hears about it');
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
