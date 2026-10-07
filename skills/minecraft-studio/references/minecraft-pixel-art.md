# Minecraft pixel art (16×16 and friends)

Quality at 16×16 is **not** detail count. It is:

- a readable silhouette and 2–4 large value shapes;
- an obvious material (metal, stone, wood, glass, cloth) read from value + edge treatment;
- a limited palette: typically 5–12 colours per texture, ramps of 3–5 values;
- deliberate contrast: the brightest/darkest values reserved for focal points (lamps, edges, rivets);
- every cluster of 2+ pixels meaning something; no random noise, no single "salt and pepper" pixels;
- compatibility with neighbouring vanilla/pack textures: similar value range, saturation, lighting.

## Rules of thumb

- **Light from the top-left** (vanilla convention): highlights on top/left edges, shadows bottom/right.
- **Outlines**: vanilla blocks have none (they tile); machines/items often use a darker frame. Follow the style profile `outline_darkness`.
- **Bevels**: 1-px light top/left + 1-px dark bottom/right reads as a raised panel.
- **Rivets/bolts**: 1 px highlight + 1 px shadow diagonal, at consistent spacing.
- **Lamps/indicators**: a 2×2 or 3×3 bright core with a 1-px darker rim; emissive variants change only these pixels.
- **Text/symbols**: avoid letters; use icons (⚠ triangle = 5×4 px shape).
- **Dithering**: only if the pack uses it (`dithering` metric). Never as noise.
- **Hue shift**: shadows lean toward blue/purple, highlights toward yellow, unless the pack is neutral.
- **Tiling textures**: no unique features near edges; check `texture_check_tiling` and the 3×3 sheet.
- **Item textures**: transparent background, 1-px dark outline usually, centred silhouette with 1 px margin.

## Review at four scales

`texture_render_spec` / `texture_preview` sheets show 1600%, 800%, tiled 400% and 100%. Judge:

1. 1600%: clusters intentional? stray pixels? consistent ramps?
2. 800%: shapes and lighting coherent?
3. Tiled: visible grid/seams? repeating eye-catchers?
4. 100%: does it read as the intended object at game scale? Is it too busy/noisy compared with references?

## Higher resolutions

32×32 / 64×64 allow secondary forms but keep the same principles; scale the palette modestly (8–20 colours). Do not mix resolutions within one pack unless the pack already does. Entity atlases follow the model UV layout (`uv.md`). GUI textures are 256×256 sheets with exact element coordinates — measure from existing GUI files.
