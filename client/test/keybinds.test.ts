import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { BINDS, bindOwner, defaultKeybinds, getKeybinds, isBindable, keyLabel, resetKeybinds, setKeybind } from '../src/keybinds';

describe('key bindings', () => {
  beforeEach(() => resetKeybinds());

  it('start as the normal keys, with Y for chat and U for team chat', () => {
    assert.deepEqual({ ...getKeybinds() }, defaultKeybinds());
    assert.equal(getKeybinds().chat, 'KeyY');
    assert.equal(getKeybinds().teamChat, 'KeyU');
    assert.equal(new Set(BINDS.map((b) => b.code)).size, BINDS.length, 'no two defaults share a key');
  });

  it('rebind a key, and a key that is already used swaps places', () => {
    assert.equal(setKeybind('reload', 'KeyT'), true);
    assert.equal(getKeybinds().reload, 'KeyT');
    // Put Reload on Grenade-egg's key (G): egg takes Reload's old key (T).
    assert.equal(setKeybind('reload', 'KeyG'), true);
    assert.equal(getKeybinds().reload, 'KeyG');
    assert.equal(getKeybinds().egg, 'KeyT');
    assert.equal(bindOwner('KeyG'), 'reload');
    resetKeybinds();
    assert.equal(getKeybinds().reload, 'KeyR');
  });

  it('refuses menu, weapon-slot and dev-menu keys', () => {
    for (const code of ['Escape', 'Tab', 'Enter', 'Digit1', 'KeyL', 'Insert', '', 'a b', '<script>']) {
      assert.equal(isBindable(code), false, code);
      assert.equal(setKeybind('jump', code), false, code);
    }
    assert.equal(getKeybinds().jump, 'Space');
  });

  it('shows readable names', () => {
    assert.equal(keyLabel('KeyW'), 'W');
    assert.equal(keyLabel('Space'), 'Space');
    assert.equal(keyLabel('ShiftLeft'), 'Left Shift');
    assert.equal(keyLabel('ArrowUp'), 'Up arrow');
  });
});
