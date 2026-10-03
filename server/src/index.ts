import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@game/shared';
import { startGameServer } from './app';

// Local settings and secrets (like DEV_PASSKEY for `npm run dev`) live in server/.env, which git
// never uploads. A hosted server (Railway) sets them as environment variables instead.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT) || DEFAULT_PORT;
/** Set by `npm run dev`: Vite serves the client, so never serve a (possibly stale) production build. */
const isDev = process.argv.includes('--dev');
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/game.db', import.meta.url));
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));

// The database holds password hashes: keep it readable by this user only (no effect on Windows).
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

/** Developer menu passkey. Never written in the code: set DEV_PASSKEY (server/.env locally). */
const devPasskey = process.env.DEV_PASSKEY || undefined;
const list = (value: string | undefined) => (value ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const server = await startGameServer({
  port,
  dbPath,
  clientDist: isDev ? undefined : clientDist,
  // Developer menu passkey. Set DEV_PASSKEY to your own secret on a public server.
  devPasskey,
  // On the local dev server developer tools work in every room; otherwise only in private rooms.
  devInPublicRooms: isDev || process.env.DEV_PUBLIC_ROOMS === '1',
  // A public server only lets developer accounts (npm run developer) try the passkey.
  devAccountsOnly: !isDev || process.env.DEV_ACCOUNTS_ONLY === '1',
  // Behind nginx / a load balancer: set TRUST_PROXY=1 (number of proxies) so rate limits see real IPs.
  trustProxyHops: Number(process.env.TRUST_PROXY) || 0,
  // If the page is served from another origin than the API: ALLOWED_ORIGINS=https://game.example.com
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  // Players sharing one public IP (a school, a LAN party) may need more: MAX_SOCKETS_PER_IP=64
  maxSocketsPerIp: Number(process.env.MAX_SOCKETS_PER_IP) || undefined,
  log: (message) => console.log(message),
});

for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try {
    if (existsSync(file)) chmodSync(file, 0o600);
  } catch {
    // Not supported here (e.g. some Windows file systems): nothing to do.
  }
}
if (!devPasskey) console.log(`[server] developer tools are off (set DEV_PASSKEY${isDev ? ' in server/.env' : ''} to enable them)`);
else if (!isDev && devPasskey.length < 12) console.warn('[server] DEV_PASSKEY is short: use 12+ random characters on a public server');

console.log(`[server] database: ${dbPath}`);
if (isDev) console.log('[server] dev mode: open the Vite URL (http://localhost:5173)');
else console.log(`[server] open http://localhost:${server.port}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  // Don't hang forever on lingering keep-alive connections.
  setTimeout(() => process.exit(0), 1500).unref();
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
