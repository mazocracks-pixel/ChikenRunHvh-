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
