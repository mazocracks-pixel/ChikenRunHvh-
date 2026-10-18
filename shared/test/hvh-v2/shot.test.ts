import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollisionWorld } from '../../src/collision';
import { PLAYER_HULL_WIDTH } from '../../src/constants';
import type { Vec3 } from '../../src/math';
import { WEAPONS, pelletDirections } from '../../src/weapons';
import { LATE_CSGO } from '../../src/hvh/v2/era';
import type { Observation, PoseState } from '../../src/hvh/v2/pose';
import { RecordHistory } from '../../src/hvh/v2/records';
import { createResolverMemory, learnFromVerdict } from '../../src/hvh/v2/resolver';
import {
  type ShotContext,
  type WorldTrace,
  type WorldTracer,
  collisionWorldTracer,
  processShot,
} from '../../src/hvh/v2/shot';

const DEG = Math.PI / 180;
/** Real body 58 deg to the left of the eyes. Head centre then sits at x = -0.271 (x = +0.271 if mirrored). */
const POSE: PoseState = { eyeYaw: 0, bodyYaw: 58 * DEG, pitch: 0, jitterPhase: 0, realSide: 'left', eyeOffsetDeg: 0 };
const HEAD_X = 0.32 * Math.sin(58 * DEG);
const CHEST: Vec3 = { x: 0, y: 0.95, z: 10 };
const REAL_HEAD: Vec3 = { x: -HEAD_X, y: 1.4, z: 10 };
const MIRROR_HEAD: Vec3 = { x: HEAD_X, y: 1.4, z: 10 };
const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
/** A positive eye offset makes the resolver guess 'right' (the mirror of the real 'left'). */
const GUESS_RIGHT: Observation[] = [{ tick: 98, eyeYaw: 0, eyeOffsetDeg: 20, speedFraction: 0, duck: 0 }];

const open: WorldTracer = { trace: (_o, _d, range) => ({ wallDistance: range, passages: [] }) };
const fixed = (t: WorldTrace): WorldTracer => ({ trace: () => t });

function history(extra: (h: RecordHistory) => void = () => {}): RecordHistory {
  const h = new RecordHistory(LATE_CSGO, PLAYER_HULL_WIDTH);
  for (let t = 90; t <= 100; t++) h.push({ tick: t, position: { x: 0, y: 0, z: 0 }, pose: POSE, valid: true });
  extra(h);
  return h;
}

function ctx(over: Partial<ShotContext> = {}, target: Partial<NonNullable<ShotContext['target']>> = {}): ShotContext {
  return {
    shooterId: 's1',
    tick: 100,
    bullet: 1,
    aim: { origin: CHEST, dir: FORWARD },
    weaponId: 'pistol',
    ticksSinceLastShot: 64,
    target: { id: 't1', history: history(), alive: true, hp: 100, ...target },
    viewTick: 98,
    resolver: createResolverMemory(),
    observations: [],
    world: open,
    spreadSeed: 1234,
    ...over,
  };
}

// HvH pistol: 24 damage x 1.6 (hvhWeapon boost for weapons under 50 damage), chest multiplier 1.
const PISTOL_CHEST = 24 * 1.6;

describe('Shot pipeline (v2)', () => {
  it('hit: spread ray hits the real pose', () => {
    const v = processShot(ctx());
    assert.equal(v.cause, 'hit');
    assert.equal(v.hitgroup, 'chest');
    assert.ok(Math.abs(v.damage! - PISTOL_CHEST) < 1e-9);
    assert.ok(Math.abs(v.remainingHp! - (100 - PISTOL_CHEST)) < 1e-9);
    assert.equal(v.guessed, 'left');
    assert.equal(v.real, 'left');
    assert.equal(v.targetId, 't1');
    assert.equal(v.shooterId, 's1');
    assert.equal(v.tick, 100);
    assert.equal(v.bullet, 1);
  });

  it('hit: remaining hp never goes below zero', () => {
    const v = processShot(ctx({}, { hp: 10 }));
    assert.equal(v.cause, 'hit');
    assert.equal(v.remainingHp, 0);
  });

  it('resolver: aim hits the guessed pose but not the real one', () => {
    const v = processShot(ctx({ aim: { origin: MIRROR_HEAD, dir: FORWARD }, observations: GUESS_RIGHT }));
    assert.equal(v.cause, 'resolver');
    assert.equal(v.guessed, 'right');
    assert.equal(v.real, 'left');
    assert.equal(v.damage, undefined);
  });

  it('resolver miss teaches the resolver, so the next shot hits', () => {
    const c = ctx({ aim: { origin: REAL_HEAD, dir: FORWARD }, observations: GUESS_RIGHT });
    const mirrored = processShot({ ...c, aim: { origin: MIRROR_HEAD, dir: FORWARD } });
    assert.equal(mirrored.cause, 'resolver');
    learnFromVerdict(c.resolver, 't1', mirrored.guessed!, mirrored.cause);
    const next = processShot({ ...c, aim: { origin: REAL_HEAD, dir: FORWARD } });
    assert.equal(next.guessed, 'left');
    assert.equal(next.cause, 'hit');
    assert.equal(next.hitgroup, 'head');
  });

  it('spread: the deviated ray misses the real pose', () => {
    const spread = 0.3;
    // Pick a seed whose (independently computed) direction lands far off the head at the target plane.
    let seed = 1;
    for (; seed < 1000; seed++) {
      const d = pelletDirections(WEAPONS.pistol, FORWARD, spread, seed)[0]!;
      const k = 10 / -d.z;
      const dx = d.x * k;
      const dy = d.y * k;
      if (dy > 0.4 || Math.abs(dx) > 1) break;
    }
    const v = processShot(ctx({ aim: { origin: REAL_HEAD, dir: FORWARD }, spread, spreadSeed: seed }));
    assert.equal(v.cause, 'spread');
    assert.equal(v.guessed, 'left');
    assert.equal(v.real, 'left');
    assert.equal(v.damage, undefined);
  });

  it('spread: a shot at nothing with no target', () => {
    const v = processShot(ctx({ target: undefined }));
    assert.equal(v.cause, 'spread');
    assert.equal(v.targetId, undefined);
  });

  it('invalidRecord: an expired view tick never resolves', () => {
    const c = ctx({ viewTick: 80 });
    const v = processShot(c);
    assert.equal(v.cause, 'invalidRecord');
    assert.equal(v.invalidCause, 'expired');
    assert.equal(v.guessed, undefined);
    assert.equal(c.resolver.byTarget.size, 0);
  });

  it('invalidRecord: a defensive record', () => {
    const v = processShot(ctx({}, { history: history((h) => h.markDefensive(97)) }));
    assert.equal(v.cause, 'invalidRecord');
    assert.equal(v.invalidCause, 'defensive');
  });

  it('a future view tick is clamped to the current tick', () => {
    // Records after ctx.tick have moved away; an unclamped select would pick tick 102.
    const h = history((x) => {
      x.push({ tick: 101, position: { x: 1.5, y: 0, z: 0 }, pose: POSE, valid: true });
      x.push({ tick: 102, position: { x: 3, y: 0, z: 0 }, pose: POSE, valid: true });
    });
    const v = processShot(ctx({ viewTick: 105 }, { history: h }));
    assert.equal(v.cause, 'hit');
  });

  it('obstruction: a non-penetrable wall in front of the target', () => {
    const c = ctx({ world: fixed({ wallDistance: 5, material: 'concrete', passages: [] }) });
    const v = processShot(c);
    assert.equal(v.cause, 'obstruction');
    assert.equal(v.material, 'concrete');
    assert.equal(v.guessed, undefined);
    assert.equal(c.resolver.byTarget.size, 0);
  });

  it('obstruction: damage fully absorbed by penetration', () => {
    const world = fixed({ wallDistance: 120, passages: [{ entry: 5, exit: 6, loss: 0.01, material: 'wood' }] });
    const v = processShot(ctx({ world }));
    assert.equal(v.cause, 'obstruction');
    assert.equal(v.material, 'wood');
  });

  it('a wall behind the target does not obstruct', () => {
    const v = processShot(ctx({ world: fixed({ wallDistance: 15, material: 'concrete', passages: [] }) }));
    assert.equal(v.cause, 'hit');
  });

  it('rejected: unknown weapon', () => {
    const v = processShot(ctx({ weaponId: 'nope' }));
    assert.equal(v.cause, 'rejected');
    assert.equal(v.reason, 'unknown weapon');
  });

  it('rejected: invalid aim', () => {
    for (const dir of [{ x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: -1 }]) {
      const v = processShot(ctx({ aim: { origin: CHEST, dir } }));
      assert.equal(v.cause, 'rejected');
      assert.equal(v.reason, 'invalid aim');
    }
    const v = processShot(ctx({ aim: { origin: { x: Infinity, y: 0, z: 0 }, dir: FORWARD } }));
    assert.equal(v.reason, 'invalid aim');
  });

  it('dt respects slow weapon interval', () => {
    // Sniper: 1700 ms -> ceil(1700 * 64 / 1000) = 109 ticks, far more than a 14-tick DT shift.
    const v = processShot(ctx({ weaponId: 'sniper', bullet: 2, ticksSinceLastShot: 14 }));
    assert.equal(v.cause, 'rejected');
    assert.equal(v.reason, 'fire interval');
    assert.equal(v.bullet, 2);
  });

  it('fire interval boundary: pistol 220 ms is 15 ticks', () => {
    assert.equal(processShot(ctx({ ticksSinceLastShot: 14 })).reason, 'fire interval');
    assert.equal(processShot(ctx({ ticksSinceLastShot: 15 })).cause, 'hit');
  });

  it('second dt bullet on dead target', () => {
    const v = processShot(ctx({ bullet: 2 }, { alive: false }));
    assert.equal(v.cause, 'rejected');
    assert.equal(v.reason, 'target already dead');
    assert.equal(v.damage, undefined);
  });

  it('same seed same verdict', () => {
    for (const over of [{}, { spread: 0.3 }, { aim: { origin: MIRROR_HEAD, dir: FORWARD }, observations: GUESS_RIGHT }]) {
      assert.deepEqual(processShot(ctx(over)), processShot(ctx(over)));
    }
  });
});

describe('collisionWorldTracer', () => {
  const wall = { minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: 4.5, maxZ: 5 };
  const materialOf = (id: number): string => (id === 0 ? 'wood' : id === 1 ? 'concrete' : 'ground');

  it('stops at a solid box and names its material', () => {
    const world = collisionWorldTracer(new CollisionWorld(64, [{ ...wall, minZ: 9, maxZ: 9.5 }, wall]), (id) => id === 0, materialOf);
    const v = processShot(ctx({ world }));
    assert.equal(v.cause, 'obstruction');
    assert.equal(v.material, 'concrete');
  });

  it('penetrates a soft box with the thickness loss', () => {
    const world = collisionWorldTracer(new CollisionWorld(64, [wall]), (id) => id === 0, materialOf);
    const t = world.trace(CHEST, FORWARD, 120);
    assert.equal(t.passages.length, 1);
    assert.equal(t.passages[0]!.material, 'wood');
    const v = processShot(ctx({ world }));
    assert.equal(v.cause, 'hit');
    assert.ok(Math.abs(v.damage! - PISTOL_CHEST * Math.exp(-0.5 * 0.22) * 0.82) < 1e-3); // spread tilts the ray slightly
  });
});
