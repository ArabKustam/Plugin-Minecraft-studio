# UV mapping

## Per-face UV

`uv: [u1, v1, u2, v2]` in texture pixels. Face orientation (looking at the face from outside):

| Face | top-left corner of the UV rect maps to |
|---|---|
| north (−Z) | top, +X side |
| south (+Z) | top, −X side |
| east (+X) | top, +Z side |
| west (−X) | top, −Z side |
| up (+Y) | −Z (north) edge, −X side |
| down (−Y) | +Z (south) edge, −X side |

Swap u1/u2 to mirror. Rotate a face texture with `rotation: 90|180|270` on the face (Java).

## Box UV layout

`box_uv: [u, v]` with cube size (dx, dy, dz):

```
            u+dz      u+dz+dx    u+dz+2dx
 v      ┌───────────┬──────────┐
        │    up     │   down   │        (height dz)
 v+dz ┌─┴──┬────────┴─┬────────┼────┐
      │east│  north   │  west  │south│  (height dy)
      └────┴──────────┴────────┴─────┘
      u    u+dz       u+dz+dx  u+2dz+dx  u+2dz+2dx
```

Total footprint: width 2·(dx+dz), height dz+dy. Plan the atlas so no two cubes overlap unless they intentionally share pixels (mirrored parts may share).

## Texel density

Keep 1 texture pixel per model unit (16 px per block face) unless the pack does otherwise. Mixed density looks wrong next to vanilla blocks. A 16×16×16 cube with box UV needs a 64×32 texture.

## Checks

`model_validate` flags UVs outside the texture. In the turnaround render, look for stretched pixels (density mismatch), seams on adjacent faces, and textures upside-down on side faces.
