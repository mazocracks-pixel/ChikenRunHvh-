import type { HuntEventId } from '@game/shared';
import type { HuntEvent } from '../CrystalHunt';
import { BACKROOMS_EVENT } from './backrooms';
import { PHONE_MISSION_EVENT } from './phoneMission';

/** Every story event, by id. */
export const HUNT_EVENTS: Record<HuntEventId, HuntEvent> = {
  backrooms: BACKROOMS_EVENT,
  phoneMission: PHONE_MISSION_EVENT,
};
