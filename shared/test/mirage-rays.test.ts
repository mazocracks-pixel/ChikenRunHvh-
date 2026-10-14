import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MAPS, createCollisionWorld, makeRay, mulberry32, rayAabb, raycastWorld, type RayHit } from '../src/index';

it('grid rays match every-box hits across Mirage, including skipped boxes and vertical rays', () => {
  const world = createCollisionWorld(MAPS.mirage);
  const random = mulberry32(42);
  for (let i = 0; i < 160; i++) {
    const p = MAPS.mirage.nav![Math.floor(random() * 755)]!;
    const yaw = random() * Math.PI * 2, pitch = (random() - .5) * Math.PI;
    const ray = makeRay({ x:p.x, y:(p.y??0)+1.3, z:p.z }, i === 0 ? {x:0,y:-1,z:0} : { x:Math.cos(yaw)*Math.cos(pitch), y:Math.sin(pitch), z:Math.sin(yaw)*Math.cos(pitch) });
    const range = i % 2 ? 200 : 15;
    const skip = new Set(i % 3 ? [] : [Math.floor(random() * world.size)]);
    let expected: RayHit | null = ray.dy < 0 && -ray.oy / ray.dy <= range ? {t:-ray.oy/ray.dy,nx:0,ny:1,nz:0,id:-1} : null;
    const hit: RayHit = {t:0,nx:0,ny:0,nz:0};
    for (const [id, box] of world.entries()) {
      if (skip.has(id)) continue;
      const t = rayAabb(ray, box, expected?.t ?? range, hit);
      if (t >= 0 && (!expected || t < expected.t)) expected = {...hit,id};
    }
    assert.deepEqual(raycastWorld(ray, world, range, skip), expected, `ray ${i}`);
  }
});
