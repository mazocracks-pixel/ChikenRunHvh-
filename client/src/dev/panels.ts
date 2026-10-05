import { defaultHvhLoadout, sanitizeHvhLoadout, type HvhLoadout, type HvhPanelId } from '@game/shared';
import type { RemotePlayer } from '../game/RemotePlayers';
import type { DevConfig } from './config';
import { skeetFakeLagCore } from './skeet/model';

/** Register future panels here; each owns its resolver and server anti-aim configuration. */
export interface HvhPanel {
  id: HvhPanelId;
  name: string;
  description: string;
  assisted: boolean;
  resolveYaw(player: RemotePlayer, config: DevConfig): number;
  loadout(config: DevConfig): HvhLoadout;
}

export const HVH_PANELS: Readonly<Record<HvhPanelId, HvhPanel>> = {
  lab: {
    id: 'lab', name: 'HvH Lab', assisted: true,
    description: 'Hypothesis resolving, historical shots, real desync and charged command shifts.',
    resolveYaw: (p, c) => c.hvh.feedback.resolver ? p.yaw : p.latest?.fakeYaw ?? p.yaw,
    loadout: c => sanitizeHvhLoadout(c.hvh),
  },
  skeet: {
    id: 'skeet', name: 'Skeet', assisted: true,
    description: 'Weapon profiles, adaptive stance analysis, safe points and movement-state anti-aim.',
    resolveYaw: p => p.yaw,
    loadout: c => sanitizeHvhLoadout({ ...c.hvh, core: skeetFakeLagCore(c), skeet: c.skeet.antiAim }),
  },
  manual: {
    id: 'manual', name: 'Manual play', assisted: false,
    description: 'Aim and fire yourself. Shared HvH wall vision stays available; panel assists are off.',
    resolveYaw: p => p.yaw,
    loadout: () => defaultHvhLoadout(),
  },
};
