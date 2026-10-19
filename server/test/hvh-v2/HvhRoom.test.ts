import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SIM_DT, WEAPONS, makeRay, normalize, rayHvhMatrix, unpackPlayer, type InputFrame, type Vec3 } from '@game/shared';
import { LATE_CSGO, fireIntervalTicks, guessedPose, poseMatrix, type CommandIntent, type LagRecord, type ShotVerdict } from '@game/shared/hvh/v2';
import type { ServerPlayer } from '../../src/rooms/ServerPlayer';
import { GameRoom } from '../../src/rooms/GameRoom';
import { HvhRoom, hvhEngineFrom, type HvhEngine } from '../../src/rooms/HvhRoom';
import { createRoom } from '../../src/rooms/modes';
import { addPlayer, fakeIo, place, stepRoom } from '../helpers';

const TICK_MS = SIM_DT * 1000;
const IDLE: CommandIntent = { fire: false, choke: false, doubleTap: false, hideShots: false }; // Task 7

function makeHvh(engine: HvhEngine) {
  const { io, events } = fakeIo();
  const room = new HvhRoom(io, { id: 'hvh-v2', code: 'HVH01', name: 'HvH v2', mode: 'hvh', map: 'flat', private: true, hvhEngine: engine }, {});
  const verdicts: ShotVerdict[] = [];
  room.addVerdictListener((v) => verdicts.push(v));
  return { room, events, verdicts };
}

/** Two scripted players on opposite teams, spawned, unshielded, AA tools enabled. */
function duel(engine: HvhEngine = 'v2') {
  const made = makeHvh(engine);
  const { room } = made;
  const a = addPlayer(room, 'A');
  const b = addPlayer(room, 'B');
  a.info.team = 1;
  b.info.team = 2;
  room.startNow();
  place(a, 20, 20);
  place(b, 20, 10);
  a.shieldUntil = b.shieldUntil = 0;
  a.hvhEnabled = b.hvhEnabled = true;
  return { ...made, a, b };
}

function command(seq: number, intent?: Partial<CommandIntent>): InputFrame & { intent?: CommandIntent; clientTick?: number } {
  const frame: InputFrame & { intent?: CommandIntent; clientTick?: number } = { seq, forward: 0, right: 0, jump: false, yaw: 0, pitch: 0 };
  if (intent) frame.intent = { ...IDLE, ...intent };
  return frame;
}

function recordOf(room: HvhRoom, pid: number): LagRecord {
  const r = room.v2State(pid)!.history.records().at(-1);
  assert.ok(r, 'the player has a lag record');
  return r;
}

function boxCentre(room: HvhRoom, pid: number, group: string): Vec3 {
  const r = recordOf(room, pid);
  return poseMatrix(r, r.pose).boxes.find((b) => b.group === group)!.center;
}

function anglesTo(from: Vec3, to: Vec3): { dir: Vec3; yaw: number; pitch: number } {
  const dir = normalize({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  return { dir, yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y) };
}

function intersects(room: HvhRoom, pid: number, origin: Vec3, dir: Vec3): boolean {
  const r = recordOf(room, pid);
  return rayHvhMatrix(makeRay(origin, dir), poseMatrix(r, r.pose), 100) !== null;
}

/** One tick of idle commands for every listed player. */
function idleTick(room: HvhRoom, players: ServerPlayer[], seqs: Map<number, number>, now: number): void {
  for (const p of players) {
    const seq = (seqs.get(p.pid) ?? 0) + 1;
    seqs.set(p.pid, seq);
    room.handleInput(p, command(seq, {}));
  }
  stepRoom(room, now);
}

type Sent = { event: string; data: unknown };
function fakeSocket(p: ServerPlayer, sink: Sent[]): void {
  const socket = { emit(event: string, data: unknown) { sink.push({ event, data }); }, to() { return { emit() {} }; }, leave() {}, volatile: { emit() {} } };
  Object.defineProperty(p, 'socket', { value: socket });
}

function threePlayers(nearX: number) {
  const made = duel();
  const { room, a, b } = made;
  const c = addPlayer(room, 'C');
  c.info.team = 2;
  room.respawnPlayer(c, performance.now());
  place(b, nearX, 15);
  place(c, 20, 10);
  b.shieldUntil = c.shieldUntil = 0;
  const seqs = new Map<number, number>();
  let now = performance.now();
  for (let i = 0; i < 3; i++) idleTick(room, [a, b, c], seqs, (now += TICK_MS));
  return { ...made, c, seqs, now };
}

describe('HvhRoom v2 tick pipeline', () => {
  it('bank ticks still simulate movement and reach a full bank', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    a.takeInputToken = () => true;
    let now = performance.now();
    for (let seq = 1; seq <= 20; seq++) {
      const z = a.state.z;
      room.handleInput(a, { ...command(seq, {}), forward: 1 });
      stepRoom(room, (now += TICK_MS));
      assert.equal(a.lastSeq, seq, `command ${seq} executed this tick (no coasting)`);
      assert.ok(a.state.z < z, `command ${seq} moved the player`);
    }
    assert.equal(a.lastSeq, 20);
    assert.equal(room.tickbaseOf(a.pid)?.charge, LATE_CSGO.chargeTicks); // Task 7
  });

  it('a ray through only the guessed body names that target and is a resolver miss', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    b.hvh.antiAim = { ...b.hvh.antiAim, enabled: true, mode: 'backward', desync: 58, jitter: 0 };
    const seqs = new Map<number, number>();
    let now = performance.now();
    // Inverted desync: the real body is on the right; with no eye offset the resolver guesses left.
    for (let i = 0; i < 3; i++) {
      for (const p of [a, b]) {
        const seq = (seqs.get(p.pid) ?? 0) + 1;
        seqs.set(p.pid, seq);
        room.handleInput(p, { ...command(seq, {}), invert: p === b });
      }
      stepRoom(room, (now += TICK_MS));
    }
    const r = recordOf(room, b.pid);
    assert.equal(r.pose.realSide, 'right');
    const guessed = poseMatrix(r, guessedPose(r.pose, 'left'));
    const real = poseMatrix(r, r.pose);
    const eye = room.eyeOf(a);
    const aim = guessed.boxes.map((box) => anglesTo(eye, box.center))
      .find((x) => rayHvhMatrix(makeRay(eye, x.dir), real, 100) === null && rayHvhMatrix(makeRay(eye, x.dir), guessed, 100) !== null);
    assert.ok(aim, 'precondition: some guessed hitbox is clear of the real body');
    room.handleInput(a, { ...command(seqs.get(a.pid)! + 1, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
    room.handleInput(b, { ...command(seqs.get(b.pid)! + 1, {}), invert: true });
    stepRoom(room, (now += TICK_MS));
    const shot = verdicts.find((v) => v.shooterId === String(a.pid));
    assert.deepEqual([shot?.targetId, shot?.cause, shot?.guessed, shot?.real], [String(b.pid), 'resolver', 'left', 'right']);
  });

  it('a command-level fire with a melee weapon is rejected as wrong weapon', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    a.info.loadout.push('knife');
    a.weaponSlot = a.info.loadout.length - 1;
    room.handleInput(a, command(1, { fire: true }));
    stepRoom(room, performance.now() + TICK_MS);
    assert.deepEqual(verdicts.map((v) => [v.cause, v.reason]), [['rejected', 'wrong weapon']]);
  });

  it('a shot at a spawn-protected target still spends ammo, the fire interval and the own shield', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    place(b, 20, 17);
    const seqs = new Map<number, number>();
    let now = performance.now();
    for (let i = 0; i < 3; i++) idleTick(room, [a, b], seqs, (now += TICK_MS));
    b.shieldUntil = now + 60_000;
    a.shieldUntil = now + 60_000;
    const mag = a.mag;
    const aim = anglesTo(room.eyeOf(a), boxCentre(room, b.pid, 'chest'));
    let seq = seqs.get(a.pid)!;
    room.handleInput(a, { ...command(++seq, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
    stepRoom(room, (now += TICK_MS));
    room.handleInput(a, { ...command(++seq, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
    stepRoom(room, (now += TICK_MS));
    const shots = verdicts.filter((v) => v.shooterId === String(a.pid));
    assert.deepEqual(shots.map((v) => v.reason), ['spawn protection', 'fire interval']);
    assert.equal(a.mag, mag - 1, 'the protected shot spent one round');
    assert.equal(a.shieldUntil, 0, 'firing ends the shooter\'s own spawn shield');
    assert.equal(b.hp, 100);
  });

  it('a near enemy beside the line does not steal a head shot on a far enemy', (t) => {
    const { room, a, b, c, seqs, now } = threePlayers(20.75);
    t.after(() => room.close());
    const eye = room.eyeOf(a);
    const aim = anglesTo(eye, boxCentre(room, c.pid, 'head'));
    assert.equal(intersects(room, b.pid, eye, aim.dir), false, 'precondition: the ray misses B');
    const verdicts: ShotVerdict[] = [];
    room.addVerdictListener((v) => verdicts.push(v));
    room.handleInput(a, { ...command(seqs.get(a.pid)! + 1, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
    stepRoom(room, now + TICK_MS);
    assert.equal(verdicts.find((v) => v.shooterId === String(a.pid))?.targetId, String(c.pid));
  });

  it('a client naming a far enemy behind a near intersected enemy gets the near enemy', (t) => {
    const { room, a, b, c, seqs, now: last } = threePlayers(20);
    t.after(() => room.close());
    const eye = room.eyeOf(a);
    const aim = anglesTo(eye, boxCentre(room, c.pid, 'head'));
    assert.equal(intersects(room, b.pid, eye, aim.dir), true, 'precondition: B is in the way');
    const verdicts: ShotVerdict[] = [];
    room.addVerdictListener((v) => verdicts.push(v));
    const seq = seqs.get(a.pid)! + 1;
    const now = last + TICK_MS;
    room.handleFire(a, { shot: 1, weapon: a.weapon, dx: aim.dir.x, dy: aim.dir.y, dz: aim.dir.z, t: now, aiming: false, command: seq,
      intent: { target: c.pid, source: 'CENTER', recordT: now, yaw: 0 } });
    room.handleInput(a, { ...command(seq, {}), yaw: aim.yaw, pitch: aim.pitch });
    stepRoom(room, now);
    assert.equal(verdicts.find((v) => v.shooterId === String(a.pid))?.targetId, String(b.pid));
  });

  it('flood verdicts reach only the sender', (t) => {
    const { room, a, b } = duel();
    t.after(() => room.close());
    const toA: Sent[] = [];
    const toB: Sent[] = [];
    fakeSocket(a, toA);
    fakeSocket(b, toB);
    room.damage(b, a, 1000, false, a.weapon, room.eyeOf(a), performance.now());
    assert.equal(b.alive, false, 'B is a spectator');
    a.takeInputToken = () => true;
    for (let seq = 1; seq <= 40; seq++) room.handleInput(a, command(seq, {}));
    assert.equal(toA.filter((e) => e.event === 'shotVerdict').length, 8);
    assert.equal(toB.filter((e) => e.event === 'shotVerdict').length, 0);
  });

  it('the input limiter still applies in v2', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    a.takeInputToken = () => false;
    room.handleInput(a, command(1, {}));
    assert.equal(room.queuedCommands(a.pid), 0);
  });

  it('a pending fire consumed while preparing is rejected as actions blocked', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    room.handleInput(a, command(1, {}));
    room.handleFire(a, { shot: 1, weapon: a.weapon, dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false, command: 1 });
    a.hvhPreparing = true;
    stepRoom(room, performance.now() + TICK_MS);
    assert.deepEqual(verdicts.map((v) => [v.cause, v.reason]), [['rejected', 'actions blocked']]);
  });

  it('pending fires cleared by death, and fires while dead, are rejected as actions blocked', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    room.handleFire(a, { shot: 1, weapon: a.weapon, dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false, command: 5 });
    room.damage(a, b, 1000, false, b.weapon, room.eyeOf(b), performance.now());
    assert.deepEqual(verdicts.map((v) => [v.cause, v.reason]), [['rejected', 'actions blocked']]);
    room.handleFire(a, { shot: 2, weapon: a.weapon, dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false });
    assert.deepEqual(verdicts.map((v) => v.reason), ['actions blocked', 'actions blocked']);
  });

  it('a pending fire whose weapon became melee is rejected as wrong weapon', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    room.handleInput(a, command(1, {}));
    room.handleFire(a, { shot: 1, weapon: a.weapon, dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false, command: 1 });
    a.info.loadout.push('knife');
    a.weaponSlot = a.info.loadout.length - 1;
    stepRoom(room, performance.now() + TICK_MS);
    assert.deepEqual(verdicts.map((v) => [v.cause, v.reason]), [['rejected', 'wrong weapon']]);
  });

  it('a v2 choke freezes the public snapshot until the flush', (t) => {
    const { room, a, b } = duel();
    t.after(() => room.close());
    const seqs = new Map<number, number>();
    let now = performance.now();
    for (let i = 0; i < 3; i++) idleTick(room, [b], seqs, (now += TICK_MS));
    const view = () => room.snapshot(now, a.pid).p.find((s) => s[0] === b.pid)!;
    const before = view();
    let seq = seqs.get(b.pid)!;
    for (let i = 0; i < 10; i++) {
      room.handleInput(b, { ...command(++seq, { choke: true }), forward: 1, yaw: 0.5 });
      stepRoom(room, (now += TICK_MS));
      assert.equal(room.tickbaseOf(b.pid)?.choked, i + 1);
      assert.deepEqual(view(), before, `choke tick ${i + 1}: public state frozen`);
    }
    room.handleInput(b, { ...command(++seq, {}), forward: 1, yaw: 0.5 });
    stepRoom(room, (now += TICK_MS));
    const after = unpackPlayer(view());
    assert.notDeepEqual([after.x, after.z], [unpackPlayer(before).x, unpackPlayer(before).z], 'the flush publishes the new position');
    assert.ok(Math.abs(after.yaw - 0.5) < 1e-3, 'public yaw is the observed eye yaw');
  });

  it('a hit on a spawn-protected target is rejected and deals no damage', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    place(b, 20, 17);
    const seqs = new Map<number, number>();
    let now = performance.now();
    for (let i = 0; i < 3; i++) idleTick(room, [a, b], seqs, (now += TICK_MS));
    b.shieldUntil = now + 60_000;
    const aim = anglesTo(room.eyeOf(a), boxCentre(room, b.pid, 'chest'));
    room.handleInput(a, { ...command(seqs.get(a.pid)! + 1, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
    stepRoom(room, (now += TICK_MS));
    const shot = verdicts.find((v) => v.shooterId === String(a.pid) && v.bullet === 1);
    assert.deepEqual([shot?.cause, shot?.reason, shot?.targetId], ['rejected', 'spawn protection', String(b.pid)]);
    assert.equal(b.hp, 100);
  });

  it('v2 targets wear armor: a Desert Eagle chest hit takes its armor penetration', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    place(b, 20, 17);
    a.info.loadout.push('deserteagle');
    a.weaponSlot = a.info.loadout.length - 1;
    a.mags.set('deserteagle', a.magazineSize('deserteagle'));
    const seqs = new Map<number, number>();
    let now = performance.now();
    for (let i = 0; i < 3; i++) idleTick(room, [a, b], seqs, (now += TICK_MS));
    const eye = room.eyeOf(a);
    const aim = anglesTo(eye, boxCentre(room, b.pid, 'chest'));
    const r = recordOf(room, b.pid);
    const distance = rayHvhMatrix(makeRay(eye, aim.dir), poseMatrix(r, r.pose), 100)!.t;
    room.handleInput(a, { ...command(seqs.get(a.pid)! + 1, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
    stepRoom(room, (now += TICK_MS));
    const shot = verdicts.find((v) => v.shooterId === String(a.pid) && v.bullet === 1);
    assert.deepEqual([shot?.cause, shot?.hitgroup], ['hit', 'chest']);
    // Desert Eagle: 53 damage, range modifier 0.85 per 12.5 m, chest x1, armor penetration 0.932.
    // Spread only moves the hit point by millimetres, so the falloff barely changes.
    const unarmored = 53 * 0.85 ** (distance / 12.5);
    assert.ok(Math.abs(shot!.damage! - unarmored * 0.932) < 0.01, `${shot!.damage} vs ${unarmored * 0.932}`);
  });

  it('calling processPlayerTick twice in one tick pushes one record and does not throw', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    room.handleInput(a, command(1, {}));
    room.handleInput(a, command(2, {}));
    room.processPlayerTick(String(a.pid));
    room.processPlayerTick(String(a.pid));
    assert.equal(room.v2State(a.pid)!.history.records().length, 1);
    stepRoom(room, performance.now() + TICK_MS);
  });

  it('burst is capped at maxProcessTicks', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    a.takeInputToken = () => true;
    for (let seq = 1; seq <= 30; seq++) room.handleInput(a, command(seq, {}));
    stepRoom(room, performance.now() + TICK_MS);
    assert.equal(LATE_CSGO.maxProcessTicks, 16);
    assert.equal(a.lastSeq, 16, 'exactly 16 commands executed this tick');
    assert.equal(room.queuedCommands(a.pid), 14, '14 remain queued');
  });

  it('flood drops oldest with verdict', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    a.takeInputToken = () => true;
    for (let seq = 1; seq <= 40; seq++) room.handleInput(a, command(seq, {}));
    const flood = verdicts.filter((v) => v.cause === 'rejected' && v.reason === 'command flood');
    assert.equal(flood.length, 8);
    assert.equal(verdicts.length, 8);
    assert.ok(flood.every((v) => v.shooterId === String(a.pid)));
    assert.equal(room.queuedCommands(a.pid), 32);
    stepRoom(room, performance.now() + TICK_MS);
    assert.equal(a.lastSeq, 8 + 16, 'the 8 oldest were dropped, so execution starts at seq 9');
  });

  it('R41: banking never blocks fire (the fire interval counts server ticks, not tickbase)', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    assert.equal(room.tickbaseOf(a.pid)?.charge, 0, 'a fresh spawn has an empty bank'); // Task 7
    // A gun that cycles within one DT shift (v2 spawns carry the slower arsenal).
    a.info.loadout.push('rifle');
    a.weaponSlot = a.info.loadout.length - 1;
    a.mags.set('rifle', a.magazineSize('rifle'));
    const interval = fireIntervalTicks(WEAPONS[a.weapon]);
    assert.ok(interval > 1 && interval - 1 < LATE_CSGO.chargeTicks); // Task 7
    let now = performance.now();
    let seq = 0;
    let bSeq = 0;
    // b idles every tick (one lag record per tick).
    const step = (): void => {
      room.handleInput(b, command(++bSeq, {}));
      stepRoom(room, (now += TICK_MS));
    };
    const fire = (): void => {
      const aim = anglesTo(room.eyeOf(a), boxCentre(room, b.pid, 'chest'));
      room.handleInput(a, { ...command(++seq, { fire: true }), yaw: aim.yaw, pitch: aim.pitch });
      step();
    };
    step();
    fire();
    const firstTick = room.hvhTick;
    const tickbase = room.tickbaseOf(a.pid)!.tickbase;
    // Idle for interval - 1 ticks: every one is a bank tick (tickbase frozen).
    for (let i = 0; i < interval - 1; i++) {
      room.handleInput(a, command(++seq, {}));
      step();
    }
    assert.equal(room.tickbaseOf(a.pid)?.charge, interval - 1, 'the idle ticks banked'); // Task 7
    assert.equal(room.tickbaseOf(a.pid)?.tickbase, tickbase, 'bank ticks did not advance tickbase');
    fire();
    assert.equal(room.hvhTick, firstTick + interval, 'the first tick the weapon interval allows');
    const shots = verdicts.filter((v) => v.shooterId === String(a.pid));
    assert.equal(shots.length, 2);
    assert.ok(shots.every((v) => v.cause !== 'rejected'), `both shots fired (${shots.map((v) => `${v.cause}${v.reason ? `:${v.reason}` : ''}`).join(', ')})`);
  });

  it('dt fires two bullets same tick', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    let now = performance.now();
    let seq = 0;
    for (let i = 0; i < LATE_CSGO.chargeTicks; i++) { // Task 7
      room.handleInput(a, command(++seq, {}));
      stepRoom(room, (now += TICK_MS));
    }
    assert.equal(room.tickbaseOf(a.pid)?.charge, LATE_CSGO.chargeTicks, 'full bank'); // Task 7
    room.handleInput(a, command(++seq, { fire: true, doubleTap: true }));
    stepRoom(room, (now += TICK_MS));
    const shots = verdicts.filter((v) => v.shooterId === String(a.pid) && v.cause !== 'tickbase');
    assert.deepEqual(shots.map((v) => v.bullet), [1, 2]);
    assert.equal(shots[0]!.tick, shots[1]!.tick, 'same server tick');
    assert.equal(shots[0]!.tick, room.hvhTick);
    assert.equal(room.tickbaseOf(a.pid)?.charge, 0); // Task 7
  });

  it('death cancels pending dt bullet', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    let now = performance.now();
    let seq = 0;
    for (let i = 0; i < LATE_CSGO.chargeTicks; i++) { // Task 7
      room.handleInput(a, command(++seq, {}));
      stepRoom(room, (now += TICK_MS));
    }
    room.handleInput(a, command(++seq, { fire: true, doubleTap: true }));
    now += TICK_MS;
    room.processPlayerTick(String(a.pid), now);
    assert.deepEqual(verdicts.filter((v) => v.shooterId === String(a.pid)).map((v) => v.bullet), [1]);
    // B kills A in the same server tick, before bullet 2 is processed.
    assert.notEqual(room.v2State(a.pid)?.pendingBullet, null, 'bullet 2 is pending before the death');
    room.damage(a, b, 1000, true, b.weapon, room.eyeOf(b), now);
    assert.equal(a.alive, false);
    assert.equal(room.v2State(a.pid)?.pendingBullet, null, 'death cancels bullet 2');
    room.flushPendingBullets(now);
    assert.equal(verdicts.filter((v) => v.shooterId === String(a.pid) && v.bullet === 2).length, 0, 'no bullet-2 verdict');
    room.respawnPlayer(a, now);
    assert.equal(a.alive, true);
    assert.equal(room.tickbaseOf(a.pid)?.charge, 0); // Task 7
    // A death with a non-empty bank, then a respawn: the new life starts empty.
    for (let i = 0; i < 5; i++) {
      room.handleInput(a, command(++seq, {}));
      stepRoom(room, (now += TICK_MS));
    }
    assert.ok(room.tickbaseOf(a.pid)!.charge > 0); // Task 7
    a.shieldUntil = 0;
    room.damage(a, b, 1000, true, b.weapon, room.eyeOf(b), now);
    assert.equal(a.alive, false);
    room.respawnPlayer(a, now);
    assert.equal(room.tickbaseOf(a.pid)?.charge, 0); // Task 7
  });

  it('a tickbase reject becomes a verdict and the command still runs', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    room.handleInput(a, { ...command(1, { fire: true, doubleTap: true }), forward: 1 });
    const z = a.state.z;
    stepRoom(room, performance.now() + TICK_MS);
    const tb = verdicts.filter((v) => v.cause === 'tickbase');
    assert.equal(tb.length, 1);
    assert.equal(tb[0]!.reason, 'double tap not charged');
    assert.equal(a.lastSeq, 1);
    assert.ok(a.state.z < z, 'the rejected command still moved the player');
  });

  it('hvhState reports the own tickbase, era and acknowledged command', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    const sent: { event: string; data: unknown }[] = [];
    Object.defineProperty(a, 'socket', { value: { emit(event: string, data: unknown) { sent.push({ event, data }); }, to() { return { emit() {} }; }, leave() {}, volatile: { emit() {} } } });
    room.handleInput(a, command(1, {}));
    stepRoom(room, performance.now() + TICK_MS);
    const state = sent.filter((s) => s.event === 'hvhState').at(-1)?.data as { tickbase: { charge: number }; era: string; lastAckSeq: number }; // Task 7
    assert.ok(state, 'hvhState sent to the owner');
    assert.equal(state.era, LATE_CSGO.id);
    assert.equal(state.lastAckSeq, 1);
    assert.equal(state.tickbase.charge, 1); // Task 7
    assert.ok(!('ticksSinceShift' in state.tickbase), 'no recharge counter is sent'); // Task 7
  });

  it('hvhState reports how many of the owner commands are still queued (for client clock correction)', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    const sent: { event: string; data: unknown }[] = [];
    Object.defineProperty(a, 'socket', { value: { emit(event: string, data: unknown) { sent.push({ event, data }); }, to() { return { emit() {} }; }, leave() {}, volatile: { emit() {} } } });
    a.takeInputToken = () => true; // the legacy input limiter is not under test
    const now = performance.now();
    // Spend the burst budget, then five commands arrive in one tick: one runs, four wait.
    for (let seq = 1; seq <= 16; seq++) room.handleInput(a, command(seq, {}));
    stepRoom(room, now + TICK_MS);
    for (let seq = 17; seq <= 21; seq++) room.handleInput(a, command(seq, {}));
    stepRoom(room, now + 2 * TICK_MS);
    const state = sent.filter((s) => s.event === 'hvhState').at(-1)?.data as { queued: number; lastAckSeq: number };
    assert.equal(state.lastAckSeq, 17);
    assert.equal(state.queued, 4);
  });

  it('legacy flag untouched', (t) => {
    // Same scripted inputs through a plain GameRoom and an HvhRoom on the legacy engine.
    const run = (legacyRoom: GameRoom) => {
      t.after(() => legacyRoom.close());
      const a = addPlayer(legacyRoom, 'A');
      const b = addPlayer(legacyRoom, 'B');
      a.info.team = 1;
      b.info.team = 2;
      legacyRoom.startNow();
      place(a, 20, 20);
      place(b, 20, 10);
      a.takeInputToken = () => true;
      const now = 1_000_000;
      for (let seq = 1; seq <= 20; seq++) {
        legacyRoom.handleInput(a, { ...command(seq, { fire: true, doubleTap: true }), forward: 1, right: seq % 2 });
        stepRoom(legacyRoom, now + seq * TICK_MS);
      }
      return { snapshot: legacyRoom.snapshot(now + 21 * TICK_MS, a.pid).p, lastSeq: a.lastSeq, queued: a.commands.size, intent: 'intent' in (a.lastInput ?? {}) };
    };
    const { io } = fakeIo();
    const plain = run(new GameRoom(io, { id: 'plain', code: 'PLN01', name: 'plain', mode: 'hvh', map: 'flat', private: true }, {}));
    const { room, events, verdicts } = makeHvh('legacy');
    const legacy = run(room);
    assert.deepEqual(legacy, plain);
    assert.equal(legacy.intent, false);
    assert.equal(verdicts.length, 0);
    assert.ok(!events.some((e) => e.event === 'shotVerdict' || e.event === 'hvhState'));
  });

  it('no hvh outside hvh', (t) => {
    const { io, events } = fakeIo();
    const room = createRoom(io, { id: 'ffa', code: 'FFA01', name: 'ffa', mode: 'ffa', map: 'flat', private: true, hvhEngine: 'v2' }, {});
    t.after(() => room.close());
    assert.ok(!(room instanceof HvhRoom));
    const p = addPlayer(room, 'P');
    room.startNow();
    place(p, 20, 20);
    p.takeInputToken = () => true;
    const now = performance.now();
    for (let seq = 1; seq <= 20; seq++) {
      room.handleInput(p, { ...command(seq, { fire: true, doubleTap: true, choke: true } /* Task 7 */), forward: 1 });
      stepRoom(room, now + seq * TICK_MS);
    }
    assert.equal(p.lastSeq, 20, 'one command per tick, as always');
    assert.equal('intent' in (p.lastInput ?? {}), false);
    assert.equal(p.lastShotSeq, 0, 'intent.fire never fires outside HvH');
    assert.ok(!events.some((e) => e.event === 'shotVerdict' || e.event === 'hvhState'));
  });

  it('HVH_ENGINE picks the engine and only the HvH mode gets an HvhRoom', (t) => {
    assert.equal(hvhEngineFrom({ HVH_ENGINE: 'v2' }), 'v2');
    assert.equal(hvhEngineFrom({ HVH_ENGINE: 'V2' }), 'legacy');
    assert.equal(hvhEngineFrom({}), 'legacy');
    assert.equal(hvhEngineFrom({ HVH_ENGINE: 'legacy' }), 'legacy');
    const { io } = fakeIo();
    const v2 = createRoom(io, { id: 'a', code: 'AAA01', name: 'a', mode: 'hvh', map: 'flat', private: true, hvhEngine: 'v2' }, {});
    const legacy = createRoom(io, { id: 'b', code: 'BBB01', name: 'b', mode: 'hvh', map: 'flat', private: true }, {});
    t.after(() => { v2.close(); legacy.close(); });
    assert.ok(v2 instanceof HvhRoom && v2.hvhEngine === 'v2');
    assert.ok(legacy instanceof HvhRoom && legacy.hvhEngine === 'legacy');
    assert.equal(v2.mode.wallhack, true);
    assert.equal(v2.mode.wallbang, true);
    assert.equal(v2.mode.teamKills, true);
  });
});
