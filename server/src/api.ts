import express, { type Request, type Response } from 'express';
import {
  DEFAULT_LOADOUT,
  ITEMS_BY_ID,
  LOADOUT_SIZE,
  MODE_IDS,
  NAME_MAX_LENGTH,
  sanitizeAppearance,
  sanitizeLoadout,
  type ModeId,
} from '@game/shared';
import {
  SESSION_COOKIE,
  burnPasswordCheck,
  hashPassword,
  hashToken,
  isReservedName,
  needsRehash,
  newSessionToken,
  readCookie,
  sessionCookie,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth';
import type { GameDatabase } from './db/Database';
import type { RoomManager } from './rooms/RoomManager';
import { LoginGuard, sameOriginOnly } from './security';
import { KeyedRateLimiter, isRecord, sanitizeText } from './util';

/** Coins every new account starts with, enough for a first cosmetic. */
export const STARTING_COINS = 250;

/**
 * Non-browser clients (tests, tools) ask for the token in the response body with this header.
 * Browsers never get it: their session lives only in an HttpOnly cookie that scripts can't read.
 */
export const TOKEN_TRANSPORT_HEADER = 'x-session-transport';

function guestName(): string {
  return `Chicken${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface ApiOptions {
  /** Sign-up / login attempts allowed per IP per minute. */
  authPerMinute?: number;
  /** Guest accounts each IP may create per hour. */
  guestsPerHour?: number;
  /** Extra origins allowed to call the API besides this site itself (e.g. a separate web host). */
  allowedOrigins?: readonly string[];
  /** Called when an account's sessions are revoked or the account is deleted (drop its live sockets). */
  onSignedOut?: (userId: number) => void;
}

/** The session token sent with a request: the cookie, or a Bearer header from non-browser clients. */
export function requestToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

export function createApiRouter(db: GameDatabase, rooms: RoomManager, options: ApiOptions = {}): express.Router {
  const router = express.Router();
  const authPerMinute = options.authPerMinute ?? 10;
  const authLimiter = new KeyedRateLimiter(authPerMinute, authPerMinute / 60);
  const guestsPerHour = options.guestsPerHour ?? 30;
  const guestLimiter = new KeyedRateLimiter(Math.max(5, Math.ceil(guestsPerHour / 12)), guestsPerHour / 3600);
  const writeLimiter = new KeyedRateLimiter(30, 1);
  const loginGuard = new LoginGuard();
  router.use(express.json({ limit: '16kb' }));
  router.use(sameOriginOnly(options.allowedOrigins ?? []));
  // API responses are personal: never cache them anywhere.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });
  const ip = (req: Request) => req.ip ?? 'unknown';
  const wantsToken = (req: Request) => req.headers[TOKEN_TRANSPORT_HEADER] === 'token';

  /** The signed-in user id, or null after sending a 401. */
  const requireUser = (req: Request, res: Response): number | null => {
    const token = requestToken(req);
    const userId = token ? db.userIdForSession(hashToken(token)) : undefined;
    if (userId === undefined) {
      fail(res, 401, 'Not signed in.');
      return null;
    }
    return userId;
  };

  /** Starts a new session: replaces the request's old one, sets the cookie, returns the token. */
  const startSession = (req: Request, res: Response, userId: number): string => {
    const old = requestToken(req);
    if (old) db.deleteSession(hashToken(old));
    const { token, hash } = newSessionToken();
    db.createSession(userId, hash);
    res.append('Set-Cookie', sessionCookie(token, req.secure));
    return token;
  };

  const endSession = (req: Request, res: Response) => {
    const token = requestToken(req);
    if (token) db.deleteSession(hashToken(token));
    res.append('Set-Cookie', sessionCookie(null, req.secure));
  };

  const sendProfile = (req: Request, res: Response, userId: number, token?: string) => {
    const profile = db.profile(userId);
    if (!profile) return fail(res, 404, 'Account not found.');
    res.json(token && wantsToken(req) ? { token, profile } : { profile });
  };

  router.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.count, players: rooms.playerCount });
  });

  router.post('/auth/guest', (req, res) => {
    if (!guestLimiter.take(ip(req))) return fail(res, 429, 'Too many new accounts from your network. Try again later.');
    const userId = db.createUser(guestName(), STARTING_COINS);
    sendProfile(req, res, userId, startSession(req, res, userId));
  });

  /** Page load: carry on with the current session, or start a new guest if there is none. */
  router.post('/auth/start', (req, res) => {
    const token = requestToken(req);
    const userId = token ? db.userIdForSession(hashToken(token)) : undefined;
    if (userId !== undefined) return sendProfile(req, res, userId);
    if (!guestLimiter.take(ip(req))) return fail(res, 429, 'Too many new accounts from your network. Try again later.');
    const guestId = db.createUser(guestName(), STARTING_COINS);
    sendProfile(req, res, guestId, startSession(req, res, guestId));
  });

  /** Moves an old (pre-cookie) browser login stored in localStorage over to the cookie. */
  router.post('/auth/session', (req, res) => {
    if (!authLimiter.take(ip(req))) return fail(res, 429, 'Too many attempts, try again in a minute.');
    const userId = requireUser(req, res);
    if (userId === null) return;
    sendProfile(req, res, userId, startSession(req, res, userId));
  });

  router.post('/auth/register', async (req, res) => {
    if (!authLimiter.take(ip(req))) return fail(res, 429, 'Too many attempts, try again in a minute.');
    const userId = requireUser(req, res);
    if (userId === null) return;
    const { username, password } = isRecord(req.body) ? req.body : {};
    const problem = validateUsername(username) ?? validatePassword(password, username as string);
    if (problem) return fail(res, 400, problem);
    if (db.profile(userId)?.username) return fail(res, 400, 'This account is already registered.');
    if (db.isUsernameTaken(username as string)) return fail(res, 409, 'That username is taken.');
    db.setCredentials(userId, username as string, await hashPassword(password as string));
    // New privileges, new session: the old (guest) token stops working.
    db.deleteSessionsForUser(userId);
    sendProfile(req, res, userId, startSession(req, res, userId));
  });

  router.post('/auth/login', async (req, res) => {
    if (!authLimiter.take(ip(req))) return fail(res, 429, 'Too many attempts, try again in a minute.');
    const { username, password } = isRecord(req.body) ? req.body : {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 32 || password.length > 128) {
      return fail(res, 400, 'Enter a username and password.');
    }
    const wait = loginGuard.lockedFor(username);
    if (wait > 0) return fail(res, 429, `Too many wrong passwords for this account. Try again in ${Math.ceil(wait / 60000)} min.`);
    const login = db.findLogin(username);
    // Same message and the same amount of work either way, so neither the reply nor its
    // timing reveals which usernames exist.
    const ok = login ? await verifyPassword(password, login.passwordHash) : (await burnPasswordCheck(password), false);
    if (!login || !ok) {
      loginGuard.fail(username);
      return fail(res, 401, 'Wrong username or password.');
    }
    loginGuard.succeed(username);
    if (needsRehash(login.passwordHash)) db.setPasswordHash(login.id, await hashPassword(password));
    sendProfile(req, res, login.id, startSession(req, res, login.id));
  });

  router.post('/auth/logout', (req, res) => {
    endSession(req, res);
    res.json({ ok: true });
  });

  /** Signs this account out on every device (e.g. after a lost phone). */
  router.post('/auth/logout-all', (req, res) => {
    const userId = requireUser(req, res);
    if (userId === null) return;
    db.deleteSessionsForUser(userId);
    endSession(req, res);
    options.onSignedOut?.(userId);
    res.json({ ok: true });
  });

  router.post('/auth/password', async (req, res) => {
    if (!authLimiter.take(ip(req))) return fail(res, 429, 'Too many attempts, try again in a minute.');
    const userId = requireUser(req, res);
    if (userId === null) return;
    const { current, next } = isRecord(req.body) ? req.body : {};
    const stored = db.passwordHash(userId);
    const username = db.profile(userId)?.username;
    if (!stored || !username) return fail(res, 400, 'Register first to set a password.');
    if (typeof current !== 'string' || current.length > 128 || !(await verifyPassword(current, stored))) return fail(res, 401, 'Your current password is wrong.');
    const problem = validatePassword(next, username);
    if (problem) return fail(res, 400, problem);
    db.setPasswordHash(userId, await hashPassword(next as string));
    // Everyone else using the old password is signed out; this device gets a fresh session.
    db.deleteSessionsForUser(userId);
    options.onSignedOut?.(userId);
    sendProfile(req, res, userId, startSession(req, res, userId));
  });

  router.get('/me', (req, res) => {
    const userId = requireUser(req, res);
    if (userId !== null) sendProfile(req, res, userId);
  });

  /** Today's daily challenges and the player's progress. */
  router.get('/daily', (req, res) => {
    const userId = requireUser(req, res);
    if (userId !== null) res.json(db.dailyStatus(userId));
  });

  router.patch('/me', (req, res) => {
    const userId = requireUser(req, res);
    if (userId === null) return;
    if (!writeLimiter.take(String(userId))) return fail(res, 429, 'Slow down a little.');
    const body = isRecord(req.body) ? req.body : {};
    const owned = db.owned(userId);
    const owns = (id: string) => owned.has(id);
    const changes: Parameters<GameDatabase['updateProfile']>[1] = {};

    if (body.name !== undefined) {
      const name = sanitizeText(body.name, NAME_MAX_LENGTH);
      if (name.length < 2) return fail(res, 400, 'Names need at least 2 characters.');
      if (isReservedName(name) && !db.isDeveloper(userId)) return fail(res, 400, 'That name is reserved.');
      changes.name = name;
    }
    if (body.appearance !== undefined) changes.appearance = sanitizeAppearance(body.appearance, owns);
    if (body.loadout !== undefined) changes.loadout = sanitizeLoadout(body.loadout, owns, LOADOUT_SIZE, DEFAULT_LOADOUT);
    db.updateProfile(userId, changes);
    sendProfile(req, res, userId);
  });

  /** Deletes the account and all its data. Registered accounts must confirm with their password. */
  router.delete('/me', async (req, res) => {
    if (!authLimiter.take(ip(req))) return fail(res, 429, 'Too many attempts, try again in a minute.');
    const userId = requireUser(req, res);
    if (userId === null) return;
    const stored = db.passwordHash(userId);
    if (stored) {
      const password = isRecord(req.body) ? req.body.password : undefined;
      if (typeof password !== 'string' || password.length > 128 || !(await verifyPassword(password, stored))) return fail(res, 401, 'Wrong password.');
    }
    db.deleteUser(userId);
    res.append('Set-Cookie', sessionCookie(null, req.secure));
    options.onSignedOut?.(userId);
    res.json({ ok: true });
  });

  router.post('/shop/buy', (req, res) => {
    const userId = requireUser(req, res);
    if (userId === null) return;
    if (!writeLimiter.take(String(userId))) return fail(res, 429, 'Slow down a little.');
    const itemId = isRecord(req.body) ? req.body.itemId : undefined;
    const item = typeof itemId === 'string' ? ITEMS_BY_ID.get(itemId) : undefined;
    if (!item || item.price <= 0) return fail(res, 404, 'That item is not for sale.');
    const result = db.buy(userId, item.id, item.price);
    if (result === 'owned') return fail(res, 409, 'You already own that.');
    if (result === 'insufficient') return fail(res, 402, 'Not enough coins.');
    if (result === 'missing') return fail(res, 404, 'Account not found.');
    sendProfile(req, res, userId);
  });

  // Overall, or for one game mode (`?mode=arms`).
  router.get('/leaderboard', (req, res) => {
    const mode = typeof req.query.mode === 'string' && (MODE_IDS as readonly string[]).includes(req.query.mode) ? (req.query.mode as ModeId) : null;
    res.json({ rows: db.leaderboard(20, mode) });
  });

  // Unknown API paths: a JSON 404 rather than the web page.
  router.use((_req, res) => fail(res, 404, 'Not found.'));

  return router;
}
