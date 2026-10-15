import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MAPS } from '@game/shared';
import { radarPoint } from '../src/ui/Radar';

it('Mirage radar uses the installed overview origin and scale', () => {
  const radar = MAPS.mirage.radar!;
  assert.deepEqual(radarPoint({x:radar.x,z:radar.z}, radar), {x:0,z:0});
  assert.deepEqual(radarPoint({x:radar.x+radar.size,z:radar.z+radar.size}, radar), {x:256,z:256});
  for (const site of MAPS.mirage.bombSites!) {
    const p = radarPoint(site, radar);
    assert.ok(p.x > 0 && p.x < 256 && p.z > 0 && p.z < 256);
  }
});
