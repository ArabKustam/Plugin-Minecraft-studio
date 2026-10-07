// Texture operations: validation, tiling check, palette pass, state variants,
// concept → pixel-art reduction and preview sheets for visual review.
import { StudioError } from '../core/fsutil.js';
import {
  createImage, getPx, setPx, scaleNearest, blit, crop, hexToRgba, rgbToHsl, hslToRgb, deltaE, palette as paletteOf,
  nearestColor, isPowerOfTwo, rgbToLab,
} from './image.js';

/** Minecraft-specific technical validation of a texture image. */
export function validateTexture(img, { expectedSize = null, animated = null, mcmeta = null, purpose = 'block' } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const { width: w, height: h } = img;
  add('power-of-two width', isPowerOfTwo(w) ? 'pass' : 'warn', `${w}px`);
  // vertical strips are animations only for block/item/particle textures; entity & GUI atlases are often non-square
  const isStrip = h > w && h % w === 0 && ['block', 'item', 'particle'].includes(purpose);
  if (isStrip) {
    add('animation strip', mcmeta ? 'pass' : 'fail', mcmeta ? `${h / w} frames with .mcmeta` : `${h / w} square frames but no .mcmeta file — Minecraft will show a squashed texture`);
  } else if (purpose === 'block' || purpose === 'item') {
    add('square', w === h ? 'pass' : 'warn', `${w}×${h}`);
  }
  if (animated && !isStrip) add('animation strip', 'fail', 'animated texture expected but image is not a vertical strip');
  if (expectedSize) add('resolution', w === expectedSize[0] && (isStrip ? w === expectedSize[1] : h === expectedSize[1]) ? 'pass' : 'fail', `expected ${expectedSize.join('×')}, got ${w}×${isStrip ? w : h}`);
  // semi-transparency on block textures renders oddly unless the model uses a translucent render type
  let semi = 0, transparent = 0;
  for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] === 0) transparent++; else if (img.data[i] < 255) semi++; }
  const total = w * h;
  if (purpose === 'block') {
    add('semi-transparent pixels', semi === 0 ? 'pass' : 'warn', `${semi} pixels with partial alpha (needs translucent render type)`);
    add('full coverage', transparent === 0 ? 'pass' : 'warn', `${transparent} fully transparent pixels (fine for cutout blocks such as glass/plants)`);
  }
  if (transparent === total) add('not empty', 'fail', 'image is fully transparent');
  const colors = paletteOf(img).length;
  const frameArea = isStrip ? w * w : total;
  if (frameArea <= 256) add('palette size', colors <= 24 ? 'pass' : colors <= 40 ? 'warn' : 'fail', `${colors} colours (16×16 pixel art usually uses ≤ 16–24)`);
  // isolated single pixels = noise
  const isolated = countIsolated(img, isStrip ? w : h);
  add('isolated pixels', isolated / frameArea < 0.06 ? 'pass' : isolated / frameArea < 0.12 ? 'warn' : 'fail', `${isolated} pixels differ from all 8 neighbours (random noise reads poorly at 16×16)`);
  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { verdict, width: w, height: h, frames: isStrip ? h / w : 1, colors, checks };
}

function countIsolated(img, frameH) {
  let n = 0;
  for (let y = 1; y < frameH - 1; y++) for (let x = 1; x < img.width - 1; x++) {
    const c = getPx(img, x, y);
    if (c[3] < 128) continue;
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (deltaE(getPx(img, x + dx, y + dy), c) < 3) same++;
    }
    if (same === 0) n++;
  }
  return n;
}

/** Seam analysis: compares colour jumps across the wrap edges with interior jumps. */
export function checkTiling(img) {
  const w = img.width, h = img.height > img.width && img.height % img.width === 0 ? img.width : img.height;
  const colDiff = (x1, x2) => { let s = 0; for (let y = 0; y < h; y++) s += deltaE(getPx(img, x1, y), getPx(img, x2, y)); return s / h; };
  const rowDiff = (y1, y2) => { let s = 0; for (let x = 0; x < w; x++) s += deltaE(getPx(img, x, y1), getPx(img, x, y2)); return s / w; };
  let interior = 0, n = 0;
  for (let x = 0; x < w - 1; x++) { interior += colDiff(x, x + 1); n++; }
  for (let y = 0; y < h - 1; y++) { interior += rowDiff(y, y + 1); n++; }
  interior /= Math.max(1, n);
  const hSeam = colDiff(w - 1, 0);
  const vSeam = rowDiff(h - 1, 0);
  const ratio = (v) => Number((v / Math.max(0.5, interior)).toFixed(2));
  const status = (r) => (r <= 1.6 ? 'pass' : r <= 2.5 ? 'warn' : 'fail');
  const hr = ratio(hSeam), vr = ratio(vSeam);
  return {
    verdict: [status(hr), status(vr)].includes('fail') ? 'fail' : [status(hr), status(vr)].includes('warn') ? 'warn' : 'pass',
    interior_mean_delta: Number(interior.toFixed(2)),
    horizontal_seam: { delta: Number(hSeam.toFixed(2)), ratio: hr, status: status(hr) },
    vertical_seam: { delta: Number(vSeam.toFixed(2)), ratio: vr, status: status(vr) },
    note: 'ratio = seam colour jump / average interior jump. ≤1.6 tiles invisibly; >2.5 shows a visible grid when placed in the world.',
  };
}

/** Map every opaque pixel to the nearest colour of a target palette (perceptual ΔE). */
export function quantizeToPalette(img, hexPalette) {
  if (!hexPalette?.length) throw new StudioError('E_PALETTE', 'Palette is empty');
  const pal = hexPalette.map((h) => hexToRgba(h).slice(0, 3));
  const out = createImage(img.width, img.height);
  const cache = new Map();
  let total = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = getPx(img, x, y);
    if (c[3] < 128) { setPx(out, x, y, [0, 0, 0, 0]); continue; }
    const k = (c[0] << 16) | (c[1] << 8) | c[2];
    let r = cache.get(k);
    if (!r) { r = nearestColor(c.slice(0, 3), pal); cache.set(k, r); }
    total += r.distance;
    setPx(out, x, y, [...r.color, 255]);
  }
  return { image: out, mean_shift: Number((total / (img.width * img.height)).toFixed(2)) };
}

/** Median-cut palette of N colours from an image. */
export function medianCut(img, n) {
  const pixels = [];
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] >= 128) pixels.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  if (!pixels.length) return [];
  let boxes = [pixels];
  while (boxes.length < n) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (box.length < 2) { boxes.push(box); break; }
    const ranges = [0, 1, 2].map((ch) => Math.max(...box.map((p) => p[ch])) - Math.min(...box.map((p) => p[ch])));
    const ch = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    const avg = [0, 1, 2].map((ch) => Math.round(b.reduce((s, p) => s + p[ch], 0) / b.length));
    return `#${avg.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
}

/**
 * Reduce a high-resolution concept to real pixel art: area-average into the
 * target grid, palette reduction, then despeckle isolated pixels. The result
 * is a starting point for hand cleanup, not a final texture.
 */
export function conceptToPixelArt(img, { size = [16, 16], colors = 12, palette = null, despeckle = true } = {}) {
  const [tw, th] = size;
  const small = createImage(tw, th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = Math.floor((tx * img.width) / tw), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * img.width) / tw));
    const y0 = Math.floor((ty * img.height) / th), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * img.height) / th));
    // use the dominant cluster (mode in Lab bins) rather than a muddy mean
    const bins = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = getPx(img, x, y);
      const lab = rgbToLab(c);
      const key = c[3] < 128 ? 'T' : `${Math.round(lab[0] / 6)},${Math.round(lab[1] / 8)},${Math.round(lab[2] / 8)}`;
      const b = bins.get(key) || { n: 0, sum: [0, 0, 0, 0] };
      b.n++; b.sum = b.sum.map((v, i) => v + c[i]);
      bins.set(key, b);
    }
    const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
    setPx(small, tx, ty, best.sum.map((v) => Math.round(v / best.n)));
  }
  const pal = palette || medianCut(small, colors);
  let { image } = quantizeToPalette(small, pal);
  if (despeckle) image = despeckleImage(image);
  return { image, palette: pal };
}

export function despeckleImage(img) {
  const out = { width: img.width, height: img.height, data: new Uint8Array(img.data) };
  for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) {
    const c = getPx(img, x, y);
    const counts = new Map();
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = getPx(img, x + dx, y + dy);
      if (n.join() === c.join()) same++;
      counts.set(n.join(), (counts.get(n.join()) || 0) + 1);
    }
    if (same === 0) {
      const [maj, cnt] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (cnt >= 5) setPx(out, x, y, maj.split(',').map(Number));
    }
  }
  return out;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

/**
 * Apply a list of operations to derive a state variant (active, warning, damaged…)
 * from a base texture so all states read as the same object.
 */
export function applyOps(img, ops) {
  let out = { width: img.width, height: img.height, data: new Uint8Array(img.data) };
  for (const op of ops) {
    switch (op.op) {
      case 'hue': case 'saturation': case 'brightness': {
        const mask = op.only ? op.only.map((h) => hexToRgba(h)) : null;
        mapPixels(out, (c) => {
          if (mask && !mask.some((m) => deltaE(m, c) < 4)) return c;
          const [h, s, l] = rgbToHsl(c);
          const next = op.op === 'hue' ? [h + op.degrees, s, l] : op.op === 'saturation' ? [h, clamp01(s * op.factor), l] : [h, s, clamp01(l + op.amount)];
          return [...hslToRgb(next), c[3]];
        });
        break;
      }
      case 'tint': {
        const t = hexToRgba(op.color);
        const k = op.strength ?? 0.3;
        mapPixels(out, (c) => [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k, c[3]].map(Math.round));
        break;
      }
      case 'replace': {
        const pairs = Object.entries(op.map || {}).map(([a, b]) => [hexToRgba(a), hexToRgba(b)]);
        mapPixels(out, (c) => { const p = pairs.find(([a]) => deltaE(a, c) < (op.tolerance ?? 2)); return p ? [...p[1].slice(0, 3), c[3]] : c; });
        break;
      }
      case 'emissive': {
        // brighten selected colours toward a glow colour (e.g. indicator lights)
        const targets = op.colors.map((h) => hexToRgba(h));
        const glow = hexToRgba(op.to);
        mapPixels(out, (c) => (targets.some((t) => deltaE(t, c) < (op.tolerance ?? 4)) ? [...glow.slice(0, 3), c[3]] : c));
        break;
      }
      case 'damage': {
        // deterministic cracks: random walks of a darker colour
        const rnd = seeded(op.seed ?? 7);
        const color = hexToRgba(op.color || '#1a1a1a');
        const cracks = op.cracks ?? 3;
        for (let k = 0; k < cracks; k++) {
          let x = Math.floor(rnd() * out.width), y = Math.floor(rnd() * out.height);
          const len = Math.floor((op.length ?? 0.5) * out.width);
          for (let i = 0; i < len; i++) {
            if (getPx(out, x, y)[3] >= 128) setPx(out, x, y, color);
            x += Math.round(rnd() * 2 - 1); y += rnd() < 0.6 ? 1 : 0;
            if (x < 0 || y < 0 || x >= out.width || y >= out.height) break;
          }
        }
        break;
      }
      case 'quantize':
        out = quantizeToPalette(out, op.palette).image;
        break;
      case 'flip':
        out = flip(out, op.axis || 'x');
        break;
      default:
        throw new StudioError('E_OP', `Unknown texture op ${op.op}. Supported: hue, saturation, brightness, tint, replace, emissive, damage, quantize, flip`);
    }
  }
  return out;
}

function flip(img, axis) {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) setPx(out, axis === 'x' ? img.width - 1 - x : x, axis === 'y' ? img.height - 1 - y : y, getPx(img, x, y));
  return out;
}

function mapPixels(img, fn) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = getPx(img, x, y);
    if (c[3] === 0) continue;
    setPx(img, x, y, fn(c).map((v) => Math.max(0, Math.min(255, Math.round(v)))));
  }
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function checker(w, h, size = 8) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, ((x / size | 0) + (y / size | 0)) % 2 ? [58, 58, 64, 255] : [44, 44, 50, 255]);
  return img;
}

/**
 * Review sheet for Visual QA. Layout (left → right): 1600% zoom, 800% zoom,
 * 3×3 tiling at 400%, 100% "in-game" size on a stone-grey field, then optional
 * reference textures at 800% for side-by-side style comparison.
 */
export function previewSheet(img, { references = [], tile = true } = {}) {
  const frame = img.height > img.width && img.height % img.width === 0 ? crop(img, 0, 0, img.width, img.width) : img;
  const w = frame.width, h = frame.height;
  const z16 = scaleNearest(frame, Math.max(1, Math.round(256 / w)));
  const z8 = scaleNearest(frame, Math.max(1, Math.round(128 / w)));
  const tiled = createImage(w * 3, h * 3);
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) blit(tiled, frame, tx * w, ty * h);
  const t4 = scaleNearest(tiled, Math.max(1, Math.round(64 / w)));
  const refs = references.map((r) => scaleNearest(r.height > r.width ? crop(r, 0, 0, r.width, r.width) : r, Math.max(1, Math.round(128 / r.width))));
  const gap = 16;
  const panels = [z16, z8, ...(tile ? [t4] : []), 'game', ...refs];
  const heights = panels.map((p) => (p === 'game' ? 64 : p.height));
  const widths = panels.map((p) => (p === 'game' ? 64 : p.width));
  const W = widths.reduce((a, b) => a + b, 0) + gap * (panels.length + 1);
  const H = Math.max(...heights) + gap * 2;
  const sheet = checker(W, H);
  let x = gap;
  panels.forEach((p) => {
    if (p === 'game') {
      const field = createImage(64, 64, [125, 125, 125, 255]);
      blit(field, frame, 32 - (w >> 1), 32 - (h >> 1));
      blit(sheet, field, x, gap);
      x += 64 + gap;
    } else {
      blit(sheet, p, x, gap);
      x += p.width + gap;
    }
  });
  return { image: sheet, layout: ['1600%', '800%', ...(tile ? ['3×3 tiling @400%'] : []), '100% in-game size', ...references.map((_, i) => `reference ${i + 1} @800%`)] };
}

/** Horizontal strip of state variants at 800% for consistency review. */
export function variantStrip(images) {
  const scaled = images.map((i) => scaleNearest(i.height > i.width ? crop(i, 0, 0, i.width, i.width) : i, Math.max(1, Math.round(128 / i.width))));
  const gap = 12;
  const W = scaled.reduce((a, s) => a + s.width, 0) + gap * (scaled.length + 1);
  const H = Math.max(...scaled.map((s) => s.height)) + gap * 2;
  const sheet = checker(W, H);
  let x = gap;
  for (const s of scaled) { blit(sheet, s, x, gap); x += s.width + gap; }
  return sheet;
}
