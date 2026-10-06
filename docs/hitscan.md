# Hitscan firing

Guns now use `shared/src/hitscan.ts` for server collision and client shot prediction. A pellet is an instantaneous ray from the firing eye: its nearest wall, player, loot box or vehicle contact ends the shot. Empty space ends at weapon range. Rockets, bolts and grenades retain their existing projectile physics.

The query shares the chicken skeleton and existing cover rules with Skeet's prediction: head pose follows yaw/pitch, nearer torso volumes can hide a tucked head, and HvH penetration uses thickness. Ordinary modes keep their existing penetration damage. Spread remains seeded and velocity-based, including zero spread on low-speed airborne shots. Hitscan removes travel time; it does not remove movement spread or resolver uncertainty.

Normal movement commands are applied before their shots. Unchoked HvH shots pair their predicted eye with the same delivered command; held fake-lag or simulated network batches use the acknowledged eye with bounded coasting. Target rewind uses the frame's render timestamp or Skeet's selected historical record. The server validates its time window and refuses missing-life history or interpolation across teleport gaps. An exact known pose after a teleport remains usable.

The server sends the accepted contact point, surface and normal for each pellet. Client streaks show the whole path immediately and fade in place over 65 ms. Shot/pellet IDs correct an existing streak without replaying it. Contact flashes, wall holes and damage markers use confirmed results; an empty-space miss creates no floating dust or bullet hole. Impacts still arrive after network confirmation.

## Verification

`npm test`, `npm run typecheck` and `npm run build` cover collision ordering, range, cover, firing timers, head poses, command alignment, rewind and movement spread. `scripts/check-shooting.cjs` checks the instant streak, endpoint correction, sent/held jump origins, actual native scope override and ordinary-mode isolation. `scripts/check-hvh-duels.ts` checks real Scout bot fights with automatic/manual firing, jumps and latency plus fake lag.

## References

- [Valve weapon authoring](https://developer.valvesoftware.com/wiki/Authoring_a_weapon_entity): client prediction and server lag compensation for hitscan weapons.
- [Valve lag compensation](https://developer.valvesoftware.com/w/index.php?title=Latency_Compensating_Methods_in_Client%2FServer_In-game_Protocol_Design_and_Optimization&uselang=en): rewind accounts for the interpolated view the shooter saw.
- [Epic line tracing](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/Engine/UWorld/LineTraceSingleByChannel?application_version=5.5): a ray returns its first blocking contact.
- [Epic's 2017 Fortnite accuracy discussion](https://www.fortnite.com/news/battle-royale-accuracy): historical hitscan behavior and readable accuracy cones. This is a reference for the feel, not a claim about today's Fortnite weapon roster.
