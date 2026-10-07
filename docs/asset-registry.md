# Asset Registry & project state

Everything lives in `<project>/.minecraft-studio/` and is committed with the project:

| Path | Content |
|---|---|
| `project.json` | profile: name, platform(s), Minecraft version, namespaces, packs, conventions, plugin and pack versions |
| `config.json` | provider selection, audio targets, cost limits, dashboard port, Minecraft test-server settings (never secrets) |
| `style-profile.json` | the pack's visual style profile |
| `assets/<id>.json` | asset records ([schema](../schemas/asset.schema.json)) |
| `history/<id>/vN/` | archived files of each version |
| `sources/<id>/` | reproducible sources (pixel specs, recipes, model sources, raw voice) |
| `previews/` | review images (texture sheets, turnarounds, animation contact sheets) |
| `tasks/<id>.json` | production tasks: dependency-graph nodes with delegation contracts |
| `memory/memory.json` | project memory: decisions, conventions, naming, visual style, voice, music, platform, limitations, integration, bugs |
| `timelines/<id>.json` | synchronised event timelines |
| `voices/` | voice profiles and `pronunciation.json` |
| `tests/<run>.json` | build, test, pack-validation and runtime-smoke runs |
| `logs/activity.jsonl` | structured activity log: ts, agent, task, event, asset, severity, message |
| `logs/usage.jsonl` | paid-provider usage and cost estimates |
| `tools/<name>/` | project tools created with the Tool Factory |
| `agents.json` | agents created with the Agent Factory |

## Lifecycle

```
idea → draft → review → approved → integrated → deprecated
                 ↑ ↓
         changes-requested
```

- **Approval needs QA.** `approved` requires a passing QA record for the current version. `integrated` requires `approved`.
- **New content means a new version.** Changing an asset's files creates a new version and resets it to `draft`.
- **Reverts don't destroy history.** `studio_asset_revert` restores an older version as a new version.
- **Existing project files are imported as integrated.** Files indexed by init get status `integrated`, tag `existing` and QA `n/a`.

## Reproducibility example

> "Make the reactor texture slightly less bright"

1. Edit `art/textures/reactor/core_side_off.pixelspec.json`, or apply a `brightness` op with `texture_variants`.
2. Run `texture_render_spec` with the same `asset.id`. This creates v2 and archives v1.
3. Run QA again. The variants that depend on the asset can be regenerated from their recorded ops.

## Integrity

`studio_registry_integrity` reports:
- missing files
- files modified outside the studio (hash mismatch)
- dependencies on assets that don't exist
