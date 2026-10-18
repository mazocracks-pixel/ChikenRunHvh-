/*
 * Gate (R39): client tickbase prediction holds up on bad networks. The seeded 5v5 match runs with
 * the real NetworkSimulator between each client's emit path and the room, under every latency /
 * jitter / loss configuration the codebase defines, and reconciles on hvhState. Per player:
 * no uncaught errors and PredictedTickbase.mismatches / ticks < 0.01.
 *
 * GameSession (three.js, DOM, sockets) is too heavy to run headless, so its HvH emit and reconcile
 * path (GameSession.ts tick loop and markShot / fire, LocalPlayer.command / emitted / onHvhState)
 * is replayed with the same exported pieces, unmodified:
 *   shared  fakeLagTicks, CommandChoker (wouldHold / push), NetworkSimulator (send / receive), LATE_CSGO.maxChoke
 *   client  commandIntent, shotReference, TickClock, PredictedTickbase (apply on emit, reconcile on hvhState)
 * The only glue written here is the wiring between them, in GameSession's order.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CommandChoker, INTERP_DELAY_MS, NetworkSimulator, defaultHvhCore, exploitMode, fakeLagTicks, WEAPONS,
  type HvhStateEvent, type InputCommand, type NetworkConfig,
} from '@game/shared';
import { LATE_CSGO } from '@game/shared/hvh/v2';
import { PredictedTickbase, TickClock, commandIntent, shotReference } from '../../../client/src/hvh/PredictedTickbase';
import { stepRoom } from '../helpers';
import { CLOCK_BASE, Script, TICK_MS, makeMatch } from './hvhMatch';

const TICKS = 2_000;
const SEED = 0x5eed13;

/**
 * Every latency / jitter / loss configuration defined in the codebase (there is no named profile
 * table): the default practice connection (defaultHvhCore), the HvH benchmark's link
 * (server/src/tools/hvhBenchmark.ts), the NetworkSimulator unit test's link (shared/test/hvh-core.test.ts),
 * and the panel maxima sanitizeHvhLoadout allows (latency 150, jitter 50, loss 0.1).
 */
const core = defaultHvhCore();
const PROFILES: Record<string, NetworkConfig> = {
  'default (off)': { latencyMs: core.latencyMs, jitterMs: core.jitterMs, loss: core.packetLoss },
  'benchmark 35/12/2%': { latencyMs: 35, jitterMs: 12, loss: 0.02 },
  'unit test 50/0/0%': { latencyMs: 50, jitterMs: 0, loss: 0 },
  'panel max 150/50/10%': { latencyMs: 150, jitterMs: 50, loss: 0.1 },
};

interface Client {
  choker: CommandChoker;
  network: NetworkSimulator<readonly InputCommand[]>;
  tickbase: PredictedTickbase;
  clock: TickClock;
  hvhV2: boolean;
  nextSeq: number;
  shotSeq: number;
  shotCommand: number | null;
  /** Server ack from the last hvhState (the snapshot ack in GameSession). */
  ack: number;
  read: number;
  reconciles: number;
}

function runProfile(config: NetworkConfig) {
  const { room, players, sent } = makeMatch(SEED, { sockets: true });
  try {
    const scripts = players.map((_, i) => new Script(SEED * 31 + i));
    const clients: Client[] = players.map((p) => ({
      choker: new CommandChoker(), network: new NetworkSimulator(config, p.pid), tickbase: new PredictedTickbase(), clock: new TickClock(),
      hvhV2: false, nextSeq: 1, shotSeq: 0, shotCommand: null, ack: 0, read: 0, reconciles: 0,
    }));
    let sentCommands = 0;
    let executed = 0;
    for (let tick = 1; tick <= TICKS; tick++) {
      const now = CLOCK_BASE + tick * TICK_MS;
      players.forEach((p, i) => {
        const c = clients[i]!;
        // Socket events since the last frame (GameSession.bindNetwork: hvhState -> TickClock, LocalPlayer.onHvhState).
        const sink = sent.get(p.pid)!;
        for (; c.read < sink.length; c.read++) {
          const e = sink[c.read]!;
          if (e.event !== 'hvhState') continue;
          const state = e.data as HvhStateEvent;
          c.clock.sample(state.tick, now);
          c.hvhV2 = true;
          c.ack = state.lastAckSeq;
          c.tickbase.reconcile(state.tickbase, state.lastAckSeq);
          c.reconciles++;
        }
        if (p.alive) {
          // One fixed step of GameSession's tick loop.
          const seq = c.nextSeq;
          const step = scripts[i]!.step(room, p, seq, now);
          const def = WEAPONS[p.weapon];
          if (step.fire) {
            // GameSession.fire / markShot: the fire message leaves at once (not through the simulated link).
            const ref = shotReference(c.hvhV2 && !def.melee && !def.projectile, c.nextSeq, c.ack);
            c.shotCommand = ref.shotSeq;
            if (ref.shotSeq !== null) c.tickbase.shot(ref.shotSeq);
            const dir = { x: -Math.sin(step.frame.yaw) * Math.cos(step.frame.pitch), y: Math.sin(step.frame.pitch), z: -Math.cos(step.frame.yaw) * Math.cos(step.frame.pitch) };
            room.handleFire(p, { shot: ++c.shotSeq, weapon: p.weapon, dx: dir.x, dy: dir.y, dz: dir.z, t: now - INTERP_DELAY_MS, command: ref.command, aiming: false });
          }
          const frame = { ...step.frame, seq: c.nextSeq++ };
          const hvh = { ...core, fakeLag: step.fakeLag };
          const maxChoke = c.hvhV2 ? LATE_CSGO.maxChoke : undefined;
          const choke = fakeLagTicks(hvh, frame.seq, p.state.horizontalSpeed, step.fire, maxChoke);
          const flush = hvh.fakeLagBreakOnShot && step.fire;
          const intent = commandIntent({
            seq: frame.seq, shotSeq: c.shotCommand, hitscan: !def.melee && !def.projectile,
            held: c.choker.wouldHold(choke, flush, maxChoke),
            exploit: exploitMode(step.exploit, def, p.mag),
            defensive: c.hvhV2 && step.defensive,
          });
          const command: InputCommand = { ...frame, intent, clientTick: c.clock.viewedTick(now - INTERP_DELAY_MS) };
          const batch = c.choker.push(command, choke, flush, maxChoke);
          if (batch.length) c.network.send(batch, now);
        }
        // After the loop: whatever the simulated link delivers now goes out (LocalPlayer.emitted).
        for (const batch of c.network.receive(now)) {
          for (const cmd of batch) {
            if (c.hvhV2 && cmd.intent) c.tickbase.apply(cmd.seq, cmd.intent);
            room.handleInput(p, cmd);
            sentCommands++;
          }
        }
      });
      stepRoom(room, now);
      for (const p of players) executed += room.v2State(p.pid)!.executed;
    }
    return { players, clients, sentCommands, executed, issued: clients.reduce((n, c) => n + c.nextSeq - 1, 0) };
  } finally {
    room.close();
  }
}

describe('HvH v2 network gate', () => {
  for (const [name, config] of Object.entries(PROFILES)) {
    it(`prediction holds under ${name}`, () => {
      const run = runProfile(config);
      if (config.loss > 0) assert.ok(run.sentCommands < run.issued, `${name}: some commands were lost (${run.sentCommands} of ${run.issued} arrived)`);
      assert.ok(run.executed > TICKS * 5, `${name}: the room executed ${run.executed} commands`);
      const ratios = run.players.map((p, i) => {
        const c = run.clients[i]!;
        assert.ok(c.reconciles > TICKS / 10, `${name}: player ${p.pid} reconciled ${c.reconciles} times`);
        return c.tickbase.mismatches / TICKS;
      });
      console.log(`[hvhNetwork] ${name}: mismatches/ticks per player ${ratios.map((r) => r.toFixed(4)).join(' ')}`);
      ratios.forEach((r, i) => assert.ok(r < 0.01, `${name}: player ${run.players[i]!.pid} mismatches / ticks = ${r}`));
    });
  }
});
