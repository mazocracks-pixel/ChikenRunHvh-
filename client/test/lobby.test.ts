import assert from 'node:assert/strict';
import { it } from 'node:test';
import { MainMenu } from '../src/ui/MainMenu';
import { ShopScreen } from '../src/ui/Shop';

// Only the DOM methods used by the list builders; layout still needs a browser check.
class Element {
  children: Element[] = [];
  textContent = '';
  className = '';
  hidden = false;
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  append(...children: (Element | string)[]) { for (const c of children) typeof c === 'string' ? this.textContent += c : this.children.push(c); }
  replaceChildren() { this.children = []; this.textContent = ''; }
  setAttribute(k: string, v: string) { this.attributes[k] = v; }
  addEventListener(k: string, fn: () => void) { this.listeners[k] = fn; }
}

it('the friends rail shows real online status, requests, parties and escaped names', () => {
  const oldDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element(), createTextNode: (s: string) => s } });
  try {
    let opened = 0;
    const menu = Object.assign(Object.create(MainMenu.prototype), {
      friendsBadge: new Element(), friendCount: new Element(), friendList: new Element(), partyStrip: new Element(),
      playButton: new Element(), playLabel: new Element(), playButtons: [], actions: { friends: () => opened++ },
    });
    menu.playButtons = [menu.playButton];
    menu.setFriends(2, { names: ['Cluck'], leader: 'Cluck', isLeader: true }, [
      { userId: 1, name: 'Offline', online: false, mode: null, inParty: false },
      { userId: 2, name: '<img>', online: true, mode: 'bomb', inParty: true },
    ]);
    assert.equal(menu.friendCount.textContent, '1');
    assert.equal(menu.friendsBadge.hidden, false);
    assert.equal(menu.friendList.children.length, 2);
    const first = menu.friendList.children[0];
    assert.equal(first.children[0].textContent, '<');
    assert.match(first.attributes['aria-label'], /^<img> · /);
    assert.match(first.className, /online.*in-party/);
    first.listeners.click();
    assert.equal(opened, 1);
    assert.equal(menu.playLabel.textContent, 'Play with party (1)');
    menu.setFriends(0, null, []);
    assert.equal(menu.friendList.children.length, 0);
    assert.equal(menu.friendsBadge.hidden, true);
    assert.equal(menu.playLabel.textContent, 'Play');
  } finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument }); }
});

it('inventory and loadout include owned and free items; store includes locked items', () => {
  const oldDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element(), createTextNode: (s: string) => s } });
  try {
    const shop = Object.assign(Object.create(ShopScreen.prototype), { card: (item: { id: string }) => Object.assign(new Element(), { textContent: item.id }) });
    const items = [{ id: 'free', price: 0 }, { id: 'owned', price: 10 }, { id: 'locked', price: 10 }];
    for (const section of ['inventory', 'loadout', 'store']) {
      shop.section = section;
      assert.deepEqual(shop.grid(items, { owned: ['owned'] }).children.map((e: Element) => e.textContent), section === 'store' ? ['free', 'owned', 'locked'] : ['free', 'owned']);
    }
  } finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument }); }
});
