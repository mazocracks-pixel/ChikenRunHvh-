import {
  BLOCK_ID_BASE,
  BLOCK_KINDS,
  BLOCK_SIZE,
  BUILD_RANGE,
  MAX_BLOCKS,
  MAX_BUILD_HEIGHT,
  PLAYER,
  blockAabb,
  cellKey,
  eyeHeightOf,
  heightOf,
  type Aabb,
  type BlockKind,
  type BlockState,
} from '@game/shared';
import { isRecord } from '../util';
import { GameRoom } from './GameRoom';
import type { ServerPlayer } from './ServerPlayer';

const EPS = 1e-4;

function overlaps(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minY < b.maxY - EPS && a.maxY > b.minY + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}

/** Sandbox: everyone can place and remove blocks; blocks are solid for everyone. */
export class SandboxRoom extends GameRoom {
  private readonly blocks = new Map<number, BlockState>();

  protected override blockKind(blockId: number) {
    return this.blocks.get(blockId)?.kind;
  }
  private readonly cells = new Map<string, number>();
  private nextBlockId = 1;

  protected override joinExtras(_player: ServerPlayer) {
    return { blocks: [...this.blocks.values()], flags: [] };
  }

  override handleBuild(p: ServerPlayer, raw: unknown): void {
    if (!p.alive || p.vehicle || !isRecord(raw)) return;
    const { cx, cy, cz, kind } = raw;
    if (![cx, cy, cz].every((v) => Number.isInteger(v) && Math.abs(v as number) < 1000)) return;
    if (typeof kind !== 'string' || !BLOCK_KINDS.includes(kind as BlockKind)) return;
    const [x, y, z] = [cx as number, cy as number, cz as number];
    if (y < 0 || y >= MAX_BUILD_HEIGHT || this.blocks.size >= MAX_BLOCKS) return;
    const key = cellKey(x, y, z);
    if (this.cells.has(key)) return;

    const box = blockAabb(x, y, z);
    const half = this.map.halfSize;
    if (box.minX < -half || box.maxX > half || box.minZ < -half || box.maxZ > half) return;
    const eye = { x: p.state.x, y: p.state.y + eyeHeightOf(p.state), z: p.state.z };
    const centre = { x: box.minX + BLOCK_SIZE / 2, y: box.minY + BLOCK_SIZE / 2, z: box.minZ + BLOCK_SIZE / 2 };
    if (Math.hypot(centre.x - eye.x, centre.y - eye.y, centre.z - eye.z) > BUILD_RANGE + 1) return;
    // Not inside the level or inside anyone standing there.
    if (this.world.query(box.minX, box.minZ, box.maxX, box.maxZ, []).some((b) => overlaps(b, box))) return;
    for (const other of this.players.values()) {
      if (!other.alive) continue;
      const r = PLAYER.radius;
      const s = other.state;
      if (overlaps(box, { minX: s.x - r, maxX: s.x + r, minY: s.y, maxY: s.y + heightOf(s), minZ: s.z - r, maxZ: s.z + r })) return;
    }
    if (!p.buildLimiter.take()) return;

    const block: BlockState = { id: this.nextBlockId++, cx: x, cy: y, cz: z, kind: kind as BlockKind };
    this.blocks.set(block.id, block);
    this.cells.set(key, block.id);
    this.world.add(BLOCK_ID_BASE + block.id, box);
    this.io.to(this.channel).emit('blockPlaced', block);
  }

  override handleUnbuild(p: ServerPlayer, raw: unknown): void {
    if (!p.alive || !Number.isInteger(raw)) return;
    const block = this.blocks.get(raw as number);
    if (!block || !p.buildLimiter.take()) return;
    const box = blockAabb(block.cx, block.cy, block.cz);
    const eye = { x: p.state.x, y: p.state.y + eyeHeightOf(p.state), z: p.state.z };
    const cx = box.minX + BLOCK_SIZE / 2;
    const cy = box.minY + BLOCK_SIZE / 2;
    const cz = box.minZ + BLOCK_SIZE / 2;
    if (Math.hypot(cx - eye.x, cy - eye.y, cz - eye.z) > BUILD_RANGE + 1.5) return;
    this.blocks.delete(block.id);
    this.cells.delete(cellKey(block.cx, block.cy, block.cz));
    this.world.remove(BLOCK_ID_BASE + block.id);
    this.io.to(this.channel).emit('blockRemoved', block.id);
  }
}
