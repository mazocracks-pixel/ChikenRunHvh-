import * as THREE from 'three';
import { buildHvhMatrix, ResolverSystem, type ShotCandidate } from '@game/shared';
import type { GameSession } from '../game/GameSession';
const BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const SPHERE = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 10, 6));
/** All enemy geometry is reconstructed from observations. Green is the committed historical matrix. */
export class HvhDebug {
  private readonly root = new THREE.Group();
  private readonly lines = new Map<string, THREE.LineSegments>();
  private readonly materials = ['#fd7798', '#68cfff', '#ffc26b', '#8ee08a'].map(color => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.7 }));
  private nextUpdate = 0;
  constructor(private readonly session: GameSession, private readonly resolver: ResolverSystem, private readonly focus: () => ShotCandidate | null) {
    session.camera.parent?.add(this.root); this.root.renderOrder = 999;
  }
  update(enabled: boolean): void {
    this.root.visible = enabled;
    if (!enabled || performance.now() < this.nextUpdate) return;
    this.nextUpdate = performance.now() + 100;
    const seen = new Set<string>();
    for (const [pid, remote] of this.session.remotes.players) {
      if (!remote.alive) continue;
      const record = this.resolver.records(pid, this.session.serverNow())[0]; if (!record) continue;
      const resolution = this.resolver.resolve(record);
      const matrices = resolution.hypotheses.slice(0, 3).map(h => buildHvhMatrix(record.origin, h.yaw, 1 - record.crouch * 0.3));
      const target = this.focus();
      if (target?.target === pid) matrices.push(buildHvhMatrix(target.record.origin, target.yaw, 1 - target.record.crouch * 0.3));
      matrices.forEach((matrix, index) => matrix.boxes.forEach((box, b) => {
        const key = `${pid}/${index}/${b}`; seen.add(key);
        let line = this.lines.get(key);
        if (!line) { line = new THREE.LineSegments(box.half ? BOX : SPHERE, this.materials[index]!); line.renderOrder = 999; this.root.add(line); this.lines.set(key, line); }
        line.position.set(box.center.x, box.center.y, box.center.z); line.rotation.y = box.yaw;
        if (box.half) line.scale.set(box.half.x * 2, box.half.y * 2, box.half.z * 2); else line.scale.setScalar(box.radius);
      }));
    }
    for (const [key, line] of this.lines) if (!seen.has(key)) { this.root.remove(line); this.lines.delete(key); }
  }
  dispose(): void { this.root.removeFromParent(); this.lines.clear(); this.materials.forEach(m => m.dispose()); }
}
