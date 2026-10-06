import { HVH_STANCES } from '@game/shared';
import type { Dev } from '../Dev';
import type { Control, Tab } from '../controls';
import { buildTabs } from '../tabs';
import type { SkeetGroup } from './model';

export function buildSkeetTabs(dev: Dev, group: SkeetGroup = 'general', state: typeof HVH_STANCES[number] = 'standing'): Tab[] {
  const lab = buildTabs(dev), sections = (id: string) => lab.find(t => t.id === id)!.sections;
  const toggle = (label: string, path: string): Control => ({ type: 'toggle', label, path });
  const slider = (label: string, path: string): Control => ({ type: 'slider', label, path });
  const select = (label: string, path: string): Control => ({ type: 'select', label, path });
  const key = (label: string, path: string): Control => ({ type: 'key', label, path });
  const profile = `skeet.profiles.${group}`, stance = `skeet.antiAim.states.${state}`;
  return [
    { id: 'rage', label: 'Aim', icon: '⌖', sections: [
      { ...sections('aim')[1]!, items: sections('aim')[1]!.items.filter(c => c.type !== 'info') },
      { title: 'Shot overrides', icon: 'ϟ', items: [toggle('Autowall', 'hvh.aim.autowall'), key('Force body aim', 'hvh.aim.bodyKey'),
        slider('Damage override', 'hvh.aim.damageOverride'), key('Damage override key', 'hvh.aim.overrideKey')] },
      { title: 'Weapon profile', icon: '◎', items: [
        ...(group === 'general' ? [] : [toggle('Override general profile', `${profile}.enabled`)]),
        slider('Minimum damage', `${profile}.minDamage`), slider('Hit chance', `${profile}.hitchance`), select('Body aim preference', `${profile}.bodyAim`),
        toggle('Safe points', `${profile}.safePoints`), toggle('Multipoint', `${profile}.multipoint`), slider('Point scale', `${profile}.pointScale`),
        toggle('Auto-stop', `${profile}.autoStop`), toggle('Auto-scope', `${profile}.autoScope`)] },
      { title: 'Resolver', icon: '◈', items: [select('Resolver mode', 'skeet.resolver.mode'),
        slider('Prefer body below confidence', 'skeet.resolver.preferBodyBelow'), slider('Prefer body after misses', 'skeet.resolver.missedShots'),
        { type: 'info', label: 'Reading', value: () => dev.runtime.resolverInfo }] },
    ] },
    { id: 'antiaim', label: 'Anti-aim', icon: '↻', sections: [
      { title: 'Angles', icon: '↻', items: [toggle('Enable anti-aim', 'hvh.antiAim.enabled'), toggle('Use state builder', 'skeet.antiAim.enabled'),
        toggle('At targets', 'skeet.antiAim.atTargets'), toggle('Freestanding', 'skeet.antiAim.freestanding'),
        select('Jitter pattern', 'skeet.antiAim.jitterMode'), slider('Jitter interval', 'skeet.antiAim.interval'),
        select('Desync pattern', 'skeet.antiAim.desyncMode'), select('Pitch', 'skeet.antiAim.visualPitch'), key('Invert desync', 'hvh.invertKey')] },
      { title: 'Movement stance', icon: '◇', items: [select('Yaw base', `${stance}.mode`), slider('Yaw offset', `${stance}.yawOffset`),
        slider('Desync angle', `${stance}.desync`), slider('Jitter amplitude', `${stance}.jitter`)] },
      { title: 'Fallback', icon: '↻', items: dev.config.skeet.antiAim.enabled ? [] : sections('antiaim')[0]!.items.filter(c => 'path' in c && c.path && !['hvh.antiAim.enabled','hvh.invertKey'].includes(c.path)) },
    ] },
    { id: 'fakelag', label: 'Fake lag', icon: '⌁', sections: [
      { title: 'Packets', icon: '⌁', items: [toggle('Fake lag', 'skeet.fakeLag.enabled'), slider('Choke limit', 'skeet.fakeLag.limit'),
        select('Choke mode', 'skeet.fakeLag.mode'), toggle('Break on shot', 'skeet.fakeLag.breakOnShot'),
        toggle('Anti-bruteforce', 'hvh.core.antiBruteforce'), toggle('Fake duck', 'hvh.core.fakeDuck'),
        ...sections('exploits')[0]!.items.slice(0, 2)] },
    ] },
    { id: 'misc', label: 'Settings', icon: '☰', sections: [
      { ...sections('movement')[0]!, items: sections('movement')[0]!.items.filter(c => c.type !== 'info' && !('path' in c && c.path === 'hvh.movement.autoStop')) },
      { title: 'Movement', icon: '➶', items: [toggle('Subtick strafe', 'hvh.movement.subtickStrafe'), toggle('Jump buffer', 'legit.move.jumpAssist')] },
    ] },
    { id: 'settings', label: 'Settings', icon: '☰', sections: [
      { title: 'Display', icon: '▤', items: [toggle('Resolver indicator', 'skeet.indicators.resolver'), toggle('Keybind list', 'skeet.indicators.binds'),
        toggle('Shot log', 'hvh.feedback.shotLog'), toggle('Speed', 'misc.speed'), toggle('Ping', 'misc.ping')] },
      { title: 'Menu', icon: '▦', items: [key('Menu key', 'settings.menuKey'), slider('Menu scale', 'settings.scale'), slider('Menu opacity', 'settings.opacity')] },
    ] },
  ];
}
