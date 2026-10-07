import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  boxUvFaces,
  normalizeModel,
  renderTurnaround
} from "./chunks/chunk-G3FZ7JVB.mjs";
import {
  assetInput,
  createServer,
  external_exports,
  registerOutput,
  requireOneOf,
  start,
  tool
} from "./chunks/chunk-RWJTKMSS.mjs";
import {
  blit,
  createImage,
  crop,
  deltaE,
  getPx,
  hexToRgba,
  hslToRgb,
  isPowerOfTwo,
  nearestColor,
  palette,
  readPng,
  rgbToHsl,
  rgbToLab,
  rgbaToHex,
  scaleNearest,
  setPx,
  writePng
} from "./chunks/chunk-3P6ZCJ33.mjs";
import {
  StudioError,
  exists,
  readJson,
  slugify,
  walk,
  writeJson
} from "./chunks/chunk-5XAWRH4I.mjs";

// src/mcp/studio-texture.js
import fs2 from "node:fs";
import path2 from "node:path";

// src/lib/texture/pixelart.js
import fs from "node:fs";
import path from "node:path";
function resolvePalette(pal) {
  if (!pal || typeof pal !== "object") throw new StudioError("E_SPEC", "Pixel spec needs a palette object");
  const out = {};
  for (const [k, v] of Object.entries(pal)) {
    if ([...k].length !== 1) throw new StudioError("E_SPEC", `Palette keys must be single characters, got "${k}"`);
    out[k] = v === "transparent" || v === null ? [0, 0, 0, 0] : hexToRgba(v);
  }
  return out;
}
function paintRows(img, rows, pal, ox = 0, oy = 0, { strictSize = null } = {}) {
  if (!Array.isArray(rows)) throw new StudioError("E_SPEC", "rows must be an array of strings");
  if (strictSize && rows.length !== strictSize[1]) throw new StudioError("E_SPEC", `Expected ${strictSize[1]} rows, got ${rows.length}`);
  rows.forEach((row, y) => {
    const chars = [...row];
    if (strictSize && chars.length !== strictSize[0]) throw new StudioError("E_SPEC", `Row ${y} has ${chars.length} pixels, expected ${strictSize[0]}`);
    chars.forEach((ch, x) => {
      if (ch === " " && !(ch in pal)) return;
      const c = pal[ch];
      if (!c) throw new StudioError("E_SPEC", `Row ${y} col ${x}: character "${ch}" is not in the palette`);
      setPx(img, ox + x, oy + y, c);
    });
  });
}
function renderSpec(spec, { baseDir = process.cwd() } = {}) {
  const pal = resolvePalette(spec.palette);
  const frameSpecs = spec.frames?.length ? spec.frames : [{ rows: spec.rows, patches: spec.patches }];
  let size = spec.size;
  let baseImg = null;
  if (spec.base) {
    baseImg = readPng(path.resolve(baseDir, spec.base));
    size ||= [baseImg.width, baseImg.height];
  }
  if (!size && spec.rows) size = [[...spec.rows[0]].length, spec.rows.length];
  if (!Array.isArray(size) || size.length !== 2) throw new StudioError("E_SPEC", "size [w,h] is required");
  const [w, h] = size;
  if (w > 512 || h > 512) throw new StudioError("E_SPEC", "Pixel specs are limited to 512\xD7512 per frame");
  const frames = frameSpecs.map((fs_, i) => {
    const img = baseImg ? structuredCloneImg(baseImg) : createImage(w, h);
    if (fs_.rows) paintRows(img, fs_.rows, pal, 0, 0, { strictSize: baseImg ? null : [w, h] });
    for (const p of fs_.patches || spec.patches || []) {
      if (!Array.isArray(p.rows)) throw new StudioError("E_SPEC", `Frame ${i}: patch needs rows`);
      paintRows(img, p.rows, pal, p.x || 0, p.y || 0);
    }
    return img;
  });
  const strip = createImage(w, h * frames.length);
  frames.forEach((f, i) => blit(strip, f, 0, i * h));
  const mcmeta = frames.length > 1 ? { animation: { frametime: spec.frametime || 2, interpolate: !!spec.interpolate, ...spec.frame_order ? { frames: spec.frame_order } : {} } } : null;
  return { image: strip, frames, mcmeta, size: [w, h] };
}
function structuredCloneImg(img) {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}
function renderSpecToFile(spec, outFile, opts = {}) {
  const r = renderSpec(spec, opts);
  writePng(outFile, r.image);
  const files = [outFile];
  if (r.mcmeta) {
    fs.writeFileSync(`${outFile}.mcmeta`, JSON.stringify(r.mcmeta, null, 2) + "\n");
    files.push(`${outFile}.mcmeta`);
  }
  return { ...r, files };
}
function imageToSpec(img, { maxColors = 62 } = {}) {
  const keys = ".abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*+=?!";
  const map = /* @__PURE__ */ new Map();
  const palette2 = {};
  const rows = [];
  for (let y = 0; y < img.height; y++) {
    let row = "";
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = getPx(img, x, y);
      const key = a < 128 ? "T" : `${r},${g},${b}`;
      if (!map.has(key)) {
        if (key === "T") {
          map.set(key, ".");
          palette2["."] = "transparent";
        } else {
          const ch = keys[map.size + (map.has("T") ? 0 : 1)];
          if (!ch || map.size >= maxColors) throw new StudioError("E_SPEC", `Image has more than ${maxColors} colours; quantize first`);
          map.set(key, ch);
          palette2[ch] = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        }
      }
      row += map.get(key);
    }
    rows.push(row);
  }
  return { size: [img.width, img.height], palette: palette2, rows };
}

// src/lib/texture/style.js
var L = (c) => rgbToLab(c)[0];
function circularMeanHue(hsls) {
  let x = 0, y = 0, n = 0;
  for (const [h, s] of hsls) {
    if (s < 0.08) continue;
    x += Math.cos(h * Math.PI / 180) * s;
    y += Math.sin(h * Math.PI / 180) * s;
    n += s;
  }
  if (n === 0) return null;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function hueDiff(a, b) {
  if (a == null || b == null) return null;
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
var quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
var round = (v, d = 3) => v == null ? null : Number(v.toFixed(d));
function analyzeImage(img) {
  const w = img.width;
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
  const pal = palette({ width: w, height: h, data: img.data.subarray(0, w * h * 4) });
  const ls = px.map((p) => p.l).sort((a, b) => a - b);
  const dark = px.filter((p) => p.l <= quantile(ls, 0.2));
  const light = px.filter((p) => p.l >= quantile(ls, 0.8));
  const shadowHue = circularMeanHue(dark.map((p) => p.hsl));
  const highlightHue = circularMeanHue(light.map((p) => p.hsl));
  let diffSum = 0, diffN = 0, edgePx = 0, checker2 = 0, checkerN = 0;
  let gx = 0, gy = 0;
  const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? NaN : lum[y * w + x];
  const key = (x, y) => {
    const c = getPx(img, x, y);
    return c[3] < 128 ? -1 : c[0] << 16 | c[1] << 8 | c[2];
  };
  for (const p of px) {
    const r = at(p.x + 1, p.y), d = at(p.x, p.y + 1);
    if (!Number.isNaN(r)) {
      diffSum += Math.abs(r - p.l);
      diffN++;
    }
    if (!Number.isNaN(d)) {
      diffSum += Math.abs(d - p.l);
      diffN++;
    }
    const k = key(p.x, p.y);
    const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => p.x + dx >= 0 && p.y + dy >= 0 && p.x + dx < w && p.y + dy < h);
    if (neigh.some(([dx, dy]) => key(p.x + dx, p.y + dy) !== k)) edgePx++;
    if (p.x > 0 && p.y > 0 && p.x < w - 1 && p.y < h - 1) {
      checkerN++;
      const orth = neigh.every(([dx, dy]) => key(p.x + dx, p.y + dy) !== k);
      const diag = [[1, 1], [-1, -1], [1, -1], [-1, 1]].every(([dx, dy]) => key(p.x + dx, p.y + dy) === k);
      if (orth && diag) checker2++;
    }
    const lx = at(p.x + 1, p.y) - at(p.x - 1, p.y);
    const ly = at(p.x, p.y + 1) - at(p.x, p.y - 1);
    if (!Number.isNaN(lx)) gx += lx;
    if (!Number.isNaN(ly)) gy += ly;
  }
  const ring = px.filter((p) => p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => Number.isNaN(at(p.x + dx, p.y + dy))));
  const interior = px.filter((p) => !ring.includes(p));
  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const ringL = mean(ring.map((p) => p.l));
  const intL = mean(interior.map((p) => p.l));
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
        seen[ny * w + nx] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  const sats = px.map((p) => p.hsl[1]);
  const gmag = Math.hypot(gx, gy) || 1;
  return {
    width: w,
    height: h,
    opaque_ratio: round(n / (w * h)),
    colors: pal.length,
    colors_per_256px: round(pal.length / n * 256, 2),
    luminance_mean: round(mean(ls), 2),
    contrast: round(quantile(ls, 0.95) - quantile(ls, 0.05), 2),
    saturation_mean: round(mean(sats)),
    saturation_p90: round(quantile(sats, 0.9)),
    shadow_hue: round(shadowHue, 1),
    highlight_hue: round(highlightHue, 1),
    hue_shift: round(hueDiff(shadowHue, highlightHue), 1),
    noise: round(diffSum / Math.max(1, diffN), 2),
    dithering: round(checkerN ? checker2 / checkerN : 0),
    detail_density: round(edgePx / n),
    mean_cluster_px: round(n / clusters, 2),
    outline_darkness: ringL != null && intL != null ? round(intL - ringL, 2) : null,
    lighting_dir: { x: round(-gx / gmag, 2), y: round(-gy / gmag, 2) },
    top_colors: pal.slice(0, 8).map((c) => c.hex)
  };
}
var METRICS = ["colors_per_256px", "luminance_mean", "contrast", "saturation_mean", "noise", "dithering", "detail_density", "mean_cluster_px", "outline_darkness", "hue_shift"];
function category(rel) {
  const m = rel.match(/textures\/(block|blocks|item|items|entity|gui|particle|painting|environment|misc)\//);
  if (!m) return "other";
  return { blocks: "block", items: "item" }[m[1]] || m[1];
}
function sharedPalette(colorCounts, maxColors = 48, threshold = 6) {
  const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [k, count] of sorted) {
    const rgb = [k >> 16 & 255, k >> 8 & 255, k & 255];
    const near = out.find((c) => deltaE(c.rgb, rgb) < threshold);
    if (near) near.count += count;
    else if (out.length < maxColors * 3) out.push({ rgb, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, maxColors).map((c) => ({ hex: rgbaToHex(c.rgb), weight: c.count }));
}
function buildStyleProfile(textures, { name = "default", source = null } = {}) {
  const samples = [];
  const colorCounts = /* @__PURE__ */ new Map();
  const resolutions = {};
  for (const t of textures) {
    let img;
    try {
      img = readPng(t.abs);
    } catch {
      continue;
    }
    const m = analyzeImage(img);
    if (m.empty) continue;
    samples.push({ path: t.rel, category: category(t.rel), metrics: m });
    resolutions[`${m.width}x${m.height}`] = (resolutions[`${m.width}x${m.height}`] || 0) + 1;
    for (let i = 0; i < m.width * m.height * 4; i += 4) {
      if (img.data[i + 3] < 128) continue;
      const k = img.data[i] << 16 | img.data[i + 1] << 8 | img.data[i + 2];
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
    name,
    source,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    texture_count: samples.length,
    pixel_density: dominantRes,
    resolutions,
    palette: sharedPalette(colorCounts),
    lighting_direction: { x: round(lightX, 2), y: round(lightY, 2), description: describeLight(lightX, lightY) },
    metrics: summarize(samples),
    categories: Object.fromEntries(Object.entries(categories).map(([k, rows]) => [k, { count: rows.length, metrics: summarize(rows) }])),
    traits: describeTraits(summarize(samples)),
    samples: samples.map((s) => ({ path: s.path, category: s.category, metrics: s.metrics }))
  };
}
function describeLight(x, y) {
  if (x == null) return "unknown";
  const v = y < -0.2 ? "top" : y > 0.2 ? "bottom" : "";
  const hz = x < -0.2 ? "left" : x > 0.2 ? "right" : "";
  return `${v}${v && hz ? "-" : ""}${hz}` || "flat / ambient";
}
function describeTraits(m) {
  const t = [];
  const med = (k) => m[k]?.median;
  t.push(`${med("colors_per_256px") < 14 ? "restrained" : med("colors_per_256px") < 28 ? "moderate" : "rich"} palette (~${med("colors_per_256px")} colours per 16\xD716)`);
  t.push(`${med("contrast") < 25 ? "low" : med("contrast") < 45 ? "medium" : "high"} contrast (L* range ${med("contrast")})`);
  t.push(`${med("saturation_mean") < 0.2 ? "muted" : med("saturation_mean") < 0.45 ? "moderately saturated" : "saturated"} colours`);
  t.push(`${med("noise") < 4 ? "smooth" : med("noise") < 9 ? "textured" : "noisy"} material surfaces (noise ${med("noise")})`);
  t.push(med("dithering") > 0.04 ? "uses checker dithering" : "little or no dithering");
  if (med("hue_shift") != null) t.push(`highlights shift ${med("hue_shift") > 0 ? "+" : ""}${med("hue_shift")}\xB0 in hue from shadows`);
  if (med("outline_darkness") != null) t.push(med("outline_darkness") > 6 ? "darker edge/outline treatment" : med("outline_darkness") < -6 ? "lighter bevelled edges" : "no distinct outline");
  t.push(`${med("mean_cluster_px") > 4 ? "chunky" : "fine-grained"} pixel clusters (mean ${med("mean_cluster_px")} px)`);
  return t;
}
function compareToProfile(img, profile, { category: cat = null, nearest = 4 } = {}) {
  const m = analyzeImage(img);
  if (m.empty) return { score: 0, verdict: "fail", findings: [{ metric: "opacity", status: "fail", detail: "texture is fully transparent" }] };
  const useCat = cat && profile.categories?.[cat]?.count >= 3;
  const ref = useCat ? profile.categories[cat].metrics : profile.metrics;
  const sampleCount = useCat ? profile.categories[cat].count : profile.texture_count || 0;
  const widen = sampleCount > 0 && sampleCount < 12 ? Math.sqrt(12 / sampleCount) : 1;
  const cutout = m.opaque_ratio < 0.95;
  const MIN_SPREAD = { hue_shift: 12, colors_per_256px: 2, contrast: 6, luminance_mean: 5, noise: 2 };
  const findings = [];
  let penalty = 0;
  for (const k of METRICS) {
    const r = ref[k];
    const v = m[k];
    if (!r || r.median == null || v == null) continue;
    if (k === "outline_darkness" && cutout) {
      findings.push({ metric: k, value: v, expected: "n/a for cut-out textures", status: "info" });
      continue;
    }
    const spread = Math.max(r.p75 - r.p25 || 0, Math.abs(r.median) * 0.15, MIN_SPREAD[k] ?? 0.5) * widen;
    const z = (v - r.median) / spread;
    const status = Math.abs(z) <= 1.5 ? "ok" : Math.abs(z) <= 3 ? "warn" : "fail";
    penalty += status === "ok" ? 0 : status === "warn" ? 6 : 14;
    findings.push({ metric: k, value: v, expected: `${r.p25}\u2026${r.p75} (median ${r.median})`, status, direction: z > 0 ? "above" : "below" });
  }
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
    const status = adherence >= 0.6 ? "ok" : adherence >= 0.35 ? "warn" : "fail";
    penalty += status === "ok" ? 0 : status === "warn" ? 8 : 18;
    findings.push({ metric: "palette_adherence", value: adherence, expected: "\u2265 0.6 of pixels within \u0394E 10 of the pack palette", status });
  }
  if (profile.pixel_density && `${m.width}x${m.height}` !== profile.pixel_density) {
    findings.push({ metric: "resolution", value: `${m.width}x${m.height}`, expected: profile.pixel_density, status: "warn" });
    penalty += 8;
  }
  const neighbours = (profile.samples || []).filter((s) => !cat || s.category === cat || (profile.categories?.[cat]?.count ?? 0) < 3).map((s) => ({ path: s.path, distance: round(featureDistance(m, s.metrics), 3) })).sort((a, b) => a.distance - b.distance).slice(0, nearest);
  const score = Math.max(0, 100 - penalty);
  return { score, verdict: score >= 75 ? "pass" : score >= 55 ? "warn" : "fail", metrics: m, findings, palette_adherence: adherence, nearest_references: neighbours, tolerance: { samples: sampleCount, widened_by: Number(widen.toFixed(2)) } };
}
function featureDistance(a, b) {
  const keys = ["colors_per_256px", "luminance_mean", "contrast", "saturation_mean", "noise", "detail_density"];
  const scale = { colors_per_256px: 20, luminance_mean: 30, contrast: 30, saturation_mean: 0.3, noise: 8, detail_density: 0.5 };
  let d = 0;
  for (const k of keys) if (a[k] != null && b[k] != null) d += ((a[k] - b[k]) / scale[k]) ** 2;
  const hueA = a.top_colors?.[0], hueB = b.top_colors?.[0];
  if (hueA && hueB) d += (deltaE(hex3(hueA), hex3(hueB)) / 40) ** 2;
  return Math.sqrt(d);
}
var hex3 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// src/lib/texture/ops.js
function validateTexture(img, { expectedSize = null, animated = null, mcmeta = null, purpose = "block" } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const { width: w, height: h } = img;
  add("power-of-two width", isPowerOfTwo(w) ? "pass" : "warn", `${w}px`);
  const isStrip = h > w && h % w === 0;
  if (isStrip) {
    add("animation strip", mcmeta ? "pass" : "fail", mcmeta ? `${h / w} frames with .mcmeta` : `${h / w} square frames but no .mcmeta file \u2014 Minecraft will show a squashed texture`);
  } else if (purpose === "block" || purpose === "item") {
    add("square", w === h ? "pass" : "warn", `${w}\xD7${h}`);
  }
  if (animated && !isStrip) add("animation strip", "fail", "animated texture expected but image is not a vertical strip");
  if (expectedSize) add("resolution", w === expectedSize[0] && (isStrip ? w === expectedSize[1] : h === expectedSize[1]) ? "pass" : "fail", `expected ${expectedSize.join("\xD7")}, got ${w}\xD7${isStrip ? w : h}`);
  let semi = 0, transparent = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] === 0) transparent++;
    else if (img.data[i] < 255) semi++;
  }
  const total = w * h;
  if (purpose === "block") {
    add("semi-transparent pixels", semi === 0 ? "pass" : "warn", `${semi} pixels with partial alpha (needs translucent render type)`);
    add("full coverage", transparent === 0 ? "pass" : "warn", `${transparent} fully transparent pixels (fine for cutout blocks such as glass/plants)`);
  }
  if (transparent === total) add("not empty", "fail", "image is fully transparent");
  const colors = palette(img).length;
  const frameArea = isStrip ? w * w : total;
  if (frameArea <= 256) add("palette size", colors <= 24 ? "pass" : colors <= 40 ? "warn" : "fail", `${colors} colours (16\xD716 pixel art usually uses \u2264 16\u201324)`);
  const isolated = countIsolated(img, isStrip ? w : h);
  add("isolated pixels", isolated / frameArea < 0.06 ? "pass" : isolated / frameArea < 0.12 ? "warn" : "fail", `${isolated} pixels differ from all 8 neighbours (random noise reads poorly at 16\xD716)`);
  const verdict = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";
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
function checkTiling(img) {
  const w = img.width, h = img.height > img.width && img.height % img.width === 0 ? img.width : img.height;
  const colDiff = (x1, x2) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += deltaE(getPx(img, x1, y), getPx(img, x2, y));
    return s / h;
  };
  const rowDiff = (y1, y2) => {
    let s = 0;
    for (let x = 0; x < w; x++) s += deltaE(getPx(img, x, y1), getPx(img, x, y2));
    return s / w;
  };
  let interior = 0, n = 0;
  for (let x = 0; x < w - 1; x++) {
    interior += colDiff(x, x + 1);
    n++;
  }
  for (let y = 0; y < h - 1; y++) {
    interior += rowDiff(y, y + 1);
    n++;
  }
  interior /= Math.max(1, n);
  const hSeam = colDiff(w - 1, 0);
  const vSeam = rowDiff(h - 1, 0);
  const ratio = (v) => Number((v / Math.max(0.5, interior)).toFixed(2));
  const status = (r) => r <= 1.6 ? "pass" : r <= 2.5 ? "warn" : "fail";
  const hr = ratio(hSeam), vr = ratio(vSeam);
  return {
    verdict: [status(hr), status(vr)].includes("fail") ? "fail" : [status(hr), status(vr)].includes("warn") ? "warn" : "pass",
    interior_mean_delta: Number(interior.toFixed(2)),
    horizontal_seam: { delta: Number(hSeam.toFixed(2)), ratio: hr, status: status(hr) },
    vertical_seam: { delta: Number(vSeam.toFixed(2)), ratio: vr, status: status(vr) },
    note: "ratio = seam colour jump / average interior jump. \u22641.6 tiles invisibly; >2.5 shows a visible grid when placed in the world."
  };
}
function quantizeToPalette(img, hexPalette) {
  if (!hexPalette?.length) throw new StudioError("E_PALETTE", "Palette is empty");
  const pal = hexPalette.map((h) => hexToRgba(h).slice(0, 3));
  const out = createImage(img.width, img.height);
  const cache = /* @__PURE__ */ new Map();
  let total = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = getPx(img, x, y);
    if (c[3] < 128) {
      setPx(out, x, y, [0, 0, 0, 0]);
      continue;
    }
    const k = c[0] << 16 | c[1] << 8 | c[2];
    let r = cache.get(k);
    if (!r) {
      r = nearestColor(c.slice(0, 3), pal);
      cache.set(k, r);
    }
    total += r.distance;
    setPx(out, x, y, [...r.color, 255]);
  }
  return { image: out, mean_shift: Number((total / (img.width * img.height)).toFixed(2)) };
}
function medianCut(img, n) {
  const pixels = [];
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] >= 128) pixels.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  if (!pixels.length) return [];
  let boxes = [pixels];
  while (boxes.length < n) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (box.length < 2) {
      boxes.push(box);
      break;
    }
    const ranges = [0, 1, 2].map((ch2) => Math.max(...box.map((p) => p[ch2])) - Math.min(...box.map((p) => p[ch2])));
    const ch = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    const avg = [0, 1, 2].map((ch) => Math.round(b.reduce((s, p) => s + p[ch], 0) / b.length));
    return `#${avg.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  });
}
function conceptToPixelArt(img, { size = [16, 16], colors = 12, palette: palette2 = null, despeckle = true } = {}) {
  const [tw, th] = size;
  const small = createImage(tw, th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = Math.floor(tx * img.width / tw), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * img.width / tw));
    const y0 = Math.floor(ty * img.height / th), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * img.height / th));
    const bins = /* @__PURE__ */ new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = getPx(img, x, y);
      const lab = rgbToLab(c);
      const key = c[3] < 128 ? "T" : `${Math.round(lab[0] / 6)},${Math.round(lab[1] / 8)},${Math.round(lab[2] / 8)}`;
      const b = bins.get(key) || { n: 0, sum: [0, 0, 0, 0] };
      b.n++;
      b.sum = b.sum.map((v, i) => v + c[i]);
      bins.set(key, b);
    }
    const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
    setPx(small, tx, ty, best.sum.map((v) => Math.round(v / best.n)));
  }
  const pal = palette2 || medianCut(small, colors);
  let { image } = quantizeToPalette(small, pal);
  if (despeckle) image = despeckleImage(image);
  return { image, palette: pal };
}
function despeckleImage(img) {
  const out = { width: img.width, height: img.height, data: new Uint8Array(img.data) };
  for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) {
    const c = getPx(img, x, y);
    const counts = /* @__PURE__ */ new Map();
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = getPx(img, x + dx, y + dy);
      if (n.join() === c.join()) same++;
      counts.set(n.join(), (counts.get(n.join()) || 0) + 1);
    }
    if (same === 0) {
      const [maj, cnt] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (cnt >= 5) setPx(out, x, y, maj.split(",").map(Number));
    }
  }
  return out;
}
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % 1e5 / 1e5;
  };
}
function applyOps(img, ops) {
  let out = { width: img.width, height: img.height, data: new Uint8Array(img.data) };
  for (const op of ops) {
    switch (op.op) {
      case "hue":
      case "saturation":
      case "brightness": {
        const mask = op.only ? op.only.map((h) => hexToRgba(h)) : null;
        mapPixels(out, (c) => {
          if (mask && !mask.some((m) => deltaE(m, c) < 4)) return c;
          const [h, s, l] = rgbToHsl(c);
          const next = op.op === "hue" ? [h + op.degrees, s, l] : op.op === "saturation" ? [h, clamp01(s * op.factor), l] : [h, s, clamp01(l + op.amount)];
          return [...hslToRgb(next), c[3]];
        });
        break;
      }
      case "tint": {
        const t = hexToRgba(op.color);
        const k = op.strength ?? 0.3;
        mapPixels(out, (c) => [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k, c[3]].map(Math.round));
        break;
      }
      case "replace": {
        const pairs = Object.entries(op.map || {}).map(([a, b]) => [hexToRgba(a), hexToRgba(b)]);
        mapPixels(out, (c) => {
          const p = pairs.find(([a]) => deltaE(a, c) < (op.tolerance ?? 2));
          return p ? [...p[1].slice(0, 3), c[3]] : c;
        });
        break;
      }
      case "emissive": {
        const targets = op.colors.map((h) => hexToRgba(h));
        const glow = hexToRgba(op.to);
        mapPixels(out, (c) => targets.some((t) => deltaE(t, c) < (op.tolerance ?? 4)) ? [...glow.slice(0, 3), c[3]] : c);
        break;
      }
      case "damage": {
        const rnd = seeded(op.seed ?? 7);
        const color = hexToRgba(op.color || "#1a1a1a");
        const cracks = op.cracks ?? 3;
        for (let k = 0; k < cracks; k++) {
          let x = Math.floor(rnd() * out.width), y = Math.floor(rnd() * out.height);
          const len = Math.floor((op.length ?? 0.5) * out.width);
          for (let i = 0; i < len; i++) {
            if (getPx(out, x, y)[3] >= 128) setPx(out, x, y, color);
            x += Math.round(rnd() * 2 - 1);
            y += rnd() < 0.6 ? 1 : 0;
            if (x < 0 || y < 0 || x >= out.width || y >= out.height) break;
          }
        }
        break;
      }
      case "quantize":
        out = quantizeToPalette(out, op.palette).image;
        break;
      case "flip":
        out = flip(out, op.axis || "x");
        break;
      default:
        throw new StudioError("E_OP", `Unknown texture op ${op.op}. Supported: hue, saturation, brightness, tint, replace, emissive, damage, quantize, flip`);
    }
  }
  return out;
}
function flip(img, axis) {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) setPx(out, axis === "x" ? img.width - 1 - x : x, axis === "y" ? img.height - 1 - y : y, getPx(img, x, y));
  return out;
}
function mapPixels(img, fn) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = getPx(img, x, y);
    if (c[3] === 0) continue;
    setPx(img, x, y, fn(c).map((v) => Math.max(0, Math.min(255, Math.round(v)))));
  }
}
var clamp01 = (v) => Math.max(0, Math.min(1, v));
function checker(w, h, size = 8) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, ((x / size | 0) + (y / size | 0)) % 2 ? [58, 58, 64, 255] : [44, 44, 50, 255]);
  return img;
}
function previewSheet(img, { references = [], tile = true } = {}) {
  const frame = img.height > img.width && img.height % img.width === 0 ? crop(img, 0, 0, img.width, img.width) : img;
  const w = frame.width, h = frame.height;
  const z16 = scaleNearest(frame, Math.max(1, Math.round(256 / w)));
  const z8 = scaleNearest(frame, Math.max(1, Math.round(128 / w)));
  const tiled = createImage(w * 3, h * 3);
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) blit(tiled, frame, tx * w, ty * h);
  const t4 = scaleNearest(tiled, Math.max(1, Math.round(64 / w)));
  const refs = references.map((r) => scaleNearest(r.height > r.width ? crop(r, 0, 0, r.width, r.width) : r, Math.max(1, Math.round(128 / r.width))));
  const gap = 16;
  const panels = [z16, z8, ...tile ? [t4] : [], "game", ...refs];
  const heights = panels.map((p) => p === "game" ? 64 : p.height);
  const widths = panels.map((p) => p === "game" ? 64 : p.width);
  const W = widths.reduce((a, b) => a + b, 0) + gap * (panels.length + 1);
  const H = Math.max(...heights) + gap * 2;
  const sheet = checker(W, H);
  let x = gap;
  panels.forEach((p) => {
    if (p === "game") {
      const field = createImage(64, 64, [125, 125, 125, 255]);
      blit(field, frame, 32 - (w >> 1), 32 - (h >> 1));
      blit(sheet, field, x, gap);
      x += 64 + gap;
    } else {
      blit(sheet, p, x, gap);
      x += p.width + gap;
    }
  });
  return { image: sheet, layout: ["1600%", "800%", ...tile ? ["3\xD73 tiling @400%"] : [], "100% in-game size", ...references.map((_, i) => `reference ${i + 1} @800%`)] };
}
function variantStrip(images) {
  const scaled = images.map((i) => scaleNearest(i.height > i.width ? crop(i, 0, 0, i.width, i.width) : i, Math.max(1, Math.round(128 / i.width))));
  const gap = 12;
  const W = scaled.reduce((a, s) => a + s.width, 0) + gap * (scaled.length + 1);
  const H = Math.max(...scaled.map((s) => s.height)) + gap * 2;
  const sheet = checker(W, H);
  let x = gap;
  for (const s of scaled) {
    blit(sheet, s, x, gap);
    x += s.width + gap;
  }
  return sheet;
}

// src/lib/texture/uvpaint.js
var ceilDims = (c) => c.size.map((s) => Math.max(1, Math.ceil(Math.abs(s) - 1e-6)));
var isPow2 = (n) => (n & n - 1) === 0;
function packBoxUv(src, { textureSize = null, padding = 0 } = {}) {
  const model = structuredClone(src);
  const items = [];
  for (const b of model.bones) for (const c of b.cubes || []) {
    const [dx, dy, dz] = ceilDims({ size: c.to.map((t, i) => t - c.from[i]) });
    items.push({ c, w: 2 * (dx + dz) + padding, h: dz + dy + padding });
  }
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  let [tw, th] = textureSize || [64, 64];
  for (let attempt = 0; attempt < 6; attempt++) {
    let x = 0, y = 0, rowH = 0, ok = true;
    const placed = [];
    for (const it of items) {
      if (it.w > tw) {
        ok = false;
        break;
      }
      if (x + it.w > tw) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + it.h > th) {
        ok = false;
        break;
      }
      placed.push([it, x, y]);
      x += it.w;
      rowH = Math.max(rowH, it.h);
    }
    if (ok) {
      for (const [it, px, py] of placed) {
        it.c.box_uv = [px, py];
        delete it.c.faces;
      }
      model.texture_size = [tw, th];
      return model;
    }
    if (th <= tw) th *= 2;
    else tw *= 2;
  }
  throw new StudioError("E_UV", "Could not pack box UVs into a texture up to 4096 px");
}
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
function shadeIndex(face, fx, fy, fw, fh, n) {
  const top = n - 1;
  let i;
  switch (face) {
    case "up":
      i = top;
      break;
    case "down":
      i = 0;
      break;
    case "north":
    case "south":
      i = top - 1 - (fh > 3 && fy >= Math.ceil(fh * 0.66) ? 1 : 0);
      break;
    case "west":
      i = top - 1 - (fh > 3 && fy >= Math.ceil(fh * 0.6) ? 1 : 0);
      break;
    case "east":
      i = top - 2 + (fh > 3 && fy < Math.floor(fh * 0.25) ? 1 : 0);
      break;
    default:
      i = 1;
  }
  if (["north", "south", "east", "west"].includes(face) && fy === fh - 1 && fh > 2) i -= 1;
  return Math.max(0, Math.min(top, i));
}
function patternShift(p, face, fx, fy, fw, fh, r) {
  if (!p || p.type === "none") return 0;
  const d = p.density ?? 0.2;
  switch (p.type) {
    case "fur":
      return r() < d ? r() < 0.6 ? -1 : 1 : 0;
    case "shaggy": {
      const strand = (fx * 2654435761 >>> 0) % 5;
      return face === "up" ? r() < d ? -1 : 0 : strand === 0 ? -1 : strand === 1 && fy % 3 === 0 ? 1 : 0;
    }
    case "plates": {
      const s = p.size ?? 4;
      return fx % s === s - 1 || fy % s === s - 1 ? -1 : fx % s === 0 && fy % s === 0 ? 1 : 0;
    }
    case "feathers": {
      const s = p.size ?? 3;
      return fy % s === s - 1 && (fx + Math.floor(fy / s)) % 2 === 0 ? -1 : fy % s === 0 && r() < d ? 1 : 0;
    }
    case "stripes": {
      const s = p.size ?? 3;
      const v = p.vertical ? fx : fy;
      return Math.floor(v / s) % 2 === 1 ? -1 : 0;
    }
    case "scales": {
      const s = p.size ?? 2;
      return (fx + Math.floor(fy / s) % 2 * s) % (s * 2) === 0 ? -1 : 0;
    }
    default:
      throw new StudioError("E_PAINT", `Unknown pattern ${p.type}`);
  }
}
function faceRects(c) {
  const dims = ceilDims(c);
  const faces = boxUvFaces(c.box_uv[0], c.box_uv[1], dims, "t");
  return Object.fromEntries(Object.entries(faces).map(([f, d]) => {
    const [u1, v1, u2, v2] = d.uv;
    return [f, { x: Math.min(u1, u2), y: Math.min(v1, v2), w: Math.abs(u2 - u1), h: Math.abs(v2 - v1) }];
  }));
}
function paintAtlas(src, paint) {
  const model = normalizeModel(src);
  const [tw, th] = paint.texture_size || model.texture_size;
  if (!isPow2(tw) || !isPow2(th)) throw new StudioError("E_PAINT", "texture_size must be powers of two");
  const img = createImage(tw, th, [0, 0, 0, 0]);
  const mats = paint.materials || {};
  const used = /* @__PURE__ */ new Set();
  for (const b of model.bones) {
    for (const c of b.cubes) {
      if (!c.box_uv) throw new StudioError("E_PAINT", `cube ${c.name} has no box_uv; run packBoxUv first`);
      const cfg = paint.cubes?.[`${b.name}/${c.name}`] || paint.cubes?.[c.name] || paint.bones?.[b.name] || {};
      const matName = cfg.material || paint.bones?.[b.name]?.material || paint.default_material;
      const mat = mats[matName];
      if (!mat) throw new StudioError("E_PAINT", `cube ${c.name}: unknown material "${matName}"`);
      used.add(matName);
      const ramp = mat.ramp.map((h) => hexToRgba(h));
      const r = rng((mat.pattern?.seed ?? 1) * 7919 + c.box_uv[0] * 31 + c.box_uv[1]);
      for (const [face, rect] of Object.entries(faceRects(c))) {
        const faceMat = cfg.face_materials?.[face] ? mats[cfg.face_materials[face]] : null;
        const fr = faceMat ? faceMat.ramp.map((h) => hexToRgba(h)) : ramp;
        const pat = faceMat ? faceMat.pattern : mat.pattern;
        for (let fy = 0; fy < rect.h; fy++) for (let fx = 0; fx < rect.w; fx++) {
          let i = shadeIndex(face, fx, fy, rect.w, rect.h, fr.length) + patternShift(pat, face, fx, fy, rect.w, rect.h, r);
          i = Math.max(0, Math.min(fr.length - 1, i));
          setPx(img, rect.x + fx, rect.y + fy, fr[i]);
        }
        const ov = cfg.faces?.[face];
        if (ov) {
          const pal = Object.fromEntries(Object.entries(ov.palette || {}).map(([k, v]) => [k, v === "transparent" ? [0, 0, 0, 0] : hexToRgba(v)]));
          (ov.rows || []).forEach((row, oy) => [...row].forEach((ch, ox) => {
            if (ch === "." || ch === " ") return;
            const col = pal[ch];
            if (!col) throw new StudioError("E_PAINT", `cube ${c.name}.${face}: character "${ch}" not in palette`);
            const x = rect.x + (ov.x || 0) + ox, y = rect.y + (ov.y || 0) + oy;
            if (x < rect.x + rect.w && y < rect.y + rect.h) setPx(img, x, y, col);
          }));
        }
      }
    }
  }
  return { image: img, materials_used: [...used] };
}
function uvReport(src) {
  const model = normalizeModel(src);
  const [tw, th] = model.texture_size;
  let area = 0;
  for (const b of model.bones) for (const c of b.cubes) for (const r of Object.values(faceRects(c))) area += r.w * r.h;
  return { texture_size: [tw, th], cubes: model.bones.reduce((n, b) => n + b.cubes.length, 0), coverage: Number((area / (tw * th)).toFixed(3)) };
}

// src/mcp/studio-texture.js
var server = createServer("studio-texture", "Minecraft Studio texture pipeline. Author textures as pixel specs (palette + character grid) \u2014 not by downscaling. Build a style profile from the existing pack first, compare every new texture against it, review previews at 1600%/800%/100%/tiled, derive state variants from one base so they read as the same object.");
var previewPath = (studio, name) => studio.p("previews", `${slugify(name)}.png`);
function loadSpec(studio, a) {
  if (a.spec) return a.spec;
  return readJson(studio.abs(a.spec_path));
}
function profilePath(studio, name) {
  return name && name !== "default" ? studio.p("styles", `${slugify(name)}.json`) : studio.p("style-profile.json");
}
tool(server, "texture_render_spec", {
  title: "Render pixel spec to PNG",
  capability: "write",
  description: 'Render a pixel spec ({size, palette:{char:"#hex"|"transparent"}, rows:[...], frames?, frametime?, base?, patches?}) to a PNG (+ .mcmeta for animations). Saves the spec as reproducible source, validates, writes a review sheet (returned as image) and optionally registers the asset.',
  input: {
    spec: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    spec_path: external_exports.string().optional().describe("Project-relative JSON spec file"),
    output: external_exports.string().describe("Project-relative PNG path, e.g. resourcepack/assets/ns/textures/block/reactor.png"),
    purpose: external_exports.enum(["block", "item", "entity", "gui", "particle", "other"]).optional(),
    asset: assetInput
  }
}, async (a, { studio, root }) => {
  requireOneOf(a, ["spec", "spec_path"]);
  const spec = loadSpec(studio, a);
  const out = studio.abs(a.output);
  const r = renderSpecToFile(spec, out, { baseDir: root });
  const validation = validateTexture(r.image, { mcmeta: r.mcmeta, purpose: a.purpose || "block" });
  const files = r.files.map((f) => studio.rel(f));
  let sourceRel = a.spec_path || null;
  if (a.asset && !a.spec_path) {
    const sf = studio.p("sources", a.asset.id, `${path2.basename(a.output, ".png")}.pixelspec.json`);
    writeJson(sf, spec);
    sourceRel = studio.rel(sf);
  }
  const prev = previewSheet(r.image);
  const pp = previewPath(studio, a.asset?.id || a.output);
  writePng(pp, prev.image);
  const reg = registerOutput(studio, a.asset, { type: "texture", files, source: { provider: "pixel-spec", method: "texture_render_spec", source_files: sourceRel ? [sourceRel] : [], parameters: { size: r.size, frames: r.frames.length } }, preview: studio.rel(pp), metadata: { width: r.size[0], height: r.size[1], frames: r.frames.length, palette: spec.palette } });
  return { files, validation, preview: { file: studio.rel(pp), layout: prev.layout }, asset: reg, _images: [pp] };
});
tool(server, "texture_from_png", {
  title: "PNG \u2192 pixel spec",
  capability: "read",
  description: "Convert an existing PNG into an editable pixel spec (palette + rows), e.g. to make a variant of an existing texture or adjust it precisely.",
  input: { path: external_exports.string(), max_colors: external_exports.number().int().optional() }
}, async (a, { studio }) => imageToSpec(readPng(studio.abs(a.path)), { maxColors: a.max_colors || 62 }));
tool(server, "texture_analyze", {
  title: "Analyze texture",
  capability: "read",
  description: "Pixel-art metrics: palette size, contrast, saturation, shadow/highlight hue shift, noise, dithering, detail density, cluster size, outline, lighting direction.",
  input: { path: external_exports.string() }
}, async (a, { studio }) => analyzeImage(readPng(studio.abs(a.path))));
tool(server, "texture_style_profile", {
  title: "Build style profile from pack",
  capability: "write",
  description: "Analyse every texture in one or more resource-pack directories (or explicit files) and write a style profile (pixel density, shared palette, contrast, saturation, hue shift, outline, noise, dithering, lighting, detail density, per category). Default output: .minecraft-studio/style-profile.json.",
  input: { pack_dirs: external_exports.array(external_exports.string()).optional(), files: external_exports.array(external_exports.string()).optional(), name: external_exports.string().optional(), include: external_exports.string().optional().describe('Regex filter on texture paths, e.g. "textures/block/"') }
}, async (a, { studio }) => {
  requireOneOf(a, ["pack_dirs", "files"]);
  let textures = [];
  for (const d of a.pack_dirs || []) {
    const abs = studio.abs(d);
    textures.push(...walk(abs).filter((f) => /textures\/.+\.png$/.test(f)).map((f) => ({ abs: path2.join(abs, f), rel: `${d.replace(/\/$/, "")}/${f}` })));
  }
  for (const f of a.files || []) textures.push({ abs: studio.abs(f), rel: f });
  if (a.include) {
    const re = new RegExp(a.include);
    textures = textures.filter((t) => re.test(t.rel));
  }
  if (!textures.length) throw new StudioError("E_INPUT", "No textures found");
  const profile = buildStyleProfile(textures, { name: a.name || "default", source: a.pack_dirs || a.files });
  const out = profilePath(studio, a.name);
  writeJson(out, profile);
  if (studio.isInitialized()) {
    studio.log({ agent: "style-analyst", event: "style.profile", severity: "success", message: `Style profile "${profile.name}" from ${profile.texture_count} textures: ${profile.traits.slice(0, 3).join("; ")}` });
    studio.remember({ category: "visual-style", title: `Style profile "${profile.name}"`, content: `${profile.traits.join("; ")}. Pixel density ${profile.pixel_density}. Lighting ${profile.lighting_direction.description}.`, by: "style-analyst" });
  }
  return { file: studio.rel(out), name: profile.name, texture_count: profile.texture_count, pixel_density: profile.pixel_density, palette: profile.palette.slice(0, 24).map((c) => c.hex), lighting: profile.lighting_direction, traits: profile.traits, metrics: profile.metrics, categories: Object.fromEntries(Object.entries(profile.categories).map(([k, v]) => [k, v.count])) };
});
tool(server, "texture_style_compare", {
  title: "Compare texture to style profile",
  capability: "read",
  description: "Score a texture (0-100) against the style profile, per-metric deviations, palette adherence and nearest existing textures. Returns a side-by-side image (new texture vs nearest references) for Visual QA.",
  input: { path: external_exports.string(), profile: external_exports.string().optional().describe("Profile name (default)"), category: external_exports.string().optional() }
}, async (a, { studio }) => {
  const pf = profilePath(studio, a.profile);
  if (!exists(pf)) throw new StudioError("E_NOT_FOUND", "No style profile yet \u2014 run texture_style_profile on the existing pack first");
  const profile = readJson(pf);
  const img = readPng(studio.abs(a.path));
  const res = compareToProfile(img, profile, { category: a.category || category(a.path) });
  const refs = [];
  for (const n of res.nearest_references || []) {
    for (const base of [studio.root, ...Array.isArray(profile.source) ? profile.source.map((s) => studio.abs(s)) : []]) {
      const cand = path2.isAbsolute(n.path) ? n.path : path2.join(base, n.path);
      if (fs2.existsSync(cand)) {
        try {
          refs.push(readPng(cand));
        } catch {
        }
        break;
      }
    }
  }
  const sheet = previewSheet(img, { references: refs, tile: false });
  const pp = previewPath(studio, `compare_${a.path}`);
  writePng(pp, sheet.image);
  return { ...res, metrics: void 0, preview: { file: studio.rel(pp), layout: sheet.layout }, _images: [pp] };
});
tool(server, "texture_validate", {
  title: "Validate texture for Minecraft",
  capability: "read",
  description: "Technical checks: power-of-two, square/animation strip + .mcmeta, expected resolution, semi-transparency, palette size, isolated-pixel noise.",
  input: { path: external_exports.string(), expected_size: external_exports.array(external_exports.number().int()).length(2).optional(), purpose: external_exports.enum(["block", "item", "entity", "gui", "particle", "other"]).optional() }
}, async (a, { studio }) => {
  const abs = studio.abs(a.path);
  const mcmeta = exists(`${abs}.mcmeta`) ? readJson(`${abs}.mcmeta`) : null;
  return validateTexture(readPng(abs), { expectedSize: a.expected_size, mcmeta, purpose: a.purpose || "block" });
});
tool(server, "texture_check_tiling", {
  title: "Check seamless tiling",
  capability: "read",
  description: "Seam analysis across wrap edges plus a 3\xD73 tiled preview image.",
  input: { path: external_exports.string() }
}, async (a, { studio }) => {
  const img = readPng(studio.abs(a.path));
  const r = checkTiling(img);
  const sheet = previewSheet(img);
  const pp = previewPath(studio, `tiling_${a.path}`);
  writePng(pp, sheet.image);
  return { ...r, preview: studio.rel(pp), _images: [pp] };
});
tool(server, "texture_palette_pass", {
  title: "Palette pass",
  capability: "write",
  description: "Snap every pixel to the nearest colour (\u0394E) of the style-profile palette or an explicit palette. Writes to output (or in place).",
  input: { path: external_exports.string(), output: external_exports.string().optional(), palette: external_exports.array(external_exports.string()).optional(), profile: external_exports.string().optional(), max_colors: external_exports.number().int().optional().describe("Use only the N most common profile colours"), asset: assetInput }
}, async (a, { studio }) => {
  let pal = a.palette;
  if (!pal) {
    const pf = profilePath(studio, a.profile);
    if (!exists(pf)) throw new StudioError("E_NOT_FOUND", "No palette given and no style profile found");
    pal = readJson(pf).palette.slice(0, a.max_colors || 32).map((c) => c.hex);
  }
  const r = quantizeToPalette(readPng(studio.abs(a.path)), pal);
  const out = a.output || a.path;
  writePng(studio.abs(out), r.image);
  const reg = registerOutput(studio, a.asset, { type: "texture", files: [out], source: { provider: "palette-pass", parameters: { palette: pal }, source_files: [a.path] } });
  return { output: out, mean_colour_shift: r.mean_shift, palette_size: pal.length, asset: reg };
});
tool(server, "texture_variants", {
  title: "Derive state variants",
  capability: "write",
  description: "Create consistent state variants (powered, active, warning, critical, damaged, overheated\u2026) from one base texture with ops: hue, saturation, brightness, tint, replace (colour map), emissive (light colours \u2192 glow), damage (deterministic cracks), quantize, flip. Returns a comparison strip image.",
  input: {
    base: external_exports.string(),
    variants: external_exports.array(external_exports.object({ name: external_exports.string(), output: external_exports.string(), ops: external_exports.array(external_exports.record(external_exports.string(), external_exports.any())), asset_id: external_exports.string().optional(), minecraft_ids: external_exports.array(external_exports.string()).optional() })),
    agent: external_exports.string().optional()
  }
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
      reg = registerOutput(studio, { id: v.asset_id, name: v.name, minecraft_ids: v.minecraft_ids, agent: a.agent || "texture-artist", tags: ["variant", v.name], dependencies: baseAsset ? [baseAsset.id] : [] }, { type: "texture", files: [v.output], source: { provider: "variant-ops", source_files: [a.base], parameters: { ops: v.ops } } });
    }
    results.push({ name: v.name, output: v.output, validation: validateTexture(img).verdict, asset: reg });
  }
  const strip = variantStrip(images);
  const pp = previewPath(studio, `variants_${a.base}`);
  writePng(pp, strip);
  return { variants: results, strip: { file: studio.rel(pp), order: ["base", ...a.variants.map((v) => v.name)] }, _images: [pp] };
});
tool(server, "texture_concept_reduce", {
  title: "Concept \u2192 pixel art base",
  capability: "write",
  description: "Reduce a high-resolution concept image to a target grid using dominant-colour sampling, palette reduction (median-cut or style palette) and despeckle. Output is a STARTING POINT that must be cleaned up by hand (export to spec with texture_from_png, edit, re-render).",
  input: { path: external_exports.string(), output: external_exports.string(), size: external_exports.array(external_exports.number().int()).length(2).optional(), colors: external_exports.number().int().optional(), use_profile_palette: external_exports.boolean().optional() }
}, async (a, { studio }) => {
  const pal = a.use_profile_palette && exists(profilePath(studio)) ? readJson(profilePath(studio)).palette.slice(0, 32).map((c) => c.hex) : null;
  const r = conceptToPixelArt(readPng(studio.abs(a.path)), { size: a.size || [16, 16], colors: a.colors || 12, palette: pal });
  writePng(studio.abs(a.output), r.image);
  const pp = previewPath(studio, `concept_${a.output}`);
  writePng(pp, previewSheet(r.image).image);
  return { output: a.output, palette: r.palette, validation: validateTexture(r.image), preview: studio.rel(pp), _images: [pp] };
});
tool(server, "texture_preview", {
  title: "Texture review sheet",
  capability: "read",
  description: "Render a review sheet (1600%, 800%, 3\xD73 tiling, 100% in-game size, optional reference textures) and return it as an image for visual review.",
  input: { path: external_exports.string(), references: external_exports.array(external_exports.string()).optional() }
}, async (a, { studio }) => {
  const sheet = previewSheet(readPng(studio.abs(a.path)), { references: (a.references || []).map((r) => readPng(studio.abs(r))) });
  const pp = previewPath(studio, `preview_${a.path}`);
  writePng(pp, sheet.image);
  return { preview: studio.rel(pp), layout: sheet.layout, _images: [pp] };
});
tool(server, "texture_paint_uv", {
  title: "Paint creature/entity UV atlas",
  capability: "write",
  description: "Lay out box-UV islands for a model (auto packing) and paint a pixel-art atlas from materials (dark\u2192light ramps, patterns fur/shaggy/plates/feathers/stripes/scales) with per-face shading and hand-authored face details (eyes, mouths, markings). Writes the PNG, the packed model source and the paint spec; returns the atlas at 4\xD7 and a textured turnaround for review.",
  input: {
    model: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    model_path: external_exports.string().optional().describe("Project-relative model source; the packed version is written back unless model_output is given"),
    paint: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    paint_path: external_exports.string().optional(),
    output: external_exports.string().describe("Project-relative atlas PNG path"),
    model_output: external_exports.string().optional(),
    texture_key: external_exports.string().optional().describe("Model texture key to point at the atlas (default: first)"),
    repack: external_exports.boolean().optional().describe("Re-run UV packing even if cubes already have box_uv (default true)"),
    asset: assetInput
  }
}, async (a, { studio }) => {
  requireOneOf(a, ["model", "model_path"]);
  requireOneOf(a, ["paint", "paint_path"]);
  let model = a.model || readJson(studio.abs(a.model_path));
  const paint = a.paint || readJson(studio.abs(a.paint_path));
  if (a.repack !== false || model.bones.some((b) => (b.cubes || []).some((c) => !c.box_uv))) model = packBoxUv(model, { textureSize: paint.texture_size });
  const key = a.texture_key || Object.keys(model.textures)[0];
  model.textures[key] = a.output;
  const { image, materials_used } = paintAtlas(model, { ...paint, texture_size: model.texture_size });
  writePng(studio.abs(a.output), image);
  const modelOut = a.model_output || a.model_path;
  if (modelOut) writeJson(studio.abs(modelOut), model);
  const files = [a.output];
  if (a.asset) {
    if (a.paint && !a.paint_path) {
      const pf = studio.p("sources", a.asset.id, "paint.json");
      writeJson(pf, paint);
      files.push({ path: studio.rel(pf), role: "source" });
    } else if (a.paint_path) files.push({ path: a.paint_path, role: "source" });
  }
  const atlasPreview = studio.p("previews", `atlas_${slugify(a.asset?.id || a.output)}.png`);
  writePng(atlasPreview, scaleNearest(image, Math.max(1, Math.floor(512 / Math.max(image.width, image.height)))));
  const turn = renderTurnaround(model, { resolveTexture: (p) => studio.abs(p) });
  const turnPreview = studio.p("previews", `model_${slugify(model.name || "model")}.png`);
  writePng(turnPreview, turn.image);
  const reg = registerOutput(studio, a.asset, { type: "texture", files, source: { provider: "uv-painter", method: "texture_paint_uv", source_files: [a.paint_path, modelOut].filter(Boolean), parameters: { materials: materials_used } }, preview: studio.rel(atlasPreview), metadata: { width: image.width, height: image.height, ...uvReport(model) } });
  return { output: a.output, model_output: modelOut || null, texture_size: model.texture_size, uv: uvReport(model), materials_used, previews: [studio.rel(atlasPreview), studio.rel(turnPreview)], asset: reg, _images: [atlasPreview, turnPreview] };
});
await start(server);
