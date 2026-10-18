# DOCS: plan, progress and mistakes

Working notes, one batch of work at a time (newest first). Each batch has its plan, what was done
for each step, and a log of every mistake made along the way (what went wrong, and how it was fixed).

# Batch 32 (18 Oct): a polished main menu

## Plan

1. Scene (`Game.ts`): find the pink sky; reframe the camera; half-size blurred, warm-graded background with the chicken sharp on top; the AK out of the body; drag to turn, click to react; party chickens; pause under dialogs; show the menu before Mirage loads.
2. Menu (`MainMenu.ts`): top bar, play panel bottom right, profile under the chicken, challenges and news on the left, friends with Invite on the right, footer links, a NEWS page, Esc.
3. App and Friends: search timer and Cancel, invites, party chickens, pause hook, fast start, Esc in the shop, sounds on every button.
4. CSS, then screenshots at 1920x1080 and 1366x768, every old lobby feature, FPS.

## What was done

- **Pink sky:** the developer World tab's colours are saved in the browser and were applied to the menu at boot, even without the dev code (the "Neon" look is a pink sky and pink stone). The menus now always use their own look (`menuLook()`: clear blue sky, warm sun); World tab colours only apply in matches.
- **Scene:** the camera sits a little right, so the chicken stands at 40% of the width with the street behind it (`menuShot`). Mirage's wall lamps (the dark blob beside the head) are left out of the menu background only. The world is drawn at half size, softly blurred, warmly graded and vignetted; the chickens are drawn sharp on top (their own layer, still lit by the world and casting its shadows). The AK rests in front of the belly instead of inside it; the idle loop itself is unchanged. Drag to turn the chicken (it turns back after a moment); click it to cluck and flap. Up to four party members stand beside it.
- **Play panel:** Casual / Competitive / Fun tabs, every mode as a card, the map (only that mode's maps; Zombie Apocalypse and the Backrooms show their one map), bots On/Off where allowed, a big yellow PLAY that becomes "Searching… 0:12" with Cancel, then Server browser, Create room and Join with code. The mouse isn't locked until a match is found, so Cancel can be clicked.
- **Top bar, profile, sides:** logo, tabs, coins, profile chip (rank, name, level), music on/off and settings, all with tooltips. Under the chicken: name, rank badge, "Lv 1 Egg", XP bar and "0 / 100 XP". Left: daily challenges with progress and coin rewards, the latest news (opens the NEWS page), Leaderboard and How to play. Right: friends with online status and Invite. Footer: Save progress / Account, Privacy, Hide menu.
- **Feel and speed:** hover and click sounds on every menu button; tabs and screens slide in; Esc closes the News page, shows a hidden menu, cancels a search, and leaves the shop. The menu draws at most 60 fps, not at all under a dialog or the News page, and shows straight away while Mirage loads behind it.
- Checked in the browser (1920x1080, 1366x768, 1280x720, 1440x900, phone): no buttons without a label or tooltip; all 14 modes, maps, bots; every dialog; shop and back; loadout skin and gun on the chicken; drag, click, party; search, Cancel, a real match and back; L still asks for the dev code. Menu: 60 fps, about 1.2 ms of CPU per frame. Tests: 536; `npm run build` passes.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The chicken pass cleared the blurred background: a colour `scene.background` clears the screen even with autoClear off. | The background is taken off for that pass. |
| 2 | The lamp filter's regex only matched `/`; Mirage's material names use `\`. | `[\\/]`. |
| 3 | Two patch scripts went through bash heredocs and broke on quotes again. | Wrote them to files. |
| 4 | A CSS patch didn't match: that part of `style.css` has CRLF line endings. | Edited it with the Edit tool. |
| 5 | Narrow-screen rules hid every `span` in some buttons, icons too (blank logo and room buttons on phones). | `span:not(.ico)`. |
| 6 | PLAY locked the mouse straight away, so Cancel couldn't be clicked while searching. | The pointer is locked when the match is found. |

# Batch 31 (17 Oct): mega?dev config presets

- **Where:** mega?dev (L, behind the dev code), Configs tab. Skeet and the HvH Lab are unchanged; dev mode is allowed in the same places as before.
- **Built-ins** (`client/src/dev/classic/config.ts` `BUILTIN_CONFIGS`): Totally Legit™, Gaming Chair, Closet Cheater, $9 YouTube Config, Memesense, UID Issue, and three meme ones (Pasted from GitHub, Spinbot Supreme, Dev's Grandma). Each has a name, a one-line description and a difficulty tag from green (Legit) to red (HvH Rage), purple for Meme. They're built from the defaults, keep your menu look, World colours and selected weapon, and can't be renamed or deleted. Save with one selected makes your own copy.
- **Panel** (`client/src/dev/panels/configs.ts`, used by both menus): built-ins only show when the menu passes them (mega?dev does; Lab doesn't). "Active: X" above the list becomes "Custom (modified)" after any change. A load toasts "Loaded config: X". New button: Reset to default (cheat settings only).
- **Share code:** Export makes a short code `CRH1-...` (base64 of only the changed settings) and shows it in the box; Import takes a code or an old JSON file. Everything still goes through `sanitizeConfig`. The old seeded configs (Legit, Rage, Visuals, Testing, Fun) are no longer added for new players; anyone who has them keeps them as their own.
- What maps where and what was skipped: CHECK_REPORT.md.
- Checked in the browser: the code is still required; each preset loads and changes the settings; save, delete, export and import work. Tests: 536 (2 new); `npm run build` passes.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The panel patch went through a bash heredoc and broke on quotes. | Wrote the script to a file. |
| 2 | The panel file has CRLF line endings, so the patch strings wouldn't match. | The patch script converts to LF and back. |
| 3 | My browser check expected a jumpscare on a wrong code; there isn't one (only "Wrong code." and a shake). | Noted in CHECK_REPORT.md; left unchanged. |

# Batch 30 (17 Oct): CS2 weapon slots, scroll wheel, bomb on 5, weapon list

- **Slots:** 1 primary, 2 pistol, 3 knife, 4 grenades (again: the next kind), 5 the bomb, only for its carrier (ChikenBomb, FaceChiken); other keys do nothing (key 5 used to be the knife). README controls table and the F1 guide updated.
- **Scroll wheel** (`weaponSlots.ts` `slotItems` / `stepSlot`): guns by key, then each grenade you carry, then the bomb, round and round, skipping what you don't have. Settings → "Flip the weapon scroll wheel". Ignored while the buy / Training / zombie shop menu or chat is open, while scoped, and with a pin pulled.
- **Grenades:** G / Q / the flashbang key still take one out directly; the last one thrown puts your gun back.
- **Bomb:** key 5 takes the C4 out; hold left click on a site to plant (the same 3 s); off a site: "You must be in a bomb site to plant". Planting with the bomb in hand is called off by moving or jumping; E still plants, holding you still as before. G with the bomb in hand drops it a step ahead for a teammate (the dropper can't take it back for 1.5 s); otherwise G is the egg.
- **Server:** a new `hold` message says what's in hand and is checked (a grenade you carry, the bomb only if you're its carrier); `dropBomb` only works with the bomb in hand.
- **HUD:** the bottom-right list shows every slot (each grenade, "x2" for two flashbangs, C4 when carried), highlights the one in hand with a small pop, and fades 3 s after a change. The hand comes up again when a grenade or the bomb is taken out.
- Checked in the browser on both teams. Tests: 534 (5 new); `npm run build` passes.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | One BombRoom patch line had the wrong indent, so that file's patch stopped (the other files were already written). | Re-ran only that part. |
| 2 | The drop cooldown used the real clock; the room runs on its own tick time. | The room's clock. |

# Batch 29 (17 Oct): one map for Zombie Apocalypse and Backrooms

- Both modes now play only on the Graveyard (`maps: ['night']`). Mirage no longer carries the sealed Backrooms and Facility levels, which could be seen standing in the desert next to it; its half-size is 110 (its outermost collision is at x = -104.5) instead of 226.
- Tests updated: the zombie modes are the only ones without Mirage; the "wall on Mirage's raised street" test is gone with Mirage. 529 pass; `npm run build` passes.

# Batch 28 (15 Oct): two failed Railway deploys fixed

Both the batch 26 and batch 27 deploys failed in `vite build`: `shared/src/projectiles.ts` wasn't valid UTF-8 ("stream did not contain valid UTF-8").

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | In batch 26 I patched `projectiles.ts` with Python's default (Windows cp1252) encoding, so the new "–" and "×" were written as single cp1252 bytes. The typecheck and tests read the file fine; only the production build refuses it, and I didn't run `npm run build`. | Converted the two bytes to UTF-8 (`npm run build` passes). New test `shared/test/encoding.test.ts` fails on any non-UTF-8 source file (checked with a planted bad byte). From now on: patch with `encoding='utf-8'`, and run `npm run build` before pushing. |

# Batch 27 (15 Oct): CS2-style guns, shell casings, one weapon list with CS / special categories

## Plan

1. One weapon list (`shared/src/weapons.ts`, `ARSENAL`): kind, category (`cs` / `special`) and CS2 name for every weapon; `weaponAllowed`; modes flagged `csOnly` (ChikenBomb, FaceChiken). The categories are in CHECK_REPORT.md for the owner to check.
2. Server: special guns refused in CS-only modes (buy, bot buys, dev give, switch, fire).
3. Arms Race has every CS gun; Training and the loadout screen grouped by type, specials tagged.
4. Casings: the owner's 17 textures as WebP, pooled casing models with ORM materials, ejected from the port (pump and bolt timing), bouncing, clinking, capped by quality.
5. CS2-style gun models with normal maps, edge wear and moving parts.
6. Tests, gallery, in-game check, FPS.

## What was done

- **Weapon list:** every mode, menu and loadout reads `WEAPONS[id].kind / category / name`. CS2 names for the CS guns (Glock-18, USP-S, AWP, Nova, ...); ids, stats and prices are unchanged. Specials: Minigun, Golden Rifle, Rocket Launcher, Crossbow, Egg Launcher, Golden Knife, Frying Pan, Katana.
- **Enforcement (server):** `BombRoom.handleBuy` (and the bots' buying) refuses specials in CS-only modes, the dev "give weapon" action refuses them there, and `handleSwitch` / `handleFire` ignore a special gun in those modes however it got into a loadout. The buy menu filters them out (`canBuy`). ChikenBomb's team guns stay (AK-47 and Galil for chikenT, M4A1 and the kit for chikenCT); the CT-only Golden Rifle is special, so it's gone from there.
- **Arms Race:** 23 levels, every CS gun plus the specials, the Golden Knife last.
- **Loadout screen and Training B menu:** guns grouped Pistols / SMGs / Rifles / Snipers / Shotguns / Heavy / Special, each card with its model picture; specials tagged "Not in FaceChiken / ChikenBomb".
- **Casings (`client/src/game/Casings.ts`):** the PNGs converted to WebP (922 KB → 114 KB) in `client/public/textures/casings/`. Each kind is a lathe (bottlenecked rifle cases) or cylinder with the base cap (and for shells the brass head and the crimp), its UVs placed on the texture's own strip and circles. The AWP case is long, the Glock's short, the Deagle's wide. ORM is used as glTF (AO R, roughness G, metalness B); nova and mag7 get a flat finish. Other guns borrow the closest case. Cases fly out of the ejection port (first person: from the view model; third person and other players within 25 m: from the chicken's gun), tumble, bounce and roll on the grenades' physics, clink (brass) or tock (plastic), and shrink away after 3.5 s. One pool, one geometry and material per kind; at most 10 / 24 / 40 by graphics quality.
- **Guns (`client/src/game/models/Guns.ts`):** the 18 CS guns rebuilt as their CS2 counterparts, all made here. Each has its moving part (`GunModel.action`) and ejection port: slides (pistols), bolts and charging handles (rifles, SMG, XM1014, M249), the Nova's pump, the AWP and SSG 08 bolt actions, the R8's cylinder. Every gun material now has a normal map (from the stipple, knurl, brushed and wood height textures) and worn edges: the shader measures how sharply the surface bends and rubs the finish through there. Materials stay shared; triangle counts are about the same as before.
- **Animation (`ViewModel`):** a slide or bolt snaps back and returns with every shot; the pump is racked 180 ms after the shot and the bolt action worked 300 ms after it, each throwing its case as it opens; the cylinder turns a chamber; reloads end with a rack. Checked in the browser: slides out at once, the Nova's case at 362 ms, the AWP's at 660 ms (handle lifted 1.1 rad, drawn back 8.5 cm).
- **Performance:** 175–180 fps on High with 30 cases out (the headless cap), Low keeps 10 cases at 57 draw calls.
- Tests: 529 (7 new in `server/test/arsenal.test.ts`; the bomb buy test now expects the Golden Rifle to be refused).

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The textures weren't in a `gun_shell_textures` folder. | Found them in `Downloads\Downloads` and flagged where they seem to come from. |
| 2 | My material patch assumed the definitions were next to each other (there are comments between). | Patched one definition at a time. |
| 3 | The builder-removal script dropped the line above every definition, comment or not. | Rewrote it to walk up only over comment lines (it had stopped before writing). |
| 4 | Bash heredocs mangled `\n` in Python again, twice. | Edit tool for those lines; patch scripts as files. |
| 5 | The CZ75's extended magazine leaned forward (rotation sign); the FAMAS was a tall blue slab; the Nova's stock outline was jagged. | Fixed after the first gallery. |
| 6 | The remote case used a `dx` the shot event doesn't have. | Direction from the muzzle to the first bullet's end. |

# Batch 26 (15 Oct): grenades reworked (HE egg, smoke, flash), carry limits, hold-and-throw

## Plan

1. Shared: a thrown HE egg as its own projectile (`he`: bounces, bursts 1.5 s after it lands; the Egg Launcher keeps the impact `egg`), smoke 15 s, flash 1–3 s, one launch formula for server, prediction and aiming line.
2. Carry limits 1 / 1 / 2; buy menu MAX; Training free and unlimited.
3. Server: throw power checked, pin tracked, a pinned grenade drops live on death.
4. Client: G / Q / Z take out; left, right or both mouse buttons hold and release; dotted aiming line (thrower only); pin and throw animation and sounds; own throw synced to the server's flight; smooth flash with fading ringing.
5. Tests and a two-browser check.

## What was done

- **Physics (`shared/src/projectiles.ts`):** `launchVelocity` uses Counter-Strike's throw strengths (100% left, 65% both, 30% right), adds the upward lift, and carries 1.25× the thrower's run and their jump. `throwDrop` makes underhand throws leave 0.3 m lower. `fuseDone` holds the three fuses (HE egg 1.5 s after first landing, flash 1.5 s after the throw, smoke at rest). `predictThrow` draws the aiming line with the same steps as the server. Bounces, rolling and stopping are the existing CS arc.
- **Flash:** `flashBlindMs` gives 1–3 s looking at it (3 s point blank), a fraction from the side, very little facing away; walls block it as before. The white-out (`Hud.flash`) is one CSS fade from full white, and a new flash only extends it. Sampled every 200 ms in the browser it only ever went down. The ringing (`Audio.ringFor`) lasts as long as the white-out and dies away.
- **Smoke:** 15 s (`SMOKE_DURATION_MS`); the cloud stays thick that long, then thins over 3 s. Bots and players can't see through it; the HvH wallhack and "remove smoke" are untouched.
- **Carry limits (`PLAYER`):** 1 HE egg, 1 smoke, 2 flashbangs, in every mode. The buy menu shows MAX (dimmed) at the limit; the server refuses too. ChikenBomb already starts at zero, charges for them and keeps them for survivors (tested). Training throws never use one up, and its B menu says "free" and puts the grenade in your hand.
- **Hold and throw (`GameSession`):** G / Q / the flashbang key (Z, in the controls list and guide) take the grenade out. Pressing left, right or both pulls the pin (pin sound, `pin` message to the server). Letting go of a button throws with what was held just before. Weapon keys are ignored while the pin is pulled; losing the mouse (a menu) puts the pin back. The aiming line (`ThrowPreview`) is only drawn locally. The first-person arm draws back and then swings (`ViewModel.throwGrenade`), and other players' chickens swing when they throw.
- **Server authority:** the client sends only the aim direction and one of three powers (anything else is ignored). The server works out the flight, the landing, and who is hurt or blinded. Your own predicted grenade switches to the server's launch when it's confirmed, so it lands where everyone else sees it land.
- **Dying with the pin pulled:** the grenade drops live at your feet (an HE egg bursts 1.5 s later). Without the pin pulled, nothing drops.
- **Checked in two browsers:** far / medium / soft landed 32.6 / 14.6 / 5.3 m away. The aiming ring was 3–8 cm from the real burst. Both players' grenades ended within 0–7 cm of the server's spot, and the other player never saw the line. Flash: 2855 ms for the thrower looking at it, 634 ms (a faint veil) for a player facing away.
- Tests: 522 (16 new: `shared/test/grenades.test.ts`, `server/test/grenades.test.ts`; the old impact-egg test now checks the landing fuse).

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | Python patches failed on non-ASCII text (Windows cp1252), then a Bash heredoc broke on quotes. | UTF-8 reads, and patch scripts written to files. |
| 2 | The refactor stopped the developer "infinite flashbangs" stack from showing full. | Refilled on each throw again. |
| 3 | The aiming dots were world-sized, so near ones were big squares; the held egg was twice the size and the pin pose pulled it at the camera. | Round 6 px dots; smaller held grenades; gentler pose. |
| 4 | Browser test: used the flat map in FFA (not allowed), threw during the match countdown, and created guests faster than the limiter allows. | Farm map, wait for "playing", retry guests. |

# Batch 25 (15 Oct): Mirage from its Hammer source, glitchy floors and walls fixed

The owner put the map's source (`de_mirage_d.vmf`, a BSPSource decompile, in their Downloads) on the PC and asked to rebuild Mirage from it, make it faster, and remove the bugs and glitchy textures. The source has brushes and entities but no textures or models, so the textured model stays, and the collision is rebuilt.

- **Collision from the source brushes** (`tools/import_mirage_vmf.mts`, with the reader in `tools/vmf.mts`). Each straight brush becomes one exact box. Slanted brushes become the 8-unit cells whose centres they hold. Displacements (terrain, curved walls) become every cell their surface passes through; the corner order was checked against the model (median 1 mm off). The source's `toolsclip`/`toolsplayerclip` brushes become real player clips: 2,229 boxes where there used to be 42 guessed ones. The breakable boards (Snipers' Nest) are left out. The old boxes that no brush explains are kept as prop collision. Result: 29,533 boxes instead of 35,623 (data file 3.55 → 2.83 MB), and the Mirage zombie tests run in 2.7 s instead of 4.2 s.
- **Clips are for chickens only, as in CS.** Grenades, flash and explosion sight, melee, the third-person camera and the dropped bomb now pass through clips (there's a clip ceiling over the whole map).
- **Bot navigation** (`prepare_mirage.ts`): a nav point touching a wall moves up to 0.4 m clear (a chicken is wider than a CS player). All 755 points are kept, and routes between the main areas match the old ones.
- **Glitchy floors and walls (my bug from batch 23):** the cut-out fix gave `alphaTest` to any texture whose alpha averaged under half. Source keeps blend and shine masks in the alpha of solid textures, so parts of A site's floor, T spawn's cobbles, the blue and salmon plaster, brick and tiles were thrown away, and you saw the sand plane 4–5 m below. Cut-outs now apply only to props of a see-through kind (foliage, fences, scaffolding, lamps…) or ones mostly empty.
- Training targets on slopes now strafe out to one side and back when only one side fits. The Mirage wall-building test turns until there's room (its random spawn sometimes faced a wall, which failed it 3 times in 8 before this batch too) and always closes its room.
- Wall-face check: 0 walks through a visible wall. Tests 506/506.
- Left as is: the model's 128 px textures (the originals aren't on this PC), and the blend layers the model lost (the source names the blends but not their second textures).

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The batch 23 cut-out rule hid parts of solid floors and walls (the "glitchy textures"). | Cut-outs only for see-through props. |
| 2 | Counting every cell a slanted brush touches made walls up to 0.27 m too thick, which closed Apartments and Palace for bots. | Cell centres inside the brush instead. |
| 3 | My first displacement corner order was mirrored (44% of points matched). | Checked against the model and reversed it (92% within 5 cm). |
| 4 | Python patches through Git Bash heredocs mangled `\n` twice more. | Fixed those lines with Edit. |
| 5 | A failing zombie test left its room running and hung the whole suite for 10 minutes. | The test closes its room in `finally`. |
| 6 | I blamed missing model geometry for the beige floors before checking materials; the model was fine. | Found the real cause by recolouring and hiding meshes in the live scene. |

# Batch 24 (15 Oct): buy-menu chicken fits its panel

- The preview camera was fixed (30° view from 3.9 m), so in the tall, narrow side panel the chicken and a long gun were cut off at the sides, and the stats box covered its feet. The camera now backs off to fit a 1.9 m × 1.8 m box (the chicken with a long gun, turned any way) into the space above the stats box, using a view offset. It refits when the panel or the stats box changes size. Checked at 1600×900 and 1100×620 with the Sniper.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | I started the test servers twice; the second pair exited because the ports were taken. | Used the ones already running. |

# Batch 23 (14 Oct): Mirage holes and clips, ladders, CS grenades, the bomb as slot 5, spawn cover, AK-47 / M4A1

- **Walk-through walls:** the importer's collision for diagonal brushes dropped any 16-unit cell poking outside the brush, so thin diagonal walls had none. `tools/patch_mirage_walls.mts` fills open wall faces near walkways with thin boxes (`mirage-walls.json`, 490 boxes). `--check` walks into every open face: 37 holes before, 0 after. Imported nav links that now clip a corner are dropped when the bot graph is built (`nav.ts`); one box was reopened where that link was the only way into an area.
- **Shots stopping in mid-air:** player clips. `tools/mirage_clips.mts` fires rays from every walkway spot; 42 boxes that stop them where nothing is drawn are `clip: true` (`mirage-clips.json`). Players still collide with them; bullets, wallbangs, bot sight and anti-cheat sight pass through (`CollisionWorld.seeThrough`).
- **Textures:** mostly see-through textures (scaffolding planks) were drawn opaque, so they get a cut-out. The rugs had no texture or UVs: a woven rug texture and planar UVs. A Source-style grain at 8× scale over all map textures. A CRT TV on the apartment table.
- **Ladders:** `tools/mirage_ladders.mts` takes the 5 upright ladder props (`mirage-ladders.json`), and shared physics climbs them like CS: walk into one, look down to go down, strafe along it, hang when idle, jump to hop off. 3 tests.
- **Grenades (CS):** smoke and flash use CS's arc at this scale (16.9 m/s, 0.4 gravity, 45% bounce, rolling friction) and carry 1.25× the thrower's speed; the smoke pops once it stops; the flash fuse is 1.5 s. The egg is unchanged.
- **Bomb as an item:** key 5 takes the C4 out (first-person C4, "5 C4" in the HUD); holding fire plants it; E still works.
- **Spawn cover:** Harbor and Sandstown mid get an S-chicane of two staggered 3.5 m walls at each spawn: buy-zone sight lines went from 1600/4608 and 1050/4608 to 0. Waypoints were moved through the gaps, and one Sandstown crate was removed.
- **AK-47 (chikenT, $2700) and M4A1 (chikenCT, $3100):** new weapon IDs, appended to the list. The AK one-taps the head; the M4 fires faster and is steadier. New models. The Rifle and Golden Rifle are still sold, since the buy-menu tests need every gun.
- **Guns and icons:** surface textures at 2× resolution, with wear, mottling and scuffs. Buy-menu and shop pictures are rendered at 3× the pixels with the gun's own lighting, then recoloured to gold (buy menu) or light grey (shop); the kill feed keeps the silhouettes.
- **Not done (out of time):** the buy-menu layout, a buy sound, footstep sounds. The theme the owner called "theme228" is byte-identical to the one already playing.
- Tests: 506; all pass. The Exploder fuse test failed once under full-suite load and passes alone.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | My first wall check counted walls where collision sat a bit off the face. | Checked by walking a simulated player into each face and testing if the path crossed it. |
| 2 | Dropping boxes for every cut nav link reopened 19 holes. | Kept the boxes; nav drops the links instead; reopened only what kept every area reachable. |
| 3 | Python patches through bash heredocs mangled `
` again. | Used the Edit tool for those lines. |
| 4 | Ladders: idle in the air re-grabbed the ladder right after a jump. | A jump pushes you away, and no grab while moving away. |
| 5 | A chicane overlapped an old crate in Sandstown mid. | Removed the crate. |
| 6 | Replacing Rifle/Golden in the bomb buy list broke 4 tests. | Kept them alongside the new rifles. |

# Batch 22 (14 Oct): CS-style screens after PR #9, Mirage look, lobby chicken, theme music

Came after merging PR #9 (the CS-style lobby, the CS HUD, Mirage). The requests, in order: make everything else match the new menu (the shop, Loadout, Store, the Dev code keypad); fix Mirage being too light and its texture bugs; a bigger top bar, a smaller lobby chicken that does a CS-style emote with its gun; the owner's `chickenRunHvh_theme.mp3` as the title music.

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Run the tests on the merged PR and fix what it broke | modes tests, TrainingRoom, ZombieRoom, mirage.ts |
| 2 | Mirage: its own desert light; fix the moire rings and the green faces | look.ts, Game.ts, World.ts |
| 3 | Lobby: bigger top bar, camera further back, gun emote | style.css, Game.ts, Chicken.ts |
| 4 | Title music: the new theme, streamed | Audio.ts, client/public/sounds, SOUNDS.md |
| 5 | CS look for Inventory / Loadout / Store, every dialog, the keypad, the cookie notice | Shop.ts, style.css |

## What was done

- **Mirage look.**
  - New `desertLook()`: hard warm sun (3.1), sky fill cut to 0.42 (it washed the stone white-blue), fog pushed back 2.2×, exposure 0.95.
  - The sky fill's ground colour was grass green, which lit every downward-facing face olive. On maps with an imported mesh it is warm sand now.
  - The moire rings on floors were shadow acne. Every imported face is double-sided, so floors shadowed themselves. The import's triangle winding is reversed, so `shadowSide: FrontSide` (the faces turned away from the sun) casts the same shadows without the acne. Checked with shadows off, BackSide and FrontSide.
  - **Not fixable here:** every Mirage texture is 128 px or smaller (the PR's importer capped them), which is why walls look blurry up close. Sharper ones need the importer re-run with a bigger cap.
- **Lobby.**
  - The top bar is 54 px (was 42), with 15 px labels and bigger icons.
  - The camera sits 4.6 m back (was 2.8), so the whole chicken stands in the scene. The name and rank sit under its feet (desktop and phone).
  - `Chicken.menuEmote()`, used on the title screen only: the gun rests low across the body, the weight shifts and the head looks around. Every 14 s the chicken shoulders the gun to check an angle (off to the side, never at the camera), then inspects it while looking down at it.
- **Music.** `chickenRunHvh_theme.mp3` (4 min, 256 kbps) replaces `CHIKEN_HVHLOBBY.mp3`. It streams from an `<audio>` element through the music gain, because decoding it whole would hold about 85 MB. Same fades and volume as before; it picks up where it stopped.
- **CS screens.**
  - The shop screens have the lobby's top bar (Inventory, Loadout, Play, Store), with the open one underlined.
  - One CSS block remaps the paper theme's colour tokens inside the shop, every dialog, the keypad, the cookie notice and the server-down card. The main parts are then restyled one by one: dark glass panels, square corners, uppercase headings, slate buttons, and underlined tabs.
  - Items are CS inventory tiles: a grey gradient with the rarity as a bar along the bottom, the rarity name in its colour, a green dot when equipped, and a soft light behind gun pictures.
  - Left alone: the Skeet and Lab panels, the HvH setup, and the pause menu (the PR already made it CS-style).
  - Follow-up: "Choose a mode" was still half paper style (cream badges with unreadable text, white dropdowns, red trophy circles). It now matches: dark tiles, blue icons with no badge, grey player counts, dark dropdowns, a joined With/No bots switch, underlined tabs, and gold for the ranked FaceChiken card.
- **What the PR broke (6 tests).**
  - Mirage got 0 open spots, because the flat fill runs at y = 0 and Mirage's streets are metres up. Free-for-all already used Mirage's nav points. Training now does too, so it gets its 8 targets.
  - Training movers on raised floors need a level strafe line (`walkable` follows the floor). A half-width strafe is used where streets are tight.
  - Zombie Apocalypse on Mirage: the C wall was built from y = 0, under the street, so no blocks were placed. It now builds from the floor you stand on.
  - Mirage gets `grassHalf: 66`, its playable size (the event levels lie beyond).
  - The zombie and Backrooms tests now expect `['night', 'mirage']`, as the PR's own map test does.
  - The Backrooms card said "Graveyard" again (the PR undid Batch 20's fix). Restored.

## Tests

- New: Zombie Apocalypse on Mirage builds the wall on the raised street, at your feet.
- Full run: **503/503 pass**, typecheck OK, build OK.
- Browser (real GPU, headless):
  - Mirage from 8 places before and after;
  - the lobby at 1600×900 and on a phone, with the emote frames;
  - Store, Inventory, Loadout, item detail, buy confirm, Settings, Daily, Leaderboard, Friends, Account, How to play, the mode select and the keypad, on desktop and phone;
  - the music element plays the new file;
  - no page errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | My first Mirage views teleported into walls (y inside solid boxes), so the camera fell under the map and it looked like missing floors. | Used Mirage's nav places (on the floor) as the views. |
| 2 | Tried `shadowSide: BackSide` first: no change, because the import's winding is reversed. | Probed both sides in the browser; FrontSide is right. |
| 3 | A bash heredoc with CSS quotes broke. | Wrote the CSS to a file and appended it. |
| 4 | My screenshot script's "back" selector clicked the new INVENTORY tab, so dialogs looked like they opened over the shop. | Narrowed it to the panel's back button (a test-script bug, not the game). |
| 5 | Phone: item cards squashed (swatches became lines, "Equipped" cut off). The grids were shrinking flex children of the scrolling body. | `flex-shrink: 0` on the body's children. |
| 6 | First reverted Zombie and Backrooms to the Graveyard only, then saw the PR's own test requires Mirage in every mode. | Kept Mirage and fixed the real break (the C wall height) instead. |
| 7 | Guessed Mirage's playable size as 86; its nav spans about 100 × 86 m around the origin. | 66 (covers x down to -65). |
| 8 | The full test run hung once while my browser tests ran at the same time (the socket test is timing-sensitive). | Ran it alone (passes), then the full run with nothing else going. |
| 9 | The test server refused guests after many runs. Random fake IPs didn't help: the limiter ignores X-Forwarded-For locally, so every test browser is one address. | One browser session reused for all screen sizes. |
| 10 | Missed the mode select in the first pass: it lives in the lobby, not the dialog layer. | Its own CS block. A generic `.ranked` rule (for rank labels) also centred the FaceChiken card, so that's overridden. |

# Batch 21 (13 Oct): the Backrooms is easier, 300 of 500 crystals open the portal

- New `needed` option on a story event (missing means all of them). The Backrooms has `crystals: 500, needed: 300` in [events.ts](shared/src/events.ts).
- The portal opens once the team has 300. You can keep picking up the rest; they still count toward the speed-ups.
- The phone counter reads "Crystals 12/300". The welcome line says "find 300 of the 500". The result screen shows x/300. The mode card text is updated.
- Covers both the Backrooms mode and the wave-7 event (they share the config). `/backrooms small` still needs all 4 of its crystals.
- Test: 500 lie about, 299 don't open the portal, 300 do. Full run: **466/466 pass**.
- Not checked in the browser this time: only the counter text changed on screen; the rule itself is server-side and tested.

# Batch 20 (11 Oct): The Backrooms as its own game mode; a better monkey

The user's message was cut off after "and". Read as: the Backrooms as a game mode of its own (the wave-7 event stays in Zombie Apocalypse), and a better monkey with the old design kept as a second version.

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Mode `backrooms` (Fun tab, eye icon): the Zombie Apocalypse room with `huntOnly: 'backrooms'`. It starts in the maze with the hunt on; no waves; escape or fail ends the run; result screen; Restart | shared/src/modes.ts, server/src/rooms/modes.ts, ZombieRoom |
| 2 | Coins: 1 per crystal, +400 for escaping, max 1500 (`BACKROOMS_MODE`) | events.ts, ZombieRoom |
| 3 | Loadout rifle + pistol + knife (no shop in this mode) | modes.ts |
| 4 | New "stalker" monkey design; the old one kept as "classic" for 1 monkey in 4 | Monkey.ts, Chicken.ts, ZombieRoom (`CLASSIC_MONKEY_EVERY`) |

## What was done

- **Mode:**
  - You spawn at the maze entrance.
  - The HUD reads "The Backrooms · Find the crystals...".
  - Dying shows "Down. Your team can still get out".
  - At the end, the card shows "You escaped!" or "Lost in the Backrooms", with crystals x/500, the time, and Restart.
  - Everything else is the Batch 18–19 event: 500 crystals, speed-ups, red crystals, the monkeys, the phone, co-op for up to 4.
- **Stalker monkey:**
  - Gaunt, with ribs showing and matted fur with sore patches.
  - Long jointed arms ending in 3 claws, digitigrade legs, a ragged spine, a torn ear.
  - Burning orange eyes in deep sockets; a jaw with teeth that drops open when it attacks.
  - A breathing chest and a long tail.

## Tests

- New [server/test/backrooms-mode.test.ts](server/test/backrooms-mode.test.ts) (5 tests):
  - the mode's settings;
  - it starts in the maze with only monkeys;
  - some classic monkeys;
  - escaping gives the result, coins = crystals + bonus, the match ends, and Restart gives a new run;
  - time up ends it as lost.
- The upgrades test now lists the mode as PvE.
- The fuzz test covers the new mode by itself (it plays every mode).
- Full run: **465/465 pass**, build OK.
- Browser:
  - the card is in Fun ("Co-op survival · up to 4");
  - Play puts you in the maze with the right HUD;
  - 20 monkeys (5 classic);
  - both designs checked side by side;
  - no errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The browser showed 39 monkeys, not 20: starting the run inside the match-start hook let each monkey that joined re-check the match and start it again (40 full hunt states in 6 s). My server test missed it by calling `startNow()`. | The run starts on the next tick; found with a real socket against the test server. |
| 2 | The dev jump then started a small run and the pending start replaced it with a full one. | The dev jump cancels the pending start, and the pending start is checked first. |
| 3 | The stalker's glowing eyes were hidden (first by the brow, then by the snout). | Moved up and forward. |
| 4 | The mode card said "Graveyard" (the map file the maze lives in). | The card shows the mode's name. |
| 5 | A background restart ran from the wrong folder. | Ran it with the full path. |

# Batch 19 (11 Oct): Backrooms about 6x the first one, 500 crystals, speed-ups, red crystals

The user cut the big 7-step brief down to this (from "20x" to "6x", and about 500 crystals).

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Level 20 x 20 rooms of 6 m = 120 m (6.25x the first 48 m one): more halls, hallways, ceiling holes, a bigger flood | events.ts `BACKROOMS_LEVEL` |
| 2 | 500 crystals (up to 5 a room, spread, 30% at least 70 m out), 25 min timer | events.ts, CrystalHunt.placeCrystals / pick |
| 3 | Every 50 crystals (team count): everyone runs 3% faster, monkeys 2.5% faster, up to 10 levels; banner | `CRYSTAL_HUNT.speedUp`, ServerPlayer.eventSpeed, LocalPlayer.eventSpeed, MonkeyMind.speedBoost |
| 4 | 6 red crystals in dangerous spots (under ceiling holes, far dead ends): every monkey through walls (and on the phone) for 1:30, with a countdown | `redCrystals`, `redRevealMs`, HuntView, Chicken.setMonkeyXray |
| 5 | Performance: all crystals drawn as one instanced mesh per colour plus one point cloud of glows (3 draw calls); after the start, only pickups go over the network (not the 500-crystal list) | HuntView, CrystalHunt.state(full) |

## Tests

- 2 new tests:
  - at 50 crystals, speed level 1, and you and the monkeys are faster;
  - a red crystal gives 90 s of reveal.
- The full run collects all 500.
- The Phone Mission is now harder by its clock (200 s, a blackout) rather than by crystals.
- Full run: **460/460 pass**, build OK.
- Browser: 506 crystals (500 + 6 red), 20 monkeys, 180 fps; a red crystal gives "Monkeys visible 1:30", red monkeys through walls and red dots on the phone; no errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The countdown element had the same name as the fog-of-war method (typecheck caught it). | Renamed it. |
| 2 | The old test "the Phone Mission has more crystals than the Backrooms" can't hold with 500. | It checks the shorter timer and the blackout. |

# Batch 18 (11 Oct): bigger Backrooms, aggressive monkeys

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Level 4x bigger (16x16 rooms of 6 m, in `BACKROOMS_LEVEL`): backtracker + loops, halls with pillars, long hallways, a ring hallway, a flooded section, a wrong-coloured room, ceiling holes; walls merged | shared/src/maps/zones.ts, events.ts, night.ts |
| 2 | Performance: short raycasts use the collision grid; the level drawn in 24 m chunks; lamps looked after only near you, at most 3 stuttering; routes capped per tick | raycast.ts, collision.ts, World.ts, ZombieBrain |
| 3 | Monkeys: patrol, hearing, chase, search, pack screech and flanking, leap, swipe, stun, sleepers by crystals, ceiling drops, reinforcements every 30 s up to a cap | MonkeyMind.ts (new), CrystalHunt.ts, ZombieRoom, ServerPlayer, GameRoom |
| 4 | Phone: fog of war, zoom (+ / -), crystals within 14 m always shown | HuntView.ts, Input.ts |
| 5 | 18 crystals spread over the level, some far; 9 minute timer; dev `/backrooms small` and `/backrooms full` | events.ts, CrystalHunt.ts, GameSession, dev.ts |

## What was done

- **Level** (all numbers in `BACKROOMS_LEVEL`): 96 x 96 m (was 48 x 48), 198 boxes.
  - 4 pillar halls (3x3 rooms), 4 long hallways, a 5x4 ring, a 4x3 flooded block (water you can see; splashing is louder to monkeys), a 2x2 room in sickly pink light, 7 ceiling holes.
  - The map grew to 404 m to fit it (the playable graveyard is unchanged). The Facility stays where it was.
- **Performance:** the nav graph builds in 48 ms (about 150 before, with the bigger level the old way would be seconds). In the level: 180 fps, about 6 draw calls in view.
- **Monkeys** ([MonkeyMind.ts](server/src/rooms/zombies/MonkeyMind.ts), numbers in `MONKEYS`):
  - **Speeds:** walk 0.5, chase 0.97 of your run speed (faster than slow-walking), leap 2.4.
  - **Senses:** they see 22 m and hear footsteps (4 m quiet / 14 m running / 22 m splashing) and gunshots (40 m; silenced 12).
  - **Pack:** a screech brings the pack within 30 m, half of them flanking.
  - **Searching:** 8-10 s at your last known spot.
  - **Attacks:** leap every 2.6 s from 3.5-8 m; swipe every 0.46 s; a 0.3 s stun.
  - **Toughness:** 90 health; they flinch only briefly.
  - **Cast:** about 13 at the start (some asleep by crystals, some in the ceiling), +1 every 30 s out of sight, up to 24.
- **Phone** ([HuntView.ts](client/src/game/HuntView.ts), `PHONE`): fog of war (9 m round you and your team), zoom 30 m / 60 m / whole level, crystals within 14 m always shown.

## Tests

- 7 Backrooms tests (replacing 2):
  - **Level and run:** a big level, 18 crystals with some far, a scaled pack with sleepers, ceiling monkeys and a patrol; the full run to the portal.
  - **Senses:** the screech and the scare; hearing (a quiet step 30 m away: nothing; a gunshot: it comes).
  - **Searching:** for 8-10 s, then back to patrolling.
  - **Stun and reinforcements:** the stun; reinforcements every 30 s.
  - **`/backrooms small`:** 4 crystals and 3 monkeys.
- The open-spots test now uses the playable size.
- Full run: **458/458 pass**, build OK.
- Browser: `/backrooms full` gave 180 fps, 18 crystals and 13 monkeys; the phone showed fog of war and zoom; `/backrooms small` gave 4 crystals and 3 monkeys; no errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | A Write was refused (the file had changed since read). | Re-read, then wrote. |
| 2 | Heredoc patches failed again on long scripts. | Patch scripts written to files. |
| 3 | The Backrooms (18) now had more crystals than the "harder" Phone Mission (16). | The Phone Mission has 20. |
| 4 | My first phone draft read pixels from the fog mask for every crystal each frame (slow). | A set of seen rooms instead. |
| 5 | The splash code landed between an `if` and its `else` (typecheck caught it). | Fixed the order. |
| 6 | The open-spots test measured spread against the whole 404 m map. | It uses the playable part. |

# Batch 17 (11 Oct): story events, Crystal Hunt (Backrooms at wave 7, Phone Mission at wave 10)

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Event levels as sealed areas of the Graveyard map (outside the playable part, which gets an outer wall): a generated Backrooms maze and a generated dark facility, with their own floors, ceilings, lights and waypoints | shared/src/maps/zones.ts, night.ts |
| 2 | Config in one object (wave numbers, crystals, timers, enemies, rewards, onFail, lives, build flag) and the hunt state for clients | shared/src/events.ts |
| 3 | Shared Crystal Hunt module (server): teleport in, crystals, collect, portal, timer, fail/success, rewards, scares, clean-up | server/src/rooms/zombies/CrystalHunt.ts |
| 4 | The two events, in their own files, using it | server/src/rooms/zombies/events/backrooms.ts, phoneMission.ts |
| 5 | Monkeys: a new zombie kind that lurks at corners and ambushes; smarter in the second event | ZombieBrain, zombies.ts |
| 6 | Wave flow: the event replaces wave 7 (then wave 8) / comes before boss wave 10; C off during events (flag); dev `/wave N` | ZombieRoom, dev action |
| 7 | Client: crystals, portal, phone with minimap and counter, event looks (buzzing flickering fluorescents / dark facility), monkey model, scare sting (swappable placeholder) with shake and red pulse, HUD timer | client |
| 8 | Tests and browser checks | server/test, headless Chrome |

## Choices made (asked to choose)

- **Wave 7 Backrooms replaces wave 7:** after it, the shop, then wave 8 (`then: 'next'`).
- **Wave 10 Phone Mission comes before the boss wave:** after it, the shop, then wave 10 with its boss (`then: 'same'`). A boss guarding the exit would have trapped the timer behind a boss fight.
- **Failing** (time up, or every survivor down) costs one of 2 team lives (`onFail: 'loseLife'`, `lives: 2`); at 0 lives it's game over. `onFail: 'gameOver'` ends the game at once.
- **Scares:** a sting, a shake and one red pulse at the screen edge, never a white flash (the earlier "no flashing" rule).
- **The phone key is N** (H, J, K, L and P are HvH Lab/Skeet hotkeys).
- **An event wave is never a Blood Moon too.**

## What was done

- **The levels** ([shared/src/maps/zones.ts](shared/src/maps/zones.ts)): generated from a seed (the server and every client build the same walls).
  - **Backrooms:** 8×8 rooms of 6 m with yellow walls, a tiled ceiling, carpet, and fluorescent panels that stutter now and then.
  - **Facility:** 6×6 rooms of 10 m with doorways, concrete, crate piles and red emergency lights.
  - Both are sealed areas east of the graveyard. The Graveyard map is now 340 m wide, with a stone wall round the old 176 m playable part, so nobody can walk out.
  - Each level has its own waypoints, dead ends (monkey lairs), entrance and exit.
  - Grass grows only in the playable part.
- **Config** ([shared/src/events.ts](shared/src/events.ts) `CRYSTAL_HUNT`): wave numbers (7, 10), crystals (12 / 16), time (4 / 3:20 min), enemies (6 monkeys / 10 monkeys + 4 sprinters), smart, then, rewards (600 / 1000 money + full health + a free gun upgrade), the extra scare (half way, event 2), `onFail`, `lives`, and `buildDuringEvents` (false).
- **Shared module** ([CrystalHunt.ts](server/src/rooms/zombies/CrystalHunt.ts)):
  - teleports everyone in;
  - scatters the crystals one per room (never the entrance or exit);
  - puts the monsters in the dead ends;
  - collection by walking in, then the portal at the last crystal, and the scares;
  - timer, fail and success.
- **The two events** ([events/backrooms.ts](server/src/rooms/zombies/events/backrooms.ts), [events/phoneMission.ts](server/src/rooms/zombies/events/phoneMission.ts)): the second adds the half-way blackout.
- **The room** ([ZombieRoom.ts](server/src/rooms/ZombieRoom.ts)):
  - a new phase `event`; the waves pause;
  - C does nothing (flag);
  - on success, money, heal and a free gun upgrade;
  - on failure, a life or game over;
  - on either ending, back to the graveyard and the shop;
  - clean-up of monsters and state on end, restart and dev jump.
- **Monkeys** (new zombie kind, events only): faster than any zombie.
  - They lurk in their dead end until a survivor comes into sight within 11 m (or they're shot), then charge.
  - The first one to see you is a scare.
  - In the Phone Mission, half of them hunt you from the start.
  - Original model ([Monkey.ts](client/src/game/models/Monkey.ts)): hunched, long arms, pale scarred face, big ears, fangs, glowing yellow eyes. It sits on the chicken hitbox.
- **Client:**
  - [HuntView.ts](client/src/game/HuntView.ts): glowing purple crystals and the portal; the phone (map of the level, you, your team, the crystals, the portal, "Crystals 3/12", time), N makes it big; the scare.
  - Each level's own light (Game zone look).
  - The Backrooms buzz, and creaks in the facility.
  - The blackout turns every light out except your flashlight.
  - New synthesized sounds: crystal, portal, hoot, monkey shriek, buzz, power-down, and `scareSting`. `scareSting` is a placeholder: map a file to it in `FILE_SOUNDS` to swap it.
- **Dev shortcut:** type `/wave 7` or `/wave 10` in chat (Zombie Apocalypse, private room, dev passkey unlocked). It goes to the shop 3 s before that wave. It's a new dev action, checked on the server like every other dev tool.

## How to test each event

1. Start a private Zombie Apocalypse room and unlock the dev passkey (mega?dev, L).
2. Type `/wave 7` in chat (Y): 3 s later you're in the Backrooms.
   - The phone is on the right, and N enlarges it.
   - Walk into the purple crystals; the counter goes up.
   - At the last crystal, a scare plays and the portal opens at the far corner of the map.
   - Walk into it: "ESCAPED", +600 money, full health, a gun upgrade, then the shop, then wave 8.
3. Type `/wave 10`: the Phone Mission in the facility (16 crystals, more monkeys and sprinters).
   - Half way through the time, the power cuts out with a scare.
   - Escape: the shop, then boss wave 10.
4. To test failure, wait for the timer: "EVENT FAILED", one life lost (shown in the wave banner), and the game goes on. Set `CRYSTAL_HUNT.onFail = 'gameOver'` to make failure end the game.

## Tests

- 4 new server tests:
  - **Wave 7 in full:** teleported in; 12 crystals and 6 monkeys inside; no wave zombies; C builds nothing; collecting every crystal opens the portal; the portal brings you back with the money; the monkeys are gone; the next wave is 8.
  - **Spotting:** a monkey that sees you charges, and the scare is kept once.
  - **Failure:** time up costs a life and the game goes on; with `gameOver` the game ends.
  - **Wave 10:** more crystals, more monsters, less time, the blackout half way, then wave 10 with the boss.
- The map tests now check each sealed level separately (every waypoint reaches every other inside its own area).
- Full run: **454/454 pass**, build OK.
- Browser (GPU, test server with a throwaway passkey and database):
  - `/wave 7` typed in chat gives the Backrooms: yellow fog, 6 monkeys, "Crystals 0/12", the phone and its big view.
  - Walking onto a crystal gives "Crystals 1/12".
  - A monkey attacks you in its room.
  - The monkey model looks right.
  - `/wave 10` gives the facility: 16 crystals, 10 monkeys.
  - No page errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The new map broke the "every waypoint reaches every other" tests (sealed levels are separate on purpose). | Both tests check each area on its own. |
| 2 | The phone key H clashed with an HvH Lab hotkey (a test caught it). | The phone is N; its hint shows the bound key. |
| 3 | Event tests got cut short when monkeys killed the test player. | The test player is untouchable in those tests. |
| 4 | A patch script stopped half way (a CSS comment had already changed). | Re-ran the rest. |
| 5 | First looks: the hint still said "C · Build a wall" in events; the phone covered the chat; the facility was pitch black. | Event hint; the phone moved to the right; more emergency lights and a little more ambient light. |
| 6 | A browser-test teleport landed inside a wall and the physics pushed the player onto the ceiling (test only). | The test teleports to room centres. |
| 7 | Orphan test server processes again. | Killed by PID; the throwaway test database deleted. |

# Batch 16 (11 Oct): Zombie power-ups and the Exploder

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Power-ups: Nuke, Max Ammo, Insta-Kill (15 s), First Aid. 5% of zombies drop one, bosses always; they work for the whole team. Reuse the kill-drop system (new `PowerUpKind`, the old pickups untouched) | shared/src/pickups.ts, LootSystem, ZombieRoom |
| 2 | Exploder: a new zombie from wave 4. It lights a fuse next to you and bursts. Shot first, its blast is the shooter's and hurts zombies (chain kills) | zombies.ts, ZombieBrain, ZombieRoom |
| 3 | Client: glowing tokens seen through fog, announcement + sounds, Insta-Kill countdown; Exploder bloated pose that swells when lit, gurgle, fuse sound | Pickups.ts, LootView, GameSession, ZombieHud, Chicken, ZombieNight, Audio |
| 4 | Tests and browser check | zombie.test.ts |

## What was done

- **Power-ups.**
  - Drops: `LootSystem.dropAt` (the old `dropBonus` now uses it). Power-ups go through a new `GameRoom.applyPowerUp` hook; only ZombieRoom does anything with them, so other modes are unchanged.
  - The four power-ups:
    - **Nuke:** kills every zombie except the boss, and pays the kills. Its kills drop no more power-ups.
    - **Max Ammo:** full magazines and eggs for everyone.
    - **Insta-Kill:** any survivor hit kills, for 15 s (the countdown is on the HUD).
    - **First Aid:** everyone back to full health.
  - The settings (chance, lifetime, weights, Insta-Kill length) are in `ZOMBIE.powerUps`.
  - The dev ESP keeps showing only the normal pickups.
- **Exploder** (`ZOMBIE.exploder`, base stats in `ZOMBIE.base.exploder`):
  - It appears from wave 4, about 10% of a wave, growing like the other specials.
  - It has no claws. Within reach it lights a 0.75 s fuse (everyone hears it, and it swells and shakes), then bursts: 55 damage, 3.8 m.
  - Killed before that, it still bursts, but the blast belongs to the shooter, so it hurts zombies, not survivors.
  - It pays 4 coins.

## Tests

- 3 new zombie tests:
  - Max Ammo, First Aid, Insta-Kill and Nuke each work for the whole team, and the Nuke drops nothing;
  - a power-up on the ground is picked up by walking over it;
  - the Exploder lights its fuse, bursts and hurts you;
  - shot first next to a walker, its blast hurts the walker and not you.
- Full run: **450/450 pass**, build OK.
- Browser: all four tokens glow in the dark with their signs (Nuke, ammo, skull, cross); the announcement shows; no errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | In the power-up models, a three.js `position` was set with `Object.assign` (it's read-only); caught before running. | A small helper that calls `position.set`. |
| 2 | Signs on the back of the spinning tokens were invisible (back faces culled). | Sign materials are double-sided. |
| 3 | The first Exploder test killed every zombie, which ended the wave, so the zombie AI stopped. | The test keeps one zombie queued that never spawns. |
| 4 | Orphan test server processes again. | Killed by PID. |

# Batch 15 (11 Oct): something unique for Zombie mode, the Blood Moon

## Plan

| Step | What | Where |
| --- | --- | --- |
| 1 | Schedule (server): waves 3, 7, 11... (every 4th from 3, never a boss wave); in the zombie state | shared/src/zombies.ts, ZombieRoom |
| 2 | Effect (server): zombies x1.25 speed, x1.15 health; every coin that wave counts double | ZombieRoom |
| 3 | Look (client): the night turns crimson over 3 s during the shop countdown before it; a big cratered red moon; every zombie's eyes burn red | Game.ts, look.ts, ZombieNight, Chicken |
| 4 | Sound and HUD: a distant bell tolling twice over a low swell; "The Blood Moon rises…" and "Blood Moon · Wave N" on a red banner; announcement | Audio.ts, ZombieHud, GameSession, CSS |
| 5 | Test, browser check | zombie.test.ts, headless Chrome |

## What was done

- The server decides (`isBloodMoon`), so everyone in the room sees the same Blood Moon. `ZombieState.bloodMoon` is true from the shop countdown before the wave, so it rises while you get ready.
- The tint blends the map's own look ([bloodMoonLook](client/src/game/look.ts)): sky, fog, moonlight and ground move towards red.
  - It changes slowly (3 s up, 3 s down) and never flashes.
  - It is reset when you leave the match, so other maps are untouched.
- The moon is a canvas-textured plane inside the view distance that moves with you (low in the east). Its eye colours go back when the Blood Moon ends.

## Tests

- New zombie test:
  - the schedule (3, 7, 11; never a boss wave);
  - the room tells everyone;
  - zombies are faster and tougher;
  - coins are doubled.
- Full run: **447/447 pass**, build OK.
- Browser (GPU), with the state forced on:
  - the tint rises half-way in 1.5 s and fully by 3 s;
  - fog `#0b0f17` → `#3a0a0c`;
  - the red HUD banner shows;
  - the moon renders (cratered, glowing);
  - it goes back to normal when the state ends;
  - no errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | The first browser check forced the Blood Moon once, but the real server's next update (wave 1: no Blood Moon) turned it back off, which looked like a bug. | The test forces the flag on every update. |
| 2 | The first moon was a flat orange disc. | Canvas texture: red gradient, dark craters, soft halo. |
| 3 | Orphan test server processes again after stopping the background tasks. | Killed by PID (start time checked). |

# Batch 14 (10 Oct): better zombies, shop + chicken upgrades, gun sounds

## What was already there (explored first)

- Zombie types walker / sprinter / runner / brute / boss; ZombieBrain AI; boss every 5 waves with an on-screen health bar; in-match money for the zombie shop, but coins only from the generic match formula (max 150).
- Customize screen ([client/src/ui/Shop.ts](client/src/ui/Shop.ts)): emoji tabs, `window.confirm`. Coins and items in SQLite (`users.coins`, `inventory`), bought only through `POST /api/shop/buy` (server checks price and coins in one transaction).
- Sniper and Scout already exist (two zoom levels, in the buy menu, Training and Arms Race). Sniper did 80 body damage (not a one-shot); both shared one 'sniper' sound.
- All game sounds are synthesized in code (Audio.ts); there are distance falloff and muffling, but no echo, one reload sound and one empty click for every gun.

## Plan

| Step | What | Where |
| --- | --- | --- |
| A1 | Smarter AI: zombies spread round you (each has its own side), "hunters" go for the survivor with the fewest zombies near them (finds campers), forced waypoint routes after getting stuck | ZombieBrain |
| A2 | Each type unique: posture and gait, its own groan/steps, attacks (brute knocks you back, runner double-swipes, sprinter lunges) | Chicken, ZombieNight, Audio, ZombieRoom |
| A3 | Feedback: stagger when shot (longer on headshots, head snaps back), death bursts of feathers and bits | ZombieRoom, protocol `zombieHit`, Chicken, Effects |
| A4 | Waves: special types' share grows every wave | zombies.ts |
| A5 | Coins: per kill, per wave survived, boss bonus (own cap) | ZombieRoom |
| B1 | Chicken upgrades: 7 upgrades x 5 levels, prices, effects; only in PvE modes (Zombie, Training) | shared/src/upgrades.ts, modes.ts |
| B2 | Saved on the server like items (`upgrade:<id>:<level>` in `inventory`; a level needs the one before); rarity; Gun Skins; Daily Deals (same on server and client, the server charges the deal price) | items.ts, api.ts |
| B3 | Server applies upgrades in PvE only: speed/jump/glide (movement), max HP + armor (damage taken), reload, egg power | GameRoom, ServerPlayer, physics |
| B4 | Client predicts the same (from the join message), HUD shows real HP | LocalPlayer, WeaponController, Hud |
| B5 | New shop: tabs Upgrades / Skins / Guns / Knives / Gun Skins, deals strip, rarity colours, coins, try-on preview, confirm dialog, fairness note | Shop.ts, CSS |
| B6 | Gun skins drawn on guns (third person and first person) | Guns.ts, Chicken, ViewModel |
| C1 | Gun sounds: a voice per gun (crack, body, boom, mechanics), shared echo buses (far shots echo more), reload sequences per gun type, dry clicks | Audio.ts, GameSession |
| C2 | Sniper: one-shot body, slower bolt; Scout: faster bolt, steadier in the air; both: long echo + bolt pull after each shot, Sniper heavier | weapons.ts, Audio.ts |
| C3 | SOUNDS.md: every sound, where it comes from and its license | SOUNDS.md |
| D | Tests: upgrades buy/levels/deal prices, upgrades only in PvE, zombie coins, AI spreading, stagger; sniper one-shot; browser: shop, sounds, weapons | server/test, headless Chrome |
| E | (Asked mid-batch) A jumpscare when a zombie kills you | Jumpscare.ts, GameSession |

## What was done

- **A, zombies** ([ZombieBrain.ts](server/src/rooms/zombies/ZombieBrain.ts), [ZombieRoom.ts](server/src/rooms/ZombieRoom.ts), [shared/src/zombies.ts](shared/src/zombies.ts)):
  - **Smarter.**
    - Within 10 m, each zombie closes in from its own side (spread by golden-angle steps), so a crowd surrounds you instead of queueing.
    - 30% are hunters: they go for the survivor with the fewest zombies near them, so the one hiding gets found.
    - After getting stuck twice, a zombie follows waypoints only for 3.5 s. `findPath` got a `direct` flag for this; the default is unchanged.
  - **Each type unique.**
    - Posture and gait ([Chicken.undeadPose](client/src/game/models/Chicken.ts)):
      - walkers limp with their arms out;
      - sprinters crouch and twitch;
      - runners lean far forward;
      - brutes stomp;
      - bosses loom.
    - Zombies hold nothing: they claw.
    - Each type has its own voice and footsteps ([ZombieNight VOICES](client/src/game/ZombieNight.ts)), so you can tell which is coming before you see it:
      - walker: moan and shuffle;
      - sprinter: hiss and skitter;
      - runner: pant and patter;
      - brute: roar and stomp;
      - boss: deep rumble.
    - Attacks:
      - runners claw twice;
      - brutes knock you back;
      - sprinters lunge;
      - bosses slam.
    - Attack sounds: claws, or a smash for brutes and bosses.
  - **Feedback.**
    - A shot zombie staggers for 170 ms (480 ms after a headshot; brutes half that, bosses a quarter). It slows to 20% and can't hit back.
    - A new `zombieHit` event makes it flinch for everyone, and a headshot snaps its head back.
    - On death it falls apart: a burst of dark feathers, bits and grave dust, with its own death gurgle.
  - **Harder waves:** each special type's share grows 1.2% every wave, up to a cap. The boss still comes every 5 waves, with its health bar on screen.
  - **Coins** (account coins for the shop), paid at game over through a new `matchCoins` hook in GameRoom:
    - 2–6 per kill, depending on the type;
    - 10 + 2×wave to everyone standing when a wave is cleared;
    - 100 to everyone standing for the boss;
    - capped at 1,000 per game.
- **B, chicken upgrades** ([shared/src/upgrades.ts](shared/src/upgrades.ts)): Health, Speed, Jump (with a higher bunny-hop cap), Glide (glide fall speed and jetpack fuel), Egg Power, Armor and Reload. Each has 5 levels at 150 / 300 / 600 / 1,000 / 1,600 coins.
  - **Saved on the server** as inventory items `upgrade:<id>:<level>`. `POST /api/shop/buy` refuses a level unless you own the one before it, and charges the server's price (today's deal when there is one). The browser never sends prices, coins or levels.
  - **PvE only:** the new `ModeDef.pve` is set on Zombie Apocalypse and Training only.
    - RoomManager passes the levels in; GameRoom applies them only there and tells the client in the join message (`upgrades`, null in PvP).
    - The client predicts exactly what the server does (`withUpgrades` for movement, `reloadScale`).
    - Max health works as a damage share, so the health bar stays 0–100 and the HUD shows the real HP.
- **B, new shop** ([client/src/ui/Shop.ts](client/src/ui/Shop.ts)):
  - **Tabs:** Chicken Upgrades / Skins (feathers, hats, beaks, sneakers) / Guns / Knives / Gun Skins.
  - **Daily Deals strip:** 4 items at 25–50% off, the same for everyone each UTC day ([shared/src/shop.ts](shared/src/shop.ts)), with a countdown to new deals.
  - **Rarity colours** from the price: common, rare, epic, legendary.
  - **Coins pill**, and gun pictures drawn from the real models.
  - **Try-on:** clicking anything shows it on the chicken; a bar shows its name, rarity and Buy or Equip.
  - **A confirm dialog before every purchase.**
  - **Fairness note** on the upgrades tab.
  - **9 gun skins** (new cosmetic slot `gun`, seen by everyone): they recolour the gun body in third person and first person ([Guns.ts applySkin](client/src/game/models/Guns.ts)).
- **C, sounds** ([Audio.ts](client/src/game/Audio.ts)):
  - Shots now echo afterwards; far shots echo more.
  - Reloads by gun type: magazine guns, shells one by one, bolt guns.
  - A heavier dry click for big guns.
- **C, Sniper and Scout:** both already existed (two zoom levels, buy menu, Training B menu, Arms Race).
  - **Sniper:** 100 body damage (a one-shot), 1.7 s bolt (was 1.3 s).
  - **Scout:** 40 body, 104 head (a one-shot only to the head), 1 s bolt, and it stays accurate while jumping.
  - Each has its own sound: a crack, a boom, a 3–4 tap echo, and the bolt pulled after every shot. The Sniper's is deeper and heavier.
- **SOUNDS.md:** every sound and its source. All effects are synthesized in our own code and released as CC0.
  - The sniper used `AWP_SOUND.mp3`. The name points at Counter-Strike, so **it is no longer used**.
  - `SNIPER_ZOOM.mp3` and `equip_sound.mp3` have no known license and are no longer used either (the built-in sounds play).
  - `jumpscare.mp3` and the lobby music are still used, and are flagged for the owner to confirm.
- **E, zombie death jumpscare:** when a zombie kills you in Zombie Apocalypse, the jumpscare plays:
  - the chicken face turned rotten green;
  - your jumpscare.mp3, plus a zombie screech and roar;
  - one flash only, never strobing.
  - The Jumpscares setting (now labelled "developer pranks, zombie deaths") turns it off.

## Tests

- New [server/test/upgrades.test.ts](server/test/upgrades.test.ts) (14 tests):
  - levels count only in order;
  - prices rise;
  - the effects at max level;
  - only Zombie and Training use upgrades;
  - deals are stable for a day, cheaper, and never upgrades;
  - rarity;
  - over the real API: in-order buying, the server price, and a browser trying to set its own coins or levels is ignored;
  - deal prices are charged;
  - in matches: on in Zombie and Training, and **off in every PvP mode** (stats and movement normal);
  - less damage taken; faster reload;
  - Sniper one-shots the body; Scout one-shots only the head.
- Zombie tests (+3): stagger (longer after a headshot, sent to the room); different sides and hunters going for the lone survivor; coins at game over.
- Full run: typecheck clean, **446/446 pass**, build OK.
- Browser (headless Chrome, GPU):
  - The shop opens with 5 tabs, 4 deals, 7 upgrade rows and the note.
  - Buying Speed 1: confirm dialog → 250 → 100 coins, saved.
  - Tab card counts: Skins 47, Guns 21, Knives 8, Gun Skins 9.
  - Trying on the Gold skin shows a gold rifle on the chicken, with "Need 1,300 more".
  - In FFA upgrades are null; in Zombie the speed is 1.03.
  - All 16 new sounds play and free their audio nodes.
  - Standing still in Zombie mode, a zombie kills you and the zombie jumpscare shows.
  - No page errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | Bash heredocs failed again on long patches (quote matching). | Patch scripts written to scratchpad files and run from there. |
| 2 | One patch went in before its follow-up edit was saved, so the zombie scare sounds only played when jumpscare.mp3 was missing. | Moved them so they always play. |
| 3 | The old e2e test expected exactly 150 coins after buying the cap, which breaks on a day the cap is a deal; profiles now also have a `gun` slot. | The test uses `priceNow`; the expected profile includes `gun: 'none'`. |
| 4 | A test assigned a read-only field (typecheck caught it). | Cast in the test. |
| 5 | Shop tab row got squashed in the flex column. | `flex-shrink: 0` on the fixed parts. |
| 6 | Browser test selectors matched two elements ("Speed" also matches "hop speed"; "Skins" also matches "Gun Skins"). | Exact selectors. |
| 7 | Stopping the background test servers left orphan node processes again. | Killed them by PID after checking their start time. |

# Batch 13 (10 Oct): darker, scarier Zombie mode on a bigger map

## Plan

| Step | What | Where |
| --- | --- | --- |
| Z-A | Graveyard map 2x bigger (88 m half-size): old graveyard in the middle inside a stone wall with gates, an abandoned farm with a barn and silo, a cornfield of tall crops, narrow brick alleys, an open meadow with a campfire; lamps | shared/src/maps/night.ts, types.ts |
| Z-B | Zombie spawns spread over the whole map, never close to a survivor | server ZombieRoom.zombieSpawn |
| Z-C | Pathfinding from wave 1, nav graph built once per map, cheap nearest-waypoint lookup on the big map | ZombieBrain, shared/src/nav.ts |
| Z-D | Sprinter zombie: slow, then short sprint bursts | shared/src/zombies.ts, ZombieBrain, ZombieRoom |
| Z-E | Zombie look: dark torn feathers, glowing eyes seen through fog | client Chicken / RemotePlayer |
| Z-F | Night: darker sky and light, thick fog, camera stops drawing past the fog, slow subtle flickering lamps, flashlight on T (rebindable) | look.ts, World.ts, Game.ts, keybinds, Input, GameSession |
| Z-G | Sounds: groans louder when closer, footsteps, a screech when one spots you, wind, distant clucks and creaks (all soft) | client Audio.ts, GameSession |
| Z-H | Darker HUD and scoreboard in Zombie mode | CSS |
| Z-I | Tests: map loads, nav reaches everywhere, spawns spread and far, zombies reach players; browser: flashlight, FPS | server/test, headless Chrome |

## What was done

- **Z-A, map** ([shared/src/maps/night.ts](shared/src/maps/night.ts)): 88 m half-size (was 44: 4x the area). The old graveyard is the middle, now inside a 2.2 m stone wall with a 5 m gate on each side (the choke points). Around it: a cornfield (NW, 2.6 m tall rows, 2.8 m aisles, 3 lanes across), the farm (NE: red barn with big doors and hay bales inside, farmhouse, silo, tractor, broken paddock), a village of 3 m alleys with houses you can enter (SW), a chapel with old graves (S), dead trees and a tool shed (E/W), and the open meadow with a campfire (SE, the "safe-feeling" spot). 298 boxes. 12 lamps (`MapDef.lamps`, new optional field, looks only).
- **Waypoints:** the 8 m grid plus a point inside and outside every doorway (`house()` records them) and both sides of each gate. All 504 connect (test). Rows, aisles and alleys sit on the grid lines so routes go through them.
- **Z-B, spawns** ([ZombieRoom.zombieSpawn](server/src/rooms/ZombieRoom.ts)): any waypoint more than 16 m from the hut; at least 24 m from every survivor and, when possible, at most 55 m from the nearest (`ZOMBIE.spawnMaxDistance`), so they come from every direction without a long walk. With nobody standing, it measures from the survivor spawns.
- **Z-C, pathfinding** ([ZombieBrain](server/src/rooms/zombies/ZombieBrain.ts), [nav.ts](shared/src/nav.ts)): waypoints from wave 1 (was 3; the walls need it). The graph is built once per map over the map's own boxes (~150 ms at server start of the first zombie room), not per room over a world that may hold player-built blocks. Zombies skip ahead to a waypoint they can already walk straight to (no corner-cutting into gate posts). `nearestNavPoint` checks nearest first and stops at the first walkable one: same answer as before, far fewer raycasts (bots in other modes get the same result).
- **Z-D, sprinter** ([shared/src/zombies.ts](shared/src/zombies.ts)): from wave 2 (18% of a wave). Shambles at 0.45, sprints at 1.3 for 0.9 s every 1.8–3.2 s when within 30 m. Starting a sprint within 7 m it leaps at you (the "jumps from the dark").
- **Z-E, looks** ([Chicken.setAppearance](client/src/game/models/Chicken.ts)): zombies get a torn feather texture (rot blotches, bare patches, tears), feathers at about a third of the brightness, dead grey legs, a dried comb, no team scarf, and glowing eyes (acid green: walkers and runners; red: sprinters, brutes, bosses) that ignore fog.
- **Z-F, atmosphere:**
  - Night look: darker sky, moonlight 0.35, ambient 0.32, fog from 12 m to 35 m, no clouds ([look.ts](client/src/game/look.ts)).
  - The camera stops drawing at 48 m on this map (the sky dome shrinks to fit, the far hills hide). Grass is a third as dense there. The gun in your hands is lit to match the night ([Game.ts](client/src/game/Game.ts), [Sky.ts](client/src/game/Sky.ts)).
  - Lamps ([World.ts](client/src/game/World.ts)): lanterns glow through the fog; 3 real lights move to the nearest ones and fade in; flicker is two slow waves (under 0.5 Hz), at most 20% dimmer.
  - Flashlight ([ZombieNight.ts](client/src/game/ZombieNight.ts)): **T** (F is Inspect), rebindable in Settings › Keys, on at the start. The light stays in the scene and only dims, so switching never rebuilds shaders.
- **Z-G, sounds** ([Audio.ts](client/src/game/Audio.ts), [ZombieNight.ts](client/src/game/ZombieNight.ts)): groans every 3.5–8.5 s per zombie within 42 m (normal distance falloff makes them louder as they come), footsteps within 20 m (faster for sprinters), one screech when a zombie first comes within 18 m. Caps: one screech per 2.5 s, one groan per 0.6 s. Wind gusts all the time, a distant cluck every 10–24 s, wood creaking every 7–17 s. All are softer than gunfire.
- **Z-H, UI:** the HUD panels and scoreboard are a bit darker in this mode (`hud-zombie`). The welcome toast and the F1 guide mention the flashlight key.
- **Not changed:** other modes, maps, HvH cheats, dev mode. The flashlight is yours only: other players don't see your light.

## Tests

- New server tests ([server/test/zombie.test.ts](server/test/zombie.test.ts)):
  - The map is 2x wider and every waypoint is reachable.
  - Spawns from 4 places (hut, barn, village street, meadow) are 24–55 m away and come from several directions; with nobody alive they stay near the survivor spawns.
  - A walker teleported to the far village finds a survivor hiding in the barn (about 55 s of game time).
  - Sprinters burst and slow down again; sprinters come from wave 2.
- Full run: typecheck clean, **429/429 tests pass**, build OK.
- Browser (headless Chrome):
  - On the GPU: the map loads (88 m, view 48 m, fog 12–35 m), the flashlight goes 22 → 0 → 22 with T, zombies spawn 24–49 m out and reach the player within 15 s, 180 fps (the cap).
  - With CPU-only rendering on Low (a harsh stand-in for a weak PC): night map 16–54 fps vs 11–22 fps on the normal Farm map with the same setup. The fog cut-off more than pays for the lights.
  - Screenshots: a zombie at 18 m is a dark shape with glowing eyes in the fog.
  - All 6 new sounds play and free their audio nodes. No page errors.

## Mistakes log

| # | Mistake | Fix |
| --- | --- | --- |
| 1 | Shell heredocs carrying Python edits broke twice (quote mismatch; once `cat >` waited on input and hung the shell for 2 min). | Used the file editor and small `python -c` edits instead. |
| 2 | First map draft: two waypoints were inside closed houses, so they couldn't be reached. | Waypoints inside and outside every door (`house()`). |
| 3 | Zombies stalled at the cemetery gates and on tree corners: waypoints were off the gate line, and they turned toward the next waypoint 2 m early, clipping posts. | Gate waypoints; skip to the next waypoint only when it is in a straight walkable line. |
| 4 | The cemetery wall corners overlapped (the map test caught it). | East/west wall pieces fit between the north/south ones. |
| 5 | Sprint speed set by spreading `p.mods`, which can be null (typecheck caught it). | `sanitizeMods` like the room does. |
| 6 | First zombie look was still cute: bright orange legs and comb, a blue team scarf, pale eyes. The night clouds were too bright. | Dead legs and comb, no scarf, darker feathers, acid green or red eyes; no clouds at night. |
| 7 | One browser run spawned zombies 100 m out: the player wasn't alive yet when the wave began, so there was nobody to measure from. | Measure from the survivor spawns then (test added). |
| 8 | Stopping the background dev server and Vite left orphan node processes on ports 3000 and 5176 (known issue). | Killed them by PID after checking their start time. |

# Batch 12 (10 Oct): security check, and an F1 guide

## Security audit (whole game)

| Area | What I checked | Result |
| --- | --- | --- |
| Dependencies | `npm audit` (production) | 0 known vulnerabilities |
| Passwords | storage | scrypt with a random salt; a dummy hash so usernames can't be probed |
| Sessions | cookie flags | HttpOnly, SameSite=Strict, Secure on HTTPS; expiry and "log out everywhere" |
| Cross-site attacks | API and sockets | requests from other websites refused (Origin check); strict CSP; no framing |
| Rate limits | logins, sign-ups, guests, edits, joins, chat, reports, friends, dev passkey | all limited, per real player IP (the Dockerfile trusts Railway's proxy) |
| Dev cheat passkey | where it's checked | server only, timing-safe compare, never in the page; guesses limited per account and per network |
| Player input | every socket event | parsed and range-checked; movement and shooting run on the server (no speed, teleport or fire-rate hacks) |
| Injection | HTML in the page; database | player text is always shown as text; the only HTML inserted is the game's own fixed drawings; database queries are prepared statements |
| Crashes | junk on every event (new [server/test/fuzz.test.ts](server/test/fuzz.test.ts)) | ~36 events x 30 kinds of junk x 3 forms, in every non-ranked mode: no crash, no uncaught error, no prototype pollution; Railway also restarts on failure |

**Fixed in code:** nothing needed fixing. The new fuzz test now guards against future crash bugs.

**For you to change on Railway (settings, not code):**
1. **`DEV_ACCOUNTS_ONLY=1`.** Right now anyone who guesses the dev passkey gets the dev cheat in public rooms. With this, only your developer account may even try.
2. **A long passkey** (12+ random characters). The server warns about short ones.

**Known limits (by design, worth knowing):**
- In casual modes, every player's position is sent to every client (ranked FaceChiken hides players you can't see), so a modified client could see through walls there.
- Chat has no swear filter or mute button yet.

## F1 guide

- **F1** (anywhere: title screen or in a match) opens **How to play**: first steps, moving, fighting, other keys, every mode with its icon, and good-to-know notes (levels only move in FaceChiken, HvH is the cheats-allowed mode, daily challenges, reporting). F1 again, Esc or ✕ closes it.
- The keys come from your own bindings and the modes from the mode list, so it stays right after rebinding or adding modes. It's also on the title screen ("How to play · F1", replacing the old Controls pop-up) and in the pause menu.
- Code: [client/src/ui/Guide.ts](client/src/ui/Guide.ts); F1 in [client/src/app/App.ts](client/src/app/App.ts) (it also stops the browser's own F1 help page).
- **Checked in the browser:**
  - F1 opens it (6 sections, 13 modes, 18 key rows); F1 again closes it; the title-screen link opens it.
  - In a match, F1 opens it and pauses input, and the pause menu has the button.
  - The phone layout fits, with no errors.
- Typecheck, the build, and three full test runs (425/425) pass.

## Mistakes log (batch 12)

1. **The fuzz test's first run failed on a join.** The storm had used up the player's join rate limit, which is the limit working. **Fix:** a fresh player per mode.
2. **One full test run failed in the Knife Fight bot test.** It's the timing-flaky test noted in batch 1; this batch touched no bot or knife code, and three reruns passed 425/425.

# Batch 11 (10 Oct): Training mode

Solo practice: any gun, any knife, targets that never shoot back, no clock, no score, nothing counted.

Key: **B** is already the action key in ChikenBomb (buy menu), Zombie Apocalypse (shop) and Sandbox (build), but in a Training room it does nothing else, so B opens the weapon menu there.

## The plan

| # | Step | Status |
| --- | --- | --- |
| T1 | Shared: the `training` mode (Casual), its gun and knife lists, training ammo rules, a `trainingGive` request | Done |
| T2 | Server: a `TrainingRoom` (always your own private room); targets: static and slowly strafing dummies that never shoot and respawn 3 s after dying (and heal 3 s after a hit); you take no damage; kills count for nothing; the match never ends; infinite ammo, instant reload, grenade refills | Done |
| T3 | Server checks the weapon menu: only in Training, only known guns/knives | Done |
| T4 | Lobby card: icon, "Solo · practice", description, map choice, Play | Done |
| T5 | Weapon menu (B): every gun, every knife, egg/smoke/flash refills; B or Esc closes; the HUD and pause match (pause says "Back to lobby") | Done |
| T6 | Tests and a live check: starts from the lobby, B menu, every weapon and knife, targets respawn, no timer, can't die, stats unchanged | Done |

## What was done (batch 11)

- **T1 Shared.**
  - [shared/src/modes.ts](shared/src/modes.ts): the `training` mode on Flat, Farm and Town. One human (`maxHumans: 1`), no time or score limit, targets respawn after 3 s, no bots, no drops, no spawn protection.
  - [shared/src/training.ts](shared/src/training.ts): the gun list (Arms Race's ladder order first, then every other gun: 21) and the knife list (every melee weapon: 8). Also the ammo rules (`trainingMods`: infinite ammo, instant reload, infinite flashes) and `trainingLoadout` (one gun + one knife).
  - [shared/src/protocol.ts](shared/src/protocol.ts): the `trainingGive` request.
- **T2 Server room.**
  - [server/src/rooms/TrainingRoom.ts](server/src/rooms/TrainingRoom.ts): 8 brown targets on open ground 7-35 m from your start, a few of them strafing slowly across your view. They turn to face you, never shoot, heal 3 s after a hit and respawn at their spot 3 s after going down.
  - You can't be damaged at all (targets, your own eggs or rockets; the game has no fall damage).
  - Downed targets count no kill and no score (`kill(..., counted = false)`, from the team-switch work).
  - `endMatch` does nothing, and since that is the only place results reach the database, nothing is ever recorded.
  - **Plumbing:** [modes.ts](server/src/rooms/modes.ts) picks the room. [RoomManager.ts](server/src/rooms/RoomManager.ts) always makes your own private room (a random map for "Any map"). [GameRoom.ts](server/src/rooms/GameRoom.ts) only changes `pickSpawn` from private to protected, so Training can choose spawns.
- **T3 Checked by the server.** [server/src/app.ts](server/src/app.ts) answers `trainingGive` only in a Training room, and the room accepts only weapons from the two lists or one of the three grenades.
- **T4 Lobby card** (Casual tab): a drawn target icon, "Solo · practice", the description, the map choice and Play. It has no leaderboard trophy and is not offered in Create room or on the leaderboards ([MainMenu.ts](client/src/ui/MainMenu.ts), [icons.ts](client/src/ui/icons.ts), [Dialogs.ts](client/src/ui/Dialogs.ts)).
- **T5 Weapon menu (B).**
  - [client/src/ui/TrainingMenu.ts](client/src/ui/TrainingMenu.ts): guns and knives shown with their own pictures (the kill-feed silhouettes), plus egg, smoke and flash refills. What you hold is marked; B or Esc closes it.
  - [GameSession.ts](client/src/game/GameSession.ts): opening the menu frees the mouse, and a pick switches you to that weapon.
  - [WeaponController.ts](client/src/game/WeaponController.ts) predicts the same infinite ammo and instant reload, without touching dev code.
  - **HUD:** a practice line, no leaders list, and the hint "B · Weapons · Esc · Back to lobby" ([Hud.ts](client/src/ui/Hud.ts)).
  - **Pause** says **Back to lobby** and hides Report a player ([App.ts](client/src/app/App.ts)). Styles are at the end of [style.css](client/src/style.css).
- **T6 Checked.**
  - **Server tests:** [server/test/training.test.ts](server/test/training.test.ts), 5 tests.
  - **Live from the lobby:**
    - The card shows "Solo · practice"; the room has 8 targets, no timer and no end time.
    - B opens 21 guns, 8 knives and 3 grenades, and all 29 weapons land in your hand. Esc closes.
    - A rifle target went down and came back; the magazine stayed 30/30.
    - You stayed at 100 HP with 0 kills and 0 score. Pause showed Back to lobby, which returned to the title.
    - Coins, rank points, kills, deaths, wins, matches, history and daily progress were identical before and after.
  - Typecheck, all 424 tests and the build pass. No HvH panel or dev mode file changed.

## Mistakes log (batch 11)

1. **The card showed a leaderboard trophy, and "Any map" always picked Flat.** Both spotted in the screenshots and fixed.
2. **Test-script slip:** the pause backdrop blocked a headless click; the script clicks through script. Not a game bug.

# Batch 10 (8 Oct): the dev cheat's anti-aim works again

- **The bug.**
  - In the dev cheat (mega?dev, the L key), Rage > Spin bot and Fake pitch did nothing.
  - An outside PR (mazocracks-pixel, d57df7b, 5 Oct) made the dev cheat's input changes run **only in HvH**. The same day, your rule made the dev cheat **off in HvH**. Together they could never run anywhere.
- **The fix.** One line in [client/src/dev/classic/DevRuntime.ts](client/src/dev/classic/DevRuntime.ts) (`modifyFrame`): the HvH-only check is gone. The dev cheat's own on-switch already keeps it off in HvH and ranked FaceChiken (the server decides that), so nothing else changes.
- **Same cause, also back.** The dev cheat's other input options were blocked by the same line: jump assist, auto strafe, movement assist, and keeping your chicken still during free cam and spectate. Only anti-aim was tested.
- **Checked live.** Two players in a private Team Fight; one turned on the dev cheat with the passkey.
  - The other player saw the body spin, fake pitch Down (-1.2) and Up (1.05), and jitter around backwards.
  - Turned off, everything went back to normal.
  - Walking while spinning went exactly where the camera faces.
- **Test.** [client/test/classic-antiaim.test.ts](client/test/classic-antiaim.test.ts) fails without the fix and passes with it. Typecheck, all 419 tests and the build pass.
- **Mistake.** My first live test showed sideways drift while walking. It was the match-start respawn resetting the camera mid-test, not a bug; the test now waits for the match to start.

# Batch 9 (7 Oct): pitch anti-aim fix

- **The bug.** In the **Skeet** panel, Pitch (Look / Down / Up / Zero) did nothing once **Use state builder** was off: your head always followed your real look. The setting is stored with the state builder, and the server only read it while the builder was on. Skeet has no separate fallback pitch, so nothing applied.
- **The fix.** One line in the shared function the server uses to choose the head pitch (`hvhPitch` in [shared/src/hvh.ts](shared/src/hvh.ts)): Skeet's Pitch now applies with the builder on or off. The Lab panel and bots are unchanged. The hit head still follows the drawn head (the head test checks Down, Look and Up).
- **Checked live.** Two players in one HvH room; one tried every pitch with Lab, Skeet with the builder on, and Skeet with it off, while the other watched. Before the fix, Skeet with the builder off showed -0.15 (the real look) for every choice. After it, every combination is right on the server and on the other player's screen: Down -1.15, Up 0.85, Zero 0, Look the real pitch.
- **Tests.** The pitch test now covers the builder-off case. Typecheck, all 418 tests and the build pass.
- **Mistakes.** Two test-script slips: I asked for a map HvH doesn't use (Flat), and clicked through the setup overlay. Neither was a game bug.

# Batch 8 (7 Oct): no "No matches running"

- The line under the title bar no longer says "No matches running". When nobody is in a match it is hidden; when people are playing it shows "N players in matches" (it refreshes every 20 seconds). "Offline" still shows if the server can't be reached. Code: `refreshLive` in [client/src/ui/MainMenu.ts](client/src/ui/MainMenu.ts).
- Checked in the browser (the row shows Controls and Cookies & privacy); typecheck, all 418 tests and the build pass.
- Mistakes: none.

# Batch 7 (7 Oct): textures and surfaces on the title screen

The title screen's sky and ground are the live 3D Courtyard scene, not a flat page colour, so the sky and ground work happens in the 3D world (only on that map) and the buttons, logo and panels in CSS. The chicken is not touched: no change to its model, run, speed, size or spot, and nothing is drawn on it.

**One style: hand-painted**, like the chicken (soft painted shapes, feather scallops, no outlines), not pixel art. Every texture is painted in code (canvas or tiny inline SVG), so nothing is downloaded and nothing is sharper than the chicken.

## The plan

| # | Step | Status |
| --- | --- | --- |
| AA | Sky: hand-painted puffy clouds at several distances, drifting slowly (they shift against each other as the camera moves: parallax), a fine grain in the sky so it isn't a flat smooth gradient, and a soft warm haze at the horizon. The noise clouds are off here. Reduced motion: the clouds stop | Done |
| AB | Ground: a new "yard" ground of painted packed dirt, sand, pebbles and grass flecks, with large patches of colour across the yard so the repeat doesn't show; a worn dirt track along the chicken's lap; painted grass tufts off the track | Done |
| AC | Buttons: painted wood signs (PLAY in yolk paint over wood grain, nail heads), a stained-plank bottom bar, wooden plaques for the menu buttons. Pressing really pushes them in | Done |
| AD | Logo: painted letters (brush streaks inside the yolk) with a hard offset shadow; the HVH badge as a red painted plank | Done |
| AE | Panels: Today and What's new on dark burlap with a stitched edge; the mode select on paper with fibres | Done |
| AF | Checks: before/after screenshots with the chicken at the same spot on its lap, desktop and phone, textures well under 200 KB, smooth on phones | Done |

## What was done (batch 7)

- **AA. Sky** (Courtyard only: [client/src/game/Sky.ts](client/src/game/Sky.ts), [client/src/game/Yard.ts](client/src/game/Yard.ts)).
  - Twelve painted puffy clouds (round puffs, flat cool-grey bottoms, brushed highlights) at three distances: far ones small and slow, near ones bigger and quicker, so they slide past each other as they drift (parallax).
  - A fine grain over the sky so it isn't a flat smooth gradient, and a warm haze along the horizon.
  - The old noise clouds are hidden on this screen but stay in the baked lighting, so everything is lit exactly as before.
  - With reduced motion turned on, the clouds stand still (checked).
- **AB. Ground.**
  - A new "yard" ground ([client/src/game/textures.ts](client/src/game/textures.ts) `yardTexture`): painted packed dirt and sand, pebbles and grass flecks, in a 512 px tile.
  - The ground's large colour patches break up the repeat. The tile repeats about every 140 m, so no repeat is visible from the title camera.
  - A worn dirt track with ruts and kicked pebbles runs under the chicken's lap, its edges wobbling.
  - About 240 painted grass tufts sit off the track and out of the buildings, all drawn in one call.
- **AC. Buttons.**
  - PLAY is a painted wooden sign: yolk paint over wood grain, two nail heads, and it sinks with a dent when pressed.
  - The bottom bar and the line under it are dark stained planks with seams and nails.
  - Change mode and the menu buttons are small wooden plaques: grain, a lighter top edge and a hard drop. Pressed, they sink and darken.
- **AD. Logo.** Brush streaks of light and dark yolk painted inside the letters, the ink outline, and a hard offset shadow (no blur). The HVH badge is a red-painted plank.
- **AE. Panels.**
  - Today, What's new and your profile tag are dark burlap with a stitched yellow edge and a hard shadow.
  - The mode select and its tickets are paper with faint fibres.
- **AF. Checks.**
  - **The chicken.** No chicken file changed (model, run, speed, size and spot), and nothing is drawn on it. To prove it, before and after were rendered with the chicken pinned at the same spot and stride, and its pixels compared inside its exact silhouette.
    - Phone: 130,537 of 130,537 chicken pixels identical.
    - Desktop High: 99.8% identical. Two renders of the same new scene also differ by about that much (77 pixels), so the rest is High quality's render noise in the test browser, not a change.
  - **Size.** The CSS textures are 6 inline SVGs, 3.3 KB in total; the 3D ones are painted in code when the page loads. Nothing new is downloaded, far under 200 KB.
  - **Cost.** 14 extra draw calls on the title screen only (12 clouds, the tufts, the track). Matches are untouched.
  - **Contrast.** The text is unchanged and keeps its colours. The burlap, grain and fibres are faint.
  - **Tests.** Typecheck, all 418 tests and the build pass (real exit codes, test servers stopped first).

## Mistakes log (batch 7)

1. **Turning off the old clouds changed the chicken's lighting.** I first set the title look's clouds to 0, which also removed them from the baked sky lighting the chicken is lit by. The pixel check caught it. **Fix:** the clouds are hidden only in the visible sky; the lighting keeps them.
2. **Vite hung while I swapped files under it** (setting the changes aside to take "before" shots). **Fix:** stop Vite, swap, start it again.
3. **My first chicken comparison was wrong twice.** A brightness-based mask also caught the pale sky, and the run cycle starts at a random moment. **Fix:** pin the stride, compare inside the chicken's real silhouette, and measure the renderer's own noise.
4. **Shell edits broke again.** An inline `node -e` edit failed because the stash brought the files back with Windows line endings, and a heredoc mangled a template string. **Fix:** file editor only (the rule from batch 1).

# Batch 6 (7 Oct): the menu moves to a bottom bar, and a more serious look

Why the menu was on the left: the running chicken is on the right of the title screen (as asked in an earlier batch), so the menu went on the other side to stay clear of it. Your choice now: **a bar along the bottom**, with the logo top-left and the chicken staying on the right.

## The plan

| # | Step | Status |
| --- | --- | --- |
| Z1 | Title screen: PLAY and every menu button in one dark bar along the bottom (full width), with the online count, controls and privacy in a thin line under it. Today's challenges and what's new move into the empty space on the left. The chicken stays where it is | Done |
| Z2 | More serious: nothing tilted (PLAY, the HVH badge, the cards, the "wins" tag), a calmer logo shadow, darker panels on the title screen | Done |
| Z3 | Plainer wording: "Leaderboard", "Competitive" / "Fun" tabs, "Choose a mode", "No bots", "Resume", "Enter the code", "Wrong code" and similar | Done |
| Z4 | Phone: the same bar at the bottom (PLAY, then a row of icons); check desktop, wide screen and phone | Done |

## What was done (batch 6)

- **Z1. The bottom bar.**
  - **Bar:** PLAY (with your mode, map and bots line) and Change mode on the left; Shop, Friends, Daily, Leaderboard and Settings on the right. It is full width, dark, with a yolk line along its top. A thin line under it shows who is playing, Controls, and Cookies & privacy.
  - **Left side:** Today's challenges and What's new sit in the empty space on the left, on dark panels with a yolk edge.
  - **The chicken** is untouched and keeps the right side. The hide-menu button moved to the top right, under your profile.
  - **How:** the layout is CSS only (the menu's wrapper is set to `display: contents`, so PLAY, the buttons and the cards each take their own row of the title grid). No game logic changed.
- **Z2. More serious.**
  - **Nothing tilted:** the PLAY button, the HVH badge, the What's new card and the winner tag on the match-over screen.
  - **Calmer logo:** a plain dark drop shadow (the red layer is gone), and the HVH badge sits flat.
  - **Darker panels:** the profile tag and the info cards use the same dark ink as the bar. The mode select, dialogs, HUD and keypad keep the batch-3 look.
- **Z3. Plainer wording.**
  - **Title screen:** "Top chickens" is now Leaderboard, "Switch mode" is Change mode, and the online line reads "No matches running" / "N players in matches".
  - **Mode select:** "Pick a fight" is now Choose a mode, "Serious" / "Silly" became Competitive / Fun, and "Humans only" is No bots.
  - **Pause, keypad and HvH:** "Click to jump back in" is now Click to resume; the keypad says "Enter the code", "Wrong code." and "Access granted"; the HvH choice is "Choose your panel". What's new is plainer too.
  - **Server:** its wrong-code reply and the test for it changed to match. The Skeet QA script looks for "Change mode" again.
- **Z4. Phone.** The same dark bar at the bottom: PLAY full width, Change mode, then five big icon buttons, and the status line. The logo and HVH stay on one line. The chicken is clear in the middle.
- **Checked:**
  - Screenshots at 1280x720, 1920x1080 and a phone, plus the mode select. No sideways scrolling, no errors.
  - `check-native-menu.cjs` passes.
  - Typecheck, all 418 tests and the build pass, checked by their real exit codes with the test servers stopped first.
- Code: the end of [client/src/style.css](client/src/style.css) ("Batch 6"), the wording in [client/src/ui/MainMenu.ts](client/src/ui/MainMenu.ts), [client/src/app/App.ts](client/src/app/App.ts), [client/src/ui/HvhSetup.ts](client/src/ui/HvhSetup.ts), [client/src/dev/passkey.ts](client/src/dev/passkey.ts), [server/src/app.ts](server/src/app.ts).

## Mistakes log (batch 6)

1. **First try: the status line sat beside the bar, not under it.** A batch-3 rule placing it (`.main-menu.lobby > .lobby-bottom`) was more specific than the new one, so both landed in one row and the grid grew a second column. **Fix:** the new rows use the same selectors, and the grid has exactly one column.
2. **First try: text wrapped.** "Change mode" and the PLAY mode line broke onto two lines, and on phones "HVH" fell under the logo. **Fix:** no wrapping on those labels, and a slightly smaller phone logo.

# Batch 5 (7 Oct): no names over enemies

| # | Step | Status |
| --- | --- | --- |
| Y | Names above chickens: teammates keep theirs, enemies don't show one. In free-for-all modes everyone is an enemy, so no names | Done |

- One flag on each remote chicken ([client/src/game/RemotePlayers.ts](client/src/game/RemotePlayers.ts)): the tag shows only when that chicken is a teammate. It follows a team switch (M) at once. The scoreboard, kill feed and chat still show every name. The cheat panels' own name ESP is unchanged.
- Checked in a Team Fight with bots: the teammate showed a name, the 2 enemies showed none, and the same held after pressing M. In Against All, 3 enemies, no names. All tests and the build pass.
- Mistakes:
  1. **Pushed while one test had failed.** The first full run said 417 of 418 (my test servers were still running and loading the CPU). The commit went ahead anyway: in `npm test | grep …` the exit status is grep's, not the tests'. Five reruns right after were all 418/418, so it was a timing-sensitive test under load, not this change. **Rule:** read the `fail 0` line before committing, and stop the test servers before the full run.

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
