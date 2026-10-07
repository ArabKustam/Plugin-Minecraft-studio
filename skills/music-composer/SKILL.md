---
name: music-composer
description: "Compose adaptive Minecraft game music: states (calm, exploration, danger, alarm, combat, boss, critical, victory, failure), intro/loop/outro/stinger sections, stems, choir (SATB, chant, cinematic), BPM/key/bar metadata and bar-quantised transitions driven by game logic. Use for \"normal and emergency soundtrack\", \"boss music\", \"music that switches when the alarm starts\", \"add a choir layer\"."
---

# Music workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/adaptive-music.md`.

1. **Music design** — states and what triggers them; per state: mood, tempo, key, instrumentation, intensity layers (stems). Related states share key/tempo relations so transitions feel natural (e.g. calm 92 BPM D minor → alarm 132 BPM D minor).
2. **Score** — one cue per state with `intro`, one `loop` (8–16 bars), optional `outro`/`stinger`; separate stems for layers that game logic may toggle (drums, bass, choir, pads).
3. **Render** — `audio_music_render {score, out_dir: "audio/music", ogg_dir: "<pack>/assets/<ns>/sounds/music", asset: {id, agent: "composer"}}`; check the loop audit (seam, loudness −20 LUFS).
4. **Integrate** — sound events (`stream: true`), copy `metadata/<title>.json` into the plugin resources, describe the transition rule (every N bars) to the developer.
5. **Iterate** on the score source; keep `music/source/` — it's the editable composition.
6. **AI music** (`audio_music_generate_ai`) only for references/one-offs with the user's consent.
7. Hand off to `audio-qa` with BPM, key, bar length, loop length, transition points.
