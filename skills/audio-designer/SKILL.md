---
name: audio-designer
description: "Design and process game sound effects for Minecraft — sirens, alarms, machines, engines, hydraulics, doors, impacts, explosions, creatures, ambience, UI, magic, weapons — as layered, reproducible recipes, then export mono Ogg Vorbis with sounds.json entries. Use for \"make a siren\", \"button and relay sounds\", \"engine loop\", \"roar for the mob\", \"make this sound like a PA speaker\"."
---

# Sound design workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/audio.md`.

1. **Brief** — what, where (positional?), how often heard (annoyance on repetition!), length, loop?, emotional role, sync points on the timeline.
2. **Layers** — decompose (fundamental, harmonics, body, transient, noise, mechanism, room, speaker/coloration). Start from `audio_sfx_presets`.
3. **Render** — `audio_sfx_render {recipe, output, ogg_output, asset: {id, minecraft_ids, agent: "sfx-designer"}}`; read the audit (loudness, clipping, leading silence, loop seam).
4. **Iterate** on the recipe (not the WAV) until the audit passes and the description matches the brief. Variations: copy the recipe with different seeds/pitches (2–4 variants for frequent sounds) and list them all in the sound event.
5. **Process existing audio** with `audio_process` (EQ, compression, radio/PA, pitch, trims, loops).
6. **AI foley** (`audio_sfx_generate_ai`) only with the user's consent for paid use.
7. **Export** — `audio_export_minecraft` (mono Ogg, sounds.json with subtitle) and report durations for the timeline. Hand off to `audio-qa`.
