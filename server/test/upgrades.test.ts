import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_LOADOUT,
  MODES,
  MODE_IDS,
  PLAYER,
  UPGRADE_IDS,
  UPGRADE_PRICES,
  WEAPONS,
  dailyDeals,
  modeUsesUpgrades,
  priceNow,
  rarityOf,
  upgradeEffects,
  upgradeItemId,
  upgradeLevels,
  withUpgrades,
  getItem,
  type ModeId,
  type Profile,
  type UpgradeLevels,
} from '@game/shared';
import { startGameServer, type RunningServer } from '../src/app';
import { createRoom } from '../src/rooms/modes';
import type { GameRoom } from '../src/rooms/GameRoom';
import { fakeIo } from './helpers';

const ALL5: UpgradeLevels = Object.fromEntries(UPGRADE_IDS.map((id) => [id, 5])) as UpgradeLevels;

describe('chicken upgrades: the rules', () => {
  it('levels count only in a row from level 1', () => {
    assert.equal(upgradeLevels([upgradeItemId('speed', 1), upgradeItemId('speed', 2)]).speed, 2);
    assert.equal(upgradeLevels([upgradeItemId('speed', 2)]).speed, 0, 'level 2 without level 1 is nothing');
    assert.equal(upgradeLevels([]).health, 0);
  });

  it('every upgrade has 5 levels with rising prices', () => {
    assert.equal(UPGRADE_IDS.length, 7);
    for (let i = 1; i < UPGRADE_PRICES.length; i++) assert.ok(UPGRADE_PRICES[i]! > UPGRADE_PRICES[i - 1]!);
    for (const id of UPGRADE_IDS) for (let l = 1; l <= 5; l++) assert.equal(getItem('upgrade', `${id}:${l}`)?.price, UPGRADE_PRICES[l - 1]);
  });

  it('max level: +50% health, faster, higher, longer glide, bigger eggs, less damage, faster reload', () => {
    const e = upgradeEffects(ALL5);
    assert.equal(e.maxHealth, 1.5);
    assert.ok(e.speed > 1 && e.jump > 1 && e.glide > 1 && e.egg > 1 && e.hop > 0);
    assert.ok(e.reload < 1);
    assert.ok(Math.abs(e.damageTaken - 0.8 / 1.5) < 1e-9, 'armor and health together');
    const mods = withUpgrades(null, e)!;
    assert.equal(mods.speed, e.speed);
    assert.equal(withUpgrades(null, null), null, 'no upgrades: normal movement');
  });

  it('only PvE modes use them (Zombie Apocalypse, Training); every PvP mode is fair', () => {
    const pve = MODE_IDS.filter((id) => modeUsesUpgrades(MODES[id]));
    assert.deepEqual(pve.sort(), ['training', 'zombie']);
  });

  it('daily deals: the same 4 cheaper items all day, different another day', () => {
    const day = Date.UTC(2026, 9, 11, 9);
    const a = dailyDeals(day);
    assert.equal(a.length, 4);
    assert.equal(new Set(a.map((d) => d.itemId)).size, 4);
    assert.deepEqual(dailyDeals(day + 3_600_000 * 10), a, 'same all day');
    assert.notDeepEqual(dailyDeals(day + 86_400_000).map((d) => d.itemId), a.map((d) => d.itemId));
    for (const d of a) {
      const item = getItem(...(d.itemId.split(':') as [never, string]))!;
      assert.ok(d.price < item.price && d.price > 0);
      assert.equal(priceNow(d.itemId, day), d.price);
      assert.ok(!d.itemId.startsWith('upgrade:'), 'no upgrades on sale');
    }
  });

  it('rarity follows the price', () => {
    assert.equal(rarityOf(getItem('hat', 'cap')!), 'common');
    assert.equal(rarityOf(getItem('hat', 'crown')!), 'legendary');
    assert.equal(rarityOf(getItem('upgrade', 'speed:5')!), 'legendary');
  });
});

describe('chicken upgrades: bought and saved on the server', () => {
  let server: RunningServer;
  let base: string;
  before(async () => {
    server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 1000, guestsPerHour: 100_000 });
    base = `http://localhost:${server.port}`;
  });
  after(() => server.close());

  const api = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-session-transport': 'token', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: res.status, body: (await res.json()) as { profile: Profile; token?: string; error?: string } };
  };

  it('levels in order only, at the server price; the browser can not set coins or levels', async () => {
    const { body } = await api('/api/auth/guest', { method: 'POST' });
    const token = body.token!;
    server.db.setCoins(body.profile.id, 5000);
    const buy = (itemId: string) => api('/api/shop/buy', { method: 'POST', token, body: { itemId } });
    assert.equal((await buy(upgradeItemId('health', 2))).status, 409, 'level 2 before level 1');
    const one = await buy(upgradeItemId('health', 1));
    assert.equal(one.status, 200);
    assert.equal(one.body.profile.coins, 5000 - UPGRADE_PRICES[0]!);
    assert.equal((await buy(upgradeItemId('health', 2))).status, 200);
    assert.equal(upgradeLevels(server.db.profile(body.profile.id)!.owned).health, 2, 'saved in the database');
    // A browser that tries to send its own coins or price: ignored.
    await api('/api/me', { method: 'PATCH', token, body: { coins: 999999, owned: [upgradeItemId('speed', 5)] } });
    const me = server.db.profile(body.profile.id)!;
    assert.equal(me.coins, 5000 - UPGRADE_PRICES[0]! - UPGRADE_PRICES[1]!);
    assert.equal(upgradeLevels(me.owned).speed, 0);
    // Not enough coins.
    server.db.setCoins(body.profile.id, 10);
    assert.equal((await buy(upgradeItemId('health', 3))).status, 402);
  });

  it("charges today's deal price", async () => {
    const { body } = await api('/api/auth/guest', { method: 'POST' });
    server.db.setCoins(body.profile.id, 10_000);
    const deal = dailyDeals(Date.now())[0]!;
    const res = await api('/api/shop/buy', { method: 'POST', token: body.token!, body: { itemId: deal.itemId } });
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.coins, 10_000 - deal.price);
  });
});

describe('chicken upgrades in matches', () => {
  const join = (mode: ModeId) => {
    const { io } = fakeIo();
    const room = createRoom(io, { id: mode, code: 'UPGR1', name: 'U', mode, map: MODES[mode].maps[0]!, private: true, bots: 0 }, {}) as GameRoom;
    clearInterval((room as unknown as { tickTimer: NodeJS.Timeout }).tickTimer);
    const res = room.join(null, { userId: 1, name: 'Strong', appearance: { ...DEFAULT_APPEARANCE }, loadout: [...DEFAULT_LOADOUT], upgrades: ALL5 });
    assert.ok(res.ok);
    return { room, res, p: room.players.get(res.selfPid)! };
  };

  it('count in Zombie Apocalypse and Training, and the client is told the levels', () => {
    for (const mode of ['zombie', 'training'] as const) {
      const { room, res, p } = join(mode);
      assert.ok(p.upgrades, `${mode}: upgrades on`);
      assert.deepEqual(res.ok && res.upgrades, ALL5);
      assert.equal(p.moveMods()!.speed, upgradeEffects(ALL5).speed);
      room.close();
    }
  });

  it('never count in a PvP mode: same stats as everyone', () => {
    for (const mode of MODE_IDS) {
      if (modeUsesUpgrades(MODES[mode]) || MODES[mode].ranked) continue;
      const { room, res, p } = join(mode);
      assert.equal(p.upgrades, null, `${mode}: no upgrades`);
      assert.equal(res.ok && res.upgrades, null);
      assert.equal(p.moveMods(), null, `${mode}: normal movement`);
      room.close();
    }
  });

  it('Health + Armor: a zombie claw takes much less of the bar', () => {
    const { room, p } = join('zombie');
    const before = p.hp;
    room.damage(p, null, 30, false, 'world', { x: 0, y: 0, z: 0 }, performance.now());
    assert.ok(Math.abs(before - p.hp - 30 * upgradeEffects(ALL5).damageTaken) < 0.01);
    room.close();
  });

  it('Reload: faster reloads on the server', () => {
    const { room, p } = join('zombie');
    p.mags.set(p.weapon, 0);
    const t = performance.now();
    room.handleReload(p);
    assert.ok(p.reloadUntil - t <= WEAPONS[p.weapon].reloadTime * upgradeEffects(ALL5).reload + 5);
    room.close();
  });
});

describe('Sniper and Scout', () => {
  it('Sniper: one shot to the body kills; slow bolt; two zoom levels', () => {
    assert.ok(WEAPONS.sniper.damage >= PLAYER.maxHealth);
    assert.ok(WEAPONS.sniper.fireInterval > WEAPONS.scout.fireInterval);
    assert.ok(WEAPONS.sniper.zoom2 && WEAPONS.scout.zoom2);
  });
  it('Scout: only a headshot kills in one; accurate while jumping', () => {
    assert.ok(WEAPONS.scout.damage < PLAYER.maxHealth);
    assert.ok(WEAPONS.scout.damage * WEAPONS.scout.headshotMultiplier >= PLAYER.maxHealth);
    assert.ok(WEAPONS.scout.airSpread < WEAPONS.sniper.airSpread / 4);
    assert.notEqual(WEAPONS.scout.sound, WEAPONS.sniper.sound, 'its own sound');
  });
});
