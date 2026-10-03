/**
 * How the level looks: colour tints for every surface, sky, fog and light. Purely visual and
 * local (the developer menu's World tab edits it); white tints mean "unchanged".
 */
export interface WorldLook {
  grass: string;
  /** Town pavement and the Sandbox grid. */
  ground: string;
  road: string;
  crate: string;
  hay: string;
  stone: string;
  brick: string;
  wood: string;
  roof: string;
  concrete: string;
  metal: string;
  fence: string;
  trees: string;
  zenith: string;
  horizon: string;
  /** 0 = clear sky, 1 = normal, up to 2 = overcast. */
  clouds: number;
  /** Multiplier on how far you can see before the fog. */
  fog: number;
  sunColor: string;
  sunIntensity: number;
  /** Multiplier on ambient (sky) light. */
  ambient: number;
  exposure: number;
  wireframe: boolean;
}

export const SURFACES = ['grass', 'ground', 'road', 'crate', 'hay', 'stone', 'brick', 'wood', 'roof', 'concrete', 'metal', 'fence', 'trees'] as const;
export type Surface = (typeof SURFACES)[number];

export function defaultLook(): WorldLook {
  return {
    grass: '#ffffff',
    ground: '#ffffff',
    road: '#ffffff',
    crate: '#ffffff',
    hay: '#ffffff',
    stone: '#ffffff',
    brick: '#ffffff',
    wood: '#ffffff',
    roof: '#ffffff',
    concrete: '#ffffff',
    metal: '#ffffff',
    fence: '#ffffff',
    trees: '#ffffff',
    zenith: '#3f8fdc',
    horizon: '#cfe6f2',
    clouds: 1,
    fog: 1,
    sunColor: '#fff0d8',
    sunIntensity: 2.6,
    ambient: 1,
    exposure: 1.15,
    wireframe: false,
  };
}
