# Skeet panel adaptation

The locally supplied Skeet SDK exposes its menu API in `SkeetSDK/skeetsdk.h`:
`ETab` lists RAGE, AA, LEGIT, VISUALS, MISC, SKINS, PLIST, CONFIG and LUA.
The header defines checkbox, combo, slider, list, child, label, hotkey, color and text widgets;
`CMenu` exposes window/tabs/config registration. Its game module is compiled code loaded by a
native wrapper. The readable `ida_sig_resolver` parses signatures, not enemy gameplay stance.
No readable original gameplay resolver or anti-aim implementation was available.

This is an original browser-game implementation based on those exposed menu categories.
Neither the SDK loader nor its binaries are included, executed, translated or linked into the game.

| SDK category | Chicken-game counterpart |
| --- | --- |
| Rage | Target priority, FOV/reaction/turn limits, autowall, hold overrides; general, pistol, rifle, sniper, shotgun, SMG and heavy profiles |
| AA | Per-stance yaw/desync/jitter; target-facing, freestanding cover, inversion, three jitter/desync patterns; resolver; shared charged abilities |
| Legit | Smooth bounded aim and trigger delay/FOV, using the same weapon profiles and geometry |
| Visuals | ESP, arena/objective markers, real hitbox/collision outlines, local arena palette |
| Misc | Keybind/resolver/watermark indicators, shot decisions, readouts, slow-walk/peek/jump helpers, menu controls |
| Skins | Local first-person weapon tint and inspect animation; fixed-stat weapon reference |
| Players | Ignore or prefer body for an opponent in assisted targeting; live public health/stance/score roster |
| Config | Independent current and named Skeet configs, import/export, load/save/reset |
| Lua | Extensions: native precision, ground-peek and stance recipes composed from supported settings |

## Resolver

Chicken HvH already publishes authoritative real yaw to everyone. The adaptive resolver uses
that interpolated real heading for head geometry, retains 4–16 public snapshot observations
over 300–1200 ms, detects wrapped yaw changes and movement state, and estimates stability.
Low confidence or a configured number of recent server-confirmed assisted misses can prefer body.
Hits reset recent misses; old misses expire after three seconds. Teleports/time reversals reset
history. Rejected/unconfirmed requests and manual shots cannot increment the counter.
Real mode directly uses the public real stance; visual mode deliberately uses the rendered fake
heading. This is not a reconstruction of CSGO lower-body-yaw or animation-layer logic.

Multipoint samples the center and four interior head/body points. The point scale is capped at
75%. Safe-point hit chance additionally requires rays to intersect real chicken geometry at
the observed heading and both ends of the bounded yaw uncertainty. Sampling accounts for actual
speed, airborne spread, recoil, armor, cover, penetration and normal fire opportunities.

## Anti-aim and ability limits

The server selects standing/moving/crouching/airborne policy from real player state, computes
target-facing and cover sides at most ten times per second, and replicates separate real/fake yaw.
Jitter is deterministic per player and interval; desync remains at most 58 degrees and jitter
at most 45. Cosmetic pitch never changes shot direction or hit volumes. A shot reveal, death or
vehicle entry restores normal pose. The cyan real-heading marker remains available to every player.
The fallback builder uses the original Lab stance settings.

Double Tap gives one extra ordinary bullet, excludes projectiles/melee/native bursts, and shares
an eight-second recharge. Hide Shots delays normal stance reveal with a six-second recharge.
Switching panels, weapon or mode cannot refill health, magazines or charge. No packet choking,
tickbase shifting, invulnerability, damage multipliers, infinite ammo or movement bypass is exposed.

## Lifecycle and extension points

`panels.ts` registers each assisted panel; `Dev.ts` scopes its saved settings.
`skeet/model.ts`, `resolver.ts`, `points.ts` and `tabs.ts` own Skeet policy and controls. Shared
`hvh.ts` bounds server-facing anti-aim; the server validates access using the same opt-in public
flag or developer passkey as Lab. Opponent overrides/history are transient and clear on match
exit or panel switching. Imports are sanitized and old unsafe settings are retired.
Visual tint clones local weapon materials, restores the originals when disabled, and releases
clones on disposal. Lua/native SDK execution is replaced with explicit supported recipes.

Tests cover malformed configs, stance selection, determinism/reveal/inversion, weapon profile
fallback, angle wrapping/history/miss expiry, hit-volume safe points, config isolation, socket
access, resource preservation, and accepted/rejected shot feedback. Browser QA additionally
checks all nine tabs, touch layout, real multiplayer pose replication and native runtime behavior.
