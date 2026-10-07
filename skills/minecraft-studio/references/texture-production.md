# Texture production

```
Concept → Style analysis → Pixel spec → Render → Palette pass → Minecraft validation → Visual QA → In-game preview
```

## 1. Concept

Write a short concept in the task: object, material, function, states, how it reads from 10 blocks away, what neighbours it sits next to. Decide the silhouette and 2–4 large shapes before any pixel.

## 2. Style

Always run `texture_style_profile` on the existing pack first (or confirm `.minecraft-studio/style-profile.json` exists). Read its `traits`, palette and lighting. See `style-matching.md`.

## 3. Author a pixel spec (the source of truth)

```json
{
  "size": [16, 16],
  "palette": { ".": "transparent", "o": "#2b2f36", "d": "#3e444d", "m": "#59616c", "l": "#7b8592", "h": "#a5afba", "g": "#3fd46a", "G": "#9cf5b3" },
  "rows": [
    "oooooooooooooooo",
    "ohhhhhhhhhhhhhlo",
    "…16 rows of 16 characters…"
  ]
}
```

- Name palette keys meaningfully (o=outline, d=dark, m=mid, l=light, h=highlight, accent letters).
- Build ramps: 3–5 values per material, hue-shifted (shadows cooler/more saturated, highlights warmer) unless the style profile says otherwise.
- Animated textures: `frames: [{rows}, …]`, `frametime` (ticks). Rendered as a vertical strip + `.mcmeta`.
- Editing an existing PNG: `texture_from_png` → edit rows → `texture_render_spec` (same output path; the registry versions it).
- High-res concepts (from an image provider or the user) → `texture_concept_reduce` gives a base grid; then **hand-clean it as a spec**. Never ship a plain downscale.

Render with `texture_render_spec {spec, output, purpose, asset:{id, minecraft_ids, agent}}`. It returns a review sheet image: 1600%, 800%, 3×3 tiling, 100% in-game size.

## 4. Palette pass

`texture_palette_pass` snaps stray colours to the pack palette. Use when style compare reports low palette adherence; then re-inspect (it can flatten intentional accents — keep accents in the explicit palette).

## 5. States & variants

Derive states from one base with `texture_variants` so they read as the same object:

| State | Typical ops |
|---|---|
| powered / active | `emissive` indicator colours → bright accent; slight `brightness` +0.03 |
| warning | `replace` accent → amber `#e8a020`; `emissive` lamps |
| critical / overheated | `replace` accent → red; `tint` `#ff3020` 0.12; optional `hue` on metal |
| damaged / broken | `damage` (seeded cracks), `saturation` 0.8, darker `brightness` −0.05 |
| charging | animated frames with moving accent band |
| inactive / off | `saturation` 0.6, accents → dark grey |

Check the returned strip image: silhouettes and material must stay identical; only the state language changes.

## 6. Validate

`texture_validate` (power-of-two, square/strip + mcmeta, palette size, isolated pixels), `texture_check_tiling` for blocks that repeat, `texture_style_compare` (score ≥ 75 to send to QA). Then hand to `visual-qa`.

## Entity & creature atlases

Mobs, NPCs and other box-UV models use `texture_paint_uv`. Drawing a 64×64 atlas character by character is impractical, so this tool does the layout and painting:

- It packs the box-UV islands automatically and writes the packed model back to the source.
- It paints every face from **materials**: a dark→light `ramp`, plus a `pattern` (`fur`, `shaggy`, `plates`, `feathers`, `stripes`, `scales`). It uses top-left Minecraft shading, with a darker bottom rim on side faces.
- It applies **hand-authored face overlays** for eyes, mouths and markings. Use the face-local pixel rows: `cubes.<cube>.faces.north.rows`.
- `face_materials` changes the material of a single face, e.g. a cream belly on a `down` face.

It returns the atlas at 4× plus a textured turnaround. Review both: do the eyes land on the front face, and does every material read at game scale? Keep the paint spec as the source (`art/paint/<id>.paint.json`). See `examples/creatures` for six worked examples: animals, monsters and an anthropomorphic NPC.

## 7. Integrate

Reference the texture from a model (`textures` map), validate the pack (`mc_resourcepack_validate`), and if possible look at it in-game (test server + client) or via `model_render`.
