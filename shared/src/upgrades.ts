import type { MoveMods } from './dev';
import { DEFAULT_MODS } from './dev';
import type { ModeDef } from './modes';

/**
 * Chicken upgrades: bought with coins in the main-menu shop, 5 levels each. They are saved on
 * the server as inventory items (`upgrade:<id>:<level>`; a level needs the one before it), and
 * they only count in PvE modes (Zombie Apocalypse, Training). In every PvP mode everyone has the
 * same stats.
 */

export type UpgradeId = 'health' | 'speed' | 'jump' | 'glide' | 'egg' | 'armor' | 'reload';

export const UPGRADE_MAX_LEVEL = 5;
/** Coins for levels 1 to 5 (the same for every upgrade). */
export const UPGRADE_PRICES: readonly number[] = [150, 300, 600, 1000, 1600];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** What it does, in a few words. */
  text: string;
  /** What `level` levels give, for the shop ("+20 max health"). */
  effect: (level: number) => string;
}

/** How much each level adds (every number of the upgrades lives here). */
export const UPGRADE_STEP = {
  health: 0.1, // +10% max health
  speed: 0.03, // +3% running speed
  jump: 0.05, // +5% jump height
  hop: 0.04, // +4% bunny-hop speed cap (with Jump)
  glide: 0.12, // +12% glide and jetpack time
  egg: 0.1, // +10% egg blast radius and damage
  armor: 0.04, // -4% damage taken
  reload: 0.06, // -6% reload time
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'health', name: 'Health', text: 'More max health', effect: (l) => `+${pct(UPGRADE_STEP.health * l)} max health (${100 + Math.round(UPGRADE_STEP.health * l * 100)} HP)` },
  { id: 'speed', name: 'Speed', text: 'Run faster', effect: (l) => `+${pct(UPGRADE_STEP.speed * l)} running speed` },
  { id: 'jump', name: 'Jump', text: 'Higher jumps, faster bunny hops', effect: (l) => `+${pct(UPGRADE_STEP.jump * l)} jump, +${pct(UPGRADE_STEP.hop * l)} hop speed` },
  { id: 'glide', name: 'Glide', text: 'Longer glide and jetpack', effect: (l) => `+${pct(UPGRADE_STEP.glide * l)} glide and jetpack time` },
  { id: 'egg', name: 'Egg Power', text: 'Bigger egg blasts', effect: (l) => `+${pct(UPGRADE_STEP.egg * l)} egg blast size and damage` },
  { id: 'armor', name: 'Armor', text: 'Take less damage', effect: (l) => `-${pct(UPGRADE_STEP.armor * l)} damage taken` },
  { id: 'reload', name: 'Reload', text: 'Reload faster', effect: (l) => `-${pct(UPGRADE_STEP.reload * l)} reload time` },
];

export const UPGRADE_IDS: readonly UpgradeId[] = UPGRADES.map((u) => u.id);

export type UpgradeLevels = Record<UpgradeId, number>;

export function noUpgrades(): UpgradeLevels {
  return Object.fromEntries(UPGRADE_IDS.map((id) => [id, 0])) as UpgradeLevels;
}

/** The inventory item for one level of an upgrade. */
export function upgradeItemId(id: UpgradeId, level: number): string {
  return `upgrade:${id}:${level}`;
}

/** Levels from owned items: each upgrade's level is how many levels in a row (from 1) are owned. */
export function upgradeLevels(owned: Iterable<string>): UpgradeLevels {
  const set = owned instanceof Set ? (owned as Set<string>) : new Set(owned);
  const out = noUpgrades();
  for (const id of UPGRADE_IDS) {
    while (out[id] < UPGRADE_MAX_LEVEL && set.has(upgradeItemId(id, out[id] + 1))) out[id]++;
  }
  return out;
}

/** Upgrades only count in PvE modes (fighting zombies or targets, never other players). */
export function modeUsesUpgrades(mode: ModeDef): boolean {
  return mode.pve === true;
}

/** What a set of levels does in a match (all multipliers; 1 = no change). */
export interface UpgradeEffects {
  /** Max health, as a multiple of normal (the health bar stays 0–100: a share of this). */
  maxHealth: number;
  speed: number;
  jump: number;
  /** Added to the bunny-hop speed cap. */
  hop: number;
  glide: number;
  egg: number;
  /** Damage taken (armor and max health together). */
  damageTaken: number;
  reload: number;
}

export function upgradeEffects(levels: Readonly<UpgradeLevels>): UpgradeEffects {
  const l = (id: UpgradeId) => Math.max(0, Math.min(UPGRADE_MAX_LEVEL, Math.floor(levels[id] ?? 0)));
  const maxHealth = 1 + UPGRADE_STEP.health * l('health');
  return {
    maxHealth,
    speed: 1 + UPGRADE_STEP.speed * l('speed'),
    jump: 1 + UPGRADE_STEP.jump * l('jump'),
    hop: UPGRADE_STEP.hop * l('jump'),
    glide: 1 + UPGRADE_STEP.glide * l('glide'),
    egg: 1 + UPGRADE_STEP.egg * l('egg'),
    damageTaken: (1 - UPGRADE_STEP.armor * l('armor')) / maxHealth,
    reload: 1 - UPGRADE_STEP.reload * l('reload'),
  };
}

/** Movement modifiers with the upgrades on top (both sides use this, so prediction matches). */
export function withUpgrades(mods: MoveMods | null, up: UpgradeEffects | null): MoveMods | null {
  if (!up) return mods;
  const base: MoveMods = mods ?? DEFAULT_MODS;
  return { ...base, speed: base.speed * up.speed, jump: base.jump * up.jump, glide: (base.glide ?? 1) * up.glide, hop: (base.hop ?? 0) + up.hop };
}
