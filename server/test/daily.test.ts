import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dailyChallenges, dayKey, msUntilNextDay } from '@game/shared';
import { GameDatabase } from '../src/db/Database';

const T0 = Date.UTC(2026, 9, 6, 10, 0, 0); // 6 Oct 2026, 10:00 UTC
const DAY = 86_400_000;

describe('daily challenges', () => {
  it('are the same for a player all day, one of each kind, and change with the day and the player', () => {
    const a = dailyChallenges(7, '2026-10-06');
    assert.deepEqual(a, dailyChallenges(7, '2026-10-06'));
    assert.deepEqual(a.map((c) => c.id), ['kills', 'matches', 'wins']);
    assert.ok(a.every((c) => c.goal > 0 && c.reward > 0));
    const seen = new Set<string>();
    for (let day = 1; day <= 20; day++) seen.add(JSON.stringify(dailyChallenges(7, `2026-10-${String(day).padStart(2, '0')}`)));
    assert.ok(seen.size > 3, 'different days give different goals');
    assert.equal(dayKey(T0), '2026-10-06');
    assert.equal(msUntilNextDay(T0), 14 * 3600_000);
  });

  it('count every finished match, pay each challenge once, and start over the next day', () => {
    const db = new GameDatabase(':memory:');
    try {
      const me = db.createUser('Daily', 0);
      const goals = Object.fromEntries(dailyChallenges(me, dayKey(T0)).map((c) => [c.id, c])) as Record<'kills' | 'matches' | 'wins', ReturnType<typeof dailyChallenges>[number]>;
      assert.deepEqual(db.dailyStatus(me, T0).challenges.map((c) => c.progress), [0, 0, 0]);

      // A match with enough kills to finish the kills challenge (and nothing else).
      const first = db.recordMatch([{ userId: me, kills: goals.kills.goal, deaths: 0, won: false, coins: 10, xp: 0 }], 'ffa', T0);
      assert.equal(first.get(me)!.dailyCoins, goals.kills.reward, 'kills challenge paid');
      const status = db.dailyStatus(me, T0);
      assert.equal(status.challenges[0]!.done, true);
      assert.equal(status.challenges[1]!.progress, 1, 'one match played');

      // More kills do not pay the same challenge again.
      const second = db.recordMatch([{ userId: me, kills: 50, deaths: 0, won: false, coins: 10, xp: 0 }], 'ffa', T0 + 1000);
      assert.equal(second.get(me)!.dailyCoins, goals.matches.goal <= 2 ? goals.matches.reward : 0);

      // Wins and matches finish the rest; the coins land in the player's total.
      const before = db.profile(me)!.coins;
      for (let i = 0; i < 6; i++) db.recordMatch([{ userId: me, kills: 0, deaths: 0, won: true, coins: 0, xp: 0 }], 'ffa', T0 + 2000 + i);
      const done = db.dailyStatus(me, T0 + 10_000);
      assert.ok(done.challenges.every((c) => c.done), 'all three done');
      assert.ok(db.profile(me)!.coins > before);

      // Exactly the two matches' own coins plus each reward once (the account started with 0 coins).
      assert.equal(db.profile(me)!.coins, 20 + goals.kills.reward + goals.matches.reward + goals.wins.reward);

      // Tomorrow: fresh, unfinished challenges.
      const tomorrow = db.dailyStatus(me, T0 + DAY);
      assert.equal(tomorrow.day, '2026-10-07');
      assert.deepEqual(tomorrow.challenges.map((c) => c.progress), [0, 0, 0]);
    } finally {
      db.close();
    }
  });
});

describe('match history', () => {
  it('keeps the newest matches with kills, deaths and headshots, newest first', () => {
    const db = new GameDatabase(':memory:');
    try {
      const me = db.createUser('History', 0);
      const other = db.createUser('Other', 0);
      for (let i = 1; i <= 35; i++) db.recordMatch([{ userId: me, kills: i, headshots: i % 2 ? 1 : 0, deaths: 2, won: i % 3 === 0, coins: 0, xp: 0 }], i % 2 ? 'ffa' : 'tdm', T0 + i * 1000);
      db.recordMatch([{ userId: other, kills: 4, deaths: 1, won: true, coins: 0, xp: 0 }], 'duel', T0);
      const last = db.matchHistory(me, 10);
      assert.equal(last.length, 10);
      assert.deepEqual(last[0], { mode: 'ffa', kills: 35, deaths: 2, headshots: 1, won: false, at: T0 + 35_000 });
      assert.equal(last[1]!.kills, 34);
      assert.equal(last[9]!.kills, 26);
      assert.equal(db.matchHistory(me, 100).length, 30, 'only the newest 30 are kept');
      assert.equal(db.matchHistory(other, 10).length, 1, 'each player has their own');
      // Headshots can never exceed kills.
      db.recordMatch([{ userId: me, kills: 2, headshots: 9, deaths: 0, won: false, coins: 0, xp: 0 }], 'ffa', T0 + 99_000);
      assert.equal(db.matchHistory(me, 1)[0]!.headshots, 2);
    } finally {
      db.close();
    }
  });
});
