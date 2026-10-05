import assert from 'node:assert/strict';
import {it} from 'node:test';
import {CommandChoker,defaultHvhCore,fakeLagTicks,WEAPONS} from '@game/shared';
import {defaultConfig,sanitizeConfig} from '../src/dev/config';
import {HVH_PANELS} from '../src/dev/panels';
import {skeetEffectiveConfig} from '../src/dev/skeet/model';
it('Skeet fake-lag controls map consistently to bounded runtime and server policies without altering Lab',()=>{
 const raw=defaultConfig('skeet');raw.skeet.fakeLag.enabled=true;raw.skeet.fakeLag.limit=999;raw.skeet.fakeLag.mode='unknown' as never;
 raw.hvh.movement.subtickStrafe=true;const c=sanitizeConfig(raw);
 assert.equal(c.skeet.fakeLag.limit,12);assert.equal(c.skeet.fakeLag.mode,'static');assert.equal(c.hvh.movement.subtickStrafe,true);
 assert.equal(HVH_PANELS.skeet.loadout(c).core!.fakeLag,12);assert.equal(skeetEffectiveConfig(c,WEAPONS.pistol).hvh.core!.fakeLag,12);
 assert.equal(HVH_PANELS.lab.loadout(c).core!.fakeLag,0);assert.equal(HVH_PANELS.manual.loadout(c).core!.fakeLag,0);
 c.skeet.fakeLag.enabled=false;assert.equal(HVH_PANELS.skeet.loadout(c).core!.fakeLag,0);
 const old=defaultConfig('skeet');delete (old.skeet as Partial<typeof old.skeet>).fakeLag;old.hvh.core!.fakeLag=9;old.hvh.core!.fakeLagMode='random';
 const migrated=sanitizeConfig(old);assert.deepEqual(migrated.skeet.fakeLag,{enabled:true,limit:9,mode:'random',breakOnShot:true});
});
it('all choke modes stay bounded and shooting flushes pending commands when enabled',()=>{
 const core=defaultHvhCore();core.fakeLag=8;
 for(const mode of ['static','velocity','random','adaptive','peek'] as const){core.fakeLagMode=mode;
  for(let seq=1;seq<100;seq++)for(const speed of [0,2,6,12]){const ticks=fakeLagTicks(core,seq,speed);assert.ok(ticks>=0&&ticks<=8);assert.equal(fakeLagTicks(core,seq,speed,true),0);}
 }
 const choker=new CommandChoker(),f={seq:1,forward:1,right:0,jump:false,yaw:0,pitch:0};
 assert.deepEqual(choker.push(f,8),[]);assert.deepEqual(choker.push({...f,seq:2},8),[]);
 assert.equal(choker.push({...f,seq:3},8,true).length,3);
 core.fakeLagMode='static';core.fakeLagBreakOnShot=false;assert.equal(fakeLagTicks(core,1,6,true),8);
});
