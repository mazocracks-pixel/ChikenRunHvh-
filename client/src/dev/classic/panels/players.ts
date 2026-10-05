import { JUMPSCARE_STYLES, PLAYER, TEAM_NAMES, WEAPONS, WEAPON_IDS, type DevAction, type JumpscareStyle, type WeaponId } from '@game/shared';
import { h } from '../../../ui/dom';
import type { Dev } from '../Dev';

interface Row {
  pid: number;
  name: string;
  self: boolean;
  bot: boolean;
  team: number;
  alive: boolean;
  hp: number;
  weapon: WeaponId | null;
  frozen: boolean;
}

/**
 * Players tab: everyone in the room, and testing actions on the selected one. Every action is
 * a request; the server checks permission and carries it out.
 */
export function playersPanel(dev: Dev): HTMLElement & { refresh: () => void } {
  let selected = 0;
  let lastKey = '';
  const list = h('div', { class: 'dev-plist', role: 'listbox', 'aria-label': 'Players' });
  const note = h('div', { class: 'dev-note' });
  const title = h('div', { class: 'dev-ptitle' }, 'Select a player');
  const armor = h('input', { type: 'range', class: 'dev-range', min: 0, max: PLAYER.maxArmor, step: 5, value: 50, 'aria-label': 'Armor' });
  const armorValue = h('span', { class: 'dev-unit' }, '50');
  armor.addEventListener('input', () => (armorValue.textContent = armor.value));
  const weapon = h('select', { class: 'dev-select', 'aria-label': 'Weapon' }, ...WEAPON_IDS.map((id) => h('option', { value: id }, WEAPONS[id].name)));

  const SCARE_NAMES: Record<JumpscareStyle, string> = { chicken: 'Demon chicken', ghost: 'Ghost', glitch: 'Glitch', flash: 'White flash', funnyChiken: 'funnyChiken' };
  const scare = h('select', { class: 'dev-select', 'aria-label': 'Jumpscare' }, h('option', { value: 'random' }, 'Random'), ...JUMPSCARE_STYLES.map((id) => h('option', { value: id }, SCARE_NAMES[id])));
  const scareStyle = (): JumpscareStyle => (scare.value === 'random' ? JUMPSCARE_STYLES[Math.floor(Math.random() * JUMPSCARE_STYLES.length)]! : (scare.value as JumpscareStyle));

  const rows = (): Row[] => {
    const s = dev.runtime.currentSession;
    if (!s) return [];
    const out: Row[] = [];
    const me = s.infos.get(s.selfPid);
    if (me) out.push({ pid: me.pid, name: me.name, self: true, bot: false, team: me.team, alive: s.local.alive, hp: s.local.server.hp, weapon: s.weapons.weapon, frozen: s.local.server.frozen });
    for (const [pid, r] of s.remotes.players) {
      out.push({ pid, name: r.info.name, self: false, bot: r.info.bot, team: r.info.team, alive: r.alive, hp: r.latest?.hp ?? 0, weapon: r.latest?.weapon ?? null, frozen: r.latest?.frozen ?? false });
    }
    return out;
  };
  const current = () => rows().find((r) => r.pid === selected);

  const act = (make: (pid: number) => DevAction, success: (r: Row) => string) => () => {
    const r = current();
    if (!r) return dev.notify('Select a player first', 'bad');
    void dev.action(make(r.pid), success(r)).then(() => refresh());
  };
  const btn = (label: string, run: () => void, tone = '') => {
    const b = h('button', { type: 'button', class: `dev-btn ${tone}` }, label);
    b.addEventListener('click', () => {
      dev.click();
      run();
    });
    return b;
  };

  const spectateBtn = btn('Spectate', () => {
    const r = current();
    if (!r || r.self) return dev.notify(r ? 'Pick someone else to spectate' : 'Select a player first', 'bad');
    if (!dev.active) return dev.notify('Developer tools are locked in this room', 'bad');
    const on = dev.runtime.spectatePid === r.pid;
    dev.runtime.spectate(on ? 0 : r.pid);
    dev.notify(on ? 'Stopped spectating' : `Spectating ${r.name} (click to switch)`);
    refresh();
  });
  const freezeBtn = btn('Freeze', () => {
    const r = current();
    if (!r) return dev.notify('Select a player first', 'bad');
    void dev.action({ kind: 'freeze', target: r.pid, frozen: !r.frozen }, `${r.name} ${r.frozen ? 'unfrozen' : 'frozen'}`).then(() => refresh());
  });

  const actions = h(
    'div',
    { class: 'dev-pactions' },
    title,
    h(
      'div',
      { class: 'dev-btns' },
      spectateBtn,
      btn('Teleport to', act((pid) => ({ kind: 'teleportToPlayer', target: pid }), (r) => `Teleported to ${r.name}`), 'primary'),
      btn('Bring here', act((pid) => ({ kind: 'bringPlayer', target: pid }), (r) => `Brought ${r.name} to you`)),
      freezeBtn,
      btn('Respawn', act((pid) => ({ kind: 'respawn', target: pid }), (r) => `Respawned ${r.name}`)),
    ),
    h('div', { class: 'dev-sub' }, 'Health'),
    h(
      'div',
      { class: 'dev-btns' },
      btn('+25 HP', act((pid) => ({ kind: 'health', target: pid, amount: 25 }), (r) => `Healed ${r.name}`)),
      btn('Full health', act((pid) => ({ kind: 'health', target: pid, amount: PLAYER.maxHealth }), (r) => `${r.name} at full health`), 'primary'),
      btn('−25 HP', act((pid) => ({ kind: 'health', target: pid, amount: -25 }), (r) => `Hurt ${r.name}`)),
      btn('Kill', act((pid) => ({ kind: 'health', target: pid, amount: -1000 }), (r) => `Removed all of ${r.name}'s health`), 'danger'),
    ),
    h('div', { class: 'dev-sub' }, 'Armor'),
    h('div', { class: 'dev-slider' }, armor, armorValue, btn('Set armor', act((pid) => ({ kind: 'armor', target: pid, value: Number(armor.value) }), (r) => `${r.name}: ${armor.value} armor`))),
    h('div', { class: 'dev-sub' }, 'Weapons'),
    h(
      'div',
      { class: 'dev-btns' },
      weapon,
      btn('Give weapon', act((pid) => ({ kind: 'giveWeapon', target: pid, weapon: weapon.value as WeaponId }), (r) => `Gave ${r.name} the ${WEAPONS[weapon.value as WeaponId].name}`), 'primary'),
      btn('Remove weapon', act((pid) => ({ kind: 'removeWeapon', target: pid, weapon: weapon.value as WeaponId }), (r) => `Took the ${WEAPONS[weapon.value as WeaponId].name} from ${r.name}`)),
      btn('Refill ammo', act((pid) => ({ kind: 'refill', target: pid }), (r) => `Refilled ${r.name}`)),
    ),
    h('div', { class: 'dev-sub' }, 'Prank'),
    h(
      'div',
      { class: 'dev-btns' },
      scare,
      btn('Jumpscare', act((pid) => ({ kind: 'jumpscare', target: pid, style: scareStyle() }), (r) => `Jumpscared ${r.name} 👻`), 'danger'),
      btn('White flash', act((pid) => ({ kind: 'jumpscare', target: pid, style: 'flash' }), (r) => `Flashed ${r.name} ⚪`)),
    ),
  );

  const root = Object.assign(h('div', { class: 'dev-players' }, note, h('div', { class: 'dev-pgrid' }, list, actions)), { refresh: () => {} });

  const refresh = () => {
    const s = dev.runtime.currentSession;
    note.hidden = !!s && dev.active;
    note.textContent = !s ? 'Join a match to see and test players.' : 'Developer tools are locked in this room. Use a private room (Create room → Private).';
    const all = rows();
    if (!all.some((r) => r.pid === selected)) selected = all.find((r) => !r.self)?.pid ?? all[0]?.pid ?? 0;
    const sel = current();
    title.textContent = sel ? `${sel.name}${sel.self ? ' (you)' : ''}` : 'Select a player';
    freezeBtn.textContent = sel?.frozen ? 'Unfreeze' : 'Freeze';
    spectateBtn.textContent = sel && dev.runtime.spectatePid === sel.pid ? 'Stop spectating' : 'Spectate';
    actions.classList.toggle('disabled', !sel);

    const key = JSON.stringify([selected, all]);
    if (key === lastKey) return;
    lastKey = key;
    list.replaceChildren(
      ...(all.length === 0
        ? [h('div', { class: 'dev-empty' }, 'No players')]
        : all.map((r) => {
            const tags = [r.self ? 'YOU' : null, r.bot ? 'BOT' : null, r.team ? TEAM_NAMES[r.team as 1 | 2] : null, r.frozen ? 'FROZEN' : null, r.alive ? null : 'DEAD'].filter(Boolean);
            const row = h(
              'button',
              { type: 'button', class: `dev-prow${r.pid === selected ? ' active' : ''}${r.alive ? '' : ' dead'}`, role: 'option', 'aria-selected': String(r.pid === selected) },
              h('span', { class: 'dev-pname' }, r.name),
              h('span', { class: 'dev-ptags' }, tags.join(' · ')),
              h('span', { class: 'dev-php' }, h('i', { style: `width:${Math.max(0, Math.min(100, r.hp))}%` })),
              h('span', { class: 'dev-pweapon' }, r.weapon ? WEAPONS[r.weapon].name : ''),
            );
            row.addEventListener('click', () => {
              selected = r.pid;
              dev.click();
              refresh();
            });
            return row;
          })),
    );
  };
  root.refresh = refresh;
  refresh();
  return root;
}
