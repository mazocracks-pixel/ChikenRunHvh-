import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_LOADOUT,
  LOADOUT_SIZE,
  sanitizeAppearance,
  sanitizeLoadout,
  type Appearance,
  type LeaderboardRow,
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
];

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

  /** Saves match results and rewards in one transaction; returns each user's new coin total. */
  recordMatch(records: MatchRecord[]): Map<number, number> {
    return this.transaction(() => {
      const update = this.db.prepare(
        'UPDATE users SET coins = coins + ?, kills = kills + ?, deaths = deaths + ?, wins = wins + ?, matches = matches + 1 WHERE id = ?',
      );
      const select = this.db.prepare('SELECT coins FROM users WHERE id = ?');
      const totals = new Map<number, number>();
      for (const r of records) {
        update.run(r.coins, r.kills, r.deaths, r.won ? 1 : 0, r.userId);
        const row = select.get(r.userId) as { coins: number } | undefined;
        if (row) totals.set(r.userId, row.coins);
      }
      return totals;
    });
  }

  leaderboard(limit = 20): LeaderboardRow[] {
    const rows = this.db
      .prepare('SELECT name, kills, deaths, wins, matches, developer FROM users WHERE matches > 0 ORDER BY kills DESC, wins DESC LIMIT ?')
      .all(limit) as unknown as (LeaderboardRow & { developer: number })[];
    return rows.map(({ developer, ...row }) => (developer === 1 ? { ...row, dev: true } : row));
  }
}
