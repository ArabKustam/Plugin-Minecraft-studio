# ADR 0004 — Blockbench as an optional adapter; built-in exporters + renderer as the default path

- **Status:** accepted (2026-10-07)

## Context

Blockbench is the standard modelling tool for Minecraft. Two community MCP bridges exist:

- **sosadly/blockbench-mcp** — MIT, about 70 tools, stdio server plus an HTTP bridge on port 8787.
- **jasonjgardner/blockbench-mcp-plugin** — GPL-3.0, actively released, streamable HTTP at `:3000/bb-mcp`.

The specification also named **CyperNexus/blockbench-mcp**. It turned out to be a GPL-3.0 repository uploaded in a single day, with a README duplicating the jasonjgardner one, so we evaluated the upstream instead.

Both bridges need a running Blockbench window, so neither can be the only path for CI or headless sessions.

## Decision

- **Default path.** Model sources go through the built-in exporters (Java, Bedrock, and `.bbmodel` 5.0 with embedded textures and animations). A software renderer produces turnarounds and animation frames for visual QA.
- **Live Blockbench control.** The user installs one of the bridges. We document both, and the doctor probes their ports. No bridge code is copied or bundled. The bridges run as separate processes, so a GPL bridge does not affect Minecraft Studio's MIT license.
- **Script tools.** Agents do not use the bridges' arbitrary-script tools (`execute_script`, `risky_eval`) unless the user asks.

## Consequences

- Modelling works headless and in CI.
- Fine manual polishing happens in Blockbench, through `.bbmodel` round-trips.
- Live painting and Blockbench-native screenshots depend on a third-party bridge.
