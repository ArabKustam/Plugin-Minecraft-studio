# Timelines (synchronising everything)

One timeline describes a game event across all media. Game code executes the compiled tick list; the dashboard shows it; QA validates it.

```json
{
  "id": "reactor_startup", "title": "Reactor start sequence", "trigger": "reactor.start", "duration": 5,
  "tracks": {
    "sfx":       [ { "t": 0.0, "sound": "reactor:reactor.button" }, { "t": 0.4, "sound": "reactor:reactor.relay" }, { "t": 1.1, "sound": "reactor:reactor.hydraulic" } ],
    "voice":     [ { "t": 0.1, "line": "startup", "sound": "reactor:reactor.voice.startup", "duration": 2.4 } ],
    "animation": [ { "t": 1.5, "animation": "spin_up", "target": "rotor", "duration": 2.0 } ],
    "particles": [ { "t": 2.0, "particle": "minecraft:cloud", "count": 12, "spread": [0.4, 1, 0.4], "duration": 1 } ],
    "texture":   [ { "t": 3.5, "state": "active" } ],
    "lighting":  [ { "t": 3.5, "level": 12 } ],
    "music":     [ { "t": 4.0, "action": "transition", "state": "calm", "quantize": "bar" } ],
    "ui":        [ { "t": 0.0, "bossbar": "Starting…", "progress": 0 }, { "t": 5.0, "bossbar": "ONLINE", "progress": 1 } ],
    "state":     [ { "t": 5.0, "state": "RUNNING" } ]
  }
}
```

Tracks: `event, sfx, animation, texture, particles, music, voice, ui, lighting, state`. Times in seconds; they compile to ticks (`round(t·20)`), so prefer multiples of 0.05 s.

## Workflow

1. Draft the beats with the animator, SFX designer and voice director (who give real durations from audits).
2. `studio_timeline_save {timeline, export_to: "src/main/resources/timelines/reactor_startup.json"}` — validates, stores the source in `.minecraft-studio/timelines/`, exports the compiled cue list for the game, registers a `timeline` asset, returns an ASCII lane view.
3. `studio_timeline_validate {id, sounds_json: "<pack>/assets/<ns>/sounds.json"}` — verifies every sound event exists, ordering, overlaps of voice lines, tick alignment, unquantized music changes.
4. The developer implements a generic `TimelinePlayer` that executes cues by track — no hard-coded delays elsewhere.

Changing the sequence later = edit the timeline source and re-export; code doesn't change.
