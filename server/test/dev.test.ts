import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { DEFAULT_MODS, PLAYER, parseDevAction, PROJECTILES, ROCKET_SPAM_INTERVAL_MS, SIM_DT, WALLBANG, WEAPONS, sanitizeMods, type ClientToServerEvents, type DevStatus, type JoinResponse, type ServerToClientEvents } from '@game/shared';
import { startGameServer, type RunningServer } from '../src/app';
import { runDevAction } from '../src/dev/devActions';
import { DevAccess } from '../src/dev/DevAccess';
import { addPlayer, makeRoom, place } from './helpers';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('DevAccess', () => {
  it('accepts only the right passkey and rate-limits guessing', () => {
    const dev = new DevAccess({ passkey: '2010', allowPublicRooms: false });
    assert.equal(dev.tryUnlock(1, 'ip1', '1234'), 'wrong');
    assert.equal(dev.tryUnlock(1, 'ip1', 2010), 'wrong');
    assert.equal(dev.isGranted(1), false);
    assert.equal(dev.tryUnlock(1, 'ip1', '2010'), 'ok');
    assert.equal(dev.isGranted(1), true);
    assert.equal(dev.isGranted(2), false);
    // Another account brute forcing gets locked out, even when it then guesses right.
    for (let i = 0; i < 5; i++) dev.tryUnlock(3, 'ip3', `wrong${i}`);
    assert.equal(dev.tryUnlock(3, 'ip3', '2010'), 'limited');
    assert.equal(dev.isGranted(3), false);
  });

  it('allows developer tools in private rooms only, unless public rooms are enabled', () => {
    const strict = new DevAccess({ passkey: 'x', allowPublicRooms: false });
    assert.equal(strict.allowedIn({ info: { private: true, mode: 'ffa' } }), true);
    assert.equal(strict.allowedIn({ info: { private: false, mode: 'ffa' } }), false);
    const open = new DevAccess({ passkey: 'x', allowPublicRooms: true });
    assert.equal(open.allowedIn({ info: { private: false, mode: 'ffa' } }), true);
    // Never in ranked (FaceChiken), whatever the settings.
    assert.equal(open.allowedIn({ info: { private: false, mode: 'face' } }), false);
    assert.equal(open.allowedIn({ info: { private: true, mode: 'face' } }), false);
  });
});

describe('developer modifiers in a room', () => {
  it('infinite ammo, fire rate and spread apply to fire requests', () => {
    const { room } = makeRoom();
    const p = addPlayer(room, 'Dev');
    const before = p.mag;
    room.handleFire(p, { shot: 1, weapon: p.weapon, dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false });
    assert.equal(p.mag, before - 1);
    p.mods = sanitizeMods({ infiniteAmmo: true, fireRate: 10 });
    p.lastFireAt = -Infinity;
    room.handleFire(p, { shot: 2, weapon: p.weapon, dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false });
    assert.equal(p.mag, before - 1, 'infinite ammo keeps the magazine');
    room.close();
  });

  it('frozen players ignore input; speed multiplies walking', () => {
    const { room } = makeRoom('ffa', 'flat');
    const a = addPlayer(room, 'A');
    const b = addPlayer(room, 'B');
    place(a, 0, -10);
    place(b, 0, 10);
    const input = (seq: number) => ({ seq, forward: 1, right: 0, jump: false, yaw: Math.PI / 2, pitch: 0 });
    b.frozen = true;
    a.mods = sanitizeMods({ speed: 2 });
    // Within the input burst budget (inputs arrive faster than real time here).
    for (let i = 1; i <= 12; i++) {
      room.handleInput(a, input(i));
      room.handleInput(b, input(i));
    }
    assert.equal(b.state.x, 0, 'frozen player did not move');
    assert.equal(b.lastSeq, 12, 'but inputs are still acknowledged');
    const expected = 6 * 2 * 12 * SIM_DT;
    assert.ok(Math.abs(-a.state.x - expected) < 0.05, `moved ${-a.state.x}, expected ${expected}`);
    room.close();
  });

  it('no rocket cooldown: rockets back to back without using ammo, with a tiny floor', () => {
    const { room } = makeRoom();
    room.info.private = true;
    const p = addPlayer(room, 'Dev');
    runDevAction(room, p, { kind: 'giveWeapon', target: p.pid, weapon: 'rocket' });
    p.switchReadyAt = 0;
    const fire = (shot: number) => room.handleFire(p, { shot, weapon: 'rocket', dx: 0, dy: 0, dz: -1, t: performance.now(), aiming: false });
    fire(1);
    fire(2);
    assert.equal(p.lastShotSeq, 1, 'normally the second rocket waits for the cooldown');
    assert.equal(p.mag, WEAPONS.rocket.magazine - 1);

    p.mods = sanitizeMods({ noRocketCooldown: true });
    for (let shot = 3; shot < 13; shot++) {
      p.lastFireAt -= ROCKET_SPAM_INTERVAL_MS;
      fire(shot);
    }
    assert.equal(p.lastShotSeq, 12, 'ten rockets in a row');
    assert.equal(p.mag, WEAPONS.rocket.magazine - 1, 'no ammo used, so it never has to reload');
    fire(13);
    assert.equal(p.lastShotSeq, 12, 'but not faster than the floor (no flooding the server)');
    room.close();
  });

  it('unlimited flashbangs: the stack never runs out, and only with the mod', () => {
    const { room } = makeRoom();
    const p = addPlayer(room, 'Dev');
    room.startNow();
    p.flashes = 1;
    const flash = (seq: number) => {
      p.nextThrowAt = 0;
      room.handleThrow(p, { kind: 'flash', seq, dx: 0, dy: 0, dz: -1 });
    };
    flash(1);
    assert.equal(p.flashes, 0, 'normally each throw uses one');
    flash(2);
    assert.equal(p.lastThrowSeq, 1, 'and with none left you cannot throw');
    p.mods = { ...DEFAULT_MODS, infiniteFlashes: true };
    flash(3);
    assert.equal(p.lastThrowSeq, 3, 'with the mod an empty stack still throws');
    assert.equal(p.flashes, PLAYER.maxFlashes, 'and is full again');
    room.close();
  });

  it('no rocket damage: blasts don’t hurt you but still push you', () => {
    // The clear lane on the farm.
    const { room } = makeRoom();
    const dev = addPlayer(room, 'Dev');
    const other = addPlayer(room, 'Other');
    place(dev, 20, -5);
    place(other, 20, -15);
    const now = performance.now();
    room.projectiles.blastAt({ x: 21, y: 0.4, z: -15 }, PROJECTILES.rocket, dev, 'rocket', now);
    assert.ok(other.hp < PLAYER.maxHealth, 'the blast reaches (and hurts) a normal player');

    dev.mods = sanitizeMods({ noRocketDamage: true });
    room.projectiles.blastAt({ x: 21, y: 0.4, z: -5 }, PROJECTILES.rocket, other, 'rocket', now);
    assert.equal(dev.hp, PLAYER.maxHealth, 'someone else’s rocket');
    room.projectiles.blastAt({ x: 21, y: 0.4, z: -5 }, PROJECTILES.rocket, dev, 'rocket', now);
    assert.equal(dev.hp, PLAYER.maxHealth, 'your own rocket');
    assert.ok(Math.hypot(dev.state.vx, dev.state.vz) > 1, 'the blast still pushes (rocket jumps)');
    room.close();
  });

  it('damage multiplier scales the attacker’s damage', () => {
    const { room } = makeRoom();
    const a = addPlayer(room, 'A');
    const v = addPlayer(room, 'V');
    a.mods = sanitizeMods({ damage: 3 });
    room.damage(v, a, 10, false, 'pistol', { x: 0, y: 0, z: 0 }, performance.now());
    assert.equal(v.hp, 70);
    room.close();
  });

  it('player actions: weapons, health, armor, teleport, respawn', () => {
    const { room } = makeRoom();
    room.info.private = true;
    const dev = addPlayer(room, 'Dev');
    const t = addPlayer(room, 'Target');
    place(dev, 5, 5);
    place(t, -5, -5);

    assert.deepEqual(runDevAction(room, dev, { kind: 'giveWeapon', target: t.pid, weapon: 'minigun' }), { ok: true });
    assert.equal(t.weapon, 'minigun');
    assert.equal(t.mag, WEAPONS.minigun.magazine);
    assert.equal(runDevAction(room, dev, { kind: 'removeWeapon', target: t.pid, weapon: 'minigun' }).ok, true);
    assert.ok(!t.info.loadout.includes('minigun'));
    assert.equal(runDevAction(room, dev, { kind: 'removeWeapon', target: t.pid, weapon: 'minigun' }).ok, false);

    runDevAction(room, dev, { kind: 'armor', target: t.pid, value: 500 });
    assert.equal(t.armor, 100, 'armor is clamped');
    runDevAction(room, dev, { kind: 'teleportToPlayer', target: t.pid });
    assert.ok(Math.hypot(dev.state.x - t.state.x, dev.state.z - t.state.z) < 2);

    runDevAction(room, dev, { kind: 'armor', target: t.pid, value: 0 });
    runDevAction(room, dev, { kind: 'health', target: t.pid, amount: -500 });
    assert.equal(t.alive, false, 'removing all health kills');
    assert.equal(runDevAction(room, dev, { kind: 'respawn', target: t.pid }).ok, true);
    assert.equal(t.alive, true);
    assert.equal(runDevAction(room, dev, { kind: 'respawn', target: 999 }).ok, false);
    room.close();
  });

  it('jumpscare: only people (not bots), once per cooldown, private rooms only', () => {
    const { room } = makeRoom();
    room.info.private = true;
    const dev = addPlayer(room, 'Dev');
    const t = addPlayer(room, 'Target');
    assert.equal(runDevAction(room, dev, { kind: 'jumpscare', target: t.pid, style: 'chicken' }).ok, false, 'no socket: a bot');
    const sent: unknown[] = [];
    Object.defineProperty(t, 'socket', { value: { emit: (event: string, e: unknown) => sent.push([event, e]), leave: () => {} } });
    assert.equal(runDevAction(room, dev, { kind: 'jumpscare', target: t.pid, style: 'ghost' }).ok, true);
    assert.deepEqual(sent, [['jumpscare', { style: 'ghost' }]]);
    assert.equal(runDevAction(room, dev, { kind: 'jumpscare', target: t.pid, style: 'glitch' }).ok, false, 'cooldown');
    assert.equal(sent.length, 1);
    assert.equal(parseDevAction({ kind: 'jumpscare', target: t.pid, style: 'chicken' })?.kind, 'jumpscare');
    assert.equal(parseDevAction({ kind: 'jumpscare', target: t.pid, style: '<img>' }), null);
    room.info.private = false;
    assert.equal(runDevAction(room, dev, { kind: 'refill', target: t.pid }).ok, false, 'other actions stay private-only');
    const scared: unknown[] = [];
    const other = addPlayer(room, 'Other');
    Object.defineProperty(other, 'socket', { value: { emit: (event: string, e: unknown) => scared.push([event, e]), leave: () => {} } });
    assert.equal(runDevAction(room, dev, { kind: 'jumpscare', target: other.pid, style: 'chicken' }).ok, true, 'jumpscares work in public rooms');
    assert.deepEqual(scared, [['jumpscare', { style: 'chicken' }]]);
    room.close();
  });

  it('jumpscare over the socket: passkey needed, public rooms yes, HvH no', async () => {
    const server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000, devPasskey: '2010', devInPublicRooms: true });
    try {
      const base = `http://localhost:${server.port}`;
      const join = async () => {
        const { token } = (await (await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'x-session-transport': 'token' } })).json()) as { token: string };
        const c: Client = connect(base, { transports: ['websocket'], auth: { token }, reconnection: false });
        await new Promise<void>((resolve, reject) => { c.once('connect', () => resolve()); c.once('connect_error', reject); });
        return c;
      };
      const dev = await join();
      const victim = await join();
      try {
        let got = 0;
        victim.on('jumpscare', () => got++);
        const room = await dev.timeout(3000).emitWithAck('createRoom', { mode: 'ffa', map: 'farm', private: false, bots: 0 });
        assert.ok(room.ok);
        if (!room.ok) return;
        const joined = await victim.timeout(3000).emitWithAck('joinRoom', { code: room.room.code });
        assert.ok(joined.ok);
        if (!joined.ok) return;
        const scare = () => dev.timeout(3000).emitWithAck('devAction', { kind: 'jumpscare', target: joined.selfPid, style: 'ghost' });
        assert.equal((await scare()).ok, false, 'needs the passkey');
        assert.deepEqual(await dev.timeout(3000).emitWithAck('devAuth', '2010'), { ok: true });
        assert.equal((await scare()).ok, true, 'public room');
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(got, 1);
        assert.equal((await dev.timeout(3000).emitWithAck('devAction', { kind: 'refill', target: joined.selfPid })).ok, false, 'admin actions stay private-only');
        // HvH panels need no passkey, but they never unlock pranks on other players.
        const hvh = await victim.timeout(3000).emitWithAck('createRoom', { mode: 'hvh', map: 'farm', private: false, bots: 0 });
        assert.ok(hvh.ok);
        if (!hvh.ok) return;
        assert.equal((await victim.timeout(3000).emitWithAck('devAction', { kind: 'jumpscare', target: hvh.selfPid, style: 'ghost' })).ok, false, 'HvH');
      } finally {
        dev.disconnect();
        victim.disconnect();
      }
    } finally {
      await server.close();
    }
  });
});

describe('HvH mode', () => {
  it('is 5 vs 5 and kills score for the team', () => {
    const { room } = makeRoom('hvh', 'farm');
    const a = addPlayer(room, 'A');
    const b = addPlayer(room, 'B');
    assert.equal(room.mode.maxPlayers, 10);
    assert.notEqual(a.info.team, b.info.team);
    room.startNow();
    a.shieldUntil = b.shieldUntil = 0;
    room.damage(b, a, 500, false, 'rifle', { x: 0, y: 0, z: 0 }, performance.now());
    const scores = (room as unknown as { match: { teamScores: [number, number] } }).match.teamScores;
    assert.equal(scores[a.info.team - 1], 1);
    room.close();
  });
});

describe('wallbang', () => {
  it('bullets go through a crate with less damage, but not through stone', () => {
    const { room } = makeRoom('ffa', 'farm');
    const shooter = addPlayer(room, 'Shooter');
    const victim = addPlayer(room, 'Victim');
    room.startNow();
    shooter.shieldUntil = victim.shieldUntil = 0;
    // The side-lane crate at (0, 22) is between them; aim at the victim's body through it.
    place(shooter, 0, 26);
    place(victim, 0, 19);
    shooter.mods = sanitizeMods({ spread: 0 });
    const eye = { x: 0, y: 1.3, z: 26 };
    const target = { x: 0, y: 0.6, z: 19 };
    const len = Math.hypot(target.y - eye.y, target.z - eye.z);
    const fire = (shot: number) => room.handleFire(shooter, { shot, weapon: shooter.weapon, dx: 0, dy: (target.y - eye.y) / len, dz: (target.z - eye.z) / len, t: performance.now(), aiming: false });
    fire(1);
    const w = WEAPONS[shooter.weapon];
    assert.ok(Math.abs(100 - victim.hp - w.damage * WALLBANG.damageScale) < 0.01, `took ${100 - victim.hp}`);

    // The stone wall at z = 12 stops bullets completely.
    place(shooter, 0, 14);
    place(victim, 0, 9);
    victim.hp = 100;
    shooter.lastFireAt = -Infinity;
    const eye2 = { y: 1.3, z: 14 };
    const len2 = Math.hypot(0.6 - eye2.y, 9 - eye2.z);
    room.handleFire(shooter, { shot: 2, weapon: shooter.weapon, dx: 0, dy: (0.6 - eye2.y) / len2, dz: (9 - eye2.z) / len2, t: performance.now(), aiming: false });
    assert.equal(victim.hp, 100);
    room.close();
  });
});

describe('crouching', () => {
  it('a shot at head height goes over a crouched chicken', () => {
    const { room } = makeRoom('ffa', 'flat');
    const shooter = addPlayer(room, 'Shooter');
    const victim = addPlayer(room, 'Victim');
    room.startNow();
    shooter.shieldUntil = victim.shieldUntil = 0;
    shooter.mods = sanitizeMods({ spread: 0 });
    place(shooter, 20, 20);
    place(victim, 20, 12);
    victim.state.crouching = true;
    victim.yaw = 0;
    victim.history.clear();
    // Level shot at standing head height (1.27 m), straight at the victim.
    const dy = 1.27 - 1.3;
    const len = Math.hypot(dy, 8);
    room.handleFire(shooter, { shot: 1, weapon: shooter.weapon, dx: 0, dy: dy / len, dz: -8 / len, t: performance.now(), aiming: false });
    assert.equal(victim.hp, 100, 'missed the crouched chicken');
    victim.state.crouching = false;
    shooter.lastFireAt = -Infinity;
    room.handleFire(shooter, { shot: 2, weapon: shooter.weapon, dx: 0, dy: dy / len, dz: -8 / len, t: performance.now(), aiming: false });
    assert.ok(victim.hp < 100, 'hits when standing');
    room.close();
  });
});

describe('kill bonuses', () => {
  it('every kill drops a random pickup that the next player can grab', () => {
    const { room, events } = makeRoom('ffa', 'farm');
    const a = addPlayer(room, 'A');
    const b = addPlayer(room, 'B');
    room.startNow();
    a.shieldUntil = b.shieldUntil = 0;
    place(b, 15, 5);
    room.damage(b, a, 500, false, 'rifle', { x: 0, y: 0, z: 0 }, performance.now());
    const drop = events.find((e) => e.event === 'drop')?.args[0] as { id: number; x: number; y: number; z: number; kind: string } | undefined;
    assert.ok(drop, 'a bonus dropped');
    assert.deepEqual([drop.x, drop.y, drop.z], [15, 0, 5]);
    // Make every kind useful, then walk onto it.
    a.hp = 40;
    a.armor = 0;
    a.state.fuel = 0;
    a.eggs = 0;
    place(a, 15, 5);
    room.loot.update(performance.now());
    const gone = events.find((e) => e.event === 'dropGone')?.args[0] as { id: number; pid: number } | undefined;
    assert.deepEqual(gone, { id: drop.id, pid: a.pid });
    assert.ok(events.some((e) => e.event === 'pickup' && (e.args[0] as { lootId: number }).lootId === -1));
    room.close();
  });
});

describe('developer socket API', () => {
  let server: RunningServer;
  let base: string;
  const clients: Client[] = [];

  before(async () => {
    server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000, devPasskey: '2010', devInPublicRooms: false });
    base = `http://localhost:${server.port}`;
  });
  after(async () => {
    for (const c of clients) c.disconnect();
    await server.close();
  });

  const client = async (): Promise<Client> => {
    const res = await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'x-session-transport': 'token' } });
    const { token } = (await res.json()) as { token: string };
    const c: Client = connect(base, { transports: ['websocket'], auth: { token }, reconnection: false });
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      c.once('connect', () => resolve());
      c.once('connect_error', reject);
    });
    return c;
  };
  const call = <T>(fn: (ack: (v: T) => void) => void) => new Promise<T>((resolve) => fn(resolve));

  it('ignores everything until the passkey is accepted, then works in private rooms only', async () => {
    const c = await client();
    const priv = await call<JoinResponse>((ack) => c.emit('createRoom', { mode: 'sandbox', map: 'flat', private: true }, ack));
    assert.ok(priv.ok);

    let status = await call<DevStatus>((ack) => c.emit('devMods', { infiniteAmmo: true }, ack));
    assert.equal(status.granted, false);
    assert.deepEqual(status.mods, DEFAULT_MODS, 'mods ignored before unlocking');
    assert.equal((await call<{ ok: boolean }>((ack) => c.emit('devAction', { kind: 'refill', target: priv.ok ? priv.selfPid : 0 }, ack))).ok, false);

    assert.deepEqual(await call((ack) => c.emit('devAuth', '0000', ack)), { ok: false, error: 'Invalid Passkey' });
    assert.deepEqual(await call((ack) => c.emit('devAuth', '2010', ack)), { ok: true });

    status = await call<DevStatus>((ack) => c.emit('devMods', { infiniteAmmo: true, speed: 99 }, ack));
    assert.equal(status.granted, true);
    assert.equal(status.allowedHere, true);
    assert.equal(status.mods.infiniteAmmo, true);
    assert.equal(status.mods.speed, 5, 'clamped to the limit');

    // A public room on a non-dev server: access is still granted, but not allowed here.
    const pub = await call<JoinResponse>((ack) => c.emit('quickPlay', { mode: 'ffa' }, ack));
    assert.ok(pub.ok);
    status = await call<DevStatus>((ack) => c.emit('devMods', { infiniteAmmo: true }, ack));
    assert.equal(status.granted, true);
    assert.equal(status.allowedHere, false);
    assert.equal(status.mods.infiniteAmmo, false);
    const res = await call<{ ok: boolean; error?: string }>((ack) => c.emit('devAction', { kind: 'refill', target: pub.ok ? pub.selfPid : 0 }, ack));
    assert.equal(res.ok, false);
  });
});
