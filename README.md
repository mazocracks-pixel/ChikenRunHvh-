# ChikenRunHvh

A multiplayer 3D chicken shooter that runs in any desktop or mobile browser. Armed chickens,
explosive eggs, jetpacks, buggies, 30 weapons from butterfly knives to crossbows, ten game modes (HvH,
Knife Fight, ChikenBomb, Arms Race and the ranked FaceChiken included), seven maps, a shop full of hats, and AI bots so there's always someone to fight.

- **Client:** TypeScript + [Three.js](https://threejs.org), bundled by [Vite](https://vite.dev)
- **Server:** Node.js + Express + [Socket.IO](https://socket.io), authoritative simulation
- **Database:** Node's built-in SQLite (`node:sqlite`), so there's nothing native to install
- **Shared:** physics, weapons, maps and the network protocol, used by both client and server

All models, textures and sounds are generated in code. There are no asset files.

### Movement accuracy and performance

Horizontal spread grows continuously with actual collision-resolved speed: slow walking and crouching
are more accurate, hops and knockback are less accurate, and pushing into a wall adds no movement
penalty. Client prediction, HUD, shot estimates and server hits use the same shared rule. Airborne
and ADS modifiers remain weapon-specific. Speed is replicated after the existing snapshot fields.

Target searches run at 10 Hz, spread trials at most 20 Hz and only when a shot can be considered;
aim turns and movement stay responsive every frame. Silhouette geometry updates only when its
material or equipment changes. Unchanged palettes skip material updates; hidden tabs stop rendering, and the menu backdrop renders at 30 FPS.

### Arena and combat feedback

The original main menu, mode categories, map pickers and rank display are retained.

Farmyard now feels like a chicken sporting arena: painted field markings and cover trims,
an orchard skyline, distant barn and windmill, warm lighting, daisies, and more expressive
chickens with team scarf tails. Decorative scenery stays outside the playable bounds; cover
still matches the authoritative collision boxes.

Guns have distinct layered sounds, distance muffling, first-person kick and recovery. Hits
show server-confirmed damage, rapid eliminations call out Double / Triple / Quad Plucks,
and the HUD tracks your current life streak. Results include your kills, deaths, K/D and
best locally observed streak for that match. Death breaks a multikill chain; a new match
resets the streak record. ChikenBomb warmup is excluded when the first buy round begins.

Explosions gain expanding shockwaves and cleaner impact particles. Effects are pooled,
weapon models are reused, and completed audio graphs disconnect. The browser's reduced
motion preference disables camera shake and reduces weapon motion and menu animation.

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
| `npm run anticheat -- --list` | FaceChiken anti-cheat strikes; `npm run anticheat -- <username> --clear` lifts a ban |

Environment variables:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `DB_PATH` | SQLite file (default `server/data/game.db`) |
| `DEV_PASSKEY` | Developer menu passkey. Never in the code: for `npm run dev` put it in `server/.env` (git ignores it; see `server/.env.example`). Without it private developer access is **off**; public HvH access has a separate flag. Use 12+ random characters on a public server |
| `DEV_PUBLIC_ROOMS=1` | Legacy modifiers in public non-HvH development rooms; player administration still requires a private room |
| `ANTICHEAT=log` | FaceChiken anti-cheat only logs cheaters instead of removing them (`off` turns it off). Default: removes them |
| `HVH_PUBLIC_PANEL=1` | Opt-in public HvH Lab and Skeet panels for all HvH players; normal stats and bounded abilities, no player administration. Default off |
| `DEV_ACCOUNTS_ONLY=1` | Only developer accounts may use the passkey. Optional restriction for servers that require developer accounts |
| `TRUST_PROXY` | Number of reverse proxies in front (e.g. `1` behind nginx), so rate limits and HTTPS detection see the real client |
| `ALLOWED_ORIGINS` | Comma-separated extra origins allowed to use the API/sockets, if the page is hosted elsewhere |
| `MAX_SOCKETS_PER_IP` | Simultaneous connections per IP (default 32; raise for LAN parties behind one IP) |

## Features

**Combat.** Pistol, Rifle, Shotgun and Sniper for everyone. In the shop: Deagle (a headshot kills),
Five-Seven (20 rounds), Dual Pistols (one in each hand), Silenced Pistol (quiet and very accurate), SMG, Machine Pistol,
Revolver, Burst Rifle (3-round bursts), Battle Rifle, Auto Shotgun, LMG (100 rounds, you move 15%
slower), Scout (light sniper), Crossbow (bolts that drop over distance), Egg Launcher (fast exploding
eggs), Minigun, Rocket Launcher and Golden Rifle. Melee weapons in a slot of their own after the guns (`5`): everyone has the
Knife, and the Frying Pan, Katana and Golden Knife are in the shop, plus four knives in the style of CS2's:
Butterfly Knife, Karambit, M9 Bayonet and Shadow Daggers. They play exactly like the Knife (and replace
it in Knife Fight, ChikenBomb and FaceChiken), and each has its own inspect trick on `F`: the butterfly
fans open, the karambit spins round your finger, the M9 flips in the air, the daggers twirl. A swing hits the chicken in front of you
within reach (no ammo, walls block it). Press `F` to inspect the weapon you're holding. Headshots, damage falloff, spread that grows while moving or jumping,
recoil, reloading, a sniper scope, armor, spawn protection, kill feed, hit markers, and
damage-direction indicators.

**Chicken specials.** Explosive eggs (`G`) with area damage and knockback (and rocket jumps).
Smoke grenades (`Q`). Flashbangs (`Z`, one to start, $200 in the buy menu): they bounce, then bang, and
everyone who can see one (walls block it, teammates and the thrower too) goes white, longer the closer
they are and the more they were looking at it, with ringing ears; blinded bots can't see either. Kills
say how they were done, CS-style: *no scope*, *through a wall*, *through smoke*, *in mid-air* and
*while blind* tags in the kill feed, "a no-scope headshot through the wall, in mid-air" on the death
screen, and the same on your own kill banner. Wallbang: bullets go through crates, hay and wood (up to two
boxes, losing 35% damage each), while stone, brick, metal and concrete stop them. Hold jump to auto bunny hop: every hop right as you land adds speed (up to
+60%, or +80% with a melee weapon out), and hitting a wall resets it. Press jump again in the air to fly with jetpack fuel, or to
glide without it. Mystery loot boxes: shoot one open for a medkit, armor, fuel or eggs. Every kill also drops a random bonus pickup
where the victim fell (it lasts 20 seconds). Drivable buggies (`E`) that run over chickens and can be
blown up: they slide a little in fast turns, drift with the handbrake (`Space`, leaving skid marks and
tyre smoke), and have a nitro tank (`Shift`, blue flames, refills when you let go). You can shoot and
throw eggs from the driver's seat (no melee): your chicken turns to where you aim. The car's body
takes the bullets that hit it, but a driver's head above it can be shot. The buggy has a roll cage
with a light bar, steering front wheels and steering wheel, suspension that leans and dips, glowing
head and brake lights, dust behind it, an engine that growls with your speed, and smoke when it's
badly damaged.

**Modes.** Against All (FFA), Team Fight (red vs blue), HvH (Team Fight 5 vs 5 where everyone sees
enemies through walls), Knife Fight (3 vs 3, knives only, no grenades), ChikenBomb (see below), Arms
Race (see below), Duel, Capture the Flag, and Sandbox (build with blocks). The menu groups them into
Casual, Competitive and Fun tabs; each mode card shows its team size and has a map picker
("Any map" or a specific one). Matches go waiting → countdown → playing → results with an MVP, then the next
match starts automatically. There's also a scoreboard (`Tab`) and chat (`T`).

**ChikenBomb.** chikenT plant the bomb on site A or B, chikenCT defuse it, 5 vs 5 (bots fill in) on
Sandstown. A 40 s warmup (free respawns, free buying), then rounds: 15 s buy time frozen in spawn,
1:50 to plant, a 40 s fuse once planted. Dead chickens wait for the next round. Hold `E` to plant
(3 s, standing still on a site) or defuse (10 s, 5 s with a defuse kit); the bomb drops where its
carrier dies. Money: $800 to start, +$300 a kill (+$1500 with a knife), +$3250 for a round win, a
growing loss bonus, and plant / defuse bonuses. `B` opens the buy menu (bomb modes only), which frees
the mouse: your chicken turns on the left, holding whatever gun you point at (with its damage, fire
rate, accuracy and range), and every gun in the game is on the right in columns (Pistols, SMGs, Heavy,
Rifles, Snipers, Explosive, Gear) with CS-like prices and pictures of the real models. Click to buy:
a pistol replaces your pistol, anything else your main gun; you keep your own knife. The Rifle is
chikenT only, the Golden Rifle and defuse kit chikenCT only. Survivors keep what they bought. First
to 6 rounds wins.

Planting is easy to get right: a person on chikenT always gets the bomb if there is one (a bot
carrying it hands it over if you stand next to it and hold `E`), and holding `E` on a site plants it
even while you press a movement key: you crouch and stay put until it's done (letting go cancels).
Defusing works the same way. On screen: A / B markers (yellow for the carrier), the dropped bomb or its
carrier for chikenT, and the planted bomb with its timer for everyone. The bomb is a C4-style charge
whose little screen shows the code going in while it's planted, then the countdown (beeping faster and
faster, a red glow) and SAFE when defused; a big BOMB PLANTED / DEFUSED banner with an alarm, and a much
bigger explosion than a rocket (flash, fireball, debris, a smoke column, a hard shake).

**FaceChiken (ranked).** The same 5 vs 5 bomb rules, but only real players: no bots, registered
accounts only, quick play only (no private rooms), developer tools locked by the server, and it needs
at least 4 players to start. It's the only mode that moves your level: a win gives 30 rank points, a
loss takes 20, every kill gives 1 back (up to 10), and leaving a match that's underway counts as a loss
(-25). You never drop below the level you've reached, and each new level pays 250 coins.

**FaceChiken anti-cheat.** It all runs on the server (the browser can't be trusted):

- *Fog of war:* you're only sent an enemy's position once you could see them (line of sight from your
  eyes to their head, chest, feet or sides, a moment ahead for peeking, or within 7 m), so a wallhack has
  nothing to draw. Teammates are always sent.
- *Silent aim:* a shot must go roughly where you were looking (within 38° of one of your last few view
  directions; third person can be ~20° off up close). Others are thrown away and counted.
- *Aim lock:* people's hits land all over the head; an aimbot hits its exact middle. A match average
  that's too close to the centre (12+ head hits, or 15+ body hits) is caught.
- *Snaps* (a big flick landing dead centre on a head) and an almost-only-headshots rate over 30+ hits
  add suspicion.

Caught players are removed from the match (a loss) and get a strike: banned from FaceChiken for 24
hours, then 7 days, then for good. `npm run anticheat -- --list` shows strikes, `npm run anticheat --
<username>` one account, and `--clear` lifts it (built server: `node server/dist/tools/anticheat.js`).
Anything caught is also logged as `[anticheat]` in the server log. Speed hacks, teleports, rapid fire and
infinite ammo were already impossible: the server runs the movement and checks every shot.

**Arms Race.** Free for all, up to 12 chickens, 10 minutes. Everyone starts on the Rifle; each kill
with your current weapon moves you up a 17-weapon ladder (Rifle → Golden Rifle → Burst → Battle Rifle →
LMG → Minigun → SMG → Machine Pistol → Auto Shotgun → Shotgun → Sniper → Scout → Crossbow → Egg
Launcher → Revolver → Pistol → Golden Knife). A knife kill also counts, knocks the victim back a
level, and the last level is the Golden Knife alone: the first kill with it wins. No grenades, no
loot boxes. When time runs out, the highest level wins. Chickens spawn anywhere open on the map,
as far as possible from enemies and out of their sight, with 2.5 s of spawn protection (Against All
spreads spawns the same way, and bots roam the whole map instead of the spawn points).

**Maps.** Farmyard, Town (enterable houses, rooftops, streets), Sandstown (a desert town with two
bomb sites, Long A, Mid and B tunnels), Harbor (a dock maze of stacked shipping containers and cranes,
with two bomb sites), Frostbite (a snowy outpost with wooden cabins you can shoot through, and flag
bases for CTF), Factory (a walled warehouse with machines, conveyors and raised catwalks, for close
fights), and Flat World for building.

**Friends and parties.** 👥 Friends on the menu (registered accounts): add someone by their username,
accept or decline requests, and see who's online and what they're playing, live. Invite online friends to a
party (up to 5): the leader picks a mode and presses Play, and everyone in the menu comes along, into the
same room and onto the same team (bots give up their seats; a party only goes where it fits on one team,
so a party of 5 can't queue 3 vs 3 Knife Fight). Members wait for the leader; a member still in another
match holds the party up. Leave any time; going offline for 30 s takes you out; the next member leads.

**Progress.** A guest account is created automatically; register to keep progress across devices.
You earn coins after every match and spend them in the shop on skins, hats, beaks, sneakers and
weapons. There's a loadout of up to 4 guns plus a melee weapon.

**Ranks.** Level 1 to level 10, set by FaceChiken rank points (only the server changes them): 🥚 Egg 0,
🐣 Chick 100, 🐥 Hatchling 250, 🐤 Pullet 450, 🐔 Hen 700, 🐓 Rooster 1000, 🦅 Eagle 1350, 🔥 Phoenix 1750,
🏆 Legend 2200, 👑 Chicken King 2700, so the top takes a couple of hundred matches. Your rank and progress
bar are on the menu, everyone's badge is on the scoreboard, and the results screen shows what you earned.

**Leaderboards.** One overall and one for every mode (by wins, then kills; FaceChiken by rank points): the 🏆 button on
a mode card opens that mode's board. In a match, a small live board in the top-left corner shows the
top three (and you).

**Graphics.** A gradient sky with a sun and drifting clouds, hazy hills on the horizon, and sky-based
ambient light and reflections. Sharp shadows that follow the camera. Grass and flowers that sway in
the wind, and houses with windows. Bullet holes, sparks, ejected shells, muzzle flashes and
explosions that light up their surroundings, plus a glow (bloom) on bright things. **Settings →
Graphics** has Low / Medium / High quality (phones default to Medium) and a field-of-view slider.

**Settings.** Mouse, zoom/scope and touch sensitivity (aiming slows down automatically with the
zoom level), invert Y, and a crosshair editor with a live preview: style (cross, dot, circle, T…),
colour, size, thickness, gap, opacity, outline and dynamic spread. Everything is saved in the
browser and applies immediately, even mid-match.

**HvH setup.** Every human joining HvH starts outside combat, with a personal setup pause.
Choose **HvH Lab**, **Skeet**, or **Manual play**, configure your tools, and press **Begin match** to spawn.
Assisted panel access follows the passkey/public-rollout policy; Manual play is always available.
Changing panels later does not restore health, ammo or exploit charge. The typed panel registry
(`client/src/dev/panels.ts`) provides separate resolver and anti-aim configuration hooks for future panels.

**Skeet.** A separate nine-tab panel adapts the readable Skeet SDK's menu categories to this game.
It adds seven weapon profiles with multipoint, safe points, auto-stop and auto-scope; public-stance
history with confidence/body fallback; and standing, moving, crouching and airborne anti-aim policies.
The server computes target-facing/freestanding cover, deterministic jitter and bounded desync.
Visual pitch changes only the rendered chicken. Real pitch, hitboxes, spread, recoil and resources
keep the normal rules. Double Tap and Hide Shots retain their shared charge limits.

Skins tint your local first-person weapon. Players offers per-match targeting overrides. Configs
are stored separately from HvH Lab. Extensions applies native recipes; it does not run CSGO Lua.
The supplied SDK wraps compiled gameplay code, so its original resolver/anti-aim algorithms cannot
be verified or ported exactly. See [the adaptation map](docs/skeet-adaptation.md) for implemented
counterparts and deliberate substitutions. No SDK loader, binaries, hooks or offsets are bundled.

**HvH Lab.** Press `Insert`, choose *Pause → HvH panels*, or tap the lobby title five times on a phone.
The panel now has Aim, Anti-aim, Exploits, Movement, Visuals, Weapons, World, Telemetry,
Settings and Configs tabs. Old configs migrate automatically: retired stat-changing powers are removed.

**Classic mega?dev.** Press `L` for the old developer menu, exactly as it was: Legit, Rage (speed, fly,
noclip, infinite ammo, no recoil/spread, rapid fire, no rocket cooldown/damage...), Visuals, World,
Players, Weapons, Misc, Configs and Settings. It asks for the same passkey and keeps its own saved
settings (the first time it picks up the ones saved before the HvH Lab). It works wherever the server
allows developer tools except HvH (equal stats there: use the HvH Lab) and ranked; player
administration (teleport, heal, give weapons) only works in private rooms.

- Aim: target priority/lock, head or body aim, body-if-lethal, minimum health damage after armor,
  estimated hitchance from velocity-based spread, bounded turns, reaction/switch delays, and optional
  trigger/auto-fire. Autofire uses normal weapon cadence, including semi-auto and bursts;
  each due shot checks current camera aim, collision-resolved speed, cover, intervening enemies,
  loot and vehicles. Reload, switch, pause and stale-target checks prevent unwanted shots. `H` holds the minimum-damage override; `J` forces body aim.
- Autowall: optional shot selection through up to two crates, hay or wood boxes, retaining 65%
  damage per box. Stone, brick, concrete and metal still stop bullets. The normal server penetration
  rules decide every actual hit; prediction is an estimate.
- Anti-aim: backward, left, right or spin bases, up to 45° jitter and 58° real/fake desync. Hold `K`
  to invert. The server owns the real hitbox heading and separately replicates the fake body pose.
  All HvH players see a cyan real-heading marker; the resolver uses that authoritative stance.
  Ordinary shots reveal the stance for 300 ms. No fake pitch or invulnerability.
- Exploits: Double Tap permits one extra bullet within a 500 ms window, with a second-shot interval
  of `max(80 ms, normal interval × 0.2)` and an 8 s recharge. Normal damage, ammo, spread and reload
  still apply. Hide Shots delays the normal 300 ms stance reveal by 150 ms and recharges in 6 s.
  Both use one resource; switching mode/gun never restores charge. Projectiles, melee and native burst weapons cannot use it.
  Respawning starts an 8 s recharge.
- Movement: auto-stop changes ordinary movement intent; slow walk holds `Shift` at 45% input.
  Hold `Z` to mark a peek anchor. After firing, release movement keys while holding `Z` to return.
  Releasing `Z`, jumping, manual movement or an obstructed route cancels return. No teleporting.
- Telemetry: target, predicted damage/hitchance, shot decision, five recent shot entries, charge,
  and movement status. Balanced, Precision, Aggressive and Scout presets retain normal stats.

Public access is prepared but **off by default**. Set `HVH_PUBLIC_PANEL=1` when ready to let every
HvH player use the same panel without a passkey. This grants no access in other modes and no
administration privilege. Until rollout, the existing developer passkey/account rules apply.
Every HvH input, fire/reload and damage path clears legacy modifiers. Health/armor changes,
freeze, kill, respawn, weapon grants and teleports are rejected in HvH even for developers.
The older administration API remains restricted to authorized private non-HvH test rooms.
The panel has no damage/rate/speed multipliers, ammo/fuel cheats, rocket immunity, flight,
noclip, zero spread/recoil, silent shots, free camera or player-control buttons.

Design inspiration: primary [Neverlose release notes](https://forum.neverlose.cc/t/neverlose-site-and-csgo-update-24-06/29064)
for minimum damage, auto-stop and auto-peek, and [target/hitchance/body-aim notes](https://forum.neverlose.cc/t/neverlose-csgo-update-27-07/36286).
These are independent mechanics in this game, with shared server limits. Defaults are a starting
ruleset for PvP tuning; shot estimates do not guarantee a hit.

**Developer accounts.** Register an account in the game (*Save progress*), then on the server run
`npm run developer -- <username>` (on a built server: `node server/dist/tools/developer.js
<username>`). The account gets the name *Developer*, 9,999,999 coins (`--name` / `--coins` to
change), a rainbow glowing name for everyone (name tag, chat, kill feed, scoreboard,
leaderboard), and developer-menu access when `DEV_ACCOUNTS_ONLY=1` is set. There's no API or in-game way to
become a developer, only this command. *Developer*, *Admin*, *Moderator* and look-alikes
("Deve1oper", "D.e.v") are reserved: other players can't register or rename to them.

**Everywhere.** Mouse and keyboard with pointer lock, or touch controls on phones and tablets. Third
or first person (`V`). Synthesized sound effects.

### Controls

| Key           | Action                    | Key     | Action                       |
| ------------- | ------------------------- | ------- | ---------------------------- |
| WASD / arrows | Move (drive in a buggy)   | Mouse   | Look / aim                   |
| Space         | Jump (hold: bunny hop); drift (driving) | Click | Shoot (on foot or driving) |
| Space in air  | Glide / jetpack (again)   | V       | First / third person (saved) |
| Right-click   | Zoom / sniper scope       | R       | Reload                       |
| 1–4, wheel    | Switch gun                | 5       | Melee weapon                 |
| F             | Inspect weapon            | G       | Throw explosive egg          |
| Q / Z         | Smoke grenade / flashbang | E       | Get in / out of a buggy      |
| Tab           | Scoreboard                | Shift   | Nitro (driving)              |
| T / Enter     | Chat                      | Esc     | Pause                        |
| B             | Build mode (Sandbox) / buy menu (ChikenBomb) | X | Next block type (Sandbox) |
| E (hold)      | Plant / defuse the bomb (ChikenBomb) |  |                     |
| Ctrl / C      | Crouch (slower, smaller)  |         |                              |
| Insert        | HvH Lab menu (passkey)    | L       | Classic mega?dev (passkey)   |

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
  maps/                Farmyard, Town, Sandstown, Harbor, Frostbite, Factory, Flat World
  arms.ts, bomb.ts     Arms Race weapon ladder; ChikenBomb rules and economy
  modes.ts, items.ts   game modes; shop catalogue (cosmetics + weapons)
  protocol.ts          every socket message and the compact snapshot format
server/src/
  app.ts               Express + Socket.IO wiring, socket auth, event routing
  api.ts, auth.ts      REST API: guest/register/login, profile, shop, leaderboard
  db/Database.ts       SQLite schema, migrations, purchases, match rewards
  rooms/RoomManager.ts quick play, private rooms with codes, room lifecycle
  rooms/GameRoom.ts    players, lag-compensated combat, damage, match flow, chat
  rooms/*System.ts     projectiles, loot boxes, vehicles, bots
  rooms/BombRoom.ts, ArmsRoom.ts, CtfRoom.ts, SandboxRoom.ts   mode-specific rules
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
  dev/                 HvH Lab: tabs.ts (controls), DevRuntime (aim / movement), tactics (shot estimates),
                        config migration and presets. Legacy directory name is retained.
                        DevOverlay (ESP), DevDebug3D (hitbox/collision outlines)
server/src/dev/        passkey check + permissions (DevAccess), player actions (devActions)
shared/src/dev.ts      private testing modifiers and access status
shared/src/hvh.ts      bounded real/fake poses and shared exploit recharge rules
```

To add a panel feature: add a field to `DevConfig` (`client/src/dev/config.ts`) and a control
in `tabs.ts`. HvH abilities must have bounded shared rules in `shared/src/hvh.ts`, server
authorization through `devHvh`, and tests for resource/cooldown and mode isolation.

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
