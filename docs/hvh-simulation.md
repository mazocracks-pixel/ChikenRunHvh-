# Guide-driven chicken HvH simulation

This is a standalone browser game. The HvH guide is used as a design reference for an original
chicken simulation; it is not an exact implementation of CSGO's proprietary engine. Original
maps, ten game modes, account flows and the main menu remain available. HvH combat follows the
contracts below, while other modes retain their original weapon behavior. On-foot movement
uses shared Source-style acceleration; see [the movement reference](source-movement.md).

## Simulation and information boundary

The shared simulation runs at 64 Hz in every game mode. Immutable movement commands are queued
and consumed once per tick; receiving a batch does not run extra movement. Missing commands
still advance gravity, coasting and the ordinary player clock without inventing button presses.
Normal player prediction and server
reconciliation share physics. Camera direction, shot direction, observable eye yaw, server-owned
body yaw, rendered yaw and resolver hypotheses are separate values.

Body animation has a bounded turn rate, lower-body update timer and maximum eye/body delta.
The standing maximum is 58 degrees, reduced by velocity, crouching and flight. Hit volumes form
a transformed chicken skeleton: head, torso, pelvis, arms and legs. Changing body yaw changes
actual head and limb locations. All modes use the same 0.25 m head and segmented body volumes.
Physical pitch rotates the head around its neck and modestly tucks it on downward angles; renderer,
rewound hit detection, resolver matrices, projectiles and aim-lock detection share this pose.
Down anti-aim pitch is bounded to -1.15 radians. It exposes less head from the rear while remaining
hittable from the front and sides. The nearest torso blocks a hidden head's headshot bonus.
Head bones stay stable through decorative walking bob, and crouch presentation uses the same
interpolated scale as hit detection rather than a separate shrinking animation.

Remote packets expose position/velocity, eye yaw, lower-body updates, crouch amount, ground
state, physical head pitch, quantized turn weight, health, armor and simulation time. Body yaw, enemy anti-aim settings,
inverter, exact bones and resolver state remain private. Observable copies use an explicit field
allow-list, including in controller hooks. Ground truth is used by server collision and post-shot
classification, not by client or bot target selection.

## Resolver, history and shot selection

The resolver keeps bounded public observations and ranks LEFT, CENTER, RIGHT, low-delta,
last-moving and lower-body-update hypotheses. Its feedback decays; confirmed resolver misses
change orientation weights, informative head hits reinforce them, and body hits clear misses
without proving a side. Spread, obstruction, invalid history, death and weapon rejection do not
teach orientation errors. Public moving body updates and recent stationary updates receive stronger
weight. Duplicate angles are merged, and reading old history cannot repeatedly decay new feedback.
Policies differ in feedback strength or confirmed-miss cycling. Both panels fall back to body hits
when orientation is uncertain or repeated misses confirm a poor guess.

Every hypothesis builds a complete skeleton. Safe-point checks intersect several reconstructed
matrices, including LEFT/CENTER/RIGHT even with resolver disabled or high confidence. Multipoint
scale shrinks with speed and uncertainty. Target/record/hitgroup candidates pass cheap cover,
damage and overlap gates before at most eight candidates receive 32 seeded spread trials. The shortlist
reserves body fallback points. Accuracy averages over orientation hypotheses rather than assuming
the selected head guess is correct. Combined scope/stop plans are allowed. Automatic fire rechecks
actual position, speed, spread and minimum damage immediately before firing. Silent shot directions
are rebuilt from the current shooter eye to the selected historical point. Scans
run at bounded intervals, independent of display refresh rate. Scoring combines damage,
geometric safety, accuracy, confidence, lethality, age and target persistence. Settings include
flat or HP-relative minimum damage, air hitchance, force/prefer-safe and weapon profiles.

Rage acquires and switches targets without an intentional reaction or target-switch delay,
including when older saved profiles contain delay values. Accuracy, scope, movement and weapon
cooldown checks still apply. Both panels use silent aim for automatic and manually triggered
assisted shots. Coverage is a full cone angle from 1 to 360 degrees; 360 includes targets behind
the player. New profiles default to 360, while saved coverage choices remain configurable.
Older smooth-style profiles migrate to silent Rage; aiming never turns the player's view.

Rewind is limited to 300 ms. Server history rejects pre-spawn records, invalid lifetimes, future
timestamps and interpolation across large discontinuities. Crouch scale and body yaw are
reconstructed at the historical time. Historical server matrices remain private.

Server and targeting use the same deterministic spread and penetration code. HvH weapons are
tuned uniformly for every player/panel/bot, with lower stationary spread and stronger moving
spread. Shot heat recovers over time. Up to two soft boxes attenuate damage by actual thickness;
hard material blocks the ray. Range, hitgroup and armor affect health damage. Physical
counter-strafing, slow walking and anchor return use normal collision/acceleration. Shift is a
normal ground movement control for every player and mode, including Manual play. It limits
walking to 45% of normal speed through ground friction/acceleration and improves moving accuracy
through the actual velocity/spread curve. It grants no accuracy bonus in flight or against knockback.
HvH auto stop supports slow walking, independent between-shot timing and short enemy-motion
extrapolation before likely peeks. Forecasts only control grounded input; shots still use real
records and actual-speed hitchance. Reloads, jumps and auto-peek return retain control. See
[the auto-stop options](auto-stop.md) for prediction bounds and accuracy fallback.
When a shot needs a full stop, that requirement survives the next stationary scan; slow-walk
auto stop cannot restart movement and repeatedly spoil the shot before firing.
Hops preserve velocity rather than granting a speed bonus. Both panels' helpers use ordinary
movement inputs and the same shared takeoff ceiling as Manual players. Subtick strafe is an
explicit assisted-HvH exception: eight air-direction optimizations share one fixed tick and
build velocity more efficiently. It grants no extra elapsed time or altered gravity. The client,
server input boundary and physics all gate it to HvH. See [its reference](hvh-movement-exploits.md).

## Anti-aim, packet behavior and shared resource

Practice bots use the same 20 Hz public observations as clients, moderate 22–45 degree desync,
limited jitter and standard unshifted shots. They do not automatically wallbang through hidden
soft cover. Their resolver, damage, spread, ammunition and shot queue follow player rules.

Six stance policies cover standing, moving, slow walking, crouching, airborne and crouched
airborne. Target-facing and freestanding use public opponent locations. Freestanding compares
incoming head/body damage at alternative owner matrices. Anti-bruteforce reacts to actual near
incoming bullet paths with a cooldown, not to another player's resolver. Defensive transitions
spend charge and lower fresh-record confidence; all ordinary hit detection still applies.

Lab and Skeet jitter intervals accept 1–600 ms. The phase is sampled at the simulation's 64 Hz
tick rate; selecting 1 ms does not increase the number of physics or network updates.

Skeet's dedicated Fake lag tab has an enable switch, a 1–12-command limit, static, velocity,
random, adaptive and peek modes, and Break on shot. Disabled fake lag sends each command.
Lab retains its shared network controls. Static, velocity, random, adaptive and peek command
choking are bounded to 0–12 commands.
Remote presentation is held for the configured interval; its historical simulation time remains
attached. Owners receive fresh state. Break on shot flushes pending manual or assisted firing
commands and accepted shots expose a fresh remote update. Disabling fake lag or respawning
clears stale presentation. Weapon cooldown, authoritative collision and rewind limits still apply.
Fake duck alternates ordinary crouch commands and gradually changes real collision
and hitbox scale. Seeded input latency/jitter/loss is a game simulation, not OS packet manipulation.
Fire requests are associated with command sequence and wait for server acknowledgement.

Four era profiles enable different observable presentation/resource rules: legacy, desync,
tickbase and defensive. Legacy intentionally rotates observable presentation; modern profiles
retain public eye orientation. Charged shifts require tickbase/defensive era.

One 32-tick resource recharges by 1/8 tick per idle, unchoked simulation tick: four seconds for
a full charge after recovery. Double Tap spends all 32 ticks, advances the weapon simulation
clock through its unchanged interval and validates two actual firing states. It consumes two
rounds with deterministic rays; it does not divide the weapon cooldown or grant movement speed.
Only intervals up to 32 ticks qualify; projectiles, melee and native bursts do not shift.
Hide Shots spends 14 ticks to protect on-shot orientation for 150 ms. Tracers, damage and shots
remain observable. Defensive transitions spend 12 ticks. The three share charge and recovery;
changing modes, panels or guns cannot refill it. Respawn clears the budget.

## Panels, hooks and diagnostics

Before entering combat a human chooses Lab, Skeet or Manual play in a personal setup pause.
The match continues for other players. Later panel switching preserves health, ammo and charge.
Lab and Skeet have independent configuration stores and resolver policies. Every panel is
subject to shared server bounds. No stat multipliers, immunity, healing, teleport or unlimited
ammo are granted by public HvH access. Friendly fire is blocked and enemy kills score for the
team; HvH vehicles are disabled.

Repository-owned typed hooks cover command build, player observations, candidate scoring,
own anti-aim, shot/hit/miss and rendering. Input/config/score effects are bounded and callbacks
that throw disable themselves. This is an extension contract for trusted source modules, not
an uploaded-script sandbox. Existing recipes compose supported settings.

Debug outlines show public reconstructed hypotheses and the selected historical matrix.
The shooter receives HIT, RESOLVER, SPREAD, RECORD_INVALID, OCCLUSION, TARGET_DIED,
SERVER_REJECTED or PREDICTION feedback with accepted health damage, without hidden yaw.
Actor/loot obstruction cannot falsely reinforce a hit. Reload/cooldown rejection is explicit.

## Validation and practical limits

Run `npm run typecheck`, `npm test`, `npm run build` and `npm run benchmark:hvh`.
The seeded 1,000-duel headshot benchmark compares an adaptive controller against a center-only
controller using real skeleton rays, spread, inversion and simulated packet timing. Both use
the same weapon/resource rules and idle charge; first-action order alternates. At seed 7042 the
adaptive controller wins 1,000 duels and hits 62.1% of shots; center-only wins none against this
particular tucked-head pose. These stationary targets have zero velocity spread. This narrow
diagnostic measures orientation selection, not balance across maps, weapons or human players.
The runnable `scripts/check-hvh-duels.ts` check also exercises live bot fights, quick manual
clicks, airborne Scout shots, latency and fake lag. See [resolver notes](resolver-notes.md).

Regression tests cover information separation, wrong-side head misses, safe-point damage
tradeoffs, movement/spread/crouch, historical validity, input batches, shared resource, panel
permissions and bot damage/friendly filtering. Production browser checks additionally exercise
real Socket.IO input, live autofire/Double Tap, setup/pause, fake duck with latency, menu controls
and phone layout. Longer multiplayer sessions and player feedback remain necessary for tuning.

The simulation deliberately simplifies full CSGO animation layers, networking and weapon
tickbase. Packet practice affects input delivery and held public presentation; it is not a full
network emulator for every message. Pitch changes the physical head pose; no fake hitboxes or arbitrary native
SDK/Lua execution is included. A future uploaded-script feature requires its own isolation and
resource limits. Adding such unsupported options as decorative toggles would undermine the game.
