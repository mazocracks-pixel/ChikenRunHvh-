import assert from 'node:assert/strict';
import { it } from 'node:test';
import { BUILTIN_CONFIGS, configPrint, defaultConfig, exportConfig, importConfig, resetConfig, sanitizeConfig } from '../src/dev/classic/config';

it('every built-in mega?dev config changes settings, stays in range and keeps the menu look', () => {
  const current = defaultConfig();
  Object.assign(current.settings, { menuKey: 'KeyK', theme: 'ocean' });
  current.world.grass = '#123456';
  assert.equal(BUILTIN_CONFIGS.length, 9);
  for (const b of BUILTIN_CONFIGS) {
    const c = b.build(current);
    assert.deepEqual(sanitizeConfig(c), c, b.name);
    assert.notEqual(configPrint(c), configPrint(resetConfig(current)), `${b.name} changes nothing`);
    assert.equal(c.settings.menuKey, 'KeyK');
    assert.equal(c.world.grass, '#123456');
  }
  const by = (n: string) => BUILTIN_CONFIGS.find((b) => b.name === n)!.build(current);
  assert.equal(by('Totally Legit™').legit.aim.fov, 2);
  assert.equal(by('Totally Legit™').visuals.esp.enabled, false);
  assert.equal(by('Gaming Chair').weapons.recoil, 0.5);
  assert.equal(by('$9 YouTube Config').rage.aim.fov, 180);
  assert.equal(by('UID Issue').rage.antiAim.speed, 720);
  assert.equal(by('Spinbot Supreme').rage.aim.enabled, false);
});

it('a config exports as a short code and imports back the same; old JSON files still import', () => {
  const config = BUILTIN_CONFIGS.find((b) => b.name === 'Memesense')!.build(defaultConfig());
  const code = exportConfig({ name: 'My cfg', config });
  assert.match(code, /^CRH1-[\w-]+$/);
  assert.ok(code.length < 600, `code is ${code.length} chars`);
  assert.deepEqual(importConfig(code), { name: 'My cfg', config });
  assert.deepEqual(importConfig(`  ${code}\n`).config, config);
  assert.deepEqual(importConfig(JSON.stringify({ format: 'chikengun-dev-config', name: 'Old', config })).config, config);
  assert.throws(() => importConfig(code.slice(0, 20)), /broken/);
  assert.equal(importConfig(exportConfig({ name: 'Plain', config: defaultConfig() })).config.rage.aim.enabled, false);
});
