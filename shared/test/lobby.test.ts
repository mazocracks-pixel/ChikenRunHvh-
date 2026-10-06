import assert from 'node:assert/strict';
import { it } from 'node:test';
import { LOBBY_LAP, MAPS, boxToAabb, createCollisionWorld, isSpaceFree } from '../src/index';

it('the title screen’s running track is clear of everything you could bump into, all the way round', () => {
  const map = MAPS.lobby;
  const world = createCollisionWorld(map);
  const solids = map.boxes.map(boxToAabb).filter((b) => b.minY < 2);
  const { x, z, a, b } = LOBBY_LAP;
  for (let i = 0; i < 360; i++) {
    const phi = (i / 360) * Math.PI * 2;
    const px = x + a * Math.cos(phi);
    const pz = z + b * Math.sin(phi);
    assert.ok(isSpaceFree(px, 0, pz, world), `track point ${i} is blocked`);
    // Plus about 3 m to spare for the camera, which runs ahead of the chicken and a little to one side.
    for (const box of solids) {
      const dx = Math.max(box.minX - px, 0, px - box.maxX);
      const dz = Math.max(box.minZ - pz, 0, pz - box.maxZ);
      assert.ok(Math.hypot(dx, dz) > 3, `track point ${i} is only ${Math.hypot(dx, dz).toFixed(1)} m from a box`);
    }
  }
});

it('no game mode can pick the title-screen map', async () => {
  const { MODES } = await import('../src/index');
  for (const mode of Object.values(MODES)) assert.ok(!mode.maps.includes('lobby'), mode.id);
});
