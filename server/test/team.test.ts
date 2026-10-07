import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOMB, MODES, SIM_DT, type ModeId } from '@game/shared';
import type { BombRoom } from '../src/rooms/BombRoom';
import type { GameRoom } from '../src/rooms/GameRoom';
import { createRoom } from '../src/rooms/modes';
import { addPlayer, fakeIo, makeRoom } from './helpers';

/** A room on the mode's first map, always closed afterwards (an open room's timer keeps the test run alive). */
function withRoom(mode: ModeId, run: (room: GameRoom, events: ReturnType<typeof makeRoom>['events']) => void): void {
  const { room, events } = makeRoom(mode, MODES[mode].maps[0]);
  try {
    run(room, events);
  } finally {
    room.close();
  }
}

describe('switching team (M)', () => {
  it('moves you to the other team, costs the life without counting a death, then has a cooldown', () => {
    withRoom('tdm', (room, events) => {
      const a = addPlayer(room, 'A');
      addPlayer(room, 'B');
      room.startNow();
      const from = a.info.team;
      const now = performance.now();
      assert.equal(room.switchTeam(a, now), null);
      assert.notEqual(a.info.team, from);
      assert.equal(a.alive, false, 'switching while alive costs that life');
      assert.equal(a.info.deaths, 0, 'not counted as a death');
      assert.equal(a.info.score, 0, 'no suicide penalty');
      const updated = events.filter((e) => e.event === 'playerUpdated').map((e) => e.args[0] as { pid: number; team: number });
      assert.ok(updated.some((u) => u.pid === a.pid && u.team === a.info.team), 'everyone hears the new team');
      assert.ok(events.some((e) => e.event === 'chat' && /A joined (Red|Blue)/.test((e.args[0] as { text: string }).text)));
      assert.match(room.switchTeam(a, now + 1000) ?? '', /Wait/, 'a cooldown stops hopping back and forth');
    });
  });

  it('keeps teams within two real players of each other', () => {
    withRoom('tdm', (room) => {
      const players = [0, 1, 2, 3].map((i) => addPlayer(room, `P${i}`));
      const red = players.filter((p) => p.info.team === 1);
      assert.equal(red.length, 2);
      const now = performance.now();
      // 2 v 2 → 1 v 3 is fine; then another from the smaller side (0 v 4) is not.
      assert.equal(room.switchTeam(red[0]!, now), null);
      assert.match(room.switchTeam(red[1]!, now) ?? '', /more players/);
    });
  });

  it('bots keep the teams even: a full team gives up a seat, a half-full room rebalances', () => {
    for (const [bots, even] of [[9, [5, 5]], [3, [2, 2]]] as const) {
      const { io } = fakeIo();
      const room = createRoom(io, { id: 't', code: 'TDM2', name: 'Team', mode: 'tdm', map: MODES.tdm.maps[0]!, private: true, bots }, {});
      try {
        clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
        const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
        const a = addPlayer(room, 'A');
        let now = performance.now();
        update(now);
        const sizes = () => [1, 2].map((t) => [...room.players.values()].filter((p) => p.info.team === t).length);
        assert.deepEqual(sizes(), even);
        assert.equal(room.switchTeam(a, now), null);
        now += 1100;
        update(now);
        assert.deepEqual(sizes(), even, `${bots} bots: even again after the switch`);
      } finally {
        room.close();
      }
    }
  });

  it('is refused where teams are fixed: FaceChiken (ranked, random teams), Zombie Apocalypse, and modes with no teams', () => {
    for (const [mode, reason] of [['face', /ranked/], ['zombie', /zombies/], ['ffa', /no teams/]] as const) {
      withRoom(mode, (room) => {
        const a = addPlayer(room, 'A');
        const team = a.info.team;
        assert.match(room.switchTeam(a, performance.now()) ?? '', reason, mode);
        assert.equal(a.info.team, team, `${mode}: team unchanged`);
      });
    }
  });

  it('ChikenBomb: during buy time you go straight to the new spawn (frozen); mid-round you sit out', () => {
    const { io } = fakeIo();
    const room = createRoom(io, { id: 't', code: 'BOMB2', name: 'Bomb', mode: 'bomb', map: 'sandstown', private: true }, {}) as BombRoom;
    try {
      clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
      const all = [0, 1, 2, 3].map((i) => addPlayer(room, `P${i}`));
      let now = performance.now();
      const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
      const step = (ms: number) => { const end = now + ms; while (now < end) { now = Math.min(end, now + SIM_DT * 1000); update(now); } };
      room.startNow();
      step(BOMB.warmupMs + 50);
      assert.equal(room.roundState.phase, 'buy');
      const a = all[0]!;
      const from = a.info.team;
      assert.equal(room.switchTeam(a, now), null);
      assert.notEqual(a.info.team, from);
      assert.equal(a.alive, true, 'back in at once during buy time');
      assert.equal(a.frozen, true);
      step(BOMB.buyMs + 50);
      assert.equal(room.roundState.phase, 'live');
      // From the team that now has 3: back to 2 v 2.
      const b = all.find((p) => p !== a && p.alive && p.info.team === a.info.team)!;
      assert.equal(room.switchTeam(b, now), null);
      assert.equal(b.alive, false, 'mid-round: out until the next round');
      assert.equal(b.respawnAt, Infinity);
    } finally {
      room.close();
    }
  });
});
