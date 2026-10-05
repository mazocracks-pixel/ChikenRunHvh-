import { clamp } from '../math';
import type { InputFrame } from '../physics';
import { sanitizeHvhLoadout, type HvhLoadout } from '../hvh';
import { copyObservableRecord, type ObservableRecord } from './animation';
import type { ShotAudit, ShotCandidate, ShotIntent } from './rage';
export interface HvhExtension {
  id: string;
  onCommandBuild?(command: Readonly<InputFrame>): Partial<Pick<InputFrame, 'forward' | 'right' | 'jump' | 'crouch'>> | void;
  onPlayerState?(record: Readonly<ObservableRecord>): void;
  onRageCandidate?(candidate: Readonly<ShotCandidate>): number | void;
  onAntiAim?(ownLoadout: Readonly<HvhLoadout>): Partial<HvhLoadout> | void;
  onShot?(intent: Readonly<ShotIntent>): void;
  onHit?(result: Readonly<ShotAudit>): void;
  onMiss?(result: Readonly<ShotAudit>): void;
  onRender?(): void;
}
/** Typed callbacks for repository-owned panel controllers. No eval, loaders, or enemy authority API. */
export class HvhExtensionHost {
  private readonly plugins = new Map<string, HvhExtension>();
  readonly errors: string[] = [];
  register(plugin: HvhExtension): () => void {
    if (!plugin.id || this.plugins.size >= 8) throw new Error('Invalid or excessive HvH extensions');
    this.plugins.set(plugin.id, plugin); return () => { this.plugins.delete(plugin.id); };
  }
  private invoke<T>(plugin: HvhExtension, call: () => T): T | undefined {
    try { return call(); } catch {
      this.plugins.delete(plugin.id); this.errors.push(`${plugin.id}: callback failed; disabled`);
      if (this.errors.length > 8) this.errors.shift(); return undefined;
    }
  }
  command(frame: InputFrame): InputFrame {
    let out = { ...frame };
    for (const plugin of this.plugins.values()) {
      const change = this.invoke(plugin, () => plugin.onCommandBuild?.(Object.freeze({ ...out })));
      if (!change) continue;
      if (typeof change.forward === 'number' && Number.isFinite(change.forward)) out.forward = clamp(change.forward, -1, 1);
      if (typeof change.right === 'number' && Number.isFinite(change.right)) out.right = clamp(change.right, -1, 1);
      if (typeof change.jump === 'boolean') out.jump = change.jump;
      if (typeof change.crouch === 'boolean') out.crouch = change.crouch;
    }
    return out;
  }
  observe(record: ObservableRecord): void {
    for (const plugin of this.plugins.values()) {
      const safe = copyObservableRecord(record); Object.freeze(safe.origin); Object.freeze(safe.velocity); Object.freeze(safe);
      this.invoke(plugin, () => plugin.onPlayerState?.(safe));
    }
  }
  antiAim(loadout: HvhLoadout): HvhLoadout {
    let out = sanitizeHvhLoadout(loadout);
    for (const plugin of this.plugins.values()) {
      const own = freezeTree(sanitizeHvhLoadout(out));
      const change = this.invoke(plugin, () => plugin.onAntiAim?.(own));
      if (change) out = sanitizeHvhLoadout({ ...out, ...change, antiAim: { ...out.antiAim, ...change.antiAim } });
    }
    return out;
  }
  score(candidate: ShotCandidate): number {
    let bias = 0;
    for (const plugin of this.plugins.values()) {
      const record = copyObservableRecord(candidate.record); Object.freeze(record.origin); Object.freeze(record.velocity); Object.freeze(record);
      const safe = Object.freeze({ ...candidate, record, point: Object.freeze({ ...candidate.point }), direction: Object.freeze({ ...candidate.direction }) });
      const score = this.invoke(plugin, () => plugin.onRageCandidate?.(safe));
      if (typeof score === 'number' && Number.isFinite(score)) bias += clamp(score, -20, 20);
    }
    return clamp(bias, -60, 60);
  }
  shot(intent: ShotIntent): void { for (const plugin of this.plugins.values()) this.invoke(plugin, () => plugin.onShot?.(Object.freeze({ ...intent }))); }
  result(result: ShotAudit): void {
    for (const plugin of this.plugins.values()) this.invoke(plugin, () => (result.reason === 'HIT' ? plugin.onHit : plugin.onMiss)?.(Object.freeze({ ...result })));
  }
  render(): void { for (const plugin of this.plugins.values()) this.invoke(plugin, () => plugin.onRender?.()); }
}
function freezeTree<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeTree(child);
  return Object.freeze(value);
}
