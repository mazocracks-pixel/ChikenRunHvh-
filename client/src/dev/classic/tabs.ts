import { PLAYER, ROCKET_SPAM_INTERVAL_MS, WEAPONS, WEAPON_IDS, damageAt, spreadFor, type WeaponId } from '@game/shared';
import { getCameraMode, setCameraMode } from '../../game/CameraRig';
import { SURFACES, defaultLook, type Surface, type WorldLook } from '../../game/look';
import { getSettings, updateSettings } from '../../settings';
import type { Section, Tab } from './controls';
import type { Dev } from './Dev';
import { configsPanel } from './panels/configs';
import { playersPanel } from './panels/players';

const deg = (rad: number) => `${((rad * 180) / Math.PI).toFixed(2)}°`;
const weaponOptions = WEAPON_IDS.map((id) => ({ value: id, label: WEAPONS[id].name }));

/** Every tab of the developer menu, as data. Add a control here and it gets search, reset and configs for free. */
export function buildTabs(dev: Dev): Tab[] {
  const selfPid = () => dev.runtime.currentSession?.selfPid ?? 0;
  const selected = () => dev.config.weapons.selected as WeaponId;
  const notInMatch = () => !dev.runtime.currentSession;

  const legit: Tab = {
    id: 'legit',
    label: 'Legit',
    icon: '◎',
    configKey: 'legit',
    sections: [
      {
        title: 'Aim',
        icon: '⌖',
        items: [
          { type: 'toggle', label: 'Enable aim assist', path: 'legit.aim.enabled' },
          { type: 'slider', label: 'Aim FOV', path: 'legit.aim.fov', unit: '°', hint: 'How close to the crosshair a target must be' },
          { type: 'slider', label: 'Smoothness', path: 'legit.aim.smooth', hint: '1 = snappy, 20 = very gentle' },
          { type: 'slider', label: 'Aim strength', path: 'legit.aim.strength', unit: '%' },
          { type: 'slider', label: 'Reaction delay', path: 'legit.aim.reaction', unit: 'ms' },
          { type: 'select', label: 'Target selection', path: 'legit.aim.target' },
          { type: 'check', label: 'Visibility check', path: 'legit.aim.visCheck' },
          { type: 'check', label: 'Team check', path: 'legit.aim.teamCheck', hint: 'Ignore teammates' },
          { type: 'key', label: 'Aim key', path: 'legit.aim.key', hint: 'Hold to assist. Backspace = always on' },
          { type: 'check', label: 'Aim assist while firing', path: 'legit.aim.whileFiring', hint: 'If ticked (or ADS), only assist then' },
          { type: 'check', label: 'Aim assist while ADS', path: 'legit.aim.whileAds' },
        ],
      },
      {
        title: 'Trigger',
        icon: '⚡',
        items: [
          { type: 'toggle', label: 'Trigger assist', path: 'legit.trigger.enabled', hint: 'Fires when the crosshair is on an enemy' },
          { type: 'slider', label: 'Trigger delay', path: 'legit.trigger.delay', unit: 'ms' },
          { type: 'slider', label: 'Trigger FOV', path: 'legit.trigger.fov', unit: '°' },
          { type: 'key', label: 'Trigger key', path: 'legit.trigger.key' },
          { type: 'check', label: 'Visibility check', path: 'legit.trigger.visCheck' },
        ],
      },
      {
        title: 'Movement',
        icon: '➶',
        items: [
          { type: 'toggle', label: 'Bunny hop', path: 'legit.move.bhop', hint: 'Hold Space to re-jump on landing; adds no speed by itself' },
          { type: 'toggle', label: 'Auto strafe', path: 'legit.move.autoStrafe', hint: 'HvH only; optimizes WASD air steering without turning your view' },
          { type: 'toggle', label: 'Movement assistance', path: 'legit.move.assist', hint: 'Hops over low obstacles in your way' },
          { type: 'toggle', label: 'Jump assist', path: 'legit.move.jumpAssist', hint: 'A jump pressed just before landing still counts' },
        ],
      },
      {
        title: 'Wallhack',
        icon: '◫',
        items: [
          { type: 'toggle', label: 'Wallhack', path: 'legit.wall.enabled', hint: 'Only chickens show through walls, as a silhouette', keywords: 'chams xray wall hack see through' },
          { type: 'check', label: 'Enemies', path: 'legit.wall.enemies' },
          { type: 'check', label: 'Teammates', path: 'legit.wall.teammates', hint: 'Team modes only' },
          { type: 'color', label: 'Enemy color', path: 'legit.wall.enemyColor' },
          { type: 'color', label: 'Teammate color', path: 'legit.wall.teamColor' },
          { type: 'slider', label: 'Opacity', path: 'legit.wall.opacity' },
        ],
      },
    ],
  };

  const rage: Tab = {
    id: 'rage',
    label: 'Rage',
    icon: '☠',
    configKey: 'rage',
    sections: [
      {
        title: 'Rage aim',
        icon: '⌖',
        items: [
          { type: 'toggle', label: 'Rage aim', path: 'rage.aim.enabled', hint: 'Locks onto visible enemies (testing)' },
          { type: 'check', label: 'Target lock', path: 'rage.aim.lock', hint: 'Stay on one target while it is visible' },
          { type: 'check', label: 'Silent-style testing mode', path: 'rage.aim.silent', hint: 'Shots go to the target, camera stays put' },
          { type: 'check', label: 'Instant target switching', path: 'rage.aim.instantSwitch' },
          { type: 'select', label: 'Target priority', path: 'rage.aim.priority' },
          { type: 'select', label: 'Hitbox selection', path: 'rage.aim.hitbox' },
          { type: 'slider', label: 'Aim FOV', path: 'rage.aim.fov', unit: '°' },
          { type: 'check', label: 'Auto target (auto fire)', path: 'rage.aim.autoTarget', keywords: 'autofire automatic shoot' },
        ],
      },
      {
        title: 'Rage weapon testing',
        icon: '✦',
        items: [
          { type: 'toggle', label: 'No recoil', path: 'rage.weapon.noRecoil' },
          { type: 'toggle', label: 'No spread', path: 'rage.weapon.noSpread' },
          { type: 'toggle', label: 'Infinite ammo', path: 'rage.weapon.infiniteAmmo' },
          { type: 'toggle', label: 'Instant reload', path: 'rage.weapon.instantReload' },
          { type: 'toggle', label: 'Rapid fire', path: 'rage.weapon.rapidFire', hint: '×3 fire rate' },
          { type: 'toggle', label: 'No rocket cooldown', path: 'rage.weapon.noRocketCooldown', hint: 'Rocket launcher: no delay between shots, no reloading', keywords: 'rocket launcher spam cooldown reload' },
          { type: 'toggle', label: 'No rocket damage', path: 'rage.weapon.noRocketDamage', hint: 'Rockets (yours or anyone’s) can’t hurt you; the blast still pushes you, so rocket jump', keywords: 'rocket explosion self damage immune rocket jump' },
          { type: 'toggle', label: 'Unlimited flashbangs', path: 'rage.weapon.infiniteFlashes', hint: 'Flashbangs (Z) never run out', keywords: 'flash bang grenade infinite unlimited blind' },
          { type: 'slider', label: 'Damage multiplier', path: 'weapons.damage', unit: '×' },
          { type: 'slider', label: 'Projectile speed', path: 'weapons.projectileSpeed', unit: '×', hint: 'Rockets' },
          { type: 'toggle', label: 'Automatic fire', path: 'rage.weapon.automatic', hint: 'Hold to keep firing semi-auto guns' },
          { type: 'toggle', label: 'Infinite magazine', path: 'rage.weapon.infiniteMag', hint: '×10 magazine size' },
        ],
      },
      {
        title: 'Rage movement',
        icon: '➶',
        items: [
          { type: 'slider', label: 'Speed multiplier', path: 'rage.move.speed', unit: '×' },
          { type: 'slider', label: 'Jump multiplier', path: 'rage.move.jump', unit: '×' },
          { type: 'toggle', label: 'Fly', path: 'rage.move.fly', hint: 'Move where you look, Space rises' },
          { type: 'toggle', label: 'Noclip', path: 'rage.move.noclip', hint: 'Fly through walls' },
          { type: 'toggle', label: 'Infinite stamina', path: 'rage.move.infiniteStamina', hint: 'Endless jetpack fuel', keywords: 'jetpack fuel' },
          { type: 'toggle', label: 'Low gravity', path: 'rage.move.lowGravity' },
        ],
      },
      {
        title: 'Anti-aim',
        icon: '↻',
        items: [
          { type: 'toggle', label: 'Spin bot', path: 'rage.antiAim.spin', hint: 'Your chicken spins for everyone else; your view, aim and movement stay normal', keywords: 'spinbot anti aim antiaim' },
          { type: 'slider', label: 'Spin speed', path: 'rage.antiAim.speed', unit: '°/s' },
          { type: 'select', label: 'Direction', path: 'rage.antiAim.direction' },
          { type: 'select', label: 'Fake pitch', path: 'rage.antiAim.pitch', hint: 'Where others see your head pointing' },
        ],
      },
    ],
  };

  const color = (label: string, key: string): Section['items'][number] => ({ type: 'color', label, path: `visuals.colors.${key}` });
  const visuals: Tab = {
    id: 'visuals',
    label: 'Visuals',
    icon: '◈',
    configKey: 'visuals',
    sections: [
      {
        title: 'Player ESP',
        icon: '☐',
        items: [
          { type: 'toggle', label: 'Enable ESP', path: 'visuals.esp.enabled' },
          { type: 'check', label: 'Box ESP', path: 'visuals.esp.box' },
          { type: 'check', label: 'Name ESP', path: 'visuals.esp.name' },
          { type: 'check', label: 'Health bar', path: 'visuals.esp.health' },
          { type: 'check', label: 'Distance', path: 'visuals.esp.distance' },
          { type: 'check', label: 'Weapon', path: 'visuals.esp.weapon' },
          { type: 'check', label: 'Skeleton', path: 'visuals.esp.skeleton' },
          { type: 'check', label: 'Snaplines', path: 'visuals.esp.snaplines' },
          { type: 'check', label: 'Head circle', path: 'visuals.esp.headCircle' },
          { type: 'check', label: 'Player glow', path: 'visuals.esp.glow', hint: 'Seen through walls' },
        ],
      },
      {
        title: 'World',
        icon: '⬢',
        items: [
          { type: 'toggle', label: 'Item ESP', path: 'visuals.world.items', hint: 'Loot boxes and pickups' },
          { type: 'toggle', label: 'Weapon ESP', path: 'visuals.world.weapons', hint: 'Rockets, eggs and buggies' },
          { type: 'toggle', label: 'Spawn ESP', path: 'visuals.world.spawns' },
          { type: 'toggle', label: 'Objective ESP', path: 'visuals.world.objectives', hint: 'CTF flags and bases' },
          { type: 'toggle', label: 'Debug hitboxes', path: 'visuals.world.hitboxes', hint: 'Exactly what the server tests shots against' },
          { type: 'toggle', label: 'Collision boxes', path: 'visuals.world.collision' },
        ],
      },
      {
        title: 'Colors',
        icon: '◐',
        items: [
          color('Enemy', 'enemy'),
          color('Friendly', 'friendly'),
          color('NPC (bots)', 'npc'),
          color('Items', 'items'),
          color('Weapons', 'weapons'),
          color('Objectives', 'objectives'),
          { type: 'slider', label: 'Opacity', path: 'visuals.colors.opacity' },
        ],
      },
    ],
  };

  const surfaceNames: Record<Surface, string> = {
    grass: 'Grass',
    ground: 'Pavement / grid',
    road: 'Roads',
    crate: 'Crates',
    hay: 'Hay bales',
    stone: 'Stone walls',
    brick: 'Brick walls',
    wood: 'Wood',
    roof: 'Roofs',
    concrete: 'Concrete',
    metal: 'Metal',
    sandstone: 'Sandstone walls',
    fence: 'Fence',
    trees: 'Trees',
  };
  /** One-click looks; anything not listed goes back to default. */
  const looks: Record<string, Partial<WorldLook>> = {
    Default: {},
    Sunset: { zenith: '#2b3a78', horizon: '#ff9a5a', sunColor: '#ffb070', sunIntensity: 2, ambient: 0.8, clouds: 1.2, exposure: 1.1 },
    Night: { zenith: '#050a1a', horizon: '#1a2238', sunColor: '#8fa8ff', sunIntensity: 0.6, ambient: 0.45, clouds: 0.4, fog: 0.8, exposure: 1 },
    Overcast: { zenith: '#8a96a6', horizon: '#c3cad3', clouds: 2, sunIntensity: 1.2, fog: 0.6 },
    Neon: { grass: '#b06cff', brick: '#4dd2ff', stone: '#ff4dd2', crate: '#ffe14c', zenith: '#14002b', horizon: '#ff4dd2', sunColor: '#ff9cf0', exposure: 1.3 },
  };
  const applyLook = (name: string) => {
    dev.set('world', { ...defaultLook(), ...looks[name] });
    dev.menuRefresh();
    dev.notify(`World look: ${name}`, 'good');
  };
  const world: Tab = {
    id: 'world',
    label: 'World',
    icon: '⛰',
    configKey: 'world',
    sections: [
      {
        title: 'Surface colors',
        icon: '▧',
        items: [
          ...SURFACES.map((s): Section['items'][number] => ({ type: 'color', label: surfaceNames[s], path: `world.${s}`, keywords: 'texture tint colour' })),
          { type: 'toggle', label: 'Wireframe world', path: 'world.wireframe' },
        ],
      },
      {
        title: 'Sky & fog',
        icon: '☁',
        items: [
          { type: 'color', label: 'Sky (top)', path: 'world.zenith' },
          { type: 'color', label: 'Horizon & fog', path: 'world.horizon' },
          { type: 'slider', label: 'Clouds', path: 'world.clouds', unit: '×' },
          { type: 'slider', label: 'View distance (fog)', path: 'world.fog', unit: '×' },
        ],
      },
      {
        title: 'Light',
        icon: '☀',
        items: [
          { type: 'color', label: 'Sun color', path: 'world.sunColor' },
          { type: 'slider', label: 'Sun strength', path: 'world.sunIntensity' },
          { type: 'slider', label: 'Ambient light', path: 'world.ambient', unit: '×' },
          { type: 'slider', label: 'Exposure', path: 'world.exposure' },
          { type: 'buttons', label: 'Presets', items: Object.keys(looks).map((name) => ({ label: name, run: () => applyLook(name), tone: name === 'Default' ? undefined : ('primary' as const) })) },
        ],
      },
    ],
  };

  const players: Tab = {
    id: 'players',
    label: 'Players',
    icon: '☺',
    sections: [{ title: 'Player list', icon: '☰', wide: true, items: [{ type: 'custom', label: 'Player list', keywords: 'spectate teleport freeze respawn health armor give remove weapon', render: () => playersPanel(dev) }] }],
  };

  const weapons: Tab = {
    id: 'weapons',
    label: 'Weapons',
    icon: '✚',
    configKey: 'weapons',
    sections: [
      {
        title: 'Weapon',
        icon: '✦',
        items: [
          { type: 'select', label: 'Weapon selector', path: 'weapons.selected', options: weaponOptions },
          {
            type: 'buttons',
            label: 'Give / remove (you)',
            items: [
              { label: 'Give weapon', tone: 'primary', run: () => void dev.action({ kind: 'giveWeapon', target: selfPid(), weapon: selected() }, `Gave you the ${WEAPONS[selected()].name}`), disabled: notInMatch },
              { label: 'Remove weapon', run: () => void dev.action({ kind: 'removeWeapon', target: selfPid(), weapon: selected() }, `Removed the ${WEAPONS[selected()].name}`), disabled: notInMatch },
            ],
          },
          { type: 'toggle', label: 'Infinite ammo', path: 'rage.weapon.infiniteAmmo' },
          { type: 'toggle', label: 'No reload', path: 'rage.weapon.instantReload', keywords: 'instant reload' },
          { type: 'slider', label: 'Fire rate', path: 'weapons.fireRate', unit: '×' },
          { type: 'slider', label: 'Damage', path: 'weapons.damage', unit: '×' },
          { type: 'slider', label: 'Recoil', path: 'weapons.recoil', unit: '×' },
          { type: 'slider', label: 'Spread', path: 'weapons.spread', unit: '×' },
          { type: 'slider', label: 'Projectile speed', path: 'weapons.projectileSpeed', unit: '×' },
          { type: 'slider', label: 'Magazine size', path: 'weapons.magazine', unit: '×' },
        ],
      },
      {
        title: 'Testing',
        icon: '⚗',
        items: [
          {
            type: 'buttons',
            label: 'Actions',
            items: [
              {
                label: 'Spawn weapon',
                tone: 'primary',
                run: () => void dev.action({ kind: 'giveWeapon', target: selfPid(), weapon: selected() }, `${WEAPONS[selected()].name} in hand`),
                disabled: notInMatch,
              },
              {
                label: 'Test damage (hit me)',
                run: () => {
                  const w = WEAPONS[selected()];
                  const amount = Math.max(1, Math.round(damageAt(w, 10) * w.pellets * dev.config.weapons.damage));
                  void dev.action({ kind: 'health', target: selfPid(), amount: -amount }, `${w.name} hit you for ${amount} at 10 m`);
                },
                disabled: notInMatch,
              },
              {
                label: 'Reset weapon',
                run: () => {
                  for (const key of ['fireRate', 'damage', 'recoil', 'spread', 'projectileSpeed', 'magazine'] as const) dev.set(`weapons.${key}`, 1);
                  dev.menuRefresh();
                  if (selfPid()) void dev.action({ kind: 'refill', target: selfPid() }, 'Weapon reset and refilled');
                },
              },
            ],
          },
          {
            type: 'info',
            label: 'Test damage',
            hint: 'Per trigger pull, body (head)',
            value: () => {
              const w = WEAPONS[selected()];
              if (w.projectile) return 'Explosive (splash)';
              const k = dev.config.weapons.damage * w.pellets;
              return [10, 30, 60].map((d) => `${d}m ${Math.round(damageAt(w, d) * k)} (${Math.round(damageAt(w, d) * k * w.headshotMultiplier)})`).join(' · ');
            },
          },
          {
            type: 'info',
            label: 'Test recoil',
            hint: 'Camera kick per shot',
            value: () => {
              const c = dev.config;
              return deg(WEAPONS[selected()].recoil * (c.rage.weapon.noRecoil ? 0 : c.weapons.recoil));
            },
          },
          {
            type: 'info',
            label: 'Test spread',
            hint: 'Still · moving · air · aiming',
            value: () => {
              const c = dev.config;
              const w = WEAPONS[selected()];
              const k = c.rage.weapon.noSpread ? 0 : c.weapons.spread;
              return [spreadFor(w, 0, false, false), spreadFor(w, PLAYER.speed, false, false), spreadFor(w, 0, true, false), spreadFor(w, 0, false, true)].map((s) => deg(s * k)).join(' · ');
            },
          },
          {
            type: 'info',
            label: 'Fire rate · magazine',
            value: () => {
              const c = dev.config;
              const w = WEAPONS[selected()];
              const rate = Math.min(10, c.weapons.fireRate * (c.rage.weapon.rapidFire ? 3 : 1));
              const mag = Math.max(1, Math.round(w.magazine * (c.rage.weapon.infiniteMag ? 10 : c.weapons.magazine)));
              if (w.projectile === 'rocket' && c.rage.weapon.noRocketCooldown) return `${Math.round(60000 / ROCKET_SPAM_INTERVAL_MS)} rpm · no reload`;
              return `${Math.round((60000 / w.fireInterval) * rate)} rpm · ${mag} rounds`;
            },
          },
        ],
      },
    ],
  };

  const misc: Tab = {
    id: 'misc',
    label: 'Misc',
    icon: '⚙',
    configKey: 'misc',
    sections: [
      {
        title: 'View',
        icon: '◉',
        items: [
          { type: 'toggle', label: 'Third person', bind: { get: () => getCameraMode() === 'third', set: (v) => setCameraMode(v ? 'third' : 'first') }, keywords: 'camera first person' },
          { type: 'slider', label: 'FOV slider', min: 60, max: 100, step: 1, unit: '°', bind: { get: () => getSettings().fov, set: (v) => updateSettings({ fov: v }) } },
          { type: 'toggle', label: 'Crosshair', path: 'misc.crosshair' },
          { type: 'buttons', label: 'Custom crosshair', items: [{ label: 'Open crosshair editor', run: () => dev.openCrosshairSettings() }] },
          { type: 'toggle', label: 'Hitmarker', path: 'misc.hitmarker' },
          { type: 'toggle', label: 'Damage indicator', path: 'misc.damageIndicator' },
          { type: 'toggle', label: 'Free camera', path: 'misc.freeCam', hint: 'WASD + mouse, Space up; your chicken waits' },
          { type: 'toggle', label: 'Spectator mode', path: 'misc.spectator', hint: 'Follow players; click for the next one' },
        ],
      },
      {
        title: 'Readouts',
        icon: '▤',
        items: [
          { type: 'toggle', label: 'FPS counter', path: 'misc.fpsCounter' },
          { type: 'toggle', label: 'Ping', path: 'misc.ping' },
          { type: 'toggle', label: 'Coordinates', path: 'misc.coords' },
          { type: 'toggle', label: 'Velocity', path: 'misc.velocity' },
          { type: 'toggle', label: 'Speed display', path: 'misc.speed' },
          { type: 'toggle', label: 'Map information', path: 'misc.mapInfo' },
        ],
      },
      {
        title: 'Movement',
        icon: '➶',
        items: [
          { type: 'toggle', label: 'Bunny hop', path: 'legit.move.bhop' },
          { type: 'toggle', label: 'Auto jump', path: 'misc.autoJump', hint: 'Jump whenever you touch the ground' },
          { type: 'info', label: 'Takeoff limit', value: () => `110% of weapon movement speed · base ${PLAYER.speed} m/s` },
        ],
      },
    ],
  };

  const configs: Tab = {
    id: 'configs',
    label: 'Configs',
    icon: '▣',
    sections: [{ title: 'Configurations', icon: '▣', wide: true, items: [{ type: 'custom', label: 'Configs', keywords: 'save load delete rename new export import', render: () => configsPanel(dev) }] }],
  };

  const settings: Tab = {
    id: 'settings',
    label: 'Settings',
    icon: '☰',
    configKey: 'settings',
    sections: [
      {
        title: 'Menu',
        icon: '▦',
        items: [
          { type: 'key', label: 'Menu key', path: 'settings.menuKey', hint: 'Default: Insert' },
          { type: 'slider', label: 'Menu scale', path: 'settings.scale', unit: '×' },
          { type: 'slider', label: 'Menu opacity', path: 'settings.opacity' },
          { type: 'slider', label: 'Animation speed', path: 'settings.animSpeed', unit: '×', hint: '0 turns animations off' },
        ],
      },
      {
        title: 'Look & feedback',
        icon: '◐',
        items: [
          {
            type: 'select',
            label: 'Theme',
            path: 'settings.theme',
            options: [
              { value: 'claude', label: 'mega?dev (light)' },
              { value: 'midnight', label: 'Midnight' },
              { value: 'carbon', label: 'Carbon' },
              { value: 'crimson', label: 'Crimson' },
              { value: 'ocean', label: 'Ocean' },
            ],
          },
          { type: 'color', label: 'Accent color', path: 'settings.accent' },
          { type: 'toggle', label: 'Sound effects', path: 'settings.sounds' },
          { type: 'toggle', label: 'Notifications', path: 'settings.notifications' },
          {
            type: 'buttons',
            label: 'Reset everything',
            hint: 'All tabs back to defaults (saved configs are kept)',
            items: [
              {
                label: 'Reset everything',
                tone: 'danger',
                run: () => {
                  if (!window.confirm('Reset every developer setting to its default?')) return;
                  dev.resetAll();
                  dev.menuRefresh();
                  dev.notify('Everything reset', 'good');
                },
              },
            ],
          },
        ],
      },
    ],
  };

  return [legit, rage, visuals, world, players, weapons, misc, configs, settings];
}
