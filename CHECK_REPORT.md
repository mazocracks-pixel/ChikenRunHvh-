# Dev cheat config presets: please check

The presets are in **mega?dev** (L, behind the dev code), Configs tab. Skeet and the HvH Lab (Insert) are unchanged.

## What the dev cheat has (setting, range)

| Tab | Settings |
| --- | --- |
| Legit / Aim | `legit.aim.enabled`; FOV `legit.aim.fov` 1-30°; Smoothness `smooth` 1-20; Strength `strength` 0-100 %; Reaction `reaction` 0-500 ms; Target `target` head / body / nearest (head or chest, whichever is closer); visibility check, team check, aim key, only while firing, only while ADS |
| Legit / Trigger | `legit.trigger.enabled`; delay 0-500 ms; FOV 0.25-10°; key; visibility check |
| Legit / Movement | bunny hop, auto strafe (HvH only), movement assist, jump assist |
| Legit / Wallhack (used as "chams") | on/off, enemies, teammates, enemy colour, teammate colour, opacity 0.1-1 |
| Rage / Aim | `rage.aim.enabled`; target lock; silent; instant switch; priority health / distance / crosshair; hitbox head / body; FOV 1-180°; auto target (auto fire) |
| Rage / Weapon | no recoil, no spread, infinite ammo, instant reload, rapid fire (x3), automatic fire, infinite magazine, no rocket cooldown, no rocket damage, unlimited flashbangs |
| Rage / Movement | speed and jump multipliers (server limits), fly, noclip, infinite stamina, low gravity |
| Rage / Anti-aim | spin bot; spin speed 60-3600 °/s; direction right / left / jitter; fake pitch normal / down / up |
| Visuals | ESP on/off, box, name, health bar, distance, weapon, skeleton, snaplines, head circle, glow; world ESP (items, weapons, spawns, objectives, hitboxes, collision); colours, opacity |
| Weapons | fire rate, damage, recoil 0-3x, spread, projectile speed, magazine (multipliers, server limits) |
| Misc | crosshair, hitmarker, damage indicator, free camera, spectator, readouts (FPS, ping, coords, velocity, speed, map info), auto jump |

Gameplay values (speed, fire rate, damage, fly...) still only work where the server allows dev mods.

## How each preset maps

| Preset | Mapped to |
| --- | --- |
| Totally Legit™ (Legit) | legit aim on, FOV 2°, smooth 16, strength 35 %, reaction 180 ms, target body; trigger, ESP, anti-aim, bhop off |
| Gaming Chair (Semi Legit) | legit aim FOV 5°, smooth 8, target nearest (head + chest); trigger 120 ms; ESP boxes only; bhop; recoil 0.5x (50 % control) |
| Closet Cheater (Semi Rage) | legit aim FOV 15°, smooth 3, strength 85 %, target head; trigger 40 ms; recoil 0x (100 % control); ESP box + name + health; wallhack on enemies; spin jitter 240 °/s; bhop |
| $9 YouTube Config (Rage) | rage aim FOV 180°, silent, auto fire, head; full ESP + glow; wallhack on enemies; spin jitter 720 °/s; no recoil; bhop |
| Memesense (HvH) | rage aim + silent + auto fire; full ESP; wallhack; jitter 1080 °/s with fake pitch down; no recoil; bhop + auto strafe |
| UID Issue (HvH Rage) | rage aim + silent + auto fire + instant switch; full ESP; wallhack; spin 720 °/s, fake pitch down; no recoil, no spread, rapid fire, automatic; bhop + auto strafe |
| Pasted from GitHub (Meme) | a new random roll on every load: aim, trigger, bhop, wallhack, spin, no recoil, every ESP checkbox, FOV, smoothness, spin speed, target, direction, pitch, enemy colours |
| Spinbot Supreme (Meme) | aim off; spin 3600 °/s (the max), fake pitch up; wallhack on everyone in magenta / cyan |
| Dev's Grandma (Meme) | legit aim FOV 1°, smooth 20, strength 10 %, reaction 500 ms; ESP names only |

Loading a preset keeps your menu settings (key, theme, scale), World colours and selected weapon.

## Skipped (not in the dev cheat; tell me if you want any)

| Asked for | Why skipped |
| --- | --- |
| Headshot chance % (Legit) | No such setting; Legit aims at the body instead. |
| Small radar (Legit) | The dev cheat has no radar. |
| Smoothing for rage aim ("no smoothing") | Rage aim has no smoothing; it is already instant. |
| Auto scope (Rage) | No such setting. |
| Wallbang (Rage) | No such setting (rage aim only locks onto visible targets). |
| Resolver, double tap, hide shots, fake lag, fake duck (HvH, HvH Rage) | Only in the HvH Lab (Insert). You said not to touch Lab, so they're not in mega?dev. |
| Fake angles (HvH) | Mapped to the closest setting, fake pitch "down"; no yaw desync setting. |
| Rainbow chams (HvH Rage, Spinbot Supreme) | Colours are fixed; no colour cycling. Spinbot Supreme uses magenta instead. |
| Kill sound "1" (HvH Rage) | No kill-sound setting. |
| Misspelled ESP labels "Helth" / "Enemey" (Pasted from GitHub) | ESP labels can't be changed by a config. |
| Aim at chickens' feet (Pasted from GitHub) | Hitboxes are only head / body. |
| Aimbot only with the knife (Dev's Grandma) | Aim can't be limited per weapon. |
| ESP shows enemies as "nice boys" (Dev's Grandma) | ESP labels can't be changed by a config (it's in her description instead). |
| Wrong-code jump scare | There is none in the game today: a wrong dev code shows "Nope. Wrong code." and shakes the keypad. That is unchanged. Jumpscares are a mega?dev prank you send to players. |

# Weapon categories: please check

Every weapon in the game, from the one shared list in `shared/src/weapons.ts` (the `category`,
`kind` and `name` fields). Every mode, menu and loadout reads that list.

- **cs**: a CS2-style standard gun. Available in every mode: the buy menu, the Training B menu,
  Arms Race, and your loadout.
- **special**: one of our own guns that isn't in CS2. Blocked in **FaceChiken** and
  **ChikenBomb** (not sold, not in loadouts, can't be given, switched to or fired there; the
  server refuses it). Allowed in every other mode.

Names: the CS2-style guns now use the CS2 name of the gun their model is based on. The id
(saved loadouts, network, stats) is unchanged. Damage, fire rate, magazines and prices are unchanged.

## Guns

| Id | Name in game (was) | Looks like (CS2) | Type | Category | Casing texture |
| --- | --- | --- | --- | --- | --- |
| pistol | Glock-18 (Pistol) | Glock-18 | pistol | cs | glock |
| silenced | USP-S (Silenced Pistol) | USP-S | pistol | cs | glock |
| dualies | Dual Berettas (Dual Pistols) | Dual Berettas | pistol | cs | glock |
| fiveseven | Five-SeveN (Five-Seven) | Five-SeveN | pistol | cs | glock |
| mpistol | CZ75-Auto (Machine Pistol) | CZ75-Auto | pistol | cs | glock |
| revolver | R8 Revolver (Revolver) | R8 Revolver | pistol | cs | none (a revolver keeps its cases) |
| deagle | Desert Eagle (Deagle) | Desert Eagle | pistol | cs | deagle |
| smg | MAC-10 (SMG) | MAC-10 | smg | cs | glock |
| rifle | Galil AR (Rifle) | Galil AR | rifle | cs | ak47 |
| burst | FAMAS (Burst Rifle) | FAMAS | rifle | cs | ak47 |
| battle | SG 553 (Battle Rifle) | SG 553 | rifle | cs | ak47 |
| ak47 | AK-47 | AK-47 | rifle | cs | ak47 |
| m4a1 | M4A1 | M4A4 | rifle | cs | ak47 |
| scout | SSG 08 (Scout) | SSG 08 | sniper | cs | awp |
| sniper | AWP (Sniper) | AWP | sniper | cs | awp |
| shotgun | Nova (Shotgun) | Nova | shotgun | cs | nova |
| autoshotgun | XM1014 (Auto Shotgun) | XM1014 | shotgun | cs | xm1014 |
| lmg | M249 (LMG) | M249 | heavy | cs | ak47 |
| minigun | Minigun | — | heavy | special | ak47 |
| golden | Golden Rifle | — | rifle | special | ak47 |
| rocket | Rocket Launcher | — | heavy | special | none |
| crossbow | Crossbow | — | sniper | special | none |
| launcher | Egg Launcher | — | heavy | special | none |

## Knives and melee

| Id | Name | Category |
| --- | --- | --- |
| knife | Knife | cs |
| butterfly | Butterfly Knife | cs |
| karambit | Karambit | cs |
| m9 | M9 Bayonet | cs |
| daggers | Shadow Daggers | cs |
| goldknife | Golden Knife | special |
| pan | Frying Pan | special |
| katana | Katana | special |

In ChikenBomb and FaceChiken the melee slot was already limited to the CS knives (a Frying Pan,
Katana or Golden Knife in your loadout is swapped for the Knife there). That stays.

## Team guns in ChikenBomb (kept)

- chikenT: AK-47, Galil AR.
- chikenCT: M4A1, Defuse Kit.
- The Golden Rifle was CT-only; it is special, so it's no longer sold there.

## The MAG-7 casing

`mag7_color` has no gun: the game has no MAG-7. The texture is in `client/public/textures/casings`
and the casing model is built (blue hull, brass head), but nothing uses it yet, so it is never
downloaded. A MAG-7 would only need one line in the casing table (`CASING_FOR` in `client/src/game/Casings.ts`).

## Where the shell textures came from

The 17 PNGs were in `Downloads\Downloads` (not a `gun_shell_textures` folder). Their layouts and
headstamps (7.62, 50-AE, 9mm, SWARTKLIP 12, 18g 7½) look like they were taken from a game's own
models. If they came out of CS:GO or CS2, putting them in the game has the same copyright risk as
Mirage. They are used only from `client/public/textures/casings/`, so replacing those files swaps them out.
