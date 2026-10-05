import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CROUCH, DEFAULT_MODS, HITBOX, WEAPONS, WEAPON_IDS } from '@game/shared';
import { defaultConfig, exportConfig, importConfig, loadConfigs, loadCurrent, presetConfigs, sanitizeConfig, saveConfigs, saveCurrent, toServerMods } from '../src/dev/config';
import { SKEET_GROUPS, skeetEffectiveConfig, skeetProfile, skeetWeaponGroup } from '../src/dev/skeet/model';
import { skeetPointOffsets, skeetSafeRay } from '../src/dev/skeet/points';
it('weapon profiles cover the complete roster and fall back without mutating normal stats or Lab settings', () => {
  const c = defaultConfig('skeet');
  assert.equal(skeetWeaponGroup(WEAPONS.deagle), 'pistols'); assert.equal(skeetWeaponGroup(WEAPONS.scout), 'snipers');
  assert.equal(skeetWeaponGroup(WEAPONS.autoshotgun), 'shotguns'); assert.equal(skeetWeaponGroup(WEAPONS.lmg), 'heavy');
  assert.equal(skeetWeaponGroup(WEAPONS.rocket), 'general'); assert.equal(skeetWeaponGroup(WEAPONS.butterfly), 'general');
  for (const id of WEAPON_IDS) assert.ok(SKEET_GROUPS.includes(skeetWeaponGroup(WEAPONS[id])));
  c.skeet.profiles.snipers.enabled = false; assert.equal(skeetProfile(c, WEAPONS.sniper), c.skeet.profiles.general);
  c.skeet.profiles.pistols.minDamage = 45;
  const applied = skeetEffectiveConfig(c, WEAPONS.deagle);
  assert.equal(applied.hvh.aim.minDamage, 45); assert.equal(c.hvh.aim.minDamage, 20);
  assert.equal(c.skeet.profiles.rifles.minDamage, 20); assert.deepEqual(toServerMods(applied), DEFAULT_MODS);
});
it('Skeet configs clamp every new numeric policy and preserve safe legacy imports', () => {
  const raw = defaultConfig('skeet'); raw.skeet.profiles.snipers.pointScale = 999; raw.skeet.profiles.pistols.hitchance = -1;
  raw.skeet.resolver.history = Infinity; raw.skeet.resolver.memoryMs = 9999; raw.skeet.antiAim.states.moving.desync = 999;
  raw.skeet.cosmetics.tint = 'javascript:evil'; raw.rage.weapon.noSpread = true;
  const safe = sanitizeConfig(raw);
  assert.equal(safe.skeet.profiles.snipers.pointScale, 75); assert.equal(safe.skeet.profiles.pistols.hitchance, 0);
  assert.equal(safe.skeet.resolver.history, 8); assert.equal(safe.skeet.resolver.memoryMs, 1200);
  assert.equal(safe.skeet.antiAim.states.moving.desync, 58); assert.equal(safe.skeet.cosmetics.tint, '#b6d77a');
  assert.equal(safe.rage.weapon.noSpread, false);
  assert.deepEqual(importConfig(exportConfig({ name: 'Skeet test', config: safe })).config, safe);
  for (const preset of presetConfigs('skeet')) { assert.deepEqual(sanitizeConfig(preset.config), preset.config); assert.deepEqual(toServerMods(preset.config), DEFAULT_MODS); }
});
it('Lab and Skeet current settings and named presets survive reload in separate stores', t => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
  t.after(() => Reflect.deleteProperty(globalThis, 'localStorage'));
  const lab = defaultConfig(), skeet = defaultConfig('skeet'); lab.hvh.aim.minDamage = 33; skeet.skeet.profiles.snipers.minDamage = 70;
  saveCurrent(lab); saveCurrent(skeet, 'skeet'); saveConfigs([{ name: 'Lab only', config: lab }]); saveConfigs([{ name: 'Skeet only', config: skeet }], 'skeet');
  assert.equal(loadCurrent().hvh.aim.minDamage, 33); assert.equal(loadCurrent('skeet').skeet.profiles.snipers.minDamage, 70);
  assert.equal(loadConfigs()[0]!.name, 'Lab only'); assert.equal(loadConfigs('skeet')[0]!.name, 'Skeet only');
});
it('migrates old public-real and visual resolver configs to the observable center assumption', () => {
  for (const mode of ['real', 'visual']) {
    const c = defaultConfig('skeet');
    assert.equal(sanitizeConfig({ ...c, skeet: { ...c.skeet, resolver: { ...c.skeet.resolver, mode } } }).skeet.resolver.mode, 'center');
  }
});
it('multipoints stay inside standing and crouching hit volumes and safe points reject ambiguous head edges', () => {
  for (const scale of [1, CROUCH.scale]) for (const part of ['head', 'body'] as const) {
    const radius = (part === 'head' ? HITBOX.headRadius : HITBOX.bodyRadius) * scale;
    for (const point of skeetPointOffsets(part, scale, 999, true)) assert.ok(Math.hypot(point.x, point.y, point.z) < radius);
    assert.equal(skeetPointOffsets(part, scale, 50, false).length, 1);
  }
  const target = { x: 0, y: 0, z: 10, yaw: 0, scale: 1, hp: 100, armor: 0 }, eye = { x: 0, y: HITBOX.headHeight, z: 0 };
  assert.equal(skeetSafeRay(eye, { x: 0, y: 0, z: 10 }, target, 25, 20), true);
  assert.equal(skeetSafeRay(eye, { x: 0.22, y: 0, z: 9.7 }, target, 0, 20), true);
  assert.equal(skeetSafeRay(eye, { x: 0.22, y: 0, z: 9.7 }, target, 25, 20), false);
});
