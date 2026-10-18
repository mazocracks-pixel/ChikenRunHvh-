# HvH v2 balance report (Task 14)

**Result (after R41): the balance rule still cannot be met by tuning the three tunables. The stop condition applies again.**
The sections up to "Noise note" describe the first sweep, before R41. The current state is in
"Fix round 1 (R41)" at the end.

**Result before R41: the balance rule cannot be met by tuning the three tunables. The R40 stop condition applies.**
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
  rifle's fire interval allows (server ticks since the player's own last shot, R41).
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

## Fix round 1 (R41)

**Ruling R41.** Bullet 1's weapon fire interval is measured in server ticks since the shooter's last
shot, not in tickbase. Banking therefore never blocks firing. DT bullet 2 keeps
`ticksSinceLastShot = action.ticks`. This is implemented in `HvhRoom`, which replaces
`lastShotTickbase` with `lastShotTick`, and pinned by a new `HvhRoom.test.ts` test. `stepTickbase` and
the era values are unchanged. The sweep bots' readiness check uses the same server-tick rule.

### Before and after R41 (current tunables 8 / 12 / 16, full grid)

| | Before R41 (60 rounds per cell) | After R41 (400 rounds per cell) |
| --- | --- | --- |
| Rounds, mean length | 106,200, 26.8 ticks | 708,000, 15.8 ticks |
| Runtime | 148 s | 657 s |
| Field rate max / min | 68.2% / 27.7% | 64.5% / 34.5% |
| Mean field rate by exploit | none 40.0, dt 42.7, hs 38.5, fakelag14 **66.9**, defensive **61.9** | none 46.2, dt 47.4, hs 46.1, fakelag14 53.0, defensive **57.3** |
| Mean field rate by base | backward 53.4, left 48.0, right 47.9, spin 50.7 | backward 54.2, left 47.4, right 47.4, spin 51.0 |
| Mean field rate by jitter | 0: 47.2, 30: 50.9, 45: 51.9 | 0: 46.2, 30: 51.2, 45: 52.5 |
| Dominant | 22 (12 fakelag14 + 10 defensive) | 10 (all defensive) |
| Uncountered | none (noise at 60 rounds per cell) | `backward/j0/defensive` (best counter 0.495), `backward/j30/defensive` (0.545) |
| `checkBalance` ok | false | false |

Exploit against exploit after R41 at 8 / 12 / 16, as the row's mean win rate:

|  | none | dt | hs | fakelag14 | defensive |
| --- | --- | --- | --- | --- | --- |
| none | 50.0 | 48.6 | 50.2 | 43.5 | 38.8 |
| dt | 51.4 | 50.0 | 51.3 | 45.4 | 39.0 |
| hs | 49.8 | 48.7 | 50.0 | 43.5 | 38.9 |
| fakelag14 | 56.5 | 54.6 | 56.5 | 50.0 | 47.2 |
| defensive | 61.2 | 61.0 | 61.1 | 52.8 | 50.0 |

R41 removed the fakelag dominance: fakelag14 now averages 53.0%, and no fakelag config is dominant.
It also halved round length, because every player now fires on interval. Quick sweep after R41 at
8 / 12 / 16 (100 rounds per cell, 4.7 s): ok false. Dominant: `backward/j0/defensive` and
`spin/j45/defensive`. Uncountered: `backward/j0/defensive`.

### Tuning after R41

**Quick grid, 100 rounds per cell, 82 combinations:**

- `hideShotsShift` ∈ {6, 8}
- `defensiveShift` ∈ {6..14}
- `rechargeDelayTicks` ∈ {8, 12, 16, 24, 32, 48, 64}

No combination is ok.

- `hideShotsShift` changes nothing measurable. HS stays at 45–49%.
- `rechargeDelayTicks` matters little. Rounds are now about 16 ticks, so a defensive player usually
  shifts once per life.
- `defensiveShift` is the only lever. The defensive mean is 65–70% at 6–7, about 56% at 8–9, 60–62%
  at 10–12, about 53% at 13 and about 52% at 14. The best quick setting, 14 / 32, still has 1
  dominant and 2 uncountered configs.

**Full grid, 100 rounds per cell, `hideShotsShift 8`:**

| `defensiveShift` / `rechargeDelayTicks` | Max field rate | Dominant |
| --- | --- | --- |
| 12 / 16 | 64.3% | 10 |
| 12 / 32 | 63.8% | 10 |
| 13 / 16 | 60.0% | 7 |
| 13 / 32 | 59.6% | 5 |
| 14 / 16 | 58.6% | 4 |
| 14 / 32 | 58.0% | 4 |

**Final full run of the best candidate (8 / 14 / 32, 400 rounds per cell, 708,000 rounds, 635 s): ok false.**

- Dominant: `backward/j0/defensive` 58.3%, `backward/j45/defensive` 56.8%,
  `backward/j30/defensive` 56.7% and `left/j45/defensive` 55.6%.
- Uncountered (best counter in brackets): `backward/j0/none` (0.547), `backward/j0/defensive` (0.518),
  `backward/j30/none` (0.545), `backward/j45/defensive` (0.527) and `right/j45/defensive` (0.540).
- Mean field rate by exploit: none 47.7, dt 48.8, hs 47.6, fakelag14 54.1, defensive 51.8.
- The base and jitter spread is unchanged: backward 54.2, left and right 47.5, j0 46.3.

The tunables were **not changed**. Because the rule is still not met, R41 point 4 applies. The
candidate is recorded here for the controller. `defensiveShift 14` is inside the 11–14 range cited
for cheats, but `rechargeDelayTicks 32` is unsourced. It would require updating the pinned tests:
`era.test.ts`, the tickbase and recharge tests, and the client PredictedTickbase and Indicators
tests.

### Remaining evidence: what blocks the rule after R41

1. **AA geometry favours the backward base, and this is not tunable.**
   - Backward is +7 points over left or right on every exploit, with the same values before and after
     tuning.
   - Static left and right at jitter 0 sit at 34–36% field rate.
   - Every remaining dominant and uncountered config is backward-based, or a 45-degree jitter
     defensive.
   - The cause is the head hitbox position under desync (`buildHvhMatrix`'s head forward offset
     with `maxDesyncDeg 58`). With a side base, both desync sides put the head on the same side of
     the line of sight. With backward, the two sides split it, so a wrong resolver guess misses.
     None of the three tunables touches this.
2. **The counter half needs a non-transitive matrix.** With reliable samples (400 rounds per cell,
   SE about 0.025), the strongest configs have no opponent at ≥ 0.55. The matrix is close to
   transitive: AA strength stacks with exploit strength, and no exploit beats defensive or fakelag
   while losing to the weaker configs. The tunables only scale defensive's strength. They cannot
   create a counter cycle.
3. **DT and HS barely engage, partly a mechanic.** After R41, rounds last about 16 ticks. Every life
   spawns with an empty bank (`EMPTY_TICKBASE`), and a 14-tick DT charge rarely completes before the
   duel ends. 46% of DT requests and 45% of HS requests are "not charged". This is a non-tunable spawn
   rule, and `doubleTapShift 14` is fixed.

Possible next rulings, for the controller:

- spawn with a charged bank;
- make the AA head geometry (or the aimbot model) base-neutral;
- accept the "counter" half as unattainable for a transitive design and keep only the dominance half;
- apply the 14 / 32 candidate as a partial improvement.
