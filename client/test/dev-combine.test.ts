import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { DevHooks, GameSession } from '../src/game/GameSession';
import type { ShotEvent } from '@game/shared';
import { combineDevHooks } from '../src/dev/combine';
it('combined panels preserve assisted-shot identity and accepted server feedback', () => {
  const events: string[] = [], session = {} as GameSession;
  const hook = (id: string) => ({ onShot: (s: GameSession, assisted?: boolean) => { assert.equal(s, session); events.push(`${id}:${assisted}`); }, onServerShot: (s: GameSession, shot: ShotEvent) => { assert.equal(s, session); events.push(`${id}:accepted:${shot.shot}`); } }) as DevHooks;
  const combined = combineDevHooks(hook('hvh'), hook('classic'));
  combined.onShot?.(session, true); combined.onShot?.(session, false);
  combined.onServerShot?.(session, { pid: 1, shot: 42, weapon: 'pistol', ox: 0, oy: 0, oz: 0, ends: [], hits: [] });
  assert.deepEqual(events, ['hvh:true', 'classic:true', 'hvh:false', 'classic:false', 'hvh:accepted:42', 'classic:accepted:42']);
});
it('combined feedback tolerates a classic or future panel without shot callbacks', () => {
  const events: number[] = [], combined = combineDevHooks({ onServerShot: (_: GameSession, shot: ShotEvent) => events.push(shot.shot!) } as unknown as DevHooks, {} as DevHooks);
  combined.onShot?.({} as GameSession, true);
  combined.onServerShot?.({} as GameSession, { pid: 1, shot: 7, weapon: 'pistol', ox: 0, oy: 0, oz: 0, ends: [], hits: [] });
  assert.deepEqual(events, [7]);
});
