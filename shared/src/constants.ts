/** Fixed simulation rate. Client prediction and server authority both step at exactly this rate. */
export const SIM_RATE = 60;
export const SIM_DT = 1 / SIM_RATE;

/** How often the server broadcasts world snapshots to clients. */
export const SNAPSHOT_RATE = 20;

/**
 * Remote players are rendered this far in the past, so there are (almost) always two
 * snapshots to interpolate between. Should comfortably exceed 1000 / SNAPSHOT_RATE.
 */
export const INTERP_DELAY_MS = 100;

/** The furthest back the server will rewind targets for lag-compensated hit detection. */
export const MAX_REWIND_MS = 300;

export const PLAYER = {
  /** Horizontal collision radius (the player is an axis-aligned box of 2r × height × 2r). */
  radius: 0.45,
  height: 1.5,
  /** Shots and throws start here, measured up from the feet. */
  eyeHeight: 1.3,
  /** Metres per second. */
  speed: 6,
  jumpVelocity: 8,
  gravity: 24,
  /** Holding jump while falling flaps the wings and caps the fall speed. */
  glideFallSpeed: 2.5,
  maxHealth: 100,
  maxArmor: 100,
  /** Fraction of incoming damage that armor soaks up while it lasts. */
  armorAbsorb: 0.5,
  spawnProtectionMs: 1500,
  startEggs: 2,
  maxEggs: 5,
  startSmokes: 1,
  maxSmokes: 2,
} as const;

/** Bunny hopping: chain jumps right as you land to build speed. */
export const HOP = {
  /** Jumping within this many ticks of landing keeps the chain going (holding jump does it on tick 0). */
  windowTicks: 6,
  /** Extra speed per chained hop, as a fraction of walking speed. */
  gain: 0.08,
  /** Cap: at most +60% speed... */
  max: 0.6,
  /** ...or +80% with a melee weapon out. */
  meleeMax: 0.8,
  /** How fast the bonus fades once you stop hopping (fraction per second). */
  decay: 4,
} as const;

/** Crouching (Ctrl / C): slower, and the chicken (model, hitbox, eyes) shrinks. */
export const CROUCH = {
  /** Size of a crouching chicken relative to standing. */
  scale: 0.7,
  /** Walking speed multiplier while crouched. */
  speed: 0.45,
} as const;

export const JETPACK = {
  /** Seconds of thrust from a full tank. */
  maxFuel: 3,
  /** Net upward acceleration while thrusting (m/s²). */
  thrust: 18,
  maxRiseSpeed: 6.5,
} as const;

export const MAX_PLAYERS_PER_ROOM = 16;
export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 120;
export const DEFAULT_PORT = 3000;
