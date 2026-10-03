import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOOT, MAPS, MAP_IDS, MODES, PLAYER, boxToAabb, createCollisionWorld, isSpaceFree } from '../src/index';

for (const id of MAP_IDS) {
  const map = MAPS[id];
  const world = createCollisionWorld(map);

  describe(`map: ${map.name}`, () => {
    it('has no interpenetrating boxes', () => {
      const boxes = map.boxes.map(boxToAabb);
      const bad: string[] = [];
      const e = 1e-6;
      boxes.forEach((a, i) =>
        boxes.forEach((b, j) => {
          if (j <= i) return;
          if (a.minX < b.maxX - e && a.maxX > b.minX + e && a.minY < b.maxY - e && a.maxY > b.minY + e && a.minZ < b.maxZ - e && a.maxZ > b.minZ + e) {
            bad.push(`#${i} ${map.boxes[i]!.kind} & #${j} ${map.boxes[j]!.kind}`);
          }
        }),
      );
      assert.deepEqual(bad, []);
    });

    it('keeps every box inside the fence', () => {
      for (const b of map.boxes.map(boxToAabb)) {
        assert.ok(b.minX >= -map.halfSize && b.maxX <= map.halfSize && b.minZ >= -map.halfSize && b.maxZ <= map.halfSize);
      }
    });

    it('has spawn points with room to stand', () => {
      assert.ok(map.spawns.length >= 4);
      for (const s of map.spawns) assert.ok(isSpaceFree(s.x, 0, s.z, world), `spawn ${s.x},${s.z} is blocked`);
    });

    it('has enough team spawns for the team modes it supports', () => {
      const teamModes = Object.values(MODES).filter((m) => m.teams && m.maps.includes(id));
      if (teamModes.length === 0) return;
      for (const team of [1, 2] as const) {
        assert.ok(map.spawns.filter((s) => s.team === team).length >= 4, `team ${team} needs spawns`);
      }
    });

    it('puts loot boxes in open air', () => {
      for (const spot of map.loot) {
        const y = (spot.y ?? 0) + LOOT.hover;
        const half = LOOT.boxSize / 2;
        const inside = [...world.all()].some(
          (b) => spot.x + half > b.minX && spot.x - half < b.maxX && y + half > b.minY && y - half < b.maxY && spot.z + half > b.minZ && spot.z - half < b.maxZ,
        );
        assert.ok(!inside, `loot ${spot.x},${spot.z} is inside a box`);
      }
    });

    it('has free vehicle and flag spots', () => {
      for (const v of map.vehicles) assert.ok(isSpaceFree(v.x, 0, v.z, world), `vehicle ${v.x},${v.z}`);
      for (const f of map.flags) assert.ok(isSpaceFree(f.x, 0, f.z, world), `flag ${f.x},${f.z}`);
    });

    it('is within the player radius margin', () => {
      assert.ok(map.halfSize > PLAYER.radius * 10);
    });
  });
}
