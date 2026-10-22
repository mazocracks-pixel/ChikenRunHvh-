import assert from 'node:assert/strict';
import { it } from 'node:test';
import { slotItems, stepSlot, type SlotItem } from '../src/game/weaponSlots';

const name = (i: SlotItem | null) => (!i ? 'none' : i.kind === 'weapon' ? `w${i.index}` : i.kind === 'grenade' ? i.grenade : 'bomb');

it('the wheel goes primary, pistol, knife, each grenade, the bomb, and round again', () => {
  const items = slotItems(['ak47', 'pistol', 'knife'], { eggs: 1, smokes: 1, flashes: 2 }, true);
  assert.deepEqual(items.map(name), ['w0', 'w1', 'w2', 'egg', 'smoke', 'flash', 'bomb']);
  let at: SlotItem = items[0]!;
  const seen = [];
  for (let i = 0; i < 7; i++) seen.push(name((at = stepSlot(items, at, 1)!)));
  assert.deepEqual(seen, ['w1', 'w2', 'egg', 'smoke', 'flash', 'bomb', 'w0']);
  assert.equal(name(stepSlot(items, items[0]!, -1)), 'bomb', 'scrolling up from the first goes to the last');
});

it('skips what you don’t have: no pistol, no smoke, no bomb', () => {
  const items = slotItems(['ak47', 'knife'], { eggs: 1, smokes: 0, flashes: 1 }, false);
  assert.deepEqual(items.map(name), ['w0', 'w1', 'egg', 'flash']);
  // A loadout in any order still sorts by key: the knife (key 3) after the pistol (key 2).
  assert.deepEqual(slotItems(['knife', 'pistol', 'sniper'], { eggs: 0, smokes: 0 }, false).map(name), ['w2', 'w1', 'w0']);
});
