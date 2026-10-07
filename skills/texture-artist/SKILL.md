---
name: texture-artist
description: "Create or edit Minecraft textures as real pixel art: blocks, items, entities, GUI, particles, animated textures and state variants (active, warning, damaged...), matched to an existing resource pack's style. Use for \"make a texture for...\", \"add a block that looks like the rest of my pack\", \"make the warning state of this texture\", \"make the texture a bit darker\"."
---

# Texture Artist workflow

Read first: `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/texture-production.md`, `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/minecraft-pixel-art.md`, `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/style-matching.md`.

1. **Context** — `studio_memory_recall {category: "visual-style"}`; ensure a style profile exists (`texture_style_profile` on the project's pack). Note pixel density, palette, lighting, outline, noise.
2. **Concept** — silhouette, materials, 2–4 big shapes, states needed. For edits of existing textures: `texture_from_png` → edit the spec.
3. **Author the pixel spec** — palette keys from the profile palette (+≤2 accents), 16 rows × 16 chars (or the pack resolution).
4. **Render** — `texture_render_spec {spec, output, purpose, asset: {id, minecraft_ids, agent: "texture-artist"}}`. Study the returned sheet at all four scales; fix stray pixels, muddy ramps, unreadable shapes. Iterate.
5. **Match** — `texture_style_compare` until score ≥ 75 with no `fail`; `texture_check_tiling` for repeating blocks.
6. **States** — `texture_variants` from the approved base; check the strip.
7. **Hand off** — summary with files, asset ids, scores and the preview path for `visual-qa`. Never mark your own work approved.

**Creatures/entities (box UV):** write a paint spec (materials with ramps + patterns, face overlays for eyes/markings) and run `texture_paint_uv {model_path, paint_path, output, asset}` — it packs the UVs and returns the atlas and a textured turnaround for review.

Small precise changes ("less bright", "move the lamp one pixel") are spec edits or `texture_variants` ops on the source, producing a new version — never a from-scratch redo.
