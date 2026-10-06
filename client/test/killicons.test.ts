import assert from 'node:assert/strict';
import { it } from 'node:test';
import { KILL_FLAGS } from '@game/shared';
import { ALL_CAUSES, killTags, shapeSvg, tagSvg, weaponShape, type TagKind } from '../src/ui/KillIcons';

it('every weapon and other cause of death has a silhouette', () => {
  for (const cause of ALL_CAUSES) {
    const svg = shapeSvg(weaponShape(cause));
    assert.match(svg, /^<svg[^]*<\/svg>$/, cause);
    assert.ok(svg.length > 120, `${cause} looks empty`);
  }
  assert.equal(weaponShape('sniper'), 'sniper');
  assert.equal(weaponShape('butterfly'), 'knife');
  assert.equal(weaponShape('egg'), 'egg');
});

it('kill tags come out in feed order: blind before the killer, the rest after the weapon, the headshot last', () => {
  assert.deepEqual(killTags(0, false), { before: [], after: [] });
  const all = KILL_FLAGS.noscope | KILL_FLAGS.smoke | KILL_FLAGS.wallbang | KILL_FLAGS.air | KILL_FLAGS.blind;
  assert.deepEqual(killTags(all, true), { before: ['blind'], after: ['noscope', 'smoke', 'wallbang', 'air', 'headshot'] });
  for (const kind of ['blind', 'noscope', 'smoke', 'wallbang', 'air', 'headshot'] as TagKind[]) assert.match(tagSvg(kind).html, /<svg/);
});
