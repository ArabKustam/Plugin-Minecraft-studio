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
- **Real instruments:** all 128 General MIDI instruments by name (`acoustic_grand_piano`, `celesta`, `cello`, `string_ensemble_2`, `choir_aahs`, `flute`, `french_horn`, `kalimba`, …), aliases (`piano`, `rhodes`, `guitar`, `рояль`) and 8 drum kits (`drum_kit`, `jazz_kit`, `brush_kit`, `orchestra_kit`, …). They are recorded samples from a SoundFont, rendered offline by [spessasynth_core](https://github.com/spessasus/spessasynth_core) (Apache-2.0, bundled). `audio_instruments` lists everything.
  - The sound bank is not bundled. `audio_soundfont_install` downloads [GeneralUser GS v2.0](https://github.com/mrbumpy409/GeneralUser-GS) (S. Christian Collins; ~31 MB; free for private and commercial music) once per computer into `%LOCALAPPDATA%minecraft-studiosoundfonts` or `~/.cache/minecraft-studio/soundfonts`, pinned by sha256. Use your own .sf2/.sf3 with `"soundfont"` in the score or `MINECRAFT_STUDIO_SOUNDFONT`.
  - Stem options: `velocity`, `legato` (> 1 overlaps notes like a sustain pedal), `pedal`, fractional `transpose` (detune), `pan`, `gain`, `effects`.
- **Synth voices** (no download): pad, strings, bass, sub, pluck (Karplus-Strong, sounds like a plucked string, not a piano), bell (FM), choir (formant vowels), lead, pulse, brass, drone and synthesized drums. `synth:<name>` is the explicit form.

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
