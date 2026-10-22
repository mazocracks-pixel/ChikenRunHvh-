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

it('the friends sidebar shows real online status, Invite, requests, parties and escaped names', () => {
  const oldDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element(), createTextNode: (s: string) => s } });
  try {
    let opened = 0;
    const invited: string[] = [];
    const menu = Object.assign(Object.create(MainMenu.prototype), {
      friendsBadge: new Element(), friendCount: new Element(), friendList: new Element(), partyStrip: new Element(),
      playLabel: Object.assign(new Element(), { dataset: {} }), searching: false,
      actions: { friends: () => opened++, invite: (f: { name: string }) => invited.push(f.name) },
      canInvite: (f: { online: boolean; inParty: boolean }) => f.online && !f.inParty,
    });
    menu.setFriends(2, { names: ['Cluck'], leader: 'Cluck', isLeader: true }, [
      { userId: 1, name: 'Offline', online: false, mode: null, inParty: false },
      { userId: 2, name: '<img>', online: true, mode: 'bomb', inParty: true },
      { userId: 3, name: 'Bob', online: true, mode: null, inParty: false },
    ]);
    assert.equal(menu.friendCount.textContent, '2');
    assert.equal(menu.friendsBadge.hidden, false);
    assert.equal(menu.friendList.children.length, 3);
    // Online first, then by name: <img> (in your party), Bob (can be invited), Offline.
    const [party, bob, offline] = menu.friendList.children;
    const main = party.children[0];
    assert.equal(main.children[0].textContent, '<');
    assert.match(main.attributes['aria-label'], /^<img> · Playing ChikenBomb/);
    assert.match(party.className, /online.*in-party/);
    assert.equal(party.children.length, 1, 'already in your party: no Invite');
    main.listeners.click();
    assert.equal(opened, 1);
    assert.equal(bob.children.length, 2);
    assert.match(bob.children[1].attributes['aria-label'], /^Invite Bob/);
    bob.children[1].listeners.click();
    assert.deepEqual(invited, ['Bob']);
    assert.equal(offline.children.length, 1, 'offline: no Invite');
    assert.equal(menu.playLabel.textContent, 'Play with party (1)');
    menu.setFriends(0, null, []);
    assert.equal(menu.friendList.children.length, 1, 'just the "No friends yet" note');
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
