# Style matching

Goal: a new texture a player cannot tell apart from the existing pack.

## Build the profile

`texture_style_profile {pack_dirs: ["resourcepack"], include?: "textures/(block|item)/"}` → `.minecraft-studio/style-profile.json` with:

| Field | Meaning |
|---|---|
| `pixel_density` | dominant resolution, e.g. `16x16` |
| `palette` | shared palette (ΔE-merged) weighted by usage |
| `metrics.contrast` | L* range p5–p95 per texture |
| `metrics.saturation_mean` | how colourful |
| `metrics.hue_shift` | highlight hue − shadow hue (degrees) |
| `metrics.outline_darkness` | interior L* − rim L* (positive = dark outlines) |
| `metrics.noise` | mean neighbour L* difference (material noise) |
| `metrics.dithering` | share of checkerboard pixels |
| `metrics.detail_density` | share of pixels on a colour edge |
| `metrics.mean_cluster_px` | chunky vs fine clusters |
| `metrics.colors_per_256px` | palette richness |
| `lighting_direction` | dominant light from gradients |
| `categories` | the same per `block`/`item`/`entity`/… |
| `traits` | human-readable summary — quote these in task constraints |

Each metric stores p25/median/p75, so "in style" means *inside the pack's usual range*, not equal to an average.

## Use it while authoring

- Start the spec palette from `profile.palette` (pick ramps from it; add at most 1–2 accent colours).
- Match contrast and noise: if the pack median noise is 4, a texture with noise 12 will look alien.
- Match the lighting direction and edge treatment.
- Look at the nearest references (`texture_style_compare` returns them and renders them side by side).

## Compare

`texture_style_compare {path}` → score 0–100, verdict, per-metric `ok|warn|fail` with expected ranges, palette adherence, nearest existing textures + comparison image. Revise until score ≥ 75 and no `fail`. Then Visual QA compares visually — metrics are evidence, not the final judge.

## Demo test

"Add a new block visually indistinguishable from the rest": profile the pack, author the block from the profile palette, compare, show the user the side-by-side sheet. Record the outcome in memory (`visual-style`).
