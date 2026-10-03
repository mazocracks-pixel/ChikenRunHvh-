import { crate, type MapDef } from './types';

/** An almost empty field for Sandbox mode: players build the level themselves. */
export const FLAT: MapDef = {
  id: 'flat',
  name: 'Flat World',
  halfSize: 40,
  ground: 'flat',
  boxes: [crate(0, 0), crate(1.2, 0), crate(0.6, 0, 1.2, 1.2)],
  spawns: Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { x: Math.round(Math.cos(a) * 12 * 10) / 10, z: Math.round(Math.sin(a) * 12 * 10) / 10 };
  }),
  loot: [],
  vehicles: [
    { x: 6, z: 18, yaw: 0 },
    { x: -6, z: 18, yaw: 0 },
  ],
  flags: [],
};
