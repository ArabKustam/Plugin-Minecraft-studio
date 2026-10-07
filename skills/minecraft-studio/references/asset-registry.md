# Asset Registry

Every meaningful artifact is an asset record in `.minecraft-studio/assets/<id>.json`:

`id, type, name, description, status, version, files[{path, role, sha256, bytes}], source{provider, method, prompt/text, parameters, source_files, references}, created_at, modified_at, created_by, dependencies[], minecraft_ids[], preview, tags[], qa_status, qa_history[], versions[], metadata{}`

Types: `texture, model, animation, sfx, music, voice, particle, code, configuration, guide, reference, tool, timeline`.

## Lifecycle

```
idea → draft → review → approved → integrated → deprecated
                 │  ▲
                 ▼  │
        changes-requested
```

- New files on an existing asset create a **new version** (old files archived under `.minecraft-studio/history/<id>/vN/`) and reset the status to `draft`.
- `approved` requires a passing QA record **for the current version**. `integrated` requires `approved`.
- `studio_asset_revert {id, version}` restores an archived version as a new version (non-destructive).
- Imported existing pack files are `integrated` with tag `existing` and QA `n/a`.

## IDs & naming

Lowercase, `[a-z0-9_.-]`, stable: `reactor.core_off.texture` or `reactor_core_off`. Pick one convention per project and store it in memory (`naming`). `minecraft_ids` hold the game-facing identifiers (`reactor:item/core_off`, `reactor:reactor.startup`).

## Reproducibility

Store the source, not just the output: pixel spec, model source, animation JSON, SFX recipe, music score, voice text + profile + dictionary, provider + parameters + seed. Then "make the reactor texture a bit less bright" is an edit of the spec (`brightness` op or palette tweak) and a new version — not a regeneration.

## Integrity

`studio_registry_integrity` detects missing files, files changed outside the studio (someone edited the PNG by hand — re-register as a new version), and broken dependencies. Renaming a file: update the asset `files`, then validate the pack to find references to the old path.

## Cost

Paid generations are logged in `logs/usage.jsonl` (`studio_usage`). Max generations per asset is configurable (`costs.max_generations_per_asset`).
