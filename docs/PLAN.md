# Build plan: ChikenRunHvh (a chicken shooter in the browser)

> **Status: all five phases are built and tested** (see the README for how to run it).

Goal: a complete multiplayer chicken shooter, playable in any desktop or mobile browser, inspired by
ChaloApps' *Chicken Gun*. Already working: 3D world, chickens, movement, online multiplayer with
client prediction.

## Ground rules (apply to every phase)

- **The server decides everything that matters:** hits, damage, deaths, pickups, scores, coins. The
  client only sends intent (inputs, "I fired in this direction") and predicts, so cheating is hard.
- **Gameplay physics lives in `shared/` and is deterministic.** Client and server run the same code.
- **No downloaded assets.** Models, textures and sounds are generated in code, so the game stays
  small and has no licensing problems.
- **Each phase ends playable and tested:** typecheck, automated tests, and a real headless-browser
  play test with screenshots.

---

## Phase 1: Guns, health, death and respawn ✅

| Feature | How |
|---|---|
| 4 starter guns: Pistol, Rifle (auto), Shotgun (pellets), Sniper (zoom) | Weapon table in `shared/weapons.ts` (damage, fire rate, magazine, reload time, spread, range) |
| Shooting | Client: mouse click → ray from camera through crosshair → aim direction from the chicken's eye. Server: validates fire rate, ammo and reload, then raycasts |
| Fair hit detection (lag compensation) | Server keeps ~1 s of position history and rewinds targets to what the shooter saw |
| Headshots | Body box + head sphere per chicken, headshot ×2 (sniper ×2.5) |
| Health 100, armor absorbs 50% | Sent in snapshots; HUD shows health and armor bars |
| Death | Kill event → chicken flops over with a feather burst, kill feed entry, killer shown on the death screen |
| Respawn | 3 s timer, spawn far from enemies, 1.5 s spawn protection |
| Feedback | Tracers, muzzle flash, impact puffs, hit marker, red damage-direction indicator, recoil |
| Weapon switching and reload | Keys `1`–`4` / mouse wheel, `R` reload; the gun model is held by the chicken |

## Phase 2: Explosive eggs, jetpack, loot boxes ✅

| Feature | How |
|---|---|
| Explosive egg (`G`) | Thrown projectile simulated on the server at 64 Hz (the client draws the same path). Breaks on impact: area damage with falloff, knockback, walls block damage |
| Smoke grenade (`Q`) | Projectile that releases a smoke cloud for 10 s |
| Knockback | Physics gets an external velocity with friction, so explosions push chickens around (predicted and reconciled) |
| Jetpack | Fuel in the movement state; hold `Space` in the air to fly; fuel bar in the HUD |
| Chicken glide | Holding `Space` while falling slows the fall (flapping wings) |
| Loot boxes | Floating mystery boxes at fixed spots. Shoot one to break it; it drops a random pickup (medkit, armor, jetpack fuel, eggs). Boxes respawn after 20 s |
| Rocket launcher | Reuses the projectile system (straight flight, splash damage). Unlocked in the shop in Phase 4 |

## Phase 3: Game modes, rooms, scoreboard ✅

| Feature | How |
|---|---|
| Lobby | Main menu → Quick Play (Against All / Team Fight), server browser, create a private room (share its code) |
| Rooms | Server `RoomManager` with many `GameRoom`s; each has a mode, a map and a player cap |
| **Against All** (FFA) | Up to 12 players, first to 25 kills or 5 min |
| **Team Fight** (5v5) | Red vs Blue, auto-balanced teams, team spawns, no friendly fire, first to 40 kills or 6 min |
| **Duel** | 1v1, first to 10 |
| Match flow | Warm-up → playing → results screen (10 s, winner and MVP) → next match |
| HUD | Timer, team scores, kill feed, `Tab` scoreboard (kills, deaths, ping) |
| Chat (`T`) | Rate-limited, length-limited, shown as plain text (no HTML injection) |
| Second map: **Town** | Enterable houses, streets, rooftops; the map is chosen per room |
| First / third person (`V`) | First-person view with a gun held in front of the camera |
| Sound | Synthesized with WebAudio: shots per weapon, explosions, hits, jetpack, clucks |
| Mobile controls | Virtual joystick, drag to look, buttons for fire / jump / egg / reload / weapon |

## Phase 4: Coins, shop, cosmetics (accounts and database) ✅

| Feature | How |
|---|---|
| Database | Node's built-in SQLite (`node:sqlite`, no native install). Tables: users, sessions, inventory |
| Accounts | Automatic guest account on first visit; optionally register a username and password to keep progress. Passwords hashed with scrypt; session tokens stored hashed |
| Coins | Earned at the end of each match (participation + kills + win bonus); stats saved (kills, deaths, wins) |
| Shop | Weapons (SMG, Minigun, Rocket Launcher, Golden Rifle) and cosmetics. The server checks the price and ownership |
| Cosmetics | Hats (cap, cowboy, top hat, crown, party hat, helmet), beaks, sneakers, feather colours. All built in code |
| Customize screen | 3D preview of your chicken; equip items and pick a 4-weapon loadout |
| Leaderboard | Top players by kills and wins |

## Phase 5: Vehicles, building, extra modes ✅

| Feature | How |
|---|---|
| Vehicles | Drivable farm buggy (`E` to enter/exit). Car physics in `shared/` so driving is predicted too. Running over chickens does damage |
| Building mode (**Sandbox**) | Place and remove blocks (several materials) on a grid. The server validates and syncs blocks; they're solid for everyone (a collision grid keeps this fast) |
| Bots | Server-side AI chickens that roam, aim and shoot (difficulty-adjusted); can fill empty rooms or power an offline-style practice mode |
| Capture the Flag | Team mode: grab the enemy flag (dropped on death), bring it home |

---

## Controls (desktop)

| Key | Action | Key | Action |
|---|---|---|---|
| WASD | Move | Mouse | Look |
| Space | Jump / glide / jetpack | Left click | Shoot |
| Right click | Zoom / scope | R | Reload |
| 1–4, wheel | Switch weapon | G | Explosive egg |
| Q | Smoke grenade | E | Enter/exit vehicle |
| V | First/third person | B | Build tool (Sandbox) |
| Tab | Scoreboard | T | Chat |
| Esc | Pause menu | | |

## Testing

- `npm test`: unit tests (physics, raycasts, damage, weapon rules, packing) and integration tests
  that start a real server and connect bot clients (combat, modes, shop, database).
- Headless Chrome play tests with screenshots after each phase.

## Risks and how they're handled

| Risk | Mitigation |
|---|---|
| Bandwidth with many players | Compact array snapshots, numbers rounded to mm |
| Cheating | Server validates fire rate, ammo, reach, ownership and input rate; clients never report damage |
| Lag | Prediction for own movement, interpolation for others, lag-compensated hits |
| "Chicken Gun" is ChaloApps' brand | Done: the game is now called ChikenRunHvh |
