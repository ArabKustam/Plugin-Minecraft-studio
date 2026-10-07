---
name: dashboard
description: "Open the local Minecraft Studio Dashboard (overview, tasks, agents, textures, 3D, animations, SFX, music with stems, voice, resource pack, guides, tests, logs, Git) for the current project. Use when the user runs /minecraft-studio:dashboard or asks to see the studio, assets or progress visually."
---

# Open the Studio Dashboard

1. `studio_dashboard_start` (optionally `port`). If the project is not initialised, run the init workflow first.
2. Give the user the URL (it binds to 127.0.0.1 only) and a one-line tour of what is interesting right now (assets awaiting review, running tasks) using `studio_asset_list {status: "review"}` and `studio_task_graph`.
3. If a built-in browser is available, offer to open it there.
