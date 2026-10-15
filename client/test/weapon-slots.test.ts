import assert from 'node:assert/strict';
import { it } from 'node:test';
import { nextGrenade, weaponHotkey, weaponIndexForKey } from '../src/game/weaponSlots';

it('primary, pistol and knife keep 1/2/3 even when the main slot is empty or the loadout order changes', () => {
  assert.equal(weaponHotkey('rifle'), 1);
  assert.equal(weaponHotkey('pistol'), 2);
  assert.equal(weaponHotkey('knife'), 3);
  assert.equal(weaponIndexForKey(['pistol', 'knife'], 1), -1);
  assert.equal(weaponIndexForKey(['pistol', 'knife'], 2), 0);
  assert.equal(weaponIndexForKey(['pistol', 'knife'], 3), 1);
  assert.equal(weaponIndexForKey(['knife', 'deagle', 'rifle'], 1), 2);
  assert.equal(weaponIndexForKey(['knife', 'deagle', 'rifle'], 2), 1);
});
it('repeated 4 cycles owned grenades, wraps, skips empty kinds and handles none', () => {
  const stock = {eggs:1,smokes:1,flashes:1};
  assert.equal(nextGrenade(null, stock), 'egg');
  assert.equal(nextGrenade('egg', stock), 'smoke');
  assert.equal(nextGrenade('smoke', stock), 'flash');
  assert.equal(nextGrenade('flash', stock), 'egg');
  assert.equal(nextGrenade('egg', {eggs:0,smokes:0,flashes:1}), 'flash');
  assert.equal(nextGrenade('flash', {eggs:0,smokes:0,flashes:1}), 'flash');
  assert.equal(nextGrenade(null, {eggs:0,smokes:0}), null);
});
