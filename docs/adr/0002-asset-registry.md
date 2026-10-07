# ADR 0002 — File-per-record Asset Registry inside the project

- **Status:** accepted (2026-10-07)

## Context

Each asset needs an identity, a lifecycle (idea → draft → review → approved → integrated → deprecated), versions, reproducible sources, QA history and dependencies. The data has to be Git-friendly, readable by the dashboard and by future sessions, and work without a database server.

## Decision

- **Storage.** Each asset is one JSON record in `.minecraft-studio/assets/<id>.json`. Writes are atomic: write to a temp file, then rename.
- **Versions.** Registering new file contents archives them under `history/<id>/vN/` and resets the asset's status to `draft`. Git deduplicates identical blobs, so archived copies are cheap.
- **Approval.** An asset can only become `approved` with a passing QA record for its current version.
- **Sources.** Pixel specs, model sources, recipes, scores, and voice text and profiles live under `sources/<id>/`, or stay as project files that the record references.
- **Related state.** Tasks, memory, timelines, test runs and the JSONL activity log sit next to the registry.

## Consequences

- Git merges happen per asset file, so conflicts are rare and easy to read.
- There are no cross-file transactions. `studio_registry_integrity` catches drift: missing files, files changed outside the studio, and broken dependencies.
- When FFmpeg is available, large audio masters are stored as FLAC. It is lossless and about 6× smaller than WAV.
