import assert from 'node:assert/strict';
import { it } from 'node:test';
import { SIM_DT, PLAYER, normalize, chickenHeadCenter, unpackPlayer, wrapAngle, defaultHvhLoadout, type ShotEvent } from '@game/shared';
import { addPlayer, makeRoom, place, stepRoom } from './helpers';

it('Double Tap delivers two damaging bullets in every HvH era, using two rounds and a burst cooldown', t => {
  for (const era of ['legacy', 'desync', 'tickbase', 'defensive'] as const) {
    const { room, events } = makeRoom('hvh', 'flat'); t.after(() => room.close());
    const a = addPlayer(room, 'Shooter'), b = addPlayer(room, 'Target'); a.info.team = 1; b.info.team = 2;
    room.startNow(); place(a, 20, 20); place(b, 20, 12); a.shieldUntil = b.shieldUntil = b.armor = 0;
    a.hvhEnabled = true; a.hvh.core!.era = era; a.hvh.exploit = 'doubleTap'; a.resource.ticks = 32;
    const mag = a.mag, now = performance.now() + 1, d = normalize({ x: 0, y: 0.65 - PLAYER.eyeHeight, z: -8 });
    room.handleFire(a, { shot: 1, weapon: a.weapon, dx: d.x, dy: d.y, dz: d.z, t: now, aiming: true });
    stepRoom(room, now);
    const event = events.find(e => e.event === 'shot')!.args[0] as ShotEvent;
    assert.equal(event.burst, 2); assert.equal(event.hits.length, 2); assert.ok(event.hits.every(h => h > 0));
    assert.ok(b.hp < 60, 'both bullets contribute health damage'); assert.equal(a.mag, mag - 2);
    assert.equal(a.resource.ticks, 0); assert.ok(a.resource.nextAttackTick - a.resource.playerTick >= 20);
  }
});

it('a defensive transition cannot shorten an active Hide Shots window', t => {
  const { room } = makeRoom('hvh', 'flat'); t.after(() => room.close());
  const p = addPlayer(room, 'Concealed'), enemy = addPlayer(room, 'Attacker'); p.info.team = 1; enemy.info.team = 2;
  room.startNow(); place(p, 20, 20); place(enemy, 20, 28); p.shieldUntil = enemy.shieldUntil = 0;
  p.hvhEnabled = true; p.hvh.exploit = 'hideShots'; p.hvh.core!.era = 'defensive'; p.hvh.core!.defensive = true; p.resource.ticks = 32;
  let now = performance.now() + 1;
  room.handleFire(p, { shot: 1, weapon: p.weapon, dx: 0, dy: 0, dz: -1, t: now, aiming: true }); stepRoom(room, now);
  const until = p.concealUntil, head = chickenHeadCenter(p.state, p.yaw);
  const d = normalize({ x: head.x - enemy.state.x, y: head.y - PLAYER.eyeHeight, z: head.z - enemy.state.z });
  now += SIM_DT * 1000;
  room.handleFire(enemy, { shot: 1, weapon: enemy.weapon, dx: d.x, dy: d.y, dz: d.z, t: now, aiming: true }); stepRoom(room, now);
  assert.equal(p.resource.defensive, true); assert.equal(p.concealUntil, until);
});

it('Hide Shots preserves collision pose and withholds the shot cue for the whole reveal window', t => {
  for (const exploit of ['off', 'hideShots'] as const) {
    const { room } = makeRoom('hvh', 'flat'); t.after(() => room.close()); const p = addPlayer(room, 'Shooter');
    room.startNow(); place(p, 20, 20); p.hvhEnabled = true; p.hvh = defaultHvhLoadout();
    p.hvh.antiAim = { enabled: true, mode: 'backward', desync: 58, jitter: 0, spinSpeed: 180 };
    p.hvh.exploit = exploit; p.resource.ticks = 32;
    let now = performance.now() + 1;
    room.handleInput(p, { seq: 1, forward: 0, right: 0, yaw: 0.6, pitch: 0.2, jump: false });
    for (let i = 0; i < 160; i++) stepRoom(room, now += SIM_DT * 1000);
    const body = p.yaw, lowerBody = p.animation.lowerBodyYaw;
    const own = unpackPlayer(room.snapshot(now, p.pid).p.find(s => s[0] === p.pid)!);
    const remote = unpackPlayer(room.snapshot(now, 99).p.find(s => s[0] === p.pid)!);
    assert.equal(own.fakeYaw, Math.round(body * 1000) / 1000);
    assert.equal(remote.fakeYaw, remote.yaw); assert.notEqual(remote.fakeYaw, own.fakeYaw);
    room.handleFire(p, { shot: 1, weapon: p.weapon, dx: 0, dy: 0, dz: -1, t: now, aiming: true });
    stepRoom(room, now);
    assert.equal(p.resource.ticks, exploit === 'hideShots' ? 18 : 32);
    if (exploit === 'hideShots') assert.equal(p.yaw, body);
    for (let i = 0; i < 18; i++) {
      stepRoom(room, now += SIM_DT * 1000);
      const publicState = unpackPlayer(room.snapshot(now, 99).p.find(s => s[0] === p.pid)!);
      assert.equal(publicState.hvhRevealed, exploit === 'off');
      if (exploit === 'hideShots') {
        assert.ok(Math.abs(wrapAngle(p.yaw - p.fakeYaw)) > 0.5);
        assert.equal(p.animation.lowerBodyYaw, lowerBody); assert.equal(p.revealUntil, 0);
      } else {
        assert.equal(p.yaw, 0); assert.equal(p.fakePitch, 0); assert.equal(publicState.lowerBodyYaw, 0);
      }
    }
    assert.equal(p.mag, 29);
    for (let i = 0; i < 10; i++) stepRoom(room, now += SIM_DT * 1000);
    assert.equal(p.toState().hvhRevealed, false, 'concealment never creates a delayed reveal');
    assert.ok(Math.abs(wrapAngle(p.yaw - p.fakeYaw)) > 0.5);
  }
});
