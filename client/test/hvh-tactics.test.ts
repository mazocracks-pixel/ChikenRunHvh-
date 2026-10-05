import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MAPS, WALLBANG, WEAPONS, createCollisionWorld, normalize, softBoxTest } from '@game/shared';
import { boundedTurn, estimateShot, peekSteering, shotGate } from '../src/dev/tactics';
const target={x:0,y:0,z:-20,yaw:0,scale:1,hp:100,armor:0};
it('hitchance samples actual aim, spread, and armor instead of guaranteeing a hit',()=>{
  const eye={x:0,y:0.6,z:0},aim={x:0,y:0,z:-1};
  const still=estimateShot(WEAPONS.sniper,eye,aim,target,0,false,true);
  const moving=estimateShot(WEAPONS.sniper,eye,aim,target,6,true,false);
  const miss=estimateShot(WEAPONS.sniper,eye,{x:1,y:0,z:0},target,0,false,true);
  const armored=estimateShot(WEAPONS.sniper,eye,aim,{...target,armor:100},0,false,true);
  assert.equal(still.chance,100);assert.ok(moving.chance<still.chance);assert.equal(miss.chance,0);assert.ok(armored.damage<still.damage);
});
it('shot decisions require reaction, damage and accuracy while allowing lethal shots',()=>{
  assert.equal(shotGate({damage:40,chance:100},20,60,100,0,0),'Ready');
  assert.equal(shotGate({damage:40,chance:100},20,60,100,99,120),'Acquiring target');
  assert.equal(shotGate({damage:10,chance:100},20,60,100,200,120),'Waiting for damage');
  assert.equal(shotGate({damage:40,chance:30},20,60,100,200,120),'Waiting for accuracy');
  assert.equal(shotGate({damage:10,chance:100},20,60,8,200,120),'Ready');
});
it('autowall retains normal penetration damage and cannot target through stone',()=>{
  const world=createCollisionWorld(MAPS.farm),isSoft=softBoxTest(MAPS.farm);
  const eye={x:0,y:1.3,z:26},victim={...target,z:19};
  const dir=normalize({x:0,y:0.6-eye.y,z:19-eye.z});
  const blocked=estimateShot(WEAPONS.rifle,eye,dir,victim,0,false,true,world);
  const through=estimateShot(WEAPONS.rifle,eye,dir,victim,0,false,true,world,isSoft);
  assert.equal(blocked.chance,0);assert.ok(through.chance>0);assert.ok(Math.abs(through.damage-WEAPONS.rifle.damage*WALLBANG.damageScale)<0.001);
  const stone=estimateShot(WEAPONS.rifle,{x:0,y:1.3,z:14},normalize({x:0,y:-0.7,z:-5}),{...target,z:9},0,false,true,world,isSoft);
  assert.equal(stone.chance,0);
});
it('turn rate is bounded and peek return produces normal collision-tested input axes',()=>{
  assert.ok(Math.abs(boundedTurn(0,Math.PI/2,360,1/60)-Math.PI/30)<1e-9);
  assert.deepEqual(peekSteering({x:0,y:0,z:0},{x:0,y:0,z:-2},0),{forward:1,right:0});
  assert.equal(peekSteering({x:0,y:1,z:0},{x:0,y:0,z:-2},0),null);
  assert.equal(peekSteering({x:0,y:0,z:0},{x:0.1,y:0,z:0},0),null);
});
