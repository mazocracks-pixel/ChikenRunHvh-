# ChikenRunHvh: plan, ideas and progress

_Working document, last updated 6 Oct 2026. Part 1 is the plan, part 2 the ideas, part 3 what was done,
part 4 how bunny hop works, part 5 what to do next._

## 1. The plan

| # | Feature | Status |
| --- | --- | --- |
| 1 | Bunny hop: hold Space or time it | Done |
| 2 | Key rebinding | Done |
| 3 | Report a player | Done |
| 4 | Daily challenges | Done |
| 5 | Match history (last 10 matches, K/D, headshot %) | Done |
| 6 | Ranks (MMR) | Waiting for a decision (see part 5) |
| 7 | New modes: Chicken Run (timed parkour race) and Fox Hunt (infection) | Not started |
| 8 | Killcam / spectate, practice range with bots | Not started |
| 9 | ImGui-style cheat menu for mega?dev (look only; security stays on the server) | Not started |
| 10 | Title screen background: your chicken posing in front of our maps | Done |
| 11 | Zombie Apocalypse mode (waves, bosses, shop, 10-second builds, night map) | Done |
| 12 | Sniper double scope (scroll 4× / 8×) and 25% less wallbang damage | Done |
| 13 | Kill feed icons (weapon silhouettes and a symbol for each kill type) | Done |
| 14 | ChikenBomb: no shooting or throwing in buy time; melee swings don't kick the camera | Done |

Earlier in the same stretch (also done): Squad Up mode, With bots / Without bots lobby choice,
Y and U chat, jumpscares and funnyChiken, unlimited flashbangs in Rage, dark brown mega?dev,
new shop hats, skins, beaks and shoes, passkey-free HvH panels, and your own jumpscare sound.

## 2. Ideas (not planned yet)

- Seasonal ranked resets with rewards.
- Clan tags and clan leaderboards.
- More hats, skins and emotes in the shop.
- Map vote at the end of a match.
- Replay of the last kill from the killer's point of view.
- Quick chat wheel ("Nice!", "Help!", "Push B").
- Weekly challenges with bigger rewards, and a streak bonus for finishing the dailies several days in a row.
- A "Report" shortcut on the scoreboard, and a small in-game list of past reports for the owner.
- Headshot percentage and favourite mode on the profile.
- Sound options: let players pick a different jumpscare sound, or turn the scare sounds down.

## 3. What was done

### 1. Bunny hop (hold or time it)
- [shared/src/physics.ts](../shared/src/physics.ts): holding Space now jumps again on landing, and tapping Space on the landing tick still works. Neither one adds speed; speed comes from air strafing.
- [server/src/rooms/GameRoom.ts](../server/src/rooms/GameRoom.ts): if the server misses a command it keeps remembering the held key but never invents a landing jump.
- The main menu hint now says "hold Space to bunny hop, or tap it right as you land". Tests updated.

### 2. Key rebinding
- New [client/src/keybinds.ts](../client/src/keybinds.ts): the list of keys, defaults, saving on the device, safety rules.
- [client/src/game/Input.ts](../client/src/game/Input.ts) reads the player's keys instead of fixed ones.
- Settings has a new **Keys** tab: click a key, press the new one, Esc cancels, a key already used swaps places, "Reset all keys".
- Menus, 1-9 weapon slots, Tab, Enter and the dev menus (L, Insert) keep their keys and can't be bound.

### 3. Report a player
- Pause menu has **Report a player**: pick who and a reason (cheating, abuse, griefing, other).
- The server saves it (new `reports` table), logs a `[report]` line, rate limits it, and allows one report per player per 10 minutes. Bots and yourself can't be reported.
- You read reports with `npm run reports` (all) or `npm run reports -- <username>`; on Railway: `node server/dist/tools/reports.js`.

### 4. Daily challenges
- Three a day (UTC): kills, matches played, matches won. Goals are picked from the player and the day, so the server and client agree.
- Progress counts every finished match in any mode. Each challenge pays coins once when reached (kills 5 coins each, matches 20, wins 60 per goal point), with a toast after the match.
- Main menu button **Daily challenges** shows progress bars and when they reset. New `daily_progress` table.

### 5. Match history
- Every finished match is saved per player (mode, win or loss, kills, deaths, headshot kills); the newest 30 are kept.
- Account page shows **Last 10 matches** with K/D, headshot % and how long ago. New `match_history` table.

### 10. Title screen background
- The menu used to circle over the farm. Now your own chicken (army helmet if you wear no hat, rifle in hand) **runs a big oval round the house on its own map, the Courtyard**: a sandy yard with a sandstone house in the middle, a pergola, hedges, palms and crates. No game mode uses that map, so it is for the title screen only.
- The camera runs ahead of the chicken on the same oval and looks back, so the chicken runs toward the camera and faces it (a little turned to one side). The chicken is on the right of the screen; its head thrusts and sways on every step (title screen only: in matches the drawn head has to stay on the hitbox).
- The oval is `LOBBY_LAP` in [shared/src/maps/lobby.ts](../shared/src/maps/lobby.ts); a test checks it stays clear of every box. Change the numbers there to make the loop bigger.
- A small 🎬 button (bottom right) hides the menu so you can look at the whole scene.
- Code: [client/src/game/Game.ts](../client/src/game/Game.ts) (showcase), [client/src/ui/MainMenu.ts](../client/src/ui/MainMenu.ts) (the button). It stops when a match or the shop opens.

### 11. Zombie Apocalypse
- A co-op mode (up to 4 survivors) on the new **Graveyard** night map, with a merchant hut in the middle. Menu: Fun tab, 🧟.
- **Zombies** are normal bot chickens driven by their own AI. Wave 1-2 walk straight at you; from wave 3 they follow waypoints round walls; from wave 6 some circle round to flank. They hit with claws, and chew through your builds when one blocks them.
- **Waves:** 10 seconds of preparation before every wave, with a visible countdown. Zombies per wave, health, speed, damage and attack speed all scale per wave. Runners from wave 3, brutes from wave 5.
- **Bosses** every 5th wave, with a horde: a health bar at the top, a ground slam (windup, then damage and knockback), and at half health it calls zombies. Big money for the kill; each boss is tougher.
- **Money and shop (B, only between waves):** kills pay money (a quarter of it to teammates), clearing a wave pays a bonus. The shop sells first aid, full heal, armor, ammo, explosive eggs, guns (SMG to rocket launcher) and up to 5 damage upgrades for the gun in your hands.
- **Building (C):** a 3 wide, 2 high wall in front of you. Every block shrinks, blinks and turns red in its last 2.5 seconds, and is gone after 10 seconds. Zombies can break it sooner. Crouch moves to **Ctrl** in this mode.
- **Dying:** no respawn mid-wave; you come back at the start of the next wave. When all survivors are down: game over with the wave reached and kills, and a Restart button.
- **Cheats:** only mega?dev (L) works here. The HvH panels only open in HvH.
- **All numbers in one place:** [shared/src/zombies.ts](../shared/src/zombies.ts) (the ZOMBIE object). Server: [server/src/rooms/ZombieRoom.ts](../server/src/rooms/ZombieRoom.ts) and [server/src/rooms/zombies/ZombieBrain.ts](../server/src/rooms/zombies/ZombieBrain.ts). Map: [shared/src/maps/night.ts](../shared/src/maps/night.ts). Screen: [client/src/ui/ZombieHud.ts](../client/src/ui/ZombieHud.ts).

### 12. Sniper double scope and weaker wallbang
- **Double scope:** right-click scopes the sniper at 4× as before; while scoped, **scroll the mouse wheel** to switch to 8× and back. The hint line shows the current zoom. Unscoped, the wheel still switches weapons. The 8× level is `zoom2` on the sniper in [shared/src/weapons.ts](../shared/src/weapons.ts) (the Scout keeps its single scope).
- **Wallbang:** a bullet through a box now keeps 0.4875 of its damage (it was 0.65, so 25% less than before; two boxes compound). One number: `WALLBANG.damageScale` in [shared/src/wallbang.ts](../shared/src/wallbang.ts).

### 13. Kill feed icons
- The kill feed now looks like Counter-Strike's: killer, a **weapon silhouette** (pistol, SMG, rifle, sniper, shotgun, LMG, launcher, crossbow, knives, katana, pan, egg, car, bomb), then a **symbol for each way it was done**: no scope, through smoke, through a wall (a door with an arrow), in mid-air, headshot (a skull). A blind killer gets the crossed-out eye before their name.
- Rows with you in them have a red edge. Hover an icon to see its name.
- Code: [client/src/ui/KillIcons.ts](../client/src/ui/KillIcons.ts) (all the drawings, in one place) and [client/src/ui/Hud.ts](../client/src/ui/Hud.ts).

### 14. ChikenBomb buy time and knife recoil
- During the 15-second buy time the server already refused every shot and throw, but your screen still let you fire (flash, sound, ammo going down) while nothing happened. The game now simply does not fire or throw in buy time, and tells you when you try a grenade. Warmup is unchanged (you can still shoot there).
- Knife, pan, katana and the other melee weapons no longer kick the camera when you swing.

### Notes on safety and checks
- Every step has tests; the full suite was 355 passing tests at the end of this stretch, and the build passes.
- Two pull requests from mazocracks-pixel (#3 and #4, HvH rewrite) were merged on GitHub in the middle of this work. They were read for network calls, secrets and permission changes before building on top, and nothing unsafe was found.
- Databases are upgraded automatically on start (now at version 10). Nothing needs to be run by hand.

## 4. Bunny hop (how it works)

You can bunny hop in two ways, and both give exactly the same result:

- **Hold Space.** You hop again the moment you land. This is the easy way: you need to hold the key down.
- **Time it.** Release Space in the air and tap it again right as you land. This is just as fast, and you can chain it without holding anything.

Neither way gives extra speed by itself. Speed comes from air strafing: in the air hold A or D and turn
the mouse the same way. The takeoff speed is capped at 110% of your running speed, so holding Space on its
own never builds speed.

## 5. What to do next

1. **Decide about ranks (plan item 6).** Should the 5 MMR ranks (Egg, Chick, Hen, Rooster, Golden Rooster) replace the current 10 levels, or exist next to them? My suggestion is to replace them, to keep one clear ladder.
2. **Deploy.** On Railway press Ctrl+K and choose Deploy Latest Commit. The database upgrades itself.
3. **New modes (item 7).** Chicken Run first: it suits the bunny hop movement and gives a best-time leaderboard.
4. **Killcam, spectating and the practice range (item 8).**
5. **ImGui look for mega?dev (item 9)** once the gameplay features are in.
