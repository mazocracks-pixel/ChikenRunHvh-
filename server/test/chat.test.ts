import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addPlayer, makeRoom } from './helpers';

/** A fake socket that records what it is sent. */
function listen(p: object): unknown[] {
  const heard: unknown[] = [];
  Object.defineProperty(p, 'socket', { value: { emit: (event: string, m: unknown) => event === 'chat' && (m as { pid: number }).pid !== 0 && heard.push(m), leave: () => {} } });
  return heard;
}

describe('team chat', () => {
  it('goes only to the sender’s team; global chat goes to the whole room', () => {
    const { room, events } = makeRoom('tdm');
    const a = addPlayer(room, 'A');
    const mate = addPlayer(room, 'Mate');
    const enemy = addPlayer(room, 'Enemy');
    a.info.team = 1;
    mate.info.team = 1;
    enemy.info.team = 2;
    const heardMate = listen(mate);
    const heardEnemy = listen(enemy);
    room.handleChat(a, 'push b', true);
    assert.equal(heardMate.length, 1);
    assert.deepEqual(heardMate[0], { pid: a.pid, name: 'A', text: 'push b', team: 1, teamOnly: true });
    assert.equal(heardEnemy.length, 0, 'the other team does not hear it');
    assert.equal(events.filter((e) => e.event === 'chat' && (e.args[0] as { pid: number }).pid !== 0).length, 0, 'not broadcast to the room');

    room.handleChat(a, 'gg', false);
    assert.equal(events.filter((e) => e.event === 'chat' && (e.args[0] as { pid: number }).pid !== 0).length, 1, 'global chat is broadcast');
    room.close();
  });

  it('in modes without teams, team chat is heard by everyone', () => {
    const { room, events } = makeRoom('ffa');
    const a = addPlayer(room, 'A');
    room.handleChat(a, 'hi', true);
    assert.equal(events.filter((e) => e.event === 'chat' && (e.args[0] as { pid: number }).pid !== 0).length, 1);
    room.close();
  });
});
