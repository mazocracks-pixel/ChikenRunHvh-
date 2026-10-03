import * as THREE from 'three';
import { TEAM_COLORS, type FlagState, type MapDef } from '@game/shared';
import { box, cylinder, part, solid } from './models/materials';

interface FlagView {
  team: 1 | 2;
  root: THREE.Group;
  cloth: THREE.Mesh;
  state: FlagState;
}

/** Capture the Flag: the two flags (carried on a chicken's back when taken) and the base pads. */
export class Flags {
  private readonly root = new THREE.Group();
  private readonly views: FlagView[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, map: MapDef, states: FlagState[]) {
    for (const spot of map.flags) {
      const color = TEAM_COLORS[spot.team];
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.06, 28), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45 }));
      pad.position.set(spot.x, 0.03, spot.z);
      pad.receiveShadow = true;
      this.root.add(pad);

      const flag = new THREE.Group();
      flag.add(part(cylinder(0.04, 0.04, 2.2, 6), solid(0xeeeeee, { metal: true }), 0, 1.1, 0));
      const cloth = part(box(0.9, 0.55, 0.03), solid(color), 0.47, 1.9, 0);
      flag.add(cloth);
      this.root.add(flag);
      const state = states.find((s) => s.team === spot.team) ?? { team: spot.team, x: spot.x, y: 0, z: spot.z, carrier: 0, atBase: true };
      this.views.push({ team: spot.team, root: flag, cloth, state });
    }
    scene.add(this.root);
  }

  set(states: FlagState[]): void {
    for (const s of states) {
      const v = this.views.find((x) => x.team === s.team);
      if (v) v.state = s;
    }
  }

  /** Flags as drawn this frame (developer ESP). */
  markers(): { team: 1 | 2; position: THREE.Vector3; atBase: boolean; carrier: number }[] {
    return this.views.map((v) => ({ team: v.team, position: v.root.getWorldPosition(new THREE.Vector3()), atBase: v.state.atBase, carrier: v.state.carrier }));
  }

  carrierOf(team: 1 | 2): number {
    return this.views.find((v) => v.team === team)?.state.carrier ?? 0;
  }

  /** `positionOf(pid)` gives where a carrier is drawn this frame. */
  update(dt: number, positionOf: (pid: number) => { position: THREE.Vector3; yaw: number } | null): void {
    this.time += dt;
    for (const v of this.views) {
      const s = v.state;
      const carried = s.carrier ? positionOf(s.carrier) : null;
      if (carried) {
        // Strapped to the back of the carrier, a bit smaller.
        const back = 0.45;
        v.root.position.set(carried.position.x + Math.sin(carried.yaw) * back, carried.position.y + 0.3, carried.position.z + Math.cos(carried.yaw) * back);
        v.root.rotation.y = carried.yaw;
        v.root.scale.setScalar(0.7);
      } else {
        v.root.position.set(s.x, s.y, s.z);
        v.root.rotation.y = this.time * 0.6;
        v.root.scale.setScalar(1);
      }
      v.cloth.rotation.y = Math.sin(this.time * 4 + v.team) * 0.25;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
