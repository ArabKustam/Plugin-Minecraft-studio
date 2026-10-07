---
name: init
description: "Initialise Minecraft Studio in the current project: analyse the Minecraft project, detect platform and version, index existing assets, create the project profile, registry and memory, check integrations and open the Studio Dashboard. Use when the user runs /minecraft-studio:init or starts working on a Minecraft project that has no .minecraft-studio directory."
---

# Initialise Minecraft Studio

1. `studio_project_analyze` (read-only). Summarise for the user: platforms + confidence, Minecraft version, build system, packs/namespaces, texture resolution, sounds, tests, Git state.
2. If the platform or Minecraft version is unknown or ambiguous, **ask the user** (it determines APIs, Java version and pack format). For an empty folder ask what they want to build (Paper plugin, Fabric mod, datapack, resource pack, Bedrock add-on).
3. `studio_project_init {platform?, minecraft_version?}` — creates `.minecraft-studio/` (profile, config, registry index, memory) and adds `.env`/test-server ignores to `.gitignore`.
4. If a resource pack exists: `texture_style_profile {pack_dirs: [<pack dir>]}` to capture the visual style.
5. `studio_doctor` — report missing optional integrations briefly (ElevenLabs, Blockbench MCP, GitHub, FFmpeg) and what still works without them.
6. If the project is not a Git repository, offer to `git init` (don't do it silently).
7. `studio_dashboard_start` and give the URL.
8. Commit only if the user wants: `studio_git_checkpoint {message: "chore(studio): initialise Minecraft Studio", paths: [".minecraft-studio", ".gitignore"]}`.

Finish with a 5–8 line summary and 2–3 suggested next requests tailored to the project.
