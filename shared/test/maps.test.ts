import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOOT, MAPS, MAP_IDS, MODES, PLAYER, SIM_DT, boxToAabb, createMoveState, stepPlayer, buildNavGraph, createCollisionWorld, findPath, isSpaceFree, reachableCount, walkable } from '../src/index';

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

    it('bot waypoints are open, all linked up, and reach every spawn and bomb site', () => {
      if (!map.nav) return;
      for (const p of map.nav) assert.ok(isSpaceFree(p.x, 0, p.z, world), `waypoint ${p.x},${p.z} is blocked`);
      const graph = buildNavGraph(map.nav, world);
      assert.equal(reachableCount(graph), map.nav.length, 'every waypoint reaches every other');
      for (const spot of [...map.spawns, ...(map.bombSites ?? [])]) {
        assert.ok(map.nav.some((p) => walkable(spot, p, world)), `${spot.x},${spot.z} can't walk to any waypoint`);
      }
      // A route from chikenT spawn to each site, every leg walkable.
      const tSpawn = map.spawns.find((s) => s.team === 1)!;
      for (const site of map.bombSites ?? []) {
        const route = [tSpawn, ...findPath(graph, tSpawn, site, world)];
        for (let i = 1; i < route.length; i++) assert.ok(walkable(route[i - 1]!, route[i]!, world), `route to ${site.id}, leg ${i}`);
      }
    });

    it('has free bomb sites', () => {
      for (const site of map.bombSites ?? []) assert.ok(isSpaceFree(site.x, 0, site.z, world), `site ${site.id}`);
    });

    it('is within the player radius margin', () => {
      assert.ok(map.halfSize > PLAYER.radius * 10);
    });
  });
}

describe('Factory catwalks', () => {
  it('a chicken can climb the steps and walk onto each catwalk', () => {
    const map = MAPS.factory;
    const world = createCollisionWorld(map);
    // From the floor by the steps: each step is a jump up, and the catwalk continues from the top one.
    for (const [x0, dir, z] of [[-24, 1, -26], [24, -1, 26]] as const) {
      const s = createMoveState(x0 - dir * 2, 0, z);
      const yaw = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      for (let i = 0; i < 60 * 4; i++) stepPlayer(s, { seq: i, forward: 1, right: 0, jump: true, yaw, pitch: 0 }, SIM_DT, world);
      assert.ok(s.y > 3.6, `on the catwalk (y ${s.y.toFixed(2)}, x ${s.x.toFixed(1)})`);
    }
  });
});
