/**
 * Developer accounts, managed from the server's command line only: there is no API or in-game
 * way to become one, so only whoever runs the server can hand it out.
 *
 *   npm run developer -- <username>                 make a developer: name "Developer", 9,999,999 coins
 *   npm run developer -- <username> --create        create the account too, with a random password (shown once)
 *   npm run developer -- <username> --name X --coins N
 *   npm run developer -- <username> --remove        back to a normal player
 *   npm run developer -- --list
 *
 * Without --create the account must be registered first (in the game: Save progress). On a built
 * server: node server/dist/tools/developer.js <username>
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NAME_MAX_LENGTH } from '@game/shared';
import { hashPassword, isReservedName, validatePassword } from '../auth';
import { GameDatabase } from '../db/Database';
import { randomString, sanitizeText } from '../util';

const DEFAULT_NAME = 'Developer';
const DEFAULT_COINS = 9_999_999;
const MAX_COINS = 1_000_000_000;
/** No look-alike characters (0/o, 1/l), so the password is easy to type: 4 groups of 4, 80 bits. */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function newPassword(): string {
  return Array.from({ length: 4 }, () => randomString(4, PASSWORD_ALPHABET)).join('-');
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    coins: { type: 'string' },
    remove: { type: 'boolean' },
    create: { type: 'boolean' },
    list: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || (!values.list && positionals.length !== 1)) {
  console.log('Usage: npm run developer -- <username> [--create] [--name Developer] [--coins 9999999] [--remove]');
  console.log('       npm run developer -- --list');
  process.exit(values.help ? 0 : 1);
}

// Same database as the server (see index.ts).
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/game.db', import.meta.url));
if (!existsSync(dbPath)) fail(`No database at ${dbPath}. Start the server once first.`);
const db = new GameDatabase(dbPath);

try {
  if (values.list) {
    const devs = db.developers();
    if (devs.length === 0) console.log('No developer accounts.');
    for (const d of devs) console.log(`${d.username ?? '(guest)'}  name: ${d.name}  coins: ${d.coins.toLocaleString('en-US')}`);
  } else {
    const username = positionals[0]!;
    let password: string | null = null;
    if (values.create) {
      // Reserved names are fine here: only the server's owner can run this.
      if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) fail('Usernames are 3–16 letters, numbers or underscores.');
      if (db.findUserId(username) !== undefined) fail(`"${username}" already exists. Leave out --create to make it a developer.`);
      password = newPassword();
      if (validatePassword(password, username)) fail('Could not make a password, try again.');
      const id = db.createUser(username, 0);
      db.setCredentials(id, username, await hashPassword(password));
    }
    const userId = db.findUserId(username);
    if (userId === undefined) fail(`No registered account "${username}". Register it in the game first (Save progress), then run this again.`);
    const profile = db.profile(userId)!;

    if (values.remove) {
      db.setDeveloper(userId, false);
      // A staff-only name goes back to the username.
      if (isReservedName(profile.name)) db.updateProfile(userId, { name: profile.username ?? 'Chicken' });
      console.log(`${profile.username} is a normal player again.`);
    } else {
      const name = sanitizeText(values.name ?? DEFAULT_NAME, NAME_MAX_LENGTH);
      if (name.length < 2) fail('Names need at least 2 characters.');
      const coins = values.coins === undefined ? DEFAULT_COINS : Number(values.coins);
      if (!Number.isInteger(coins) || coins < 0 || coins > MAX_COINS) fail(`Coins must be a whole number from 0 to ${MAX_COINS.toLocaleString('en-US')}.`);
      db.setDeveloper(userId, true);
      db.updateProfile(userId, { name });
      db.setCoins(userId, coins);
      console.log(`${profile.username} is now a developer: name "${name}" (rainbow), ${coins.toLocaleString('en-US')} coins.`);
      if (password) {
        console.log('');
        console.log(`  Username: ${username}`);
        console.log(`  Password: ${password}`);
        console.log('');
        console.log('This password is shown only once. Log in with it in the game (Account, Log in), then');
        console.log('change it: Account, Change password.');
      } else {
        console.log('Reload the game page to see it.');
      }
    }
  }
} finally {
  db.close();
}
