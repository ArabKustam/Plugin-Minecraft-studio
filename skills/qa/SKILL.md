---
name: qa
description: "Quality-assure Minecraft Studio output — visual (textures, models, animations), audio (SFX, music, voice), code and integration — recording verdicts in the Asset Registry; also the \"check the whole plugin and fix problems\" sweep. Use for \"review these assets\", \"QA the reactor\", \"is everything consistent?\", \"check the whole plugin\"."
---

# QA workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/testing.md`.

## Single asset
1. `studio_asset_get` → what is it, which version, its source and previous QA findings.
2. Run the technical tools for its type (see the table in testing.md) and look at the previews.
3. Judge against the task's QUALITY/VALIDATION and the style profile / voice profile / music design.
4. `studio_qa_record {id, by, verdict, summary, checks}` — concrete, actionable findings ("rivets at (3,4) and (12,4) are 1 px off the bevel", "−11 LUFS, 5 LU too loud vs other SFX").

## Full sweep ("check the whole plugin")
1. `studio_registry_integrity`, `mc_resourcepack_validate`, `studio_timeline_validate` for every timeline.
2. `mc_build`, `mc_test`; `mc_test_server` when enabled.
3. Cross-check IDs in code vs pack vs registry.
4. Assets in `review`/`changes-requested`: dispatch `visual-qa`/`audio-qa`.
5. Report a prioritised list; fix what is clearly broken (or create tasks), re-run the checks, record results with `studio_test_record`.
