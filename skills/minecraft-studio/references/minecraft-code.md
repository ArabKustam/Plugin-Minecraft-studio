# Minecraft code (plugins & mods)

## Before writing code

- Confirm platform and version (project profile). Read the official docs for the APIs you use — APIs change between versions (e.g. item models via `ItemMeta#setItemModel` since 1.21.4; Paper 26.x versioning).
- Follow the project's existing structure, naming, config and localisation style.

## Production checklist

| Area | Rules |
|---|---|
| Threading | Bukkit API on the main thread only. IO (files, HTTP, DB) async, results applied back on main thread. Folia: use region/entity schedulers. |
| Tick cost | One shared ticker for many machines instead of a task per machine; skip unloaded chunks; avoid per-tick allocations, streams in hot loops, and world scans. |
| State | Explicit state machines with a transition table; reject illegal transitions; unit-test them. |
| Persistence | PDC for entity/item tags; data files written atomically (temp + rename), backup on corrupt load, autosave + save on disable. |
| Lifecycle | Cancel tasks and remove transient entities/bossbars on disable; handle `/reload`, player quit/join/teleport/world change. |
| Multiplayer | Per-player state in maps keyed by UUID, cleared on quit; never assume a single player. |
| Commands | Permissions per sub-command, tab completion, helpful usage messages, console-safe paths. |
| Config | Defaults in `config.yml`, validated on load with clear warnings; no magic numbers in code. |
| Resource pack | IDs (`ns:item_model`, sound events) as constants in one place, matching the registry `minecraft_ids`. |
| Errors | Catch per-machine failures so one bad reactor does not stop the ticker; log with context. |
| Compatibility | No NMS unless required; guard version-specific API. |

## Sounds & media from code

- `world.playSound(loc, "ns:event", SoundCategory.BLOCKS, volume, pitch)` for positional sounds (mono files!).
- Music: play per player at the player location in `SoundCategory.RECORDS` (or `MUSIC`), stop with `player.stopSound(key, category)`; re-trigger loops by duration from the music metadata; switch on bar boundaries (`adaptive-music.md`).
- Voice: `SoundCategory.VOICE`, rate-limit so lines never overlap.
- Load compiled timelines from resources (`timeline.md`) instead of hard-coding delays.

## Build & test

`mc_build` → fix errors → `mc_test` (unit tests for pure logic) → `mc_test_server` smoke test (requires the user's EULA consent) with commands like `<plugin> selftest`. Iterate: detect → diagnose → fix → rebuild → retest. Record results (the tools store test runs for the dashboard).

## Bedrock add-ons

- **Packs.**
  - The behavior pack depends on the resource pack via `dependencies`.
  - UUIDs are stable: generate them deterministically from the project name.
- **Entities.**
  - Every `minecraft:entity` needs a matching `minecraft:client_entity`.
  - Animations are chosen in `scripts.animate` with Molang. Typical conditions: `query.modified_move_speed`, `variable.attack_time`, `query.is_on_ground`.
  - Animation `timeline` entries must be Molang or commands, not labels.
- **Sounds.** Define them in `sounds/sound_definitions.json` and map entity events in `sounds.json`. Supported events: `ambient`, `hurt`, `death`, …
- **Release.** Validate with `mc_bedrock_validate`, then package a `.mcaddon` with `mc_bedrock_package`.

## Code review

Send non-trivial changes to `code-reviewer` (architecture, thread safety, tick cost, persistence, permissions, error handling) before integration QA.
