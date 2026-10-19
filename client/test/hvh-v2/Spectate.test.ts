import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SPECTATE_MAX_TURN, SmoothedYaw, SpectateTarget, livingTeammates, type SpectateCandidate } from '../../src/hvh/Spectate';

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

describe('spectate view smoothing (anti-aim jitter)', () => {
  const DT = 1 / 64;
  const DEG = Math.PI / 180;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it('snaps to the first yaw, and to a new teammate after a reset', () => {
    const y = new SmoothedYaw();
    assert.equal(y.step(1, DT), 1);
    y.reset();
    assert.equal(y.step(-2, DT), -2);
  });

  it('a jitter of +-45 deg every tick barely moves the camera', () => {
    const y = new SmoothedYaw();
    const out: number[] = [];
    for (let i = 0; i < 128; i++) out.push(y.step(((i % 2 === 0 ? 45 : -45) * DEG), DT));
    const settled = out.slice(64);
    const spread = Math.max(...settled) - Math.min(...settled);
    assert.ok(spread < 4 * DEG, `the camera shakes ${spread / DEG} deg`);
  });

  it('a real turn is followed, without passing the max turn rate, across the +-180 wrap', () => {
    const y = new SmoothedYaw();
    y.step(170 * DEG, DT);
    let prev = 170 * DEG;
    let now = prev;
    for (let i = 0; i < 64; i++) {
      now = y.step(-170 * DEG, DT);
      assert.ok(Math.abs(wrap(now - prev)) <= SPECTATE_MAX_TURN * DT + 1e-9);
      prev = now;
    }
    assert.ok(Math.abs(wrap(now - -170 * DEG)) < 1 * DEG, 'settles on the new yaw, the short way round');
  });
});
