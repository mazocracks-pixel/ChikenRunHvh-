# Late CS:GO Era Reference (2021–2023)

This document provides historical and technical justification for the era constants defined in [`shared/src/hvh/v2/era.ts`](../../shared/src/hvh/v2/era.ts) (`LATE_CSGO`), supporting ChikenRunHvh's transition to a tickbase simulation model mirroring late Counter-Strike: Global Offensive HvH (Hacker vs. Hacker) mechanics.

---

## Era Constants (`LATE_CSGO`)

| field | value | meaning (plain English) | source | confidence (high/medium/low) |
|---|---|---|---|---|
| `tickRate` | `64` | The standard rate at which the server simulates physics and game state, running at 64 ticks per second (15.625 ms per tick). | Valve matchmaking default; Valve Developer Community: Source Multiplayer Networking (https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) | high |
| `maxProcessTicks` | `16` | The server-enforced cap on how many user commands (ticks) the engine will process from a single client in one frame before dropping the remainder. | Valve Developer Community: `sv_maxusrcmdprocessticks` (https://developer.valvesoftware.com/wiki/Sv_maxusrcmdprocessticks) | high |
| `doubleTapShift` | `14` | The default number of ticks shifted backwards in tickbase manipulation to instantly fire a second shot without weapon cycle cooldown. | none (convention) | high |
| `doubleTapShiftOptions` | `[12, 14, 16]` | Selectable double-tap shift amounts allowing players to balance exploit stability and packet choke margin (12 or 14) against maximum instantaneous shot speed (16). | none (convention) | medium |
| `maxChoke` | `14` | The maximum consecutive user commands a client holds back and sends in a single packet batch to hide real-time movement and break enemy resolver tracking. | Source engine networking / NetChannel choke limit (`sv_maxusrcmdprocessticks - 2`; Valve Developer Community: Netchannel) | high |
| `lagCompWindowMs` | `200` | The historical rewind buffer duration in milliseconds stored by the server for lag-compensated hit registration. | Valve Developer Community: `sv_maxunlag` and Lag compensation (https://developer.valvesoftware.com/wiki/Lag_compensation) | high |
| `maxDesyncDeg` | `58` | The maximum angular difference (yaw delta) between the server-authoritative hitbox body yaw and the client-rendered visual direction while standing still. | CS:GO animation state system `CCSGOPlayerAnimState::GetMaxDesyncDelta()` in CS:GO source | high |
| `desyncRunFalloff` | `0.5` | The fractional reduction factor applied to max desync when running at full speed, reducing the standing 58-degree delta by roughly 50% down to ~29 degrees. | CS:GO animation state system `CCSGOPlayerAnimState::GetMaxDesyncDelta()` speed fraction scaling | high |
| `lagCompBreakHulls` | `2` | The distance threshold in player hull widths (2 hulls = 1.8 units, matching CS:GO's 64-unit teleport threshold where 64 / 32 hull width = 2) beyond which server lag compensation discards the record as a teleport. | CS:GO source `server_csgo/cbaseplayer.cpp` (`LAG_COMPENSATION_TELEPORTED_DISTANCE_SQR = 64.0f * 64.0f`); mapped to 2 player hulls (`2 * PLAYER.radius * 2 = 1.8` units) | high |
| `hideShotsShift` | `8` | The number of ticks shifted when firing to obscure weapon recoil and muzzle flash timing from enemy resolvers, hiding the on-shot head orientation change. | none (convention) | medium |
| `defensiveShift` | `12` | The number of ticks shifted defensively when peeking or detecting incoming fire to break the opponent's lag compensation by inducing a simulated teleport. | none (convention) | medium |
| `rechargeDelayTicks` | `16` | The cooldown period in server ticks after triggering a tickbase manipulation before the player's shift buffer begins to recharge. | none (convention) | medium |

---

## Detailed Technical Context

### 1. Command Budget & Tickbase Exploitation (`maxProcessTicks`, `doubleTapShift`, `maxChoke`)
In the Source engine, `sv_maxusrcmdprocessticks` (default 16 in CS:GO) limits the maximum number of user commands a client can transmit in a single packet or process in a single server tick. 
- **Double Tap (DT)**: Works by advancing the client's `tick_base` artificially, firing, and transmitting the shifted user commands together. This causes the server to execute multiple commands in a single frame, bypassing the standard weapon delay between shots (`m_flNextPrimaryAttack`). A 14-tick shift leaves a 2-tick safety margin within `sv_maxusrcmdprocessticks 16` so commands are not dropped.
- **Packet Choking**: Clients can suppress packet transmission (`bSendPacket = false`) for up to 14–15 ticks. When released, all choked commands arrive at once. The engine processes them in a single frame, resulting in rapid movement on other clients' screens and masking real yaw updates.

### 2. Lag Compensation & Teleport Threshold (`lagCompWindowMs`, `lagCompBreakHulls`)
- **Rewind Window**: `sv_maxunlag 0.2` defines a maximum rewind window of 200 ms. At 64 ticks per second, this corresponds to $\lfloor 200 \times 64 / 1000 \rfloor = 12$ ticks.
- **Teleport Breaking Rule**: In CS:GO server code (`cbaseplayer.cpp`), lag compensation validates historical positions before rewinding. If consecutive records differ by more than `LAG_COMPENSATION_TELEPORTED_DISTANCE_SQR` ($64^2 = 4096 \text{ units}^2$), the server marks the position as teleported and refuses to lag-compensate it:
  ```cpp
  if ( ( pCurrent->origin - pPrevious->origin ).LengthSqr() > LAG_COMPENSATION_TELEPORTED_DISTANCE_SQR ) {
      // Teleport detected: don't interpolate / compensate across this gap
  }
  ```
- **Hull Mapping**: In CS:GO, standard player hull width is 32 units (bounding box $x, y \in [-16, +16]$). Therefore, 64 units equals exactly $64 / 32 = 2.0$ player hull widths. In ChikenRun, where `PLAYER.radius = 0.45` ([`shared/src/constants.ts`](../../shared/src/constants.ts)), player hull width is $2 \times 0.45 = 0.9$ units. Setting `lagCompBreakHulls = 2` sets the teleport delta threshold to $2 \times 0.9 = 1.8$ world units, replicating the exact CS:GO 2-hull teleport rule.

### 3. Anti-Aim Desync (`maxDesyncDeg`, `desyncRunFalloff`)
- In CS:GO, `CCSGOPlayerAnimState::GetMaxDesyncDelta()` calculates the maximum angle between the player's server-authoritative lower body yaw / feet yaw ("real") and the client's network-view yaw ("fake").
- At zero velocity (standing), the maximum delta between feet yaw and eye yaw is clamped to 58.0 degrees (`maxDesyncDeg: 58`).
- As player movement speed increases toward maximum running speed (250 units/s), animstate foot yaw rotation speed increases, tightening the maximum allowed desync delta by roughly 50% (`desyncRunFalloff: 0.5`), leaving ~29 degrees of desync at full run.

### 4. HvH Cheat Conventions (`hideShotsShift`, `defensiveShift`, `rechargeDelayTicks`)
Unlike engine cvars, these values were established by late CS:GO cheat providers (e.g. Gamesense/Skeet, Neverlose, Onetap):
- **Hide Shots (8 ticks)**: Shifts tickbase backward on weapon discharge without queuing a secondary shot. This shifts weapon animation state and pitch/yaw updates, hiding on-shot vulnerability from enemy aimbots.
- **Defensive Shift (12 ticks)**: Triggered when peeking corners or detecting enemy line of sight. By shifting 12 ticks, the client forces a position change exceeding the lag compensation threshold, causing enemy aimbots targeting the historical record to miss ("breaking LC").
- **Recharge Delay (16 ticks)**: After shifting ticks, clients must wait before refilling their tickbase buffer. Waiting 16 server ticks (1 full `sv_maxusrcmdprocessticks` cycle, or 250 ms at 64 tick) ensures server stability and prevents immediate back-to-back double taps.

---

## Flags for Task 14

The following edge cases and tuning considerations are flagged for validation during Task 14:
1. **Double Tap Shift of 16 with Packet Choke**: When `doubleTapShift` is configured to 16 and `maxProcessTicks` is 16, any additional choked commands will exceed `sv_maxusrcmdprocessticks 16`, leading to server command drops unless choked commands and shift ticks are mutually budgeted. Task 14 should verify tickbase budgeting rules.
2. **Recharge Granularity**: `rechargeDelayTicks = 16` sets the cooldown duration. Task 14 should confirm whether recharge is step-instant after 16 ticks or recharges linearly (e.g. 1 tick per server frame after delay).
3. **Defensive Shift Magnitude**: In some late CS:GO HvH cheats, defensive shift values between 11 and 14 ticks were used depending on server tickrate and latency. The chosen 12 ticks is safe under 14-tick max choke, but may need tuning for specific weapon peek timings.
4. **Desync Run Falloff Curve**: In CS:GO animstate, speed falloff was non-linear depending on whether the player was walking, ducking, or slow-walking. Task 14 should verify whether a linear falloff of 0.5 is sufficient for ChikenRun's movement model.
