import assert from 'node:assert/strict';
import { it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { DEFAULT_MODS, HVH, PLAYER, SIM_DT, WEAPONS, defaultHvhLoadout, sanitizeMods, unpackPlayer, type ClientToServerEvents, type DevAction, type DevStatus, type JoinResponse, type ServerToClientEvents } from '@game/shared';
import { startGameServer } from '../src/app';
import { runDevAction } from '../src/dev/devActions';
import { addPlayer, makeRoom, place } from './helpers';
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;
it('HvH setup stages a human outside combat and spawns only once after a valid choice',async t=>{
  const server=await startGameServer({port:0,dbPath:':memory:',guestsPerHour:1000});t.after(()=>server.close());
  const base=`http://localhost:${server.port}`;
  const auth=await fetch(`${base}/api/auth/guest`,{method:'POST',headers:{'x-session-transport':'token'}});
  const {token}=await auth.json() as {token:string};
  const c:Client=connect(base,{transports:['websocket'],auth:{token},reconnection:false});t.after(()=>c.disconnect());
  await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);});
  const joined:JoinResponse=await c.timeout(3000).emitWithAck('createRoom',{mode:'hvh',map:'farm',private:true,bots:0});
  assert.ok(joined.ok);if(!joined.ok)return;
  const room=server.rooms.roomOf(c.id!)!,p=room.playerFor(c.id!)!;
  assert.equal(p.hvhPreparing,true);assert.equal(p.alive,false);
  assert.equal(unpackPlayer(joined.snapshot.p.find(s=>s[0]===joined.selfPid)!).hvhPreparing,true);
  room.handleInput(p,{seq:1,forward:1,right:0,jump:false,yaw:0,pitch:0});
  room.handleFire(p,{shot:1,weapon:p.weapon,dx:0,dy:0,dz:-1,t:performance.now(),aiming:false});
  assert.equal(p.state.horizontalSpeed,0);assert.equal(p.lastShotSeq,0);
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(p.alive,false,'room ticks must not auto-spawn setup players');
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady','unknown' as never)).ok,false);
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady','lab')).ok,false,'public flag is off');
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady','skeet')).ok,false,'Skeet uses the same access gate');
  assert.equal(p.alive,false);
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady','manual')).ok,true);
  assert.equal(p.hvhPreparing,false);assert.equal(p.alive,true);assert.equal(p.hvhEnabled,false);
  p.hp=40;p.mags.set(p.weapon,5);const charge=p.exploit.readyAt;
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady','manual')).ok,true);
  assert.equal(p.hp,40);assert.equal(p.mag,5);assert.equal(p.exploit.readyAt,charge,'repeat choices cannot refill health, ammo or charge');
  await c.timeout(3000).emitWithAck('createRoom',{mode:'ffa',map:'farm',private:true,bots:0});
  assert.equal((await c.timeout(3000).emitWithAck('hvhReady','manual')).ok,false);
});
const actions=(pid:number):DevAction[]=>[
  {kind:'teleport',x:20,y:40,z:20},{kind:'teleportToPlayer',target:pid},{kind:'bringPlayer',target:pid},
  {kind:'freeze',target:pid,frozen:true},{kind:'respawn',target:pid},{kind:'health',target:pid,amount:500},
  {kind:'armor',target:pid,value:100},{kind:'giveWeapon',target:pid,weapon:'rocket'},
  {kind:'removeWeapon',target:pid,weapon:'rifle'},{kind:'refill',target:pid},
];
it('HvH rejects every administration action and clears forged movement, ammo, immunity and damage modifiers',t=>{
  const {room}=makeRoom('hvh','flat');t.after(()=>room.close());
  const a=addPlayer(room,'A'),b=addPlayer(room,'B');room.startNow();a.shieldUntil=b.shieldUntil=0;place(a,20,20);place(b,20,10);
  const baseline={x:b.state.x,y:b.state.y,z:b.state.z,hp:b.hp,armor:b.armor,loadout:[...b.info.loadout]};
  for(const action of actions(b.pid))assert.equal(runDevAction(room,a,action).ok,false);
  assert.deepEqual({x:b.state.x,y:b.state.y,z:b.state.z,hp:b.hp,armor:b.armor,loadout:b.info.loadout},baseline);
  a.mods=sanitizeMods({speed:5,noclip:true,damage:20,infiniteAmmo:true,noRocketDamage:true,instantReload:true});a.frozen=true;
  room.handleInput(a,{seq:1,forward:1,right:0,jump:false,yaw:0,pitch:0});
  assert.equal(a.mods,null);assert.equal(a.frozen,false);assert.ok(Math.abs(a.state.z-(20-PLAYER.speed*SIM_DT))<0.001);
  a.mods=sanitizeMods({damage:20});b.mods=sanitizeMods({noRocketDamage:true});
  room.damage(b,a,10,false,'rocket',{x:0,y:0,z:0},performance.now());assert.equal(b.hp,90);assert.equal(a.mods,null);assert.equal(b.mods,null);
  a.mods=sanitizeMods({infiniteAmmo:true,fireRate:10,spread:0,magazine:10});a.mags.set(a.weapon,999);
  room.handleFire(a,{shot:1,weapon:a.weapon,dx:1,dy:0,dz:0,t:performance.now(),aiming:false});
  assert.equal(a.mag,WEAPONS[a.weapon].magazine-1);assert.equal(a.mods,null);
});
it('server Double Tap accepts exactly two timed shots with normal ammo, then enforces the original cooldown',t=>{
  const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const a=addPlayer(room,'A');
  a.info.loadout=['sniper'];a.weaponSlot=0;a.mags.set('sniper',5);a.hvhEnabled=true;a.hvh.exploit='doubleTap';a.exploit.readyAt=0;
  const fire=(shot:number)=>room.handleFire(a,{shot,weapon:'sniper',dx:1,dy:0,dz:0,t:performance.now(),aiming:false});
  fire(1);assert.equal(a.mag,4);const spent=a.exploit.readyAt;
  a.lastFireAt=performance.now()-100;fire(2);assert.equal(a.lastShotSeq,1,'cannot fire second before 260 ms');
  a.lastFireAt=performance.now()-270;fire(2);assert.equal(a.lastShotSeq,2);assert.equal(a.mag,3);
  a.lastFireAt=performance.now()-270;fire(3);assert.equal(a.lastShotSeq,2,'third needs original sniper cooldown');
  assert.equal(a.exploit.readyAt,spent);assert.ok(spent>performance.now()+7000);
  a.hvh.exploit='hideShots';fire(3);assert.equal(a.lastShotSeq,2,'changing exploit cannot bypass timer');
  a.reloadUntil=performance.now()+100; a.lastFireAt=-Infinity;fire(3);assert.equal(a.lastShotSeq,2,'reloading still blocks shots');
});
it('real and fake poses replicate separately; Hide Shots delays reveal without changing hitboxes or damage',t=>{
  const {room}=makeRoom('hvh','flat');t.after(()=>room.close());const a=addPlayer(room,'A');
  a.hvhEnabled=true;a.hvh={antiAim:{enabled:true,mode:'backward',desync:58,jitter:0,spinSpeed:180},exploit:'hideShots'};a.exploit.readyAt=0;
  room.handleInput(a,{seq:1,forward:0,right:0,jump:false,yaw:0,pitch:0});
  assert.notEqual(a.yaw,a.fakeYaw);assert.equal(a.lookYaw,0);
  room.handleFire(a,{shot:1,weapon:a.weapon,dx:0,dy:0,dz:-1,t:performance.now(),aiming:false});
  assert.ok(a.concealUntil>performance.now());assert.notEqual(a.yaw,a.fakeYaw);
  room.updateHvhPose(a,a.concealUntil+1);assert.equal(a.yaw,0);assert.equal(a.fakeYaw,0,'reveal starts after hide window');
  room.updateHvhPose(a,a.revealUntil+1);assert.notEqual(a.yaw,a.fakeYaw);
  assert.ok(Math.abs(a.revealUntil-a.concealUntil-HVH.revealMs)<1e-6,'reveal window'); // timestamps are floats
  const state=a.toState();assert.equal(state.yaw,a.yaw);assert.equal(state.fakeYaw,a.fakeYaw);
});
it('public panel grants only HvH capabilities and never administrative privilege',async t=>{
  const server=await startGameServer({port:0,dbPath:':memory:',publicHvhPanel:true,guestsPerHour:1000});t.after(()=>server.close());
  const base=`http://localhost:${server.port}`;
  const auth=await fetch(`${base}/api/auth/guest`,{method:'POST',headers:{'x-session-transport':'token'}});const {token}=await auth.json() as {token:string};
  const c:Client=connect(base,{transports:['websocket'],auth:{token},reconnection:false});t.after(()=>c.disconnect());
  await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);});
  const status=()=>c.timeout(3000).emitWithAck('devStatus');
  assert.equal((await status()).granted,false);assert.equal((await status()).publicHvh,true);
  const join:JoinResponse=await c.timeout(3000).emitWithAck('createRoom',{mode:'hvh',map:'farm',private:false,bots:0});assert.ok(join.ok);if(!join.ok)return;
  const s:DevStatus=await c.timeout(3000).emitWithAck('devMods',{damage:20,infiniteAmmo:true,noclip:true});
  assert.equal(s.granted,true);assert.equal(s.allowedHere,true);assert.equal(s.profile,'hvh');assert.deepEqual(s.mods,DEFAULT_MODS);
  const altered=await c.timeout(3000).emitWithAck('devHvh',{antiAim:{enabled:true,mode:'backward',desync:999,jitter:999,spinSpeed:9999},exploit:'doubleTap'});
  assert.equal(altered.hvh?.antiAim.desync,58);assert.equal(altered.hvh?.antiAim.jitter,45);assert.equal(altered.hvh?.antiAim.spinSpeed,540);
  for(const action of actions(join.selfPid))assert.equal((await c.timeout(3000).emitWithAck('devAction',action)).ok,false);
  await c.timeout(3000).emitWithAck('createRoom',{mode:'sandbox',map:'flat',private:true});
  assert.equal((await status()).granted,false);assert.equal((await status()).profile,'off');
  const denied=await c.timeout(3000).emitWithAck('devHvh',{...defaultHvhLoadout(),exploit:'doubleTap'});assert.equal(denied.allowedHere,false);
});
it('public rollout stays off by default, and passkey HvH still uses shared rules',async t=>{
  const server=await startGameServer({port:0,dbPath:':memory:',devPasskey:'test-secret',guestsPerHour:1000});t.after(()=>server.close());
  const base=`http://localhost:${server.port}`;
  const auth=await fetch(`${base}/api/auth/guest`,{method:'POST',headers:{'x-session-transport':'token'}});const {token}=await auth.json() as {token:string};
  const c:Client=connect(base,{transports:['websocket'],auth:{token},reconnection:false});t.after(()=>c.disconnect());
  await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);});
  const joined:JoinResponse=await c.timeout(3000).emitWithAck('createRoom',{mode:'hvh',map:'farm',private:true,bots:0});assert.ok(joined.ok);
  assert.equal((await c.timeout(3000).emitWithAck('devStatus')).granted,false);
  await c.timeout(3000).emitWithAck('devAuth','test-secret');
  const s=await c.timeout(3000).emitWithAck('devMods',{infiniteAmmo:true,damage:20});assert.equal(s.profile,'hvh');assert.deepEqual(s.mods,DEFAULT_MODS);assert.equal(s.publicHvh,false);
});
