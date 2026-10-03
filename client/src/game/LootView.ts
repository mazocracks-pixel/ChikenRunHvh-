import * as THREE from 'three';
import { BONUS, LOOT, PICKUP_INFO, rayAabb, type DropState, type LootState, type MapDef, type PickupKind, type Ray } from '@game/shared';
import type { Effects } from './Effects';
import { buildMysteryBox, buildPickup } from './models/Pickups';

interface Spot {
  group: THREE.Group;
  box: THREE.Mesh;
  pickup: THREE.Group | null;
  pickupKind: PickupKind | null;
  state: LootState;
  x: number;
  y: number;
  z: number;
}

const RING = new THREE.RingGeometry(0.32, 0.5, 24);

/** Floating mystery boxes and the items they drop. The server decides; this just shows it. */
export class LootView {
  private readonly root = new THREE.Group();
  private readonly spots: Spot[];
  private readonly effects: Effects;
  private time = 0;
  /** Kill bonuses: a spinning item with a coloured glow ring on the ground. */
  private readonly drops = new Map<number, { state: DropState; group: THREE.Group; item: THREE.Group; ring: THREE.Mesh; born: number }>();
  /** Called when a box breaks (for the sound). */
  onBreak: ((at: THREE.Vector3) => void) | null = null;

  constructor(scene: THREE.Scene, map: MapDef, effects: Effects) {
    this.effects = effects;
    this.spots = map.loot.map((spot, id) => {
      const group = new THREE.Group();
      const y = (spot.y ?? 0) + LOOT.hover;
      group.position.set(spot.x, y, spot.z);
      const box = buildMysteryBox();
      group.add(box);
      this.root.add(group);
      return { group, box, pickup: null, pickupKind: null, state: { id, phase: 0, pickup: null }, x: spot.x, y, z: spot.z };
    });
    scene.add(this.root);
  }

  /** Where every loot spot and bonus is and what it holds (developer ESP). */
  markers(): { x: number; y: number; z: number; phase: LootState['phase']; pickup: PickupKind | null }[] {
    const drops = [...this.drops.values()].map(({ state: d }) => ({ x: d.x, y: d.y + BONUS.hover, z: d.z, phase: 1 as const, pickup: d.kind }));
    return [...this.spots.map((s) => ({ x: s.x, y: s.y, z: s.z, phase: s.state.phase, pickup: s.state.pickup })), ...drops];
  }

  /** A kill bonus appeared. */
  addDrop(d: DropState, animate = true): void {
    if (this.drops.has(d.id)) return;
    const group = new THREE.Group();
    group.position.set(d.x, d.y, d.z);
    const item = buildPickup(d.kind);
    item.scale.setScalar(0.8);
    const ring = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: PICKUP_INFO[d.kind].color, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(item, ring);
    this.root.add(group);
    this.drops.set(d.id, { state: d, group, item, ring, born: this.time - (animate ? 0 : 1) });
    if (animate) this.effects.boxBurst({ x: d.x, y: d.y + 0.6, z: d.z });
  }

  removeDrop(id: number): void {
    const d = this.drops.get(id);
    if (!d) return;
    d.group.removeFromParent();
    (d.ring.material as THREE.Material).dispose();
    this.drops.delete(id);
  }

  setAll(states: LootState[]): void {
    for (const s of states) this.set(s, false);
  }

  set(state: LootState, animate = true): void {
    const spot = this.spots[state.id];
    if (!spot) return;
    const was = spot.state.phase;
    spot.state = state;
    spot.box.visible = state.phase === 0;
    if (state.phase === 1 && state.pickup) {
      if (spot.pickupKind !== state.pickup) {
        spot.pickup?.removeFromParent();
        spot.pickup = buildPickup(state.pickup);
        spot.pickupKind = state.pickup;
        spot.group.add(spot.pickup);
      }
      spot.pickup!.visible = true;
    } else if (spot.pickup) {
      spot.pickup.visible = false;
    }
    if (animate && was === 0 && state.phase !== 0) {
      this.effects.boxBurst(spot.group.position);
      this.onBreak?.(spot.group.position);
    }
  }

  /** Intact boxes along a ray (so your crosshair can target them). */
  raycast(ray: Ray, maxT: number): number {
    let best = -1;
    const half = LOOT.boxSize / 2;
    for (const s of this.spots) {
      if (s.state.phase !== 0) continue;
      const t = rayAabb(ray, { minX: s.x - half, maxX: s.x + half, minY: s.y - half, maxY: s.y + half, minZ: s.z - half, maxZ: s.z + half }, best >= 0 ? best : maxT);
      if (t >= 0) best = t;
    }
    return best;
  }

  update(dt: number): void {
    this.time += dt;
    for (const [id, d] of this.drops) {
      // Pops up out of the ground, then bobs and spins.
      const age = this.time - d.born;
      const pop = Math.min(1, age / 0.35);
      d.item.position.y = BONUS.hover * (1 - (1 - pop) ** 3) + Math.sin(this.time * 3 + id) * 0.06;
      d.item.rotation.y = this.time * 2.2 + id;
      d.ring.scale.setScalar(0.8 + Math.sin(this.time * 4 + id) * 0.12);
    }
    for (const [i, s] of this.spots.entries()) {
      const bob = Math.sin(this.time * 2 + i) * 0.08;
      s.box.rotation.y = this.time * 0.8 + i;
      s.box.position.y = bob;
      if (s.pickup) {
        s.pickup.rotation.y = this.time * 1.6;
        s.pickup.position.y = bob - 0.35;
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
