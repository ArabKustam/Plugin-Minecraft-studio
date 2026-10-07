# Textures

Pipeline: **concept → style analysis → pixel spec → render → palette pass → Minecraft validation → visual QA → in-game preview**.

## Pixel specs

A pixel spec is the editable source of a texture ([schema](../schemas/pixel-spec.schema.json)). It contains:

- a palette of single-character keys mapped to colours
- rows of characters, one per pixel row
- optional `frames` for animated textures (rendered as a strip plus `.mcmeta`)
- optional `base` and `patches` for editing an existing PNG

`texture_from_png` converts any PNG into a spec.

The default texture provider is "no image generator" because 16×16 pixel art needs deliberate pixel placement. High-resolution concepts can be reduced with `texture_concept_reduce`, but the result must then be cleaned up by hand.

## Style profile

`texture_style_profile` measures each texture in the pack. These measurements are aggregated as p25/median/p75 per metric, and per category (block, item, …):

- palette size
- L* contrast
- saturation
- shadow→highlight hue shift
- outline darkness
- noise
- dithering
- detail density
- cluster size
- lighting direction

The profile also records a shared palette and readable `traits`.

`texture_style_compare` scores a texture from 0 to 100. For each metric it reports the deviation with its expected range, plus palette adherence and the nearest existing textures, and returns an image of the texture side by side with those references.

- With fewer than 12 samples, the tolerance widens by √(12/n).
- For cut-out textures such as items, outline darkness is informational only.

## Item shader

`texture_shade_item` ([schema](../schemas/item-spec.schema.json)) turns a part-labelled silhouette into a finished item. It adds:

- top-left light and rim shading;
- specular corners;
- material styles: metal, wood, leather, cloth, organic, glow, gem, bone, flat;
- coloured outlines;
- detail pixels;
- animation frames, with the matching `.mcmeta`.

See `examples/armory`, which has swords, tools, bows with draw stages, animated staffs, fruits and armour icons.

## Validation & variants

- `texture_validate`: power of two, square or strip with `.mcmeta`, expected resolution, semi-transparency, palette size, isolated-pixel noise.
- `texture_check_tiling`: seam colour jump ÷ interior jump. ≤ 1.6 is invisible; > 2.5 shows a visible grid.
- `texture_variants`: state variants derived from one base with the ops `hue`, `saturation`, `brightness`, `tint`, `replace`, `emissive`, `damage`, `quantize` and `flip`. Returns a strip for consistency review.
- `texture_preview`: review sheet at 1600%, 800%, 3×3 tiled and 100% in-game size, with optional references.

The demo's `style-match` example and its test show the whole flow.
