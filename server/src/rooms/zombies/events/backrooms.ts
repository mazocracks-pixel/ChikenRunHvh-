import { CRYSTAL_HUNT } from '@game/shared';
import type { HuntEvent } from '../CrystalHunt';

/**
 * Wave 7 (CRYSTAL_HUNT.events.backrooms.wave): the Backrooms. Endless damp yellow rooms under
 * buzzing fluorescent panels; the monkeys wait in the dead ends and jump out when you come round
 * the corner. It replaces the wave: once out, the shop opens and the next wave comes.
 */
export const BACKROOMS_EVENT: HuntEvent = {
  def: CRYSTAL_HUNT.events.backrooms,
};
