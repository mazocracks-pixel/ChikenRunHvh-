import assert from 'node:assert/strict';
import { it } from 'node:test';
import { WALLBANG, WEAPONS, WEAPON_IDS, wallbangScale } from '../src/index';

it('every sniper (Sniper, Scout) has a double scope (a second, stronger zoom), and nothing else does', () => {
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    if (w.scope) assert.ok(w.zoom2 !== undefined && w.zoom2 > w.zoom, id);
    else assert.equal(w.zoom2, undefined, id);
  }
  assert.ok(WEAPONS.sniper.scope && WEAPONS.scout.scope);
});

it('a bullet through a box now keeps 25% less damage than before (0.65 → 0.4875 of it), and two boxes compound', () => {
  assert.ok(Math.abs(WALLBANG.damageScale - 0.65 * 0.75) < 1e-9);
  const box = { t: 1, nx: 0, ny: 1, nz: 0 };
  assert.ok(Math.abs(wallbangScale([box], 5) - 0.4875) < 1e-9);
  assert.ok(Math.abs(wallbangScale([box, { ...box, t: 2 }], 5) - 0.4875 ** 2) < 1e-9);
});
