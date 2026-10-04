import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_LOADOUT,
  LOADOUT_SIZE,
  sanitizeAppearance,
  sanitizeLoadout,
  type Appearance,
  MODES,
  RANKED,
  applyRankPoints,
  levelFor,
  type LeaderboardRow,
  type ModeId,
  type Profile,
  type WeaponId,
} from '@game/shared';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from '../auth';

export type { LeaderboardRow, Profile };

export interface MatchRecord {
  userId: number;
  kills: number;
  deaths: number;
  won: boolean;
  coins: number;
  /** Change in rank points (FaceChiken; 0 elsewhere). */
  xp: number;
}

/** What a user has after a match is saved. */
export interface MatchTotals {
  coins: number;
  xp: number;
  /** Coins paid for reaching new levels (already in `coins`). */
  levelCoins: number;
}

interface UserRow {
  id: number;
  username: string | null;
  password_hash: string | null;
  name: string;
  coins: number;
  appearance: string;
  loadout: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
  developer: number;
  xp: number;
}

export type BuyResult = 'ok' | 'owned' | 'insufficient' | 'missing';

/** Each entry upgrades the schema by one version (tracked in PRAGMA user_version). Only append. */
const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT UNIQUE COLLATE NOCASE,
     password_hash TEXT,
     name TEXT NOT NULL,
     coins INTEGER NOT NULL DEFAULT 0,
     appearance TEXT NOT NULL DEFAULT '{}',
     loadout TEXT NOT NULL DEFAULT '[]',
     kills INTEGER NOT NULL DEFAULT 0,
     deaths INTEGER NOT NULL DEFAULT 0,
     wins INTEGER NOT NULL DEFAULT 0,
     matches INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_used INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE inventory (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     item_id TEXT NOT NULL,
     acquired_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, item_id)
   );`,
  // v2: fast expiry sweeps for sessions and old guest accounts.
  `CREATE INDEX sessions_last_used ON sessions(last_used);
   CREATE INDEX users_guest_seen ON users(last_seen) WHERE username IS NULL;`,
  // v3: developer accounts (granted only from the server command line).
  `ALTER TABLE users ADD COLUMN developer INTEGER NOT NULL DEFAULT 0;`,
  // v4: ranks (XP; existing accounts get XP for the matches they already played, at
  // 25 a match + 10 a kill + 60 a win) and stats per game mode for the mode leaderboards.
  `ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
   UPDATE users SET xp = matches * 25 + kills * 10 + wins * 60;
   CREATE TABLE mode_stats (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     mode TEXT NOT NULL,
     kills INTEGER NOT NULL DEFAULT 0,
     deaths INTEGER NOT NULL DEFAULT 0,
     wins INTEGER NOT NULL DEFAULT 0,
     matches INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, mode)
   );
   CREATE INDEX mode_stats_board ON mode_stats(mode, wins DESC, kills DESC);
   CREATE INDEX users_xp ON users(xp DESC);`,
  // v5: ranks now move only in FaceChiken (the ranked mode), so everyone starts again at level 1.
  `UPDATE users SET xp = 0;`,
  // v6: FaceChiken anti-cheat strikes (each one bans from ranked for a while).
  `CREATE TABLE ac_strikes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     reason TEXT NOT NULL,
     details TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX ac_strikes_user ON ac_strikes(user_id, created_at);`,
];

/** How long a FaceChiken ban lasts after the 1st, 2nd and 3rd+ anti-cheat strike. */
export const RANKED_BAN_MS = [24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, Number.POSITIVE_INFINITY] as const;

export interface Strike {
  id: number;
  userId: number;
  username: string | null;
  name: string;
  reason: string;
  details: string;
  createdAt: number;
}

/** Limits for session lifetime and housekeeping. */
export const DATA_RETENTION = {
  /** A session dies after this long unused... */
  sessionIdleMs: SESSION_IDLE_MS,
  /** ...or this long after it was created. */
  sessionMaxMs: SESSION_MAX_MS,
  /** Oldest sessions beyond this many per account are signed out. */
  sessionsPerUser: 10,
  /** Guest accounts (never registered) are deleted after this long unused. */
  guestIdleMs: 60 * 24 * 60 * 60 * 1000,
} as const;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** All persistent game data. Synchronous on purpose: SQLite calls take microseconds. */
export class GameDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Users and sessions
  // ---------------------------------------------------------------------------

  createUser(name: string, coins: number): number {
    const now = Date.now();
    const result = this.db
      .prepare('INSERT INTO users (name, coins, appearance, loadout, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, coins, JSON.stringify(DEFAULT_APPEARANCE), JSON.stringify(DEFAULT_LOADOUT), now, now);
    return Number(result.lastInsertRowid);
  }

  private userRow(id: number): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  findLogin(username: string): { id: number; passwordHash: string } | undefined {
    const row = this.db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username) as
      | { id: number; password_hash: string | null }
      | undefined;
    return row?.password_hash ? { id: row.id, passwordHash: row.password_hash } : undefined;
  }

/** The account id for a registered username (any case). */
  findUserId(username: string): number | undefined {
    const row = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    return row?.id;
  }

  isDeveloper(userId: number): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE id = ? AND developer = 1').get(userId) !== undefined;
  }

  /** Grants or removes developer status. Only the server command line calls this. */
  setDeveloper(userId: number, developer: boolean): void {
    this.db.prepare('UPDATE users SET developer = ? WHERE id = ?').run(developer ? 1 : 0, userId);
  }

  setCoins(userId: number, coins: number): void {
    this.db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(Math.max(0, Math.floor(coins)), userId);
  }

  developers(): { id: number; username: string | null; name: string; coins: number }[] {
    return this.db.prepare('SELECT id, username, name, coins FROM users WHERE developer = 1 ORDER BY id').all() as unknown as {
      id: number;
      username: string | null;
      name: string;
      coins: number;
    }[];
  }

  isUsernameTaken(username: string): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username) !== undefined;
  }

  /** Turns a guest into a registered account (keeps coins and items). */
  setCredentials(userId: number, username: string, passwordHash: string): void {
    this.db.prepare('UPDATE users SET username = ?, password_hash = ?, name = ? WHERE id = ?').run(username, passwordHash, username, userId);
  }

  createSession(userId: number, tokenHash: string): void {
    const now = Date.now();
    this.transaction(() => {
      this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now, now);
      // Keep only the newest few sessions per account.
      this.db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, last_used DESC LIMIT ?)')
        .run(userId, userId, DATA_RETENTION.sessionsPerUser);
    });
  }

  /** The account a session belongs to, or undefined if it doesn't exist or has expired. */
  userIdForSession(tokenHash: string): number | undefined {
    const row = this.db.prepare('SELECT user_id, created_at, last_used FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | { user_id: number; created_at: number; last_used: number }
      | undefined;
    if (!row) return undefined;
    const now = Date.now();
    if (now - row.last_used > DATA_RETENTION.sessionIdleMs || now - row.created_at > DATA_RETENTION.sessionMaxMs) {
      this.deleteSession(tokenHash);
      return undefined;
    }
    // Writing on every request is wasteful; a minute of precision is plenty.
    if (now - row.last_used > 60_000) {
      this.db.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now, tokenHash);
      this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, row.user_id);
    }
    return row.user_id;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /** Signs an account out everywhere (optionally keeping one session). */
  deleteSessionsForUser(userId: number, keepTokenHash?: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keepTokenHash ?? '');
  }

  passwordHash(userId: number): string | null {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string | null } | undefined;
    return row?.password_hash ?? null;
  }

  setPasswordHash(userId: number, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
  }

  /** Deletes an account and everything attached to it (sessions, items). */
  deleteUser(userId: number): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  /** Removes expired sessions and long-unused guest accounts. Returns how many of each went. */
  cleanup(now = Date.now()): { sessions: number; guests: number } {
    return this.transaction(() => {
      const sessions = this.db
        .prepare('DELETE FROM sessions WHERE last_used < ? OR created_at < ?')
        .run(now - DATA_RETENTION.sessionIdleMs, now - DATA_RETENTION.sessionMaxMs).changes;
      const guests = this.db.prepare('DELETE FROM users WHERE username IS NULL AND last_seen < ?').run(now - DATA_RETENTION.guestIdleMs).changes;
      return { sessions: Number(sessions), guests: Number(guests) };
    });
  }

  // ---------------------------------------------------------------------------
  // Profile, inventory, shop
  // ---------------------------------------------------------------------------

  owned(userId: number): Set<string> {
    const rows = this.db.prepare('SELECT item_id FROM inventory WHERE user_id = ?').all(userId) as { item_id: string }[];
    return new Set(rows.map((r) => r.item_id));
  }

  profile(userId: number): Profile | undefined {
    const row = this.userRow(userId);
    if (!row) return undefined;
    const owned = this.owned(userId);
    const owns = (id: string) => owned.has(id);
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      coins: row.coins,
      appearance: sanitizeAppearance(parseJson(row.appearance), owns),
      loadout: sanitizeLoadout(parseJson(row.loadout), owns, LOADOUT_SIZE, DEFAULT_LOADOUT),
      owned: [...owned],
      stats: { kills: row.kills, deaths: row.deaths, wins: row.wins, matches: row.matches },
      xp: row.xp,
      developer: row.developer === 1,
    };
  }

  updateProfile(userId: number, changes: { name?: string; appearance?: Appearance; loadout?: WeaponId[] }): void {
    if (changes.name !== undefined) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(changes.name, userId);
    if (changes.appearance) this.db.prepare('UPDATE users SET appearance = ? WHERE id = ?').run(JSON.stringify(changes.appearance), userId);
    if (changes.loadout) this.db.prepare('UPDATE users SET loadout = ? WHERE id = ?').run(JSON.stringify(changes.loadout), userId);
  }

  /** Spends coins on an item atomically: never charges twice, never goes negative. */
  buy(userId: number, itemId: string, price: number): BuyResult {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT coins FROM users WHERE id = ?').get(userId) as { coins: number } | undefined;
      if (!row) return 'missing';
      if (this.db.prepare('SELECT 1 FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, itemId)) return 'owned';
      if (row.coins < price) return 'insufficient';
      this.db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(price, userId);
      this.db.prepare('INSERT INTO inventory (user_id, item_id, acquired_at) VALUES (?, ?, ?)').run(userId, itemId, Date.now());
      return 'ok';
    });
  }

  /**
   * Saves match results and rewards in one transaction (account totals and the stats for
   * `mode`); returns each user's new coin and XP totals.
   */
  recordMatch(records: MatchRecord[], mode: ModeId | null = null): Map<number, MatchTotals> {
    return this.transaction(() => {
      const current = this.db.prepare('SELECT coins, xp FROM users WHERE id = ?');
      const update = this.db.prepare('UPDATE users SET coins = ?, xp = ?, kills = kills + ?, deaths = deaths + ?, wins = wins + ?, matches = matches + 1 WHERE id = ?');
      const perMode = this.db.prepare(
        `INSERT INTO mode_stats (user_id, mode, kills, deaths, wins, matches) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (user_id, mode) DO UPDATE SET kills = kills + excluded.kills, deaths = deaths + excluded.deaths, wins = wins + excluded.wins, matches = matches + 1`,
      );
      const totals = new Map<number, MatchTotals>();
      for (const r of records) {
        const row = current.get(r.userId) as { coins: number; xp: number } | undefined;
        if (!row) continue;
        // Rank points never drop you below the level you've reached; each new level pays coins.
        const xp = r.xp === 0 ? row.xp : applyRankPoints(row.xp, r.xp);
        const levelCoins = Math.max(0, levelFor(xp) - levelFor(row.xp)) * RANKED.levelCoins;
        const coins = row.coins + r.coins + levelCoins;
        update.run(coins, xp, r.kills, r.deaths, r.won ? 1 : 0, r.userId);
        if (mode) perMode.run(r.userId, mode, r.kills, r.deaths, r.won ? 1 : 0);
        totals.set(r.userId, { coins, xp, levelCoins });
      }
      return totals;
    });
  }

  /** The anti-cheat caught this account in FaceChiken. */
  addStrike(userId: number, reason: string, details: Record<string, unknown>, now = Date.now()): void {
    this.db.prepare('INSERT INTO ac_strikes (user_id, reason, details, created_at) VALUES (?, ?, ?, ?)').run(userId, reason.slice(0, 200), JSON.stringify(details).slice(0, 2000), now);
  }

  /** An active FaceChiken ban, from the account's strikes: longer with every strike. */
  rankedBan(userId: number, now = Date.now()): { until: number; reason: string; strikes: number } | null {
    const rows = this.db.prepare('SELECT reason, created_at FROM ac_strikes WHERE user_id = ? ORDER BY created_at').all(userId) as { reason: string; created_at: number }[];
    if (rows.length === 0) return null;
    const last = rows[rows.length - 1]!;
    const until = last.created_at + RANKED_BAN_MS[Math.min(rows.length, RANKED_BAN_MS.length) - 1]!;
    return until > now ? { until, reason: last.reason, strikes: rows.length } : null;
  }

  /** Strikes, newest first (for one account, or everyone). */
  strikes(userId: number | null = null, limit = 50): Strike[] {
    const rows = (
      userId === null
        ? this.db.prepare('SELECT s.id, s.user_id, u.username, u.name, s.reason, s.details, s.created_at FROM ac_strikes s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT ?').all(limit)
        : this.db.prepare('SELECT s.id, s.user_id, u.username, u.name, s.reason, s.details, s.created_at FROM ac_strikes s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT ?').all(userId, limit)
    ) as { id: number; user_id: number; username: string | null; name: string; reason: string; details: string; created_at: number }[];
    return rows.map((r) => ({ id: r.id, userId: r.user_id, username: r.username, name: r.name, reason: r.reason, details: r.details, createdAt: r.created_at }));
  }

  /** Wipes an account's strikes (a mistake, or a second chance). Returns how many. */
  clearStrikes(userId: number): number {
    return Number(this.db.prepare('DELETE FROM ac_strikes WHERE user_id = ?').run(userId).changes);
  }

  /** Top players overall or in one mode (by wins, then kills); FaceChiken by rank points. */
  leaderboard(limit = 20, mode: ModeId | null = null): LeaderboardRow[] {
    const rows = (
      mode
        ? this.db
            .prepare(
              `SELECT u.name, m.kills, m.deaths, m.wins, m.matches, u.developer, u.xp FROM mode_stats m JOIN users u ON u.id = m.user_id WHERE m.mode = ? AND m.matches > 0 ORDER BY ${MODES[mode].ranked ? 'u.xp DESC, ' : ''}m.wins DESC, m.kills DESC LIMIT ?`,
            )
            .all(mode, limit)
        : this.db.prepare('SELECT name, kills, deaths, wins, matches, developer, xp FROM users WHERE matches > 0 ORDER BY wins DESC, kills DESC LIMIT ?').all(limit)
    ) as unknown as (Omit<LeaderboardRow, 'level'> & { developer: number; xp: number })[];
    return rows.map(({ developer, xp, ...row }) => ({ ...row, level: levelFor(xp), ...(developer === 1 ? { dev: true } : {}) }));
  }
}
