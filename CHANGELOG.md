# Changelog

All notable changes to Minecraft Studio are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-07

First public release.

### Added
- **Claude plugin:** a manifest and a single-plugin marketplace. 12 skills, including the core `minecraft-studio` skill with 16 reference guides plus `/minecraft-studio:init`, `:doctor` and `:dashboard`. 15 specialist agents. Hooks that add session context, block secrets from file writes, and block pushes that contain secrets. An optional ElevenLabs key setting stored in secure storage.
- **Five MCP servers (82 tools)** with read/write/execute/publish capability gating:
  - `studio-core`: project analysis and init, Asset Registry with lifecycle and versioning, QA records, task dependency graph, project memory, activity log, timelines, Git checkpoints with secret scanning, Agent Factory, Tool Factory, providers, usage, doctor, dashboard.
  - `studio-texture`: pixel-spec rendering, style profiles and matching, palette pass, state variants, tiling and validation checks, review sheets.
  - `studio-model`: model sources exported to Java, Bedrock and `.bbmodel`; validation; software turnaround renderer; animation validation and contact sheets.
  - `studio-audio`: layered SFX synthesizer with 12 presets, an FFmpeg/JS processing chain, LUFS/peak/loop audits, an adaptive music composer (sections, stems, transition metadata), voice profiles, a pronunciation dictionary with Russian stress marks, and Ogg export into `sounds.json`.
  - `studio-minecraft`: platform adapters (Paper/Bukkit, Velocity/Bungee, Fabric, NeoForge/Forge, datapack, resource pack, Bedrock), build and test, a checksum-verified Paper test server, resource-pack validation and packaging.
- **Providers:** ElevenLabs (TTS, SFX, music), system TTS (SAPI, `say`, eSpeak NG), a mock provider, the local synth and the local composer. Every provider reports its capabilities, availability and cost.
- **Studio Dashboard:** a local read-only web UI with 19 views, including texture zoom, a 3D viewer, an animation player, waveform audio, a music stem mixer and the agent inspector.
- **Industrial Reactor demo:** a Paper 1.21.11 plugin (state machine, heat simulation, display-entity rig, GUI, timelines, adaptive music director, 81 unit tests) with a resource pack produced by the studio pipeline (`studio/produce.mjs`).
- **Style-match test:** a separate test showing that a new block matches an existing pack's style while an off-style control fails.
- **Tests and checks:** unit and integration tests through the real MCP servers. CI runs plugin validation, lint, link checks, a dist freshness check, a license check, secret scanning, the demo build and `.plugin` packaging.
