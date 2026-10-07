// studio-texture MCP server: pixel-art production, style analysis & matching,
// palette pass, state variants, tiling and Minecraft validation, previews.
import fs from 'node:fs';
import path from 'node:path';
import { createServer, tool, start, z, assetInput, registerOutput, requireOneOf } from './common.js';
import { renderSpecToFile, imageToSpec } from '../lib/texture/pixelart.js';
import { readPng, writePng } from '../lib/texture/image.js';
import { analyzeImage, buildStyleProfile, compareToProfile, textureCategory } from '../lib/texture/style.js';
import { validateTexture, checkTiling, quantizeToPalette, conceptToPixelArt, applyOps, previewSheet, variantStrip } from '../lib/texture/ops.js';
import { readJson, writeJson, walk, StudioError, slugify, exists } from '../lib/core/fsutil.js';

const server = createServer('studio-texture', 'Minecraft Studio texture pipeline. Author textures as pixel specs (palette + character grid) — not by downscaling. Build a style profile from the existing pack first, compare every new texture against it, review previews at 1600%/800%/100%/tiled, derive state variants from one base so they read as the same object.');

const previewPath = (studio, name) => studio.p('previews', `${slugify(name)}.png`);

function loadSpec(studio, a) {
  if (a.spec) return a.spec;
  return readJson(studio.abs(a.spec_path));
}

function profilePath(studio, name) {
  return name && name !== 'default' ? studio.p('styles', `${slugify(name)}.json`) : studio.p('style-profile.json');
}

tool(server, 'texture_render_spec', {
  title: 'Render pixel spec to PNG', capability: 'write',
  description: 'Render a pixel spec ({size, palette:{char:"#hex"|"transparent"}, rows:[...], frames?, frametime?, base?, patches?}) to a PNG (+ .mcmeta for animations). Saves the spec as reproducible source, validates, writes a review sheet (returned as image) and optionally registers the asset.',
  input: {
    spec: z.record(z.string(), z.any()).optional(), spec_path: z.string().optional().describe('Project-relative JSON spec file'),
    output: z.string().describe('Project-relative PNG path, e.g. resourcepack/assets/ns/textures/block/reactor.png'),
    purpose: z.enum(['block', 'item', 'entity', 'gui', 'particle', 'other']).optional(), asset: assetInput,
  },
}, async (a, { studio, root }) => {
  requireOneOf(a, ['spec', 'spec_path']);
  const spec = loadSpec(studio, a);
  const out = studio.abs(a.output);
  const r = renderSpecToFile(spec, out, { baseDir: root });
  const validation = validateTexture(r.image, { mcmeta: r.mcmeta, purpose: a.purpose || 'block' });
  const files = r.files.map((f) => studio.rel(f));
  let sourceRel = a.spec_path || null;
  if (a.asset && !a.spec_path) {
    const sf = studio.p('sources', a.asset.id, `${path.basename(a.output, '.png')}.pixelspec.json`);
    writeJson(sf, spec);
    sourceRel = studio.rel(sf);
  }
  const prev = previewSheet(r.image);
  const pp = previewPath(studio, a.asset?.id || a.output);
  writePng(pp, prev.image);
  const reg = registerOutput(studio, a.asset, { type: 'texture', files, source: { provider: 'pixel-spec', method: 'texture_render_spec', source_files: sourceRel ? [sourceRel] : [], parameters: { size: r.size, frames: r.frames.length } }, preview: studio.rel(pp), metadata: { width: r.size[0], height: r.size[1], frames: r.frames.length, palette: spec.palette } });
  return { files, validation, preview: { file: studio.rel(pp), layout: prev.layout }, asset: reg, _images: [pp] };
});

tool(server, 'texture_from_png', {
  title: 'PNG → pixel spec', capability: 'read',
  description: 'Convert an existing PNG into an editable pixel spec (palette + rows), e.g. to make a variant of an existing texture or adjust it precisely.',
  input: { path: z.string(), max_colors: z.number().int().optional() },
}, async (a, { studio }) => imageToSpec(readPng(studio.abs(a.path)), { maxColors: a.max_colors || 62 }));

tool(server, 'texture_analyze', {
  title: 'Analyze texture', capability: 'read',
  description: 'Pixel-art metrics: palette size, contrast, saturation, shadow/highlight hue shift, noise, dithering, detail density, cluster size, outline, lighting direction.',
  input: { path: z.string() },
}, async (a, { studio }) => analyzeImage(readPng(studio.abs(a.path))));

tool(server, 'texture_style_profile', {
  title: 'Build style profile from pack', capability: 'write',
  description: 'Analyse every texture in one or more resource-pack directories (or explicit files) and write a style profile (pixel density, shared palette, contrast, saturation, hue shift, outline, noise, dithering, lighting, detail density, per category). Default output: .minecraft-studio/style-profile.json.',
  input: { pack_dirs: z.array(z.string()).optional(), files: z.array(z.string()).optional(), name: z.string().optional(), include: z.string().optional().describe('Regex filter on texture paths, e.g. "textures/block/"') },
}, async (a, { studio }) => {
  requireOneOf(a, ['pack_dirs', 'files']);
  let textures = [];
  for (const d of a.pack_dirs || []) {
    const abs = studio.abs(d);
    textures.push(...walk(abs).filter((f) => /textures\/.+\.png$/.test(f)).map((f) => ({ abs: path.join(abs, f), rel: `${d.replace(/\/$/, '')}/${f}` })));
  }
  for (const f of a.files || []) textures.push({ abs: studio.abs(f), rel: f });
  if (a.include) { const re = new RegExp(a.include); textures = textures.filter((t) => re.test(t.rel)); }
  if (!textures.length) throw new StudioError('E_INPUT', 'No textures found');
  const profile = buildStyleProfile(textures, { name: a.name || 'default', source: a.pack_dirs || a.files });
  const out = profilePath(studio, a.name);
  writeJson(out, profile);
  if (studio.isInitialized()) {
    studio.log({ agent: 'style-analyst', event: 'style.profile', severity: 'success', message: `Style profile "${profile.name}" from ${profile.texture_count} textures: ${profile.traits.slice(0, 3).join('; ')}` });
    studio.remember({ category: 'visual-style', title: `Style profile "${profile.name}"`, content: `${profile.traits.join('; ')}. Pixel density ${profile.pixel_density}. Lighting ${profile.lighting_direction.description}.`, by: 'style-analyst' });
  }
  return { file: studio.rel(out), name: profile.name, texture_count: profile.texture_count, pixel_density: profile.pixel_density, palette: profile.palette.slice(0, 24).map((c) => c.hex), lighting: profile.lighting_direction, traits: profile.traits, metrics: profile.metrics, categories: Object.fromEntries(Object.entries(profile.categories).map(([k, v]) => [k, v.count])) };
});

tool(server, 'texture_style_compare', {
  title: 'Compare texture to style profile', capability: 'read',
  description: 'Score a texture (0-100) against the style profile, per-metric deviations, palette adherence and nearest existing textures. Returns a side-by-side image (new texture vs nearest references) for Visual QA.',
  input: { path: z.string(), profile: z.string().optional().describe('Profile name (default)'), category: z.string().optional() },
}, async (a, { studio }) => {
  const pf = profilePath(studio, a.profile);
  if (!exists(pf)) throw new StudioError('E_NOT_FOUND', 'No style profile yet — run texture_style_profile on the existing pack first');
  const profile = readJson(pf);
  const img = readPng(studio.abs(a.path));
  const res = compareToProfile(img, profile, { category: a.category || textureCategory(a.path) });
  const refs = [];
  for (const n of res.nearest_references || []) {
    for (const base of [studio.root, ...(Array.isArray(profile.source) ? profile.source.map((s) => studio.abs(s)) : [])]) {
      const cand = path.isAbsolute(n.path) ? n.path : path.join(base, n.path);
      if (fs.existsSync(cand)) { try { refs.push(readPng(cand)); } catch { /* skip */ } break; }
    }
  }
  const sheet = previewSheet(img, { references: refs, tile: false });
  const pp = previewPath(studio, `compare_${a.path}`);
  writePng(pp, sheet.image);
  return { ...res, metrics: undefined, preview: { file: studio.rel(pp), layout: sheet.layout }, _images: [pp] };
});

tool(server, 'texture_validate', {
  title: 'Validate texture for Minecraft', capability: 'read',
  description: 'Technical checks: power-of-two, square/animation strip + .mcmeta, expected resolution, semi-transparency, palette size, isolated-pixel noise.',
  input: { path: z.string(), expected_size: z.array(z.number().int()).length(2).optional(), purpose: z.enum(['block', 'item', 'entity', 'gui', 'particle', 'other']).optional() },
}, async (a, { studio }) => {
  const abs = studio.abs(a.path);
  const mcmeta = exists(`${abs}.mcmeta`) ? readJson(`${abs}.mcmeta`) : null;
  return validateTexture(readPng(abs), { expectedSize: a.expected_size, mcmeta, purpose: a.purpose || 'block' });
});

tool(server, 'texture_check_tiling', {
  title: 'Check seamless tiling', capability: 'read', description: 'Seam analysis across wrap edges plus a 3×3 tiled preview image.',
  input: { path: z.string() },
}, async (a, { studio }) => {
  const img = readPng(studio.abs(a.path));
  const r = checkTiling(img);
  const sheet = previewSheet(img);
  const pp = previewPath(studio, `tiling_${a.path}`);
  writePng(pp, sheet.image);
  return { ...r, preview: studio.rel(pp), _images: [pp] };
});

tool(server, 'texture_palette_pass', {
  title: 'Palette pass', capability: 'write',
  description: 'Snap every pixel to the nearest colour (ΔE) of the style-profile palette or an explicit palette. Writes to output (or in place).',
  input: { path: z.string(), output: z.string().optional(), palette: z.array(z.string()).optional(), profile: z.string().optional(), max_colors: z.number().int().optional().describe('Use only the N most common profile colours'), asset: assetInput },
}, async (a, { studio }) => {
  let pal = a.palette;
  if (!pal) {
    const pf = profilePath(studio, a.profile);
    if (!exists(pf)) throw new StudioError('E_NOT_FOUND', 'No palette given and no style profile found');
    pal = readJson(pf).palette.slice(0, a.max_colors || 32).map((c) => c.hex);
  }
  const r = quantizeToPalette(readPng(studio.abs(a.path)), pal);
  const out = a.output || a.path;
  writePng(studio.abs(out), r.image);
  const reg = registerOutput(studio, a.asset, { type: 'texture', files: [out], source: { provider: 'palette-pass', parameters: { palette: pal }, source_files: [a.path] } });
  return { output: out, mean_colour_shift: r.mean_shift, palette_size: pal.length, asset: reg };
});

tool(server, 'texture_variants', {
  title: 'Derive state variants', capability: 'write',
  description: 'Create consistent state variants (powered, active, warning, critical, damaged, overheated…) from one base texture with ops: hue, saturation, brightness, tint, replace (colour map), emissive (light colours → glow), damage (deterministic cracks), quantize, flip. Returns a comparison strip image.',
  input: {
    base: z.string(),
    variants: z.array(z.object({ name: z.string(), output: z.string(), ops: z.array(z.record(z.string(), z.any())), asset_id: z.string().optional(), minecraft_ids: z.array(z.string()).optional() })),
    agent: z.string().optional(),
  },
}, async (a, { studio }) => {
  const base = readPng(studio.abs(a.base));
  const images = [base];
  const results = [];
  for (const v of a.variants) {
    const img = applyOps(base, v.ops);
    writePng(studio.abs(v.output), img);
    images.push(img);
    let reg = null;
    if (v.asset_id) {
      const baseAsset = studio.listAssets().find((x) => x.files.some((f) => f.path === a.base));
      reg = registerOutput(studio, { id: v.asset_id, name: v.name, minecraft_ids: v.minecraft_ids, agent: a.agent || 'texture-artist', tags: ['variant', v.name], dependencies: baseAsset ? [baseAsset.id] : [] }, { type: 'texture', files: [v.output], source: { provider: 'variant-ops', source_files: [a.base], parameters: { ops: v.ops } } });
    }
    results.push({ name: v.name, output: v.output, validation: validateTexture(img).verdict, asset: reg });
  }
  const strip = variantStrip(images);
  const pp = previewPath(studio, `variants_${a.base}`);
  writePng(pp, strip);
  return { variants: results, strip: { file: studio.rel(pp), order: ['base', ...a.variants.map((v) => v.name)] }, _images: [pp] };
});

tool(server, 'texture_concept_reduce', {
  title: 'Concept → pixel art base', capability: 'write',
  description: 'Reduce a high-resolution concept image to a target grid using dominant-colour sampling, palette reduction (median-cut or style palette) and despeckle. Output is a STARTING POINT that must be cleaned up by hand (export to spec with texture_from_png, edit, re-render).',
  input: { path: z.string(), output: z.string(), size: z.array(z.number().int()).length(2).optional(), colors: z.number().int().optional(), use_profile_palette: z.boolean().optional() },
}, async (a, { studio }) => {
  const pal = a.use_profile_palette && exists(profilePath(studio)) ? readJson(profilePath(studio)).palette.slice(0, 32).map((c) => c.hex) : null;
  const r = conceptToPixelArt(readPng(studio.abs(a.path)), { size: a.size || [16, 16], colors: a.colors || 12, palette: pal });
  writePng(studio.abs(a.output), r.image);
  const pp = previewPath(studio, `concept_${a.output}`);
  writePng(pp, previewSheet(r.image).image);
  return { output: a.output, palette: r.palette, validation: validateTexture(r.image), preview: studio.rel(pp), _images: [pp] };
});

tool(server, 'texture_preview', {
  title: 'Texture review sheet', capability: 'read',
  description: 'Render a review sheet (1600%, 800%, 3×3 tiling, 100% in-game size, optional reference textures) and return it as an image for visual review.',
  input: { path: z.string(), references: z.array(z.string()).optional() },
}, async (a, { studio }) => {
  const sheet = previewSheet(readPng(studio.abs(a.path)), { references: (a.references || []).map((r) => readPng(studio.abs(r))) });
  const pp = previewPath(studio, `preview_${a.path}`);
  writePng(pp, sheet.image);
  return { preview: studio.rel(pp), layout: sheet.layout, _images: [pp] };
});

await start(server);
