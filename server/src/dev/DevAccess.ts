import { createHash, timingSafeEqual } from 'node:crypto';
import { KeyedRateLimiter } from '../util';

export interface DevAccessOptions {
  /** The developer passkey. Only its hash is kept in memory. */
  passkey: string;
  /** Allow developer tools in public rooms too (a local dev server); otherwise private rooms only. */
  allowPublicRooms: boolean;
  /**
   * When given, only these accounts may even try the passkey (developer accounts on a public
   * server). Everyone else is refused without the passkey being checked, so it can't be guessed.
   */
  isDeveloper?: (userId: number) => boolean;
}

/** Wrong guesses allowed per account before it has to wait (refills one every 12 s). */
const ATTEMPT_BURST = 5;
const ATTEMPTS_PER_SECOND = 1 / 12;
/** Per network too: making lots of guest accounts mustn't multiply the guesses. 20 per hour. */
const IP_BURST = 10;
const IP_PER_SECOND = 20 / 3600;

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/**
 * Who may use developer tools. Accounts unlock them with the passkey, checked here on the
 * server (the client never knows it); on a public server only developer accounts may try. Grants live in memory, so a server restart locks
 * everyone out again. Guessing is rate limited per account, since a short passkey is easy
 * to brute force otherwise.
 */
export class DevAccess {
  readonly allowPublicRooms: boolean;
  private readonly isDeveloper: ((userId: number) => boolean) | null;
  private readonly hash: Buffer;
  private readonly granted = new Set<number>();
  private readonly attempts = new KeyedRateLimiter(ATTEMPT_BURST, ATTEMPTS_PER_SECOND);
  private readonly ipAttempts = new KeyedRateLimiter(IP_BURST, IP_PER_SECOND);

  constructor(options: DevAccessOptions) {
    this.hash = digest(options.passkey);
    this.allowPublicRooms = options.allowPublicRooms;
    this.isDeveloper = options.isDeveloper ?? null;
  }

  isGranted(userId: number): boolean {
    // Re-checked every time: removing developer status takes effect at once.
    return this.granted.has(userId) && (this.isDeveloper === null || this.isDeveloper(userId));
  }

  /**
   * Checks a passkey for an account. 'limited' means too many wrong tries (from this account or
   * IP); 'denied' means this account isn't a developer, so the passkey wasn't even looked at.
   */
  tryUnlock(userId: number, ip: string, passkey: unknown): 'ok' | 'wrong' | 'limited' | 'denied' {
    if (this.isDeveloper && !this.isDeveloper(userId)) return 'denied';
    if (this.granted.has(userId)) return 'ok';
    if (!this.ipAttempts.take(ip)) return 'limited';
    if (!this.attempts.take(String(userId))) return 'limited';
    if (typeof passkey !== 'string' || passkey.length > 64) return 'wrong';
    if (!timingSafeEqual(digest(passkey), this.hash)) return 'wrong';
    this.granted.add(userId);
    return 'ok';
  }

  /** Developer tools work in private rooms, and in public ones only on a dev server. */
  allowedIn(room: { info: { private: boolean } }): boolean {
    return room.info.private || this.allowPublicRooms;
  }
}
