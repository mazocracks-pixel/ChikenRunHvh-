import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CollisionWorld,
  DEFAULT_LOADOUT,
  HOP,
  LOADOUT_SIZE,
  SIM_DT,
  WEAPONS,
  createMoveState,
  hopMaxFor,
  isMelee,
  meleeHit,
  sanitizeLoadout,
  stepPlayer,
  type InputFrame,
  type MeleeTarget,
} from '../src/index';

const flat = new CollisionWorld(200, []);
const hopFrame = (seq: number): InputFrame => ({ seq, forward: 1, right: 0, jump: true, yaw: 0, pitch: 0 });

/** Bunny hops (holding forward + jump) for `seconds` and returns the speed bonus. */
function hopFor(seconds: number, hopMax: number, s = createMoveState(0, 0, 90)): ReturnType<typeof createMoveState> {
  for (let i = 0; i < seconds / SIM_DT; i++) stepPlayer(s, hopFrame(i), SIM_DT, flat, null, hopMax);
  return s;
}

describe('melee bunny hops', () => {
  it('build up to +80% speed with a melee weapon, +60% with a gun', () => {
    assert.equal(hopMaxFor('knife'), HOP.meleeMax);
    assert.equal(hopMaxFor('katana'), 0.8);
    assert.equal(hopMaxFor('rifle'), HOP.max);
    const melee = hopFor(12, hopMaxFor('knife'));
    assert.ok(Math.abs(melee.hop - 0.8) < 1e-9, `melee bonus ${melee.hop}`);
    const gun = hopFor(12, hopMaxFor('rifle'));
    assert.ok(Math.abs(gun.hop - 0.6) < 1e-9, `gun bonus ${gun.hop}`);
  });

  it('putting the melee weapon away drops the extra speed', () => {
    const s = hopFor(12, HOP.meleeMax);
    assert.ok(s.hop > HOP.max);
    stepPlayer(s, hopFrame(9999), SIM_DT, flat, null, hopMaxFor('pistol'));
    assert.ok(s.hop <= HOP.max + 1e-9, `after switching ${s.hop}`);
  });
});

describe('loadouts with melee', () => {
  const ownsAll = () => true;
  const ownsNone = () => false;

  it('always ends with exactly one melee weapon (the knife unless another is picked)', () => {
    assert.deepEqual(sanitizeLoadout(['smg', 'pistol'], ownsAll, LOADOUT_SIZE, DEFAULT_LOADOUT), ['smg', 'pistol', 'knife']);
    assert.deepEqual(sanitizeLoadout(['katana', 'smg', 'pan', 'pistol'], ownsAll, LOADOUT_SIZE, DEFAULT_LOADOUT), ['smg', 'pistol', 'katana']);
    // Four guns still fit, with the melee weapon after them.
    const full = sanitizeLoadout(['rifle', 'smg', 'sniper', 'pistol', 'shotgun', 'pan'], ownsAll, LOADOUT_SIZE, DEFAULT_LOADOUT);
    assert.deepEqual(full, ['rifle', 'smg', 'sniper', 'pistol', 'pan']);
  });

  it("can't use a melee weapon you don't own, and old saves get the knife", () => {
    assert.deepEqual(sanitizeLoadout(['pistol', 'katana'], ownsNone, LOADOUT_SIZE, DEFAULT_LOADOUT), ['pistol', 'knife']);
    assert.deepEqual(sanitizeLoadout(['knife'], ownsNone, LOADOUT_SIZE, DEFAULT_LOADOUT), [...DEFAULT_LOADOUT.filter((w) => !isMelee(w)), 'knife']);
  });
});

describe('meleeHit', () => {
  const eye = { x: 0, y: 1.1, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  const target = (z: number, x = 0): MeleeTarget<string> => ({ key: 'victim', x, y: 0, z, yaw: 0, scale: 1 });
  const knife = WEAPONS.knife;

  it('hits a chicken right in front, but not one out of reach', () => {
    assert.equal(meleeHit(eye, forward, knife, [target(-1.5)], flat)?.key, 'victim');
    assert.equal(meleeHit(eye, forward, knife, [target(-4)], flat), null);
    // The katana reaches further than the knife.
    assert.equal(meleeHit(eye, forward, knife, [target(-2.9)], flat), null);
    assert.equal(meleeHit(eye, forward, WEAPONS.katana, [target(-2.9)], flat)?.key, 'victim');
  });

  it('forgives a slightly off aim, but not a chicken beside or behind you', () => {
    assert.equal(meleeHit(eye, forward, knife, [target(-1.4, 0.9)], flat)?.key, 'victim', 'a little to the side');
    assert.equal(meleeHit(eye, forward, knife, [target(0, 1.6)], flat), null, 'right beside');
    assert.equal(meleeHit(eye, forward, knife, [target(1.5)], flat), null, 'behind');
  });

  it("doesn't go through walls and picks the nearest chicken", () => {
    const walled = new CollisionWorld(40, [{ minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: -0.9, maxZ: -0.7 }]);
    assert.equal(meleeHit(eye, forward, knife, [target(-1.6)], walled), null);
    const near = { ...target(-1.2), key: 'near' };
    const far = { ...target(-2), key: 'far' };
    assert.equal(meleeHit(eye, forward, knife, [far, near], flat)?.key, 'near');
  });

  it('counts head hits as headshots', () => {
    const head = meleeHit({ x: 0, y: 1.27, z: 0 }, forward, knife, [target(-1.2)], flat);
    assert.equal(head?.headshot, true);
  });
});

describe('bunny hop while crouching', () => {
  it('builds no speed, and loses what it had', () => {
    const crouchHop = (seq: number): InputFrame => ({ ...hopFrame(seq), crouch: true });
    const s = createMoveState(0, 0, 90);
    for (let i = 0; i < 6 / SIM_DT; i++) stepPlayer(s, crouchHop(i), SIM_DT, flat, null, HOP.max);
    assert.equal(s.hop, 0, 'crouched hops give nothing');
    const fast = hopFor(6, HOP.max);
    assert.ok(fast.hop > 0.3);
    for (let i = 0; i < 2 / SIM_DT; i++) stepPlayer(fast, crouchHop(i), SIM_DT, flat, null, HOP.max);
    assert.equal(fast.hop, 0, 'holding Ctrl drops the bonus on the next hop');
  });
});
