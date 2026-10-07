# Minecraft platform adapters

"Minecraft plugin" can mean many things, so the studio never assumes one API. A `MinecraftPlatformAdapter` (`runtime/src/lib/adapters/minecraft.js`) provides:

| Member | Purpose |
|---|---|
| `detect(root, files)` | confidence (0–1), evidence and the Minecraft version, if it can find one |
| `build(root)` / `test(root)` | an allow-listed command: Gradle wrapper, then Gradle, then Maven |
| `artifacts(root)` | the jars that were built |
| `run` | runner id, e.g. `paper-test-server` |
| `parseLog(text)` | errors, warnings, loaded plugins, startup done |

| Adapter | Detects |
|---|---|
| `paper` | `plugin.yml` / `paper-plugin.yml`, `paper-api` / `paperweight` / Spigot deps; versions `1.21.11-R0.1-SNAPSHOT` and `26.x.build.N` |
| `velocity` | Velocity / BungeeCord APIs and descriptors |
| `fabric` | `fabric.mod.json`, Loom |
| `neoforge` | `META-INF/(neoforge.)mods.toml`, NeoForge / ForgeGradle |
| `datapack` | `pack.mcmeta` + `data/` |
| `resourcepack` | `pack.mcmeta` + `assets/` |
| `bedrock` | `manifest.json` with `header.uuid` + `modules` |

Projects are often **hybrid**, for example a Paper plugin plus a resource pack. `mc_detect` returns every match, and the profile records the primary platform.

## Test server (Paper)

`mc_test_server` runs a disposable local server:

1. Downloads the latest build for the version from `fill.papermc.io/v3` and verifies its SHA-256.
2. Writes an offline-mode, flat-world `server.properties` bound to `127.0.0.1:25599`.
3. Copies the plugin jars in, starts Java and waits for `Done (…)!`.
4. Sends the smoke-test commands (e.g. `<plugin> selftest`), then `stop`.
5. Returns the readiness, loaded plugins, errors and warnings, command outputs, and the log path.

It refuses to run until the user accepts the Minecraft EULA. Claude must ask, then call `studio_config_set {minecraft: {accept_eula: true}}`. It also checks the Java version: Minecraft 26.x needs Java 25.

## Adding an adapter

Add an object to `ADAPTERS`, with detection tests in `tests/unit/media.test.mjs`. If it needs a runtime runner, add it to `lib/minecraft/runner.js` and expose it through `studio-minecraft`. Mark the new adapter in [compatibility.md](compatibility.md) honestly.
