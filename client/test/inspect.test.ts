import assert from 'node:assert/strict';
import { it } from 'node:test';
import { WEAPON_IDS } from '@game/shared';
import { inspectKind } from '../src/game/ViewModel';

it('every weapon gets the inspect move for its kind', () => {
  const none = { offhand: null, animate: null };
  assert.equal(inspectKind('deagle', none), 'pistol');
  assert.equal(inspectKind('rifle', none), 'rifle');
  assert.equal(inspectKind('smg', none), 'rifle');
  assert.equal(inspectKind('sniper', none), 'sniper');
  assert.equal(inspectKind('scout', none), 'sniper');
  assert.equal(inspectKind('minigun', none), 'heavy');
  assert.equal(inspectKind('knife', none), 'melee');
  assert.equal(inspectKind('butterfly', { offhand: null, animate: () => {} }), 'trick');
  assert.equal(inspectKind('dualies', { offhand: {} as never, animate: null }), 'pair');
  for (const id of WEAPON_IDS) assert.ok(inspectKind(id, none), id);
});
