// Pixel-art source format ("pixel spec") and renderer.
//
// A pixel spec is the reproducible source of a hand-authored texture: a named
// palette plus one character per pixel. Agents author textures as specs, the
// renderer turns them into PNGs, and the spec is stored as the asset source so
// later edits ("make it a little darker") modify the source, not the pixels.
//
// {
//   "size": [16, 16],
//   "palette": { ".": "transparent", "a": "#2b2f36", "b": "#4a515c" },
//   "rows": ["aaaa…", …],                     // height strings × width chars
//   "frames": [{ "rows": [...] }, …],          // optional: animated texture
//   "frametime": 2, "interpolate": false,      // animation .mcmeta settings
//   "base": "path/to/existing.png",            // optional: start from an existing PNG
//   "patches": [{ "x": 3, "y": 4, "rows": ["ab", "ba"] }]  // optional overlays
// }
import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../core/fsutil.js';
import { createImage, setPx, getPx, hexToRgba, readPng, writePng, blit } from './image.js';

function resolvePalette(pal) {
  if (!pal || typeof pal !== 'object') throw new StudioError('E_SPEC', 'Pixel spec needs a palette object');
  const out = {};
  for (const [k, v] of Object.entries(pal)) {
    if ([...k].length !== 1) throw new StudioError('E_SPEC', `Palette keys must be single characters, got "${k}"`);
    out[k] = v === 'transparent' || v === null ? [0, 0, 0, 0] : hexToRgba(v);
  }
  return out;
}

function paintRows(img, rows, pal, ox = 0, oy = 0, { strictSize = null } = {}) {
  if (!Array.isArray(rows)) throw new StudioError('E_SPEC', 'rows must be an array of strings');
  if (strictSize && rows.length !== strictSize[1]) throw new StudioError('E_SPEC', `Expected ${strictSize[1]} rows, got ${rows.length}`);
  rows.forEach((row, y) => {
    const chars = [...row];
    if (strictSize && chars.length !== strictSize[0]) throw new StudioError('E_SPEC', `Row ${y} has ${chars.length} pixels, expected ${strictSize[0]}`);
    chars.forEach((ch, x) => {
      if (ch === ' ' && !(ch in pal)) return; // spaces in patches = leave untouched
      const c = pal[ch];
      if (!c) throw new StudioError('E_SPEC', `Row ${y} col ${x}: character "${ch}" is not in the palette`);
      setPx(img, ox + x, oy + y, c);
    });
  });
}

/** Render a spec to { image, frames, mcmeta }. Animated specs become a vertical strip. */
export function renderSpec(spec, { baseDir = process.cwd() } = {}) {
  const pal = resolvePalette(spec.palette);
  const frameSpecs = spec.frames?.length ? spec.frames : [{ rows: spec.rows, patches: spec.patches }];
  let size = spec.size;
  let baseImg = null;
  if (spec.base) {
    baseImg = readPng(path.resolve(baseDir, spec.base));
    size ||= [baseImg.width, baseImg.height];
  }
  if (!size && spec.rows) size = [[...spec.rows[0]].length, spec.rows.length];
  if (!Array.isArray(size) || size.length !== 2) throw new StudioError('E_SPEC', 'size [w,h] is required');
  const [w, h] = size;
  if (w > 512 || h > 512) throw new StudioError('E_SPEC', 'Pixel specs are limited to 512×512 per frame');
  const frames = frameSpecs.map((fs_, i) => {
    const img = baseImg ? structuredCloneImg(baseImg) : createImage(w, h);
    if (fs_.rows) paintRows(img, fs_.rows, pal, 0, 0, { strictSize: baseImg ? null : [w, h] });
    for (const p of fs_.patches || spec.patches || []) {
      if (!Array.isArray(p.rows)) throw new StudioError('E_SPEC', `Frame ${i}: patch needs rows`);
      paintRows(img, p.rows, pal, p.x || 0, p.y || 0);
    }
    return img;
  });
  const strip = createImage(w, h * frames.length);
  frames.forEach((f, i) => blit(strip, f, 0, i * h));
  const mcmeta = frames.length > 1 ? { animation: { frametime: spec.frametime || 2, interpolate: !!spec.interpolate, ...(spec.frame_order ? { frames: spec.frame_order } : {}) } } : null;
  return { image: strip, frames, mcmeta, size: [w, h] };
}

function structuredCloneImg(img) {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

/** Render a spec and write PNG (+ .mcmeta for animations). Returns written files. */
export function renderSpecToFile(spec, outFile, opts = {}) {
  const r = renderSpec(spec, opts);
  writePng(outFile, r.image);
  const files = [outFile];
  if (r.mcmeta) {
    fs.writeFileSync(`${outFile}.mcmeta`, JSON.stringify(r.mcmeta, null, 2) + '\n');
    files.push(`${outFile}.mcmeta`);
  }
  return { ...r, files };
}

/** Convert an existing PNG back into a pixel spec (for editing existing textures). */
export function imageToSpec(img, { maxColors = 62 } = {}) {
  const keys = '.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!';
  const map = new Map();
  const palette = {};
  const rows = [];
  for (let y = 0; y < img.height; y++) {
    let row = '';
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = getPx(img, x, y);
      const key = a < 128 ? 'T' : `${r},${g},${b}`;
      if (!map.has(key)) {
        if (key === 'T') { map.set(key, '.'); palette['.'] = 'transparent'; }
        else {
          const ch = keys[map.size + (map.has('T') ? 0 : 1)];
          if (!ch || map.size >= maxColors) throw new StudioError('E_SPEC', `Image has more than ${maxColors} colours; quantize first`);
          map.set(key, ch);
          palette[ch] = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        }
      }
      row += map.get(key);
    }
    rows.push(row);
  }
  return { size: [img.width, img.height], palette, rows };
}
