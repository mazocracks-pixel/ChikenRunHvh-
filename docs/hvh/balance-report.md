# HvH v2 balance report (Task 14)

**Result: the balance rule cannot be met by tuning the three tunables. The R40 stop condition applies.**
`LATE_CSGO` is unchanged (`hideShotsShift 8`, `defensiveShift 12`, `rechargeDelayTicks 16`). The rest of
this report gives the evidence. The cause is a non-tunable tickbase mechanic, so a controller ruling is
needed (see "What would have to change").

Balance rule (from the plan, binding): no config wins more than 55% against the field, and every config
has a counter that beats it by at least 55%. The R40 definitions are used: a config's *field rate* is
its mean win rate over all other configs, with mirror matches excluded. A config is *dominant* if its
field rate is > 0.55. It *has a counter* if some other config beats it head-to-head at >= 0.55.

## How to run

| Command | Grid | Rounds per cell | Runtime (this machine) |
| --- | --- | --- | --- |
| `npm run sweep` | 60 configs (4 bases × 3 jitters × 5 exploits), 1,770 pairs | 60 | 148 s |
| `npm run sweep:quick` | 12-config `QUICK_GRID` (CI) | 100 | 8 s |

The flags `--rounds N`, `--seed N` and `--json PATH` are optional. The flags `--hs N`, `--def N` and
`--recharge N` override the three tunables for one run only, so tuning can be explored without
editing `era.ts`. The harness is in `tools/hvh-sweep.ts`, and its header documents the round design.

## Round design (summary)

- **Setup.** A 1v1 duel in a real `HvhRoom` (`hvhEngine: 'v2'`, map `flat`, no cover). The room is built
  with the Task 13 harness (`makeMatch(seed, { map: 'flat', teams: [1, 2] })`) and driven through
  `handleInput` and the room tick.
- **Loadout.** Both players use the rifle and desync 58. AA base and jitter come from the config. The
  inverter is a seeded coin flip per round. Spawns are 15 units apart and swap sides every round.
  Spawn protection is off.
- **Script.** Both players run the same script. They strafe in seeded spells and fire as soon as the
  rifle's fire interval allows (tracked through the player's own tickbase).
- **Aimbot.** It sees only what a client can see:
  - the newest lag record's position, duck, eye yaw and pitch, which is the snapshot;
  - the observation feed;
  - whether that record is an on-shot record, since shots are public;
  - its own resolver, read through `peekResolve` on its server-side memory, which learns from its
    own verdicts.

  It aims at the head of the pose the resolver guesses, assuming max desync for the observed speed.
  It predicts its own eye through the commands it is still holding. Every command carries
  `clientTick` set to the record's tick. Aim noise is ±0.01 rad. It holds fire once the newest record
  is older than the 12-tick unlag window.
- **Exploits.**
  - `none`: plain fire.
  - `dt`: double tap requested on every shot.
  - `hs`: hide shots requested on every shot.
  - `fakelag14`: every non-firing command is choked, up to 14, and a shot sends at once.
  - `defensive`: a defensive shift whenever the bank covers it.

  An uncharged request falls back to a plain shot.
- **Rounds.** A round ends at the first death. A round that reaches 640 ticks is a draw worth 0.5 each,
  but no round in either sweep was a draw. Each cell is played in two rooms, half the rounds with
  each config joining first. The resolver memory carries across lives within a room.
- **Determinism.** Everything is seeded. The same seed gives the same `WinMatrix`, which
  `server/test/hvh-v2/hvhSweep.test.ts` checks.

## Initial result (current tunables 8 / 12 / 16)

Full sweep at seed 20 with 60 rounds per cell: 106,200 rounds, mean round 26.8 ticks.

`checkBalance`: **ok false**. 22 configs are dominant: all 12 `fakelag14` configs and 10 of the 12
`defensive` configs. Field rates range from 27.7% to 68.2%. `uncountered` is empty, but see the noise
note below.

Exploit against exploit, as the row's mean win rate:

|  | none | dt | hs | fakelag14 | defensive |
| --- | --- | --- | --- | --- | --- |
| none | 50.0 | 46.4 | 52.1 | 23.0 | 29.2 |
| dt | 53.6 | 50.0 | 54.9 | 26.2 | 29.3 |
| hs | 47.9 | 45.1 | 50.0 | 23.2 | 27.4 |
| fakelag14 | **77.0** | **73.8** | **76.8** | 50.0 | 55.7 |
| defensive | **70.8** | **70.7** | **72.6** | 44.3 | 50.0 |

Mean field rate by axis:

| Axis | Value: mean field rate |
| --- | --- |
| Exploit | none 40.0, dt 42.7, hs 38.5, fakelag14 **66.9**, defensive **61.9** |
| Base | backward 53.4, left 48.0, right 47.9, spin 50.7 |
| Jitter | 0: 47.2, 30: 50.9, 45: 51.9 |

Quick sweep (12 configs, 100 rounds per cell): **ok false**. Dominant: `backward/j0/fakelag14`,
`backward/j0/defensive`, `spin/j45/fakelag14` and `spin/j45/defensive`. Uncountered:
`backward/j0/fakelag14`, `backward/j0/defensive` and `spin/j45/defensive`.

### Is AA choice irrelevant? (the known resolver risk)

Not entirely. Static left and right bases at jitter 0 are the weakest configs, at field rates of
28–34%. Backward is the best base and jitter helps a little. The resolver does learn quickly (period-2
jitter, one-miss flip): `resolver` misses are only 6–11% of shots for every exploit. Even so, the
choice of base still moves field rates by about 5 points, because the head geometry of the desynced
pose differs between bases. The exploit axis outweighs AA by roughly 25 points.

## Tuning attempts

Every combination below was run on the quick grid at 60 rounds per cell (seed 20, 60 combinations):

- `hideShotsShift` ∈ {4, 6, 8}
- `defensiveShift` ∈ {2, 4, 6, 8, 12}
- `rechargeDelayTicks` ∈ {4, 16, 32, 64}

| Finding | Evidence |
| --- | --- |
| **No combination gives `ok: true`.** | 60 of 60 runs fail. Every run has at least 2 dominant configs. |
| **`fakelag14` is dominant at every setting.** | Its mean field rate stays between 62.7% and 71.8% in all 60 runs. None of the three tunables affects a player who never shifts. |
| `defensive` responds to `defensiveShift`. | At `defensiveShift 8` its mean field rate falls to 45–58%: 47.0% at recharge 4 with HS 4, and 51.4% at recharge 4 with HS 8. At 2, 4, 6 or 12 it stays at 58–74%. Small shifts are cheap and stall-free (see below), and 12 hides the most records. 8 is the minimum in between. |
| `hideShotsShift` hardly matters. | `hs` stays at 33–43% everywhere. The on-shot record is hidden whatever the shift size, so the shift is purely a cost, and even 4 does not lift HS above `none`. |
| `rechargeDelayTicks` trades DT against defensive. | DT rises slightly with longer recharge (42 → 47%). Defensive moves non-monotonically. |

The best partial candidate is `defensiveShift 8`, `rechargeDelayTicks 4`, `hideShotsShift 4`. It
leaves 2 dominant configs (both `fakelag14`) and 1 uncountered. It was **not applied**, for three
reasons:

- It does not satisfy the rule.
- `rechargeDelayTicks 4` and `hideShotsShift 4` are outside the 6–9 and 11–14 tick ranges that
  `era-reference.md` cites for cheats.
- The best values will move once the blocking mechanic below is ruled on.

Changing them now would churn the pinned tests (`era.test.ts`, the tickbase and recharge tests) for no
gain in balance.

## Stop-condition evidence: which mechanic is responsible

**The auto-bank stall.** `stepTickbase` banks a tick on *every* command that neither fires nor
chokes, once `ticksSinceShift >= rechargeDelayTicks` and `bank < doubleTapShift`, for every player
whatever exploit they use. A bank tick does not advance the tickbase. The fire interval is measured
in tickbase (`ticksSinceLastShot = shotTickbase - lastShotTickbase`). Every life starts with an empty
bank (`EMPTY_TICKBASE`: `bank 0`, `ticksSinceShift = rechargeDelayTicks`).

The result is that every player who neither chokes nor shifts early loses about 14 ticks of shooting
at the start of each life while the bank fills. Duels last about 27 ticks, so that is decisive.

- **`fakelag14` never banks**, because `intent.choke` blocks banking. It fires its second shot around
  tick 9, while everyone else fires theirs around tick 22.
- **`defensive` spends the bank before it fills.** It shifts as soon as `bank >= defensiveShift`,
  which resets `ticksSinceShift` and stops banking for `rechargeDelayTicks`. It also invalidates
  records.

**Attribution experiment.** The quick grid was run at 100 rounds per cell with the
`onRoundStart` diagnostics hook, pre-filling every player's bank to `doubleTapShift` at round start.
`fakelag14` fell from 73–77% to **10–53%** against the other exploits. `dt` became strong (70–90%),
because a charged DT is a two-bullet burst. `defensive` stayed dominant (82–97%), because records are
invalidated for `defensiveShift` ticks on each side of the shift. With the stall removed, the
remaining imbalance is the defensive invalidation and DT burst sizes. Those can be tuned through
`defensiveShift` and `rechargeDelayTicks`, and DT through `doubleTapShift`, which is not tunable.

The non-tunable values and mechanics responsible are:

1. **Auto-banking on any idle command for every player**, combined with bank ticks not advancing the
   tickbase, measured against tickbase fire intervals, and an empty bank at spawn. This is the
   `stepTickbase` bank rule, together with `EMPTY_TICKBASE` and `shot.ts` `fireIntervalTicks` measured
   in tickbase. It makes **choking a free exemption** from the stall, and that is why `fakelag14`
   dominates at every tunable setting.
2. `maxChoke 14` and choke blocking banking. These are fixed values and rules.

Possible rulings, which are for the controller and not applied here:

- bank only for players with a shift exploit armed;
- spawn with a charged bank;
- let bank ticks count toward the fire interval;
- count choked ticks against the bank.

The tunables should be re-swept after any of these.

## Noise note

At 60 rounds per cell, the standard error of a head-to-head rate is about 0.065. The "has a counter"
half of the rule takes the maximum of 59 noisy rates, so at this sample size it is nearly always
satisfied by chance. That is why `uncountered` is empty on the full grid while the exploit
aggregates show there is no real counter to `fakelag14`. Its best counters are other `fakelag14` or
`defensive` configs at 55–73%, and same-exploit AA head-to-head rates have a spread of SD 0.075. The
field rate averages 59 cells, giving an SE of about 0.01, so the dominance findings are robust. A
counter verdict you can trust needs about 400 rounds per cell (SE 0.025). At the measured rate that
is about 16 minutes for the full grid.
