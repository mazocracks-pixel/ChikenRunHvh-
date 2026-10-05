# HvH auto-stop options

HvH Lab's Movement tab and Skeet's Misc tab have Slow-walk auto stop, Between shots,
Predict auto stop and a 50–300 ms Prediction look-ahead. Enable Auto-stop in Lab, or in
Skeet's active Rage weapon profile. Skeet's weapon-specific master switch retains the same
shared options; disabling that profile's auto stop disables its predictive movement too.

- **Slow-walk auto stop** preserves the player's movement direction and uses native walking
  to reduce speed to 45% of the held weapon's running speed. It improves spread through actual
  velocity. Walking-speed shot estimates are tested first; a shot requiring stationary
  accuracy can still use a full counter-stop. The normal Shift control is unchanged.
- **Between shots** keeps the chosen stop method active during weapon cooldown when a valid
  target remains. Off releases movement between shot opportunities. Reloading, switching guns
  and empty weapons do not trigger auto stop. This defaults on to preserve older profiles.
- **Predict auto stop** extrapolates recent public enemy position and velocity to identify a
  likely cover-edge peek. It can prepare even before the shot scanner has an exposed target.
  Combining it with Slow-walk auto stop starts native slow walking before that predicted peek.
  Prediction alone uses counter-strafing.

Prediction requires two recent, consistent observations. It rejects stale samples, deaths,
teleports, sharp direction reversals and missing motion. It samples at 64 Hz using the normal
movement collision solver, checks line of sight/range/FOV, and caps total extrapolation at
300 ms from the observed record. At most eight nearby enemies are considered every 100 ms.
It assumes continued observed velocity; a player may change direction after the observation.

Forecasts only control movement. They are never appended to resolver history or used as future
shot/rewind records. Current hitchance, cover, server hitboxes, ammo and weapon cooldown still
decide whether a shot can fire. Player feedback reports slow walking, counter-strafing,
between-shot control or a predicted peek.

Auto stop runs only for assisted HvH, while grounded and playing. Jumping, Manual mode, an
ordinary game mode, a vehicle, a disabled master switch and active auto-peek return suppress
it. It changes input through normal acceleration/friction, never directly edits velocity.
The camera remains under player control.

Tests cover native slow walking, physical counter-stopping, independent cooldown behavior,
combined prediction/slow walk, information separation, collision, stale/reversed movement,
look-ahead/range/FOV bounds, accurate-shot fallback, profile migration and weapon overrides.
