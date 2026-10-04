import type { DevHooks } from '../game/GameSession';

/**
 * Runs two developer systems in the same match: the HvH Lab (Insert) and the classic mega?dev
 * menu (L). Each only does anything where the server allows it, so they rarely overlap; when
 * both want something (the shot direction, the camera), the first one wins.
 */
export function combineDevHooks(a: DevHooks, b: DevHooks): DevHooks {
  return {
    onShot: (s, assisted) => {
      a.onShot?.(s, assisted);
      b.onShot?.(s, assisted);
    },
    onServerShot: (s, shot) => {
      a.onServerShot?.(s, shot);
      b.onServerShot?.(s, shot);
    },
    attach: (s) => {
      a.attach(s);
      b.attach(s);
    },
    detach: (s) => {
      a.detach(s);
      b.detach(s);
    },
    beforeFrame: (s, dt, now) => {
      a.beforeFrame(s, dt, now);
      b.beforeFrame(s, dt, now);
    },
    modifyFrame: (s, frame) => b.modifyFrame(s, a.modifyFrame(s, frame)),
    wantsFire: (now) => a.wantsFire(now) || b.wantsFire(now),
    aimOverride: (s, eye) => a.aimOverride(s, eye) ?? b.aimOverride(s, eye),
    recoilScale: () => a.recoilScale() * b.recoilScale(),
    blocksShooting: () => a.blocksShooting() || b.blocksShooting(),
    controlCamera: (s, dt) => a.controlCamera(s, dt) || b.controlCamera(s, dt),
    afterFrame: (s, dt) => {
      a.afterFrame(s, dt);
      b.afterFrame(s, dt);
    },
    bodyAngles: () => a.bodyAngles() ?? b.bodyAngles(),
    xrayFor: (s, player) => a.xrayFor(s, player) ?? b.xrayFor(s, player),
  };
}
