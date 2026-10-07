# Compatibility

What has actually been tested is marked ✅ tested. Things that should work by design but were not run end to end are marked 🟡 expected. Things that are known not to work are marked ❌.

## Hosts

| Host | Status | Notes |
|---|---|---|
| Claude Code 2.1.x (CLI/desktop), Windows 10 | ✅ tested | `claude plugin validate` passes; all 5 MCP servers run over stdio; hooks run through `node` |
| Claude Code on macOS / Linux | 🟡 expected | Pure Node + POSIX paths; CI runs the test suite on ubuntu-latest |
| Claude Cowork (`.plugin` upload) | 🟡 expected | Packaged per the create-cowork-plugin format; the local runtime (Node, FFmpeg, Java) must exist where the plugin runs |

## Operating systems (runtime)

| OS | Status |
|---|---|
| Windows 10/11 | ✅ tested (Node 22, Java 21, FFmpeg 8.1, SAPI) |
| Ubuntu 22.04+ | 🟡 CI (Node 22, FFmpeg, eSpeak NG) |
| macOS 13+ | 🟡 expected (system TTS via `say`, converted with FFmpeg; untested) |

## Minecraft platforms

| Platform | Detect | Build/test | Run | Assets |
|---|---|---|---|---|
| Paper / Spigot / Bukkit | ✅ | ✅ Maven (demo); 🟡 Gradle | 🟡 Paper test server (implemented and needs EULA consent; not run during this release's testing) | ✅ |
| Folia | 🟡 detected as Paper | 🟡 | 🟡 | ✅ |
| Velocity / BungeeCord | 🟡 | 🟡 | — | — |
| Fabric | 🟡 | 🟡 Gradle (Loom) | — | ✅ resource pack side |
| NeoForge / Forge | 🟡 | 🟡 Gradle | — | ✅ resource pack side |
| Datapack | ✅ detect | — | — | 🟡 |
| Java resource pack | ✅ | ✅ validate & package | — | ✅ |
| Bedrock add-on | ✅ detect | — | — | ✅ add-on generation + static validation (Creature Pack); 🟡 not yet loaded in a Bedrock client |

## Minecraft versions

| Version | Status |
|---|---|
| 1.21.11 (Paper, Java 21, pack format 75) | ✅ demo compiles against `paper-api:1.21.11-R0.1-SNAPSHOT`; pack validates |
| 1.21.4 – 1.21.10 | 🟡 item-model definitions supported; pack formats known |
| 26.1 – 26.3 (Java 25, `paper-api:26.x.build.N`) | 🟡 version detection & pack formats (84/88); not built in tests (needs Java 25) |
| < 1.21.4 | 🟡 textures/sounds/models work; item-model definitions (`assets/<ns>/items`) don't exist there, so use CustomModelData |

## Integrations

| Integration | Status |
|---|---|
| ElevenLabs TTS / SFX / music | 🟡 implemented against the documented REST API (2026-10); tested in mock and cost-gate mode only, because no key was available during development |
| System TTS: Windows SAPI | ✅ (Russian voice used in the demo) |
| System TTS: eSpeak NG | 🟡 fallback path |
| FFmpeg (Ogg Vorbis) | ✅ 8.1 |
| Blockbench | ✅ `.bbmodel` 5.0 export (Blockbench 5.x); 🟡 live MCP bridges (third-party, see modeling.md) |
| GitHub | 🟡 via the official GitHub MCP / gh CLI (not bundled) |
