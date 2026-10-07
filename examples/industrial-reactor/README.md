# Industrial Reactor (Minecraft Studio demo plugin)

A Paper 1.21.11 plugin that shows how a plugin consumes the assets Minecraft Studio generates:
item models, sound events, compiled timelines and adaptive music metadata. A placed reactor
spins up, hums, overheats, raises alarms, and can be shut down or SCRAMmed. The plugin never
breaks blocks.

## Build

Requirements: Java 21 and Maven.

```bash
mvn -B package          # compiles, runs the unit tests, builds target/industrial-reactor-0.1.0.jar
mvn -B test             # unit tests only
```

The only dependency is `io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT` (provided). Gson,
Adventure, MiniMessage and JOML come with Paper.

## Install

1. Copy `target/industrial-reactor-0.1.0.jar` to the server's `plugins/` folder.
2. Serve the generated `resourcepack/` to players (`server.properties` → `resource-pack`, or zip it
   and install it on the client).
3. Start the server and run `/reactor selftest` in the console. You should see
   `[IndustrialReactor] SELFTEST PASSED`.

## Gameplay

- `/reactor give core` gives a **Reactor Core**. Placing it builds a reactor: a barrier block,
  a core `ItemDisplay` (`reactor:core_off|core_active|core_warning|core_critical`), a spinning
  `rotor` display, a status lamp (`lamp_off`/`lamp_on`, blinking in WARNING/CRITICAL) and an
  `Interaction` hitbox.
- Right-click the reactor, or use the **Control Panel** item (`/reactor give panel`) within 8
  blocks, to open the panel. It has Start, Stop, SCRAM, power 25/50/75/100%, a coolant toggle
  and a live status item.
- Heat changes once per second: `gain * power% - passive - (coolant ? coolant-cooling : 0)`.
  The reactor enters WARNING at 70% heat, CRITICAL at 90% (siren, alarm music and a voice line)
  and FAILED at 100% (an explosion effect with power 0, which breaks no blocks). It returns to
  RUNNING below 65%. A failed reactor is reset with Stop once it has cooled below the warning
  threshold.
- An admin removes a reactor and gets the core item back by sneaking and left-clicking it, or
  with `/reactor remove <id>` (no item drop).

State machine: `OFF → STARTING → RUNNING ⇄ WARNING ⇄ CRITICAL → FAILED → OFF`. Any active
state (STARTING, RUNNING, WARNING, CRITICAL) can go to `SHUTTING_DOWN → OFF`, either through
Stop (shutdown timeline) or through SCRAM (scram timeline).

## Commands (`/reactor`, alias `/rx`)

| Command | Permission |
|---|---|
| `give <core\|panel> [player]` | `reactor.admin` |
| `list`, `status <id>` | `reactor.use` |
| `start <id>`, `stop <id>`, `scram <id>` | `reactor.use` |
| `power <id> <25-100>`, `coolant <id> <on\|off>` | `reactor.use` |
| `heat <id> <0-100>` (testing) | `reactor.admin` |
| `remove <id>` | `reactor.admin` |
| `selftest` | `reactor.admin` (and console) |
| `reload` (config, timelines, music metadata) | `reactor.admin` |

Permissions: `reactor.use` (default: everyone) and `reactor.admin` (default: op; includes
`reactor.use`).

## How Studio assets are consumed

| Studio output | Where | Used by |
|---|---|---|
| Item model definitions `assets/reactor/items/<id>.json` | resource pack | `ItemMeta#setItemModel(reactor:<id>)` on display entities and items |
| `sounds.json` events (`reactor.*`, `reactor.voice.*`, music) | resource pack | `playSound("reactor:<event>", …)` |
| `timelines/reactor_{startup,shutdown,scram}.json` | `src/main/resources/timelines/` | `TimelineParser` → `TimelinePlayer` |
| `music/reactor_{calm,alarm}.json` | `src/main/resources/music/` | `MusicMetadataParser` → `MusicDirector` / `BarClock` |

The timeline and music JSON files are bundled in the jar. A file with the same relative path in
`plugins/IndustrialReactor/` (for example `plugins/IndustrialReactor/timelines/reactor_startup.json`)
overrides the bundled copy. This lets you test freshly generated files with `/reactor reload`
without rebuilding.

**Timelines.** Cues run on the main thread at `tick` (or `t * 20` when `tick` is missing). The
parser ignores unknown fields. It skips cues on unknown tracks and cues with unusable values,
and logs a warning for each. Supported tracks:

- `sfx`: plays a sound once. With `loop: true` it starts an ambient loop that re-triggers every
  `loop_ticks`. With `action: "stop"` or `stop: true` it stops that sound.
- `voice`: plays a voice line. The `duration` value keeps the voice channel busy so lines
  never overlap.
- `animation` (target `rotor`): `spin_up`, `spin_down`, `idle_spin`, `shake` or `stop`.
- `texture`: the core model (`off`, `active`, `warning` or `critical`).
- `particles`: re-emitted every 5 ticks for `duration` seconds.
- `music`: `transition` or `stop`, with `quantize` set to `bar`, `beat` or `none`.
- `ui`: a temporary boss bar title, progress and colour.
- `lighting`: a LIGHT block above the core.
- `state`: only moves STARTING or SHUTTING_DOWN on, for example to `RUNNING` or `OFF`.
- `event`: logged at FINE level.

Starting a new timeline cancels the one that is running, so a SCRAM can interrupt the startup.

**Music.** Each player within `music-radius` (48 blocks) of a reactor hears the most alarming
mood nearby: alarm, then calm, then none. A mood plays its intro, then its loop. The loop
re-triggers at `anchor + intro + n * loop_duration`, rounded to the nearest tick, so it never
drifts. When the mood changes, the switch waits for the next transition point
(`bar_seconds * transition_every_bars` after the intro start, or the next beat for
`quantize: beat`). The current sound is then stopped with `stopSound` and the new intro/loop
starts. If the old mood has an `outro` section and the new mood is `none`, the outro is played.
Music is non-positional (RECORDS category) and follows the player.

Music sound events are `<music-sound-prefix><calm|alarm>_<intro|loop|outro>`. The default
prefix is `reactor:reactor.music.` as in the asset contract. If the resource pack registers
them under another name (for example `reactor:music.calm_loop`), set `music-sound-prefix` in
`config.yml` to match.

## Persistence

Reactors are stored in `plugins/IndustrialReactor/reactors.yml`. The plugin saves every
`autosave-minutes`, after a reactor is placed or removed, and when it is disabled. The snapshot
is taken on the main thread and written on an async thread with an atomic replace. A corrupted
file is copied to `reactors.yml.corrupt-<time>.bak` and the plugin carries on. Entities are
re-linked by their `reactor:id`/`reactor:role` PDC tags when their chunk loads, and missing
entities are respawned. Reactors in unloaded chunks do not tick.

## Layout

```
src/main/java/dev/minecraftstudio/reactor/
  ReactorPlugin            wiring, global 1-tick ticker, autosave, selftest/reload
  state/                   ReactorState, StateTransitions (table), CoreTexture
  sim/HeatSimulation       pure heat model + thresholds with hysteresis
  timeline/                Cue (sealed), TimelineParser, TimelinePlayer, TimelineLibrary
  music/                   BarClock (pure), MusicSession (pure), MusicDirector, metadata parser
  reactor/                 Reactor, ReactorManager, ReactorVisuals, AmbientLoops, boss bars, rotor
  storage/                 reactors.yml snapshot I/O
  gui/ command/ listener/ item/ config/ selftest/ util/
```
