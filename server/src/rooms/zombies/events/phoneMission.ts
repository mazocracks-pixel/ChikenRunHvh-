import { CRYSTAL_HUNT } from '@game/shared';
import type { HuntEvent } from '../CrystalHunt';

/**
 * Wave 10 (CRYSTAL_HUNT.events.phoneMission.wave): the Phone Mission, in an abandoned facility
 * lit by red emergency lights. Harder than the Backrooms: more crystals, more and smarter monsters
 * (half of them come looking for you), less time, and half way through the power cuts out (an
 * extra scare). It comes before the boss wave: once out, the shop opens, then the boss.
 */
export const PHONE_MISSION_EVENT: HuntEvent = {
  def: CRYSTAL_HUNT.events.phoneMission,
  onUpdate(hunt, now) {
    const at = hunt.def.extraScareAt;
    if (at === null || hunt.blackoutUntil > 0) return;
    if (now - hunt.startedAt >= hunt.def.timeMs * at) hunt.blackout(now);
  },
};
