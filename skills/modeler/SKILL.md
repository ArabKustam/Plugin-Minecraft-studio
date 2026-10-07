---
name: modeler
description: "Build Minecraft 3D models: blocks, items, machines, mechanisms, decorations, mobs — with blockout, hierarchy, pivots, UVs and textures, exporting to Java block/item models, Bedrock geometry and Blockbench projects. Use for \"make a model for...\", \"the control panel needs a 3D model\", \"make the mob model\", \"fix the UV of this model\"."
---

# Modeler workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/modeling.md`, `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/uv.md`.

1. **Plan** — target runtime (Java static model / display-entity rig / Bedrock geometry), size in blocks, silhouette, moving parts, pivots, bone hierarchy, future animations, cube budget, texture size.
2. **Blockout** — a few cubes for primary forms; `model_render` and judge the silhouette from all views.
3. **Secondary forms & functional parts** — only where they read at game scale. Keep moving parts in their own bones with pivots on their rotation axis.
4. **UV & texture** — box UV or per-face UV at consistent texel density; coordinate with the texture artist (atlas size, regions). `model_validate` must have no `fail`.
5. **Review loop** — `model_render` (also with a test `pose` for moving bones) → fix clipping, floating parts, stretched texels → repeat.
6. **Export & register** — `model_export {java?, bedrock?, bbmodel, asset: {id, agent: "modeler"}}`; for Paper display rigs export each moving part as its own item model and create item definitions (`mc_item_definition`).
7. **Hand off** to `visual-qa` with the turnaround preview, bones/pivots summary and known limitations.

Optional live Blockbench editing via a Blockbench MCP server (see modeling.md). Keep the studio source as the source of truth.
