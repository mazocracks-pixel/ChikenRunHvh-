import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as THREE from 'three';
import { CHICKEN_POSE, DEFAULT_APPEARANCE, bodyScale, chickenHeadCenter } from '@game/shared';
import { Chicken } from '../src/game/models/Chicken';

it('rendered head stays on the shared physical bone while walking, pitching and transitioning crouch', () => {
  const oldDocument=globalThis.document;
  // A stand-in 2D canvas: every drawing call is a no-op (the model draws its shadow and feather textures).
  const ctx:object=new Proxy({},{get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{},set:()=>true});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){return {width:0,height:0,getContext(){return ctx;}};}}});
  try {
    const chicken=new Chicken(DEFAULT_APPEARANCE),head=new THREE.Vector3(),origin={x:7,y:2,z:-4};
    let mesh:THREE.Mesh|undefined;
    chicken.root.traverse(o=>{if(o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.geometry.parameters.radius===CHICKEN_POSE.headRadius)mesh=o;});
    assert.ok(mesh);chicken.root.position.copy(origin);
    for(const yaw of [0,1.2,-2])for(const pitch of [-1.15,0,0.85])for(const amount of [0,0.5,1]){
      chicken.root.rotation.y=yaw;chicken.setAim(pitch);chicken.setCrouch(amount>0,amount);chicken.animate(1/60,6,true);
      mesh.getWorldPosition(head);const expected=chickenHeadCenter(origin,yaw,bodyScale({crouching:amount>0,crouchAmount:amount}),pitch);
      assert.ok(head.distanceTo(new THREE.Vector3().copy(expected))<1e-8,JSON.stringify({yaw,pitch,amount,head,expected}));
    }
    chicken.dispose();
  } finally {Object.defineProperty(globalThis,'document',{configurable:true,value:oldDocument});}
});
