// Image primitives: PNG IO and colour science used by every texture tool.
import fs from 'node:fs';
import path from 'node:path';
import pngjs from 'pngjs';
import { StudioError, ensureDir } from '../core/fsutil.js';

const { PNG } = pngjs;

/** @typedef {{width:number,height:number,data:Uint8Array}} Img  RGBA8 */

export function createImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

export function readPng(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { throw new StudioError('E_FILE', `Cannot read image ${file}`); }
  try {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length) };
  } catch (err) {
    throw new StudioError('E_PNG', `Invalid PNG ${file}: ${err.message}`);
  }
}

export function encodePng(img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  return PNG.sync.write(png, { colorType: 6 });
}

export function writePng(file, img) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, encodePng(img));
  return file;
}

export function getPx(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}
export function setPx(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = c[3] ?? 255;
}

export function crop(img, x0, y0, w, h) {
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(out, x, y, getPx(img, x0 + x, y0 + y));
  return out;
}

/** Nearest-neighbour upscale (pixel perfect, no blur). */
export function scaleNearest(img, factor) {
  const out = createImage(img.width * factor, img.height * factor);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) setPx(out, x, y, getPx(img, Math.floor(x / factor), Math.floor(y / factor)));
  return out;
}

export function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const c = getPx(src, x, y);
    if (c[3] === 0) continue;
    if (c[3] === 255) { setPx(dst, dx + x, dy + y, c); continue; }
    const b = getPx(dst, dx + x, dy + y);
    const a = c[3] / 255;
    setPx(dst, dx + x, dy + y, [c[0] * a + b[0] * (1 - a), c[1] * a + b[1] * (1 - a), c[2] * a + b[2] * (1 - a), Math.max(b[3], c[3])].map(Math.round));
  }
}

// ---------- colour ----------
export function hexToRgba(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) throw new StudioError('E_COLOR', `Invalid colour ${hex}`);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4, 6].map((i) => (i < full.length ? parseInt(full.slice(i, i + 2), 16) : 255));
}
export function rgbaToHex([r, g, b, a = 255]) {
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}${a < 255 ? hx(a) : ''}`;
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/** Relative luminance 0..1 (sRGB). */
export function luminance([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function rgbToLab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function deltaE(a, b) {
  const [l1, a1, b1] = rgbToLab(a), [l2, a2, b2] = rgbToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Unique opaque colours with counts, sorted by frequency. */
export function palette(img, { alphaThreshold = 128 } = {}) {
  const counts = new Map();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < alphaThreshold) continue;
    const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ rgb: [(k >> 16) & 255, (k >> 8) & 255, k & 255], count: n, hex: rgbaToHex([(k >> 16) & 255, (k >> 8) & 255, k & 255]) }));
}

export function nearestColor(rgb, pal) {
  let best = pal[0], bd = Infinity;
  for (const c of pal) { const d = deltaE(rgb, c); if (d < bd) { bd = d; best = c; } }
  return { color: best, distance: bd };
}

export function isPowerOfTwo(n) { return n > 0 && (n & (n - 1)) === 0; }
