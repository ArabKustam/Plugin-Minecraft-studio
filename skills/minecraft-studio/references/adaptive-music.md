# Adaptive music

Game music is a **system**, not an MP3: states, sections, stems and musically-timed transitions.

## Score format (`audio_music_render`)

```json
{
  "title": "reactor_alarm", "state": "alarm", "bpm": 132, "meter": [4, 4], "key": "D minor",
  "transition_every_bars": 2,
  "sections": [ { "name": "intro", "bars": 2 }, { "name": "loop", "bars": 8, "loop": true }, { "name": "stinger", "bars": 1 } ],
  "stems": [
    { "name": "drums", "instrument": "drums", "gain": -9, "parts": { "loop": { "kick": "x...x...x...x...", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x." } } },
    { "name": "bass", "instrument": "bass", "gain": -10, "parts": { "intro": "D2:8", "loop": "D2:2 D2:2 F2:2 A1:2 | Bb1:4 C2:4" } },
    { "name": "choir", "instrument": "choir", "vowel": "a", "gain": -12, "effects": [{ "type": "reverb", "room": 0.8, "mix": 0.35 }], "parts": { "loop": "[D4 F4 A4]:8 [Bb3 D4 F4]:8 [C4 E4 G4]:8 [A3 C#4 E4]:8" } }
  ]
}
```

- Notes: `NOTE:beats` (`C#4:1/2`), chords `[D4 F4 A4]:4`, rests `r:1`, velocity `@0.6`, `|` bar lines are cosmetic. Parts shorter than the section repeat.
- Instruments: `pad, strings, bass, sub, pluck, bell, choir (vowel a/o/u/e/i), lead, pulse, brass, drone, drums (kick, snare, hat, openhat, tom, clap, impact)`.
- One loop section per cue; make one cue per music state (`calm`, `exploration`, `danger`, `alarm`, `combat`, `boss`, `critical`, `victory`, `failure`).

Output layout under `out_dir` (keep it — sources stay editable):

```
music/source/<title>.score.json      editable composition
music/rendered/<title>_<section>.wav section mixes (loop tails wrapped → seamless)
music/stems/<title>_loop_<stem>.wav  per-stem loops for layering
music/metadata/<title>.json          bpm, meter, key, bar_seconds, sections, loop {duration_s, ticks}, transition_points_s, files
```

With `ogg_dir` the same files are exported as Ogg for the resource pack; register sound events (`stream: true`).

## Transitions in game logic

```
game event → desired state changes
          → wait for next transition point (bar or every N bars from loop start)
          → stop current loop (or play outro/stinger)
          → start new intro/loop
```

The plugin reads `metadata/<title>.json` (copy it into the plugin resources): `bar_seconds`, `loop.duration_s`, `transition_every_bars`. Re-trigger loops by accumulating fractional seconds (ticks are 50 ms) to avoid drift. Stems: start all stem events on the same tick; toggle intensity by stopping/starting stems only at loop boundaries (Minecraft cannot change the volume of a playing sound).

## Choir writing

- Ranges: S C4–A5, A G3–D5, T C3–G4, B E2–C4. Keep inner voices within an octave of neighbours.
- Voice leading: common tones held, stepwise motion, avoid parallel 5ths/8ves in exposed writing.
- Text: the formant choir sings vowels; for real lyrics (Latin chant, syllables, consonants, breaths) use a provider capable of singing and keep stems separate.
- Styles: SATB block chords; male choir (T/B only, low register); female (S/A); monophonic chant (unison, free rhythm via held notes); cinematic (open 5ths, large reverb, slow attacks); liturgical (modal, stepwise).

## QA

`audio_audit` on the loop mix (`role: music, loop: true, positional: false`), check transition points align with bar lines, stems sum to the mix level, and the loop seam passes.
