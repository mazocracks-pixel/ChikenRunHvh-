# Sounds: where every sound comes from

**Rule:** only sounds that are free to use (CC0, public domain, or properly licensed). Nothing ripped from other games.

## Built-in sounds (used in the game)

Every sound effect in the game is **synthesized in code** at play time, in [client/src/game/Audio.ts](client/src/game/Audio.ts). They are filtered noise and oscillators: no recordings and no samples from anywhere.

- **Source:** original work, written for ChikenRunHvh.
- **License:** CC0 1.0 (public domain dedication). Anyone may reuse them.

| Group | Sounds (names in Audio.ts) |
| --- | --- |
| Gunshots, one voice per gun | `pistol`, `rifle`, `smg`, `minigun`, `shotgun`, `sniper`, `scout`, `rocket`, `revolver`, `battle`, `lmg`, `crossbow`, `launcher`, `deagle`, `silenced` |
| Echo after shots | the `echo` taps (stronger for far shots; longest for the Sniper and Scout) |
| Bolt action after each Sniper / Scout shot | `bolt` (the Sniper's is heavier) |
| Reloads | `reloadMag` (magazine guns), `reloadShell` (shotguns), `reloadBolt` (Sniper, Scout), `reload` (launchers, crossbow) |
| Empty clicks | `empty`, `emptyHeavy` |
| Melee | `knife`, `pan`, `katana`, `meleeHit`, `bonk` |
| Zombies | `groan`, `hiss`, `pant`, `roar`, `bossRoar`, `screech`, `zstep`, `zstepLight`, `zstepHeavy`, `zclaw`, `zsmash`, `zdeath` |
| Night ambience | `wind`, `cluck`, `creak` |
| Everything else | hits, kills, explosions, UI clicks, jumpscare fallbacks, and the rest of the `SoundName` list |

Distance: every positional sound gets quieter, more muffled (a low-pass filter) and panned with distance, out to 70 m.

## Sound files in client/public/sounds

These were added by the project owner. Their source and license were never written down.

| File | Used? | Note |
| --- | --- | --- |
| `AWP_SOUND.mp3` | **No** (since Batch 14) | The name points at Counter-Strike's AWP, so it may be ripped from that game. The Sniper now uses the built-in `sniper` sound. Delete the file, or replace it with a CC0 recording and note its source here. |
| `SNIPER_ZOOM.mp3` | **No** (since Batch 14) | Source unknown. The built-in `sniperZoom` sound plays instead. |
| `equip_sound.mp3` | **No** (since Batch 14) | Source unknown. The built-in `switch` sound plays instead. |
| `jumpscare.mp3` | Yes (jumpscares) | Source unknown: **confirm you have the rights**, or delete it (the built-in jumpscare sounds then play). |
| `chickenRunHvh_theme.mp3` | Yes (title-screen music, since Batch 22; replaced `CHIKEN_HVHLOBBY.mp3`) | Added by the owner from their own files. Source not recorded: **confirm you made it or have the rights.** |

## Adding a real recording

1. Get it from a CC0 or public-domain source and keep the page link. Good places: freesound.org (filter by "Creative Commons 0") and opengameart.org (CC0 filter).
2. Put it in `client/public/sounds/`.
3. Map the sound name to it in `FILE_SOUNDS` in Audio.ts (it then replaces the built-in one).
4. Add a row above: file, source link, author, license.
