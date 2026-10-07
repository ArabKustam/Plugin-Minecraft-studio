# Style-match test

Goal (Minecraft Studio §71): *"Add a new block that is visually indistinguishable in style from the rest of the pack."*

- Existing pack: the six industrial textures in `../industrial-reactor/art/textures/existing/` (steel plate, grate, hazard stripes, vent, pipe, machine casing).
- `reinforced_hatch.pixelspec.json` — a new block authored by the Texture Artist from the style profile palette (steel ramps, top-left light, bevelled panel, hazard inset).
- `off_style_control.pixelspec.json` — a deliberately wrong control texture (saturated random noise).

`tests/integration/style-match.test.mjs` builds the style profile from the existing pack, renders both textures and asserts that the new block scores ≥ 75 while the control fails. Reproduce manually with `texture_style_profile` → `texture_render_spec` → `texture_style_compare`.
