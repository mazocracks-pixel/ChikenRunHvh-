import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HvhExploitClock, HVH, WEAPONS, defaultHvhLoadout, hvhPose, sanitizeHvhLoadout, wrapAngle } from '../src';

it('desync is bounded, inverted, revealed, and has a separate real heading', () => {
  const l=sanitizeHvhLoadout({antiAim:{enabled:true,mode:'backward',desync:500,jitter:500,spinSpeed:Infinity},exploit:'evil'});
  assert.equal(l.antiAim.desync,58); assert.equal(l.antiAim.jitter,45); assert.equal(l.exploit,'off');
  const a=hvhPose(0,l,1000,false,false),b=hvhPose(0,l,1000,true,false);
  assert.ok(Math.abs(wrapAngle(a.fake-a.real)-58*Math.PI/180)<1e-9);
  assert.ok(Math.abs(wrapAngle(b.fake-b.real)+58*Math.PI/180)<1e-9);
  assert.deepEqual(hvhPose(0.8,l,1000,false,true),{real:0.8,fake:0.8});
  assert.deepEqual(hvhPose(0.8,defaultHvhLoadout(),1000,false,false),{real:0.8,fake:0.8});
});
it('Double Tap grants one extra normal bullet, then the normal interval and eight-second recharge', () => {
  const c=new HvhExploitClock(); c.reset(0);
  assert.equal(c.charge(0),0); assert.equal(c.charge(8000),1);
  c.fired(WEAPONS.sniper,'doubleTap',8000);
  assert.equal(c.interval(WEAPONS.sniper,'doubleTap',8100),260);
  c.fired(WEAPONS.sniper,'doubleTap',8260);
  assert.equal(c.interval(WEAPONS.sniper,'doubleTap',8300),1300);
  assert.equal(c.readyAt,16000);
  c.fired(WEAPONS.sniper,'hideShots',8500);
  assert.equal(c.readyAt,16000,'changing exploit cannot refill charge');
});
it('missed windows, weapon changes, mode toggles and explosive weapons cannot create extra burst shots', () => {
  const c=new HvhExploitClock();c.fired(WEAPONS.rifle,'doubleTap',1000);
  assert.equal(c.interval(WEAPONS.rifle,'doubleTap',1600),WEAPONS.rifle.fireInterval);
  c.readyAt=2000;c.fired(WEAPONS.sniper,'doubleTap',2000);
  c.fired(WEAPONS.pistol,'off',2250);
  assert.equal(c.interval(WEAPONS.sniper,'doubleTap',2251),1300);
  c.readyAt=3000;c.fired(WEAPONS.rocket,'doubleTap',3000);
  assert.equal(c.readyAt,3000);assert.equal(c.interval(WEAPONS.rocket,'doubleTap',3000),WEAPONS.rocket.fireInterval);
});
it('Hide Shots spends the same resource without accelerated fire or immunity', () => {
  const c=new HvhExploitClock();
  assert.equal(c.fired(WEAPONS.rifle,'hideShots',1000),true);
  assert.equal(c.readyAt,1000+HVH.hideShotsRecharge);
  assert.equal(c.interval(WEAPONS.rifle,'hideShots',1100),105);
  assert.equal(c.fired(WEAPONS.rifle,'hideShots',1100),false);
});

it('native burst weapons cannot multiply their burst with Double Tap',()=>{
  const clock=new HvhExploitClock();clock.readyAt=0;
  clock.fired(WEAPONS.burst,'doubleTap',1000);
  assert.equal(clock.readyAt,0);assert.equal(clock.burst,false);
  assert.equal(clock.interval(WEAPONS.burst,'doubleTap',1080),WEAPONS.burst.fireInterval);
});
