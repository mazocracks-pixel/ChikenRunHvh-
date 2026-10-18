import * as THREE from 'three';
import { guessedPose, poseMatrix } from '@game/shared/hvh/v2';
import type { HvhDebugEvent } from '@game/shared';
import type { HvhMatrix } from '@game/shared';

const BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const SPHERE = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 10, 6));
const line = (color: string, opacity: number) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity });
/** Records beyond this many per player are skipped (newest kept) so the overlay stays cheap. */
const MAX_RECORDS = 24;

/** How the overlay talks to the server (supplied by Dev; keeps the socket private to it). */
export interface HvhDebugFeed {
  subscribe(handler: (e: HvhDebugEvent) => void): () => void;
  request(on: boolean): void;
}

/**
 * HvH v2 authoritative overlay (dev only, private rooms; the server decides who receives it).
 * Per other player: the REAL hitbox (yellow), valid lag records (green), invalid lag records
 * (red), and where this viewer's resolver would aim (cyan, guessedPose). The presented pose
 * is drawn by DevDebug3D's regular hitbox pass, so real vs presented visibly separate.
 */
export class HvhAuthDebug {
  private readonly root = new THREE.Group();
  private readonly pool: THREE.LineSegments[] = [];
  private used = 0;
  private readonly latest = new Map<number, HvhDebugEvent>();
  private readonly materials = { real: line('#ffe14c', 0.95), valid: line('#4dff88', 0.5), invalid: line('#ff4d5e', 0.55), guess: line('#4dd8ff', 0.9) };
  private readonly unsubscribe: () => void;
  private requested = false;

  constructor(parent: THREE.Object3D | null, private readonly feed: HvhDebugFeed) {
    this.root.renderOrder = 999;
    parent?.add(this.root);
    this.unsubscribe = feed.subscribe((e) => this.latest.set(e.playerId, e));
  }

  update(enabled: boolean, alive: (pid: number) => boolean): void {
    if (enabled !== this.requested) { this.requested = enabled; this.feed.request(enabled); if (!enabled) this.latest.clear(); }
    this.root.visible = enabled;
    this.used = 0;
    if (enabled) {
      for (const [pid, e] of this.latest) {
        if (!alive(pid)) { this.latest.delete(pid); continue; }
        const records = e.records.slice(-MAX_RECORDS);
        const newest = e.records.at(-1);
        for (const r of records) this.draw(poseMatrix(r, r.pose), r.valid ? this.materials.valid : this.materials.invalid);
        if (newest) {
          this.draw(poseMatrix(newest, e.realPose), this.materials.real);
          this.draw(poseMatrix(newest, guessedPose(e.realPose, e.resolver.side)), this.materials.guess);
        }
      }
    }
    for (let i = 0; i < this.pool.length; i++) this.pool[i]!.visible = i < this.used;
  }

  private draw(matrix: HvhMatrix, material: THREE.LineBasicMaterial): void {
    for (const box of matrix.boxes) {
      let l = this.pool[this.used];
      if (!l) { l = new THREE.LineSegments(BOX, material); l.renderOrder = 999; this.root.add(l); this.pool.push(l); }
      l.geometry = box.half ? BOX : SPHERE;
      l.material = material;
      this.used++;
      l.position.set(box.center.x, box.center.y, box.center.z);
      l.rotation.y = box.yaw;
      if (box.half) l.scale.set(box.half.x * 2, box.half.y * 2, box.half.z * 2); else l.scale.setScalar(box.radius);
    }
  }

  dispose(): void {
    this.unsubscribe();
    if (this.requested) this.feed.request(false);
    this.root.removeFromParent();
    Object.values(this.materials).forEach((m) => m.dispose());
  }
}
