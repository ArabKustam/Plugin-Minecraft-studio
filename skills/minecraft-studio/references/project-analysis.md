# Project analysis

Understand before changing. `studio_project_analyze` (read-only) reports platforms, version, build system, languages, packs, namespaces, texture resolutions, sounds, models, tests, CI and Git state. Then read the actual code for anything you will touch.

## Checklist

| Question | Where to look |
|---|---|
| Minecraft version | build script (`paper-api:1.21.11-R0.1-SNAPSHOT`, `paper-api:26.2.build.132-stable`, `minecraft_version=` in gradle.properties), `api-version` in plugin.yml, `pack_format`/`min_format` in pack.mcmeta |
| Platform | `plugin.yml`/`paper-plugin.yml` (Paper/Bukkit), `fabric.mod.json`, `META-INF/neoforge.mods.toml`, `pack.mcmeta` + `data/` (datapack) or `assets/` (resource pack), `manifest.json` with `modules` (Bedrock), `velocity-plugin.json`/`bungee.yml` (proxy). Projects are often hybrid (plugin + resource pack). |
| Server implementation | Paper vs Spigot vs Folia (`folia-supported: true` → region-threaded scheduling rules!) |
| Architecture | main class, package layout, DI style, how listeners/commands are registered, config handling |
| Namespaces | `assets/<ns>/` — reuse the project's namespace for new content |
| Texture conventions | resolution histogram, folder layout (`textures/block|item|entity`), animated `.mcmeta` usage |
| Models | Java JSON vs Blockbench `.bbmodel` vs Bedrock geometry; item model definitions (`assets/<ns>/items/` → 1.21.4+) vs legacy CustomModelData overrides |
| Sounds | `sounds.json` event naming, mono/stereo, subtitles |
| Tests & CI | `src/test`, `.github/workflows`, how builds run |
| Config style | YAML keys casing, message localisation |

## Profile

`studio_project_init` stores the result in `.minecraft-studio/project.json` and seeds memory (platform, namespace, texture resolution). Add conventions you discover with `studio_project_update {patch: {conventions: {...}}}` and `studio_memory_add` (category `convention`/`naming`).

If the version or platform is ambiguous, **ask the user** rather than guessing — it changes APIs, pack formats and Java versions:

- Minecraft ≤ 1.21.11 → Java 21, `-R0.1-SNAPSHOT` API versions.
- Minecraft 26.x → Java 25, Paper API `26.x.build.N-stable`.

## Respect what exists

Don't migrate build systems, rename packages, reformat files or "modernise" architecture unless asked. Extend in the existing style. If something is broken, report it and propose a fix as a separate task.
