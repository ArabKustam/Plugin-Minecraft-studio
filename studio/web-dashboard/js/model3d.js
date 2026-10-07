// Client-side model renderer for minecraft-studio-model/1 sources.
// Mirrors runtime/src/lib/model/render.js: same bone matrices (Z·Y·X rotation
// about the pivot), same face corners/UVs, same directional face shading and
// the same orthographic camera (yaw/pitch), rasterised with a z-buffer and
// nearest-neighbour texture sampling into an ImageData.
import { loadImageData } from './api.js';

// ---- 4x4 matrices (row-major, column vectors) ----
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let v = 0; for (let k = 0; k < 4; k++) v += a[r * 4 + k] * b[k * 4 + c]; o[r * 4 + c] = v; }
  return o;
}
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rad = (d) => (d * Math.PI) / 180;
function RX(d) { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
function RY(d) { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
function RZ(d) { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
const apply = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
const rotXYZ = ([x, y, z]) => mul(RZ(z), mul(RY(y), RX(x)));

const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
const FACE_CORNERS = {
  north: (f, t) => [[t[0], t[1], f[2]], [f[0], t[1], f[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]]],
  south: (f, t) => [[f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], f[1], t[2]], [f[0], f[1], t[2]]],
  east: (f, t) => [[t[0], t[1], t[2]], [t[0], t[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]],
  west: (f, t) => [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [f[0], f[1], t[2]], [f[0], f[1], f[2]]],
  up: (f, t) => [[f[0], t[1], f[2]], [t[0], t[1], f[2]], [t[0], t[1], t[2]], [f[0], t[1], t[2]]],
  down: (f, t) => [[f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]]],
};
const SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };

function boxUvFaces(u, v, size, texture) {
  const [dx, dy, dz] = size.map((x) => Math.abs(x));
  return {
    east: { texture, uv: [u, v + dz, u + dz, v + dz + dy] },
    north: { texture, uv: [u + dz, v + dz, u + dz + dx, v + dz + dy] },
    west: { texture, uv: [u + dz + dx, v + dz, u + 2 * dz + dx, v + dz + dy] },
    south: { texture, uv: [u + 2 * dz + dx, v + dz, u + 2 * dz + 2 * dx, v + dz + dy] },
    up: { texture, uv: [u + dz, v, u + dz + dx, v + dz] },
    down: { texture, uv: [u + dz + dx, v + dz, u + dz + 2 * dx, v] },
  };
}

const vec3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new Error(`${what} must be [x, y, z] numbers`);
  return v;
};

/** Validate & normalise a model source (same rules as spec.js normalizeModel). */
export function normalizeModel(src) {
  if (!src || typeof src !== 'object') throw new Error('Model source must be an object');
  if (src.format && src.format !== 'minecraft-studio-model/1') throw new Error(`Unsupported model format ${src.format}`);
  const textures = src.textures || {};
  const keys = Object.keys(textures);
  if (!keys.length) throw new Error('Model needs at least one texture');
  const names = new Set();
  const bones = (src.bones || []).map((b) => {
    if (!b.name || names.has(b.name)) throw new Error(`Bone names must be unique and non-empty (${b.name})`);
    names.add(b.name);
    return {
      name: b.name, parent: b.parent || null, pivot: vec3(b.pivot || [0, 0, 0], `bone ${b.name} pivot`), rotation: vec3(b.rotation || [0, 0, 0], `bone ${b.name} rotation`),
      cubes: (b.cubes || []).map((c, i) => {
        const from = vec3(c.from, `${b.name}.cube[${i}].from`), to = vec3(c.to, `${b.name}.cube[${i}].to`);
        const size = to.map((t, k) => t - from[k]);
        let faces = c.faces;
        if (!faces && c.box_uv) faces = boxUvFaces(c.box_uv[0], c.box_uv[1], size, c.texture || keys[0]);
        if (!faces) throw new Error(`${b.name}.cube[${i}] needs faces or box_uv`);
        return { name: c.name || `${b.name}_${i}`, from, to, size, faces, inflate: c.inflate || 0, rotation: c.rotation || null, emissive: !!c.emissive };
      }),
    };
  });
  for (const b of bones) if (b.parent && !names.has(b.parent)) throw new Error(`Bone ${b.name} has unknown parent ${b.parent}`);
  for (const b of bones) { let cur = b, d = 0; while (cur?.parent) { cur = bones.find((x) => x.name === cur.parent); if (++d > 64) throw new Error(`Bone hierarchy cycle at ${b.name}`); } }
  return { name: src.name || 'model', texture_size: src.texture_size || [16, 16], textures, bones };
}

/** World-space quads for a pose; hidden bones (and their children) are skipped. */
export function buildQuads(m, pose = {}, hidden = new Set()) {
  const bones = new Map(m.bones.map((b) => [b.name, b]));
  const cache = new Map();
  const boneMatrix = (name) => {
    if (cache.has(name)) return cache.get(name);
    const b = bones.get(name);
    const p = pose[name] || {};
    const rot = [0, 1, 2].map((i) => b.rotation[i] + (p.rotation?.[i] || 0));
    const pos = p.position || [0, 0, 0];
    const scl = p.scale || [1, 1, 1];
    const local = mul(T(...b.pivot), mul(T(pos[0], pos[1], pos[2]), mul(rotXYZ(rot), mul(S(...scl), T(-b.pivot[0], -b.pivot[1], -b.pivot[2])))));
    const world = b.parent ? mul(boneMatrix(b.parent), local) : local;
    cache.set(name, world);
    return world;
  };
  const isHidden = (b) => { let cur = b; while (cur) { if (hidden.has(cur.name)) return true; cur = cur.parent ? bones.get(cur.parent) : null; } return false; };
  const quads = [];
  for (const b of m.bones) {
    if (isHidden(b)) continue;
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
        if (!FACE_CORNERS[face] || !def || !Array.isArray(def.uv)) continue;
        const corners = FACE_CORNERS[face](f, t).map((p) => apply(cm, p));
        const [u1, v1, u2, v2] = def.uv;
        quads.push({ corners, uv: [[u1, v1], [u2, v1], [u2, v2], [u1, v2]], texture: def.texture, shade: c.emissive ? 1.15 : SHADE[face] });
      }
    }
  }
  return quads;
}

export const countCubes = (m) => m.bones.reduce((a, b) => a + b.cubes.length, 0);

/** Fetch textures referenced by a model (project-relative paths). */
export async function loadTextures(m) {
  const out = {}, missing = [];
  await Promise.all(Object.entries(m.textures).map(async ([k, p]) => {
    try { out[k] = await loadImageData(p); } catch { out[k] = null; missing.push(k); }
  }));
  return { textures: out, missing };
}

// ------------------------------------------------------------------ interactive viewer
export class ModelViewer {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.model = null; this.textures = {}; this.pose = {}; this.hidden = new Set();
    this.yaw = 225; this.pitch = 30; this.zoom = 1;
    this.showGrid = true;
    this.onChange = onChange;
    this.dirty = true;
    this._raf = 0;
    this._bindInput();
    this._ro = new ResizeObserver(() => this.invalidate());
    this._ro.observe(canvas);
  }

  setModel(model, textures) {
    this.model = model; this.textures = textures || {}; this._restMinY = undefined;
    // framing radius from the rest pose so orbiting never changes the scale
    const pts = buildQuads(model).flatMap((q) => q.corners);
    const c = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    this.center = pts.length ? c : [8, 8, 8];
    this.radius = Math.max(4, ...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    this.invalidate();
  }
  setPose(pose) { this.pose = pose || {}; this.invalidate(); }
  setHidden(hidden) { this.hidden = hidden; this.invalidate(); }
  reset() { this.yaw = 225; this.pitch = 30; this.zoom = 1; this.invalidate(); }
  view(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; this.invalidate(); }

  invalidate() {
    this.dirty = true;
    if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; if (this.dirty) this.render(); });
  }

  destroy() { cancelAnimationFrame(this._raf); this._ro.disconnect(); this._unbind?.(); }

  _bindInput() {
    const cv = this.canvas;
    let drag = null;
    const down = (e) => { drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); };
    const move = (e) => {
      if (!drag) return;
      this.yaw = drag.yaw - (e.clientX - drag.x) * 0.5;
      this.pitch = Math.max(-89, Math.min(89, drag.pitch + (e.clientY - drag.y) * 0.4));
      this.invalidate();
    };
    const up = () => { drag = null; cv.classList.remove('grabbing'); };
    const wheel = (e) => { e.preventDefault(); this.zoom = Math.max(0.3, Math.min(8, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.invalidate(); };
    const key = (e) => {
      const k = e.key;
      if (k === 'ArrowLeft') this.yaw += 10; else if (k === 'ArrowRight') this.yaw -= 10;
      else if (k === 'ArrowUp') this.pitch = Math.min(89, this.pitch + 8); else if (k === 'ArrowDown') this.pitch = Math.max(-89, this.pitch - 8);
      else if (k === '+' || k === '=') this.zoom = Math.min(8, this.zoom * 1.15); else if (k === '-' || k === '_') this.zoom = Math.max(0.3, this.zoom / 1.15);
      else if (k === '0' || k === 'Home') { this.reset(); } else return;
      e.preventDefault(); this.invalidate();
    };
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('keydown', key);
    cv.addEventListener('dblclick', () => this.reset());
    this._unbind = () => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('wheel', wheel); cv.removeEventListener('keydown', key); };
  }

  render() {
    this.dirty = false;
    const cv = this.canvas;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = Math.max(1, Math.min(900, Math.round(rect.width * dpr))), H = Math.max(1, Math.min(900, Math.round(rect.height * dpr)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = this.ctx;
    if (!this.model) { ctx.clearRect(0, 0, W, H); return; }
    const img = ctx.createImageData(W, H);
    const buf = img.data;
    const zbuf = new Float32Array(W * H).fill(-Infinity);
    const view = mul(RX(-this.pitch), RY(this.yaw));
    const [cx0, cy0, cz0] = this.center;
    const scale = (Math.min(W, H) * 0.42 * this.zoom) / this.radius;
    const project = (p) => { const q = apply(view, [p[0] - cx0, p[1] - cy0, p[2] - cz0]); return [-q[0] * scale + W / 2, -q[1] * scale + H / 2, -q[2]]; };
    const [tw, th] = this.model.texture_size;

    // ground grid (one block, 1px cells) at the model's lowest point, depth-tested
    if (this.showGrid) {
      const quadsRest = this._restMinY ?? (this._restMinY = Math.min(...buildQuads(this.model).flatMap((q) => q.corners.map((c) => c[1]))));
      const gy = Number.isFinite(quadsRest) ? quadsRest : 0;
      const gridCol = getComputedStyle(cv).getPropertyValue('--grid-line').trim() || 'rgba(140,150,170,0.35)';
      const [gr, gg, gb, ga] = parseColor(gridCol);
      const lines = [];
      for (let k = -8; k <= 24; k += 2) { lines.push([[k, gy, -8], [k, gy, 24]]); lines.push([[-8, gy, k], [24, gy, k]]); }
      for (const [a, b] of lines) {
        const pa = project(a), pb = project(b);
        const n = Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 1.2) + 1;
        const edge = (Math.abs(a[0] - 8) === 16 || Math.abs(a[2] - 8) === 16);
        for (let j = 0; j <= n; j++) {
          const t = j / n;
          const x = Math.round(pa[0] + (pb[0] - pa[0]) * t), y = Math.round(pa[1] + (pb[1] - pa[1]) * t);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const idx = y * W + x;
          const z = pa[2] + (pb[2] - pa[2]) * t - 0.01;
          if (z <= zbuf[idx] && zbuf[idx] !== -Infinity) continue;
          const o = idx * 4, al = edge ? ga * 0.45 : ga * 0.8;
          buf[o] = gr; buf[o + 1] = gg; buf[o + 2] = gb; buf[o + 3] = Math.max(buf[o + 3], al * 255);
        }
      }
    }
    const quads = buildQuads(this.model, this.pose, this.hidden);
    for (const q of quads) {
      const tex = this.textures[q.texture];
      const sp = q.corners.map(project);
      rasterTri(buf, zbuf, W, H, sp[0], sp[1], sp[2], q.uv[0], q.uv[1], q.uv[2], tex, tw, th, q.shade);
      rasterTri(buf, zbuf, W, H, sp[0], sp[2], sp[3], q.uv[0], q.uv[2], q.uv[3], tex, tw, th, q.shade);
    }
    ctx.putImageData(img, 0, 0);
    this.onChange?.({ quads: quads.length });
  }
}

function parseColor(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  const hx = str.match(/^#([0-9a-f]{6})/i);
  if (hx) { const n = parseInt(hx[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 0.5]; }
  return [140, 150, 170, 0.35];
}

function rasterTri(buf, zbuf, W, H, a, b, c, ua, ub, uc, tex, tw, th, shade) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const texH = tex ? Math.min(tex.height, tex.width * (th / tw)) : 0;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      if (w0 < -1e-6) continue;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      if (w1 < -1e-6) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < -1e-6) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
      const idx = y * W + x;
      if (z <= zbuf[idx]) continue;
      let r = 255, g = 0, bl = 255;
      if (tex) {
        const u = w0 * ua[0] + w1 * ub[0] + w2 * uc[0];
        const v = w0 * ua[1] + w1 * ub[1] + w2 * uc[1];
        const tx = Math.min(tex.width - 1, Math.max(0, Math.floor((u / tw) * tex.width - 1e-6)));
        const ty = Math.min(tex.height - 1, Math.max(0, Math.floor((v / th) * texH - 1e-6)));
        const o = (ty * tex.width + tx) * 4;
        if (tex.data[o + 3] < 128) continue;
        r = tex.data[o]; g = tex.data[o + 1]; bl = tex.data[o + 2];
      }
      zbuf[idx] = z;
      const o = idx * 4;
      buf[o] = Math.min(255, r * shade); buf[o + 1] = Math.min(255, g * shade); buf[o + 2] = Math.min(255, bl * shade); buf[o + 3] = 255;
    }
  }
}

