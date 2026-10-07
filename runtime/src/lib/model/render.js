// Software renderer for studio models: orthographic, textured, z-buffered,
// with Minecraft-style directional face shading. It gives Claude a real image
// of the model (and of animation poses) for the visual feedback loop without
// requiring Blockbench or a running game client.
import { createImage, setPx, getPx, blit, readPng } from '../texture/image.js';
import { normalizeModel } from './spec.js';
import { poseAt } from './animation.js';

// ---- tiny 4x4 matrix helpers (column vectors, row-major arrays) ----
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
function RX(d) { const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
function RY(d) { const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
function RZ(d) { const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
const apply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
// Blockbench/Bedrock bone rotation order: Z, then Y, then X (applied as Rz·Ry·Rx)
const rotXYZ = ([x, y, z]) => mul(RZ(z), mul(RY(y), RX(x)));

const FACE_CORNERS = {
  north: (f, t) => [[t[0], t[1], f[2]], [f[0], t[1], f[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]]],
  south: (f, t) => [[f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], f[1], t[2]], [f[0], f[1], t[2]]],
  east: (f, t) => [[t[0], t[1], t[2]], [t[0], t[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]],
  west: (f, t) => [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [f[0], f[1], t[2]], [f[0], f[1], f[2]]],
  up: (f, t) => [[f[0], t[1], f[2]], [t[0], t[1], f[2]], [t[0], t[1], t[2]], [f[0], t[1], t[2]]],
  down: (f, t) => [[f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]]],
};
const SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

/** Build world-space textured quads for the model at an optional animation pose. */
export function buildQuads(src, pose = {}) {
  const m = normalizeModel(src);
  const bones = new Map(m.bones.map((b) => [b.name, b]));
  const cache = new Map();
  const boneMatrix = (name) => {
    if (cache.has(name)) return cache.get(name);
    const b = bones.get(name);
    const p = pose[name] || {};
    const rot = [0, 1, 2].map((i) => b.rotation[i] + (p.rotation?.[i] || 0));
    const pos = p.position || [0, 0, 0];
    const scl = p.scale || [1, 1, 1];
    let local = mul(T(...b.pivot), mul(T(pos[0], pos[1], pos[2]), mul(rotXYZ(rot), mul(S(...scl), T(-b.pivot[0], -b.pivot[1], -b.pivot[2])))));
    const world = b.parent ? mul(boneMatrix(b.parent), local) : local;
    cache.set(name, world);
    return world;
  };
  const quads = [];
  for (const b of m.bones) {
    const bm = boneMatrix(b.name);
    for (const c of b.cubes) {
      let cm = bm;
      if (c.rotation?.angle) {
        const o = c.rotation.origin || b.pivot;
        const r = c.rotation.axis === 'x' ? RX(c.rotation.angle) : c.rotation.axis === 'y' ? RY(c.rotation.angle) : RZ(c.rotation.angle);
        cm = mul(bm, mul(T(...o), mul(r, T(-o[0], -o[1], -o[2]))));
      }
      const f = c.from.map((v) => v - c.inflate), t = c.to.map((v) => v + c.inflate);
      for (const [face, def] of Object.entries(c.faces)) {
        const corners = FACE_CORNERS[face](f, t).map((p) => apply(cm, p));
        const [u1, v1, u2, v2] = def.uv;
        quads.push({ corners, uv: [[u1, v1], [u2, v1], [u2, v2], [u1, v2]], texture: def.texture, shade: c.emissive ? 1.15 : SHADE[face], face });
      }
    }
  }
  return { model: m, quads };
}

/**
 * Render one view. yaw/pitch in degrees (Minecraft GUI block view ≈ yaw 225, pitch 30).
 * textures: map key → Img (already loaded).
 */
export function renderView(quads, textures, textureSize, { yaw = 225, pitch = 30, size = 256, background = [0, 0, 0, 0], bounds = null } = {}) {
  const view = mul(RX(-pitch), RY(yaw));
  const projected = quads.map((q) => ({ ...q, pts: q.corners.map((c) => apply(view, [c[0] - 8, c[1] - 8, c[2] - 8])) }));
  const all = bounds || projected.flatMap((q) => q.pts);
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = (size * 0.86) / extent;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const img = createImage(size, size, background);
  const zbuf = new Float64Array(size * size).fill(-Infinity);
  const [tw, th] = textureSize;
  for (const q of projected) {
    const tex = textures[q.texture];
    const sp = q.pts.map((p) => [-(p[0] - cx) * scale + size / 2, -(p[1] - cy) * scale + size / 2, -p[2]]);
    for (const tri of [[0, 1, 2], [0, 2, 3]]) rasterTri(img, zbuf, tri.map((i) => sp[i]), tri.map((i) => q.uv[i]), tex, tw, th, q.shade);
  }
  return img;
}

function rasterTri(img, zbuf, p, uv, tex, tw, th, shade) {
  const [a, b, c] = p;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(img.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(img.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
    const idx = y * img.width + x;
    if (z <= zbuf[idx]) continue;
    let color = [255, 0, 255, 255];
    if (tex) {
      const u = w0 * uv[0][0] + w1 * uv[1][0] + w2 * uv[2][0];
      const v = w0 * uv[0][1] + w1 * uv[1][1] + w2 * uv[2][1];
      const tx = Math.min(tex.width - 1, Math.max(0, Math.floor((u / tw) * tex.width - 1e-6)));
      const ty = Math.min(tex.height - 1, Math.max(0, Math.floor((v / th) * Math.min(tex.height, tex.width * (th / tw)) - 1e-6)));
      color = getPx(tex, tx, ty);
      if (color[3] < 128) continue;
    }
    zbuf[idx] = z;
    setPx(img, x, y, [Math.min(255, color[0] * shade), Math.min(255, color[1] * shade), Math.min(255, color[2] * shade), 255].map(Math.round));
  }
}

export function loadModelTextures(model, resolve) {
  const out = {};
  for (const [k, p] of Object.entries(model.textures)) {
    try { out[k] = readPng(resolve(p)); } catch { out[k] = null; }
  }
  return out;
}

const VIEWS = [
  { name: 'gui (front-left iso)', yaw: 225, pitch: 30 },
  { name: 'back-right iso', yaw: 45, pitch: 30 },
  { name: 'front (north)', yaw: 0, pitch: 0 },
  { name: 'top', yaw: 0, pitch: 90 },
];

function sheetBg(w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, ((x >> 4) + (y >> 4)) % 2 ? [52, 54, 60, 255] : [44, 46, 52, 255]);
  return img;
}

/** 4-view turnaround sheet for model QA. */
export function renderTurnaround(src, { resolveTexture, size = 256, pose = {} } = {}) {
  const { model, quads } = buildQuads(src, pose);
  const textures = loadModelTextures(model, resolveTexture);
  const sheet = sheetBg(size * VIEWS.length, size);
  VIEWS.forEach((v, i) => blit(sheet, renderView(quads, textures, model.texture_size, { ...v, size }), i * size, 0));
  return { image: sheet, views: VIEWS.map((v) => v.name), missing_textures: Object.entries(textures).filter(([, t]) => !t).map(([k]) => k) };
}

/** Animation contact sheet: frames sampled across the animation from one camera. */
export function renderAnimationSheet(src, anim, { resolveTexture, frames = 8, size = 192, yaw = 225, pitch = 30 } = {}) {
  const { model, quads: rest } = buildQuads(src);
  const textures = loadModelTextures(model, resolveTexture);
  // fixed framing from rest pose so motion is visible
  const view = mul(RX(-pitch), RY(yaw));
  const bounds = rest.flatMap((q) => q.corners.map((c) => apply(view, [c[0] - 8, c[1] - 8, c[2] - 8])));
  const pad = bounds.map((p) => p.map((v) => v * 1.25));
  const cols = Math.min(frames, 4);
  const rows = Math.ceil(frames / cols);
  const sheet = sheetBg(cols * size, rows * size);
  const times = [];
  for (let i = 0; i < frames; i++) {
    const t = anim.length * (frames === 1 ? 0 : i / (frames - (anim.loop ? 0 : 1)));
    times.push(Number(t.toFixed(3)));
    const { quads } = buildQuads(src, poseAt(anim, t));
    blit(sheet, renderView(quads, textures, model.texture_size, { yaw, pitch, size, bounds: pad }), (i % cols) * size, Math.floor(i / cols) * size);
  }
  return { image: sheet, times, layout: `${cols}×${rows} grid, left→right, top→bottom` };
}

