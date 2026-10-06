import * as THREE from 'three';
import { BLOCK_ID_BASE, BLOCK_KINDS, BLOCK_SIZE, MAX_BLOCKS, blockAabb, type BlockKind, type BlockState, type CollisionWorld } from '@game/shared';
import { boxTexture } from './textures';

/** Sandbox blocks: one instanced mesh per material, kept in sync with the collision world. */
/** How long before an expiring build disappears it starts to show it. */
const FADE_MS = 2500;

export class Blocks {
  private readonly root = new THREE.Group();
  private readonly meshes = new Map<BlockKind, THREE.InstancedMesh>();
  /** Per kind: which block id occupies each instance slot. */
  private readonly slots = new Map<BlockKind, number[]>();
  private readonly byId = new Map<number, BlockState>();
  /** Zombie Apocalypse builds: when each one disappears (performance.now() ms). */
  private readonly expiry = new Map<number, number>();
  private readonly tint = new THREE.Color();
  private readonly world: CollisionWorld;
  private readonly matrix = new THREE.Matrix4();
  private readonly ghost: THREE.Mesh;
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(scene: THREE.Scene, world: CollisionWorld) {
    this.world = world;
    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    this.disposables.push(geometry);
    for (const kind of BLOCK_KINDS) {
      const { texture } = boxTexture(kind);
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
      this.disposables.push(texture, material);
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_BLOCKS);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.set(kind, mesh);
      this.slots.set(kind, []);
      this.root.add(mesh);
    }
    this.ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_SIZE * 1.01, BLOCK_SIZE * 1.01, BLOCK_SIZE * 1.01), this.ghostMaterial);
    this.ghost.visible = false;
    this.disposables.push(this.ghost.geometry, this.ghostMaterial);
    this.root.add(this.ghost);
    scene.add(this.root);
  }

  get count(): number {
    return this.byId.size;
  }

  /** Kind of a placed block by id (for wallbang). */
  kindOf(id: number): BlockState['kind'] | undefined {
    return this.byId.get(id)?.kind;
  }

  add(block: BlockState): void {
    if (this.byId.has(block.id)) return;
    const mesh = this.meshes.get(block.kind);
    const slots = this.slots.get(block.kind);
    if (!mesh || !slots) return;
    this.byId.set(block.id, block);
    if (block.ttl !== undefined) this.expiry.set(block.id, performance.now() + block.ttl);
    const box = blockAabb(block.cx, block.cy, block.cz);
    this.world.add(BLOCK_ID_BASE + block.id, box);
    const i = slots.length;
    slots.push(block.id);
    this.matrix.makeTranslation(box.minX + BLOCK_SIZE / 2, box.minY + BLOCK_SIZE / 2, box.minZ + BLOCK_SIZE / 2);
    mesh.setMatrixAt(i, this.matrix);
    mesh.count = slots.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  remove(id: number): void {
    const block = this.byId.get(id);
    if (!block) return;
    this.byId.delete(id);
    this.expiry.delete(id);
    this.world.remove(BLOCK_ID_BASE + id);
    const mesh = this.meshes.get(block.kind)!;
    const slots = this.slots.get(block.kind)!;
    // Swap the last instance into the freed slot.
    const i = slots.indexOf(id);
    const last = slots.length - 1;
    if (i !== last) {
      mesh.getMatrixAt(last, this.matrix);
      mesh.setMatrixAt(i, this.matrix);
      if (mesh.instanceColor) {
        mesh.getColorAt(last, this.tint);
        mesh.setColorAt(i, this.tint);
        mesh.instanceColor.needsUpdate = true;
      }
      slots[i] = slots[last]!;
    }
    slots.pop();
    mesh.count = slots.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Builds that expire (Zombie Apocalypse): in their last 2.5 seconds they shrink, blink and
   * turn red, so you can see how long a wall has left.
   */
  tick(now: number): void {
    for (const [id, at] of this.expiry) {
      const left = at - now;
      if (left > FADE_MS) continue;
      const block = this.byId.get(id);
      if (!block) continue;
      const mesh = this.meshes.get(block.kind)!;
      const i = this.slots.get(block.kind)!.indexOf(id);
      if (i < 0) continue;
      const box = blockAabb(block.cx, block.cy, block.cz);
      const blink = Math.floor(now / 110) % 2 === 0;
      const scale = Math.max(0.25, left / FADE_MS) * (blink ? 1 : 0.9);
      this.matrix.compose(new THREE.Vector3(box.minX + BLOCK_SIZE / 2, box.minY + BLOCK_SIZE / 2, box.minZ + BLOCK_SIZE / 2), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, this.matrix);
      mesh.setColorAt(i, this.tint.setRGB(1, 0.35 + 0.65 * Math.max(0, left / FADE_MS), 0.3 + 0.7 * Math.max(0, left / FADE_MS)));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Shows the translucent preview of where a block would go (null hides it). */
  showGhost(cell: { cx: number; cy: number; cz: number } | null, valid: boolean): void {
    this.ghost.visible = cell !== null;
    if (!cell) return;
    const box = blockAabb(cell.cx, cell.cy, cell.cz);
    this.ghost.position.set(box.minX + BLOCK_SIZE / 2, box.minY + BLOCK_SIZE / 2, box.minZ + BLOCK_SIZE / 2);
    this.ghostMaterial.color.set(valid ? 0xffffff : 0xff4444);
  }

  dispose(): void {
    for (const id of [...this.byId.keys()]) this.world.remove(BLOCK_ID_BASE + id);
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
