import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { CRYSTAL_HUNT, MAPS, MODES, PLAYER, SIM_DT, ZOMBIE, bossNumber, buildNavGraph, createCollisionWorld, isBloodMoon, isBossWave, reachableCount, upgradeMultiplier, waveCount, waveKinds, zombieStats } from '@game/shared';
import type { GameRoom } from '../src/rooms/GameRoom';
import { createRoom } from '../src/rooms/modes';
import type { ZombieRoom } from '../src/rooms/ZombieRoom';
import { addPlayer, fakeIo } from './helpers';

const STEP = SIM_DT * 1000;

/** One clock for everything: the rooms use performance.now(), the tests move it by hand. */
const realNow = performance.now.bind(performance);
let clock = realNow();
performance.now = () => clock;
after(() => {
  performance.now = realNow;
});

/** A zombie room with a manual clock: `run(ms)` plays that much time. */
function setup() {
  const { io, events } = fakeIo();
  const room = createRoom(io, { id: 'z', code: 'ZOMBI', name: 'Z', mode: 'zombie', map: 'night', private: true, bots: 0 }, {}) as ZombieRoom;
  clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
  const update = (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate.bind(room);
  let now = clock;
  const run = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now = clock = Math.min(end, now + STEP);
      // Time runs faster than real here, so the per-player input rate limit would starve everyone.
      for (const p of room.players.values()) p.takeInputToken = () => true;
      update(now);
    }
  };
  const me = addPlayer(room, 'Survivor');
  room.startNow();
  const priv = room as unknown as {
    zphase: string;
    wave: number;
    kills: number;
    queue: unknown[];
    zombies: Map<number, { p: import('../src/rooms/ServerPlayer').ServerPlayer; kind: string; maxHp: number; stats: { reward: number } }>;
    blocks: Map<number, unknown>;
    upgrades: Map<number, Record<string, number>>;
    match: { phase: string };
  };
  const zombies = () => [...priv.zombies.values()];
  /** Kills every zombie right now, the way a survivor would. */
  const killAll = () => {
    for (const z of zombies()) if (z.p.alive) room.damage(z.p, me, 100000, false, 'rifle', { x: 0, y: 0, z: 0 }, now);
  };
  return { room, events, me, run, priv, zombies, killAll, now: () => now };
}

describe('Zombie Apocalypse rules', () => {
  it('waves grow, bosses come every fifth wave, and zombies get stronger', () => {
    assert.equal(waveCount(1), 6);
    for (let w = 2; w <= 20; w++) assert.ok(waveCount(w) >= waveCount(w - 1), 'waves never shrink');
    assert.ok(waveCount(999) <= ZOMBIE.count.cap);
    assert.equal(isBossWave(4), false);
    assert.equal(isBossWave(5), true);
    assert.equal(bossNumber(10), 2);
    assert.equal(waveKinds(5).filter((k) => k === 'boss').length, 1);
    assert.equal(waveKinds(4).includes('boss'), false);
    assert.equal(waveKinds(1).every((k) => k === 'walker'), true, 'wave 1 is walkers only');
    assert.ok(waveKinds(2).includes('sprinter'), 'sprinters from wave 2');
    assert.ok(waveKinds(3).includes('runner'), 'runners from wave 3');
    assert.ok(waveKinds(5).includes('brute'), 'brutes from wave 5');
    const a = zombieStats('walker', 1);
    const b = zombieStats('walker', 10);
    assert.ok(b.hp > a.hp && b.speed > a.speed && b.damage > a.damage && b.attackMs < a.attackMs);
    assert.ok(zombieStats('boss', 10).hp > zombieStats('boss', 5).hp, 'each boss is tougher');
    assert.ok(zombieStats('walker', 99).speed <= ZOMBIE.perWave.speedCap);
    assert.equal(upgradeMultiplier(0), 1);
    assert.ok(upgradeMultiplier(5) > upgradeMultiplier(1));
  });

  it('the mode is a team of survivors with a cap, on its own night map, with no bots', () => {
    assert.equal(MODES.zombie.zombies, true);
    assert.equal(MODES.zombie.noBots, true);
    assert.equal(MODES.zombie.maxHumans, ZOMBIE.maxHumans);
    assert.deepEqual(MODES.zombie.maps, ['night']);
  });
});

describe('Zombie Apocalypse match', () => {
  it('starts with a 10 second countdown, then wave 1 sends zombies at the survivors', () => {
    const t = setup();
    assert.equal(t.priv.zphase, 'prep');
    assert.equal(t.priv.wave, 1);
    assert.equal(t.me.money, ZOMBIE.startMoney);
    t.run(ZOMBIE.prepMs - 500);
    assert.equal(t.priv.zphase, 'prep');
    assert.equal(t.zombies().length, 0);
    t.run(700);
    assert.equal(t.priv.zphase, 'wave');
    t.run(3000);
    const zs = t.zombies();
    assert.ok(zs.length >= 5, `zombies are coming (${zs.length})`);
    for (const z of zs) {
      assert.equal(z.p.info.team, 2);
      assert.equal(z.p.info.undead, 'walker');
      assert.equal(z.p.info.bot, true);
    }
    assert.equal(t.me.info.team, 1);
    t.room.close();
  });

  it('a zombie’s health bar is its share of its real health, and guns can be upgraded', () => {
    const t = setup();
    t.run(ZOMBIE.prepMs + 2500);
    const z = t.zombies()[0]!;
    assert.equal(z.maxHp, zombieStats('walker', 1).hp);
    // 30 damage of a 60 health zombie: half way.
    t.room.damage(z.p, t.me, 30, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
    assert.equal(Math.round(z.p.hp), 50);
    // Level 2 upgrade: 1.5× damage.
    t.priv.upgrades.set(t.me.pid, { rifle: 2 });
    const z2 = t.zombies()[1]!;
    t.room.damage(z2.p, t.me, 10, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
    assert.equal(Math.round(z2.p.hp), Math.round(100 - ((10 * upgradeMultiplier(2)) * 100) / z2.maxHp));
    t.room.close();
  });

  it('no friendly fire, and zombies do not hurt each other', () => {
    const t = setup();
    const mate = addPlayer(t.room, 'Mate');
    t.run(ZOMBIE.prepMs + 2500);
    const [a, b] = t.zombies();
    t.room.damage(mate, t.me, 50, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
    assert.equal(mate.hp, 100, 'survivors can’t shoot each other');
    t.room.damage(b!.p, a!.p, 50, false, 'knife', { x: 0, y: 0, z: 0 }, t.now());
    assert.equal(b!.p.hp, 100, 'zombies can’t hurt zombies');
    t.room.close();
  });

  it('clearing a wave pays money, opens a 10 second shop, and the next wave is bigger', () => {
    const t = setup();
    t.run(ZOMBIE.prepMs + 1000);
    // Wave 1 in full: let all of it spawn, kill as they come.
    for (let i = 0; i < 40 && t.priv.zphase === 'wave'; i++) {
      t.run(500);
      t.killAll();
    }
    t.run(100);
    assert.equal(t.priv.zphase, 'prep', 'wave 1 cleared');
    assert.equal(t.priv.wave, 2);
    assert.ok(t.me.money > ZOMBIE.startMoney, 'kill money and the wave bonus');
    assert.equal(t.priv.kills, 6);

    // The shop works now: first aid heals, a gun upgrade costs money, and it is closed during waves.
    const before = t.me.money;
    t.me.hp = 20;
    const heal = t.room.handleBuy(t.me, 'heal-50');
    assert.equal(heal.ok, true);
    assert.equal(t.me.hp, 70);
    assert.equal(t.me.money, before - 50);
    t.me.money = 1000;
    const weapon = t.room.handleBuy(t.me, 'weapon-smg');
    assert.equal(weapon.ok, true);
    assert.ok(t.me.info.loadout.includes('smg'));
    assert.equal(t.room.handleBuy(t.me, 'weapon-smg').ok, false, 'already owned');
    assert.equal(t.room.handleBuy(t.me, 'upgrade').ok, true, 'upgrades the gun in your hands');
    assert.equal(t.priv.upgrades.get(t.me.pid)?.smg, 1);
    t.me.money = 1;
    assert.equal(t.room.handleBuy(t.me, 'armor').ok, false, 'too poor');
    assert.equal(t.room.handleBuy(t.me, 'nonsense').ok, false);

    t.run(ZOMBIE.prepMs + 500);
    assert.equal(t.priv.zphase, 'wave');
    assert.equal(t.room.handleBuy(t.me, 'heal-full').ok, false, 'the shop is closed during a wave');
    assert.equal(t.priv.queue.length + t.zombies().length, waveCount(2), 'wave 2 is bigger');
    t.room.close();
  });

  it('zombies chase the survivor and hit them', () => {
    const t = setup();
    try {
      t.run(ZOMBIE.prepMs);
      // (They may even finish you off and the game restarts: watch the lowest health.)
      let lowest = t.me.hp;
      let nearest = Infinity;
      for (let i = 0; i < 100; i++) {
        t.run(500);
        lowest = Math.min(lowest, t.me.hp);
        for (const z of t.zombies()) nearest = Math.min(nearest, Math.hypot(z.p.state.x - t.me.state.x, z.p.state.z - t.me.state.z));
      }
      assert.ok(nearest < 3, `they come all the way to you (nearest ${nearest.toFixed(1)} m)`);
      assert.ok(lowest < 100, `they hurt you (lowest hp ${lowest})`);
    } finally {
      t.room.close();
    }
  });

  it('the graveyard is big and connected; zombies spawn all over it, never close to a survivor', () => {
    const map = MAPS.night;
    assert.ok(map.halfSize >= 88, 'at least twice the old 44 m');
    const graph = buildNavGraph(map.nav!, createCollisionWorld(map));
    const main = map.nav!.filter((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) < 88).length;
    assert.equal(reachableCount(graph), main, 'every waypoint of the graveyard (indoors too) reaches every other');
    const t = setup();
    try {
      const spawn = (t.room as unknown as { zombieSpawn(): { x: number; z: number } }).zombieSpawn.bind(t.room);
      for (const [x, z] of [[0, 8], [64, -66], [-60, 44.5], [66, 66]] as const) {
        t.me.state.x = x;
        t.me.state.z = z;
        const spots = Array.from({ length: 300 }, spawn);
        const dists = spots.map((s) => Math.hypot(s.x - x, s.z - z));
        assert.ok(Math.min(...dists) >= ZOMBIE.spawnMinDistance - 1.2, `never right next to you at ${x},${z} (nearest ${Math.min(...dists).toFixed(1)} m)`);
        assert.ok(Math.max(...dists) <= ZOMBIE.spawnMaxDistance + 1.2, `not miles away either at ${x},${z} (farthest ${Math.max(...dists).toFixed(1)} m)`);
        const sides = new Set(spots.map((s) => `${Math.sign(s.x - x)}${Math.sign(s.z - z)}`));
        assert.ok(sides.size >= 3, `from several directions at ${x},${z}`);
      }
      // Nobody standing (respawning): still round the survivors' spawn, not anywhere on the map.
      t.me.alive = false;
      assert.ok(Math.max(...Array.from({ length: 300 }, spawn).map((s) => Math.hypot(s.x, s.z))) < ZOMBIE.spawnMaxDistance + 11);
      t.me.alive = true;
      // From the middle, they come from beyond the cemetery wall too.
      t.me.state.x = 0;
      t.me.state.z = 8;
      assert.ok(Array.from({ length: 300 }, spawn).some((s) => Math.max(Math.abs(s.x), Math.abs(s.z)) > 44));
    } finally {
      t.room.close();
    }
  });

  it('a zombie from the far side of the map finds a survivor hiding in the barn', () => {
    const t = setup();
    try {
      t.run(ZOMBIE.prepMs + 500);
      t.priv.queue.length = 0;
      const [hunter, ...rest] = t.zombies();
      for (const z of rest) t.room.damage(z.p, t.me, 100000, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
      t.run(ZOMBIE.corpseMs + 200);
      hunter!.p.state.x = -64;
      hunter!.p.state.z = 44.5;
      t.me.state.x = 64;
      t.me.state.z = -66;
      let nearest = Infinity;
      for (let i = 0; i < 240 && nearest > 3; i++) {
        t.run(500);
        t.me.hp = 100;
        nearest = Math.hypot(hunter!.p.state.x - t.me.state.x, hunter!.p.state.z - t.me.state.z);
      }
      assert.ok(nearest <= 3, `it got all the way into the barn (still ${nearest.toFixed(1)} m away)`);
    } finally {
      t.room.close();
    }
  });

  it('sprinters walk slowly, then sprint in short bursts', () => {
    const t = setup();
    try {
      t.priv.wave = 2;
      const spawnZombie = (t.room as unknown as { spawnZombie(kind: string, now: number, near?: { x: number; y: number; z: number }): unknown }).spawnZombie.bind(t.room);
      t.run(ZOMBIE.prepMs + 100);
      spawnZombie('sprinter', t.now(), { x: 0, y: 0, z: 22 });
      const s = t.zombies().find((z) => z.kind === 'sprinter')!;
      assert.equal(s.p.info.name, '🧟 Sprinter');
      const speeds = new Set<number>();
      for (let i = 0; i < 80; i++) {
        t.run(100);
        t.me.hp = 100;
        speeds.add(s.p.mods!.speed);
      }
      assert.ok(speeds.has(ZOMBIE.sprint.speed), 'it bursts');
      assert.ok([...speeds].some((v) => v < 0.6), 'and slows down again');
    } finally {
      t.room.close();
    }
  });

  it('a shot zombie staggers (longer after a headshot) and everyone sees it flinch', () => {
    const t = setup();
    try {
      t.run(ZOMBIE.prepMs + 1500);
      const z = t.zombies()[0] as unknown as { p: import('../src/rooms/ServerPlayer').ServerPlayer; staggerUntil: number };
      const before = t.events.length;
      t.room.damage(z.p, t.me, 1, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
      const body = z.staggerUntil - t.now();
      assert.ok(body > 0, 'it reels');
      t.run(1000);
      t.room.damage(z.p, t.me, 1, true, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
      assert.ok(z.staggerUntil - t.now() > body, 'a headshot rocks it longer');
      assert.ok(t.events.slice(before).some((e) => e.event === 'zombieHit'), 'flinch sent to the room');
    } finally {
      t.room.close();
    }
  });

  it('zombies close in from different sides, and hunters go for the survivor left alone', () => {
    const t = setup();
    try {
      const mate = addPlayer(t.room, 'Camper');
      t.run(ZOMBIE.prepMs + 4000);
      const zs = t.zombies() as unknown as { side: number; hunter: boolean; targetPid: number }[];
      assert.ok(new Set(zs.map((z) => z.side.toFixed(2))).size >= Math.min(5, zs.length), 'each has its own side');
      // Everyone near the first survivor; the mate camps far away.
      t.me.state.x = 0;
      t.me.state.z = 8;
      mate.state.x = 60;
      mate.state.z = 60;
      for (const z of t.zombies()) {
        z.p.state.x = (Math.random() - 0.5) * 6;
        z.p.state.z = 14 + Math.random() * 4;
      }
      for (const z of zs) z.hunter = true;
      t.run(600);
      assert.ok(zs.every((z) => z.targetPid === mate.pid), 'hunters go after the one nobody is chasing');
    } finally {
      t.room.close();
    }
  });

  it('pays coins per kill, per wave cleared and for the boss, at game over', () => {
    const t = setup();
    try {
      (t.me as { userId: number | null }).userId = 7;
      const paid: number[] = [];
      (t.room as unknown as { hooks: { onMatchEnd: (r: unknown, res: { coins: number }[]) => Map<number, unknown> } }).hooks.onMatchEnd = (_r, res) => {
        paid.push(...res.map((x) => x.coins));
        return new Map();
      };
      t.run(ZOMBIE.prepMs + 1000);
      for (let i = 0; i < 40 && t.priv.zphase === 'wave'; i++) {
        t.run(500);
        t.killAll();
      }
      t.run(100);
      assert.equal(t.priv.zphase, 'prep');
      // Wave 2: let the zombies win.
      t.run(ZOMBIE.prepMs + 500);
      t.room.damage(t.me, null, 1000, false, 'world', { x: 0, y: 0, z: 0 }, t.now());
      t.run(200);
      const expected = 6 * ZOMBIE.coins.perKill.walker + ZOMBIE.coins.wave.base + ZOMBIE.coins.wave.perWave;
      assert.deepEqual(paid, [expected]);
    } finally {
      t.room.close();
    }
  });

  it('Blood Moon: waves 3, 7, 11... (never a boss wave), faster tougher zombies, double coins', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 15].filter(isBloodMoon), [3, 7, 11]);
    for (let w = 1; w < 60; w++) if (isBloodMoon(w)) assert.equal(isBossWave(w), false);
    const t = setup();
    try {
      t.priv.wave = 3;
      t.run(ZOMBIE.prepMs + 1500);
      const state = (t.room as unknown as { publicState(): { bloodMoon: boolean } }).publicState();
      assert.equal(state.bloodMoon, true, 'everyone is told');
      const z = t.zombies()[0] as unknown as { stats: { speed: number; hp: number }; kind: 'walker' };
      assert.ok(Math.abs(z.stats.speed - zombieStats('walker', 3).speed * ZOMBIE.bloodMoon.speed) < 1e-9, 'faster');
      assert.ok(z.stats.hp > zombieStats('walker', 3).hp, 'tougher');
      (t.me as { userId: number | null }).userId = 9;
      const earn = (t.room as unknown as { earn(p: unknown, c: number): void; coins: Map<number, number> });
      earn.earn(t.me, 5);
      assert.equal(earn.coins.get(t.me.pid), 5 * ZOMBIE.bloodMoon.coins, 'double coins');
    } finally {
      t.room.close();
    }
  });

  it('power-ups: bosses always drop one; Nuke, Max Ammo, Insta-Kill and First Aid work for everyone', () => {
    const t = setup();
    try {
      const mate = addPlayer(t.room, 'Mate');
      t.run(ZOMBIE.prepMs + 3000);
      const zs = t.zombies().filter((z) => z.p.alive);
      assert.ok(zs.length >= 3);
      // Max Ammo: empty guns and no eggs, then full.
      t.me.mags.set('pistol', 0);
      mate.eggs = 0;
      t.room.applyPowerUp('maxAmmo', t.me, t.now());
      assert.equal(t.me.mags.get('pistol'), t.me.magazineSize('pistol'));
      assert.equal(mate.eggs, PLAYER.maxEggs, 'the whole team');
      // First Aid.
      t.me.hp = 10;
      mate.hp = 40;
      t.room.applyPowerUp('firstAid', mate, t.now());
      assert.equal(t.me.hp, PLAYER.maxHealth);
      assert.equal(mate.hp, PLAYER.maxHealth);
      // Insta-Kill: one hit kills.
      t.room.applyPowerUp('instaKill', t.me, t.now());
      t.room.damage(zs[0]!.p, mate, 1, false, 'pistol', { x: 0, y: 0, z: 0 }, t.now());
      assert.equal(zs[0]!.p.alive, false, 'one pistol hit');
      assert.ok((t.room as unknown as { publicState(): { instaKillUntil: number | null } }).publicState().instaKillUntil !== null, 'the HUD is told');
      // Nuke: every zombie dead (no extra drops from its own kills).
      const dropsBefore = t.events.filter((e) => e.event === 'drop').length;
      t.room.applyPowerUp('nuke', t.me, t.now());
      assert.equal(t.zombies().filter((z) => z.p.alive).length, 0);
      assert.equal(t.events.filter((e) => e.event === 'drop').length, dropsBefore, 'the Nuke drops nothing');
      assert.ok(t.events.some((e) => e.event === 'zombiePower'));
    } finally {
      t.room.close();
    }
  });

  it('a power-up on the ground is picked up by walking over it', () => {
    const t = setup();
    try {
      t.run(ZOMBIE.prepMs + 500);
      t.me.hp = 20;
      t.room.loot.dropAt({ x: t.me.state.x, y: 0, z: t.me.state.z }, 'firstAid', t.now(), 5000);
      t.run(100);
      assert.equal(t.me.hp, PLAYER.maxHealth);
    } finally {
      t.room.close();
    }
  });

  it('Exploder: lights its fuse next to you and bursts; shot first, its blast hurts the zombies instead', () => {
    const t = setup();
    try {
      t.priv.wave = 4;
      const spawnZombie = (t.room as unknown as { spawnZombie(kind: string, now: number, near?: { x: number; y: number; z: number }): unknown }).spawnZombie.bind(t.room);
      assert.ok(waveKinds(4).includes('exploder'), 'from wave 4');
      t.run(ZOMBIE.prepMs + 100);
      // Keep the wave going (one zombie still to come that never does), with nobody else about.
      t.priv.queue.length = 0;
      t.priv.queue.push('walker');
      (t.room as unknown as { nextSpawnAt: number }).nextSpawnAt = Infinity;
      for (const z of t.zombies()) t.room.damage(z.p, t.me, 1e6, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
      t.run(ZOMBIE.corpseMs + 200);
      // 1. It reaches you and bursts.
      spawnZombie('exploder', t.now(), { x: t.me.state.x, y: 0, z: t.me.state.z + 6 });
      const e = t.zombies().find((z) => z.kind === 'exploder')!;
      let fused = false;
      for (let i = 0; i < 60 && e.p.alive; i++) {
        t.run(100);
        fused ||= t.events.some((ev) => ev.event === 'zombieFuse');
      }
      assert.ok(fused, 'everyone hears the fuse');
      assert.equal(e.p.alive, false, 'it burst');
      assert.ok(t.me.hp < 100, `the blast hurt you (hp ${t.me.hp})`);
      // 2. Shot dead first, next to a walker: the walker gets hurt, you don't.
      t.me.hp = 100;
      t.run(ZOMBIE.corpseMs + 200);
      spawnZombie('exploder', t.now(), { x: t.me.state.x + 20, y: 0, z: t.me.state.z });
      spawnZombie('walker', t.now(), { x: t.me.state.x + 20, y: 0, z: t.me.state.z });
      const ex = t.zombies().find((z) => z.kind === 'exploder' && z.p.alive)!;
      const walker = t.zombies().find((z) => z.kind === 'walker' && z.p.alive)!;
      walker.p.state.x = ex.p.state.x + 1;
      walker.p.state.z = ex.p.state.z;
      t.room.damage(ex.p, t.me, 1e6, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
      assert.ok(walker.p.hp < 100 || !walker.p.alive, 'the walker took the blast');
      assert.equal(t.me.hp, 100, 'you were far away');
    } finally {
      t.room.close();
    }
  });

  describe('story events (Crystal Hunt)', () => {
    type Hunt = { zone: { id: string; minX: number; maxX: number; minZ: number; maxZ: number; exit: { x: number; z: number } }; state(): { crystals: { x: number; z: number }[]; portal: unknown; total: number }; result: unknown } | null;
    const hunt = (t: ReturnType<typeof setup>) => (t.room as unknown as { hunt: Hunt }).hunt;
    const inside = (h: NonNullable<Hunt>, x: number, z: number) => x > h.zone.minX && x < h.zone.maxX && z > h.zone.minZ && z < h.zone.maxZ;
    const toWave = (t: ReturnType<typeof setup>, wave: number) => {
      t.run(ZOMBIE.prepMs + 100);
      (t.room as unknown as { devSetWave(w: number): void }).devSetWave(wave);
      t.run(3200);
      // (Untouchable, so the timed tests aren't cut short by a monkey.)
      t.me.shieldUntil = Infinity;
    };
    const walkTo = (t: ReturnType<typeof setup>, x: number, z: number) => {
      t.me.state.x = x;
      t.me.state.z = z;
      t.run(50);
      t.me.hp = 100;
    };

    it('wave 7: into the Backrooms with 12 crystals and lurking monkeys; collect them all, portal out, then wave 8', () => {
      const t = setup();
      try {
        (t.me as { userId: number | null }).userId = 5;
        toWave(t, CRYSTAL_HUNT.events.backrooms.wave);
        assert.equal(t.priv.zphase, 'event');
        const h = hunt(t)!;
        assert.equal(h.zone.id, 'backrooms');
        assert.ok(inside(h, t.me.state.x, t.me.state.z), 'taken into the Backrooms');
        const s = h.state();
        assert.equal(s.total, 12);
        assert.equal(s.crystals.length, 12);
        const monkeys = t.zombies().filter((z) => z.kind === 'monkey');
        assert.equal(monkeys.length, CRYSTAL_HUNT.events.backrooms.enemies.monkey);
        assert.ok(monkeys.every((m) => inside(h, m.p.state.x, m.p.state.z)), 'monkeys in there too');
        assert.equal(t.zombies().filter((z) => z.kind !== 'monkey').length, 0, 'no wave zombies');
        // C does nothing during the event.
        t.room.handleZombieBuild(t.me);
        assert.equal(t.priv.blocks.size, 0, 'no building');
        // Crystals: walk into each.
        const money = t.me.money;
        for (const c of [...s.crystals]) walkTo(t, c.x, c.z);
        assert.equal(h.state().crystals.length, 0);
        assert.ok(h.state().portal, 'the portal opened');
        assert.ok(t.events.some((e) => e.event === 'crystal'));
        walkTo(t, h.zone.exit.x, h.zone.exit.z);
        assert.equal(hunt(t), null, 'over');
        assert.ok(!inside(h, t.me.state.x, t.me.state.z), 'back in the graveyard');
        assert.equal(t.me.money, money + CRYSTAL_HUNT.events.backrooms.reward.money);
        assert.equal(t.zombies().filter((z) => z.p.alive).length, 0, 'monkeys gone');
        assert.equal(t.priv.zphase, 'prep');
        assert.equal(t.priv.wave, 8, 'the event was wave 7: next is wave 8');
      } finally {
        t.room.close();
      }
    });

    it('a monkey that sees you scares you once', () => {
      const t = setup();
      try {
        toWave(t, CRYSTAL_HUNT.events.backrooms.wave);
        const m = t.zombies().find((z) => z.kind === 'monkey')!;
        const before = t.events.length;
        // Stand right next to it, in its room.
        walkTo(t, m.p.state.x + 1.5, m.p.state.z);
        t.run(600);
        assert.equal((m as unknown as { alerted: boolean }).alerted, true, 'it charges');
        walkTo(t, m.p.state.x + 1.5, m.p.state.z);
        t.run(600);
        // (The scare goes to your socket; here the room has no sockets, so check the hunt kept it once.)
        assert.ok((hunt(t) as unknown as { spotted: Set<number> }).spotted.has(t.me.pid));
        assert.ok(t.events.length >= before);
      } finally {
        t.room.close();
      }
    });

    it('time running out costs a life (the game goes on); with onFail gameOver it ends the game', () => {
      const t = setup();
      try {
        toWave(t, CRYSTAL_HUNT.events.backrooms.wave);
        t.run(CRYSTAL_HUNT.events.backrooms.timeMs + 500);
        assert.equal(hunt(t), null);
        assert.equal((t.room as unknown as { lives: number }).lives, CRYSTAL_HUNT.lives - 1);
        assert.notEqual(t.priv.zphase, 'over');
        const was = CRYSTAL_HUNT.onFail;
        CRYSTAL_HUNT.onFail = 'gameOver';
        try {
          toWave(t, CRYSTAL_HUNT.events.phoneMission.wave);
          assert.equal(t.priv.zphase, 'event');
          t.run(CRYSTAL_HUNT.events.phoneMission.timeMs + 500);
          assert.equal(t.priv.zphase, 'over');
        } finally {
          CRYSTAL_HUNT.onFail = was;
        }
      } finally {
        t.room.close();
      }
    });

    it('wave 10: the Phone Mission (more crystals, more monsters, less time, a blackout), then the boss wave', () => {
      const t = setup();
      try {
        toWave(t, CRYSTAL_HUNT.events.phoneMission.wave);
        const h = hunt(t)!;
        const b = CRYSTAL_HUNT.events.backrooms;
        const p = CRYSTAL_HUNT.events.phoneMission;
        assert.equal(h.zone.id, 'facility');
        assert.ok(p.crystals > b.crystals && p.timeMs < b.timeMs);
        assert.ok(t.zombies().length > (b.enemies.monkey ?? 0), 'more monsters');
        t.run(p.timeMs * 0.5 + 300);
        assert.ok((h as unknown as { blackoutUntil: number }).blackoutUntil > 0, 'the power went out half way');
        for (const c of [...h.state().crystals]) walkTo(t, c.x, c.z);
        walkTo(t, h.zone.exit.x, h.zone.exit.z);
        assert.equal(hunt(t), null);
        assert.equal(t.priv.wave, 10, 'still wave 10');
        t.run(ZOMBIE.prepMs + 300);
        assert.equal(t.priv.zphase, 'wave');
        assert.ok(t.priv.queue.includes('boss') || t.zombies().some((z) => z.kind === 'boss'), 'and the boss comes');
      } finally {
        t.room.close();
      }
    });
  });

  it('when every survivor is down it is game over; Restart plays again from wave 1', () => {
    const t = setup();
    t.run(ZOMBIE.prepMs + 2000);
    t.room.damage(t.me, t.zombies()[0]!.p, 1000, false, 'world', { x: 0, y: 0, z: 0 }, t.now());
    t.run(100);
    assert.equal(t.priv.zphase, 'over');
    assert.equal(t.priv.match.phase, 'ended');
    assert.equal(t.zombies().length, 0, 'the zombies are cleared away');
    t.room.handleZombieRestart(t.me);
    assert.equal(t.priv.match.phase, 'playing');
    assert.equal(t.priv.zphase, 'prep');
    assert.equal(t.priv.wave, 1);
    assert.equal(t.priv.kills, 0);
    assert.equal(t.me.alive, true);
    assert.equal(t.me.money, ZOMBIE.startMoney);
    t.room.close();
  });

  it('C builds a wall that disappears after 10 seconds, and zombies can break it', () => {
    const t = setup();
    t.run(500);
    const events = t.events;
    t.room.handleZombieBuild(t.me);
    const built = t.priv.blocks.size;
    assert.ok(built >= 3, `a wall (${built} blocks)`);
    assert.ok(events.filter((e) => e.event === 'blockPlaced').every((e) => (e.args[0] as { ttl: number }).ttl === ZOMBIE.build.ttlMs));
    // Too soon for another.
    t.room.handleZombieBuild(t.me);
    assert.equal(t.priv.blocks.size, built);
    t.run(ZOMBIE.build.ttlMs - 600);
    assert.equal(t.priv.blocks.size, built, 'still there just before 10 seconds');
    t.run(1200);
    assert.equal(t.priv.blocks.size, 0, 'gone after 10 seconds');
    assert.ok(events.filter((e) => e.event === 'blockRemoved').length >= built);

    // A zombie chewing through it.
    t.run(ZOMBIE.build.cooldownMs);
    t.room.handleZombieBuild(t.me);
    const id = [...t.priv.blocks.keys()][0]!;
    (t.room as unknown as { damageBlock(id: number, d: number): void }).damageBlock(id, ZOMBIE.build.blockHp + 1);
    assert.equal(t.priv.blocks.has(id), false);
    t.room.close();
  });

  it('a boss wave sends a boss with a horde; killing it pays a lot', () => {
    const t = setup();
    // Jump to wave 5.
    t.priv.wave = 5;
    t.run(ZOMBIE.prepMs + 6000);
    const boss = t.zombies().find((z) => z.kind === 'boss');
    assert.ok(boss, 'the boss is out');
    assert.equal(t.room.players.get(boss!.p.pid)?.info.undead, 'boss');
    assert.ok(t.zombies().length > 3, 'with a horde');
    const before = t.me.money;
    t.room.damage(boss!.p, t.me, 1e9, false, 'rifle', { x: 0, y: 0, z: 0 }, t.now());
    assert.ok(t.me.money - before >= boss!.stats.reward);
    t.room.close();
  });

  it('only one kind of room has all this: other modes are untouched', () => {
    const { io } = fakeIo();
    const room = createRoom(io, { id: 'f', code: 'FFA01', name: 'F', mode: 'ffa', map: 'farm', private: true, bots: 0 }, {}) as GameRoom;
    clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
    const p = addPlayer(room, 'A');
    room.handleZombieBuild(p);
    room.handleZombieRestart(p);
    assert.equal(room.handleBuy(p, 'heal-50').ok, false);
    room.close();
  });
});
