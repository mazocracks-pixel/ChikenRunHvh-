import assert from 'node:assert/strict';
import {it} from 'node:test';
import {autoStopInput,planAutoStop,predictEnemyPeek,CollisionWorld,createMoveState,stepPlayer,SIM_DT,PLAYER,WEAPONS,hvhWeapon,
  scanRage,DEFAULT_RAGE,ResolverSystem,type ObservableRecord,type AutoStopOptions,type AutoStopContext} from '../src/index';
const options:AutoStopOptions={autoStop:true,autoStopSlowWalk:false,autoStopBetweenShots:true,autoStopPredict:true,autoStopPredictMs:200};
const context:AutoStopContext={assistedHvh:true,grounded:true,jumping:false,occupied:false,engaged:true,weaponState:'Ready',target:true,forecast:null};
const frame={seq:1,forward:1,right:0,jump:false,yaw:0,pitch:0};
const record=(t=1000,x=1.5,vx=6):ObservableRecord=>({pid:2,t,tick:Math.round(t/15.625),origin:{x,y:0,z:8},velocity:{x:vx,y:0,z:0},
  eyeYaw:0,lowerBodyYaw:0,speed:Math.abs(vx),crouch:0,grounded:true,turnWeight:0,hp:100,armor:0,alive:true,fired:false,concealed:false,defensive:false});
const covered=()=>new CollisionWorld(100,[{minX:-2,maxX:1.25,minY:0,maxY:4,minZ:3.8,maxZ:4.2}]);
const prediction=(world=covered(),records=[record(),record(950,1.2)])=>({now:1000,eye:{x:0,y:1.3,z:0},view:{x:0,y:0,z:1},fov:360,range:100,horizonMs:200,records,world});

it('slow-walk auto stop keeps movement intent and reaches native walking speed without editing velocity',()=>{
 const s=createMoveState(0,0,0);s.walkVz=-6;const world=new CollisionWorld(100),plan=planAutoStop({...options,autoStopSlowWalk:true},context);
 assert.equal(plan.kind,'slowwalk');const out=autoStopInput(frame,s,plan);assert.equal(out.forward,1);assert.equal(out.right,0);assert.equal(out.slowWalk,true);assert.equal(s.walkVz,-6);
 for(let i=0;i<50;i++)stepPlayer(s,autoStopInput(frame,s,plan),SIM_DT,world,null,.1,1,true);
 assert.ok(Math.abs(s.horizontalSpeed-PLAYER.speed*PLAYER.slowWalkSpeed)<1e-8);
});
it('counter-stop uses real momentum including knockback and leaves camera angles unchanged',()=>{
 const s=createMoveState(0,0,0);s.walkVz=-4;s.vx=2;
 const out=autoStopInput({...frame,yaw:.7,pitch:.2},s,planAutoStop(options,context));assert.equal(out.yaw,.7);assert.equal(out.pitch,.2);
 const x=-Math.sin(out.yaw)*out.forward+Math.cos(out.yaw)*out.right,z=-Math.cos(out.yaw)*out.forward-Math.sin(out.yaw)*out.right;
 assert.ok(x*s.vx+z*s.walkVz<0);assert.deepEqual([s.vx,s.walkVz],[2,-4]);
});
it('Between shots independently controls cooldown stops and never interferes with reload or weapon switching',()=>{
 const cooldown={...context,weaponState:'Cooldown' as const};assert.equal(planAutoStop(options,cooldown).reason,'between-shots');
 assert.equal(planAutoStop({...options,autoStopBetweenShots:false},cooldown).kind,'off');
 assert.equal(planAutoStop({...options,autoStopBetweenShots:false},context).kind,'counter');
 for(const weaponState of ['Reloading','Switching weapon','Empty'] as const)assert.equal(planAutoStop(options,{...context,weaponState}).kind,'off');
});
it('prediction and slow-walk combine before a peek, and a stationary-accuracy shot can override slow walking',()=>{
 const o={...options,autoStopSlowWalk:true},forecast={target:2,observedAt:1000,etaMs:175,origin:{x:2.7,y:0,z:8}};
 assert.deepEqual(planAutoStop(o,{...context,target:false,forecast}),{kind:'slowwalk',reason:'predicted-peek'});
 assert.equal(planAutoStop({...o,autoStopPredict:false},{...context,target:false,forecast}).kind,'off');
 assert.equal(planAutoStop(o,{...context,stopSpeed:0}).kind,'counter');assert.equal(planAutoStop(o,{...context,stopSpeed:2.7}).kind,'slowwalk');
});
it('auto-stop options cannot move an ordinary/Manual player, interfere with jumps or take over peek return',()=>{
 for(const change of [{assistedHvh:false},{grounded:false},{jumping:true},{occupied:true},{engaged:false}]){
  const plan=planAutoStop(options,{...context,...change});assert.equal(plan.kind,'off');assert.equal(autoStopInput(frame,createMoveState(0,0,0),plan),frame);
 }
 assert.equal(planAutoStop({...options,autoStop:false},context).kind,'off');
});
it('recent public velocity forecasts a cover-edge peek without mutating records or creating an aim target',()=>{
 const input=prediction(),before=structuredClone(input.records),forecast=predictEnemyPeek(input);assert.ok(forecast);
 assert.equal(forecast.target,2);assert.ok(forecast.etaMs>100&&forecast.etaMs<=200);assert.ok(forecast.origin.x>2.6);assert.equal(forecast.observedAt,1000);
 assert.deepEqual(input.records,before);
 const resolver=new ResolverSystem();input.records.forEach(r=>resolver.observe(r));
 assert.equal(scanRage({now:1000,eye:input.eye,w:hvhWeapon(WEAPONS.rifle),speed:6,airborne:false,ads:false,world:input.world,
  records:input.records,resolver,settings:{...DEFAULT_RAGE,hitchance:0,minDamage:1}}),null,'the future forecast is not an exposed enemy shot record');
});
it('forecast obeys collision and cannot extrapolate a chicken through a thin blocking wall',()=>{
 const world=covered();world.add(2,{minX:2,maxX:2.05,minY:0,maxY:4,minZ:7,maxZ:9});assert.equal(predictEnemyPeek(prediction(world)),null);
});
it('peek forecasting reads only public motion fields even when observations contain private extras',()=>{
 const input=prediction();
 for(const r of input.records){
  Object.defineProperty(r,'bodyYaw',{enumerable:true,get(){throw Error('private orientation accessed');}});
  Object.defineProperty(r.origin,'authoritativePosition',{enumerable:true,get(){throw Error('private motion accessed');}});
 }
 assert.ok(predictEnemyPeek(input));
});
it('forecast rejects stale, single-sample, stationary, reversed, teleported and dead observations',()=>{
 const variants=[{...prediction(),now:1250},prediction(covered(),[record()]),prediction(covered(),[record(1000,1.5,0),record(950,1.5,0)]),
  prediction(covered(),[record(),record(950,1.2,-6)]),prediction(covered(),[record(),record(950,-5)]),prediction(covered(),[{...record(),alive:false},record(950,1.2)])];
 for(const input of variants)assert.equal(predictEnemyPeek(input),null);
});
it('forecast respects range, FOV, look-ahead and current cover instead of pre-stopping for every moving enemy',()=>{
 const input=prediction();assert.equal(predictEnemyPeek({...input,horizonMs:100}),null);assert.equal(predictEnemyPeek({...input,range:4}),null);
 assert.equal(predictEnemyPeek({...input,fov:20}),null);assert.equal(predictEnemyPeek(prediction(new CollisionWorld(100))),null);
});
it('slow-walk shot estimation selects walking accuracy when sufficient and stationary accuracy when required',()=>{
 const world=new CollisionWorld(100),resolver=new ResolverSystem(),r={...record(),origin:{x:0,y:0,z:20},velocity:{x:0,y:0,z:0},speed:0};resolver.observe(r);
 const input={now:1000,eye:{x:0,y:1.3,z:0},w:hvhWeapon(WEAPONS.rifle),speed:6,airborne:false,ads:false,world,records:[r],resolver,
  stopSpeed:2.7,settings:{...DEFAULT_RAGE,resolver:false,preferSafe:false,groups:['chest'] as const,minDamage:1,hitchance:.4}};
 const walking=scanRage({...input,settings:{...input.settings,groups:['chest']}});
 assert.ok(walking?.stop);assert.equal(walking.stopSpeed,2.7);
 const stationary=scanRage({...input,settings:{...input.settings,groups:['chest'],hitchance:1}});
 assert.ok(stationary?.stop);assert.equal(stationary.stopSpeed,0);
});
it('keeps stationary auto stop when slow walking meets hitchance but misses HP-relative damage',()=>{
 const r={...record(),origin:{x:0,y:0,z:15},velocity:{x:0,y:0,z:0},speed:0,hp:70},resolver=new ResolverSystem();resolver.observe(r);
 const input={now:1000,eye:{x:0,y:1.3,z:0},w:hvhWeapon(WEAPONS.rifle),speed:0,airborne:false,ads:false,world:new CollisionWorld(100),records:[r],resolver,
  stopSpeed:2.7,settings:{...DEFAULT_RAGE,resolver:false,preferSafe:false,groups:['head'] as const,pointScale:0,minDamage:1,hpRelative:0,hitchance:.6}};
 const stationary=scanRage({...input,settings:{...input.settings,groups:['head']}});
 assert.ok(stationary);assert.ok(stationary.damage>=70);assert.equal(stationary.stopSpeed,0);
 const moving=scanRage({...input,speed:2.7,settings:{...input.settings,groups:['head']}});
 assert.ok(moving?.stop);assert.equal(moving.stopSpeed,0);assert.ok(moving.damage>=70);
 assert.equal(scanRage({...input,speed:2.7,allowStop:false,settings:{...input.settings,groups:['head']}}),null);
});
it('scopes when unscoped hitchance passes but HP-relative damage fails',()=>{
 const r={...record(),origin:{x:0,y:0,z:15},velocity:{x:0,y:0,z:0},speed:0,hp:150},resolver=new ResolverSystem();resolver.observe(r);
 const input={now:1000,eye:{x:0,y:1.3,z:0},w:hvhWeapon(WEAPONS.sniper),speed:2.7,airborne:false,ads:false,world:new CollisionWorld(100),records:[r],resolver,
  allowStop:false,settings:{...DEFAULT_RAGE,resolver:false,preferSafe:false,groups:['head'] as const,pointScale:0,minDamage:1,hpRelative:0,hitchance:.3}};
 const scoped=scanRage({...input,settings:{...input.settings,groups:['head']}});
 assert.ok(scoped?.scope);assert.ok(scoped.damage>=150);
 assert.equal(scanRage({...input,allowScope:false,settings:{...input.settings,groups:['head']}}),null);
});
