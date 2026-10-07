# Research: Blockbench integration (2026-10)

| Option | License | Activity | Transport | Notes |
|---|---|---|---|---|
| [sosadly/blockbench-mcp](https://github.com/sosadly/blockbench-mcp) | MIT | created 2026-05, last push 2026-09 | stdio MCP ↔ HTTP bridge on `127.0.0.1:8787` (`/ping`) | About 70 tools: project, cubes/groups/meshes, rig, `check_model`, textures/paint, animations/keyframes, `screenshot(_views)`, export, `execute_script` |
| [jasonjgardner/blockbench-mcp-plugin](https://github.com/jasonjgardner/blockbench-mcp-plugin) | GPL-3.0 | 487★, v1.10.0 (2026-10-01) | streamable HTTP at `localhost:3000/bb-mcp`; headless mode via `npx -y github:jasonjgardner/blockbench-mcp-plugin --root ./models` | Installed through *Load plugin from URL* |
| CyperNexus/blockbench-mcp | GPL-3.0 | uploaded in a single day, 0★ | — | Its README matches jasonjgardner's, so we treat it as an unofficial mirror |
| [JannisX11/blockbench](https://github.com/JannisX11/blockbench) | GPL-3.0 | v5.2.1 (2026-09) | — | `.bbmodel` sets `meta.format_version` to `"5.0"` (see `js/formats/bbmodel.js`) |

**Decision:** see [ADR 0004](../adr/0004-blockbench-integration.md). Minecraft Studio does not use either bridge internally. It writes `.bbmodel` 5.0 files directly and documents both bridges for live editing.
