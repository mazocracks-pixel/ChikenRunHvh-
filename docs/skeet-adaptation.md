# Skeet panel and native HvH controllers

The supplied SDK exposed nine menu categories: Rage, AA, Legit, Visuals, Misc, Skins,
Players, Config and Lua. Its readable signature parser was not a gameplay resolver;
the original gameplay module was compiled. This game uses those menu categories with
original TypeScript controllers. SDK binaries, loaders and foreign-engine offsets are absent.

The subsequent guide-driven rewrite replaced public-real-yaw aiming and cooldown-based
abilities. [HvH simulation](hvh-simulation.md) describes the shared authoritative rules.

| Category | Native implementation |
| --- | --- |
| Rage | Seven weapon profiles; hidden-body hypotheses; historical matrix reconstruction; multipoint; real safe points; shared penetration and spread trials; damage/accuracy/safety/confidence weights |
| Anti-aim | Six movement-state policies; constrained body animation; target-facing and damage-based freestanding; deterministic center/offset/random/three-way jitter; inversion; four era profiles; command choking and gradual fake duck |
| Legit | Camera-following bounded turns with working smoothing, reaction/FOV and trigger; the same resolver and ballistics as Rage |
| Visuals | ESP, silhouettes, public-hypothesis skeletons, selected historical matrix, collision and arena markers |
| Misc | Physical stop/slow walk/peek return; keybind list, charge, watermark and classified shot log; local menu/arena settings |
| Skins | Local first-person weapon tint and inspect animation, with fixed HvH weapon reference |
| Players | Per-match ignore/body targeting overrides, public roster and scores |
| Config | Independent Lab/Skeet current and named configs; sanitized import/export; old real/visual resolver values migrate to center assumption |
| Extensions | Native recipes plus bounded typed command, observation, candidate, own anti-aim, shot/result and render callbacks |

Skeet defaults to adaptive resolution; Lab defaults to animation priors. The policy selector
offers adaptive feedback, animation-weighted feedback and a cycle after confirmed resolver
misses. Skeet's center option deliberately assumes eye yaw for comparison; it never reveals
authoritative body yaw. Both panels share weapon stats, ammo, movement and stored-tick costs.

Public observations include eye yaw, intermittent lower-body updates, speed, crouch amount,
ground state, turn weight and time. Body yaw, enemy settings/inverter, authoritative matrices
and enemy resolver state are not transmitted. Incorrect reconstructed head locations can miss.
Force-safe points test overlap across plausible LEFT/CENTER/RIGHT and low-delta alternatives;
safe body shots generally sacrifice head damage. Body hits clear recent misses without
reinforcing an orientation guess. Spread, cover and server rejection never count as resolver errors.

Opponent overrides and observations clear on match exit or panel changes. Panel changes do not
restore health, ammo or resource charge. Cosmetic pitch affects head rendering only. The classic
private developer menu remains separate outside HvH; ranked mode still denies these capabilities.
Public HvH panels are available by default, matching the main game's access policy.
Set `HVH_PUBLIC_PANEL=0` to require the passkey for HvH panels.

Controller additions register through `runtime.extensions.register(...)` and the typed panel
registry. Hooks receive immutable public data or the owner's sanitized configuration. They
can change bounded movement intent, candidate score or their own anti-aim configuration;
the server revalidates gameplay. Throwing callbacks disable themselves. These are trusted
repository-owned callbacks, not a sandbox for uploaded JavaScript or CSGO Lua. Add a new panel
in source, test its policy, and register it deliberately.
