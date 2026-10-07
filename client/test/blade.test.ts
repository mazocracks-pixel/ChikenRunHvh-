import assert from 'node:assert/strict';
import { it } from 'node:test';
import { blade } from '../src/game/models/Guns';

it('every knife blade has a real normal on every point (a zero one flashed the screen blue on High)', () => {
  // The sizes the knives use; [0.11, 0.036, 0.005] is the Shadow Daggers' blade.
  const sizes: [number, number, number, number?][] = [[0.11, 0.036, 0.005], [0.13, 0.03, 0.005, -0.048], [0.15, 0.03, 0.005], [0.17, 0.032, 0.005], [0.2, 0.044, 0.006], [0.72, 0.03, 0.006, 0.022]];
  for (const [length, height, thickness, curve] of sizes) {
    const n = blade(length, height, thickness, curve).getAttribute('normal');
    assert.ok(n.count > 0);
    for (let i = 0; i < n.count; i++) {
      const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      assert.ok(Math.abs(len - 1) < 1e-3, `blade ${length}: point ${i} normal length ${len}`);
    }
  }
});
