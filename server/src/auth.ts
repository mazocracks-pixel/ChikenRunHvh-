import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';

const scrypt = (password: BinaryLike, salt: BinaryLike, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

const KEY_LENGTH = 64;
/** scrypt work factor: 2^15 with r = 8 uses 32 MiB and ~60 ms per hash. Raise it as hardware allows. */
const COST = 32768;
const BLOCK_SIZE = 8;
/** Node's default scrypt memory cap (32 MiB) is exactly at the limit for COST; give it headroom. */
const MAX_MEMORY = 128 * 1024 * 1024;

const params = (cost: number): ScryptOptions => ({ N: cost, r: BLOCK_SIZE, p: 1, maxmem: MAX_MEMORY });

/** `scrypt$<N>$<salt>$<hash>` with base64 salt and hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, params(COST));
  return `scrypt$${COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, saltB64, hashB64] = stored.split('$');
  const n = Number(cost);
  // Reject anything malformed or with an absurd cost (it would be a cheap DoS).
  if (scheme !== 'scrypt' || !saltB64 || !hashB64 || !Number.isInteger(n) || n < 1024 || n > 1 << 20) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, params(n));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hashes made with an older (cheaper) cost get upgraded the next time the user logs in. */
export function needsRehash(stored: string): boolean {
  return Number(stored.split('$')[1]) < COST;
}

let dummyHash: Promise<string> | null = null;
/**
 * Runs a full password check against a throwaway hash, so logging in as a username that
 * doesn't exist takes as long as a wrong password (no timing leak of which names exist).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

/** Session tokens are random; only their SHA-256 is stored, so a leaked database can't log anyone in. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return 'Usernames are 3–16 letters, numbers or underscores.';
  }
  if (isReservedName(username)) return 'That name is reserved.';
  return null;
}

/** Look-alike letters people use to dodge a name filter ("Deve1oper", Cyrillic "е"). */
const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '|': 'l', '!': 'i', а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ӏ: 'l' };

/**
 * Names only developer accounts may use, so nobody can pretend to be staff. Checked after
 * folding case, look-alikes, spaces and symbols away: "D.e.v.e.l.o.p.e.r" counts too.
 */
export function isReservedName(name: string): boolean {
  const folded = Array.from(name.normalize('NFKC').toLowerCase(), (ch) => LOOKALIKES[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '');
  return /developer|admin|moderator/.test(folded) || folded === 'dev' || folded === 'mod';
}

/** The most common passwords (and game-flavoured ones); all are refused. */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344', 'password', 'password1',
  'password12', 'password123', 'passw0rd', 'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'zxcvbnm1', 'iloveyou', 'princess',
  'sunshine', 'football', 'baseball', 'superman', 'whatever', 'trustno1', 'starwars', 'computer', 'michelle', 'jennifer',
  'letmein1', 'welcome1', 'abc12345', 'abcd1234', 'aa123456', 'monkey12', 'dragon12', 'master12', 'shadow12', 'killer12',
  'chicken1', 'chickens', 'chickengun', 'chikenrunhvh', 'chickenrun', 'chicken123', 'minecraft', 'fortnite', 'roblox123', 'gamer123', 'q1w2e3r4', '1q2w3e4r',
]);

export function validatePassword(password: unknown, username?: string): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'Passwords need 8–128 characters.';
  const lower = password.toLowerCase();
  if (new Set(password).size < 4) return 'That password is too simple. Use at least 4 different characters.';
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Pick something harder to guess.';
  if (username && lower.includes(username.toLowerCase())) return "Your password can't contain your username.";
  return null;
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'cg_session';
/** Sessions end after this long without use... */
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** ...and after this long no matter what. */
export const SESSION_MAX_MS = 180 * 24 * 60 * 60 * 1000;

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      // Tokens are base64url; anything else isn't ours.
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

/**
 * The session cookie: HttpOnly (page scripts, and so any XSS, can't read it), SameSite=Strict
 * (other sites can't send it), Secure on HTTPS.
 */
export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${token ? Math.floor(SESSION_IDLE_MS / 1000) : 0}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
