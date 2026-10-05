import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CollisionWorld, PLAYER, SIM_DT, SOURCE_MOVE, accelerateWish, airStrafeInput, airSurfaceFriction, copyMoveState, createMoveState, stepPlayer, type InputFrame } from '../src';
const flat=new CollisionWorld(1000,[]);
const frame=(seq=1,extra:Partial<InputFrame>={}):InputFrame=>({seq,forward:0,right:0,jump:false,yaw:0,pitch:0,...extra});

it('air input caps only the wish-direction projection and perpendicular strafing adds real speed',()=>{
  const aligned={x:0,z:-6};accelerateWish(aligned,0,-6,SIM_DT,true);assert.deepEqual(aligned,{x:0,z:-6});
  const strafe={x:0,z:-6};accelerateWish(strafe,6,0,SIM_DT,true);
  assert.equal(strafe.z,-6);assert.ok(Math.abs(strafe.x-SOURCE_MOVE.airWishSpeed)<1e-9);
  assert.ok(Math.abs(Math.hypot(strafe.x,strafe.z)-Math.sqrt(36+SOURCE_MOVE.airWishSpeed**2))<1e-9);
});

it('turning alone cannot steer momentum, while matching side input and view turning builds air-strafe speed',()=>{
  const coast=createMoveState(0,100,0),strafe=createMoveState(0,100,0);
  coast.walkVz=strafe.walkVz=-6;coast.vy=strafe.vy=-1;
  for(let seq=1;seq<=20;seq++) {
    stepPlayer(coast,frame(seq,{yaw:seq*.2}),SIM_DT,flat,null,0.1,1,true);
    const yaw=Math.atan2(-(strafe.walkVx??0),-(strafe.walkVz??0));
    stepPlayer(strafe,frame(seq,{yaw,right:1}),SIM_DT,flat,null,0.1,1,true);
  }
  assert.equal(coast.walkVx,0);assert.equal(coast.walkVz,-6,'air momentum has no artificial drag');
  assert.ok(strafe.horizontalSpeed>coast.horizontalSpeed);assert.ok(strafe.x>coast.x);
});

it('counter-strafing stops sooner than releasing movement because friction and reverse acceleration combine',()=>{
  const stoppingTicks=(reverse:boolean)=>{
    const s=createMoveState(0,0,0);s.walkVz=-6;
    for(let seq=1;seq<=100;seq++) {stepPlayer(s,frame(seq,{forward:reverse?-1:0}),SIM_DT,flat);if(s.horizontalSpeed<.4)return seq;}
    throw Error('Did not stop');
  };
  assert.ok(stoppingTicks(true)<stoppingTicks(false));
});

it('a jump before friction preserves momentum while a missed landing tick loses it, with bounded takeoff',()=>{
  const perfect=createMoveState(0,0,0),missed=createMoveState(0,0,0);perfect.walkVz=missed.walkVz=-6.5;
  stepPlayer(perfect,frame(1,{jump:true}),SIM_DT,flat,null,0.1,1,true);
  stepPlayer(missed,frame(),SIM_DT,flat,null,0.1,1,true);
  stepPlayer(missed,frame(2,{jump:true}),SIM_DT,flat,null,0.1,1,true);
  assert.ok(Math.abs(perfect.horizontalSpeed-6.5)<1e-9);assert.ok(missed.horizontalSpeed<perfect.horizontalSpeed);
  const fast=createMoveState(0,0,0);fast.walkVz=-20;stepPlayer(fast,frame(1,{jump:true}),SIM_DT,flat);
  assert.ok(Math.abs(fast.horizontalSpeed-PLAYER.speed*1.1)<1e-9);
});

it('Source dead-strafe changes air acceleration near the rising apex without removing momentum',()=>{
  assert.equal(airSurfaceFriction(-1),1);assert.equal(airSurfaceFriction(2),.25);assert.equal(airSurfaceFriction(5),1);
  const normal={x:0,z:-6},dead={x:0,z:-6};
  accelerateWish(normal,6,0,SIM_DT,true);accelerateWish(dead,6,0,SIM_DT,true,airSurfaceFriction(2));
  assert.ok(dead.x>0&&dead.x<normal.x);assert.equal(dead.z,normal.z);
});

it('the air-strafe helper optimizes WASD intent and leaves the camera unchanged',()=>{
  const s=createMoveState(0,100,0);s.walkVz=-6;s.vy=-1;
  const f=frame(1,{jump:true,yaw:0,pitch:.2});
  const assisted=airStrafeInput(f,s,0,SIM_DT,6);assert.equal(assisted.yaw,f.yaw);assert.equal(assisted.pitch,f.pitch);
  assert.ok(Math.hypot(assisted.forward,assisted.right)<=1+1e-9);
  stepPlayer(s,assisted,SIM_DT,flat,null,.1,1,true);assert.ok(s.horizontalSpeed>6);
  for(const right of [-1,1]) {
    const directed=createMoveState(0,100,0);directed.walkVz=-6;directed.vy=-1;
    const assisted=airStrafeInput(frame(1,{right}),directed,0,SIM_DT,6);
    assert.equal(assisted.yaw,0);assert.equal(Math.sign(assisted.right),right);
    stepPlayer(directed,assisted,SIM_DT,flat,null,.1,1,true);assert.ok(directed.horizontalSpeed>6);
  }
});

it('subtick strafe increases real air speed using the same tick duration, gravity and takeoff limit only in HvH',()=>{
  const normal=createMoveState(0,100,0),boost=createMoveState(0,100,0),outside=createMoveState(0,100,0);
  normal.walkVz=boost.walkVz=outside.walkVz=-6;normal.vy=boost.vy=outside.vy=-1;
  for(let seq=1;seq<=30;seq++) {
    const f=frame(seq,{forward:1});
    stepPlayer(normal,airStrafeInput(f,normal,0,SIM_DT,6),SIM_DT,flat,null,.1,1,true);
    stepPlayer(boost,{...f,subtickStrafe:true},SIM_DT,flat,null,.1,1,true);
    const expected={...outside};stepPlayer(expected,f,SIM_DT,flat,null,.1,1,false);
    stepPlayer(outside,{...f,subtickStrafe:true},SIM_DT,flat,null,.1,1,false);assert.deepEqual(outside,expected);
    assert.equal(boost.y,normal.y);assert.equal(boost.vy,normal.vy);
  }
  assert.ok(boost.horizontalSpeed>normal.horizontalSpeed+.5);
  boost.y=0;boost.onGround=true;stepPlayer(boost,frame(31,{jump:true}),SIM_DT,flat,null,.1,1,true);
  assert.ok(boost.horizontalSpeed<=PLAYER.speed*1.1+1e-9);
});

it('fast movement sweeps thin walls and removes only blocked momentum while retaining wall-parallel velocity',()=>{
  const world=new CollisionWorld(100);world.add(1,{minX:1,maxX:1.05,minY:0,maxY:4,minZ:-5,maxZ:5});
  const s=createMoveState(0,1,0);s.walkVx=80;s.walkVz=4;s.vy=-1;
  stepPlayer(s,frame(),SIM_DT,world);
  assert.ok(Math.abs(s.x-(1-PLAYER.radius))<1e-9);assert.equal(s.walkVx,0);assert.equal(s.walkVz,4);assert.ok(s.z>0);
});

it('copying authoritative momentum and replaying commands produces identical movement after strafing and landings',()=>{
  const a=createMoveState(0,0,0),b=createMoveState(0,0,0);
  for(let seq=1;seq<=200;seq++) {
    const f=frame(seq,{forward:seq<30?1:0,right:seq%40<20?1:-1,yaw:seq*.05,jump:seq%50===0,autoHop:seq>100});
    stepPlayer(a,f,SIM_DT,flat,null,.1,1,true);stepPlayer(b,f,SIM_DT,flat,null,.1,1,true);
    if(seq%20===0)copyMoveState(a,b);
    assert.deepEqual(a,b);
  }
});
