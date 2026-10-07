# Research: audio pipeline (2026-10)

- **Format.** Minecraft plays only **Ogg Vorbis**. Only **mono** files attenuate with distance. Long music should set `"stream": true` in `sounds.json` ([minecraft.wiki/w/Sounds.json](https://minecraft.wiki/w/Sounds.json)).
- **Processing.**
  - FFmpeg handles decoding, resampling, `loudnorm`, filters and `libvorbis` encoding. It is LGPL/GPL and runs as an external process.
  - Synthesis and FFmpeg-free effects use a pure-JS DSP: biquad filters, a Freeverb-style reverb, a compressor and a look-ahead limiter.
- **Loudness.**
  - We measure integrated LUFS per ITU-R BS.1770 / EBU R128: K-weighting (high-shelf +4 dB at 1.5 kHz, high-pass at 38 Hz), 400 ms blocks with 75 % overlap, an absolute gate at −70 LUFS and a relative gate at −10 LU.
  - Targets: SFX −16, voice −18, music −20, ambience −24.
- **Masters.** We store masters as FLAC: lossless, and about 6× smaller than WAV for synthesised material.
- **ElevenLabs** ([API reference](https://elevenlabs.io/docs/api-reference)). Every request authenticates with the `xi-api-key` header.
  - TTS: `POST /v1/text-to-speech/{voice_id}`. Model `eleven_multilingual_v2` (supports Russian), with `voice_settings`, `seed` and `previous_text`/`next_text`.
  - SFX: `POST /v1/sound-generation`. `duration_seconds` 0.5–30, `prompt_influence`, `loop`, model `eleven_text_to_sound_v2`.
  - Music: `POST /v1/music`. Either `prompt` or `composition_plan`; `music_length_ms` from 3 to 600 s.
  - Key check: `GET /v1/user/subscription`.
- **Russian stress.** ElevenLabs accepts a combining acute accent (U+0301) after the stressed vowel. The studio's dictionary marks stress with an upper-case vowel (`реАктор`) and converts it to whatever each provider expects.
