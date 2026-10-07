# Testing & QA

```
Generation → Technical validation → Specialised QA → Integration QA → Final review
```

## Technical validation (by the producer)

| Asset | Tools |
|---|---|
| texture | `texture_validate`, `texture_check_tiling`, `texture_style_compare` |
| model | `model_validate`, `model_render` |
| animation | `animation_validate`, `animation_render` |
| audio | `audio_audit` (role, loop, positional) |
| timeline | `studio_timeline_validate` |
| pack | `mc_resourcepack_validate` |
| code | `mc_build`, `mc_test` |

## Specialised QA (separate agents)

- `visual-qa`: textures (style, palette, resolution, tiling, readability, artifacts), models (silhouette, proportions, pivots, UV, clipping, texture alignment), animations (timing, smoothness, clipping, unwanted interpolation).
- `audio-qa`: validity, Minecraft compatibility, clipping, loudness consistency, loop seams, silence, duration, size, mono/stereo suitability, pronunciation.
- `code-reviewer`: architecture, threading, tick cost, persistence, permissions, errors, compatibility.

Each records `studio_qa_record {id, by, verdict, summary, checks[]}` with concrete, actionable findings. Verdict semantics: `pass` → approved; `warn` → stays in review (director decides); `fail` → changes-requested.

## Integration QA

Checks the links `code ↔ model ↔ animation ↔ audio ↔ texture`:

- Every `minecraft_ids` of approved assets is referenced by code or pack; every ID used in code exists in the pack (grep constants vs `sounds.json`, `items/`).
- `studio_registry_integrity` (missing/modified files, broken dependencies).
- Pack validation passes; timelines validate against `sounds.json`.
- Build + unit tests pass.

## Runtime testing (Paper)

Requires the user's explicit acceptance of the Minecraft EULA (`studio_config_set {minecraft: {accept_eula: true}}` only after they say yes).

```
mc_build → mc_test_server {version, plugin_jars, commands: ["<plugin> selftest", "plugins"]}
         → check: ready, plugin enabled, no errors, selftest output
         → on failure: diagnose log → fix → rebuild → retest
```

Write a `selftest` console command in plugins you build: it validates bundled timelines/metadata, sound keys and state tables, and prints a single PASS/FAIL line the smoke test can assert.

All tools record runs (`build`, `unit-tests`, `resource-pack`, `runtime-smoke`); add your own with `studio_test_record`. The dashboard Tests view shows them.

## Final review

Director checks the QA summary, open warnings, and the user-visible result (dashboard previews), then reports Created / Changed / Validated / Failed / Needs review.
