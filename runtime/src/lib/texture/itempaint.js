// Item shader: turns a part-labelled silhouette into finished Minecraft-style
// item pixel art. The artist draws the *shape* (which pixel belongs to the
// blade, edge, guard, grip, gem…); the shader applies consistent top-left
// lighting, rim light/shadow, specular corners, material treatments (metal
// shine, wood grain, cloth, organic, glowing gems) and coloured outlines.
// Hand-placed detail pixels go on top. Same spec → same pixels (reproducible).
//
// {
//   "size": [16, 16],
//   "materials": {
//     "steel": { "ramp": ["#2b3038", "#59616c", "#8e99a6", "#c9d1da", "#ffffff"], "style": "metal" },
//     "wood":  { "ramp": ["#3a240f", "#5c3a18", "#7d5224", "#9c6b32"], "style": "wood" }
//   },
//   "parts": { "b": "steel", "g": "wood" },
//   "rows": ["...............b", "…"],          // '.' = empty
//   "outline": "auto",                          // auto | none | "#hex"; a material may set "outline": false (e.g. bow strings)
//   "details": { "palette": { "w": "#ffffff" }, "rows": ["..w…"] },
//   "frames": [{ "rows": [...], "details": {...} }], "frametime": 2   // optional animation
// }
import { StudioError } from '../core/fsutil.js';
import { createImage, setPx, getPx, hexToRgba, blit } from './image.js';

const STYLES = ['metal', 'wood', 'cloth', 'organic', 'glow', 'leather', 'flat', 'gem', 'bone'];

function shadeFrame(spec, rows, details) {
  const [w, h] = spec.size || [16, 16];
  if (rows.length !== h || rows.some((r) => [...r].length !== w)) throw new StudioError('E_ITEM', `rows must be ${h} strings of ${w} characters`);
  const grid = rows.map((r) => [...r]);
  const partAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '.' : grid[y][x]);
  const mats = {};
  for (const [ch, name] of Object.entries(spec.parts || {})) {
    const m = spec.materials?.[name];
    if (!m) throw new StudioError('E_ITEM', `part "${ch}" uses unknown material "${name}"`);
    if (m.style && !STYLES.includes(m.style)) throw new StudioError('E_ITEM', `material ${name}: unknown style ${m.style} (${STYLES.join(', ')})`);
    mats[ch] = { name, ramp: m.ramp.map(hexToRgba), style: m.style || 'flat', outline: typeof m.outline === 'string' ? hexToRgba(m.outline) : null, noOutline: m.outline === false };
  }
  // part bounding boxes for gradients
  const bbox = {};
  grid.forEach((row, y) => row.forEach((ch, x) => {
    if (ch === '.') return;
    if (!mats[ch]) throw new StudioError('E_ITEM', `row ${y}: character "${ch}" has no part/material`);
    const b = bbox[ch] || (bbox[ch] = { x0: x, y0: y, x1: x, y1: y });
    b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
  }));
  const img = createImage(w, h, [0, 0, 0, 0]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = grid[y][x];
    if (ch === '.') continue;
    const m = mats[ch], n = m.ramp.length, b = bbox[ch];
    const out = (dx, dy) => partAt(x + dx, y + dy) !== ch;
    const U = out(0, -1), L = out(-1, 0), D = out(0, 1), R = out(1, 0);
    const base = Math.floor((n - 1) / 2);
    let idx;
    const t = ((x - b.x0) + (y - b.y0)) / Math.max(1, (b.x1 - b.x0) + (b.y1 - b.y0));
    switch (m.style) {
      case 'glow': case 'gem': {
        const cx = (b.x0 + b.x1) / 2 - 0.3, cy = (b.y0 + b.y1) / 2 - 0.3;
        const r = Math.max(1, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 0.5);
        idx = Math.round((n - 1) * (1 - Math.min(1, Math.hypot(x - cx, y - cy) / r)));
        if (m.style === 'gem' && U && L) idx = n - 1;
        if (m.style === 'gem' && D && R) idx = Math.max(0, idx - 1);
        break;
      }
      case 'organic': {
        const cx = b.x0 + (b.x1 - b.x0) * 0.32, cy = b.y0 + (b.y1 - b.y0) * 0.3;
        const r = Math.max(1, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * 0.75);
        idx = Math.round((n - 1) * (1 - Math.min(1, Math.hypot(x - cx, y - cy) / r)));
        if (D || R) idx = Math.max(0, Math.min(idx, base) - (D && R ? 1 : 0));
        break;
      }
      default: {
        const light = (U ? 1 : 0) + (L ? 1 : 0) - (D ? 1 : 0) - (R ? 1 : 0);
        idx = base + Math.max(-1, Math.min(1, light));
        if (!U && !L && !D && !R) idx = base + (t < 0.3 ? 1 : t > 0.72 ? -1 : 0);
        if (U && L && !D && !R && m.style !== 'cloth') idx = n - 1;
        if (m.style === 'metal' && !U && !L && !D && !R && Math.abs((x - b.x0) - (y - b.y0) * ((b.x1 - b.x0) / Math.max(1, b.y1 - b.y0))) < 0.6) idx = Math.min(n - 1, idx + 1); // shine streak
        if (m.style === 'wood' && !U && !D && ((x * 3 + y * 5) % 7 === 0)) idx = Math.max(0, idx - 1);
        if (m.style === 'leather' && ((x + y * 3) % 5 === 0)) idx = Math.max(0, idx - 1);
        if (m.style === 'bone' && D) idx = Math.max(0, idx - 1);
        if (m.style === 'cloth') idx = Math.max(0, Math.min(n - 2, idx));
      }
    }
    setPx(img, x, y, m.ramp[Math.max(0, Math.min(n - 1, idx))]);
  }
  // coloured outline around the silhouette
  if (spec.outline !== 'none') {
    const fixed = spec.outline && spec.outline !== 'auto' ? hexToRgba(spec.outline) : null;
    const outlinePx = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (grid[y][x] !== '.') continue;
      const n4 = [[0, -1], [-1, 0], [1, 0], [0, 1]].map(([dx, dy]) => partAt(x + dx, y + dy)).filter((c) => c !== '.' && !mats[c].noOutline);
      if (!n4.length) continue;
      const m = mats[n4[0]];
      const c = fixed || m.outline || m.ramp[0].map((v, i) => (i < 3 ? Math.round(v * 0.55) : 255));
      outlinePx.push([x, y, c]);
    }
    for (const [x, y, c] of outlinePx) setPx(img, x, y, c);
  }
  if (details?.rows) {
    const pal = Object.fromEntries(Object.entries(details.palette || {}).map(([k, v]) => [k, v === 'transparent' ? [0, 0, 0, 0] : hexToRgba(v)]));
    details.rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '.' || c === ' ') return;
      if (!pal[c]) throw new StudioError('E_ITEM', `details: "${c}" not in palette`);
      setPx(img, (details.x || 0) + x, (details.y || 0) + y, pal[c]);
    }));
  }
  return img;
}

/** Render an item spec → { image (strip if animated), frames, mcmeta }. */
export function shadeItem(spec) {
  const frameSpecs = spec.frames?.length ? spec.frames : [{ rows: spec.rows, details: spec.details }];
  const frames = frameSpecs.map((f) => shadeFrame(spec, f.rows || spec.rows, f.details ?? spec.details));
  const [w, h] = spec.size || [16, 16];
  const strip = createImage(w, h * frames.length);
  frames.forEach((f, i) => blit(strip, f, 0, i * h));
  const mcmeta = frames.length > 1 ? { animation: { frametime: spec.frametime || 2, interpolate: !!spec.interpolate } } : null;
  return { image: strip, frames, mcmeta };
}

/** Colour count & silhouette stats for QA. */
export function itemStats(img) {
  let filled = 0;
  const colors = new Set();
  for (let y = 0; y < Math.min(img.height, img.width); y++) for (let x = 0; x < img.width; x++) {
    const c = getPx(img, x, y);
    if (c[3] < 128) continue;
    filled++; colors.add(c.slice(0, 3).join());
  }
  return { filled_px: filled, coverage: Number((filled / (img.width * Math.min(img.height, img.width))).toFixed(3)), colors: colors.size };
}
