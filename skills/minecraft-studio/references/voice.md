# Voice direction

## Voice profiles (consistency across dozens of lines)

`audio_voice_profile_save`:

```json
{
  "id": "station-ai", "name": "Station AI", "language": "ru",
  "character": ["cold", "calm", "professional", "emotionally restrained"],
  "direction": "Speaks like an automated PA system: even pacing, slight pause before numbers, no emotion even in emergencies.",
  "pace": 0.92, "pitch_semitones": 0,
  "providers": {
    "elevenlabs": { "voice_id": "<voice id>", "model_id": "eleven_multilingual_v2", "voice_settings": { "stability": 0.75, "similarity_boost": 0.8, "style": 0.0 }, "seed": 1234 },
    "system": { "espeak_voice": "ru" }
  },
  "processing": [ { "type": "pa_speaker", "drive": 0.06, "mix": 0.18 }, { "type": "compress", "threshold": -20, "ratio": 3 } ],
  "loudness_lufs": -18
}
```

- High `stability` + fixed `seed` keeps a robotic announcer consistent; lower stability for emotional characters.
- Use `previous_text`/`next_text` when lines are spoken in sequence (continuity of intonation).
- Store direction notes in the profile, not in chat.

## Pronunciation dictionary

`audio_pronunciation_add`:

| Need | Entry |
|---|---|
| Russian stress | `{ "term": "реактор", "stress": "реАктор", "language": "ru" }` → ElevenLabs gets `реа́ктор` (combining acute) |
| Abbreviation | `{ "term": "АЭС", "say": "а-э-эс" }` |
| Technical term | `{ "term": "MW", "say": "мегаватт", "language": "ru" }` |
| Name / foreign word | `{ "term": "Blockbench", "say": "блокбенч", "language": "ru" }` |

Numbers in Russian lines are expanded to words automatically (`1200` → `одна тысяча двести`); check grammatical case and adjust the line text if the context needs another form. Pauses: punctuation (`,` `…` `.`) and short sentences; ElevenLabs v3 also understands audio tags, but keep lines portable.

Preview exactly what the provider receives: `audio_pronunciation_preview`.

## Synthesis

`audio_voice_line {line_id, text, profile, output, ogg_output, asset}` — provider `auto`: ElevenLabs if configured (paid → ask the user, `confirm_cost=true`), otherwise system TTS (draft quality: SAPI/eSpeak NG) or `mock`. The registry stores original text, prepared text, profile, provider and pronunciation changes, so lines can be regenerated identically later.

Export voice for Minecraft as mono Ogg (`category VOICE` in code), loudness −18 LUFS, no leading silence > 0.25 s, and make sure lines never overlap in the timeline.

## QA

`audio-qa` checks: pronunciation of every dictionary term, stress, numbers, consistent character between lines, processing level (intelligible through the PA effect), loudness consistency (±1.5 LU across a set), clipping.
