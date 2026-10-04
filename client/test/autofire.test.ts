import assert from 'node:assert/strict';
import { it } from 'node:test';
import { WEAPONS } from '@game/shared';
import { WeaponController } from '../src/game/WeaponController';

it('assisted semi-auto fires at weapon cadence at both low and high display rates', () => {
  for (const fps of [20,60,144]) {
    const w = new WeaponController(['pistol']);
    const times:number[]=[];
    for (let frame=0;frame<fps*2;frame++) {
      const now=1000+frame*1000/fps;
      if(w.trigger(true,now,true)==='fire') times.push(now);
    }
    assert.ok(times.length>=8 && times.length<=10, `${fps} FPS: ${times.length} shots`);
    for(let i=1;i<times.length;i++) assert.ok(times[i]!-times[i-1]!>=WEAPONS.pistol.fireInterval);
  }
});
it('manual semi-auto still needs release, and assisted readiness never spends ammo', () => {
  const w=new WeaponController(['pistol','rifle']);
  assert.equal(w.trigger(true,1000),'fire');
  assert.equal(w.trigger(true,2000),null);
  assert.equal(w.shotState(2000),'Ready'); assert.equal(w.mag,11);
  w.trigger(false,2000); assert.equal(w.trigger(true,2001),'fire');
  assert.equal(w.reload(2100),true); assert.equal(w.shotState(2200),'Reloading');
  assert.equal(w.trigger(true,2200,true),null);
  assert.equal(w.switchTo(1,2300),true); assert.equal(w.shotState(2400),'Switching weapon');
  assert.equal(w.trigger(true,2400,true),null); assert.equal(w.trigger(true,2600,true),'fire');
});
it('assisted bursts cancel on loss of a target; ordinary manual bursts complete', () => {
  const assisted=new WeaponController(['burst']);
  assert.equal(assisted.trigger(true,1000,true),'fire');
  assert.equal(assisted.trigger(false,1080,false),null);
  assert.equal(assisted.trigger(true,1090,true),null,'cancelled burst retains its cooldown');
  assert.equal(assisted.trigger(true,1400,true),'fire');
  assert.equal(assisted.trigger(true,1480,true),'fire');
  assert.equal(assisted.trigger(true,1560,true),'fire');
  assert.equal(assisted.trigger(true,1640,true),null);
  const manual=new WeaponController(['burst']);
  assert.equal(manual.trigger(true,1000),'fire');
  assert.equal(manual.trigger(false,1080),'fire');
  assert.equal(manual.trigger(false,1160),'fire');
});
it('pausing cancels a pending burst without restoring ammunition or timers', () => {
  const w=new WeaponController(['burst']);
  w.trigger(true,1000,true); const mag=w.mag; w.suspend();
  assert.equal(w.trigger(false,1100),null); assert.equal(w.mag,mag);
  assert.equal(w.shotState(1100),'Cooldown');
  assert.equal(w.trigger(true,1400,true),'fire');
});
