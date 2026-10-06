import type { NextFunction, Request, Response } from 'express';

/**
 * Browser hardening headers for every response:
 * - CSP: only our own scripts run, no plugins, no framing, no form posts elsewhere. Inline style
 *   attributes are allowed (the UI sets a few colours that way); inline scripts are not.
 * - nosniff, no referrer leaks, no camera/mic/location, isolated browsing context.
 * - HSTS only over HTTPS (it would break plain-http local play).
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Older Safari doesn't count same-host WebSockets as 'self', so name them explicitly.
  const host = /^[A-Za-z0-9.:[\]-]+$/.test(req.headers.host ?? '') ? req.headers.host : null;
  const sockets = host ? ` ws://${host} wss://${host}` : '';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${sockets}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

/**
 * True if a request's Origin is this site (or explicitly allowed). Requests without an Origin
 * (non-browser clients, tests) can't carry a victim's cookies across sites, so they pass.
 */
export function originAllowed(origin: string | undefined, hosts: readonly (string | undefined)[], extra: readonly string[]): boolean {
  if (!origin) return true;
  if (extra.includes(origin)) return true;
  try {
    const host = new URL(origin).host;
    return hosts.some((h) => h !== undefined && h === host);
  } catch {
    return false;
  }
}

/** CSRF defence for state-changing API calls: cross-site requests are refused. */
export function sameOriginOnly(allowedOrigins: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    // req.host is the forwarded host when the app trusts its proxy (TRUST_PROXY), else the Host header.
    if (!originAllowed(req.headers.origin, [req.headers.host, req.host], allowedOrigins)) {
      res.status(403).json({ error: 'Cross-site request refused.' });
      return;
    }
    next();
  };
}

/** Errors become a short JSON message: never a stack trace or Express's HTML error page. */
export function jsonErrors(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : 500;
  if (status >= 500) console.error('[server] request failed:', err instanceof Error ? err.message : err);
  if (res.headersSent) return;
  res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : 'Bad request.' });
}

/**
 * Per-account login protection on top of the per-IP limit: after a few wrong passwords the
 * username is locked for a while, no matter how many IP addresses the attempts come from.
 */
export class LoginGuard {
  private readonly failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
  ) {}

  /** Milliseconds until this username may try again (0 = now). */
  lockedFor(username: string, now = Date.now()): number {
    const f = this.failures.get(username.toLowerCase());
    return f && f.lockedUntil > now ? f.lockedUntil - now : 0;
  }

  fail(username: string, now = Date.now()): void {
    const key = username.toLowerCase();
    let f = this.failures.get(key);
    if (!f || now - f.first > this.windowMs) f = { count: 0, first: now, lockedUntil: 0 };
    f.count++;
    if (f.count >= this.maxFailures) {
      f.lockedUntil = now + this.lockMs;
      f.count = 0;
      f.first = now;
    }
    this.failures.set(key, f);
    if (this.failures.size > 50_000) this.prune(now);
  }

  /** How many usernames are being tracked (for tests). */
  get size(): number {
    return this.failures.size;
  }

  succeed(username: string): void {
    this.failures.delete(username.toLowerCase());
  }

  private prune(now: number): void {
    for (const [key, f] of this.failures) if (f.lockedUntil < now && now - f.first > this.windowMs) this.failures.delete(key);
    // Still huge (a flood of made-up usernames): forget the oldest entries, keep memory bounded.
    for (const key of this.failures.keys()) {
      if (this.failures.size <= 25_000) break;
      this.failures.delete(key);
    }
  }
}
