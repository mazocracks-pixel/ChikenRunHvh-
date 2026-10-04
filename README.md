# ChikenRunHvh

A multiplayer 3D chicken shooter that runs in any desktop or mobile browser. Armed chickens,
explosive eggs, jetpacks, buggies, knives and katanas, seven game modes (HvH and Knife Fight
included), a shop full of hats, and AI bots so there's always someone to fight.

- **Client:** TypeScript + [Three.js](https://threejs.org), bundled by [Vite](https://vite.dev)
- **Server:** Node.js + Express + [Socket.IO](https://socket.io), authoritative simulation
- **Database:** Node's built-in SQLite (`node:sqlite`), so there's nothing native to install
- **Shared:** physics, weapons, maps and the network protocol, used by both client and server

All models, textures and sounds are generated in code. There are no asset files.

## Getting started

Requires Node.js 22.13+ (for the built-in SQLite; developed on Node 24).

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and press **Play** on any mode. Quick Play fills the room with bots,
so you can play alone. To play with friends, use **Create room** and share the 5-letter code, or
open a second browser window.

| Command             | What it does                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`       | Game server on :3000 (auto-restarts) + Vite on :5173 (hot reload, proxies the API). Works from any folder of the project |
| `npm test`          | Unit + integration tests (physics, combat, modes, bots, accounts, sockets)           |
| `npm run typecheck` | Type-checks all three packages                                                       |
| `npm run build`     | Builds the client to `client/dist` and bundles the server to `server/dist`           |
| `npm start`         | Production server, also serving the built client: http://localhost:3000              |
| `npm run developer -- <username>` | Makes a registered account a developer (see below). `--remove` undoes it, `--list` shows them |

Environment variables:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `DB_PATH` | SQLite file (default `server/data/game.db`) |
| `DEV_PASSKEY` | Developer menu passkey. Never in the code: for `npm run dev` put it in `server/.env` (git ignores it; see `server/.env.example`). Without it developer tools are **off**. Use 12+ random characters on a public server |
| `DEV_PUBLIC_ROOMS=0` | Developer tools in private rooms only (by default they work in public matches too, still behind the passkey) |
| `DEV_ACCOUNTS_ONLY=1` | Only developer accounts may use the passkey. Always on for a production server; this turns it on for `npm run dev` too |
| `TRUST_PROXY` | Number of reverse proxies in front (e.g. `1` behind nginx), so rate limits and HTTPS detection see the real client |
| `ALLOWED_ORIGINS` | Comma-separated extra origins allowed to use the API/sockets, if the page is hosted elsewhere |
| `MAX_SOCKETS_PER_IP` | Simultaneous connections per IP (default 32; raise for LAN parties behind one IP) |

## Features

**Combat.** Pistol, Rifle, Shotgun and Sniper for everyone; SMG, Minigun, Rocket Launcher and
Golden Rifle in the shop. Melee weapons in a slot of their own after the guns (`5`): everyone has the
Knife, and the Frying Pan and Katana are in the shop. A swing hits the chicken in front of you
within reach (no ammo, walls block it). Press `F` to inspect the weapon you're holding. Headshots, damage falloff, spread that grows while moving or jumping,
recoil, reloading, a sniper scope, armor, spawn protection, kill feed, hit markers, and
damage-direction indicators.

**Chicken specials.** Explosive eggs (`G`) with area damage and knockback (and rocket jumps).
Smoke grenades (`Q`). Wallbang: bullets go through crates, hay and wood (up to two
boxes, losing 35% damage each), while stone, brick, metal and concrete stop them. Hold jump to auto bunny hop: every hop right as you land adds speed (up to
+60%, or +80% with a melee weapon out), and hitting a wall resets it. Press jump again in the air to fly with jetpack fuel, or to
glide without it. Mystery loot boxes: shoot one open for a medkit, armor, fuel or eggs. Every kill also drops a random bonus pickup
where the victim fell (it lasts 20 seconds). Drivable buggies
(`E`) that run over chickens and can be blown up.

**Modes.** Against All (FFA), Team Fight (red vs blue), HvH (Team Fight 5 vs 5 where everyone sees
enemies through walls), Knife Fight (3 vs 3, knives only, no grenades), ChikenBomb (see below), Duel, Capture the Flag, and Sandbox
(build with blocks). Matches go waiting → countdown → playing → results with an MVP, then the next
match starts automatically. There's also a scoreboard (`Tab`) and chat (`T`).

**ChikenBomb.** chikenT plant the bomb on site A or B, chikenCT defuse it, 5 vs 5 (bots fill in) on
Sandstown. A 40 s warmup (free respawns, free buying), then rounds: 15 s buy time frozen in spawn,
1:50 to plant, a 40 s fuse once planted. Dead chickens wait for the next round. Hold `E` to plant
(3 s, standing still on a site) or defuse (10 s, 5 s with a defuse kit); the bomb drops where its
carrier dies. Money: $800 to start, +$300 a kill (+$1500 with a knife), +$3250 for a round win, a
growing loss bonus, and plant / defuse bonuses. `B` opens the buy menu (only in this mode): armor,
eggs, smoke, SMG, Shotgun, Sniper, plus the chikenT-only Rifle and the chikenCT-only Golden Rifle and
defuse kit. Survivors keep what they bought. First to 6 rounds wins.

**Maps.** Farmyard, Town (enterable houses, rooftops, streets), Sandstown (a desert town with two
bomb sites, Long A, Mid and B tunnels), and Flat World for building.

**Progress.** A guest account is created automatically; register to keep progress across devices.
You earn coins after every match and spend them in the shop on skins, hats, beaks, sneakers and
weapons. There's a loadout of up to 4 guns plus a melee weapon, and a leaderboard.

**Graphics.** A gradient sky with a sun and drifting clouds, hazy hills on the horizon, and sky-based
ambient light and reflections. Sharp shadows that follow the camera. Grass and flowers that sway in
the wind, and houses with windows. Bullet holes, sparks, ejected shells, muzzle flashes and
explosions that light up their surroundings, plus a glow (bloom) on bright things. **Settings →
Graphics** has Low / Medium / High quality (phones default to Medium) and a field-of-view slider.

**Settings.** Mouse, zoom/scope and touch sensitivity (aiming slows down automatically with the
zoom level), invert Y, and a crosshair editor with a live preview: style (cross, dot, circle, T…),
colour, size, thickness, gap, opacity, outline and dynamic spread. Everything is saved in the
browser and applies immediately, even mid-match.

**Developer tools.** Press `Insert` (or tap the title five times on a phone) to open a
developer/testing menu: Legit (aim assist, trigger, movement helpers), Rage (aim lock, no
recoil/spread, infinite ammo, no rocket cooldown, no rocket damage, speed, fly, noclip, low gravity), Visuals (ESP, hitboxes, collision
boxes), Players (spectate, teleport, freeze, respawn, health, armor, weapons), Weapons (fire rate,
damage, recoil, spread, magazine), World (recolour every surface, sky, fog and light, with presets),
Misc (free camera, readouts) and saved configs. It asks for the
developer passkey first, which **only the server knows**. Set it with `DEV_PASSKEY` (in `server/.env` for
`npm run dev`; a public server sets its own variable). The server checks every request, and the tools work
in every room, public matches included (set `DEV_PUBLIC_ROOMS=0` for private rooms only). On a production server only **developer accounts** may even try the
passkey; everyone else is refused without it being checked, so it can't be guessed.

**Developer accounts.** Register an account in the game (*Save progress*), then on the server run
`npm run developer -- <username>` (on a built server: `node server/dist/tools/developer.js
<username>`). The account gets the name *Developer*, 9,999,999 coins (`--name` / `--coins` to
change), a rainbow glowing name for everyone (name tag, chat, kill feed, scoreboard,
leaderboard), and developer-menu access on production servers. There's no API or in-game way to
become a developer, only this command. *Developer*, *Admin*, *Moderator* and look-alikes
("Deve1oper", "D.e.v") are reserved: other players can't register or rename to them.

**Everywhere.** Mouse and keyboard with pointer lock, or touch controls on phones and tablets. Third
or first person (`V`). Synthesized sound effects.

### Controls

| Key           | Action                    | Key     | Action                       |
| ------------- | ------------------------- | ------- | ---------------------------- |
| WASD / arrows | Move (drive in a buggy)   | Mouse   | Look / aim                   |
| Space         | Jump (hold: bunny hop)    | Click   | Shoot                        |
| Space in air  | Glide / jetpack (again)   | V       | First / third person (saved) |
| Right-click   | Zoom / sniper scope       | R       | Reload                       |
| 1–4, wheel    | Switch gun                | 5       | Melee weapon                 |
| F             | Inspect weapon            | G       | Throw explosive egg          |
| Q             | Smoke grenade             | E       | Get in / out of a buggy      |
| Tab           | Scoreboard                |         |                              |
| T / Enter     | Chat                      | Esc     | Pause                        |
| B             | Build mode (Sandbox) / buy menu (ChikenBomb) | X | Next block type (Sandbox) |
| E (hold)      | Plant / defuse the bomb (ChikenBomb) |  |                     |
| Ctrl / C      | Crouch (slower, smaller)  |         |                              |
| Insert        | Developer menu (passkey)  |         |                              |

## Deploying (GitHub + Railway)

The whole game is one Node service (it serves the page too), so it needs an always-on host with
WebSockets and a disk. Vercel can't run it; Railway can, straight from GitHub:

1. On [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** → pick this repo.
   It builds the `Dockerfile` automatically (`railway.json` sets the health check).
2. In the service, **add a Volume** mounted at `/data` (the database lives at `/data/game.db`).
   Without it, every deploy starts with an empty database.
3. **Variables:** `DEV_PASSKEY` = your own 12+ random characters (or leave it out to turn
   developer tools off). `TRUST_PROXY=1` is already set in the Dockerfile.
4. **Settings → Networking → Generate Domain**, open it and play. Every push to `main` redeploys.
5. Register your account in the game, then make it the developer account from the Railway
   service shell: `node server/dist/tools/developer.js <username>`.

## Project layout

```
shared/src/            used by client AND server
  physics.ts           deterministic movement: walking, jumping, glide, jetpack, knockback
  vehicles.ts          deterministic buggy physics
  weapons.ts           weapon stats, spread, seeded pellet patterns, damage falloff
  projectiles.ts       eggs, smoke grenades, rockets
  raycast.ts           ray vs boxes / spheres / chicken hitboxes
  collision.ts         level collision with a spatial grid (static boxes + Sandbox blocks)
  maps/                Farmyard, Town, Sandstown, Flat World
  modes.ts, items.ts   game modes; shop catalogue (cosmetics + weapons)
  protocol.ts          every socket message and the compact snapshot format
server/src/
  app.ts               Express + Socket.IO wiring, socket auth, event routing
  api.ts, auth.ts      REST API: guest/register/login, profile, shop, leaderboard
  db/Database.ts       SQLite schema, migrations, purchases, match rewards
  rooms/RoomManager.ts quick play, private rooms with codes, room lifecycle
  rooms/GameRoom.ts    players, lag-compensated combat, damage, match flow, chat
  rooms/*System.ts     projectiles, loot boxes, vehicles, bots
  rooms/CtfRoom.ts, SandboxRoom.ts   mode-specific rules
client/src/
  app/App.ts           screens, joining, pause, reconnects
  settings.ts          saved player settings (sensitivity, crosshair, quality, FOV)
  game/Game.ts         renderer, quality presets, bloom, main loop
  game/GameSession.ts  everything in a match: prediction, shooting, events → effects/HUD
  game/LocalPlayer.ts  client-side prediction + reconciliation (walking and driving)
  game/RemotePlayers.ts snapshot interpolation for other players
  game/World.ts        map rendering, lights, shadows;  game/models/ procedural chickens, guns, hats, buggy
  game/Sky.ts          sky shader, clouds, hills;  game/Foliage.ts instanced grass, flowers, rocks
  game/Effects.ts      tracers, bullet holes, feathers, explosions, smoke;  game/Audio.ts synthesized sounds
  ui/                  HUD, crosshair, menus, shop, settings dialogs, touch controls
  dev/                 developer menu: tabs.ts (every control, as data), DevRuntime (aim,
                       movement, cameras), DevOverlay (ESP), config.ts (saved configs)
server/src/dev/        passkey check + permissions (DevAccess), player actions (devActions)
shared/src/dev.ts      developer modifiers shared by server rules and client prediction
```

To add a developer feature: add a field to `DevConfig` (`client/src/dev/config.ts`) and a control
to a tab in `tabs.ts`. Anything that changes gameplay must also be a server-checked modifier
(`shared/src/dev.ts`) or action (`server/src/dev/devActions.ts`).

## Accounts and security

- **Passwords** are hashed with scrypt (2^15, 32 MiB per hash; older hashes are upgraded on login).
  At least 8 characters, not a common password and not containing the username.
- **Sessions** are random 256-bit tokens; only their SHA-256 is stored. Browsers keep them in an
  `HttpOnly; SameSite=Strict` cookie (`Secure` on HTTPS), so page scripts, and any injected script,
  can never read them. Sessions expire after 30 days unused (180 days at most), at most 10 per
  account, and a fresh one is issued on login, registration and password change.
- **Logins** are rate limited per IP, and an account locks for 15 minutes after 5 wrong passwords
  (from any IP). Unknown usernames take as long as wrong passwords, so names can't be probed.
- **CSRF / cross-site WebSockets:** state-changing API calls and socket connections from other
  sites are refused (Origin check), on top of the SameSite cookie.
- **Headers:** Content-Security-Policy (own scripts only, no framing), nosniff, no referrer,
  restrictive Permissions-Policy, COOP/CORP, HSTS on HTTPS, `Cache-Control: no-store` on the API,
  and JSON errors without stack traces.
- **Your data:** Account → *Change password*, *Log out on all devices*, and *Delete account*
  (removes everything). Guest accounts unused for 60 days and expired sessions are deleted
  hourly. The database file is created readable by the server user only.
- **Cookie notice:** the menu shows a cookie bar until dismissed, and *Cookies & privacy* (menu
  footer) lists everything stored. The only cookie is the login cookie, which is strictly
  necessary, so there's no accept/refuse choice. If you add any other cookie or start storing new
  data, update `client/src/ui/Privacy.ts` and bump `NOTICE_VERSION` so everyone sees it again.
  Analytics or ad cookies would need a real opt-in first.
- Non-browser clients (tests, tools) can still use `Authorization: Bearer <token>`; they get the
  token in responses by sending `X-Session-Transport: token`.

## How the networking works

The server is the authority; the client stays responsive by predicting:

1. Every fixed tick (60 Hz) the client samples input, **applies it locally right away** with the
   shared `stepPlayer` (or `stepCar` while driving), remembers it, and sends it with an increasing
   `seq`.
2. The server validates each input (shape, ordering, a token bucket so clients can't speed-hack)
   and applies it with the same function.
3. 20 times a second the server broadcasts a compact snapshot of every player and vehicle,
   including the last `seq` it applied.
4. For **its own chicken**, the client rewinds to the server state and replays the inputs that
   haven't been confirmed yet (reconciliation). Any small difference is smoothed out visually.
5. **Other players** are drawn ~100 ms in the past, interpolating between snapshots.
6. **Shots** carry the time the shooter was seeing. The server rewinds everyone to that moment
   (up to 300 ms) before checking hits (lag compensation), and validates fire rate, ammo, reloads
   and weapon ownership. Clients never report damage.

Rule of thumb: anything that affects gameplay lives in `shared/` and must stay deterministic
(no `Math.random()`, no wall-clock time), so prediction and the server agree.

## Adding content

- **A weapon:** add an entry to `shared/src/weapons.ts` (append to `WEAPON_IDS`). It shows up in the
  shop automatically when its `price` is above 0.
- **A cosmetic:** add a line to `COSMETICS` in `shared/src/items.ts`; hats also need a shape in
  `client/src/game/models/Hats.ts`.
- **A map:** create `shared/src/maps/<name>.ts`, register it in `maps/index.ts` and in the modes'
  `maps` lists. `npm test` checks that spawns, loot and vehicle spots aren't inside walls.

## Note on the name

ChikenRunHvh started as a fan remake inspired by ChaloApps' *Chicken Gun*; it is an independent
project and not affiliated with ChaloApps. All models, sounds and code here are original.
