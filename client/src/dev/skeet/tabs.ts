import { HVH_STANCES, hvhStance } from '@game/shared';
import { h } from '../../ui/dom';
import type { Dev } from '../Dev';
import type { Control, Section, Tab } from '../controls';
import { buildTabs } from '../tabs';
import { SKEET_GROUPS, skeetProfile, skeetWeaponGroup } from './model';

/** SDK tab order, with native game features in place of Source-engine hooks. */
export function buildSkeetTabs(dev: Dev): Tab[] {
  const lab = buildTabs(dev);
  const sections = (id: string) => lab.find(t => t.id === id)!.sections;
  const toggle = (label: string, path: string, hint?: string): Control => ({ type: 'toggle', label, path, hint });
  const slider = (label: string, path: string, unit?: string, hint?: string): Control => ({ type: 'slider', label, path, unit, hint });
  const select = (label: string, path: string, hint?: string): Control => ({ type: 'select', label, path, hint });
  const info = (label: string, value: () => string, hint?: string): Control => ({ type: 'info', label, value, hint });
  const key = (label: string, path: string): Control => ({ type: 'key', label, path });
  const profileNames = ['General fallback', 'Pistols', 'Rifles', 'Snipers', 'Shotguns', 'SMGs', 'Heavy'];
  const profiles: Section[] = SKEET_GROUPS.map((group, i) => {
    const path = `skeet.profiles.${group}`;
    return { title: profileNames[i]!, icon: '◎', items: [
      ...(group === 'general' ? [] : [toggle('Override general profile', `${path}.enabled`)]),
      slider('Minimum damage', `${path}.minDamage`, 'HP', 'Estimated health damage after armor; lethal shots can pass'),
      slider('Hit chance', `${path}.hitchance`, '%', 'Includes movement spread, recoil, cover and safe-point checks'),
      select('Body aim preference', `${path}.bodyAim`), toggle('Multipoint', `${path}.multipoint`),
      slider('Point scale', `${path}.pointScale`, '%', 'Samples inside the chicken head and body hitboxes'),
      toggle('Safe points', `${path}.safePoints`, 'Require the ray to hit across observed stance uncertainty'),
      toggle('Auto-stop', `${path}.autoStop`),
      ...(group === 'snipers' || group === 'general' ? [toggle('Auto-scope', `${path}.autoScope`, 'Scopes while tracking a target beyond 12 m')] : []),
    ] };
  });
  const recipe = (label: string, run: () => void): Control => ({ type: 'buttons', label, items: [{ label: 'Apply', run: () => { run(); dev.menuRefresh(); dev.notify(`${label} applied`, 'good'); } }] });
  return [
    { id: 'rage', label: 'Rage', icon: '⌖', configKey: ['rage.aim', 'hvh.aim', 'skeet.profiles'], sections: [
      sections('aim')[1]!,
      { title: 'Shot overrides', icon: 'ϟ', items: [
        select('Aim style', 'skeet.aimStyle'), toggle('Autowall', 'hvh.aim.autowall', 'Uses the normal crate, hay and wood penetration rules'),
        key('Force body aim', 'hvh.aim.bodyKey'), slider('Damage override threshold', 'hvh.aim.damageOverride', 'HP'), key('Damage override key', 'hvh.aim.overrideKey'),
        info('Active profile', () => { const w = dev.runtime.currentSession?.weapons.def; return w ? `${w.name} · ${skeetWeaponGroup(w)}${skeetProfile(dev.config, w) === dev.config.skeet.profiles.general ? ' · general fallback' : ''}` : 'Join a match to see your weapon profile'; }),
      ] }, ...profiles,
    ] },
    { id: 'antiaim', label: 'Anti-aim', icon: '↻', configKey: ['hvh.antiAim', 'hvh.invertKey', 'hvh.exploit', 'skeet.antiAim', 'skeet.resolver'], sections: [
      { title: 'Stance builder', icon: '↻', items: [
        toggle('Enable anti-aim', 'hvh.antiAim.enabled'), toggle('Use state builder', 'skeet.antiAim.enabled', 'Uses a separate policy for each movement state'),
        toggle('At targets', 'skeet.antiAim.atTargets'), toggle('Freestanding', 'skeet.antiAim.freestanding', 'The server tests cover on either side of your chicken'),
        select('Jitter pattern', 'skeet.antiAim.jitterMode'), slider('Jitter interval', 'skeet.antiAim.interval', 'ms'),
        select('Desync pattern', 'skeet.antiAim.desyncMode'), select('Visual pitch', 'skeet.antiAim.visualPitch', 'Cosmetic head tilt; shooting and hitboxes use real pitch'),
        slider('Spin speed', 'hvh.antiAim.spinSpeed', '°/s'), key('Invert desync', 'hvh.invertKey'),
        info('Current state', () => { const s = dev.runtime.currentSession?.local; return s ? hvhStance({ speed: s.server.horizontalSpeed, crouching: s.server.crouching, onGround: s.server.onGround }) : 'Standing'; }),
      ] },
      { title: 'Resolver', icon: '◈', items: [
        select('Resolver mode', 'skeet.resolver.mode'), slider('History samples', 'skeet.resolver.history'), slider('History window', 'skeet.resolver.memoryMs', 'ms'),
        slider('Prefer body below confidence', 'skeet.resolver.preferBodyBelow', '%'), slider('Prefer body after misses', 'skeet.resolver.missedShots', 'shots', '0 disables this fallback. Counts only server-confirmed assisted shots'),
        info('Stance reading', () => dev.runtime.resolverInfo), info('Public real stance', () => 'Cyan arrow = real heading · shot reveal = 300 ms'),
      ] },
      ...HVH_STANCES.map(state => ({ title: `${state[0]!.toUpperCase()}${state.slice(1)} stance`, icon: '◇', items: [
        select('Yaw base', `skeet.antiAim.states.${state}.mode`), slider('Yaw offset', `skeet.antiAim.states.${state}.yawOffset`, '°'),
        slider('Desync angle', `skeet.antiAim.states.${state}.desync`, '°'), slider('Jitter amplitude', `skeet.antiAim.states.${state}.jitter`, '°'),
      ] })),
      ...sections('exploits'),
      { title: 'Fallback stance', icon: '↻', items: [select('Fallback yaw', 'hvh.antiAim.mode'), slider('Fallback desync', 'hvh.antiAim.desync', '°'), slider('Fallback jitter', 'hvh.antiAim.jitter', '°')] },
    ] },
    { id: 'legit', label: 'Legit', icon: '◎', configKey: ['skeet.aimStyle', 'skeet.smoothing', 'legit.trigger'], sections: [
      { title: 'Smooth targeting', icon: '◎', items: [select('Aim style', 'skeet.aimStyle'), toggle('Aim assist', 'rage.aim.enabled'), slider('Smoothing', 'skeet.smoothing', '×'), slider('Aim FOV', 'rage.aim.fov', '°'), slider('Reaction delay', 'hvh.aim.reaction', 'ms'), info('Shared target policy', () => 'Uses Rage weapon profiles and resolver settings')] },
      { ...sections('aim')[3]!, items: sections('aim')[3]!.items.map(c => c.label === 'Trigger assist' ? { ...c, hint: 'Works with smooth targeting or with aim assist disabled' } : c) },
    ] },
    { id: 'visuals', label: 'Visuals', icon: '◈', configKey: ['visuals', 'legit.wall', 'world'], sections: [...sections('visuals'), ...sections('world')] },
    { id: 'misc', label: 'Misc', icon: '☰', configKey: ['misc', 'hvh.feedback', 'skeet.indicators', 'legit.move', 'hvh.movement', 'settings'], sections: [
      { title: 'Indicators', icon: '▤', items: [toggle('Resolver indicator', 'skeet.indicators.resolver'), toggle('Keybind list', 'skeet.indicators.binds'), toggle('Watermark', 'skeet.indicators.watermark')] },
      ...sections('telemetry').slice(0, 2),
      { ...sections('movement')[0]!, items: sections('movement')[0]!.items.filter(c => !('path' in c) || c.path !== 'hvh.movement.autoStop') },
      sections('movement')[1]!, ...sections('settings'),
    ] },
    { id: 'skins', label: 'Skins', icon: '✦', configKey: ['skeet.cosmetics', 'weapons.selected'], sections: [
      { title: 'Weapon finish', icon: '✦', items: [toggle('Custom weapon tint', 'skeet.cosmetics.enabled'), { type: 'color', label: 'Finish color', path: 'skeet.cosmetics.tint' },
        { type: 'buttons', label: 'Inspect', items: [{ label: 'Inspect weapon', run: () => dev.runtime.currentSession?.inspectWeapon(), disabled: () => !dev.runtime.currentSession }] },
        info('Preview', () => 'Local first-person weapon finish'),
      ] }, ...sections('weapons'),
    ] },
    { id: 'players', label: 'Players', icon: '☺', sections: [
      { title: 'Opponent overrides', icon: '☺', wide: true, items: [{ type: 'custom', label: 'Match players', render: () => skeetPlayers(dev) }] },
      { title: 'Override scope', icon: '◇', wide: true, items: [info('This match', () => 'Ignore excludes an opponent from assisted targeting. Body prioritizes their body hitbox.', 'Overrides clear when you leave or switch panels. Manual shots remain available.')] },
    ] },
    { id: 'configs', label: 'Configs', icon: '▣', sections: sections('configs') },
    { id: 'extensions', label: 'Extensions', icon: '⌘', sections: [
      { title: 'Native recipes', icon: '⌘', wide: true, items: [
        recipe('Precision safe points', () => { const c = structuredClone(dev.config); Object.assign(c.skeet.profiles.snipers, { enabled: true, hitchance: 85, safePoints: true, pointScale: 35, autoScope: true }); dev.replaceConfig(c); }),
        recipe('Ground peek', () => { const c = structuredClone(dev.config); c.hvh.movement.peekAssist = c.hvh.movement.slowWalk = true; dev.replaceConfig(c); }),
        recipe('State jitter', () => { const c = structuredClone(dev.config); c.hvh.antiAim.enabled = c.skeet.antiAim.enabled = true; c.skeet.antiAim.jitterMode = 'center'; c.skeet.antiAim.desyncMode = 'alternate'; dev.replaceConfig(c); }),
        info('Recipe library', () => 'Apply a recipe, adjust its settings, then save it as a config.'),
      ] },
    ] },
  ];
}

function skeetPlayers(dev: Dev): HTMLElement & { refresh(): void } {
  const root = Object.assign(h('div', { class: 'skeet-players' }), { refresh() {} });
  const rows = new Map<number, { el: HTMLElement; title: HTMLElement; detail: HTMLElement; ignore: HTMLInputElement; body: HTMLInputElement }>();
  root.refresh = () => {
    const session = dev.runtime.currentSession;
    const players = session ? [...session.infos.values()].filter(p => p.pid !== session.selfPid) : [];
    const current = new Set(players.map(p => p.pid));
    for (const [pid, row] of rows) if (!current.has(pid)) { row.el.remove(); rows.delete(pid); }
    if (!players.length) { if (!root.querySelector('p')) root.append(h('p', { class: 'dev-muted' }, 'Join a match with opponents to set overrides.')); return; }
    root.querySelector('p')?.remove();
    for (const p of players) {
      let row = rows.get(p.pid);
      if (!row) {
        const title = h('b'), detail = h('small', { class: 'dev-muted' });
        const ignore = h('input', { type: 'checkbox', class: 'dev-check', 'aria-label': `Ignore ${p.name}` });
        const body = h('input', { type: 'checkbox', class: 'dev-check', 'aria-label': `Body aim ${p.name}` });
        ignore.addEventListener('change', () => dev.runtime.setPlayerRule(p.pid, 'ignore', ignore.checked));
        body.addEventListener('change', () => dev.runtime.setPlayerRule(p.pid, 'body', body.checked));
        const el = h('div', { class: 'skeet-player' }, h('div', null, title, detail), h('label', null, ignore, 'Ignore'), h('label', null, body, 'Body'));
        row = { el, title, detail, ignore, body }; rows.set(p.pid, row); root.append(el);
      }
      const state = session?.remotes.players.get(p.pid)?.latest, rule = dev.runtime.playerRule(p.pid);
      row.title.textContent = p.name + (p.bot ? ' [BOT]' : '');
      row.detail.textContent = state ? `${state.alive ? `${state.hp} HP` : 'Down'} · ${hvhStance({ speed: state.horizontalSpeed, onGround: state.onGround, crouching: state.crouching })} · ${p.kills} K / ${p.deaths} D` : `${p.kills} K / ${p.deaths} D`;
      row.ignore.checked = rule.ignore; row.body.checked = rule.body;
    }
  };
  root.refresh(); return root;
}
