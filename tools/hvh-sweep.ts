/*
 * HvH v2 balance sweep (Task 14).
 *
 *   npm run sweep          full grid: AA base {backward, left, right, spin} x jitter {0, 30, 45}
 *                          x exploit {none, dt, hs, fakelag14, defensive} = 60 configs, 1,770 pairs
 *   npm run sweep:quick    the 12-config QUICK_GRID with --check (CI: exit code 1 unless ok)
 *
 *   flags: --quick  --rounds N  --seed N  --hs N  --def N  --recharge N  --json PATH
 *          --model charged|spawn  --oracle  --check
 *   (--hs / --def / --recharge override the three tunable LATE_CSGO values for this run only,
 *   so tuning can be explored without editing era.ts. --oracle is a control: the aimbot knows the
 *   real desync side. --check sets exit code 1 when checkBalance is not ok.)
 *
 * Balance rule (plan, binding): no config wins more than 55% against the field, and every config
 * has a counter that beats it by at least 55%. R40: a config's field win rate is its mean win
 * rate over every other config (mirror matches excluded); dominant if that is > 0.55; it has a
 * counter if some other config beats it head-to-head with a rate >= 0.55.
 *
 * One round (the match design):
 * - A 1v1 duel in a real HvhRoom (hvhEngine 'v2', map 'flat', no cover between the spawns) built
 *   with the Task 13 harness (server/test/hvh-v2/hvhMatch.ts makeMatch, prng, clock), driven
 *   through the room's real command path (handleInput -> queue -> processPlayerTick).
 * - Both players: rifle (the default loadout's first gun), desync 58 (the era maximum), AA base
 *   and jitter from their config, inverter a seeded coin per round. Spawns 15 units apart at fixed
 *   points; sides swap every round; spawn protection removed.
 * - The same script for both: strafe left / right / stand in seeded spells, aim at the opponent's
 *   head and fire as soon as the rifle's fire interval allows (reload when empty). The aimbot sees
 *   only what a client sees: the opponent's newest lag record position, duck, eye yaw and pitch
 *   (the snapshot), the observation feed (speed), whether that record is an on-shot record (shots
 *   are public), and its own resolver (peekResolve on the shooter's server-side memory, which
 *   learns from its own verdicts). It aims at the head of the pose that resolver guesses, with
 *   max desync for the observed speed (0 on an on-shot record), plus seeded aim noise, and tags
 *   the command with clientTick = that record's tick. It never reads bodyYaw or realSide.
 * - Exploits (the config's `exploit`): none = plain fire; dt = every shot asks for double tap;
 *   hs = every shot asks for hide shots; fakelag14 = every non-firing command is choked (held and
 *   sent in one batch, the client's CommandChoker) up to 14, a shot sends at once;
 *   defensive = a defensive shift whenever the bank covers it. An uncharged request falls back to
 *   a plain shot (the room's tickbase reject).
 * - Models (R42). 'charged' (the primary model, the default): after the spawn both players hold,
 *   out of the engagement, for rechargeDelayTicks + doubleTapShift ticks, sending ordinary
 *   commands through the real command path (strafing; no fire, no DT / HS / defensive; fakelag
 *   keeps choking, as it is always on), so banks fill naturally; then they engage. HvH has
 *   wallhack (everyone sees everyone), so "out of sight" means out of the fight: nobody aims or
 *   fires during the hold. 'spawn' (secondary): the fight starts at the life's first tick.
 * - A round ends when a player dies (the survivor wins) or after ROUND_TICKS of engagement (a
 *   draw, 0.5 each).
 * - A cell (config pair) plays roundsPerCell rounds in two rooms: half with config A joined first,
 *   half with B first (the room simulates players in join order). Lives within a room keep the
 *   resolver memory (the room keeps it across respawns), as in a real match.
 *
 * Determinism: every random choice comes from mulberry32 seeded from (seed, pair, order); the
 * room is seeded and driven on the harness clock. Same seed -> same WinMatrix.
 */
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { SIM_DT, WEAPONS, buildHvhMatrix, eyeHeightOf, hopMaxFor, moveSpeedFor, stepPlayer, type InputFrame, type Vec3 } from '@game/shared';
import {
  LATE_CSGO, fireIntervalTicks, lagCompWindowTicks, maxDesync, peekResolve, validateEra,
  type CommandIntent, type EraTable, type LagRecord, type ShotVerdict, type VerdictCause,
} from '@game/shared/hvh/v2';
import type { HvhRoom } from '../server/src/rooms/HvhRoom';
import type { ServerPlayer } from '../server/src/rooms/ServerPlayer';
import { stepRoom } from '../server/test/helpers';
import { CLOCK_BASE, TICK_MS, makeMatch, prng } from '../server/test/hvh-v2/hvhMatch';

export type AABase = 'backward' | 'left' | 'right' | 'spin';
export type Exploit = 'none' | 'dt' | 'hs' | 'fakelag14' | 'defensive';
export interface SweepConfig { base: AABase; jitter: number; exploit: Exploit }
/** The list of configs to sweep (every unordered pair of distinct configs is a cell). */
export type SweepGrid = readonly SweepConfig[];

/**
 * rate[i][j]: config i's win rate against config j (draws count half); rate[j][i] = 1 - rate[i][j].
 * The diagonal (mirror matches) is not played and holds NaN. rounds[i][j]: rounds played.
 */
export interface WinMatrix { configs: string[]; rate: number[][]; rounds: number[][] }

export const BASES: readonly AABase[] = ['backward', 'left', 'right', 'spin'];
export const JITTERS: readonly number[] = [0, 30, 45];
export const EXPLOITS: readonly Exploit[] = ['none', 'dt', 'hs', 'fakelag14', 'defensive'];

export const FULL_GRID: SweepGrid = BASES.flatMap((base) => JITTERS.flatMap((jitter) => EXPLOITS.map((exploit) => ({ base, jitter, exploit }))));

/**
 * The 12-config CI subset: every exploit on a static backward AA and on a 45-degree jitter spin
 * (the two AA extremes), plus left and right bases at 30 jitter (every base and jitter value occurs).
 */
export const QUICK_GRID: SweepGrid = [
  ...EXPLOITS.map((exploit) => ({ base: 'backward' as const, jitter: 0, exploit })),
  ...EXPLOITS.map((exploit) => ({ base: 'spin' as const, jitter: 45, exploit })),
  { base: 'left', jitter: 30, exploit: 'none' },
  { base: 'right', jitter: 30, exploit: 'dt' },
];

export const configName = (c: SweepConfig): string => `${c.base}/j${c.jitter}/${c.exploit}`;

/** Thresholds of the balance rule. EPS absorbs float noise in rates such as (0.45 + 0.65) / 2. */
export const DOMINANT_ABOVE = 0.55;
export const COUNTER_AT_LEAST = 0.55;
const EPS = 1e-9;

export function fieldRate(m: WinMatrix, i: number): number {
  let sum = 0;
  let n = 0;
  for (let j = 0; j < m.configs.length; j++) {
    if (j === i) continue;
    sum += m.rate[i]![j]!;
    n++;
  }
  return n === 0 ? 0.5 : sum / n;
}

/** The best head-to-head rate any other config gets against config i. */
export function bestCounter(m: WinMatrix, i: number): { j: number; rate: number } {
  let best = { j: -1, rate: -Infinity };
  for (let j = 0; j < m.configs.length; j++) {
    if (j !== i && m.rate[j]![i]! > best.rate) best = { j, rate: m.rate[j]![i]! };
  }
  return best;
}

export function checkBalance(m: WinMatrix): { ok: boolean; dominant: string[]; uncountered: string[] } {
  const dominant: string[] = [];
  const uncountered: string[] = [];
  m.configs.forEach((name, i) => {
    if (fieldRate(m, i) > DOMINANT_ABOVE + EPS) dominant.push(name);
    if (!(bestCounter(m, i).rate >= COUNTER_AT_LEAST - EPS)) uncountered.push(name);
  });
  return { ok: dominant.length === 0 && uncountered.length === 0, dominant, uncountered };
}

/** Standard error of rate[i][j] (binomial, draws counted as half a win). */
export function cellSE(m: WinMatrix, i: number, j: number): number {
  const r = m.rate[i]![j]!;
  const n = m.rounds[i]![j]!;
  return n > 0 ? Math.sqrt((r * (1 - r)) / n) : Number.NaN;
}

/** Standard error of config i's field rate (independent cells). */
export function fieldSE(m: WinMatrix, i: number): number {
  let sq = 0;
  let n = 0;
  for (let j = 0; j < m.configs.length; j++) {
    if (j === i) continue;
    sq += cellSE(m, i, j) ** 2;
    n++;
  }
  return n === 0 ? 0 : Math.sqrt(sq) / n;
}

/**
 * For the report (checkBalance keeps the strict rule): a config is countered when its best
 * counter is >= 0.55 + 1 SE, uncountered when it is < 0.55 - 1 SE, otherwise inconclusive.
 */
export function classifyCounters(m: WinMatrix): { countered: string[]; uncountered: string[]; inconclusive: string[] } {
  const out = { countered: [] as string[], uncountered: [] as string[], inconclusive: [] as string[] };
  m.configs.forEach((name, i) => {
    const best = bestCounter(m, i);
    const se = cellSE(m, best.j, i);
    if (best.rate >= COUNTER_AT_LEAST + se) out.countered.push(name);
    else if (best.rate < COUNTER_AT_LEAST - se) out.uncountered.push(name);
    else out.inconclusive.push(name);
  });
  return out;
}

/** Triples of configs that form a cycle of head-to-head wins, each >= `at` (a rock-paper-scissors). */
export function threeCycles(m: WinMatrix, at = COUNTER_AT_LEAST): number {
  const n = m.configs.length;
  const beats = (a: number, b: number): boolean => m.rate[a]![b]! >= at - EPS;
  let k = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        if ((beats(a, b) && beats(b, c) && beats(c, a)) || (beats(b, a) && beats(c, b) && beats(a, c))) k++;
      }
    }
  }
  return k;
}

// ---------------------------------------------------------------------------
// Duels
// ---------------------------------------------------------------------------

export const ROUND_TICKS = 640;
const SPAWN_X = 20;
const SPAWN_Z = [12.5, 27.5] as const;
const DESYNC_DEG = 58;
/** Aim noise, radians (uniform, per axis): the same aim skill for everyone. */
const AIM_NOISE = 0.01;
const WEAPON = 'rifle' as const;
const IDLE: CommandIntent = Object.freeze({ fire: false, choke: false, doubleTap: false, hideShots: false, defensive: false });

/** Per-shooter-config verdict counts and round outcomes (for the report). */
export interface SweepStats {
  causes: Map<string, Map<VerdictCause | string, number>>;
  rounds: number;
  draws: number;
  roundTicks: number;
}

export function createStats(): SweepStats {
  return { causes: new Map(), rounds: 0, draws: 0, roundTicks: 0 };
}

export type SweepModel = 'charged' | 'spawn';

export interface SweepOptions {
  /** Overrides the room's era (tunable exploration). Defaults to LATE_CSGO. */
  era?: EraTable;
  stats?: SweepStats;
  /** 'charged' (default, R42 primary model) or 'spawn' (fight from the life's first tick). */
  model?: SweepModel;
  /** Control only: the aimbot knows the target's real pose (never used for balance results). */
  oracle?: boolean;
  onCell?: (done: number, total: number) => void;
}

function mix(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  }
  return h >>> 0;
}

interface Bot {
  config: SweepConfig;
  p: ServerPlayer;
  rand: () => number;
  seq: number;
  held: object[];
  strafe: number;
  strafeLeft: number;
  /** The AA inverter, a seeded coin per round. */
  invert: boolean;
}

/** Ticks at which each player's newest record is an on-shot record (a shot was fired that tick). */
type ShotTicks = Map<number, Set<number>>;

/**
 * The bot's own eye when its next command runs: client prediction of its movement through the
 * commands it still holds (choke) and the next one (the room moves before it fires).
 */
function predictedEye(room: HvhRoom, bot: Bot, next: InputFrame): Vec3 {
  const p = bot.p;
  const state = structuredClone(p.state);
  for (const frame of [...(bot.held as InputFrame[]), next]) {
    stepPlayer(state, frame, SIM_DT, room.world, p.moveMods(), hopMaxFor(WEAPON), moveSpeedFor(WEAPON), true);
  }
  return { x: state.x, y: state.y + eyeHeightOf(state), z: state.z };
}

function aimAt(room: HvhRoom, bot: Bot, eye: Vec3, enemy: ServerPlayer, shotTicks: ShotTicks, era: EraTable, tick: number, oracle: boolean):
  { yaw: number; pitch: number; clientTick: number } | null {
  const t = room.v2State(enemy.pid)!;
  const record: LagRecord | undefined = t.history.records().at(-1);
  // A client knows how old its newest snapshot of the enemy is; it holds fire past the unlag window.
  if (!record || tick - record.tick > lagCompWindowTicks(era)) return null;
  const obs = t.observations.find((o) => o.tick === record.tick);
  const onShot = shotTicks.get(enemy.pid)?.has(record.tick) ?? false;
  const side = peekResolve(room.v2State(bot.p.pid)!.resolver, String(enemy.pid), t.observations, record.tick).side;
  const magnitude = onShot ? 0 : Math.min(DESYNC_DEG, maxDesync(obs?.speedFraction ?? 0, era));
  const sign = side === 'left' ? 1 : side === 'right' ? -1 : 0;
  // The oracle control reads the real body (a cheat that always resolves correctly).
  const bodyYaw = oracle ? record.pose.bodyYaw : record.pose.eyeYaw + (magnitude * sign * Math.PI) / 180;
  const duck = record.duck ?? 0;
  const head: Vec3 = buildHvhMatrix(record.position, bodyYaw, 1 - duck * 0.3, record.pose.pitch).boxes[0]!.center;
  const dx = head.x - eye.x;
  const dy = head.y - eye.y;
  const dz = head.z - eye.z;
  const yaw = Math.atan2(-dx, -dz) + (bot.rand() * 2 - 1) * AIM_NOISE;
  const pitch = Math.asin(dy / Math.hypot(dx, dy, dz)) + (bot.rand() * 2 - 1) * AIM_NOISE;
  return { yaw, pitch, clientTick: record.tick };
}

/** `engaged` false: the R42 hold (no aim, no fire, no DT / HS / defensive; fakelag still chokes). */
function botCommand(room: HvhRoom, bot: Bot, enemy: ServerPlayer, shotTicks: ShotTicks, era: EraTable, tick: number, now: number,
  engaged: boolean, oracle: boolean): void {
  const { p, config, rand } = bot;
  const s = room.v2State(p.pid)!;
  if (bot.strafeLeft-- <= 0) {
    bot.strafeLeft = 16 + Math.floor(rand() * 32);
    bot.strafe = [-1, 0, 1][Math.floor(rand() * 3)]!;
  }
  // Movement first (the strafe is relative to the yaw toward the enemy), then the aim from the predicted eye.
  const towards = Math.atan2(-(enemy.state.x - p.state.x), -(enemy.state.z - p.state.z));
  const move: InputFrame = { seq: bot.seq + 1, forward: 0, right: bot.strafe, jump: false, crouch: false, yaw: towards, pitch: 0 };
  const aim = engaged ? aimAt(room, bot, predictedEye(room, bot, move), enemy, shotTicks, era, tick, oracle) : null;
  if (p.mag <= 0) room.handleReload(p, now);
  // Readiness (R41): server ticks since the bot's own last shot, at the tick this command runs.
  const ready = p.reloadUntil === 0 && p.mag > 0 && tick - s.lastShotTick >= fireIntervalTicks(WEAPONS[WEAPON]);
  const fire = aim !== null && ready && enemy.alive;
  const intent: CommandIntent = { ...IDLE, fire };
  if (fire && config.exploit === 'dt') intent.doubleTap = true;
  if (fire && config.exploit === 'hs') intent.hideShots = true;
  if (engaged && config.exploit === 'defensive' && bot.held.length === 0 && s.tickbase.choked === 0 && s.tickbase.bank >= era.defensiveShift) intent.defensive = true;
  if (config.exploit === 'fakelag14' && !fire && bot.held.length < era.maxChoke) intent.choke = true;
  const yaw = aim?.yaw ?? towards;
  const frame: InputFrame & { intent: CommandIntent; clientTick?: number } = {
    seq: ++bot.seq, forward: 0, right: bot.strafe, jump: false, crouch: false, yaw, pitch: aim?.pitch ?? 0,
    invert: bot.invert, intent,
  };
  if (aim) frame.clientTick = aim.clientTick;
  bot.held.push(frame);
  if (intent.choke) return;
  for (const command of bot.held.splice(0)) room.handleInput(p, command);
}

function count(stats: SweepStats | undefined, config: string, cause: string): void {
  if (!stats) return;
  let m = stats.causes.get(config);
  if (!m) stats.causes.set(config, (m = new Map()));
  m.set(cause, (m.get(cause) ?? 0) + 1);
}

/** Plays `rounds` duels between configs a (joined first) and b; returns a's score (wins + draws / 2). */
function playRoom(a: SweepConfig, b: SweepConfig, rounds: number, seed: number, era: EraTable, opts: SweepOptions): number {
  const stats = opts.stats;
  const oracle = opts.oracle === true;
  const { room, players } = makeMatch(seed, { map: 'flat', teams: [1, 2] });
  try {
    if (era !== room.era) Object.defineProperty(room, 'era', { value: era });
    const rand = prng(seed);
    const bots: Bot[] = [a, b].map((config, i) => ({
      config, p: players[i]!, rand: prng(mix(seed, i + 1)), seq: 0, held: [], strafe: 0, strafeLeft: 0, invert: false,
    }));
    const names = [configName(a), configName(b)];
    const shotTicks: ShotTicks = new Map(players.map((p) => [p.pid, new Set<number>()]));
    room.addVerdictListener((v: ShotVerdict) => {
      const i = bots.findIndex((x) => String(x.p.pid) === v.shooterId);
      if (i < 0) return;
      count(stats, names[i]!, v.cause === 'rejected' || v.cause === 'tickbase' ? `${v.cause}:${v.reason}` : v.cause);
      if (v.cause !== 'rejected') shotTicks.get(bots[i]!.p.pid)!.add(v.tick);
    });
    const match = (room as unknown as { match: { teamScores: number[]; endsAt: number | null } }).match;
    let tick = 0;
    let score = 0;
    for (let r = 0; r < rounds; r++) {
      const now0 = CLOCK_BASE + tick * TICK_MS;
      match.teamScores = [0, 0];
      match.endsAt = null;
      bots.forEach((bot, i) => {
        const p = bot.p;
        p.hvh.antiAim = { ...p.hvh.antiAim, enabled: true, mode: bot.config.base, jitter: bot.config.jitter, desync: DESYNC_DEG };
        bot.invert = rand() < 0.5;
        room.respawnPlayer(p, now0);
        const z = SPAWN_Z[(i + r) % 2]!;
        p.state.x = SPAWN_X;
        p.state.z = z;
        p.state.y = 0;
        p.state.onGround = true;
        p.shieldUntil = 0;
        p.mags.set(WEAPON, p.magazineSize(WEAPON));
        bot.held.length = 0;
        bot.strafeLeft = 0;
      });
      // R42 'charged': hold until banks fill through ordinary commands (no state writes).
      const hold = (opts.model ?? 'charged') === 'charged' ? era.rechargeDelayTicks + era.doubleTapShift : 0;
      for (let h = 0; h < hold; h++) {
        tick++;
        const now = CLOCK_BASE + tick * TICK_MS;
        bots.forEach((bot, i) => botCommand(room, bot, bots[1 - i]!.p, shotTicks, era, room.hvhTick + 1, now, false, oracle));
        stepRoom(room, now);
      }
      let t = 0;
      for (; t < ROUND_TICKS; t++) {
        tick++;
        const now = CLOCK_BASE + tick * TICK_MS;
        bots.forEach((bot, i) => {
          if (bot.p.alive) botCommand(room, bot, bots[1 - i]!.p, shotTicks, era, room.hvhTick + 1, now, true, oracle);
        });
        stepRoom(room, now);
        if (!bots[0]!.p.alive || !bots[1]!.p.alive) break;
      }
      const aAlive = bots[0]!.p.alive;
      const bAlive = bots[1]!.p.alive;
      const result = aAlive && !bAlive ? 1 : bAlive && !aAlive ? 0 : 0.5;
      score += result;
      if (stats) {
        stats.rounds++;
        stats.roundTicks += t + 1;
        if (result === 0.5) stats.draws++;
      }
    }
    return score;
  } finally {
    room.close();
  }
}

export function runSweep(grid: SweepGrid, roundsPerCell: number, seed: number, opts: SweepOptions = {}): WinMatrix {
  const era = opts.era ?? LATE_CSGO;
  const errors = validateEra(era);
  if (errors.length > 0) throw new Error(`invalid era: ${errors.join(', ')}`);
  const n = grid.length;
  const configs = grid.map(configName);
  const rate = configs.map(() => configs.map(() => Number.NaN));
  const rounds = configs.map(() => configs.map(() => 0));
  const total = (n * (n - 1)) / 2;
  let done = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const first = Math.ceil(roundsPerCell / 2);
      const second = roundsPerCell - first;
      let iScore = playRoom(grid[i]!, grid[j]!, first, mix(seed, i, j, 0), era, opts);
      if (second > 0) iScore += second - playRoom(grid[j]!, grid[i]!, second, mix(seed, i, j, 1), era, opts);
      rate[i]![j] = iScore / roundsPerCell;
      rate[j]![i] = 1 - rate[i]![j]!;
      rounds[i]![j] = rounds[j]![i] = roundsPerCell;
      opts.onCell?.(++done, total);
    }
  }
  return { configs, rate, rounds };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_ROUNDS = { full: 400, quick: 100 };
const DEFAULT_SEED = 0x14;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function num(args: string[], name: string): number | undefined {
  const v = flag(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} needs a number`);
  return n;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pm = (x: number, se: number): string => `${pct(x)} +-${(se * 100).toFixed(1)}`;

/** Mean field rate of the configs with base b and exploit x. */
function baseByExploit(m: WinMatrix, grid: SweepGrid): string[] {
  const exploits = EXPLOITS.filter((x) => grid.some((c) => c.exploit === x));
  const lines = ['base x exploit (mean field rate)', `${''.padEnd(10)}${exploits.map((x) => x.padStart(11)).join('')}${'all'.padStart(11)}`];
  for (const b of BASES) {
    const cell = (x?: Exploit): string => {
      const idx = grid.map((c, i) => [c, i] as const).filter(([c]) => c.base === b && (x === undefined || c.exploit === x)).map(([, i]) => fieldRate(m, i));
      return (idx.length ? pct(idx.reduce((a, v) => a + v, 0) / idx.length) : '-').padStart(11);
    };
    if (grid.some((c) => c.base === b)) lines.push(`${b.padEnd(10)}${exploits.map((x) => cell(x)).join('')}${cell()}`);
  }
  return lines;
}

/** Mean rate of configs with exploit x over configs with exploit y (pairs of distinct configs). */
function byExploit(m: WinMatrix, grid: SweepGrid): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of EXPLOITS) {
    for (const y of EXPLOITS) {
      let sum = 0;
      let k = 0;
      grid.forEach((ci, i) => grid.forEach((cj, j) => {
        if (i !== j && ci.exploit === x && cj.exploit === y) { sum += m.rate[i]![j]!; k++; }
      }));
      if (k > 0) out.set(`${x}>${y}`, sum / k);
    }
  }
  return out;
}

export function summarize(m: WinMatrix, grid: SweepGrid): string {
  const lines: string[] = [];
  const cls = classifyCounters(m);
  const classOf = (name: string): string => (cls.countered.includes(name) ? 'countered' : cls.uncountered.includes(name) ? 'UNCOUNTERED' : 'inconclusive');
  const rows = m.configs.map((name, i) => {
    const counter = bestCounter(m, i);
    return { name, field: fieldRate(m, i), fieldSE: fieldSE(m, i), counter, counterSE: cellSE(m, counter.j, i) };
  });
  rows.sort((x, y) => y.field - x.field);
  lines.push('config                     field +-SE     best counter (rate +-SE, class)');
  for (const r of rows) {
    lines.push(`${r.name.padEnd(26)} ${pm(r.field, r.fieldSE).padStart(12)}   ${m.configs[r.counter.j] ?? '-'} ${pm(r.counter.rate, r.counterSE)} ${classOf(r.name)}`);
  }
  lines.push('', ...baseByExploit(m, grid));
  const ex = byExploit(m, grid);
  const present = EXPLOITS.filter((x) => grid.some((c) => c.exploit === x));
  lines.push('', `exploit vs exploit (row's mean win rate)`, `${''.padEnd(10)}${present.map((y) => y.padStart(10)).join('')}`);
  for (const x of present) lines.push(`${x.padEnd(10)}${present.map((y) => (ex.has(`${x}>${y}`) ? pct(ex.get(`${x}>${y}`)!) : '-').padStart(10)).join('')}`);
  const fields = rows.map((r) => r.field);
  lines.push('', `field rate: max ${pct(Math.max(...fields))}, min ${pct(Math.min(...fields))}`);
  const n = m.configs.length;
  let edges = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && m.rate[i]![j]! >= COUNTER_AT_LEAST - EPS) edges++;
  lines.push(`head-to-head wins >= 55%: ${edges} of ${(n * (n - 1)) / 2} pairs; 3-cycles at >= 55%: ${threeCycles(m)} of ${(n * (n - 1) * (n - 2)) / 6} triples`);
  lines.push(`counters (+-1 SE): countered ${cls.countered.length}, uncountered ${cls.uncountered.length}, inconclusive ${cls.inconclusive.length}`);
  lines.push(`  uncountered: ${cls.uncountered.join(', ') || '-'}`, `  inconclusive: ${cls.inconclusive.join(', ') || '-'}`);
  return lines.join('\n');
}

function main(argv: string[]): void {
  const quick = argv.includes('--quick');
  const grid = quick ? QUICK_GRID : FULL_GRID;
  const rounds = num(argv, '--rounds') ?? (quick ? DEFAULT_ROUNDS.quick : DEFAULT_ROUNDS.full);
  const seed = num(argv, '--seed') ?? DEFAULT_SEED;
  const modelFlag = flag(argv, '--model') ?? 'charged';
  if (modelFlag !== 'charged' && modelFlag !== 'spawn') throw new Error('--model is charged or spawn');
  const model: SweepModel = modelFlag;
  const oracle = argv.includes('--oracle');
  const era: EraTable = {
    ...LATE_CSGO,
    hideShotsShift: num(argv, '--hs') ?? LATE_CSGO.hideShotsShift,
    defensiveShift: num(argv, '--def') ?? LATE_CSGO.defensiveShift,
    rechargeDelayTicks: num(argv, '--recharge') ?? LATE_CSGO.rechargeDelayTicks,
  };
  const stats = createStats();
  const started = performance.now();
  let lastPrint = 0;
  const m = runSweep(grid, rounds, seed, {
    era, stats, model, oracle,
    onCell(done, total) {
      const t = performance.now();
      if (t - lastPrint > 5000) { lastPrint = t; process.stderr.write(`  ${done}/${total} cells, ${((t - started) / 1000).toFixed(0)} s\n`); }
    },
  });
  const seconds = (performance.now() - started) / 1000;
  const balance = checkBalance(m);
  console.log(`HvH v2 balance sweep: ${quick ? 'quick' : 'full'} grid, ${grid.length} configs, ${rounds} rounds per cell, seed ${seed}, model ${model}${oracle ? ' (ORACLE resolver control)' : ''}`);
  console.log(`era tunables: hideShotsShift ${era.hideShotsShift}, defensiveShift ${era.defensiveShift}, rechargeDelayTicks ${era.rechargeDelayTicks}`);
  console.log(`rounds ${stats.rounds}, draws ${pct(stats.draws / stats.rounds)}, mean engagement ${(stats.roundTicks / stats.rounds).toFixed(1)} ticks, runtime ${seconds.toFixed(1)} s`);
  console.log('');
  console.log(summarize(m, grid));
  const causes = new Map<string, Map<string, number>>();
  for (const [name, byCause] of stats.causes) {
    const x = name.split('/')[2]!;
    let agg = causes.get(x);
    if (!agg) causes.set(x, (agg = new Map()));
    for (const [c, k] of byCause) agg.set(c, (agg.get(c) ?? 0) + k);
  }
  console.log('', 'verdicts by shooter exploit:');
  for (const [x, agg] of causes) {
    const total = [...agg.values()].reduce((s, k) => s + k, 0);
    console.log(`  ${x.padEnd(10)} ${[...agg].sort((p, q) => q[1] - p[1]).map(([c, k]) => `${c} ${pct(k / total)}`).join(', ')}`);
  }
  console.log('', `checkBalance: ${JSON.stringify(balance)}`);
  const out = flag(argv, '--json');
  if (out) writeFileSync(out, JSON.stringify({ era, rounds, seed, model, oracle, seconds, matrix: m, balance }, null, 1));
  if (argv.includes('--check') && !balance.ok) {
    console.log('--check: checkBalance is not ok (exit code 1)');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
