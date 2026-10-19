import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpectateTarget, livingTeammates, type SpectateCandidate } from '../../src/hvh/Spectate';

const P = (pid: number, team: number, alive = true): SpectateCandidate => ({ pid, team, alive });

describe('spectate target (R63)', () => {
  const room = [P(7, 1), P(3, 2), P(5, 1), P(2, 1, false), P(9, 1), P(4, 2)];

  it('living teammates in pid order: same team, alive, never team 0', () => {
    assert.deepEqual(livingTeammates(1, room), [5, 7, 9]);
    assert.deepEqual(livingTeammates(2, room), [3, 4]);
    assert.deepEqual(livingTeammates(0, [P(1, 0), P(2, 0)]), []);
  });

  it('starts on the first living teammate and keeps them while they live', () => {
    const s = new SpectateTarget();
    assert.equal(s.update(1, room), 5);
    assert.equal(s.update(1, room), 5);
    assert.equal(s.current, 5);
  });

  it('a click cycles to the next living teammate, wrapping; the other button goes back', () => {
    const s = new SpectateTarget();
    s.update(1, room);
    assert.equal(s.cycle(1, room), 7);
    assert.equal(s.cycle(1, room), 9);
    assert.equal(s.cycle(1, room), 5, 'wraps');
    assert.equal(s.cycle(1, room, -1), 9, 'back, wrapping');
  });

  it('cycling skips the dead and the enemies', () => {
    const s = new SpectateTarget();
    s.update(1, room);
    const later = room.map((p) => (p.pid === 7 ? P(7, 1, false) : p));
    assert.equal(s.cycle(1, later), 9);
  });

  it('when the watched teammate dies, the next living one after them is watched', () => {
    const s = new SpectateTarget();
    s.update(1, room);
    s.cycle(1, room);
    assert.equal(s.current, 7);
    const later = room.map((p) => (p.pid === 7 ? P(7, 1, false) : p));
    assert.equal(s.update(1, later), 9);
    const last = later.map((p) => (p.pid === 9 ? P(9, 1, false) : p));
    assert.equal(s.update(1, last), 5, 'wraps to the first');
  });

  it('with no teammate alive there is nobody to watch (the death camera stays)', () => {
    const s = new SpectateTarget();
    const wiped = room.map((p) => (p.team === 1 ? P(p.pid, 1, false) : p));
    assert.equal(s.update(1, wiped), null);
    assert.equal(s.cycle(1, wiped), null);
    assert.equal(s.current, null);
  });

  it('a teammate that left the room is dropped', () => {
    const s = new SpectateTarget();
    s.update(1, room);
    assert.equal(s.update(1, room.filter((p) => p.pid !== 5)), 7);
  });

  it('reset (a respawn) ends spectating', () => {
    const s = new SpectateTarget();
    s.update(1, room);
    s.cycle(1, room);
    s.reset();
    assert.equal(s.current, null);
    assert.equal(s.update(1, room), 5, 'the next death starts over');
  });
});
