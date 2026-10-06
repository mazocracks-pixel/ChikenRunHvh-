# Resolver changes and research

The resolver uses this game's public eye yaw, lower-body updates, velocity, crouch, grounded state and quantized turn weight. It never reads enemy body yaw or private settings.

- Evidence is separated by movement state and jitter phase. Delayed shot results update the state of the shot record, rather than whichever state the opponent has since entered.
- Wrapped angle differences and a circular mean distinguish alternating jitter from sustained turns. Low, medium and full body offsets remain bounded by the chicken animation.
- Recent, settled movement supplies a short-lived body cue. Old movement expires. Public moving-body updates receive stronger weight.
- Safe points test plausible matrices. Extremely unlikely alternatives no longer veto a headshot supported by a strong public cue. Spread probability still includes all hypotheses, and uncertain heads still fall back to torso shots.
- Only orientation misses and informative head hits teach orientation. Cover, spread, stale records and rejection do not.

## Sources and limits

The [Haskihook resolver implementation](https://github.com/xTR0JAN/Haskihook-CSGO/blob/main/resolver.cpp) separates walking, standing and airborne decisions and retains a recent walking record. The [Nixware implementation](https://github.com/Shaxzy/NIXWARE-CSGO/blob/master/Nixware-CSGO/features/ragebot/resolver.cpp) explores angle-history classification. These are primary implementation references, not evidence of accuracy. Our circular statistics, state/phase evidence and physical bounds are adaptations to this game's simulation; no foreign-engine hooks or offsets were imported.

An [Onetap forum discussion](https://www.onetap.com/threads/do-your-analysis-on-what-happened-here.38034/) provided test ideas around body fallback, safe points and point scale. Its user claims are anecdotal. Searches and direct visits to UnknownCheats and YouGame were blocked or returned no usable results; their creation threads could not be verified.

The deterministic tucked-head jitter diagnostic improved from 25/88 to 87/88 head-ray hits in both normal and wrapped-angle cases. This is a deliberately controlled test with synthetic alternating poses, not a claim of 99% accuracy in real matches. Shared tests and real Socket.IO bot fights also check ordinary body fallback, public moving cues, latency, jump shots and invalid-record prevention. More multiplayer play remains necessary for balance tuning.

## Playing

Choose a quick config before beginning, or keep your saved settings. Skeet has Aim, Anti-aim, Visuals and Settings tabs. Select one weapon profile or movement stance at a time; advanced visual controls are folded away. Rifle, Scout and Battle Rifle bots use the same public resolver, ammunition and firing timers; bots can strafe during longer firing gaps.

The sniper reticle remains scoped through its firing cycle and brief target gaps. Quick mouse/touch taps survive until the next frame. Assisted HvH aim projects acknowledged coasting and gravity for its firing origin, so delayed movement cannot aim from an unsent future jump. New commands arriving after the last snapshot remain an uncertainty.
