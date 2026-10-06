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
- The menu used to circle over the farm. Now your own chicken (army helmet if you wear no hat, rifle in hand) poses in front of one map at a time: Sandstown, Harbor, Town, Frostbite and Farm, 9 seconds each, with a quick fade to black between them.
- The chicken stands on the left, where the menu has free space; the camera is low and close and drifts slowly. A spot with room in front and a view behind is picked on each map.
- A small 🎬 button (bottom right) hides the menu so you can look at the whole scene.
- Code: [client/src/game/Game.ts](../client/src/game/Game.ts) (showcase), [client/src/ui/MainMenu.ts](../client/src/ui/MainMenu.ts) (the button). It stops when a match or the shop opens.

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
