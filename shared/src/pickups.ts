export type PickupKind = 'medkit' | 'armor' | 'fuel' | 'eggs';

/** Zombie Apocalypse power-ups: dropped by zombies now and then, they help the whole team. */
export type PowerUpKind = 'nuke' | 'maxAmmo' | 'instaKill' | 'firstAid';
/** Anything that can lie on the ground to be picked up. */
export type DropKind = PickupKind | PowerUpKind;

export const POWER_UP_INFO: Record<PowerUpKind, { name: string; color: number; text: string }> = {
  nuke: { name: 'Nuke', color: 0xffa726, text: 'Every zombie on the map is dead' },
  maxAmmo: { name: 'Max Ammo', color: 0x66bb6a, text: 'Everyone has full ammo and eggs' },
  instaKill: { name: 'Insta-Kill', color: 0xef5350, text: 'Every hit kills, for a few seconds' },
  firstAid: { name: 'First Aid', color: 0x42a5f5, text: 'Everyone back to full health' },
};

export function isPowerUp(kind: DropKind): kind is PowerUpKind {
  return kind in POWER_UP_INFO;
}

/** Name and colour of anything on the ground. */
export function dropInfo(kind: DropKind): { name: string; color: number } {
  return isPowerUp(kind) ? POWER_UP_INFO[kind] : PICKUP_INFO[kind];
}

export const PICKUP_INFO: Record<PickupKind, { name: string; color: number }> = {
  medkit: { name: 'Medkit', color: 0xe53935 },
  armor: { name: 'Armor', color: 0x42a5f5 },
  fuel: { name: 'Jetpack fuel', color: 0xffb300 },
  eggs: { name: 'Explosive eggs', color: 0xfff3d6 },
};

export const PICKUP_AMOUNT = {
  medkit: 50,
  armor: 50,
  eggs: 2,
} as const;

export const LOOT = {
  /** Edge length of the floating mystery box. */
  boxSize: 0.8,
  /** How high the box floats above its surface. */
  hover: 0.9,
  /** Time until a broken box comes back. */
  respawnMs: 20000,
  /** A dropped pickup disappears after this long if nobody takes it. */
  pickupLifetimeMs: 30000,
  /** Horizontal / vertical distance from the player's feet to collect. */
  collectRadius: 1.2,
  collectHeight: 1.6,
} as const;

/** Every kill drops a random pickup where the victim fell. */
export const BONUS = {
  /** A bonus nobody takes disappears after this long. */
  lifetimeMs: 20000,
  /** Oldest bonuses vanish beyond this many lying around. */
  max: 24,
  /** Height the item floats above the ground. */
  hover: 0.45,
} as const;

/** 0 = box waiting to be shot, 1 = pickup lying there, 2 = empty (respawning). */
export type LootPhase = 0 | 1 | 2;
