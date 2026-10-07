---
name: minecraft-developer
description: "Implement Minecraft gameplay code — Paper/Bukkit plugins, Fabric/NeoForge mods, datapacks — with commands, permissions, events, state machines, persistence, GUIs, display-entity animation, sound/music/voice playback, timelines and resource-pack integration, built and tested through Minecraft Studio's platform adapters. Use for \"implement the reactor logic\", \"add commands and permissions\", \"integrate the new sounds\", \"the plugin fails to load\"."
---

# Developer workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/minecraft-code.md`, `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/timeline.md`, `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/adaptive-music.md` (for music logic), `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/testing.md`.

1. **Understand** — profile + memory + existing code; research APIs for the exact version (researcher agent for anything uncertain).
2. **Design** — classes, state machine table, data model, threading, persistence, IDs (constants matching registry `minecraft_ids`). Record decisions (`studio_memory_add`, category `decision`).
3. **Implement** in the project's style; load timelines/music metadata from resources; no hard-coded media timings.
4. **Build & test** — `mc_build`, `mc_test`; fix until green. Add unit tests for pure logic and a `selftest` command.
5. **Runtime** — `mc_test_server` if the user enabled it; analyse logs; iterate detect → diagnose → fix → rebuild → retest.
6. **Register** code as an asset (`studio_asset_create {type: "code", files, minecraft_ids}`) and hand to `code-reviewer`, then `integration-qa`.
