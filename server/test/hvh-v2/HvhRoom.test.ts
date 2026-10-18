import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SIM_DT, type InputFrame } from '@game/shared';
import { LATE_CSGO, type CommandIntent, type ShotVerdict } from '@game/shared/hvh/v2';
import { GameRoom } from '../../src/rooms/GameRoom';
import { HvhRoom, hvhEngineFrom, type HvhEngine } from '../../src/rooms/HvhRoom';
import { createRoom } from '../../src/rooms/modes';
import { addPlayer, fakeIo, place, stepRoom } from '../helpers';

const TICK_MS = SIM_DT * 1000;
const IDLE: CommandIntent = { fire: false, choke: false, doubleTap: false, hideShots: false, defensive: false };

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

describe('HvhRoom v2 tick pipeline', () => {
  it('burst is capped at maxProcessTicks', (t) => {
    const { room, a } = duel();
    t.after(() => room.close());
    for (let seq = 1; seq <= 30; seq++) room.handleInput(a, command(seq, {}));
    stepRoom(room, performance.now() + TICK_MS);
    assert.equal(LATE_CSGO.maxProcessTicks, 16);
    assert.equal(a.lastSeq, 16, 'exactly 16 commands executed this tick');
    assert.equal(room.queuedCommands(a.pid), 14, '14 remain queued');
  });

  it('flood drops oldest with verdict', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    for (let seq = 1; seq <= 40; seq++) room.handleInput(a, command(seq, {}));
    const flood = verdicts.filter((v) => v.cause === 'rejected' && v.reason === 'command flood');
    assert.equal(flood.length, 8);
    assert.equal(verdicts.length, 8);
    assert.ok(flood.every((v) => v.shooterId === String(a.pid)));
    assert.equal(room.queuedCommands(a.pid), 32);
    stepRoom(room, performance.now() + TICK_MS);
    assert.equal(a.lastSeq, 8 + 16, 'the 8 oldest were dropped, so execution starts at seq 9');
  });

  it('dt fires two bullets same tick', (t) => {
    const { room, a, verdicts } = duel();
    t.after(() => room.close());
    let now = performance.now();
    let seq = 0;
    for (let i = 0; i < LATE_CSGO.doubleTapShift; i++) {
      room.handleInput(a, command(++seq, {}));
      stepRoom(room, (now += TICK_MS));
    }
    assert.equal(room.tickbaseOf(a.pid)?.bank, LATE_CSGO.doubleTapShift, 'full bank');
    room.handleInput(a, command(++seq, { fire: true, doubleTap: true }));
    stepRoom(room, (now += TICK_MS));
    const shots = verdicts.filter((v) => v.shooterId === String(a.pid) && v.cause !== 'tickbase');
    assert.deepEqual(shots.map((v) => v.bullet), [1, 2]);
    assert.equal(shots[0]!.tick, shots[1]!.tick, 'same server tick');
    assert.equal(shots[0]!.tick, room.hvhTick);
    assert.equal(room.tickbaseOf(a.pid)?.bank, 0);
  });

  it('death cancels pending dt bullet', (t) => {
    const { room, a, b, verdicts } = duel();
    t.after(() => room.close());
    let now = performance.now();
    let seq = 0;
    for (let i = 0; i < LATE_CSGO.doubleTapShift; i++) {
      room.handleInput(a, command(++seq, {}));
      stepRoom(room, (now += TICK_MS));
    }
    room.handleInput(a, command(++seq, { fire: true, doubleTap: true }));
    now += TICK_MS;
    room.processPlayerTick(String(a.pid), now);
    assert.deepEqual(verdicts.filter((v) => v.shooterId === String(a.pid)).map((v) => v.bullet), [1]);
    // B kills A in the same server tick, before bullet 2 is processed.
    room.damage(a, b, 1000, true, b.weapon, room.eyeOf(b), now);
    assert.equal(a.alive, false);
    room.flushPendingBullets(now);
    assert.equal(verdicts.filter((v) => v.shooterId === String(a.pid) && v.bullet === 2).length, 0, 'no bullet-2 verdict');
    room.respawnPlayer(a, now);
    assert.equal(a.alive, true);
    assert.equal(room.tickbaseOf(a.pid)?.bank, 0);
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
    const state = sent.filter((s) => s.event === 'hvhState').at(-1)?.data as { tickbase: { bank: number; ticksSinceShift: number }; era: string; lastAckSeq: number };
    assert.ok(state, 'hvhState sent to the owner');
    assert.equal(state.era, LATE_CSGO.id);
    assert.equal(state.lastAckSeq, 1);
    assert.equal(state.tickbase.bank, 1);
    assert.ok(state.tickbase.ticksSinceShift <= LATE_CSGO.rechargeDelayTicks, 'ticksSinceShift is capped');
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
      room.handleInput(p, { ...command(seq, { fire: true, doubleTap: true, defensive: true, choke: true }), forward: 1 });
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
