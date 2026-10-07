# Sound effects & audio processing

## Design as layers (recipes are the source)

A sound is a stack of purposeful layers. Example — industrial siren:

| Layer | Recipe layer |
|---|---|
| fundamental tone | `osc` saw, `freq: {center: 720, depth: 260, rate: 0.5, shape: "triangle"}`, harmonics `[1, 0.45, 0.2]` |
| harmonics/brightness | lowpass 3.5 kHz on the tone |
| motor layer | `noise` brown, bandpass 160 Hz q 2, −20 dB |
| speaker coloration & distortion | `distortion` 0.12 → `pa_speaker` |
| room response | `reverb` inside `pa_speaker` (or explicit) |

`audio_sfx_presets` lists ready starting points: button, relay, hydraulic, engine_loop, siren, alarm_beep, power_up, power_down, explosion, ui_confirm, ambience_hum, growl. Start from a preset (`preset` + `overrides`) or write a full `recipe`. Layer types: `osc`, `noise`, `fm`, `chirp`, `click`, `impact`, `sample` (layer an existing recording). Each layer: `start`, `duration`, `gain` dB, `envelope`, `filter(s)`, `effects`, `pan`.

Render: `audio_sfx_render {recipe|preset, output: "audio/sfx/x.wav", ogg_output: "<pack>/assets/<ns>/sounds/x.ogg", asset}` → WAV master + Ogg, audit, registry entry with the recipe as source.

AI generation (`audio_sfx_generate_ai`, ElevenLabs) is for realistic foley the synth can't do (footsteps on gravel, creature breaths). Paid: ask first, `confirm_cost=true`, then process/trim locally rather than regenerating.

## Physical models (use them before stacking raw oscillators)

| Sound | Layer | Key fields |
|---|---|---|
| Creature growls, roars, screams; human screams, laughter, giggles, crying, panting | `voice` | `pitch` contour (`{points:[[t,Hz]...]}`), `vowel` morph, `size` (0.8 child ... 2 monster), `strain` (scream), `rough` (growl), `breath`, `jitter`, `vibrato`, `pulses` {rate, duty, jitter, pitch_jitter, accent} for "ha-ha", sobs, panting |
| Doors, pipes, plates, bells, glass, wood, piano strings | `modal` | `material` (metal, metal_plate, pipe, glass, wood, stone, string), `freq`, `decay`, `hits` (times, or {count, start, end, distribution} for shatters/rattles/bounces), `freq_spread` (shards), `brightness` |
| Scrapes (metal, wood, glass), creaky hinges, nails on glass | `scrape` | `material`, `freq`, `speed` (slips/s; low = creak, high = screech), `pressure`, `grit`, `squeal`, `q` |
| Footsteps, claw taps, bubbles, debris, drips | any layer + `repeat` | {times} or {count, interval, jitter, gain_jitter, pitch_jitter, accel, fade_db}; every copy gets its own seed |

- Combine: a monster scream = 3 `voice` layers (main, sub-octave roar, detuned upper) + breath noise + distortion; a falling piano = whoosh + impact + a real piano cluster rendered with the SoundFont sampler (`sample` layer) + `modal` wood splinters + `modal` string ring.
- Interjections need variation: `pulses.jitter`, `pitch_jitter` and `accent` keep laughter and sobs from sounding like a metronome.
- Sharp transients (cracks, glass, laughter attacks) overshoot after Ogg encoding: set `normalize.ceiling` to -2...-4 and re-run `audio_audit` on the .ogg.
- Synthesis has limits: voices are formant-synthesised, not recorded. For close-up realistic human performances suggest recorded or ElevenLabs sources (`audio_sfx_generate_ai`, paid, with consent).

## Minecraft requirements

- **Ogg Vorbis** only. **Mono** for positional sounds (stereo does not attenuate with distance). Music/UI may be stereo.
- 44.1/48 kHz. Keep files small (q4 ≈ 128 kbps is plenty).
- No leading silence for sync-critical sounds (button, relay); tails may ring.
- Loops: seamless (recipe `loop: true` crossfades tail→head); verify with `audio_audit {loop: true}`.
- Loudness targets (integrated LUFS): SFX −16, voice −18, music −20, ambience −24 (±3). Peaks ≤ −1 dBFS.
- Register in `sounds.json` (`audio_export_minecraft` or `mc_sound_event`) with a `subtitle` for accessibility; `stream: true` for long music.

## Processing

`audio_process {input, output, steps, engine}`:
- ffmpeg presets: `loudnorm`, `highpass`, `lowpass`, `eq{bands}`, `compress`, `limit`, `reverb`, `distortion`, `radio`, `pa_speaker`, `pitch{semitones}`, `tempo{factor}`, `trim{start,end}`, `fade{in,out}`, `mono`, `silence_trim`, `resample`.
- js effects (no FFmpeg needed): same DSP as recipes (`reverb`, `compress`, `limit`, `eq`, `radio`, `pa_speaker`, `delay`, `loop`, …).

## QA

`audio_audit` before handing to `audio-qa`: codec, channels, clipping, headroom, loudness vs role, leading silence, loop seam, size. Listen-critical aspects (character, mix balance, annoyance on repetition) are judged by `audio-qa` from analysis + description; when in doubt, ask the user to listen via the dashboard.
