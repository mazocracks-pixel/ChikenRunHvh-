# Source-style movement in Chicken HvH

## Why air strafing works

Source checks the component of existing velocity along the requested movement direction.
It caps that component rather than total horizontal speed. Input close to perpendicular to
your velocity can therefore add momentum; coordinated A/D and mouse turning keep the input
at an effective angle. Looking around without movement input cannot steer you. The shared
implementation preserves Source's distinction between capped air wish speed and the uncapped
wish speed used to calculate acceleration. See [Valve's public movement implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/gamemovement.cpp),
specifically `AirAccelerate`, `Friction`, `CheckJumpButton` and `CategorizePosition`.

## Baseline and game units

We use standard CS:GO movement as the baseline, with 250 Source units/s mapped to this game's
6 m/s running speed. Valve's [2014 movement changes](https://blog.counter-strike.net/2014/page/5/)
establish ground acceleration 5.5, friction 5.2 and stop speed 80. Air acceleration is 12,
with a 30-unit wish-direction cap, as corroborated by [CS:GO console-variable output](https://gist.github.com/saul/87c5823df46ad64c9f06f3922fbbf682)
and [a KZ developer's dead-strafe analysis](https://gist.github.com/zer0k-z/808bc8bfc494e0bbb5a423c2b1ca6685).
Near the rising apex, surface friction reduces air
acceleration to one quarter. These values are shared by prediction and the server at 64 Hz.

| Parameter | Chicken-game value |
| --- | --- |
| Ground acceleration / friction | 5.5 / 5.2 |
| Stop speed | 1.92 m/s |
| Air acceleration / wish cap | 12 / 0.72 m/s |
| Reduced air acceleration range | Upward vertical speed between 0 and 3.36 m/s |
| Takeoff speed ceiling | 110% of the held weapon's running speed |

## Hopping and controls

A jump executes before ground friction. A correctly timed landing jump retains momentum;
waiting on the ground loses speed. Valve's [2016 bunny-hop settings](https://blog.counter-strike.net/2016/10/16312/)
describe the normal 110% running-speed limit and optional automatic landing jumps. We retain
the standard takeoff ceiling; strafing can still build speed during a flight.

- Manual play: run, jump, release Space, then press it again on landing. Use A/D with matching
  mouse turning in the air. Another airborne press cannot flap or activate a jetpack in HvH.
- Panel Bunny hop: hold Space to request a jump on the landing tick. It generates no speed.
- Panel Auto strafe: computes movement axes from actual velocity; your camera stays under
  mouse control. WASD selects the intended direction, including side and backward inputs;
  the helper chooses an efficient air angle toward it. It works only in assisted HvH.
- Panel Subtick strafe: an optional HvH air-steering exploit. Eight direction optimizations
  share one normal tick's acceleration budget; gravity, jump height and takeoff limits stay
  the same. See [the movement exploit and fake-lag reference](hvh-movement-exploits.md).
- Shift: gradual ground deceleration to 45% speed, improving accuracy through actual velocity.
- Reverse movement: combines reverse acceleration with friction for faster counter-stopping.

The old fixed hop gains, melee hop bonus, camera-only air steering and air momentum drag
are removed. Collision sweeps stop fast players at thin walls and retain tangential velocity.
Bots build ground speed before hopping rather than jumping from rest indefinitely.

## Adaptation boundaries

This is an original simulation, not the CS:GO binary. Chicken collision boxes, map scale,
8 m/s jump velocity and 24 m/s² gravity remain. CS:GO jump stamina, sloped-surface surfing,
automatic step-up, ladders and engine-specific collision quirks are not reproduced. Other game modes
retain wings and jetpacks. Inputs, reconciliation, spread and movement helpers use the same
velocity rules. The baseline movement and fixed command clock apply in every mode; panel
helpers and the subtick exploit require assisted HvH on both client and server.

Regression coverage includes directional acceleration, air coasting, rising-apex behavior,
manual versus automatic hops, landing friction, counter-stopping, takeoff bounds, thin-wall
collision, client/server replay, Shift accuracy, and climbing the farm tower and factory steps.
