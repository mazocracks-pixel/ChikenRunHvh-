import assert from 'node:assert/strict';
import { it } from 'node:test';

it('loads saved keybindings without duplicating an occupied fallback key', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === 'chikengun:keybinds' ? JSON.stringify({forward:'KeyS',reload:'KeyT'}) : null,
  } });
  try {
    const {getKeybinds, setKeybind, BINDS} = await import('../src/keybinds');
    const loaded = getKeybinds();
    assert.equal(loaded.forward, 'KeyS');
    assert.equal(loaded.reload, 'KeyT', 'unrelated saved binding survives recovery');
    assert.equal(new Set(Object.values(loaded)).size, BINDS.length, 'every action has a distinct key');
    assert.equal(setKeybind('forward','KeyA'),true);
    assert.equal(getKeybinds().left,'KeyS','rebinding still swaps the sole owner');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
