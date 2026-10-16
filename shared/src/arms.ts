import type { WeaponId } from './weapons';

/**
 * Arms Race: every kill moves you to the next weapon on this ladder. A kill with the last one
 * (the Golden Knife) wins the match. Index = level.
 */
export const ARMS_LADDER: readonly WeaponId[] = [
  // Every CS2-style gun is on it, rifles down to pistols, with our specials mixed in.
  'ak47',
  'm4a1',
  'rifle',
  'burst',
  'battle',
  'golden',
  'lmg',
  'minigun',
  'smg',
  'mpistol',
  'autoshotgun',
  'shotgun',
  'sniper',
  'scout',
  'crossbow',
  'launcher',
  'deagle',
  'revolver',
  'fiveseven',
  'dualies',
  'silenced',
  'pistol',
  'goldknife',
];

export const ARMS_FINAL_LEVEL = ARMS_LADDER.length - 1;

/** The weapons for a level: the ladder gun plus a knife, and just the Golden Knife at the end. */
export function armsLoadout(level: number): WeaponId[] {
  const weapon = ARMS_LADDER[Math.max(0, Math.min(ARMS_FINAL_LEVEL, level))]!;
  return level >= ARMS_FINAL_LEVEL ? [weapon] : [weapon, 'knife'];
}
