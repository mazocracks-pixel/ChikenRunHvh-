import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HvhBuyModel, HVH_BUY_STORAGE_KEY } from '../../src/ui/hvh/HvhBuyMenu';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, get: (k: string) => data.get(k) ?? null, set: (k: string, v: string) => void data.set(k, v) };
}

describe('HvhBuyModel', () => {
  it('has two categories with the exact arsenal ids', () => {
    const model = new HvhBuyModel(memoryStore());
    assert.deepEqual(model.categories.map((c) => ({ id: c.id, items: [...c.items] })), [
      { id: 'main', items: ['ssg08', 'scar20'] },
      { id: 'pistol', items: ['deserteagle', 'r8'] },
    ]);
  });

  it('defaults to SSG 08 + Desert Eagle', () => {
    assert.deepEqual(new HvhBuyModel(memoryStore()).selected, { main: 'ssg08', pistol: 'deserteagle' });
    // No storage at all (node, private mode): still the default.
    assert.deepEqual(new HvhBuyModel().selected, { main: 'ssg08', pistol: 'deserteagle' });
  });

  it("pick('r8') replaces the pistol only; a main replaces the main only", () => {
    const model = new HvhBuyModel(memoryStore());
    assert.equal(model.pick('r8'), 'pistol');
    assert.deepEqual(model.selected, { main: 'ssg08', pistol: 'r8' });
    assert.equal(model.pick('scar20'), 'main');
    assert.deepEqual(model.selected, { main: 'scar20', pistol: 'r8' });
  });

  it('ignores ids outside the arsenal', () => {
    const model = new HvhBuyModel(memoryStore());
    assert.equal(model.pick('ak47'), null);
    assert.equal(model.pick('knife'), null);
    assert.deepEqual(model.selected, { main: 'ssg08', pistol: 'deserteagle' });
  });

  it('remembers the last pick across models, and ignores a broken or stale saved pick', () => {
    const store = memoryStore();
    new HvhBuyModel(store).pick('scar20');
    new HvhBuyModel(store).pick('r8');
    assert.deepEqual(new HvhBuyModel(store).selected, { main: 'scar20', pistol: 'r8' });
    assert.deepEqual(new HvhBuyModel(memoryStore({ [HVH_BUY_STORAGE_KEY]: '{not json' })).selected, { main: 'ssg08', pistol: 'deserteagle' });
    assert.deepEqual(new HvhBuyModel(memoryStore({ [HVH_BUY_STORAGE_KEY]: JSON.stringify({ main: 'r8', pistol: 'ak47' }) })).selected,
      { main: 'ssg08', pistol: 'deserteagle' });
  });

  it('a storage that throws never breaks picking', () => {
    const model = new HvhBuyModel({ get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); } });
    assert.equal(model.pick('r8'), 'pistol');
    assert.deepEqual(model.selected, { main: 'ssg08', pistol: 'r8' });
  });
});
