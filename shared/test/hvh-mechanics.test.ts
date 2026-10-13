import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ExploitResource, ResolverSystem, createAnimation, stepAnimation, maximumBodyDelta, movementLayerWeight, hvhPose, defaultHvhLoadout,
  defaultSkeetAntiAim, wrapAngle, type ObservableRecord } from '../src/index';

const record = (t: number, eyeYaw = 0): ObservableRecord => ({ pid: 2, tick: t / 16, t,
  origin: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, eyeYaw, lowerBodyYaw: 0,
  speed: 0, crouch: 0, grounded: true, turnWeight: 0, alive: true, hp: 100, armor: 0,
  fired: false, concealed: false, defensive: false });

it('historical resolver patterns never use observations from the future', () => {
  const resolver = new ResolverSystem();
  for (let i = 0; i < 4; i++) resolver.observe(record(i * 50));
  const old = record(150), before = resolver.resolve(old);
  for (let i = 4; i < 12; i++) resolver.observe(record(i * 50, i % 2 ? 0.4 : -0.4));
  assert.equal(resolver.resolve(old).pattern, before.pattern);
  assert.equal(resolver.resolve(record(550, 0.4)).pattern, 'JITTER');
});

it('jitter feedback follows the shot record phase and does not poison other stances', () => {
  const learned = new ResolverSystem(), control = new ResolverSystem();
  for (let i = 0; i < 8; i++) for (const resolver of [learned, control]) resolver.observe(record(i * 50, i % 2 ? 0.4 : -0.4));
  const shot = record(350, 0.4), next = record(400, -0.4);
  for (const resolver of [learned, control]) resolver.observe(next);
  learned.feedback(2, 'LEFT', 'RESOLVER', 400, true, shot.t);
  assert.ok(learned.resolve(shot).hypotheses.find(h => h.source === 'LEFT')!.probability
    < control.resolve(shot).hypotheses.find(h => h.source === 'LEFT')!.probability);
  assert.deepEqual(learned.resolve(next).hypotheses, control.resolve(next).hypotheses);
  const air = { ...record(450, -0.4), grounded: false };
  for (const resolver of [learned, control]) resolver.observe(air);
  assert.deepEqual(learned.resolve(air).hypotheses, control.resolve(air).hypotheses);
});

it('only exposed shots give the resolver a reliable center cue', () => {
  const resolver = new ResolverSystem(), fired = { ...record(100), fired: true };
  resolver.observe(fired);
  const exposed = resolver.resolve(fired);
  assert.equal(exposed.hypotheses[0]!.source, 'CENTER'); assert.ok(exposed.confidence > 0.9);
  const concealed = resolver.resolve({ ...fired, concealed: true });
  assert.ok(concealed.confidence < 0.5);
});

it('Source-style lower-body targets respect stop and standing timers without publishing body yaw', () => {
  const a = createAnimation(), moving = { eyeYaw: 0, desiredDelta: 0.8, speed: 2, crouch: 0, grounded: true, active: true };
  for (let tick = 0; tick < 160; tick++) stepAnimation(a, moving, tick);
  assert.equal(a.lowerBodyYaw, 0); assert.ok(a.bodyYaw > 0.6);
  const stopped = { ...moving, speed: 0, eyeYaw: 0.25 };
  for (let tick = 160; tick < 174; tick++) stepAnimation(a, stopped, tick);
  assert.equal(a.lowerBodyYaw, 0);
  stepAnimation(a, { ...stopped, concealed: true }, 174); assert.equal(a.lowerBodyYaw, 0);
  stepAnimation(a, stopped, 175); assert.equal(a.lowerBodyYaw, 0.25); assert.notEqual(a.lowerBodyYaw, a.bodyYaw);
  assert.equal(a.nextBodyUpdate, 246);
  for (let tick = 176; tick < 246; tick++) stepAnimation(a, { ...stopped, eyeYaw: 0.5 }, tick);
  assert.equal(a.lowerBodyYaw, 0.25);
  stepAnimation(a, { ...stopped, eyeYaw: 0.5 }, 246); assert.equal(a.lowerBodyYaw, 0.5);
});

it('rotation width follows walking, running and crouched movement rather than a fixed delta', () => {
  const deg = 180 / Math.PI;
  assert.ok(Math.abs(maximumBodyDelta(0, 1, true) * deg - 58) < 1e-8);
  assert.ok(Math.abs(maximumBodyDelta(6, 0, true, 1, 1) * deg - 29) < 1e-8);
  assert.ok(Math.abs(maximumBodyDelta(3.12, 0, true, 1, 0) * deg - 46.4) < 1e-8);
  assert.ok(Math.abs(maximumBodyDelta(2.04, 1, true, 1, 0) * deg - 29) < 1e-8);
});

it('movement-layer comparison chooses a matching side and miss cycling reverses that side first', () => {
  const resolver = new ResolverSystem(), velocity = { x: -1.5, y: 0, z: -1.5 }, speed = Math.hypot(velocity.x, velocity.z);
  const yaw = maximumBodyDelta(speed, 0, true), weight = movementLayerWeight(yaw, velocity, speed, 0, true);
  for (const t of [100, 150, 200]) resolver.observe({ ...record(t), speed, velocity, movementWeight: weight });
  const r = { ...record(200), speed, velocity, movementWeight: weight };
  assert.equal(resolver.resolve(r).hypotheses[0]!.source, 'RIGHT');
  assert.equal(resolver.resolve(r, true, undefined, 'cycle').hypotheses[0]!.source, 'RIGHT');
  resolver.feedback(2, 'RIGHT', 'RESOLVER', 200);
  assert.equal(resolver.resolve(r, true, undefined, 'cycle').hypotheses[0]!.source, 'LEFT');
  resolver.feedback(2, 'LEFT', 'RESOLVER', 200);
  assert.equal(resolver.resolve(r, true, undefined, 'cycle').hypotheses[0]!.source, 'CENTER');
});

it('Skeet players have deterministic independent jitter phases', () => {
  const l = defaultHvhLoadout(); l.antiAim.enabled = true; l.skeet = defaultSkeetAntiAim();
  assert.deepEqual(hvhPose(0, l, 90, false, false, { seed: 1 }), hvhPose(0, l, 90, false, false, { seed: 1 }));
  assert.notEqual(hvhPose(0, l, 0, false, false, { seed: 1 }).real, hvhPose(0, l, 0, false, false, { seed: 2 }).real);
  const a = hvhPose(0, l, 90, false, false, { seed: 1 }), b = hvhPose(0, l, 90, true, false, { seed: 1 });
  assert.ok(Math.abs(wrapAngle(a.fake - a.real) + wrapAngle(b.fake - b.real)) < 1e-8);
});

it('charge recovers under fake lag and a charged heavy weapon can Double Tap', () => {
  for (const choked of [false, true]) {
    const resource = new ExploitResource();
    for (let i = 0; i < (choked ? 256 : 128); i++) resource.step(i, false, choked);
    assert.equal(resource.charge, 1);
    assert.equal(resource.fire(1200, 'doubleTap', 256).shots, 2);
    assert.equal(resource.ticks, 0); assert.equal(resource.fire(1200, 'doubleTap', 256).shots, 0);
  }
});
