# Audio, music & voice

## SFX

The `local-synth` provider builds sounds from layered recipes ([schema](../schemas/sfx-recipe.schema.json)).

- **Layers:** `osc`, `noise`, `fm`, `chirp`, `click`, `impact` and `sample`, each with its own envelope, filters, effects and pan.
- **Parameters** can be constant, a sweep (`{from, to, curve}`) or an LFO (`{center, depth, rate, shape}`).
- **Master chain effects:** filters, EQ, reverb, compressor, limiter, distortion, bitcrush, tremolo, delay, `radio` and `pa_speaker`.
- **Loudness:** output is normalised to a LUFS target and limited at −1 dBFS.
- **Loops:** `loop: true` crossfades the tail into the head.
- **Presets:** 12 starting recipes ship with the provider (`audio_sfx_presets`).

## Processing

`audio_process` runs a chain of steps on existing audio. It uses FFmpeg presets (`loudnorm`, EQ, compression, limiting, reverb, distortion, radio, PA speaker, pitch, tempo, trim, fade, mono, silence trim, resample) or the JS DSP when FFmpeg isn't installed.

## Audit

`audio_audit` checks a file for Minecraft use:

- Ogg Vorbis codec
- mono, for positional sounds
- clipping and headroom
- integrated LUFS against the role target (SFX −16, voice −18, music −20, ambience −24)
- leading silence
- loop seam: a sample-jump click (fail) or a level step (warn)
- file size

`audio_analyze` also returns a waveform envelope, which the dashboard displays.

## Music

`local-composer` renders a score ([schema](../schemas/music-score.schema.json)).

- **Sections:** intro / loop / outro / stinger.
- **Instruments:** pad, strings, bass, sub, pluck (Karplus-Strong), bell (FM), choir (formant vowels), lead, pulse, brass, drone and synthesized drums.

It writes four kinds of output:

| Output | Path |
|---|---|
| Score source | `music/source/` |
| Section mixes (loop tails wrapped, so loops are seamless) | `music/rendered/` |
| Per-stem loops | `music/stems/` |
| Metadata | `music/metadata/<title>.json` |

The metadata holds BPM, meter, key, beat and bar seconds, sections, loop length (seconds and ticks), transition points every N bars, the stems and the output files. Game logic switches music at those transition points; [adaptive-music.md](../skills/minecraft-studio/references/adaptive-music.md) describes the algorithm.

## Voice

**Voice profiles** ([schema](../schemas/voice-profile.schema.json)) store the character, direction, pace, pitch, provider settings, processing and loudness.

**The pronunciation dictionary** handles stress, aliases and abbreviations. The stress form `реАктор` becomes the combining acute accent for ElevenLabs. Russian numbers are expanded to words.

`audio_voice_line` then:
1. resolves the provider (ElevenLabs → system TTS → mock);
2. trims silence;
3. applies the profile chain and normalises loudness;
4. exports a FLAC master and mono Ogg;
5. registers the original and prepared text so the line can be regenerated identically.

## Masters

Masters are stored as FLAC when FFmpeg is available (`audio.master_format`), and as WAV otherwise.
