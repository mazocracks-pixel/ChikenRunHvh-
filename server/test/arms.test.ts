import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ARMS_FINAL_LEVEL, ARMS_LADDER, type KillCause } from '@game/shared';
import type { ArmsRoom } from '../src/rooms/ArmsRoom';
import { createRoom } from '../src/rooms/modes';
import type { ServerPlayer } from '../src/rooms/ServerPlayer';
import { addPlayer, fakeIo, type RecordedEvent } from './helpers';

let current: ArmsRoom | null = null;
afterEach(() => current?.close());

function setup() {
  const { io, events } = fakeIo();
  const room = createRoom(io, { id: 'a', code: 'ARMS1', name: 'Arms', mode: 'arms', map: 'farm', private: true }, {}) as ArmsRoom;
  current = room;
  const a = addPlayer(room, 'Alice');
  const b = addPlayer(room, 'Bob');
  room.startNow();
  return { room, events, a, b };
}

/** `killer` kills `victim` with `cause` (shields off). */
function kill(room: ArmsRoom, killer: ServerPlayer, victim: ServerPlayer, cause: KillCause = killer.weapon) {
  victim.shieldUntil = 0;
  if (!victim.alive) room.respawnPlayer(victim, performance.now());
  victim.shieldUntil = 0;
  room.damage(victim, killer, 1000, false, cause, { x: 0, y: 0, z: 0 }, performance.now());
}
const named = (events: RecordedEvent[], name: string) => events.filter((e) => e.event === name).map((e) => e.args[0] as Record<string, unknown>);

describe('Arms Race', () => {
  it('everyone starts on the first gun (plus a knife), and no grenades', () => {
    const { a, b } = setup();
    for (const p of [a, b]) {
      assert.deepEqual(p.info.loadout, [ARMS_LADDER[0], 'knife']);
      assert.equal(p.info.level, 0);
      assert.equal(p.eggs + p.smokes, 0);
    }
  });

  it('a kill with your current gun gives you the next one', () => {
    const { room, a, b } = setup();
    kill(room, a, b);
    assert.equal(room.levelOf(a), 1);
    assert.deepEqual(a.info.loadout, [ARMS_LADDER[1], 'knife']);
    assert.equal(a.weapon, ARMS_LADDER[1], 'switched to it');
    assert.equal(a.mag, a.magazineSize(ARMS_LADDER[1]!), 'full magazine');
    // Kills with something else (an egg) don't count.
    kill(room, a, b, 'egg');
    assert.equal(room.levelOf(a), 1);
  });

  it('a knife kill moves you up and knocks the victim back a step', () => {
    const { room, a, b } = setup();
    kill(room, b, a);
    kill(room, b, a);
    assert.equal(room.levelOf(b), 2);
    kill(room, a, b, 'knife');
    assert.equal(room.levelOf(b), 1, 'knifed: back a step');
    assert.equal(room.levelOf(a), 1);
  });

  it('the first Golden Knife kill wins', () => {
    const { room, events, a, b } = setup();
    for (let i = 0; i < ARMS_FINAL_LEVEL; i++) kill(room, a, b);
    assert.equal(room.levelOf(a), ARMS_FINAL_LEVEL);
    assert.deepEqual(a.info.loadout, ['goldknife']);
    assert.equal(room.phase, 'playing');
    kill(room, a, b, 'goldknife');
    assert.equal(room.phase, 'ended');
    assert.equal(named(events, 'match').at(-1)!.winnerPid, a.pid);
  });

  it('when time runs out, the highest step wins', () => {
    const { room, events, a, b } = setup();
    kill(room, b, a);
    kill(room, b, a);
    kill(room, a, b);
    (room as unknown as { endMatch(now: number): void }).endMatch(performance.now());
    assert.equal(named(events, 'match').at(-1)!.winnerPid, b.pid);
  });

  it('the scoreboard shows the step', () => {
    const { room, a, b } = setup();
    kill(room, a, b);
    assert.equal(a.info.score, 2, 'level 2');
  });
});
