import assert from 'node:assert/strict';
import { it } from 'node:test';
import { chickenHeadCenter, normalize, PLAYER, SIM_DT, WEAPONS, unpackPlayer, type ShotEvent } from '@game/shared';
import { History } from '../src/rooms/History';
import { addPlayer, makeRoom, place, stepRoom } from './helpers';

it('lag history interpolates physical pitch with yaw and crouch scale', () => {
  const h=new History(),base={x:0,y:0,z:0,yaw:0,alive:true,scale:1};
  h.push({...base,t:100,pitch:0});h.push({...base,t:200,pitch:-1.2,scale:0.7});
  assert.equal(h.at(150)?.pitch,-0.6);assert.equal(h.at(150)?.scale,0.85);
});

it('never interpolates through a teleport but can hit an exact known pose after it', () => {
  const h = new History(), base = { x: 0, y: 0, z: 0, yaw: 0, alive: true, scale: 1 };
  h.push({ ...base, t: 100 }); h.push({ ...base, x: 20, t: 200 }); h.push({ ...base, x: 20, t: 216 });
  assert.equal(h.atValid(150, 216), null);
  assert.equal(h.atValid(200, 216)?.x, 20);
  assert.equal(h.atValid(208, 216)?.x, 20);
});

it('ordinary and Manual HvH shots hit the same pitched head using rewound pitch', t => {
  for(const mode of ['ffa','hvh'] as const){
    const {room,events}=makeRoom(mode,'flat');t.after(()=>room.close());
    const a=addPlayer(room,'Shooter'),b=addPlayer(room,'Head pose');room.startNow();a.info.team=1;b.info.team=2;
    place(a,20,10);place(b,20,18);a.shieldUntil=b.shieldUntil=0;b.armor=0;
    let now=performance.now()+2;
    room.handleInput(b,{seq:1,forward:0,right:0,jump:false,yaw:0,pitch:-1.15});stepRoom(room,now);
    const point=chickenHeadCenter(b.state,0,1,-1.15),aim=normalize({x:point.x-a.state.x,y:point.y-PLAYER.eyeHeight,z:point.z-a.state.z});
    // Looking up now must not move the earlier shot's historical head.
    room.handleInput(b,{seq:2,forward:0,right:0,jump:false,yaw:0,pitch:1.2});stepRoom(room,now+SIM_DT*1000);
    room.handleFire(a,{shot:1,weapon:a.weapon,dx:aim.x,dy:aim.y,dz:aim.z,t:now,aiming:true});stepRoom(room,now+SIM_DT*2000);
    const shot=events.filter(e=>e.event==='shot').at(-1)?.args[0] as ShotEvent;
    assert.ok(shot);assert.equal(shot.hits[0],2,mode);assert.ok(b.hp<100||!b.alive);
  }
});

it('low horizontal velocity jump scouts hit instantly without scope or a heat penalty in ordinary and HvH matches', t => {
  for (const mode of ['ffa','hvh'] as const) for (const aiming of [false,true]) for (const shotSeq of [1,4177]) {
    const {room,events}=makeRoom(mode,'flat');t.after(()=>room.close());
    const a=addPlayer(room,'Jump scout'),b=addPlayer(room,'Distant target');room.startNow();a.info.team=1;b.info.team=2;
    a.info.loadout=['scout'];a.weaponSlot=0;a.mags.set('scout',WEAPONS.scout.magazine);
    place(a,20,25,2);place(b,20,-30);a.shieldUntil=b.shieldUntil=0;
    a.state.horizontalSpeed=0.1;a.state.vy=6;a.weaponHeat=3;
    const point=chickenHeadCenter(b.state,b.yaw,1,b.pitch),eye={x:a.state.x,y:a.state.y+PLAYER.eyeHeight,z:a.state.z};
    const d=normalize({x:point.x-eye.x,y:point.y-eye.y,z:point.z-eye.z}),now=performance.now();
    room.handleFire(a,{shot:shotSeq,weapon:'scout',dx:d.x,dy:d.y,dz:d.z,t:now,aiming});
    if (mode==='hvh') stepRoom(room,now);
    const shot=events.filter(e=>e.event==='shot').at(-1)?.args[0] as ShotEvent;
    assert.ok(shot);assert.equal(shot.hits[0],2,`${mode}: scoped=${aiming} seed=${shotSeq}`);
    assert.ok(b.hp<100||!b.alive,'damage is applied in the same authoritative fire step');
  }
});

it('HvH anti-aim down pitch is physical, public, bounded and absent from ordinary mode', t => {
  for(const mode of ['ffa','hvh'] as const){
    const {room}=makeRoom(mode,'flat');t.after(()=>room.close());const p=addPlayer(room,'Pitch');room.startNow();place(p,20,20);
    p.hvhEnabled=mode==='hvh';p.hvh.antiAim.enabled=true;p.hvh.antiAim.pitch='down';
    room.handleInput(p,{seq:1,forward:0,right:0,jump:false,yaw:0,pitch:0.3});const now=performance.now()+2;stepRoom(room,now);
    const state=unpackPlayer(room.snapshot(now,p.pid).p[0]!);assert.ok(Math.abs((state.fakePitch??0)-(mode==='hvh'?-1.15:0.3))<0.01);
    assert.equal(p.history.at(now)?.pitch,mode==='hvh'?-1.15:0.3);
  }
});

it('rear shots at a tucked head deal body damage in ordinary and HvH modes', t => {
  for(const mode of ['ffa','hvh'] as const){
    const {room,events}=makeRoom(mode,'flat');t.after(()=>room.close());
    const a=addPlayer(room,'Rear shooter'),b=addPlayer(room,'Tucked');room.startNow();a.info.team=1;b.info.team=2;
    place(a,20,28);place(b,20,18);a.shieldUntil=b.shieldUntil=0;b.armor=0;
    const now=performance.now()+2;
    room.handleInput(b,{seq:1,forward:0,right:0,jump:false,yaw:0,pitch:-1.15});stepRoom(room,now);
    const point=chickenHeadCenter(b.state,0,1,-1.15),aim=normalize({x:point.x-a.state.x,y:point.y-PLAYER.eyeHeight,z:point.z-a.state.z});
    room.handleFire(a,{shot:1,weapon:a.weapon,dx:aim.x,dy:aim.y,dz:aim.z,t:now,aiming:true});stepRoom(room,now+SIM_DT*1000);
    const shot=events.filter(e=>e.event==='shot').at(-1)?.args[0] as ShotEvent;
    assert.equal(shot.hits[0],1);assert.ok(b.hp<100&&b.hp>60,'torso obstruction removes the head damage bonus');
  }
});

it('practice bots start with moderate desync and ordinary shots instead of free Double Tap', t => {
  const {room}=makeRoom('hvh','flat');t.after(()=>room.close());addPlayer(room,'Human');
  for(let i=0;i<3;i++)room.bots.add();
  for(const p of room.players.values())if(p.info.bot){assert.equal(p.hvh.exploit,'off');assert.ok(p.hvh.antiAim.desync<=45);
    for(const s of Object.values(p.hvh.skeet!.states))assert.ok(s.desync<=45&&s.jitter<=12);
  }
});
