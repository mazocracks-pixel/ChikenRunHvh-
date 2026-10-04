import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DEFAULT_MODS } from '@game/shared';
import { defaultConfig, importConfig, presetConfigs, sanitizeConfig, toServerMods } from '../src/dev/config';
it('migrates unsafe legacy configurations and clamps supported HvH choices',()=>{
  const c=defaultConfig();
  Object.assign(c.rage.weapon,{noRecoil:true,noSpread:true,infiniteAmmo:true,rapidFire:true,noRocketDamage:true});
  Object.assign(c.rage.move,{speed:5,fly:true,noclip:true});c.weapons.damage=20;c.rage.aim.silent=true;
  c.hvh.antiAim.desync=999;c.hvh.aim.reaction=0;c.hvh.aim.hitchance=Infinity;c.misc.freeCam=true;
  const safe=sanitizeConfig(c);
  assert.deepEqual(safe.rage.weapon,defaultConfig().rage.weapon);
  assert.deepEqual(safe.rage.move,defaultConfig().rage.move);
  assert.equal(safe.weapons.damage,1);assert.equal(safe.rage.aim.silent,false);assert.equal(safe.misc.freeCam,false);
  assert.equal(safe.hvh.antiAim.desync,58);assert.equal(safe.hvh.aim.reaction,100);assert.equal(safe.hvh.aim.hitchance,60);
  assert.deepEqual(toServerMods(c),DEFAULT_MODS,'even unsanitized configs cannot request altered stats');
  assert.deepEqual(importConfig(JSON.stringify({format:'chikengun-dev-config',name:'Old',config:c})).config,safe);
});
it('every shipped preset keeps baseline stats and non-conflicting hotkeys',()=>{
  const p=presetConfigs();assert.deepEqual(p.map(p=>p.name),['Balanced','Precision','Aggressive','Scout']);
  for(const n of p){assert.deepEqual(toServerMods(n.config),DEFAULT_MODS);assert.deepEqual(sanitizeConfig(n.config),n.config);}
  const c=defaultConfig();assert.equal(c.hvh.aim.overrideKey,'KeyH');assert.equal(c.hvh.aim.bodyKey,'KeyJ');assert.equal(c.hvh.movement.peekKey,'KeyZ');
});
