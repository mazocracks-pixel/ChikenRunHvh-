/**
 * Player reports, from the server's command line:
 *
 *   npm run reports                 the latest reports, everyone
 *   npm run reports -- <username>   reports about one account
 *
 * On a built server: node server/dist/tools/reports.js
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GameDatabase, type Report } from '../db/Database';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
if (values.help || positionals.length > 1) {
  console.log('Usage: npm run reports');
  console.log('       npm run reports -- <username>');
  process.exit(values.help ? 0 : 1);
}

// Same database as the server (see index.ts).
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/game.db', import.meta.url));
if (!existsSync(dbPath)) fail(`No database at ${dbPath}. Start the server once first.`);
const db = new GameDatabase(dbPath);

const line = (r: Report) => `${new Date(r.createdAt).toISOString()}  ${r.reportedUsername ?? '(guest)'} ("${r.reportedName}")  ${r.reason}  in ${r.mode}  by "${r.reporterName}"`;

try {
  let reports: Report[];
  if (positionals[0]) {
    const userId = db.findUserId(positionals[0]);
    if (userId === undefined) fail(`No registered account "${positionals[0]}".`);
    reports = db.reports(userId, 100);
  } else {
    reports = db.reports(null, 100);
  }
  if (reports.length === 0) console.log('No reports.');
  for (const r of reports) console.log(line(r));
} finally {
  db.close();
}
