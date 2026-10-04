import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MAPS, PLAYER, SIM_DT, WEAPON_IDS, WEAPONS, copyMoveState, createCollisionWorld, createMoveState, spreadFor, stepPlayer, type InputFrame } from '../src/index';

const input = (forward = 0, right = 0): InputFrame => ({ seq:1, forward, right, yaw:0, pitch:0, jump:false });
it('spread increases continuously with actual velocity for every ranged weapon', () => {
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    const samples = [0, .45, 1, 1.8].map(k => spreadFor(w, PLAYER.speed*k, false, false));
    assert.equal(samples[0], w.spread);
    for (let i=1;i<samples.length;i++) assert.ok(samples[i]! >= samples[i-1]!);
    if (w.moveSpread) assert.ok(samples[1]! < samples[2]! && samples[2]! < samples[3]!);
    assert.ok(spreadFor(w, 6, true, false) >= spreadFor(w, 6, false, false));
    assert.ok(spreadFor(w, 6, false, true) <= spreadFor(w, 6, false, false));
    assert.ok(Number.isFinite(spreadFor(w, NaN, false, false)));
  }
});
it('speed follows collision-resolved motion, slow walk, stopping and knockback', () => {
  const world = createCollisionWorld(MAPS.farm);
  const s = createMoveState(20,0,-5);
  stepPlayer(s,input(1),SIM_DT,world); assert.ok(Math.abs(s.horizontalSpeed-PLAYER.speed)<1e-9);
  stepPlayer(s,input(.45),SIM_DT,world); assert.ok(Math.abs(s.horizontalSpeed-PLAYER.speed*.45)<1e-9);
  stepPlayer(s,input(),SIM_DT,world); assert.equal(s.horizontalSpeed,0);
  s.vx = 10; stepPlayer(s,input(),SIM_DT,world); assert.ok(s.horizontalSpeed>PLAYER.speed);
  const wall = createMoveState(11.5-PLAYER.radius,0,0);
  stepPlayer(wall,input(0,1),SIM_DT,world); assert.ok(wall.horizontalSpeed<1e-9);
  const copy = createMoveState(0,0,0); copyMoveState(s,copy);
  assert.equal(copy.horizontalSpeed,s.horizontalSpeed);
});
