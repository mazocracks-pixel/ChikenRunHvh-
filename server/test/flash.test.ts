import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DEFAULT_MODS, FLASH, KILL_FLAGS, MAPS, PLAYER, createCollisionWorld, flashBlindMs, isSpaceFree, makeRay, raycastWorld, type KillEvent } from '@game/shared';
import type { GameRoom } from '../src/rooms/GameRoom';
import type { ServerPlayer } from '../src/rooms/ServerPlayer';
import { addPlayer, makeRoom, place, type RecordedEvent } from './helpers';

let current: GameRoom | null = null;
afterEach(() => current?.close());

const kills = (events: RecordedEvent[]) => events.filter((e) => e.event === 'kill').map((e) => e.args[0] as KillEvent);
const tick = (room: GameRoom) => (room as unknown as { fixedUpdate(now: number): void }).fixedUpdate(performance.now());
const lookAt = (p: ServerPlayer, at: { x: number; y: number; z: number }, eye: { x: number; y: number; z: number }) => {
  const d = { x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z };
  p.lookYaw = p.yaw = Math.atan2(-d.x, -d.z);
  p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
};
let shot = 0;
function fire(room: GameRoom, p: ServerPlayer, to: { x: number; y: number; z: number }, aiming = true) {
  p.lastFireAt = -Infinity;
  p.switchReadyAt = 0;
  p.reloadUntil = 0;
  p.mags.set(p.weapon, 30);
  const eye = room.eyeOf(p);
  const d = { x: to.x - eye.x, y: to.y - eye.y, z: to.z - eye.z };
  const l = Math.hypot(d.x, d.y, d.z);
  room.handleFire(p, { shot: ++shot, weapon: p.weapon, dx: d.x / l, dy: d.y / l, dz: d.z / l, t: performance.now(), aiming });
}
/** Two open spots on the farm `dist` apart along x, with nothing between them. */
function openPair(dist: number) {
  const world = createCollisionWorld(MAPS.farm);
  for (let x = -30; x <= 30; x += 2) {
    for (let z = -30; z <= 30; z += 2) {
      if (!isSpaceFree(x, 0, z, world) || !isSpaceFree(x + dist, 0, z, world)) continue;
      if (![0.3, 0.8, 1.4].some((h) => raycastWorld(makeRay({ x, y: h, z }, { x: 1, y: 0, z: 0 }), world, dist))) return { a: { x, z }, b: { x: x + dist, z } };
    }
  }
  throw new Error('no open pair');
}
function setup() {
  const { room, events } = makeRoom('ffa', 'farm');
  current = room;
  const a = addPlayer(room, 'Shooter');
  const b = addPlayer(room, 'Target');
  room.startNow();
  for (const p of [a, b]) p.shieldUntil = 0;
  return { room, events, a, b };
}

describe('kill tags', () => {
  it('a no-scope sniper kill, in mid-air', () => {
    const { room, events, a, b } = setup();
    a.info.loadout = ['sniper', 'knife'];
    a.weaponSlot = 0;
    // No spread (a dev setting), so the jump doesn't make it miss.
    a.mods = { ...DEFAULT_MODS, spread: 0 };
    const { a: from, b: to } = openPair(12);
    place(a, from.x, from.z, 1.5);
    a.state.onGround = false;
    place(b, to.x, to.z);
    tick(room);
    a.state.onGround = false;
    b.hp = 1;
    fire(room, a, { x: b.state.x, y: 0.7, z: b.state.z }, false);
    const k = kills(events).at(-1)!;
    assert.ok(k, 'killed');
    assert.ok(k.flags! & KILL_FLAGS.noscope, 'no scope');
    assert.ok(k.flags! & KILL_FLAGS.air, 'in the air');
    assert.ok(!(k.flags! & KILL_FLAGS.wallbang));
  });

  it('through a crate is a wallbang; a plain kill has no tags', () => {
    const { room, events, a, b } = setup();
    const world = room.world;
    const crate = MAPS.farm.boxes.find((x) => (x.kind === 'crate' || x.kind === 'hay' || x.kind === 'wood') && (x.y ?? 0) === 0 && x.h >= 1 && isSpaceFree(x.x - x.w / 2 - 1.5, 0, x.z, world) && isSpaceFree(x.x + x.w / 2 + 2, 0, x.z, world))!;
    assert.ok(crate, 'a crate to shoot through');
    place(a, crate.x - crate.w / 2 - 1.5, crate.z);
    place(b, crate.x + crate.w / 2 + 2, crate.z);
    tick(room);
    b.hp = 1;
    fire(room, a, { x: b.state.x, y: Math.min(0.5, crate.h / 2), z: b.state.z });
    assert.ok(kills(events).at(-1)!.flags! & KILL_FLAGS.wallbang, 'through the wall');

    const { a: from, b: to } = openPair(10);
    b.alive = true;
    b.hp = 1;
    place(a, from.x, from.z);
    place(b, to.x, to.z);
    tick(room);
    fire(room, a, { x: b.state.x, y: 0.7, z: b.state.z });
    assert.equal(kills(events).at(-1)!.flags, undefined, 'nothing special');
  });
});

describe('flashbangs', () => {
  it('blind for longer up close and looking at it; little from behind; nothing past the range', () => {
    const eye = { x: 0, y: 1.2, z: 0 };
    const at = { x: 0, y: 1.2, z: -5 };
    const looking = flashBlindMs(eye, { x: 0, y: 0, z: -1 }, at);
    const away = flashBlindMs(eye, { x: 0, y: 0, z: 1 }, at);
    assert.ok(looking > 2500, `${looking} ms`);
    assert.ok(away > 0 && away < looking / 3, `${away} ms from behind`);
    assert.ok(flashBlindMs(eye, { x: 0, y: 0, z: -1 }, { x: 0, y: 1.2, z: -12 }) < looking);
    assert.equal(flashBlindMs(eye, { x: 0, y: 0, z: -1 }, { x: 0, y: 1.2, z: -(FLASH.range + 1) }), 0);
  });

  it('blinds whoever can see it (walls block it) and tells them', () => {
    const { room, events, a, b } = setup();
    const { a: from, b: to } = openPair(8);
    place(a, from.x, from.z);
    place(b, to.x, to.z);
    const at = { x: (from.x + to.x) / 2, y: 1, z: from.z };
    lookAt(a, at, room.eyeOf(a));
    lookAt(b, { x: to.x + 10, y: 1, z: to.z }, room.eyeOf(b)); // looking away
    const sent: unknown[] = [];
    (a as unknown as { socket: { emit: (e: string, x: unknown) => void; leave: () => void } }).socket = { emit: (e, x) => e === 'flashed' && sent.push(x), leave: () => undefined };
    const now = performance.now();
    room.projectiles.flashAt(at, now);
    assert.ok(a.blindUntil - now > 2000, 'looking at it: blinded');
    assert.ok(b.blindUntil - now < a.blindUntil - now, 'looking away: much less');
    assert.equal(sent.length, 1, 'told about it');
    void events;

    // Behind a wall (in Town): nothing.
    room.close();
    const town = makeRoom('ffa', 'town').room;
    current = town;
    const c = addPlayer(town, 'Behind');
    town.startNow();
    const world = town.world;
    const wall = MAPS.town.boxes.find((x) => x.h >= 2.5 && (x.y ?? 0) === 0 && x.w >= 2 && isSpaceFree(x.x - x.w / 2 - 1, 0, x.z, world) && isSpaceFree(x.x + x.w / 2 + 1.5, 0, x.z, world))!;
    place(c, wall.x - wall.w / 2 - 1, wall.z);
    const behind = { x: wall.x + wall.w / 2 + 1.5, y: 1, z: wall.z };
    lookAt(c, behind, town.eyeOf(c));
    c.blindUntil = 0;
    town.projectiles.flashAt(behind, performance.now());
    assert.equal(c.blindUntil, 0, 'the wall took it');
  });

  it('flashbangs are thrown from your stock (1 to start, Z)', () => {
    const { room, a } = setup();
    assert.equal(a.flashes, PLAYER.startFlashes);
    a.nextThrowAt = 0;
    room.handleThrow(a, { kind: 'flash', seq: 1, dx: 0, dy: 0.2, dz: -1 });
    assert.equal(a.flashes, PLAYER.startFlashes - 1);
    a.nextThrowAt = 0;
    room.handleThrow(a, { kind: 'flash', seq: 2, dx: 0, dy: 0.2, dz: -1 });
    assert.equal(a.flashes, 0, 'none left to throw');
  });
});
