# Industrial Reactor — Operator Guide

The Industrial Reactor is a placeable machine. It spins up, hums, heats up, sounds alarms and can be shut down normally or with an emergency SCRAM. It never breaks blocks, not even when it fails.

## Overview

| Part | What you see |
|---|---|
| Reactor core | A steel column with a window. The rods behind it show the state: dark = off, green = running, amber = warning, red = critical |
| Cooling rotor | Sits on top. Spins up on start and down on stop; shakes when overheating |
| Status lamp | On a corner of the top. Steady while running, blinks in WARNING and CRITICAL |
| Control panel | An item that opens the reactor's control GUI from up to 8 blocks away |

## How to get and build one

1. An admin runs `/reactor give core` (and `/reactor give panel` for the control panel).
2. Place the **Reactor Core** like a block. The reactor assembles itself and gets an id such as `#1`.
3. Players need the server resource pack (`resourcepack/`) to see the models and hear the sounds.

## How to start it

1. Right-click the reactor, or use the Control Panel near it.
2. Press **START**. The start sequence runs:

| Time | Event |
|---|---|
| 0.0 s | Button click; boss bar shows "STARTING" |
| 0.15 s | Announcement: *"Внимание. Запуск реактора. Персоналу покинуть активную зону."* |
| 0.4 s | Relay click |
| 1.1 s | Hydraulic hiss and steam |
| 1.4 s | Rotor spins up |
| 2.0 s | Engine hum starts (it loops while the reactor runs) and sparks appear |
| 3.5 s | Rods turn green and the hall lights up |
| 4.0 s | Calm music fades in on the next bar |
| 5.0 s | State becomes **RUNNING**; boss bar shows "ONLINE" |
| after the first announcement | Announcement: *"Реактор выведен на рабочую мощность."* |

## Controls (control panel)

| Button | Effect |
|---|---|
| START | Starts the reactor from OFF. Refused while the core is still too hot |
| STOP | Controlled shutdown (about 4 s). Also resets a FAILED reactor once it has cooled down |
| SCRAM | Emergency shutdown: the rods drop, the rotor brakes hard, steam vents, and you hear *"Аварийная остановка выполнена."* |
| Power 25 / 50 / 75 / 100 % | Output level. Higher power produces more heat |
| Coolant ON / OFF | While on, the coolant pumps remove 1.5 % heat per second |
| Status | Shows the current state, heat, power and coolant |

## Indicators and warning states

| State | Rods / lamp | Sound | Music |
|---|---|---|---|
| OFF | dark / off | — | none |
| STARTING | dark → green | button, relay, hydraulics, voice | — |
| RUNNING | green / on | engine hum | calm (92 BPM) |
| WARNING (heat ≥ 70 %) | amber / blinking | hum and alarm beep; voice *"…превышает норму"* | alarm (132 BPM) |
| CRITICAL (heat ≥ 90 %) | red / blinking | siren; voice *"Критическая ситуация…"* | alarm |
| FAILED (heat 100 %) | red | explosion effect (no block damage) | stops |

Heat changes once per second by `2.0 × power − 0.3 − (1.5 if coolant is on)` %:

- At 100 % power with coolant on, heat still rises slowly.
- At 75 % power or less with coolant on, heat falls.
- In WARNING or CRITICAL, the reactor goes back to RUNNING once heat drops below 65 %.

Music only changes on bar lines (every 2 bars), so a transition never cuts a phrase off.

## Emergency shutdown

1. Open the panel and press **SCRAM**. Admins can also run `/reactor scram <id>`.
2. Wait for *"Аварийная остановка выполнена. Реактор заглушен."* The reactor is now **OFF**.
3. If the reactor has **FAILED**, wait until heat is below 70 %, then press **STOP** to reset it.

## Permissions

| Permission | Default | Allows |
|---|---|---|
| `reactor.use` | everyone | panel, `list`, `status`, `start`, `stop`, `scram`, `power`, `coolant` |
| `reactor.admin` | operators | everything above, plus `give`, `heat`, `remove`, `selftest` and `reload`, and removing a reactor by sneak + left-click |

## Admin commands (`/reactor`, alias `/rx`)

| Command | Purpose |
|---|---|
| `give <core\|panel> [player]` | Give reactor items |
| `list` / `status <id>` | List all reactors / show one reactor's state |
| `start\|stop\|scram <id>` | Control a reactor remotely |
| `power <id> <25-100>` / `coolant <id> <on\|off>` | Tune a reactor |
| `heat <id> <0-100>` | Force a heat value (for testing the warning states) |
| `remove <id>` | Remove a reactor and its entities |
| `selftest` | Check the bundled timelines, music metadata, sound ids and state table; prints `SELFTEST PASSED` on success |
| `reload` | Reload config, timelines and music metadata |

## Configuration (`plugins/IndustrialReactor/config.yml`)

- **Ranges:** `music-radius` (48), `voice-radius` (32), `panel-range` (8).
- **Heat model** under `heat.*`: `gain-at-full-power`, `coolant-cooling`, `passive-cooling`, plus the warning, critical, failure and resume thresholds.
- `voice-min-gap-ticks` prevents overlapping announcements.
- `language` is `en` or `ru`.
- Files in `plugins/IndustrialReactor/timelines/` and `plugins/IndustrialReactor/music/` override the bundled ones. Run `/reactor reload` after regenerating them with Minecraft Studio.

## Troubleshooting

| Problem | Fix |
|---|---|
| Reactor looks like plain vanilla items | The client has no resource pack. Enable it in `server.properties` (`resource-pack` + `resource-pack-sha1`) or install the zip locally |
| No sounds or music | Check that the resource pack is loaded. Music also needs the RECORDS volume slider above 0 |
| Music never changes | `music-sound-prefix` must match the events in `sounds.json` (default `reactor:reactor.music.`) |
| "too hot to start" | Wait until heat drops below the warning threshold, or turn coolant on |
| Reactor missing after a restart | Its chunk isn't loaded yet; entities re-link when the chunk loads. Also check `reactors.yml` |
| Console shows `SELFTEST FAILED` | The reason names the broken file or id. Regenerate that asset or fix the timeline |
