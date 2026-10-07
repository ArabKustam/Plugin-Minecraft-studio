# Animation

Format: Bedrock animation JSON (`format_version 1.8.0`), editable in Blockbench.

```json
{ "format_version": "1.8.0", "animations": {
  "animation.reactor.startup": { "loop": false, "animation_length": 5,
    "bones": { "rotor": { "rotation": {
      "0.0": [0, 0, 0],
      "1.4": { "post": [0, -8, 0], "lerp_mode": "catmullrom" },
      "3.0": { "post": [0, 360, 0], "lerp_mode": "catmullrom" },
      "5.0": [0, 720, 0] } } } } } }
```

## Principles (apply them, then check the contact sheet)

- **Timing & spacing**: heavy things start slowly and stop slowly; light things snap.
- **Anticipation**: a small counter-move before a big move (rotor turns −8° before spinning up).
- **Ease in/out**: use `catmullrom` or extra keys; pure two-key linear motion looks robotic (validator warns).
- **Overshoot & settle**: doors/levers pass the target by a few degrees and settle back.
- **Follow-through & secondary motion**: valves, lamps, antennas lag behind the main move.
- **Weight**: vibration amplitude grows with speed; small high-frequency position noise (±0.1–0.3 px) sells machinery.
- **Mechanical constraints**: gears rotate at ratios, pistons move along one axis, nothing passes through housings.

## Mechanical sequence template

```
0.0 s  button pressed (panel)
0.2 s  relay click (no visible motion, light flicker)
0.8 s  valves open (rotate 90°, ease-out)
1.4 s  rotor anticipation, then spin-up (ease-in over 1.6 s)
2.0 s  vibration starts (position noise)
3.0 s  stable rotation (loop animation takes over)
5.0 s  operational state (indicator green)
```

Put these beats on the shared **timeline** (`timeline.md`) so SFX, voice and music land on the same moments.

## State animations

For multi-state machines (`off, starting, running, warning, failed`): one animation per state (looped where steady) plus transition animations. Make loops seamless (first = last keyframe or full 360° turns); the validator checks seams.

## Review loop

1. `animation_validate {animations, model_path}` — bone references, keyframes past end, snaps (°/s), loop seams, easing.
2. `animation_render {model_path, animations, animation, frames: 8}` — contact sheet; check silhouettes per frame, clipping, unwanted interpolation flips (e.g. 350°→10° spinning backwards: use 360° continuations).
3. Save with `animation_save {…, model_asset, asset}`.

## In Minecraft Java

Server plugins animate display entities via `Transformation` interpolation (max useful step ≈ 1–2 s; chain steps for continuous spins, ≤ 90° per step to avoid ambiguous interpolation). Bedrock/entity animations are consumed by mods, Bedrock add-ons or model engines — document which runtime consumes the file.
