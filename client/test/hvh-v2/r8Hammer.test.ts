import assert from 'node:assert/strict';
import { it } from 'node:test';
import { WeaponController } from '../../src/game/WeaponController';

/** Holds the trigger from `from` to `until` (exclusive) at 1 ms steps; returns the fire times. */
function hold(w: WeaponController, from: number, until: number): number[] {
  const shots: number[] = [];
  for (let now = from; now < until; now++) if (w.trigger(true, now) === 'fire') shots.push(now);
  return shots;
}

it('the R8 fires hammerMs after the press while the trigger is held', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 450), [400]);
  assert.equal(w.mag, 7);
});

it('releasing the R8 trigger before the hammer drops cancels the shot', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 300), []);
  assert.equal(w.trigger(false, 300), null);
  for (let now = 301; now < 1000; now++) assert.equal(w.trigger(false, now), null);
  assert.equal(w.mag, 8);
  // A new press starts a new pull.
  assert.deepEqual(hold(w, 1000, 1500), [1400]);
});

it('a hammer pulled during the cooldown fires once the R8 is ready, not never', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 410), [400]);
  assert.equal(w.trigger(false, 410), null);
  // Hammer back at 820, but the 500 ms cycle from the shot at 400 ends at 900.
  assert.deepEqual(hold(w, 420, 2000), [900]);
});

it('a hammer held through a reload fires when the reload ends', () => {
  const w = new WeaponController(['r8']);
  assert.deepEqual(hold(w, 0, 410), [400]);
  w.trigger(false, 410);
  assert.equal(w.reload(500), true);
  const shots: number[] = [];
  for (let now = 600; now < 3200; now++) {
    w.update(now);
    if (w.trigger(true, now) === 'fire') shots.push(now);
  }
  assert.deepEqual(shots, [2800]);
  assert.equal(w.mag, 7);
});

it('switching weapons drops the hammer', () => {
  const w = new WeaponController(['r8', 'deserteagle']);
  assert.deepEqual(hold(w, 0, 300), []);
  assert.equal(w.switchTo(1, 300), true);
  assert.equal(w.switchTo(0, 310), true);
  // Still held, but the pull was cancelled: no shot without a new press.
  assert.deepEqual(hold(w, 311, 1500), []);
});

it('the Desert Eagle fires on the press', () => {
  const w = new WeaponController(['deserteagle']);
  assert.deepEqual(hold(w, 0, 450), [0]);
});

/**
 * v2: holds the trigger from 0 to `until` at 1 ms steps, building a command (trigger held) every
 * 64 Hz tick unless `skip(n)` drops the tick's command (clock correction). Returns the fire times
 * and the seq each shot's command gets (the next one built).
 */
function holdWithCommands(w: WeaponController, until: number, skip: (tick: number) => boolean = () => false) {
  const shots: { at: number; seq: number }[] = [];
  let seq = 0;
  let tick = 0;
  let firstHeld: number | null = null;
  for (let now = 0; now < until; now++) {
    while (tick * (1000 / 64) <= now) {
      if (!skip(tick)) { w.commandBuilt(++seq, true); firstHeld ??= seq; }
      tick++;
    }
    if (w.trigger(true, now) === 'fire') shots.push({ at: now, seq: seq + 1 });
  }
  return { shots, firstHeld: firstHeld! };
}

it('v2: the R8 shot waits until its command is hammerTicks seqs after the first held one (the server rule)', () => {
  const w = new WeaponController(['r8']);
  const { shots, firstHeld } = holdWithCommands(w, 600);
  assert.equal(shots.length, 1);
  assert.ok(shots[0]!.at >= 400);
  assert.ok(shots[0]!.seq - firstHeld >= 26, `elapsed ${shots[0]!.seq - firstHeld}`);
  // Never later than the 400 ms pull plus one command.
  assert.ok(shots[0]!.at <= 400 + 16);
});

it('v2: commands skipped by the clock correction delay the R8 shot instead of getting it rejected', () => {
  const w = new WeaponController(['r8']);
  const { shots, firstHeld } = holdWithCommands(w, 900, (tick) => tick % 4 === 3);
  assert.equal(shots.length, 1);
  assert.ok(shots[0]!.at > 450, `fired at ${shots[0]!.at}`);
  assert.ok(shots[0]!.seq - firstHeld >= 26);
});

it('v2: a command built with the trigger up restarts the counted pull', () => {
  const w = new WeaponController(['r8']);
  for (let seq = 1; seq <= 30; seq++) w.commandBuilt(seq, seq !== 20);
  // The ms pull is long done, but the shot (seq 31) would be only 10 seqs after the hold restarted (21).
  assert.equal(w.trigger(true, 0), null);
  assert.equal(w.trigger(true, 1000), null);
  for (let seq = 31; seq <= 46; seq++) w.commandBuilt(seq, true);
  assert.equal(w.trigger(true, 1001), 'fire');
});
