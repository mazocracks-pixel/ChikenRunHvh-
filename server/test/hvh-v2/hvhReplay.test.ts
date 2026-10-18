/*
 * Gate (R39): a seeded 5v5 match of 2,000 ticks is bit-identical when replayed through the server
 * (a fresh room, the same seed, the same scripts) and through client prediction (each player's
 * executed command intents through PredictedTickbase, and through the shared stepPose).
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { SIM_DT, createCollisionWorld, defaultHvhLoadout, hopMaxFor, hvhPitch, moveSpeedFor, MAPS, PLAYER, clamp, stepPlayer, type MoveState } from '@game/shared';
import { INITIAL_POSE, LATE_CSGO, stepPose, type PoseState, type ShotVerdict, type TickbaseState } from '@game/shared/hvh/v2';
import { PredictedTickbase } from '../../../client/src/hvh/PredictedTickbase';
import { stepRoom } from '../helpers';
import { CLOCK_BASE, Script, TICK_MS, intentOf, makeMatch, recordTicks, type PlayerTickRecord } from './hvhMatch';

const TICKS = 2_000;
const SEED = 0x5eed13;
const MAP = 'farm' as const;

interface Run {
  /** Per tick, per player (pid order): the state at the end of the server tick. */
  ticks: { tickbase: TickbaseState; pose: PoseState; x: number; y: number; z: number; hp: number; alive: boolean }[][];
  /** Per player: every processPlayerTick call, in order. */
  records: Map<number, PlayerTickRecord[]>;
  verdicts: ShotVerdict[];
  kills: number[];
  /** Per player: the ticks in which the server spawned them (a 'spawn' broadcast); a new life starts next tick. */
  spawns: Map<number, Set<number>>;
}

function runMatch(seed: number): Run {
  const { room, players, events } = makeMatch(seed, { map: MAP });
  try {
    const records = new Map<number, PlayerTickRecord[]>(players.map((p) => [p.pid, []]));
    recordTicks(room, (pid, r) => records.get(pid)!.push(r));
    const verdicts: ShotVerdict[] = [];
    room.addVerdictListener((v) => verdicts.push(structuredClone(v)));
    const scripts = players.map((_, i) => new Script(seed * 31 + i));
    const seqs = players.map(() => 0);
    // Choke commands are held back and leave in one batch with the next sent command (the client's CommandChoker).
    const held: object[][] = players.map(() => []);
    const ticks: Run['ticks'] = [];
    const spawns = new Map<number, Set<number>>(players.map((p) => [p.pid, new Set()]));
    let seen = events.length;
    for (let tick = 1; tick <= TICKS; tick++) {
      const now = CLOCK_BASE + tick * TICK_MS;
      players.forEach((p, i) => {
        if (!p.alive) { held[i]!.length = 0; return; } // the client only sends commands while alive (GameSession)
        const step = scripts[i]!.step(room, p, ++seqs[i]!, now);
        held[i]!.push({ ...step.frame, intent: intentOf(step) });
        if (step.choke) return;
        for (const command of held[i]!.splice(0)) room.handleInput(p, command);
      });
      stepRoom(room, now);
      for (; seen < events.length; seen++) {
        const e = events[seen]!;
        if (e.event === 'spawn') spawns.get((e.args[0] as { pid: number }).pid)!.add(tick);
      }
      ticks.push(players.map((p) => {
        const s = room.v2State(p.pid)!;
        return { tickbase: { ...s.tickbase }, pose: { ...s.pose }, x: p.state.x, y: p.state.y, z: p.state.z, hp: p.hp, alive: p.alive };
      }));
    }
    return { ticks, records, verdicts, kills: players.map((p) => p.info.kills), spawns };
  } finally {
    room.close();
  }
}

const capped = (t: TickbaseState): TickbaseState => ({ ...t, ticksSinceShift: Math.min(t.ticksSinceShift, LATE_CSGO.rechargeDelayTicks) });

describe('HvH v2 determinism gate', () => {
  let first: Run;
  before(() => { first = runMatch(SEED); });

  it('the scripted match exercises every mechanic', () => {
    const intents = [...first.records.values()].flat().flatMap((r) => r.executed.map((c) => c.intent));
    for (const key of ['fire', 'choke', 'doubleTap', 'hideShots', 'defensive'] as const) {
      assert.ok(intents.some((i) => i[key]), `some executed command has intent.${key}`);
    }
    const causes = new Set(first.verdicts.map((v) => v.cause));
    assert.ok(causes.has('hit'), `some shot hit (causes: ${[...causes].join(', ')})`);
    assert.ok(first.verdicts.some((v) => v.bullet === 2), 'some DT bullet 2 fired');
    const recs = [...first.records.values()].flat();
    assert.ok(recs.some((r) => r.executed.length > 1), 'some tick ran a batch of commands (released choke)');
    for (const key of ['doubleTap', 'hideShots', 'defensive'] as const) {
      assert.ok(recs.some((r) => r.executed.at(-1)?.intent[key] && r.tickbaseAfter.ticksSinceShift === 0), `some ${key} shift was granted`);
    }
    assert.ok(first.kills.some((k) => k > 0), 'someone scored a kill');
    const poses = [...first.records.values()].flat().map((r) => r.poseAfter.realSide);
    assert.ok(poses.includes('left') && poses.includes('right') && poses.includes('center'), 'desync sides and no desync all occur');
  });

  it('replay through the server is bit-identical', () => {
    const second = runMatch(SEED);
    assert.equal(second.ticks.length, TICKS);
    for (let t = 0; t < TICKS; t++) assert.deepStrictEqual(second.ticks[t], first.ticks[t], `server tick ${t + 1}`);
    for (const [pid, recs] of first.records) assert.deepStrictEqual(second.records.get(pid), recs, `player ${pid} executed commands`);
    assert.deepStrictEqual(second.verdicts, first.verdicts, 'verdicts');
    assert.deepStrictEqual(second.kills, first.kills, 'kills');
  });

  it('replay through client prediction matches the server every tick', () => {
    const world = createCollisionWorld(MAPS[MAP]);
    let compared = 0;
    for (const [pid, recs] of first.records) {
      let predicted: PredictedTickbase | null = null;
      let pose: PoseState = INITIAL_POSE;
      let wasAlive = false;
      const spawned = first.spawns.get(pid)!;
      recs.forEach((r, i) => {
        const where = `player ${pid}, tick ${i + 1}`;
        if (!r.aliveBefore) { wasAlive = false; return; }
        // A spawn (respawn or a new match) starts a new life, dead or not before it.
        if (!wasAlive || spawned.has(i)) {
          // A new life: the client starts from the server's spawn tickbase (its first hvhState) and the initial pose.
          predicted = new PredictedTickbase(LATE_CSGO, r.tickbaseBefore);
          pose = INITIAL_POSE;
          assert.deepStrictEqual(r.poseBefore, pose, `${where}: a life starts at the initial pose`);
        }
        wasAlive = true;
        const tb = predicted!;
        // Movement is reconciled to the authoritative state (LocalPlayer); pose is predicted from it.
        const move: MoveState = structuredClone(r.stateBefore);
        for (const c of r.executed) {
          tb.apply(c.frame.seq, c.intent);
          stepPlayer(move, c.frame, SIM_DT, world, null, hopMaxFor(r.weapon), moveSpeedFor(r.weapon), true);
          const motion = {
            speedFraction: clamp(move.horizontalSpeed / (PLAYER.speed * moveSpeedFor(r.weapon)), 0, 1),
            duck: move.crouchAmount ?? (move.crouching ? 1 : 0),
            onGround: move.onGround,
          };
          const aa = r.antiAim;
          pose = {
            ...stepPose(pose, c.frame.yaw, { base: aa.mode, jitterDeg: aa.jitter, desyncDeg: aa.desync, inverted: c.frame.invert === true }, motion, tb.state.tickbase, LATE_CSGO),
            pitch: hvhPitch(c.frame.pitch, { ...defaultHvhLoadout(), antiAim: aa }),
          };
        }
        assert.deepStrictEqual(capped(tb.state), capped(r.tickbaseAfter), `${where}: TickbaseState`);
        assert.deepStrictEqual(pose, r.poseAfter, `${where}: PoseState`);
        compared++;
      });
    }
    assert.ok(compared > TICKS * 5, `compared ${compared} player ticks`);
  });
});
