import assert from 'node:assert/strict';
import {it} from 'node:test';
import {MODE_IDS, SIM_DT, createMoveState, unpackPlayer} from '@game/shared';
import {addPlayer,makeRoom,place,stepRoom} from './helpers';
const frame=(seq:number)=>({seq,forward:1,right:0,jump:false,yaw:0,pitch:0});

it('every mode consumes one movement command per fixed tick and advances the ordinary simulation clock',t=>{
 for(const mode of MODE_IDS){
  const {room}=makeRoom(mode,'flat');t.after(()=>room.close());const p=addPlayer(room,'Walker');room.startNow();place(p,20,20);
  for(let seq=1;seq<=12;seq++)room.handleInput(p,frame(seq));
  assert.equal(p.state.z,20,mode);assert.equal(p.lastSeq,0,mode);
  const now=performance.now()+100;stepRoom(room,now);
  assert.equal(p.lastSeq,1,mode);assert.equal(p.commands.size,11,mode);
  assert.ok(p.state.z<20 && p.state.z>20-6*SIM_DT,mode);
  assert.equal(p.simulationTime,now,mode);assert.equal(p.resource.playerTick,1,mode);
 }
});

it('forged HvH helper flags cannot affect regular modes or Manual HvH, even with stale panel state',t=>{
 for(const mode of MODE_IDS){
  const {room}=makeRoom(mode,'flat');t.after(()=>room.close());const p=addPlayer(room,'Manual');room.startNow();
  p.hvhEnabled=mode!=='hvh';p.state=createMoveState(20,8,20);p.state.walkVz=-6;p.state.vy=-1;
  p.hvh.core!.fakeLag=12;
  room.handleInput(p,{...frame(1),autoHop:true,subtickStrafe:true});stepRoom(room);
  assert.equal(p.lastInput!.autoHop,false,mode);assert.equal(p.lastInput!.subtickStrafe,false,mode);
  assert.ok(Math.abs(p.state.horizontalSpeed-6)<1e-9,mode);
  const first=unpackPlayer(room.snapshot(performance.now(),99).p.find(v=>v[0]===p.pid)!);
  p.state.x+=1;
  const second=unpackPlayer(room.snapshot(performance.now(),99).p.find(v=>v[0]===p.pid)!);
  assert.ok(Math.abs(second.x-first.x-1)<.001,mode);
 }
});

it('assisted HvH accepts boolean subtick flags and rejects non-boolean values',t=>{
 const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const p=addPlayer(room,'Skeet');room.startNow();p.hvhEnabled=true;
 p.state=createMoveState(20,8,20);p.state.walkVz=-6;p.state.vy=-1;
 room.handleInput(p,{...frame(1),subtickStrafe:true});stepRoom(room);assert.equal(p.lastInput!.subtickStrafe,true);assert.ok(p.state.horizontalSpeed>6.03);
 room.handleInput(p,{...frame(2),subtickStrafe:'true',autoHop:1});stepRoom(room);
 assert.equal(p.lastInput!.subtickStrafe,false);assert.equal(p.lastInput!.autoHop,false);
});

it('switching to Manual invalidates assisted flags already waiting in the tick queue',t=>{
 const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const p=addPlayer(room,'Switcher');room.startNow();p.hvhEnabled=true;
 p.state=createMoveState(20,8,20);p.state.walkVz=-6;p.state.vy=-1;
 room.handleInput(p,{...frame(1),subtickStrafe:true,autoHop:true});p.hvhEnabled=false;stepRoom(room);
 assert.equal(p.lastInput!.subtickStrafe,false);assert.equal(p.lastInput!.autoHop,false);
 assert.ok(Math.abs(p.state.horizontalSpeed-6)<1e-9);
});

it('fake lag holds remote history, preserves own updates, and can break on accepted shots or disable immediately',t=>{
 for(const breakOnShot of [false,true]){
  const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const p=addPlayer(room,'Skeet'),viewer=addPlayer(room,'Viewer');room.startNow();place(p,20,20);place(viewer,20,10);
  p.hvhEnabled=true;p.hvh.core!.fakeLag=8;p.hvh.core!.fakeLagBreakOnShot=breakOnShot;
  let now=performance.now()+100;
  const read=(owner=false)=>unpackPlayer(room.snapshotFor(owner?p:viewer,now).p.find(v=>v[0]===p.pid)!);
  const stale=read();room.handleInput(p,frame(1));stepRoom(room,now+=SIM_DT*1000);
  assert.equal(read().z,stale.z);assert.ok(read(true).z<stale.z);
  room.handleFire(p,{shot:1,weapon:p.weapon,dx:0,dy:0,dz:-1,t:now,aiming:false});stepRoom(room,now+=SIM_DT*1000);
  assert.equal(p.lastShotSeq,1);
  assert.equal(read().simulationTime===stale.simulationTime,!breakOnShot);
  p.hvh.core!.fakeLag=0;assert.equal(read().simulationTime,p.simulationTime);
 }
});

it('respawn immediately invalidates a choked remote pose from the previous life',t=>{
 const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const p=addPlayer(room,'Skeet');room.startNow();place(p,20,20);
 p.hvhEnabled=true;p.hvh.core!.fakeLag=12;
 const now=performance.now(),read=()=>unpackPlayer(room.snapshot(now,99).p.find(v=>v[0]===p.pid)!);
 assert.equal(read().x,20);
 room.respawnPlayer(p,now);p.state.x=10;
 assert.equal(read().x,10);
});

it('peek fake lag refreshes an accepted shot even with Break on shot disabled',t=>{
 const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const p=addPlayer(room,'Peek');room.startNow();place(p,20,20);
 p.hvhEnabled=true;p.hvh.core!.fakeLag=12;p.hvh.core!.fakeLagMode='peek';p.hvh.core!.fakeLagBreakOnShot=false;
 let now=performance.now()+100;
 const read=()=>unpackPlayer(room.snapshot(now,99).p.find(v=>v[0]===p.pid)!);
 const old=read();room.handleInput(p,frame(1));stepRoom(room,now+=SIM_DT*1000);assert.equal(read().z,old.z);
 room.handleFire(p,{shot:1,weapon:p.weapon,dx:0,dy:0,dz:-1,t:now,aiming:false});stepRoom(room,now+=SIM_DT*1000);
 assert.equal(p.lastShotSeq,1);assert.equal(read().simulationTime,p.simulationTime);
});
