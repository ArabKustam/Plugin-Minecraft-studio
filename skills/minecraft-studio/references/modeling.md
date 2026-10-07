# Modeling

```
Concept → Blockout → Primary forms → Secondary forms → Functional components → Rig planning → UV → Texture → Visual QA
```

## Decide before building

- **Target**: Java block/item model (static elements, no bones), display-entity rig (several item models moved by code), Bedrock/entity geometry (bones), or Blockbench project for manual polish.
- **Scale**: 16 units = 1 block. Java elements must stay within −16..32 and rotate on one axis in 22.5° steps.
- **Silhouette** from 3 views; **moving parts** and their **pivots**; **hierarchy** (root → body → parts); which parts animate later (keep them as separate bones / separate display models).
- **Cube budget**: as few as possible. Many tiny cubes look noisy at game scale and cost performance. Use texture detail instead of geometry detail below 1 px.

## Source format (`minecraft-studio-model/1`)

```json
{
  "format": "minecraft-studio-model/1",
  "name": "reactor_core",
  "texture_size": [32, 32],
  "textures": { "main": "resourcepack/assets/reactor/textures/item/core_off.png" },
  "texture_refs": { "main": "reactor:item/core_off" },
  "bones": [
    { "name": "base", "pivot": [8, 0, 8], "cubes": [
      { "name": "plinth", "from": [0, 0, 0], "to": [16, 3, 16], "box_uv": [0, 0] } ] },
    { "name": "rotor", "parent": "base", "pivot": [8, 8, 8], "cubes": [ … ] }
  ]
}
```

UVs are in texture pixels (`texture_size`); exporters convert to Java's 0–16 space. `box_uv: [u,v]` auto-lays out a cube (see `uv.md`); otherwise give per-face `{texture, uv:[u1,v1,u2,v2]}`.

## Loop

1. Write/modify the source (save it to `.minecraft-studio/sources/<asset>/…model.json` or pass inline).
2. `model_validate {target}` — fix every `fail`, consider every `warn`.
3. `model_render` → look at the turnaround (GUI iso, back iso, front, top). Check silhouette, proportions, floating/clipping parts, texture alignment, pivots (render with a test `pose` rotating the moving bones).
4. Revise; repeat until it reads well at GUI size.
5. `model_export {java?, bedrock?, bbmodel?, asset}` — the .bbmodel embeds textures and animations so the user can polish in Blockbench.
6. `visual-qa` review.

Existing Java models: `model_import_java` → edit source → export back.

## Blockbench integration (optional adapter)

Built-in exporters and the software renderer work without Blockbench. For live, interactive editing the user can connect a Blockbench MCP server:

- **sosadly/blockbench-mcp** (MIT): Blockbench plugin + stdio MCP bridge on `127.0.0.1:8787` — model, paint, rig, animate, screenshots, export.
- **jasonjgardner/blockbench-mcp-plugin** (GPL-3.0): HTTP MCP at `http://localhost:3000/bb-mcp` (`claude mcp add blockbench --transport http http://localhost:3000/bb-mcp`).

`studio_doctor` reports whether a bridge is reachable. When it is, you may use its tools for painting/screenshots; still save the final result as files, register them, and keep the studio source in sync (export from Blockbench, or re-import). Never run arbitrary script tools (`execute_script`, `risky_eval`) unless the user asks.

## Display-entity rigs (Paper)

Java block models cannot animate. For machines, split moving parts into separate item models (e.g. `core`, `rotor`, `lamp`), spawn `ItemDisplay` entities, and animate with `Transformation` + interpolation from code. Keep pivots at the model origin you rotate around (center the rotor at 8,8,8).
