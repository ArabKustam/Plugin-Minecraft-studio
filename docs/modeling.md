# Modeling & animation

## Pipeline

```
Concept → Blockout → Primary forms → Secondary forms → Functional parts → Rig planning → UV → Texture → Visual QA
```

Models are authored as **`minecraft-studio-model/1`** sources ([schema](../schemas/model.schema.json)). A source holds bones with pivots and parents, cubes with per-face UVs or `box_uv`, texture paths and resource locations. The `studio-model` server provides:

| Tool | Output |
|---|---|
| `model_validate` | structure, cube budget, micro-geometry, UV bounds, face coverage, pivots; Java limits (−16..32, single-axis 22.5° rotations, no bone rotation) |
| `model_render` | software-rendered turnaround (GUI iso, back iso, front, top), returned as an image; optional test pose |
| `model_export` | Java block/item model JSON, Bedrock geometry 1.12.0, Blockbench `.bbmodel` 5.0 (textures embedded, animations included) |
| `model_import_java` | an existing Java model converted to an editable source |
| `animation_validate` / `animation_render` / `animation_save` | Bedrock animation JSON 1.8.0: checks, contact sheets, registration |

The software renderer uses a z-buffer, nearest-neighbour texture sampling and Minecraft face shading (top 1.0, N/S 0.8, E/W 0.6). It is not the game renderer, but it gives agents a real image to judge silhouette, proportions, UV alignment and clipping.

## Blockbench {#blockbench}

Blockbench is an **optional adapter**. The built-in pipeline works without it, and every exported `.bbmodel` opens in Blockbench for manual polishing.

To let Claude drive a running Blockbench live, install one of these community MCP bridges yourself:

| Project | License | Transport | Setup |
|---|---|---|---|
| [sosadly/blockbench-mcp](https://github.com/sosadly/blockbench-mcp) | MIT | stdio server, plus a Blockbench plugin with an HTTP bridge on `127.0.0.1:8787` | `git clone`, `npm install && npm run build`, load `plugin/blockbench_mcp.js` in Blockbench, then add `node <path>/dist/index.js` as an MCP server |
| [jasonjgardner/blockbench-mcp-plugin](https://github.com/jasonjgardner/blockbench-mcp-plugin) | GPL-3.0 | Streamable HTTP `http://localhost:3000/bb-mcp` | Blockbench → *File → Plugins → Load from URL* `https://jasonjgardner.github.io/blockbench-mcp-plugin/mcp.js`, then `claude mcp add blockbench --transport http http://localhost:3000/bb-mcp` |

`studio_doctor` probes both ports. These bridges run as separate processes, and no code from them is included in Minecraft Studio. For the comparison and the reasons behind this choice, see [ADR 0004](adr/0004-blockbench-integration.md) and [research](research/blockbench-integration.md).

Keep the studio source as the source of truth. After editing in Blockbench, export and re-import, or register the new files as a new asset version, so that QA and the registry stay accurate.

## Paper display-entity rigs

Java block and item models can't animate. For server plugins, split moving parts into separate item models (each with an item definition in `assets/<ns>/items/`). Show them with `ItemDisplay` entities and animate them through `Transformation` interpolation. Author and review the motion on an assembly rig (see the Industrial Reactor's `reactor_rig`), then turn it into interpolation steps in code.
