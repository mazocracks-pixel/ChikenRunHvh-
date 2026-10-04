/**
 * FaceChiken anti-cheat strikes, from the server's command line:
 *
 *   npm run anticheat -- --list               the latest strikes, everyone
 *   npm run anticheat -- <username>           one account's strikes and ban
 *   npm run anticheat -- <username> --clear   wipe their strikes (lifts the ban)
 *
 * On a built server: node server/dist/tools/anticheat.js --list
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GameDatabase, type Strike } from '../db/Database';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: 'boolean' },
    clear: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || (!values.list && positionals.length !== 1)) {
  console.log('Usage: npm run anticheat -- --list');
  console.log('       npm run anticheat -- <username> [--clear]');
  process.exit(values.help ? 0 : 1);
}

// Same database as the server (see index.ts).
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/game.db', import.meta.url));
if (!existsSync(dbPath)) fail(`No database at ${dbPath}. Start the server once first.`);
const db = new GameDatabase(dbPath);

const line = (s: Strike) => `${new Date(s.createdAt).toISOString()}  ${s.username ?? '(guest)'} ("${s.name}")  ${s.reason}  ${s.details}`;

try {
  if (values.list) {
    const strikes = db.strikes(null, 50);
    if (strikes.length === 0) console.log('No anti-cheat strikes.');
    for (const s of strikes) console.log(line(s));
  } else {
    const username = positionals[0]!;
    const userId = db.findUserId(username);
    if (userId === undefined) fail(`No registered account "${username}".`);
    if (values.clear) {
      console.log(`Cleared ${db.clearStrikes(userId)} strike(s) for ${username}: they can play FaceChiken again.`);
    } else {
      const strikes = db.strikes(userId);
      const ban = db.rankedBan(userId);
      console.log(`${username}: ${strikes.length} strike(s). ${ban ? `Banned from FaceChiken ${Number.isFinite(ban.until) ? `until ${new Date(ban.until).toISOString()}` : 'for good'}.` : 'Not banned.'}`);
      for (const s of strikes) console.log(`  ${line(s)}`);
    }
  }
} finally {
  db.close();
}
