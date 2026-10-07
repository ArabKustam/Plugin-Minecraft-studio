---
name: voice-director
description: "Direct voice lines for Minecraft (announcers, station AI, NPCs, narrators) with persistent voice profiles, a pronunciation dictionary (Russian stress, technical terms, abbreviations, numbers), ElevenLabs or local TTS, and consistent post-processing such as PA speaker or radio. Use for \"add voice announcements\", \"the system should say...\", \"voice through ElevenLabs\", \"fix the stress in this word\"."
---

# Voice workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/voice.md`.

1. **Persona** — create or load the voice profile (`audio_voice_profile_save` / `_get`): language, character, direction, pace, provider settings, processing, loudness.
2. **Script** — short, speakable lines; numbers and abbreviations checked; one id per line (`startup`, `warning`, ...).
3. **Pronunciation** — add dictionary entries for every term, name, abbreviation, Russian stress (`audio_pronunciation_add`); verify with `audio_pronunciation_preview`.
4. **Provider** — `studio_providers`: ElevenLabs if configured (paid → confirm with the user once for the batch, then `confirm_cost: true`), otherwise system TTS for drafts — and say so clearly.
5. **Synthesize** — `audio_voice_line` per line with `previous_text/next_text` for sequences; mono Ogg export; read audits (loudness consistency across the set ±1.5 LU).
6. **Timeline** — give real durations; make sure lines never overlap.
7. Hand off to `audio-qa` with the list of lines, prepared texts and dictionary changes.
