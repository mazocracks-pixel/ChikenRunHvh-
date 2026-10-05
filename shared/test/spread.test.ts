import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CollisionWorld, MAPS, PLAYER, SIM_DT, WEAPON_IDS, WEAPONS, copyMoveState, createCollisionWorld, createMoveState, hvhSpread, hvhWeapon, spreadFor, stepPlayer, type InputFrame } from '../src/index';

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
  const world = new CollisionWorld(1000, []);
  const s = createMoveState(20,0,-5);
  for(let i=0;i<64;i++)stepPlayer(s,input(1),SIM_DT,world);
  assert.ok(Math.abs(s.horizontalSpeed-PLAYER.speed)<1e-9);
  for(let i=0;i<64;i++)stepPlayer(s,{...input(1),slowWalk:true},SIM_DT,world);
  assert.ok(Math.abs(s.horizontalSpeed-PLAYER.speed*.45)<1e-9);
  for(let i=0;i<64;i++)stepPlayer(s,input(),SIM_DT,world);assert.equal(s.horizontalSpeed,0);
  s.vx = 10; stepPlayer(s,input(),SIM_DT,world); assert.ok(s.horizontalSpeed>PLAYER.speed);
  const wall = createMoveState(11.5-PLAYER.radius,0,0);
  stepPlayer(wall,input(0,1),SIM_DT,createCollisionWorld(MAPS.farm)); assert.ok(wall.horizontalSpeed<1e-9);
  const copy = createMoveState(0,0,0); copyMoveState(s,copy);
  assert.equal(copy.horizontalSpeed,s.horizontalSpeed);
});

it('ground slow walking lowers real speed and weapon spread in ordinary and HvH physics without stacking crouch or slowing flight', () => {
  const world = createCollisionWorld(MAPS.flat);
  for (const tactical of [false, true]) {
    const normal = createMoveState(20,0,20), slow = createMoveState(20,0,20);
    slow.hop = 0.6;
    for (let seq=1;seq<=64;seq++) {
      const frame = {...input(1,1),seq};
      stepPlayer(normal,frame,SIM_DT,world,null,0.6,1,tactical);
      stepPlayer(slow,{...frame,slowWalk:true},SIM_DT,world,null,0.6,1,tactical);
    }
    assert.ok(Math.abs(slow.horizontalSpeed-PLAYER.speed*PLAYER.slowWalkSpeed)<1e-9);
    assert.equal(slow.hop,0);
    for (const id of WEAPON_IDS) {
      const w = tactical ? hvhWeapon(WEAPONS[id]) : WEAPONS[id];
      const spread = (speed: number) => tactical ? hvhSpread(w,speed,false,false) : spreadFor(w,speed,false,false);
      if (w.moveSpread) assert.ok(spread(slow.horizontalSpeed)<spread(normal.horizontalSpeed));
    }
    const priorSpeed=slow.horizontalSpeed;
    stepPlayer(slow,input(1,1),SIM_DT,world,null,0.6,1,tactical);
    assert.ok(slow.horizontalSpeed>priorSpeed,'releasing Shift restores normal movement');
    const crouched=createMoveState(20,0,20);
    for(let seq=1;seq<=64;seq++)stepPlayer(crouched,{...input(1),seq,crouch:true,slowWalk:true},SIM_DT,world,null,0.6,1,tactical);
    assert.ok(Math.abs(crouched.horizontalSpeed-PLAYER.speed*PLAYER.slowWalkSpeed)<1e-9,'crouch and slow walk do not multiply twice');
    const air=createMoveState(20,5,20), airSlow=createMoveState(20,5,20);
    stepPlayer(air,input(1),SIM_DT,world,null,0.6,1,tactical);
    stepPlayer(airSlow,{...input(1),slowWalk:true},SIM_DT,world,null,0.6,1,tactical);
    assert.deepEqual(airSlow,air,'Shift grants no different air physics or accuracy');
  }
});
