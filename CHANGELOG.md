# Changelog

All notable changes to Minecraft Studio are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] — 2026-10-07

### Added
- **Songs.** `audio_music_render` renders the whole arrangement as one continuous track (`<title>_full`) when a score has no loop section (or with `full_mix: true`), so notes and reverb tails ring across section borders; song stems span the whole arrangement. Options `loop_repeats` and `normalize_on` (loudness measured on the full song by default for songs).
- Per-section part options: `{ notes, velocity }` for dynamics, `{ notes, transpose }` for key changes, `{ pattern, velocity }` for drums.
- Composer reference: how to write and mix a full song (form, dynamic arc, key change, arrangement, balance check).

### Changed
- Stem rendering is one code path for sections, loops and full songs; sampled instruments play each stem in one pass.

## [0.2.0] — 2026-10-07

### Added
- **Real instruments in the music renderer.** Score stems can use all 128 General MIDI instruments by name (`acoustic_grand_piano`, `celesta`, `cello`, `string_ensemble_2`, `choir_aahs`, `flute`, `french_horn`, …), aliases (`piano`, `rhodes`, `guitar`, `рояль`, `скрипка`), `gm:<n>` and 8 drum kits. Instruments are recorded samples from a SoundFont, rendered offline with the bundled [spessasynth_core](https://github.com/spessasus/spessasynth_core) (Apache-2.0); the output is real stereo.
- New stem options: `velocity`, `pedal`, fractional `transpose` (detune via pitch bend), and `legato` above 1 for pedal-like overlap.
- `audio_instruments`: catalogue of instruments, kits, drum names and aliases, plus sound bank status.
- `audio_soundfont_install`: one-time download of GeneralUser GS v2.0 (~31 MB, free for commercial music) into the user cache, pinned by sha256. Custom banks: `score.soundfont` or `MINECRAFT_STUDIO_SOUNDFONT`. The doctor reports the bank.
- `audio_music_render` option `ogg_stems: false` keeps per-stem loops out of the resource pack.
- Loop metadata includes `ticks_exact`.

### Changed
- Synth voices keep their names (`pad`, `strings`, `pluck`, …) and can be written `synth:<name>`; existing scores render as before. Docs and the composer skill now explain that `pluck` is a Karplus-Strong string, not a piano.

## [0.1.1] — 2026-10-07

### Added
- **Abyssal Seer.** A non-humanoid anthropomorphic creature with:
  - digitigrade legs (thigh → shin → raised hock → toes, placed with forward kinematics)
  - four 4-segment back tentacles with wave animation
  - long clawed arms, a coral staff and a robe with belt
  - idle, digitigrade walk and cast animations
  - 3 sounds
- **Armory & Orchard example** (`examples/armory`), a Java 1.21.11 resource pack:
  - 4 swords and a 4-piece tool set
  - 2 bows, each with 3 draw stages and a `condition`/`range_dispatch` item definition
  - 2 animated staffs and 6 fruits
  - 2 wearable sets, ranger clothing and knight plate: icons, worn `humanoid`/`humanoid_leggings` textures and equipment assets, previewed on a mannequin
  - `/give` commands for every item
- `texture_shade_item`: an item shader that turns part-labelled silhouettes into lit, outlined pixel art, with material styles and animation frames.
- Resource-pack validation now checks equipment layer textures.
- `item-spec` JSON Schema. README artwork for the new examples: inventory-style item sheet, bow and staff animation, rotating mannequins and a Seer showcase.

- **Creature Pack example** (`examples/creatures`). Six rigged, textured, animated and voiced creatures: 3 animals (Ember Fox, Highland Ox, Marsh Heron), 2 monsters (Rust Crawler, Hollow Wraith) and 1 anthropomorphic NPC (Badger Smith). Each ships with idle, walk and attack animations plus specials, and with ambient, hurt and attack sounds. Output: a Bedrock add-on (`.mcaddon`) and Blockbench projects.
- `texture_paint_uv`: automatic box-UV packing and pixel-art atlas painting from materials (ramps, patterns) with per-face shading and hand-authored face overlays.
- `mc_bedrock_validate` / `mc_bedrock_package`: checks Bedrock add-on manifests, entity, geometry, texture, animation and sound references, and packages `.mcpack`/`.mcaddon` files.
- `paint-spec` JSON Schema. Creature lineup and walk-cycle artwork in both READMEs.

### Fixed
- `studio-audio` (SFX, music, voice) no longer disappears when the optional ElevenLabs key is empty. `.mcp.json` no longer references `${user_config.*}`, because Claude Code skips a server whose optional option is unset. The key is read from `ELEVENLABS_API_KEY` (environment or project `.env`) or `CLAUDE_PLUGIN_OPTION_ELEVENLABS_API_KEY`.
- Asset history archives use short `<n>-<file>` names (old records still revert). The longest repository path drops from 166 to 127 characters, so the marketplace clone stays under the Windows 260-character limit.
- Delegation works on Claude Code versions where subagents cannot start subagents: the main conversation dispatches specialists, and `project-director` returns its plan instead of doing the specialists' work.
- The main skill description now names plugins, mods, datapacks, resource packs, models and textures explicitly, including Russian phrasing.
- Texture validation no longer treats non-square entity atlases (e.g. 64×128) as animation strips.

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
