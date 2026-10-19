import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { CommandChoker, defaultHvhCore, fakeLagTicks } from '@game/shared';
import { DEFAULT_ERA_ID, ERAS, LATE_CSGO } from '@game/shared/hvh/v2';
import { commandIntent } from '../../src/hvh/PredictedTickbase';
import {
  CONFIG_VERSION, clearMigrationNotice, defaultConfig, migrationNotice, pendingMigrationNotice, queueMigrationNotice, exportConfig, importConfig, loadConfigs, loadCurrentMigrated, migrateConfig, presetConfigs, saveCurrent,
} from '../../src/dev/config';
import { HVH_PANELS } from '../../src/dev/panels';
import { BINDS } from '../../src/keybinds';

/** Every leaf path of a plain JSON object, computed independently of the code under test. */
function leaves(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

/** A config saved before v2: no version, legacy-only settings changed from their defaults. */
function legacySaved(): Record<string, unknown> {
  const c = structuredClone(defaultConfig('skeet')) as unknown as Record<string, any>;
  delete c.version;
  c.hvh.antiAim = { ...c.hvh.antiAim, enabled: true, mode: 'left', jitter: 33, desync: 51 };
  c.hvh.exploit = 'doubleTap';
  c.skeet.fakeLag = { enabled: true, limit: 99, mode: 'random', breakOnShot: false };
  c.hvh.core = { ...c.hvh.core, fakeLag: 40, defensive: true, antiBruteforce: false, fakeDuck: true, era: 'defensive' };
  c.skeet.antiAim.jitterMode = 'threeway';
  c.skeet.antiAim.states.standing.desync = 12;
  c.rage.aim.enabled = true;
  return c;
}

describe('migrateConfig', () => {
  it('keeps AA base, jitter, desync, fake-lag limit (clamped to 14) and the DT/HS toggle', () => {
    const { config, reset } = migrateConfig(legacySaved());
    assert.equal(config.version, CONFIG_VERSION);
    assert.equal(config.hvh.antiAim.mode, 'left');
    assert.equal(config.hvh.antiAim.jitter, 33);
    assert.equal(config.hvh.antiAim.desync, 51);
    assert.equal(config.hvh.antiAim.enabled, true);
    assert.equal(config.hvh.exploit, 'doubleTap');
    assert.equal(config.skeet.fakeLag.enabled, true);
    assert.equal(config.skeet.fakeLag.limit, 14);
    assert.equal(config.skeet.fakeLag.breakOnShot, false);
    assert.equal(config.skeet.fakeLag.mode, 'random', 'choke mode is batching policy; CommandChoker still applies it');
    assert.equal(config.hvh.core!.fakeLag, 14);
    assert.equal(config.rage.aim.enabled, true, 'non-mechanics settings carry over');
    for (const kept of ['hvh.antiAim.mode', 'hvh.antiAim.jitter', 'hvh.antiAim.desync', 'hvh.exploit', 'skeet.fakeLag.limit', 'skeet.fakeLag.enabled', 'hvh.core.fakeLag'])
      assert.ok(!reset.includes(kept), `${kept} must not be reset`);
    const hs = legacySaved() as Record<string, any>; hs.hvh.exploit = 'hideShots';
    assert.equal(migrateConfig(hs).config.hvh.exploit, 'hideShots');
    const mid = legacySaved() as Record<string, any>; mid.skeet.fakeLag.limit = 13;
    assert.equal(migrateConfig(mid).config.skeet.fakeLag.limit, 13);
  });

  it('lists the legacy-only fields in reset but keeps their values for legacy rooms', () => {
    const old = legacySaved() as Record<string, any>;
    old.skeet.antiAim.enabled = false;
    const { config, reset } = migrateConfig(old);
    for (const path of ['hvh.core.defensive', 'hvh.core.antiBruteforce', 'hvh.core.fakeDuck', 'skeet.antiAim.enabled', 'skeet.antiAim.jitterMode', 'skeet.antiAim.states.standing.desync'])
      assert.ok(reset.includes(path), `${path} listed (got ${reset.join(', ')})`);
    assert.equal(config.hvh.core!.defensive, true);
    assert.equal(config.hvh.core!.antiBruteforce, false);
    assert.equal(config.hvh.core!.fakeDuck, true);
    assert.equal(config.skeet.antiAim.enabled, false, 'stance builder stays off');
    assert.equal(config.skeet.antiAim.jitterMode, 'threeway');
    assert.equal(config.skeet.antiAim.states.standing.desync, 12);
    assert.equal(new Set(reset).size, reset.length, 'no duplicates');
    const notice = migrationNotice(reset);
    assert.match(notice, /Not used in v2 rooms \(kept for legacy\): .*hvh\.core\.antiBruteforce/);
    assert.doesNotMatch(notice, /Reset to defaults/);
  });

  it('kept legacy settings survive a save/load round-trip', () => {
    const old = legacySaved() as Record<string, any>;
    old.skeet.antiAim.enabled = false;
    const back = migrateConfig(JSON.parse(JSON.stringify(migrateConfig(old).config)));
    assert.deepEqual(back.reset, []);
    assert.equal(back.config.skeet.antiAim.enabled, false);
    assert.equal(back.config.hvh.core!.antiBruteforce, false);
  });

  it('lists only fields that actually changed: an untouched legacy config resets nothing', () => {
    const c = structuredClone(defaultConfig()) as unknown as Record<string, unknown>;
    delete c.version;
    assert.deepEqual(migrateConfig(c).reset, []);
  });

  it('migrated and untouched configs select the default era table; legacy hvh.core.era is untouched', () => {
    const { config } = migrateConfig(legacySaved());
    assert.equal(config.skeet.era, DEFAULT_ERA_ID);
    assert.equal(config.hvh.core!.era, 'defensive');
    const untouched = structuredClone(defaultConfig()) as unknown as Record<string, any>;
    delete untouched.version; delete untouched.skeet.era;
    const u = migrateConfig(untouched).config;
    assert.equal(u.skeet.era, 'late-csgo');
    assert.equal(u.hvh.core!.era, 'tickbase');
    assert.ok(ERAS[u.skeet.era]);
    assert.equal(defaultConfig().skeet.era, DEFAULT_ERA_ID);
  });

  it('a corrupt or non-object config gives defaults with every field in reset', () => {
    const every = leaves(defaultConfig()).sort();
    for (const bad of [null, undefined, 42, 'garbage', [], [1, 2], true]) {
      const { config, reset } = migrateConfig(bad);
      assert.deepEqual(config, defaultConfig(), String(bad));
      assert.deepEqual([...reset].sort(), every, String(bad));
    }
  });

  it('an already-migrated config resets nothing and migration is idempotent', () => {
    const once = migrateConfig(legacySaved()).config;
    const twice = migrateConfig(structuredClone(once));
    assert.deepEqual(twice.reset, []);
    assert.deepEqual(twice.config, once);
    for (const panel of ['lab', 'skeet'] as const) for (const p of presetConfigs(panel)) assert.deepEqual(migrateConfig(p.config).reset, [], p.name);
  });

  it('migrated configs still produce a valid legacy loadout', () => {
    const { config } = migrateConfig(legacySaved());
    const loadout = HVH_PANELS.skeet.loadout(config);
    assert.equal(loadout.exploit, 'doubleTap');
    assert.equal(loadout.antiAim.mode, 'left');
    assert.equal(loadout.core!.fakeLag, 14);
    assert.equal(loadout.core!.era, 'defensive', 'legacy rooms keep their era profile');
  });

  it('the Defensive bind does not collide with game actions or other HvH keys', () => {
    for (const panel of ['lab', 'skeet'] as const) {
      const c = defaultConfig(panel);
      assert.equal(c.hvh.defensive, false);
      const keys = [c.hvh.aim.overrideKey, c.hvh.aim.bodyKey, c.hvh.movement.peekKey, c.hvh.invertKey, c.hvh.defensiveKey];
      assert.equal(new Set(keys).size, keys.length);
      assert.ok(!BINDS.some(b => b.code === c.hvh.defensiveKey));
    }
  });
});

describe('config loading with migration', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    };
  });

  it('reports reset fields until the migrated config is saved, then never again', () => {
    store.set('chikengun:dev:skeet', JSON.stringify(legacySaved()));
    const first = loadCurrentMigrated('skeet');
    assert.ok(first.reset.includes('hvh.core.defensive'));
    assert.ok(loadCurrentMigrated('skeet').reset.length > 0, 'not saved yet: still pending');
    saveCurrent(first.config, 'skeet');
    const after = loadCurrentMigrated('skeet');
    assert.deepEqual(after.reset, []);
    assert.deepEqual(after.config, first.config);
  });

  it('pending notice entries survive a reload and clear after they are shown', () => {
    assert.deepEqual(pendingMigrationNotice(), []);
    queueMigrationNotice(['Old: hvh.core.fakeDuck']);
    queueMigrationNotice(['hvh.core.defensive', 'Old: hvh.core.fakeDuck']);
    // A reload re-reads storage only.
    assert.deepEqual(pendingMigrationNotice(), ['Old: hvh.core.fakeDuck', 'hvh.core.defensive']);
    assert.deepEqual(queueMigrationNotice([]), ['Old: hvh.core.fakeDuck', 'hvh.core.defensive']);
    assert.match(migrationNotice(pendingMigrationNotice()), /kept for legacy\): Old: hvh\.core\.fakeDuck, hvh\.core\.defensive/);
    clearMigrationNotice();
    assert.deepEqual(pendingMigrationNotice(), []);
    store.set('chikengun:dev-migration-notice', '{broken');
    assert.deepEqual(pendingMigrationNotice(), []);
  });

  it('a missing config is not a migration; unreadable JSON resets everything', () => {
    assert.deepEqual(loadCurrentMigrated('skeet'), { config: defaultConfig('skeet'), reset: [] });
    store.set('chikengun:dev:skeet', '{not json');
    const broken = loadCurrentMigrated('skeet');
    assert.deepEqual(broken.config, defaultConfig('skeet'));
    assert.deepEqual([...broken.reset].sort(), leaves(defaultConfig()).sort());
  });

  it('saved and imported legacy configs are migrated', () => {
    store.set('chikengun:dev-configs:skeet', JSON.stringify([{ name: 'Old', config: legacySaved() }]));
    const [old] = loadConfigs('skeet');
    assert.equal(old!.config.version, CONFIG_VERSION);
    assert.equal(old!.config.skeet.fakeLag.limit, 14);
    const imported = importConfig(JSON.stringify({ format: 'chikengun-dev-config', version: 1, name: 'Old', config: legacySaved() }));
    assert.ok(imported.reset.includes('skeet.antiAim.jitterMode'));
    assert.equal(imported.config.hvh.antiAim.desync, 51);
    const roundTrip = importConfig(exportConfig({ name: 'New', config: imported.config }));
    assert.deepEqual(roundTrip.reset, []);
    assert.deepEqual(roundTrip.config, imported.config);
  });
});

describe('panel values reach intents through the shared rules only', () => {
  it('Defensive press becomes intent.defensive; the rest of the intent is unchanged', () => {
    const base = { seq: 5, shotSeq: null, hitscan: true, held: false, exploit: 'off' as const };
    assert.equal((commandIntent(base) as { defensive?: boolean }).defensive, false); // Task 8
    assert.deepEqual(commandIntent({ ...base, defensive: true }), { ...commandIntent(base), defensive: true });
  });

  it('a 14-tick choke limit holds 14 commands in v2 rooms and stays capped at 12 in legacy rooms', () => {
    const core = { ...defaultHvhCore(), fakeLag: 14 };
    assert.equal(fakeLagTicks(core, 1, 0), 12, 'legacy cap unchanged');
    assert.equal(fakeLagTicks(core, 1, 0, false, LATE_CSGO.maxChoke), 14);
    const frame = (seq: number) => ({ seq, forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, jet: false, firing: false, use: false } as never);
    for (const [max, held] of [[undefined, 12], [LATE_CSGO.maxChoke, 14]] as const) {
      const choker = new CommandChoker();
      let n = 0;
      for (let seq = 1; seq <= 20; seq++) { if (choker.push(frame(seq), 14, false, max).length) break; n++; }
      assert.equal(n, held);
    }
  });
});
