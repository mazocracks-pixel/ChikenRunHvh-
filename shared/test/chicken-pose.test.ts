import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildHvhMatrix, chickenHeadCenter, chickenHeadPose, defaultHvhLoadout, hvhPitch, defaultSkeetAntiAim,
  rayChicken, rayHvhChicken, rayHvhMatrix, makeRay, normalize, pointSafety, hvhHitchance, hvhWeapon, WEAPONS,
  CollisionWorld, ResolverSystem, scanRage, planAutoStop, DEFAULT_RAGE, maximumBodyDelta, wrapAngle, type ObservableRecord } from '../src';

const origin = { x: 0, y: 0, z: 0 };
const direction = (eye: typeof origin, p: typeof origin) => normalize({x:p.x-eye.x,y:p.y-eye.y,z:p.z-eye.z});
const record = (t = 100): ObservableRecord => ({pid:2,tick:Math.round(t/15.625),t,origin,velocity:{...origin},eyeYaw:0,
  lowerBodyYaw:0.4,speed:0,crouch:0,grounded:true,turnWeight:0,alive:true,hp:100,armor:0,fired:false,concealed:false,defensive:false,pitch:-1.15});

it('one physical skeleton follows yaw, pitch and crouch in normal and HvH hit detection', () => {
  for (const yaw of [0,Math.PI/2,-2]) for (const pitch of [-1.2,0,1.2]) for (const scale of [1,0.7]) {
    const matrix=buildHvhMatrix(origin,yaw,scale,pitch),head=matrix.boxes[0]!;
    assert.deepEqual(head.center,chickenHeadCenter(origin,yaw,scale,pitch));
    const eye={x:head.center.x-10*Math.sin(yaw),y:head.center.y,z:head.center.z-10*Math.cos(yaw)};
    const ray=makeRay(eye,direction(eye,head.center));
    const normal=rayChicken(ray,0,0,0,yaw,20,scale,pitch),hvh=rayHvhChicken(ray,0,0,0,yaw,20,scale,pitch);
    assert.deepEqual(normal,hvh);assert.ok(normal?.headshot);
    assert.ok(Math.abs(normal!.t-(10-head.radius))<1e-8);
  }
  const a=chickenHeadCenter(origin,0),b=chickenHeadCenter(origin,Math.PI/2);
  assert.ok(Math.abs(a.z-b.x)<1e-8);assert.equal(chickenHeadCenter(origin,0,0.7).y,a.y*0.7);
});

it('bounded down pitch hides the head behind the torso from the rear while remaining hittable from the front', () => {
  const neutral=buildHvhMatrix(origin,0),down=buildHvhMatrix(origin,0,1,-1.15),head=down.boxes[0]!.center;
  assert.ok(head.y<neutral.boxes[0]!.center.y-0.2);
  const rear={x:0,y:1.3,z:10},front={x:0,y:1.3,z:-10};
  const rearHit=rayHvhMatrix(makeRay(rear,direction(rear,head)),down,20);
  assert.ok(rearHit);assert.equal(rearHit.headshot,false);
  assert.equal(pointSafety(rear,head,[down],['head']),0);
  assert.equal(rayHvhMatrix(makeRay(front,direction(front,head)),down,20)?.headshot,true);
  assert.deepEqual(chickenHeadPose(Infinity),chickenHeadPose(0));
  assert.deepEqual(chickenHeadPose(-100),chickenHeadPose(-1.2));
  const loadout=defaultHvhLoadout();loadout.antiAim.enabled=true;loadout.antiAim.pitch='down';
  assert.equal(hvhPitch(0,loadout),-1.15);assert.equal(hvhPitch(0.4,loadout,true),0.4);
  loadout.skeet=defaultSkeetAntiAim();loadout.skeet.visualPitch='up';assert.equal(hvhPitch(0,loadout),0.85);
});

it('resolver trusts moving public body updates, deduplicates guesses and keeps feedback decay monotonic', () => {
  const resolver=new ResolverSystem(),r={...record(),speed:2,pitch:0};resolver.observe(r);
  const moving=resolver.resolve(r);assert.equal(moving.hypotheses[0]!.source,'BODY_UPDATE');assert.ok(moving.confidence>0.9);
  assert.ok(Math.abs(wrapAngle(moving.hypotheses[0]!.yaw-r.lowerBodyYaw))<1e-8);
  for (const a of moving.hypotheses) for(const b of moving.hypotheses) if(a!==b)assert.ok(Math.abs(wrapAngle(a.yaw-b.yaw))>=0.06);
  const still={...r,t:200,speed:0};resolver.observe(still);
  resolver.feedback(2,'LEFT','RESOLVER',400);
  const before=resolver.resolve(still).hypotheses.find(h=>h.source==='LEFT')!.probability;
  for(let i=0;i<40;i++){resolver.resolve(r);resolver.resolve(still);}
  assert.equal(resolver.resolve(still).hypotheses.find(h=>h.source==='LEFT')!.probability,before);
});

it('spread probability includes resolver uncertainty instead of guaranteeing the selected head guess', () => {
  const d=maximumBodyDelta(0,0,true),left=buildHvhMatrix(origin,-d),right=buildHvhMatrix(origin,d);
  const eye={x:0,y:1.3,z:15},point=right.boxes[0]!.center,world=new CollisionWorld(100),w={...hvhWeapon(WEAPONS.sniper),spread:0,moveSpread:0,airSpread:0};
  const aim=direction(eye,point);
  const certain=hvhHitchance(w,eye,aim,right,0,false,true,world);
  const uncertain=hvhHitchance(w,eye,aim,right,0,false,true,world,undefined,32,0,[{matrix:left,probability:0.5},{matrix:right,probability:0.5}]);
  assert.equal(certain.chance,1);assert.equal(uncertain.chance,0.5);
});

it('scanner finds reliable body shots against tucked desync heads and can prepare scope and stop together', () => {
  const r={...record(),origin:{x:0,y:0,z:-25}},resolver=new ResolverSystem();resolver.observe(r);
  const input={now:150,eye:{x:0,y:1.3,z:10},w:hvhWeapon(WEAPONS.rifle),speed:0,airborne:false,ads:false,
    world:new CollisionWorld(100),records:[r],resolver,settings:{...DEFAULT_RAGE,minDamage:10,hitchance:0.6,forceSafe:true,preferBodyBelow:0.5}};
  const body=scanRage(input);assert.ok(body);assert.notEqual(body.group,'head');assert.equal(body.safety,1);assert.ok(body.chance>=0.6);
  const weapon={...hvhWeapon(WEAPONS.sniper),spread:0.02};
  const sniper=scanRage({...input,speed:6,w:weapon,settings:{...input.settings,hitchance:0.9}});
  assert.ok(sniper?.stop&&sniper.scope,'moving sniper prepares a combined scoped stationary shot');
  assert.equal(scanRage({...input,speed:6,w:weapon,allowStop:false,settings:{...input.settings,hitchance:0.9}}),null);
  const ready=scanRage({...input,stopSpeed:2.7,settings:{...input.settings,hitchance:0.95}});
  assert.ok(ready&&!ready.stop);assert.equal(ready.stopSpeed,0,'a ready stationary shot must preserve the fallback instead of restarting inaccurate walking');
  assert.equal(planAutoStop({autoStop:true,autoStopSlowWalk:true,autoStopBetweenShots:true,autoStopPredict:false,autoStopPredictMs:200},
    {assistedHvh:true,grounded:true,jumping:false,occupied:false,engaged:true,weaponState:'Ready',target:true,stopSpeed:ready.stopSpeed,forecast:null}).kind,'counter');
});
