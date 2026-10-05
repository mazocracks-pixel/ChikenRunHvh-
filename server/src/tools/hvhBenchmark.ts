import { buildHvhMatrix, rayHvhMatrix, matrixPoints, makeRay, normalize, maximumBodyDelta, ResolverSystem,
  ExploitResource, pelletDirections, hvhWeapon, hvhSpread, damageAt, WEAPONS, SIM_DT, NetworkSimulator, type ObservableRecord, type Vec3 } from '@game/shared';

export interface DuelMetrics { duels: number; wins: number; shots: number; hits: number; resolverMisses: number; spreadMisses: number; headshots: number; totalTicks: number; dtShots: number; accuracy: number; averageKillSeconds: number }
interface Fighter { hp: number; resource: ExploitResource; resolver: ResolverSystem; stats: DuelMetrics; heat: number; lastAttack: number }
const metrics = (): DuelMetrics => ({ duels: 0, wins: 0, shots: 0, hits: 0, resolverMisses: 0, spreadMisses: 0, headshots: 0, totalTicks: 0, dtShots: 0, accuracy: 0, averageKillSeconds: 0 });

/** Deterministic adversarial duels: two independent controllers, actual rays, timers, charge and delayed observations. */
export function runHvhBenchmark(count = 1000, seed = 7042): { seed: number; duels: number; adaptive: DuelMetrics; centerOnly: DuelMetrics } {
  const totals = [metrics(), metrics()];
  const weapon = hvhWeapon(WEAPONS.rifle);
  let rng = seed >>> 0;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 0x100000000; };
  for (let duel = 0; duel < count; duel++) {
    const distance = 10 + random() * 16;
    const origins: Vec3[] = [{ x: 0, y: 0, z: distance / 2 }, { x: 0, y: 0, z: -distance / 2 }];
    const sides = [random() < 0.5 ? -1 : 1, random() < 0.5 ? -1 : 1];
    const fighters: Fighter[] = totals.map(stats => ({ hp: 100, resource: new ExploitResource(), resolver: new ResolverSystem(), stats, heat: 0, lastAttack: -100 }));
    for (const f of fighters) for (let warmup = 0; warmup < 256; warmup++) f.resource.step(warmup, false, false);
    const network = fighters.map((_, i) => new NetworkSimulator<ObservableRecord>({ latencyMs: 35, jitterMs: 12, loss: 0.02 }, seed + duel * 2 + i));
    let finished = false;
    for (let tick = 0; tick < 640 && !finished; tick++) {
      const now = tick * SIM_DT * 1000;
      const yaw = [Math.PI, 0];
      for (let turn = 0; turn < 2; turn++) {
        const i = (turn + duel) % 2;
        const enemy = 1 - i;
        if (tick % 4 === 0) network[i]!.send({ pid: enemy, tick, t: now, origin: origins[enemy]!, velocity: { x: 0, y: 0, z: 0 },
          eyeYaw: yaw[enemy]!, lowerBodyYaw: yaw[enemy]!, speed: 0, crouch: 0, grounded: true, turnWeight: 0, alive: true,
          hp: fighters[enemy]!.hp, armor: 0, fired: false, concealed: false, defensive: false }, now);
        for (const record of network[i]!.receive(now)) fighters[i]!.resolver.observe(record);
        const f = fighters[i]!; f.resource.step(tick + 256, tick - f.lastAttack < 16, false); f.heat = Math.max(0, f.heat - SIM_DT * 1.5);
        const record = f.resolver.records(enemy, now)[0]; if (!record) continue;
        const resolution = f.resolver.resolve(record, i === 0);
        const h = resolution.hypotheses[0]!;
        const predicted = buildHvhMatrix(record.origin, h.yaw), point = matrixPoints(predicted, ['head'], 0)[0]!.point;
        const eye = { ...origins[i]!, y: 1.3 }, direction = normalize({ x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z });
        const permission = f.resource.fire(weapon.fireInterval, 'doubleTap', tick + 256); if (!permission.shots) continue;
        f.lastAttack = tick;
        const actual = buildHvhMatrix(origins[enemy]!, yaw[enemy]! + sides[enemy]! * maximumBodyDelta(0, 0, true));
        const perfect = rayHvhMatrix(makeRay(eye, direction), actual, 100, ['head']);
        for (let shot = 0; shot < permission.shots; shot++) {
          f.stats.shots++; if (permission.shots === 2) f.stats.dtShots++;
          const dir = pelletDirections(weapon, direction, hvhSpread(weapon, 0, false, false, f.heat), Math.floor(random() * 0x7fffffff))[0]!;
          const hit = rayHvhMatrix(makeRay(eye, dir), actual, 100, ['head']);
          if (hit) { f.stats.hits++; f.stats.headshots++; fighters[enemy]!.hp -= damageAt(weapon, hit.t) * weapon.headshotMultiplier;
            f.resolver.feedback(enemy, h.source, 'HIT', now); }
          else if (!perfect) { f.stats.resolverMisses++; f.resolver.feedback(enemy, h.source, 'RESOLVER', now); }
          else f.stats.spreadMisses++;
        }
        f.heat = Math.min(3, f.heat + 0.25 * permission.shots);
        if (fighters[enemy]!.hp <= 0) { f.stats.wins++; f.stats.totalTicks += tick; finished = true; break; }
        // Reaction uses the visible incoming ray, not the shooter's chosen resolver hypothesis.
        if (random() < 0.18) sides[enemy] = -sides[enemy]!;
      }
    }
    totals.forEach(s => s.duels++);
  }
  totals.forEach(s => { s.accuracy = s.shots ? s.hits / s.shots : 0; s.averageKillSeconds = s.wins ? s.totalTicks * SIM_DT / s.wins : 0; });
  return { seed, duels: count, adaptive: totals[0]!, centerOnly: totals[1]! };
}
