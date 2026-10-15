import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { BACKROOMS_MODE, CLASSIC_MONKEY_EVERY, CLASSIC_MONKEY_SKIN, MODES, SIM_DT, SMALL_TEST } from '@game/shared';
import { createRoom } from '../src/rooms/modes';
import type { ZombieRoom } from '../src/rooms/ZombieRoom';
import { addPlayer, fakeIo } from './helpers';

const STEP = SIM_DT * 1000;
const realNow = performance.now.bind(performance);
let clock = realNow();
performance.now = () => clock;
after(() => {
  performance.now = realNow;
});

type Hunt = { zone: { minX: number; maxX: number; minZ: number; maxZ: number; exit: { x: number; z: number } }; state(full?: boolean): { crystals?: { x: number; z: number; red?: boolean }[]; total: number } };

function setup() {
  const { io, events } = fakeIo();
  const room = createRoom(io, { id: 'b', code: 'BACKR', name: 'B', mode: 'backrooms', map: 'night', private: true, bots: 0 }, {}) as ZombieRoom;
  clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
  const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
  let now = clock;
  const run = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = clock = Math.min(end, now + STEP);
      for (const p of room.players.values()) p.takeInputToken = () => true;
      update(now);
    }
  };
  const me = addPlayer(room, 'Lost', 3);
  room.startNow();
  const priv = room as unknown as { zphase: string; hunt: Hunt | null; result: { success: boolean; crystals: number } | null; zombies: Map<number, { kind: string; p: { info: { appearance: { skin: string } } } }> };
  return { room, events, me, run, priv, now: () => now };
}

describe('The Backrooms (game mode)', () => {
  it('is its own co-op PvE mode in the menu list, on the night map or Mirage with the event level', () => {
    const m = MODES.backrooms;
    assert.equal(m.huntOnly, 'backrooms');
    assert.equal(m.pve, true);
    assert.equal(m.maxHumans, 4);
    assert.deepEqual(m.maps, ['night', 'mirage']);
  });

  it('starts inside the Backrooms with the hunt on: no waves, the entrance is where you appear', () => {
    const t = setup();
    try {
      t.run(100);
      assert.equal(t.priv.zphase, 'event');
      const h = t.priv.hunt!;
      const z = h.zone;
      assert.ok(t.me.state.x > z.minX && t.me.state.x < z.maxX && t.me.state.z > z.minZ && t.me.state.z < z.maxZ, 'in the maze');
      assert.ok([...t.priv.zombies.values()].every((zz) => zz.kind === 'monkey'), 'only monkeys');
    } finally {
      t.room.close();
    }
  });

  it('some monkeys keep the first design (their skin says so)', () => {
    const t = setup();
    try {
      t.run(100);
      const skins = [...t.priv.zombies.values()].map((z) => z.p.info.appearance.skin);
      const classic = skins.filter((s) => s === CLASSIC_MONKEY_SKIN).length;
      assert.ok(classic >= Math.floor(skins.length / CLASSIC_MONKEY_EVERY) - 1 && classic < skins.length, `${classic} of ${skins.length}`);
    } finally {
      t.room.close();
    }
  });

  it('escaping ends the run: the result, the coins, and the match is over (Restart plays again)', () => {
    const t = setup();
    try {
      (t.me as { userId: number | null }).userId = 3;
      t.me.shieldUntil = Infinity;
      // A quick run: the dev small variant.
      (t.room as unknown as { devSetWave(w: number, v: string): void }).devSetWave(7, 'small');
      t.run(3200);
      t.me.shieldUntil = Infinity;
      const h = t.priv.hunt!;
      assert.equal(h.state().total, SMALL_TEST.crystals);
      for (const c of h.state(true).crystals!.filter((c) => !c.red)) {
        t.me.state.x = c.x;
        t.me.state.z = c.z;
        t.run(50);
      }
      t.me.state.x = h.zone.exit.x;
      t.me.state.z = h.zone.exit.z;
      t.run(100);
      assert.equal(t.priv.zphase, 'over');
      assert.equal(t.priv.result?.success, true);
      assert.equal(t.priv.result?.crystals, SMALL_TEST.crystals);
      const coins = (t.room as unknown as { matchCoins(p: unknown): number }).matchCoins(t.me);
      assert.equal(coins, SMALL_TEST.crystals * BACKROOMS_MODE.coinsPerCrystal + BACKROOMS_MODE.escapeBonus);
      assert.equal((t.room as unknown as { match: { phase: string } }).match.phase, 'ended');
      t.room.handleZombieRestart(t.me);
      t.run(100);
      assert.equal(t.priv.zphase, 'event', 'a new run');
      assert.equal(t.priv.result, null);
    } finally {
      t.room.close();
    }
  });

  it('time running out (or everyone down) is the end too: lost', () => {
    const t = setup();
    try {
      (t.room as unknown as { devSetWave(w: number, v: string): void }).devSetWave(7, 'small');
      t.run(3200);
      t.me.shieldUntil = Infinity;
      t.run(SMALL_TEST.timeMs + 500);
      assert.equal(t.priv.zphase, 'over');
      assert.equal(t.priv.result?.success, false);
    } finally {
      t.room.close();
    }
  });
});
