import { defaultHvhLoadout, sanitizeHvhLoadout, type HvhLoadout, type HvhPanelId } from '@game/shared';
import type { DevConfig } from './config';
import { skeetFakeLagCore } from './skeet/model';

/** HvH panel policies and server loadouts. */
export interface HvhPanel {
  id: HvhPanelId;
  name: string;
  description: string;
  assisted: boolean;
  loadout(config: DevConfig): HvhLoadout;
}

export const HVH_PANELS: Readonly<Record<HvhPanelId, HvhPanel>> = {
  skeet: {
    id: 'skeet', name: 'Skeet', assisted: true,
    description: 'Weapon profiles, adaptive stance analysis, safe points and movement-state anti-aim.',
    loadout: c => sanitizeHvhLoadout({ ...c.hvh, core: skeetFakeLagCore(c), skeet: c.skeet.antiAim }),
  },
  manual: {
    id: 'manual', name: 'Manual play', assisted: false,
    description: 'Aim and fire yourself. Shared HvH wall vision stays available; panel assists are off.',
    loadout: () => defaultHvhLoadout(),
  },
};
