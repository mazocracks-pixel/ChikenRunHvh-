# DOCS: plan, progress and mistakes

Working notes, one batch of work at a time (newest first). Each batch has its plan, what was done
for each step, and a log of every mistake made along the way (what went wrong, and how it was fixed).

# Batch 4 (7 Oct): a better chicken, same hitboxes

## The plan

The hitboxes live in shared code (`HITBOX`, `buildHvhMatrix`, `CHICKEN_POSE`) and are not touched; only the drawing in [client/src/game/models/Chicken.ts](client/src/game/models/Chicken.ts) changes. The head stays exactly where its hitbox is (a test checks it), and the new parts stay inside the old outline.

| # | Step | Status |
| --- | --- | --- |
| T | Feathers: a soft feather texture with relief, smooth shading, rounder shapes | Done |
| U | Head: a serrated comb, an upper and a lower beak, two wattles, earlobes (same cartoon eyes) | Done |
| V | Body: a fuller chest, wings made of layered feathers, a tail with two long sickle feathers | Done |
| W | Legs: feathered thighs, thinner shanks, real toes (three forward, one back) | Done |
| X | Checks: shared hitbox code unchanged, the head test passes, the new parts stay inside the old outline, screenshots | Done |

## What was done (batch 4)

- **Hitboxes: unchanged.** Nothing in `shared/` or `server/` changed (`HITBOX`, `buildHvhMatrix`, `CHICKEN_POSE` are as they were). The drawn head is the same sphere in the same place, and the head test still checks it sits exactly on the hit head while walking, aiming and crouching. Body, chest, wings and thighs stay inside the old outline; a wireframe of the real hitboxes over the new model matches as before.
- **T. Feathers.** One small feather-scale texture (rows of rounded tips), used for colour and slight relief and tinted per skin, on smooth, rounder shapes. Metal skins (golden, robot, diamond) stay shiny.
- **U. Head.** A serrated comb (one piece, hidden under hats as before), an upper and a slightly open lower beak (both take the beak cosmetic), two wattles and red earlobes. The cartoon eyes and brows stay.
- **V. Body.** A rounder chest inside the body; wings with a shoulder and three flight feathers; the five-feather tail fan plus two long sickle feathers in the darker wing shade.
- **W. Legs.** Feathered thighs, thinner shanks, and three toes forward plus one back instead of the box foot. Shoes still replace the feet.
- **Cost.** The new parts are merged into a few meshes (tail, sickles, each wing, each foot), so a chicken draws about as many pieces as before (around 40).
- **X. Checked.** A four-side turntable of four skins (white, shadow with helmet and shoes, golden, brown), the hitbox overlay, the title screen on High, and all 418 tests, the typecheck and the build pass.
- Code: [client/src/game/models/Chicken.ts](client/src/game/models/Chicken.ts). The head test's stand-in canvas now accepts any drawing call: [client/test/chicken-pose.test.ts](client/test/chicken-pose.test.ts).

## Mistakes log (batch 4)

1. **First pass looked knitted.** The feather pattern was too dense and too strong. **Fix:** bigger, fainter scales and less relief.
2. **A wing feather poked out below the body at the back, and the comb looked like a stick from the front.** **Fix:** shorter, flatter flight feathers inside the old wing outline, and a thicker comb.
3. **Test-script slip.** I asked for a "gold" skin (it's "golden"), so the first turntable showed white twice. Fixed in the script.

# Batch 3 (7 Oct): a new look for every screen (not the chicken, not the cheat menus)

## The plan

Look: the sky blue `#9fd4f5` as the base, egg-yolk yellow and barn red as accents, dark-brown "ink" outlines, and cream "paper" panels. One bold display font, **Lilita One**, self-hosted, on every title, button and big number. Buttons are chunky, with a thick outline and a hard drop that sinks when you press it. No gradients, glass, glows, soft shadows or emoji icons; icons are drawn as SVG.

| # | Step | Status |
| --- | --- | --- |
| L | The look: colours, font, buttons and panels, scoped to the game's own screens so the Skeet / Lab / mega?dev menus can't change | Done |
| M | Title screen: the running chicken stays exactly as it is; a huge logo, one obvious PLAY, a small menu on the left, nothing over the chicken (phone too) | Done |
| N | Mode select (and the HvH panel choice): bold tabs, mode tickets with drawn icons | Done |
| O | In-match HUD: smaller, tucked into the corners, nothing over the middle | Done |
| P | Match over: a huge score first, then the next-match countdown, then the rest | Done |
| Q | Dev code entry: a keypad with a masked display (the code is never shown) | Done |
| R | Pause and Settings in the same style; big tap targets on phones, no zoom | Done |
| S | Screenshots of every screen, with the chicken and the cheat menus in place | Done |

Notes on the brief: this is a shooter, so the HUD shows health, ammo, kills and the timer (there is no distance). A match ends with an automatic next match, so "retry" is that countdown.

## What was done (batch 3)

- **L. The look.**
  - New section at the end of [client/src/style.css](client/src/style.css) ("Barnyard"). Colours: sky `#9fd4f5`, yolk `#ffc533`, barn red `#b8362b`, ink `#2b1a10`, paper `#fff3d6`.
  - Font: **Lilita One** (`@fontsource/lilita-one`, self-hosted, so the CSP stays `font-src 'self'`) on titles, buttons and big numbers; body text stays plain.
  - Buttons have a 3px ink outline and a hard 4px drop that sinks on press. Panels are paper with a hard offset shadow. Icons are drawn SVG ([client/src/ui/icons.ts](client/src/ui/icons.ts)), replacing every emoji icon on these screens.
  - Everything is scoped to the game's layers with `:where()`, so it stays low-priority there and never reaches `<body>`, where the Skeet, Lab and mega?dev menus live. dev.css is untouched apart from deleting the old passkey dialog's rules.
- **M. Title screen.**
  - The chicken is untouched (sprite, run, speed, position). A big yolk logo with a barn-red HVH stamp, one tilted PLAY with a red play disc, then small paper tags for the rest (Shop, Friends, Daily, Top chickens, Settings).
  - Today's challenges and what's new are two small tickets between the menu and the chicken.
  - On phones the logo sits on top and PLAY plus a row of five big icon buttons at the bottom; the middle stays clear for the chicken.
- **N. Mode select ("Pick a fight")** is a paper board: bold tabs (Casual / Serious / Silly) and mode tickets with drawn icons. Ranked FaceChiken gets a barn-red top edge. The **HvH panel choice** ("Pick your panel") uses the same tiles and fits on a laptop screen.
- **O. HUD.** Smaller, outlined text and dark ink tags in the corners: K/D and leaders top-left, timer and team chips top-centre, health bottom-left, ammo bottom-right. The middle stays clear. On phones the thumbs own the bottom, so health sits under K/D, the ammo under the corner buttons, and the kill feed below it.
- **P. Match over.** The winner line, then your score, huge, counting up (a score tick, instant with reduced motion). Then "Next match in 8" as the retry, "Esc for the menu", then the stats, the final score, MVP, rewards and the table.
- **Q. Dev code.** A keypad: a dark display that only shows dots (never the code), keys 0-9 with Del and OK, and "Type letters" for codes with letters (keyboard typing works too). The server still checks every code. Its wrong-code message is now "Nope. Wrong code." Both menus share one keypad (`client/src/dev/classic/passkey.ts` re-exports it).
- **R. Pause and Settings.** Pause is a paper card with a big "Paused" and one obvious "Click to jump back in". Settings and the other dialogs are paper with yolk tabs (no emoji), and the old grey labels are readable. All taps are at least 44px, fields use 16px text (phones don't zoom), and the page already blocks pinch zoom.
- **S. Checked.**
  - Screenshots of every screen on desktop and phone, the Skeet and Lab menus open in place unchanged, and `check-native-menu.cjs` passes.
  - The keypad test: taps, typing, Del, a wrong code, then the right code; the code never shows.
  - Typecheck, all 400 tests and the build pass.

## Mistakes log (batch 3)

1. **The phone title covered the chicken at first.** The hidden party strip let the grid rows shift, so the menu jumped up under the logo. **Fix:** every part of the title screen has a fixed row.
2. **My HUD corner rules broke the touch layout.** Setting bottom/right on the HUD corners fought the phone rules (which move them to the top), and the ammo box landed mid-screen. **Fix:** only the phone rules position them. (The phone HUD was already crowded before this batch; it is tidied now.)
3. **Settings labels were grey on cream.** The old rules use the dark-theme colour variables. **Fix:** the paper panels redefine those variables, so every old rule follows. The same leftovers caused an old border on the "Match starts" banner and grey tabs in the mode select; both fixed.
4. **I broke the Skeet QA script twice with copy changes.** "Change mode" became "Switch mode", and dropping the emoji left two buttons named exactly "Create room". **Fix:** the script looks for "Switch mode" and clicks Create room inside the dialog. **Rule:** run `check-native-menu.cjs` after any menu wording change.
5. **A keypad bug, caught by its test.** After tapping a key, pressing Enter "clicked" that key again. **Fix:** Enter always submits.
6. **Test-script slips (not game bugs).** My first match-over screenshot was undone by live server updates, and a wait for the keypad was too short for the slow software renderer. Fixed in the scripts.

# Batch 2 (6 Oct): lobby music, a wider lap, a better Skeet panel

## The plan

| # | Step | Status |
| --- | --- | --- |
| G | Lobby music: `CHIKEN_HVHLOBBY` loops on the title screen, fades out when a match starts, has its own volume in Settings | Done |
| H | The title-screen chicken's lap: wider again, still clear of every wall | Done |
| I | Skeet panel (C++ compiled to WebAssembly): install the exact compiler it was built with (Emscripten 4.0.22), check the unchanged source rebuilds and works, then make it better | Done |
| I1 | Tabs: a drawn icon for each tab (crosshair, shield, pistol, eye, gear, paint drop, player) instead of plain text, in the menu colour when selected | Done |
| I2 | Section headings in bold with a divider line; info lines in grey; sliders, lists and buttons lined up with the original Skeet controls | Done |
| I3 | Remove the ~20 "(unavailable)" lines that only cluttered Visuals and Misc | Done |
| I4 | **Menu color** picker (Misc > Settings), like real Skeet: recolours ticks, sliders and the selected tab icon, and is saved with your config | Done |
| I5 | Fixes: the Skins tab's two empty boxes, three buttons all called "Apply", bot names showing "?" (the emoji has no letter in the menu font), and the Legit tab ignoring a click | Done |
| J | (added mid-batch) Bug: holding the Shadow Daggers makes the screen flash blue. Find the cause and fix it | Done |
| K | (added mid-batch) **M** switches your team (Red to Blue, Blue to Red), checked by the server. Not in FaceChiken: ranked teams are random and can't be changed | Done |

Same rules: read first, smallest change that works, test, look at it in the browser, commit only when every test passes.

## What was done (batch 2)

### G. Lobby music
- `CHIKEN_HVHLOBBY.mp3` is in `client/public/sounds/` with its exact name. It loops on the title screen and in the shop, fades in (0.8 s) and fades out when a match starts, and comes back when you return to the menu.
- Checked before adding: the track is 36.6 s long, with 0.2 s of silence at the start, which would leave a gap every loop. It is trimmed when the file loads, so the loop is seamless. It is loud (it peaks at full volume), so it starts at 40% volume.
- Browsers only allow sound after your first click or key press, so the music starts at that moment (any click or key on the page counts).
- **Settings > Sound** has a new **Lobby music** slider (0 turns it off). The main Volume slider also turns it down. It skips the effects compressor, so gunshots in a match never make it "pump".
- Checked in the browser: silent before any click; after a click it plays, looping, at 40%; in a match it stops; back on the menu it plays again; music volume 0 silences it; no errors.
- Code: [client/src/game/Audio.ts](client/src/game/Audio.ts) (`setMusic`), [client/src/app/App.ts](client/src/app/App.ts), [client/src/ui/Dialogs.ts](client/src/ui/Dialogs.ts).

### H. A wider lap
- The title-screen chicken's oval went from 12 x 10 m to 18 x 15 m (half-widths), half as wide again. One lap now takes about 16 seconds.
- Nothing had to move: the test that checks every point of the lap is at least 3 m from any wall, post, palm or hedge still passes, and the pergola and palms now pass right behind the chicken.
- Checked in the browser: four screenshots around the lap, no errors.
- Code: `LOBBY_LAP` in [shared/src/maps/lobby.ts](shared/src/maps/lobby.ts).

### I. The Skeet panel, in its C++
- **The compiler first.** Installed Emscripten 4.0.22 (the version the panel was built with) and rebuilt the *unchanged* C++. The output was byte-for-byte the same as the committed `menu.js` / `menu.wasm`, so any change after that comes only from the edits.
- **Before screenshots of all 7 tabs** showed what to fix: plain-text tabs; section names that looked like ordinary labels; sliders and lists out of line with the original controls; about 20 "(unavailable)" lines; three buttons all called "Apply"; two empty boxes on Skins; bots shown as "? Omelette"; and a click on Legit that did nothing.
- **I1 Tab icons**: drawn in C++ with ImGui shapes (the original icon font is missing): crosshair (Rage), half-filled shield (Anti-aim), pistol (Legit), eye (Visuals), gear (Misc), paint drop (Skins), head and shoulders (Players), with the name underneath. Grey, brighter on hover, and the menu colour when selected.
- **I2 Layout**: section headings are bold with a thin divider; info and status lines are grey, so they read differently from settings; sliders, lists and buttons line up with the names of the ticks, as in the original menu; spacing matches the original boxes.
- **I3**: the ~20 "unavailable" lines (Knifebot, Zeusbot, Ragdoll gravity, Danger Zone, money, hands…) are gone, and so is the dead code behind them.
- **I4 Menu color** (Misc > Settings): one picker recolours every tick, slider and the selected tab. It is saved with the config like every other panel setting (C++ `Config.h` field, the bridge, `nativeFields.ts`). Checked: set to red, everything turned red; picking a colour in the picker wrote it to the config and to storage.
- **I5 Fixes**
  - **The lost click (Legit).** ImGui applies a click over two frames, and the second frame used wherever the mouse was *by then*. Click and move away quickly, or click while the game runs slowly, and the release landed somewhere else, so the click was lost. `browser.cpp` now uses the press position on the press frame and the release position on the release frame.
  - **Duplicates.** Every box called "Other" (in Anti-aim, Legit and Misc) drew the same controls, so the Resolver settings showed up three times. Legit is now one "Triggerbot" box, and Misc's "Other" holds the recipes.
  - Skins is now "Weapon skin" and "Weapon stats", with no empty boxes.
  - The recipe buttons are named: "Apply precision safe points", "Apply ground peek", "Apply state jitter".
  - Bots read "Sunny (bot)": the menu font only has Latin letters, so other symbols are swapped or dropped.
- **Checked**
  - Typecheck, all tests (one new: every saved panel setting has its C++ case, so the two can't drift apart) and the build all pass.
  - `scripts/check-native-menu.cjs` passes: 7 tabs, key binding, colour pickers, save and load, small window, scene effects, reset when you switch panels, and FFA untouched.
  - After screenshots of every tab.
- Code: [client/native/skeet/menu/Menu.cpp](client/native/skeet/menu/Menu.cpp), [client/native/skeet/browser.cpp](client/native/skeet/browser.cpp), [client/src/dev/skeet/NativeMenu.ts](client/src/dev/skeet/NativeMenu.ts), rebuilt [client/public/skeet-native/](client/public/skeet-native/).

### J. Bug: the Shadow Daggers flashed the screen blue
- **Reproduced first.**
  - A test account bought and equipped the Shadow Daggers and played Knife Fight while holding attack.
  - Software rendering (7 fps) never showed it. On the real graphics card (180 fps) on **High** quality, **8 of 30 frames were solid light blue**, with only the HUD left.
  - The same test with the normal Knife: 0 of 30. On Medium and Low: 0 of 30. So it was the daggers, and only with High's bloom.
- **The cause.**
  - Scanning every weapon model for broken numbers found one problem in all 29 guns and knives: the daggers' blade had 42 points with a zero-length normal (84 for the pair).
  - Its short, wide tip with a bevelled edge made 14 zero-area triangles. Zero-area triangles have no direction, and lighting one gives NaN, an invalid number.
  - On High, the bloom blur spreads a single NaN pixel over the whole screen, so the screen showed only the sky colour behind it, which is the blue.
  - Every swing (and holding attack swings again and again) brought those slivers into view: blink, blink.
- **The fix.** The blade builder drops zero-area triangles (`dropFlatTriangles` in [client/src/game/models/Guns.ts](client/src/game/models/Guns.ts)). They are invisible anyway, so the blade looks exactly the same.
- **Checked**
  - The same High test, twice: 0 of 30 blue frames.
  - All 29 models are clean.
  - A new test checks every blade size the knives use has a proper normal on every point.

### K. M switches team
- **M** (rebindable in Settings > Keys) asks the server to move you to the other team. The server decides; the game only explains a "no".
- **Refused** in FaceChiken (ranked, random teams), Zombie Apocalypse (everyone on one side) and modes with no teams. A 5-second cooldown stops hopping back and forth. Teams can't end up more than 2 real players apart.
- **Like CS:** switching while alive costs that life, with no death counted and no penalty, so it can't save you from a fight or revive you. In ChikenBomb during buy time you go straight to your new spawn; mid-round you sit out until the next round.
- **Bots keep it even:** a full team gives up a bot's seat, and a half-full room rebalances (2 v 2 stays 2 v 2).
- Everyone sees "X joined Blue", and your friend/enemy colours flip at once.
- **Checked:** 5 new server tests, plus in the browser: Red to Blue, then the cooldown, then respawned on Blue with teams still 2 v 2; Against All says "This mode has no teams."
- Code: `switchTeam` in [server/src/rooms/GameRoom.ts](server/src/rooms/GameRoom.ts), `teamSwitchBlocked` in [shared/src/modes.ts](shared/src/modes.ts), [client/src/game/GameSession.ts](client/src/game/GameSession.ts).

## Mistakes log (batch 2)

1. **The first compile from PowerShell failed.** With `2>&1`, PowerShell 5.1 treats Emscripten's normal "sanity checks" message (printed on stderr) as an error and stops. Then `emsdk_env.bat` didn't put `em++` on PATH inside a batch file. **Fix:** a small batch file that sets `EM_CONFIG` and PATH itself and calls `em++.bat` by its full path. Written into the Skeet README.
2. **Batch 1 broke the Skeet QA script and I didn't notice.** The lobby redesign moved **Create room** into **Change mode**, and `check-native-menu.cjs` still looked for it on the title screen. It wasn't run after the menu change. **Fix:** the script opens Change mode first. **Rule:** run that script after any main-menu change.
3. **The new bridge test was wrong at first.** It assumed only colours are arrays, but a multi-select (brightness adjustment) is one too, so the test failed on correct code. **Fix:** treat every field whose key ends in `_0`, `_1`… as an array element.
4. **The shell ate a backslash again.** Editing that test with `node -e` in the shell turned `/_\d$/` into `/_d$/`. **Fix:** corrected with the Edit tool. **Rule (again):** edit files with the Edit tool or a .cjs script file, never inline in the shell.
5. **(J) My first guess at the blue flash was wrong.** I thought the slash swung the left dagger into the camera, and said so before checking. Measured, the closest it gets is 15 cm, and nothing covers the screen. **Rule:** measure before naming a cause.
6. **(J) Too long testing at 7 fps.** Software rendering at 7 fps can't show a one-frame flash, and it only happens on High. The first test should have matched how you play: graphics card, High quality, holding attack. That test found it at once.
7. **(K) The new test hung.** I used a Zombie map that doesn't exist ("graveyard"; it's "night"), the test failed, and the room it left open kept the run alive (the same hang as an earlier batch). **Fix:** take the map from the mode's own list, and close every room in a `finally`.
8. **(K) The first version left half-full bot rooms 3 v 1.** It only made room on a full team. The browser test caught it. **Fix:** after a switch, a bot leaves the bigger side and the bot top-up refills the smaller one. A test covers both cases.

# Batch 1 (6 Oct): sounds, scope, kill icons, inspect, gun shapes, main menu

## The plan

| # | Step | Status |
| --- | --- | --- |
| A | Your sounds: `AWP_SOUND` (sniper shot), `SNIPER_ZOOM` (scoping in with the Sniper or Scout), `equip_sound` (switching weapons) | Done |
| B | Scope on every sniper (Sniper and Scout): click once to scope, it stays; click again to zoom in further; a third click leaves the scope. No more scroll wheel | Done |
| C | Kill feed icons: a silhouette for every single gun, not one per gun family | Done |
| D | Better inspect (F): longer, smoother, a different move per kind of weapon | Done |
| E | More detailed gun shapes | Done |
| F | Main menu: look and feel like a game, not an app, with new features; checked in the browser | Done |

Rules for every step: read the code it touches first, change as little as works, test it, look at it
in the browser, then commit. Nothing is pushed if a test fails.

## What was done

### A. Your sounds
- The three files are in `client/public/sounds/` with their exact names: `AWP_SOUND.mp3`, `SNIPER_ZOOM.mp3`, `equip_sound.mp3` (the server is case sensitive, so the names in the code match the files letter for letter).
- **AWP_SOUND** plays for every Sniper and Scout shot (both use the game's "sniper" shot sound), yours and other players'. It goes through the normal sound chain, so a far-away shot is quieter and comes from the left or right.
- **SNIPER_ZOOM** plays when you scope in and when you zoom further, with the Sniper or the Scout.
- **equip_sound** plays when you switch weapons (the old click is kept for build mode).
- Checked before adding: `equip_sound` starts with 0.32 s of silence, which would make switching feel late. Silence at the start and end of every file is now trimmed when it loads (it plays 0.46 s instead of 1.1 s). The AWP shot starts right away and has a long echo (about 4 s), which is kept.
- If a file fails to load, the old built-in sound plays instead.
- Code: [client/src/game/Audio.ts](client/src/game/Audio.ts) (`FILE_SOUNDS`, `trimSilence`).

### B. Sniper scope (Sniper and Scout)
- The scope button (right mouse) is now a click, like Counter-Strike: **click once** to scope (it stays when you let go), **click again** to zoom in further, **a third time** to put it away. Switching weapons, reloading, getting in a car or dying puts it away too.
- Sniper: 4× then 8×. Scout: 3.2× then 6.5× (the Scout's second zoom is new). The scroll wheel switches weapons again.
- The hint line shows the zoom and what the next click does.
- You said "left click"; left click fires, so the scope is on the scope button (right click), as in CS. If you really want it on another button, it is one line to change.
- Checked in the browser: both guns cycle scope → zoom → off, the zoom sound plays twice, switching puts the scope away and plays the equip sound, and a sniper shot plays the AWP file.

### C. A kill icon for every gun
- Every gun's kill-feed icon is now drawn from the gun's own 3D model: side on, muzzle to the right, as a white silhouette (like Counter-Strike). So all 29 weapons have their own exact shape: each pistol, rifle, sniper, shotgun, knife, the katana and the pan look different. When a gun model changes, its icon changes with it.
- The icons are drawn once, a few per frame, shortly after your first match starts (so nothing stutters). Until a gun's icon is ready, the hand-drawn one from before is used; eggs, cars, the bomb and falls keep their drawn icons.
- Checked in the browser: a feed with one kill for each of the 29 weapons, every one showing its own picture.
- Code: [client/src/ui/GunIcons.ts](client/src/ui/GunIcons.ts), used in [client/src/ui/Hud.ts](client/src/ui/Hud.ts).

### D. Better inspect (F)
- Every kind of weapon now has its own inspect, with its own length:
  - **Pistols (2.6 s):** left side, a quick spin round the trigger finger, right side.
  - **Rifles, SMGs, shotguns (3.2 s):** left side, then turned over to check the magazine: it slides out a little and is slapped back in, with a click each way, then the right side.
  - **Snipers (3.4 s):** a heavy lift to show the side, then nose up to look along the scope.
  - **Heavy weapons (3.6 s, LMG, minigun, launchers, crossbow):** slow, with a little bounce from the weight; the minigun's barrels spin up while you look.
  - **Knives without a trick (2.8 s):** show the flat, toss it up spinning, catch it, show the other side.
  - **Butterfly, karambit, M9 and the other trick knives** keep their trick; **dual pistols and daggers** rock side to side.
- A small slow wobble is added on top, so the hand doesn't look like a machine.
- Shooting, aiming or reloading still stops it.
- Checked in the browser: screenshots partway through the rifle and pistol inspects, and the magazine clicks played once each per inspect.
- Code: [client/src/game/ViewModel.ts](client/src/game/ViewModel.ts) (`INSPECTS`, `inspectKind`); test: [client/test/inspect.test.ts](client/test/inspect.test.ts).

### E. More detailed gun shapes
- Guns were built only from rounded boxes. A new helper cuts a part from a drawn side outline (the way game guns are modelled), and the parts you see most now use it:
  - **Grips (every gun):** raked, with finger grooves on the front and a curved back strap.
  - **Pistol and Deagle:** slides sloped at the front and back, a shaped frame.
  - **Rifle:** one receiver with a magazine well, a tapered handguard, a stock with a sloped comb, and the curved magazine from before.
  - **Sniper:** a thumbhole stock and a fluted barrel.
  - **Shotgun:** a wooden stock with a pistol-grip wrist and a proper butt.
  - **SMG:** a receiver with an angled front and a magazine well.
  - **Knife:** a contoured handle with finger grooves.
- The kill-feed icons (step C) are drawn from the models, so they picked up the new shapes by themselves.
- Speed is unchanged: the parts are still merged per material (about 7 draw calls per gun).
- Checked with close-up renders of the rifle, sniper, pistol, Deagle, shotgun, SMG, knife and M9.
- Code: [client/src/game/models/Guns.ts](client/src/game/models/Guns.ts) (`profile`, `metresToUv`).

### F. Main menu: a game lobby, not an app
- The title screen is laid out like a game lobby (CS2 / Standoff style) instead of a page of cards:
  - **Left:** a big yellow **PLAY** cut at an angle, with your mode, map and bots choice under it; then **Change mode** and a column of slanted menu bars: Shop, Friends, Daily challenges, Leaderboard, Settings. They slide in one after another and slide out on hover.
  - **Right:** your chicken running its lap, now in the clear (the menu side of the screen is darker, the chicken side is not).
  - **Top:** the logo, and your level, XP bar, coins and account.
- **New features on the menu:**
  - **PLAY remembers your mode:** one click starts the mode you played last (with its map and bots choice). **Enter** does the same.
  - **Change mode** opens a full-screen mode picker: the mode cards by tab (your mode is highlighted), With bots / Without bots, Server browser, Create room and Join with code. Esc or ✕ closes it.
  - **Today's challenges** with progress bars, right on the title screen (Open shows the full list).
  - **What's new:** the latest changes. Edit `WHATS_NEW` in [client/src/ui/MainMenu.ts](client/src/ui/MainMenu.ts) to change it.
  - **Players in matches now:** a live count with a green dot, refreshed every 20 seconds.
  - **Menu sounds:** a soft tick on hover and a click on press.
  - **Controls** is a small button at the bottom instead of a long line of text.
- Everything that was on the old menu is still there (party strip, friends badge, leaderboard per mode, map picker, 🎬 to hide the menu, privacy link, the 5-tap logo shortcut).
- Checked in the browser at 1280×720, 1920×1080 and a 390×844 phone: PLAY starts your mode, Change mode → Team Fight played it and PLAY then showed Team Fight, Enter played it, Esc closed the picker, the challenges and player count loaded, no sideways scrolling on the phone, no errors.
- Code: [client/src/ui/MainMenu.ts](client/src/ui/MainMenu.ts), styles at the end of [client/src/style.css](client/src/style.css), `online()` in [client/src/net/Api.ts](client/src/net/Api.ts).

## Mistakes log

- **A test that depended on the date (from yesterday).** When daily challenges were added, I adjusted a ranks test to leave out daily-challenge coins, but only from the second match it records. Today one of the daily goals is "win a match", which the test's first match completes, so the test failed. It would have passed or failed depending on the day. Fix: the test now leaves out the daily coins of both matches. Checked by running it as if it were each of the next 20 days: it passes on all of them.
- **A wrong path in my own check.** The first 20-day check failed on every day, because the helper file's path lost its backslashes and never loaded, not because of the game. Fixed by putting the helper next to the tests. The real result is the second run (0 failing days).
- **DOCS.md text eaten by the shell.** I wrote the DOCS entry through a shell command, and the shell treated the backtick-quoted file names as commands to run, so they vanished from three lines (it only printed harmless "not found" errors; nothing was changed). Fixed by hand, and from now on DOCS.md is only edited with the file editor, never through the shell.
- **Magazine click repeating.** In the first version of the new inspect, the "magazine in" click played on every frame after the magazine check finished, instead of once. Caught by recording the clicks; fixed so each click plays exactly once per inspect (checked over two full inspects: out, in, out, in).
- **Magazine check pointed the wrong way.** My first magazine-check pose tipped the rifle so it pointed at the sky, with the magazine off screen; my second showed the top rail instead. I then rendered three candidate poses side by side and picked the one where the magazine faces you.
- **Two new gun parts placed wrong (caught before rendering).** Checking each new outline against the old part's position showed the Deagle slide would have left a 3 cm gap before the muzzle and the knife handle would have poked out behind its pommel. Both fixed before the first render.
- **Knife handle drawn inside out.** I listed the knife handle's outline points in the wrong order, so the shape crossed itself and rendered as a zigzag. Fixed the order.
- **Texture grain too big on the new parts.** The outline-cut parts measure texture coordinates in metres, the box parts stretch a texture over each face, so the grain on the new parts came out several times too big (blotchy wood and plastic). Fixed by scaling their texture coordinates to match.
- **Menu styles rejected by the shell.** I tried to add the menu styles through a shell command; the shell refused the long block (it tripped over a quote), so nothing was written. Checked that nothing had been added, then wrote the styles with the file editor. Same lesson as the DOCS.md mistake: long text goes through the editor.
- **"0 players online" looked wrong.** The first version said "0 players online" while you were on the menu, because the server only counts people in matches. It now says "No one in a match yet: start one!" or "N players in matches now".
- **Cards over the chicken.** At 1280×720 the "What's new" card ran into the chicken. The two cards are now stacked in a narrow column next to the menu, which stays clear of it at every size checked.
- **A phone screenshot that looked broken but wasn't.** A full-page screenshot at phone size showed the menu missing; measuring the page showed every button in place. The capture had caught the menu mid-animation while the page scrolled. A normal screenshot showed it correctly.
- **A slow test, not a bug.** "Knife Fight bots charge in to stab" failed once in a full run and passed three times on its own and in the next full run. It waits 4 real seconds for a bot to walk over, so a busy machine can make it miss. Nothing in this change touches bots or the server.
