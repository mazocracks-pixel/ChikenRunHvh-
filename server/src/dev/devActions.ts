import { DEV_MAX_LOADOUT, PLAYER, WEAPONS, clamp, createMoveState, type DevAction, type DevResult } from '@game/shared';
import type { GameRoom } from '../rooms/GameRoom';
import type { ServerPlayer } from '../rooms/ServerPlayer';

/**
 * Carries out a developer action on a player in `room`. The caller has already checked that
 * `actor` has developer access and that the room allows it; this validates the target and values.
 */
export function runDevAction(room: GameRoom, actor: ServerPlayer, action: DevAction): DevResult {
  // Check at the mutation boundary as well as the socket API: no internal caller can
  // accidentally grant an HvH player immunity, resources, freezes or teleports.
  if (room.mode.id === 'hvh') {
    room.enforceHvhRules(actor);
    return fail('Player administration is unavailable in HvH.');
  }
  if (!room.info.private) return fail('Player administration only works in private test rooms.');
  const now = performance.now();
  if (action.kind === 'teleport') {
    if (!actor.alive) return fail('You are dead.');
    const limit = room.map.halfSize - PLAYER.radius;
    moveTo(actor, clamp(action.x, -limit, limit), clamp(action.y, 0, 60), clamp(action.z, -limit, limit));
    return ok;
  }

  const target = room.players.get(action.target);
  if (!target) return fail('That player is no longer in the room.');

  switch (action.kind) {
    case 'teleportToPlayer': {
      if (!actor.alive || !target.alive) return fail('Both players need to be alive.');
      if (target === actor) return fail('That is you.');
      // Land just behind them, facing the same way.
      moveTo(actor, target.state.x + Math.sin(target.yaw) * 1.5, target.state.y, target.state.z + Math.cos(target.yaw) * 1.5);
      return ok;
    }
    case 'bringPlayer': {
      if (!actor.alive || !target.alive) return fail('Both players need to be alive.');
      if (target === actor) return fail('That is you.');
      moveTo(target, actor.state.x - Math.sin(actor.yaw) * 2, actor.state.y, actor.state.z - Math.cos(actor.yaw) * 2);
      return ok;
    }
    case 'freeze':
      target.frozen = action.frozen;
      target.state.vx = target.state.vy = target.state.vz = 0;
      room.systemMessage(`${target.info.name} was ${action.frozen ? 'frozen' : 'unfrozen'} by a developer`);
      return ok;
    case 'respawn':
      room.respawnPlayer(target, now);
      return ok;
    case 'health': {
      if (!target.alive) return fail('That player is dead.');
      if (action.amount >= 0) {
        target.hp = Math.min(PLAYER.maxHealth, target.hp + action.amount);
        return ok;
      }
      // Hurting goes through the normal damage path, so death, the kill feed and scores work.
      target.shieldUntil = 0;
      room.damage(target, null, -action.amount, false, 'world', { x: target.state.x, y: target.state.y, z: target.state.z }, now);
      return ok;
    }
    case 'armor':
      if (!target.alive) return fail('That player is dead.');
      target.armor = clamp(action.value, 0, PLAYER.maxArmor);
      return ok;
    case 'giveWeapon': {
      const loadout = target.info.loadout;
      if (loadout.includes(action.weapon)) {
        target.weaponSlot = loadout.indexOf(action.weapon);
      } else {
        if (loadout.length >= DEV_MAX_LOADOUT) return fail(`Loadouts hold at most ${DEV_MAX_LOADOUT} weapons.`);
        target.info.loadout = [...loadout, action.weapon];
        target.weaponSlot = target.info.loadout.length - 1;
      }
      target.mags.set(action.weapon, target.magazineSize(action.weapon));
      target.reloadUntil = 0;
      room.announcePlayer(target);
      return ok;
    }
    case 'removeWeapon': {
      const loadout = target.info.loadout;
      if (!loadout.includes(action.weapon)) return fail(`${target.info.name} doesn't have the ${WEAPONS[action.weapon].name}.`);
      if (loadout.length <= 1) return fail('Players need at least one weapon.');
      const current = target.weapon;
      target.info.loadout = loadout.filter((w) => w !== action.weapon);
      const slot = target.info.loadout.indexOf(current);
      target.weaponSlot = slot >= 0 ? slot : 0;
      target.reloadUntil = 0;
      room.announcePlayer(target);
      return ok;
    }
    case 'refill':
      for (const id of target.info.loadout) target.mags.set(id, target.magazineSize(id));
      target.reloadUntil = 0;
      target.eggs = PLAYER.maxEggs;
      target.smokes = PLAYER.maxSmokes;
      target.flashes = PLAYER.maxFlashes;
      return ok;
  }
}

const ok: DevResult = { ok: true };
const fail = (error: string): DevResult => ({ ok: false, error });

/** Instant move. The player's client snaps to it when the next snapshot arrives. */
function moveTo(p: ServerPlayer, x: number, y: number, z: number): void {
  const fuel = p.state.fuel;
  p.state = createMoveState(x, y, z);
  p.state.fuel = fuel;
  p.history.clear();
}
