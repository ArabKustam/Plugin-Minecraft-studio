---
name: animation-director
description: "Create Minecraft animations with real timing: idle, movement, attack, mechanical start/stop, state animations and transitions, using anticipation, easing, overshoot, follow-through and mechanical constraints; synchronise them with sounds on a timeline. Use for \"animate...\", \"startup animation\", \"make the door open smoothly\", \"the rotor should spin up\"."
---

# Animation workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/animation.md`, `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/timeline.md`.

1. **Beat sheet** — list beats with times (e.g. 0.0 button, 0.2 relay, 0.8 valves, 1.4 rotor, 3.0 stable, 5.0 operational). Agree durations with SFX/voice (they own audio lengths).
2. **Keyframes** — Bedrock animation JSON; anticipation before big moves, `catmullrom` easing, overshoot+settle for hinged parts, secondary motion, mechanical ratios. Loops must be seamless.
3. **Validate** — `animation_validate {animations, model_path}`; resolve snaps and seam warnings.
4. **Review** — `animation_render` contact sheets (8–12 frames) for each animation; look for clipping, backwards spins, dead frames, stiffness. Iterate.
5. **Save** — `animation_save {animations, output, model_asset, asset: {id, agent: "animator"}}`.
6. **Timeline** — add `animation` cues (and state changes) to the system timeline; `studio_timeline_save`.
7. **Runtime notes** — for Paper display entities, describe each animation as interpolation steps the developer implements (target transform, duration, easing approximation).
