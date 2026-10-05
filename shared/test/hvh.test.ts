import assert from 'node:assert/strict';
import { it } from 'node:test';
import { defaultHvhLoadout, hvhPose, sanitizeHvhLoadout, wrapAngle } from '../src';

it('desync is bounded, inverted, revealed, and has a separate real heading', () => {
  const l=sanitizeHvhLoadout({antiAim:{enabled:true,mode:'backward',desync:500,jitter:500,jitterInterval:1,spinSpeed:Infinity},exploit:'evil'});
  assert.equal(l.antiAim.desync,58); assert.equal(l.antiAim.jitter,45); assert.equal(l.exploit,'off');
  assert.equal(l.antiAim.jitterInterval,1);
  assert.notEqual(hvhPose(0,l,0,false,false).real,hvhPose(0,l,1,false,false).real);
  const a=hvhPose(0,l,1000,false,false),b=hvhPose(0,l,1000,true,false);
  assert.ok(Math.abs(wrapAngle(a.fake-a.real)-58*Math.PI/180)<1e-9);
  assert.ok(Math.abs(wrapAngle(b.fake-b.real)+58*Math.PI/180)<1e-9);
  assert.deepEqual(hvhPose(0.8,l,1000,false,true),{real:0.8,fake:0.8});
  assert.deepEqual(hvhPose(0.8,defaultHvhLoadout(),1000,false,false),{real:0.8,fake:0.8});
});
