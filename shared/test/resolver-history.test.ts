import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ResolverSystem, maximumBodyDelta, wrapAngle, buildHvhMatrix, matrixPoints, makeRay, normalize, rayHvhMatrix, scanRage, DEFAULT_RAGE, CollisionWorld, hvhWeapon, WEAPONS, type ObservableRecord } from '../src';
const record = (t: number, eyeYaw = 0): ObservableRecord => ({ pid: 2, tick: Math.round(t / 15.625), t,
  origin: { x: 0, y: 0, z: -15 }, velocity: { x: 0, y: 0, z: 0 }, eyeYaw, lowerBodyYaw: 0,
  speed: 0, crouch: 0, grounded: true, turnWeight: 0, alive: true, hp: 100, armor: 0,
  fired: false, concealed: false, defensive: false });
it('keeps resolver evidence separate across movement states and attributes delayed results to their shot record', () => {
  const resolver = new ResolverSystem(), standing = record(100), airborne = { ...record(150), grounded: false };
  resolver.observe(standing); resolver.observe(airborne);
  const initial = resolver.resolve(airborne).hypotheses[0]!.source;
  resolver.feedback(2, 'LEFT', 'RESOLVER', 200, true, standing.t);
  assert.equal(resolver.resolve(airborne).hypotheses[0]!.source, initial);
  assert.notEqual(resolver.resolve(standing).hypotheses[0]!.source, 'LEFT');
  resolver.feedback(2, initial, 'OCCLUSION', 220, true, airborne.t);
  assert.equal(resolver.resolve(airborne).hypotheses[0]!.source, initial);
});
it('detects jitter across the angle wrap and learns each phase separately without reading future records', () => {
  const resolver = new ResolverSystem();
  for (let i = 0; i < 8; i++) resolver.observe(record(100 + i * 50, wrapAngle(Math.PI + (i % 2 ? 0.55 : -0.55))));
  const a = resolver.records(2, 450)[0]!;
  const before = resolver.resolve(a); assert.equal(before.pattern, 'JITTER');
  const center = before.hypotheses.find(h => h.source === 'JITTER_CENTER'); assert.ok(center);
  assert.ok(Math.abs(wrapAngle(center.yaw - Math.PI)) < 0.01);
  resolver.feedback(2, 'LEFT', 'HIT', 450, true, a.t);
  const b = record(500, Math.PI - 0.55); resolver.observe(b);
  assert.equal(resolver.resolve(b).hypotheses[0]!.source, 'LEFT');
  resolver.feedback(2, 'LEFT', 'RESOLVER', 500, true, b.t);
  assert.notEqual(resolver.resolve(b).hypotheses[0]!.source, 'LEFT');
  assert.equal(resolver.resolve(a).hypotheses[0]!.source, 'LEFT');
  assert.equal(resolver.resolve(record(150, Math.PI - 0.55)).pattern, 'TRANSITION');
});
it('uses recent settled movement, forgets stale movement and covers low desync within physical bounds', () => {
  const resolver = new ResolverSystem(), moving = { ...record(100), speed: 2, lowerBodyYaw: 0.25 };
  resolver.observe(moving);
  const stopped = { ...record(150), lowerBodyYaw: 0.25 }; resolver.observe(stopped);
  assert.equal(resolver.resolve(stopped).hypotheses[0]!.source, 'LAST_MOVING');
  const later = { ...stopped, t: 450 }; resolver.observe(later);
  const result = resolver.resolve(later); assert.ok(!result.hypotheses.some(h => h.source === 'LAST_MOVING'));
  assert.ok(result.hypotheses.some(h => h.source === 'LEFT_MIN'));
  for (const h of result.hypotheses) assert.ok(Math.abs(wrapAngle(h.yaw - later.eyeYaw)) <= maximumBodyDelta(0, 0, true));
});
it('learns alternating tucked-head hypotheses from ray outcomes instead of repeatedly penalizing the opposite phase', () => {
  for (const base of [0, Math.PI]) {
    const resolver = new ResolverSystem(), eye = { x: 0, y: 2, z: 25 }; let hits = 0;
    for (let i = 0; i < 96; i++) {
      const phase = i % 2 ? 1 : -1, r = { ...record(100 + i * 50, wrapAngle(base + phase * 0.3)), pitch: -1.15, turnWeight: 0.5 };
      resolver.observe(r); if (i < 8) continue;
      const h = resolver.resolve(r).hypotheses[0]!, predicted = buildHvhMatrix(r.origin, h.yaw, 1, r.pitch);
      const point = matrixPoints(predicted, ['head'], 0)[0]!.point;
      const ray = makeRay(eye, normalize({ x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z }));
      const actual = buildHvhMatrix(r.origin, r.eyeYaw + phase * maximumBodyDelta(0, 0, true), 1, r.pitch);
      const hit = !!rayHvhMatrix(ray, actual, 100, ['head']); if (hit) hits++;
      resolver.feedback(2, h.source, hit ? 'HIT' : 'RESOLVER', r.t, true, r.t);
    }
    assert.ok(hits >= 80, `only ${hits}/88 diagnostic head rays hit`);
  }
});
it('safe head shots become available on strong public moving cues while uncertain standing heads remain protected', () => {
  const r = { ...record(100), speed: 2, lowerBodyYaw: 0.65 }, resolver = new ResolverSystem(); resolver.observe(r);
  const input = { now: 120, eye: { x: 0, y: 1.3, z: 10 }, w: hvhWeapon(WEAPONS.rifle), speed: 0, airborne: false, ads: false,
    world: new CollisionWorld(100), records: [r], resolver, settings: { ...DEFAULT_RAGE, hitchance: 0.75, forceSafe: true, groups: ['head'] as const } };
  const resolved = scanRage({ ...input, settings: { ...input.settings, groups: ['head'] } });
  assert.ok(resolved); assert.equal(resolved.group, 'head'); assert.equal(resolved.safety, 1);
  assert.ok(rayHvhMatrix(makeRay(input.eye, resolved.direction), buildHvhMatrix(r.origin, r.lowerBodyYaw), 100)?.headshot);
  const still = { ...r, t: 450, speed: 0 }; resolver.observe(still);
  assert.equal(scanRage({ ...input, now: 450, records: [still], settings: { ...input.settings, groups: ['head'] } }), null);
});
