// Style analysis & matching for resource packs.
//
// analyzeImage() extracts measurable pixel-art traits from one texture.
// buildStyleProfile() aggregates them over a pack (median + spread per metric,
// shared palette, resolutions) into style-profile.json.
// compareToProfile() scores a new texture against the profile and finds the
// closest existing textures so Visual QA can review them side by side.
import { readPng, palette as paletteOf, getPx, rgbToHsl, rgbToLab, deltaE, rgbaToHex } from './image.js';

const L = (c) => rgbToLab(c)[0];

function circularMeanHue(hsls) {
  let x = 0, y = 0, n = 0;
  for (const [h, s] of hsls) { if (s < 0.08) continue; x += Math.cos((h * Math.PI) / 180) * s; y += Math.sin((h * Math.PI) / 180) * s; n += s; }
  if (n === 0) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function hueDiff(a, b) {
  if (a == null || b == null) return null;
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const round = (v, d = 3) => (v == null ? null : Number(v.toFixed(d)));

/** Measure one image (first frame only for animated strips). */
export function analyzeImage(img) {
  const w = img.width;
  // animated textures are vertical strips of square frames: analyse the first frame only
  const h = img.height > img.width && img.height % img.width === 0 ? img.width : img.height;
  const px = [];
  const lum = new Float64Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = getPx(img, x, y);
    if (c[3] < 128) continue;
    const l = L(c);
    lum[y * w + x] = l;
    px.push({ x, y, c, l, hsl: rgbToHsl(c) });
  }
  const n = px.length;
  if (n === 0) return { empty: true, width: w, height: h };
  const pal = paletteOf({ width: w, height: h, data: img.data.subarray(0, w * h * 4) });
  const ls = px.map((p) => p.l).sort((a, b) => a - b);
  const dark = px.filter((p) => p.l <= quantile(ls, 0.2));
  const light = px.filter((p) => p.l >= quantile(ls, 0.8));
  const shadowHue = circularMeanHue(dark.map((p) => p.hsl));
  const highlightHue = circularMeanHue(light.map((p) => p.hsl));

  // neighbour statistics
  let diffSum = 0, diffN = 0, edgePx = 0, checker = 0, checkerN = 0;
  let gx = 0, gy = 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? NaN : lum[y * w + x]);
  const key = (x, y) => { const c = getPx(img, x, y); return c[3] < 128 ? -1 : (c[0] << 16) | (c[1] << 8) | c[2]; };
  for (const p of px) {
    const r = at(p.x + 1, p.y), d = at(p.x, p.y + 1);
    if (!Number.isNaN(r)) { diffSum += Math.abs(r - p.l); diffN++; }
    if (!Number.isNaN(d)) { diffSum += Math.abs(d - p.l); diffN++; }
    const k = key(p.x, p.y);
    const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => p.x + dx >= 0 && p.y + dy >= 0 && p.x + dx < w && p.y + dy < h);
    if (neigh.some(([dx, dy]) => key(p.x + dx, p.y + dy) !== k)) edgePx++;
    if (p.x > 0 && p.y > 0 && p.x < w - 1 && p.y < h - 1) {
      checkerN++;
      const orth = neigh.every(([dx, dy]) => key(p.x + dx, p.y + dy) !== k);
      const diag = [[1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dx, dy]) => key(p.x + dx, p.y + dy) === k);
      if (orth && diag) checker++;
    }
    const lx = at(p.x + 1, p.y) - at(p.x - 1, p.y);
    const ly = at(p.x, p.y + 1) - at(p.x, p.y - 1);
    if (!Number.isNaN(lx)) gx += lx;
    if (!Number.isNaN(ly)) gy += ly;
  }

  // perimeter vs interior (outline / edge treatment)
  const ring = px.filter((p) => p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => Number.isNaN(at(p.x + dx, p.y + dy))));
  const interior = px.filter((p) => !ring.includes(p));
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const ringL = mean(ring.map((p) => p.l));
  const intL = mean(interior.map((p) => p.l));

  // connected same-colour clusters (shape language: chunky vs fine)
  const seen = new Uint8Array(w * h);
  let clusters = 0;
  for (const p of px) {
    const idx = p.y * w + p.x;
    if (seen[idx]) continue;
    clusters++;
    const k = key(p.x, p.y);
    const stack = [[p.x, p.y]];
    seen[idx] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || key(nx, ny) !== k) continue;
        seen[ny * w + nx] = 1; stack.push([nx, ny]);
      }
    }
  }

  const sats = px.map((p) => p.hsl[1]);
  // lighting: positive y gradient means the image gets brighter downward; Minecraft convention is top-left light.
  const gmag = Math.hypot(gx, gy) || 1;
  return {
    width: w, height: h, opaque_ratio: round(n / (w * h)),
    colors: pal.length, colors_per_256px: round((pal.length / n) * 256, 2),
    luminance_mean: round(mean(ls), 2), contrast: round(quantile(ls, 0.95) - quantile(ls, 0.05), 2),
    saturation_mean: round(mean(sats)), saturation_p90: round(quantile(sats, 0.9)),
    shadow_hue: round(shadowHue, 1), highlight_hue: round(highlightHue, 1), hue_shift: round(hueDiff(shadowHue, highlightHue), 1),
    noise: round(diffSum / Math.max(1, diffN), 2),
    dithering: round(checkerN ? checker / checkerN : 0),
    detail_density: round(edgePx / n),
    mean_cluster_px: round(n / clusters, 2),
    outline_darkness: ringL != null && intL != null ? round(intL - ringL, 2) : null,
    lighting_dir: { x: round(-gx / gmag, 2), y: round(-gy / gmag, 2) },
    top_colors: pal.slice(0, 8).map((c) => c.hex),
  };
}

export const METRICS = ['colors_per_256px', 'luminance_mean', 'contrast', 'saturation_mean', 'noise', 'dithering', 'detail_density', 'mean_cluster_px', 'outline_darkness', 'hue_shift'];

function category(rel) {
  const m = rel.match(/textures\/(block|blocks|item|items|entity|gui|particle|painting|environment|misc)\//);
  if (!m) return 'other';
  return { blocks: 'block', items: 'item' }[m[1]] || m[1];
}

/** Merge near-identical colours into a compact shared palette (greedy deltaE clustering). */
function sharedPalette(colorCounts, maxColors = 48, threshold = 6) {
  const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [k, count] of sorted) {
    const rgb = [(k >> 16) & 255, (k >> 8) & 255, k & 255];
    const near = out.find((c) => deltaE(c.rgb, rgb) < threshold);
    if (near) near.count += count; else if (out.length < maxColors * 3) out.push({ rgb, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, maxColors).map((c) => ({ hex: rgbaToHex(c.rgb), weight: c.count }));
}

/**
 * Build a style profile from a list of absolute PNG paths.
 * @param {{abs:string, rel:string}[]} textures
 */
export function buildStyleProfile(textures, { name = 'default', source = null } = {}) {
  const samples = [];
  const colorCounts = new Map();
  const resolutions = {};
  for (const t of textures) {
    let img;
    try { img = readPng(t.abs); } catch { continue; }
    const m = analyzeImage(img);
    if (m.empty) continue;
    samples.push({ path: t.rel, category: category(t.rel), metrics: m });
    resolutions[`${m.width}x${m.height}`] = (resolutions[`${m.width}x${m.height}`] || 0) + 1;
    for (let i = 0; i < m.width * m.height * 4; i += 4) {
      if (img.data[i + 3] < 128) continue;
      const k = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
      colorCounts.set(k, (colorCounts.get(k) || 0) + 1);
    }
  }
  const summarize = (rows) => Object.fromEntries(METRICS.map((k) => {
    const vals = rows.map((s) => s.metrics[k]).filter((v) => v != null);
    return [k, { median: round(quantile(vals, 0.5)), p25: round(quantile(vals, 0.25)), p75: round(quantile(vals, 0.75)), min: round(quantile(vals, 0)), max: round(quantile(vals, 1)) }];
  }));
  const categories = {};
  for (const s of samples) (categories[s.category] ||= []).push(s);
  const lightX = quantile(samples.map((s) => s.metrics.lighting_dir.x), 0.5);
  const lightY = quantile(samples.map((s) => s.metrics.lighting_dir.y), 0.5);
  const dominantRes = Object.entries(resolutions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    name, source, generated_at: new Date().toISOString(), texture_count: samples.length,
    pixel_density: dominantRes, resolutions,
    palette: sharedPalette(colorCounts),
    lighting_direction: { x: round(lightX, 2), y: round(lightY, 2), description: describeLight(lightX, lightY) },
    metrics: summarize(samples),
    categories: Object.fromEntries(Object.entries(categories).map(([k, rows]) => [k, { count: rows.length, metrics: summarize(rows) }])),
    traits: describeTraits(summarize(samples)),
    samples: samples.map((s) => ({ path: s.path, category: s.category, metrics: s.metrics })),
  };
}

function describeLight(x, y) {
  if (x == null) return 'unknown';
  const v = y < -0.2 ? 'top' : y > 0.2 ? 'bottom' : '';
  const hz = x < -0.2 ? 'left' : x > 0.2 ? 'right' : '';
  return `${v}${v && hz ? '-' : ''}${hz}` || 'flat / ambient';
}

function describeTraits(m) {
  const t = [];
  const med = (k) => m[k]?.median;
  t.push(`${med('colors_per_256px') < 14 ? 'restrained' : med('colors_per_256px') < 28 ? 'moderate' : 'rich'} palette (~${med('colors_per_256px')} colours per 16×16)`);
  t.push(`${med('contrast') < 25 ? 'low' : med('contrast') < 45 ? 'medium' : 'high'} contrast (L* range ${med('contrast')})`);
  t.push(`${med('saturation_mean') < 0.2 ? 'muted' : med('saturation_mean') < 0.45 ? 'moderately saturated' : 'saturated'} colours`);
  t.push(`${med('noise') < 4 ? 'smooth' : med('noise') < 9 ? 'textured' : 'noisy'} material surfaces (noise ${med('noise')})`);
  t.push(med('dithering') > 0.04 ? 'uses checker dithering' : 'little or no dithering');
  if (med('hue_shift') != null) t.push(`highlights shift ${med('hue_shift') > 0 ? '+' : ''}${med('hue_shift')}° in hue from shadows`);
  if (med('outline_darkness') != null) t.push(med('outline_darkness') > 6 ? 'darker edge/outline treatment' : med('outline_darkness') < -6 ? 'lighter bevelled edges' : 'no distinct outline');
  t.push(`${med('mean_cluster_px') > 4 ? 'chunky' : 'fine-grained'} pixel clusters (mean ${med('mean_cluster_px')} px)`);
  return t;
}

/** Score a texture against a profile. Returns 0..100 plus per-metric findings and nearest references. */
export function compareToProfile(img, profile, { category: cat = null, nearest = 4 } = {}) {
  const m = analyzeImage(img);
  if (m.empty) return { score: 0, verdict: 'fail', findings: [{ metric: 'opacity', status: 'fail', detail: 'texture is fully transparent' }] };
  const useCat = cat && profile.categories?.[cat]?.count >= 3;
  const ref = useCat ? profile.categories[cat].metrics : profile.metrics;
  const sampleCount = useCat ? profile.categories[cat].count : profile.texture_count || 0;
  // Small packs give narrow, unreliable ranges: widen tolerance (√(12/n)) below 12 samples.
  const widen = sampleCount > 0 && sampleCount < 12 ? Math.sqrt(12 / sampleCount) : 1;
  const cutout = m.opaque_ratio < 0.95; // items/cut-outs: outlines are expected even if blocks have none
  const MIN_SPREAD = { hue_shift: 12, colors_per_256px: 2, contrast: 6, luminance_mean: 5, noise: 2 };
  const findings = [];
  let penalty = 0;
  for (const k of METRICS) {
    const r = ref[k];
    const v = m[k];
    if (!r || r.median == null || v == null) continue;
    if (k === 'outline_darkness' && cutout) { findings.push({ metric: k, value: v, expected: 'n/a for cut-out textures', status: 'info' }); continue; }
    const spread = Math.max((r.p75 - r.p25) || 0, Math.abs(r.median) * 0.15, MIN_SPREAD[k] ?? 0.5) * widen;
    const z = (v - r.median) / spread;
    const status = Math.abs(z) <= 1.5 ? 'ok' : Math.abs(z) <= 3 ? 'warn' : 'fail';
    penalty += status === 'ok' ? 0 : status === 'warn' ? 6 : 14;
    findings.push({ metric: k, value: v, expected: `${r.p25}…${r.p75} (median ${r.median})`, status, direction: z > 0 ? 'above' : 'below' });
  }
  // palette adherence
  const pal = (profile.palette || []).map((c) => c.hex);
  let adherence = null;
  if (pal.length) {
    const prgb = pal.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    let near = 0, total = 0;
    for (let i = 0; i < m.width * m.height * 4; i += 4) {
      if (img.data[i + 3] < 128) continue;
      total++;
      const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (prgb.some((p) => deltaE(p, c) < 10)) near++;
    }
    adherence = round(near / Math.max(1, total));
    const status = adherence >= 0.6 ? 'ok' : adherence >= 0.35 ? 'warn' : 'fail';
    penalty += status === 'ok' ? 0 : status === 'warn' ? 8 : 18;
    findings.push({ metric: 'palette_adherence', value: adherence, expected: '≥ 0.6 of pixels within ΔE 10 of the pack palette', status });
  }
  // resolution
  if (profile.pixel_density && `${m.width}x${m.height}` !== profile.pixel_density) {
    findings.push({ metric: 'resolution', value: `${m.width}x${m.height}`, expected: profile.pixel_density, status: 'warn' });
    penalty += 8;
  }
  const neighbours = (profile.samples || [])
    .filter((s) => !cat || s.category === cat || (profile.categories?.[cat]?.count ?? 0) < 3)
    .map((s) => ({ path: s.path, distance: round(featureDistance(m, s.metrics), 3) }))
    .sort((a, b) => a.distance - b.distance).slice(0, nearest);
  const score = Math.max(0, 100 - penalty);
  return { score, verdict: score >= 75 ? 'pass' : score >= 55 ? 'warn' : 'fail', metrics: m, findings, palette_adherence: adherence, nearest_references: neighbours, tolerance: { samples: sampleCount, widened_by: Number(widen.toFixed(2)) } };
}

function featureDistance(a, b) {
  const keys = ['colors_per_256px', 'luminance_mean', 'contrast', 'saturation_mean', 'noise', 'detail_density'];
  const scale = { colors_per_256px: 20, luminance_mean: 30, contrast: 30, saturation_mean: 0.3, noise: 8, detail_density: 0.5 };
  let d = 0;
  for (const k of keys) if (a[k] != null && b[k] != null) d += ((a[k] - b[k]) / scale[k]) ** 2;
  const hueA = a.top_colors?.[0], hueB = b.top_colors?.[0];
  if (hueA && hueB) d += (deltaE(hex3(hueA), hex3(hueB)) / 40) ** 2;
  return Math.sqrt(d);
}
const hex3 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export { category as textureCategory };
