# DOCS: plan, progress and mistakes

Working notes for the current batch of work. The plan comes first, then what was done for each
step, then a log of every mistake made along the way (what went wrong, and how it was fixed).

## The plan

| # | Step | Status |
| --- | --- | --- |
| A | Your sounds: `AWP_SOUND` (sniper shot), `SNIPER_ZOOM` (scoping in with the Sniper or Scout), `equip_sound` (switching weapons) | Done |
| B | Scope on every sniper (Sniper and Scout): click once to scope, it stays; click again to zoom in further; a third click leaves the scope. No more scroll wheel | Done |
| C | Kill feed icons: a silhouette for every single gun, not one per gun family | Done |
| D | Better inspect (F): longer, smoother, a different move per kind of weapon | Done |
| E | More detailed gun shapes | Planned |
| F | Main menu: look and feel like a game, not an app, with new features; checked in the browser | Planned |

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

_Steps E and F follow below as they are finished._

## Mistakes log

- **A test that depended on the date (from yesterday).** When daily challenges were added, I adjusted a ranks test to leave out daily-challenge coins, but only from the second match it records. Today one of the daily goals is "win a match", which the test's first match completes, so the test failed. It would have passed or failed depending on the day. Fix: the test now leaves out the daily coins of both matches. Checked by running it as if it were each of the next 20 days: it passes on all of them.
- **A wrong path in my own check.** The first 20-day check failed on every day, because the helper file's path lost its backslashes and never loaded, not because of the game. Fixed by putting the helper next to the tests. The real result is the second run (0 failing days).
- **DOCS.md text eaten by the shell.** I wrote the DOCS entry through a shell command, and the shell treated the backtick-quoted file names as commands to run, so they vanished from three lines (it only printed harmless "not found" errors; nothing was changed). Fixed by hand, and from now on DOCS.md is only edited with the file editor, never through the shell.
- **Magazine click repeating.** In the first version of the new inspect, the "magazine in" click played on every frame after the magazine check finished, instead of once. Caught by recording the clicks; fixed so each click plays exactly once per inspect (checked over two full inspects: out, in, out, in).
- **Magazine check pointed the wrong way.** My first magazine-check pose tipped the rifle so it pointed at the sky, with the magazine off screen; my second showed the top rail instead. I then rendered three candidate poses side by side and picked the one where the magazine faces you.
- **A slow test, not a bug.** "Knife Fight bots charge in to stab" failed once in a full run and passed three times on its own and in the next full run. It waits 4 real seconds for a bot to walk over, so a busy machine can make it miss. Nothing in this change touches bots or the server.
