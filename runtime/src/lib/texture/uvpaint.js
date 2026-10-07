// UV painter: lays out box-UV islands for a model and paints a pixel-art
// texture atlas from material descriptions, per-face shading and hand-authored
// face details (eyes, mouths, markings). Built for entities/creatures, where
// drawing a 64×64 atlas character-by-character would be impractical.
//
// paint spec:
// {
//   "texture_size": [64, 64],
//   "materials": {
//     "fur":   { "ramp": ["#5a2a12", "#a3471b", "#d8692a", "#f08a3c"], "pattern": { "type": "fur", "density": 0.18, "seed": 3 } },
//     "belly": { "ramp": ["#b9aa98", "#d9cdbd", "#efe6d8", "#ffffff"] }
//   },
//   "default_material": "fur",
//   "cubes": {
//     "head": { "material": "fur", "faces": { "north": { "x": 1, "y": 2, "palette": { "e": "#111111", "w": "#ffffff" }, "rows": ["we..ew"] } } }
//   }
// }
// Ramps go dark → light (2–5 colours). Patterns: fur, shaggy, plates, feathers, stripes, scales, none.
// Face overlays use "." / " " for "leave as is"; coordinates are face-local pixels.
import { StudioError } from '../core/fsutil.js';
import { createImage, setPx, hexToRgba } from './image.js';
import { normalizeModel, boxUvFaces } from '../model/spec.js';

const ceilDims = (c) => c.size.map((s) => Math.max(1, Math.ceil(Math.abs(s) - 1e-6)));
const isPow2 = (n) => (n & (n - 1)) === 0;

/** Assign box_uv offsets to every cube (shelf packing, largest first). Returns a new model source. */
export function packBoxUv(src, { textureSize = null, padding = 0 } = {}) {
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
      if (it.w > tw) { ok = false; break; }
      if (x + it.w > tw) { x = 0; y += rowH; rowH = 0; }
      if (y + it.h > th) { ok = false; break; }
      placed.push([it, x, y]);
      x += it.w; rowH = Math.max(rowH, it.h);
    }
    if (ok) {
      for (const [it, px, py] of placed) { it.c.box_uv = [px, py]; delete it.c.faces; }
      model.texture_size = [tw, th];
      return model;
    }
    if (th <= tw) th *= 2; else tw *= 2;
  }
  throw new StudioError('E_UV', 'Could not pack box UVs into a texture up to 4096 px');
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Base ramp index for a face pixel: top-left light, top faces brightest, bottoms darkest. */
function shadeIndex(face, fx, fy, fw, fh, n) {
  const top = n - 1;
  let i;
  switch (face) {
    case 'up': i = top; break;
    case 'down': i = 0; break;
    case 'north': case 'south': i = top - 1 - (fh > 3 && fy >= Math.ceil(fh * 0.66) ? 1 : 0); break;
    case 'west': i = top - 1 - (fh > 3 && fy >= Math.ceil(fh * 0.6) ? 1 : 0); break;
    case 'east': i = top - 2 + (fh > 3 && fy < Math.floor(fh * 0.25) ? 1 : 0); break;
    default: i = 1;
  }
  // 1-px darker rim on the bottom edge of side faces gives the blocky Minecraft read
  if (['north', 'south', 'east', 'west'].includes(face) && fy === fh - 1 && fh > 2) i -= 1;
  return Math.max(0, Math.min(top, i));
}

function patternShift(p, face, fx, fy, fw, fh, r) {
  if (!p || p.type === 'none') return 0;
  const d = p.density ?? 0.2;
  switch (p.type) {
    case 'fur': return r() < d ? (r() < 0.6 ? -1 : 1) : 0;
    case 'shaggy': { // vertical strands
      const strand = ((fx * 2654435761) >>> 0) % 5;
      return face === 'up' ? (r() < d ? -1 : 0) : strand === 0 ? -1 : strand === 1 && fy % 3 === 0 ? 1 : 0;
    }
    case 'plates': { const s = p.size ?? 4; return fx % s === s - 1 || fy % s === s - 1 ? -1 : fx % s === 0 && fy % s === 0 ? 1 : 0; }
    case 'feathers': { const s = p.size ?? 3; return (fy % s === s - 1) && ((fx + Math.floor(fy / s)) % 2 === 0) ? -1 : (fy % s === 0 && r() < d) ? 1 : 0; }
    case 'stripes': { const s = p.size ?? 3; const v = p.vertical ? fx : fy; return Math.floor(v / s) % 2 === 1 ? -1 : 0; }
    case 'scales': { const s = p.size ?? 2; return ((fx + (Math.floor(fy / s) % 2) * s) % (s * 2) === 0) ? -1 : 0; }
    default: throw new StudioError('E_PAINT', `Unknown pattern ${p.type}`);
  }
}

function faceRects(c) {
  const dims = ceilDims(c);
  const faces = boxUvFaces(c.box_uv[0], c.box_uv[1], dims, 't');
  return Object.fromEntries(Object.entries(faces).map(([f, d]) => {
    const [u1, v1, u2, v2] = d.uv;
    return [f, { x: Math.min(u1, u2), y: Math.min(v1, v2), w: Math.abs(u2 - u1), h: Math.abs(v2 - v1) }];
  }));
}

/** Paint the atlas. The model must already have box_uv on every cube (see packBoxUv). */
export function paintAtlas(src, paint) {
  const model = normalizeModel(src);
  const [tw, th] = paint.texture_size || model.texture_size;
  if (!isPow2(tw) || !isPow2(th)) throw new StudioError('E_PAINT', 'texture_size must be powers of two');
  const img = createImage(tw, th, [0, 0, 0, 0]);
  const mats = paint.materials || {};
  const used = new Set();
  for (const b of model.bones) {
    for (const c of b.cubes) {
      if (!c.box_uv) throw new StudioError('E_PAINT', `cube ${c.name} has no box_uv; run packBoxUv first`);
      const cfg = paint.cubes?.[`${b.name}/${c.name}`] || paint.cubes?.[c.name] || paint.bones?.[b.name] || {};
      const matName = cfg.material || paint.bones?.[b.name]?.material || paint.default_material;
      const mat = mats[matName];
      if (!mat) throw new StudioError('E_PAINT', `cube ${c.name}: unknown material "${matName}"`);
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
          const pal = Object.fromEntries(Object.entries(ov.palette || {}).map(([k, v]) => [k, v === 'transparent' ? [0, 0, 0, 0] : hexToRgba(v)]));
          (ov.rows || []).forEach((row, oy) => [...row].forEach((ch, ox) => {
            if (ch === '.' || ch === ' ') return;
            const col = pal[ch];
            if (!col) throw new StudioError('E_PAINT', `cube ${c.name}.${face}: character "${ch}" not in palette`);
            const x = rect.x + (ov.x || 0) + ox, y = rect.y + (ov.y || 0) + oy;
            if (x < rect.x + rect.w && y < rect.y + rect.h) setPx(img, x, y, col);
          }));
        }
      }
    }
  }
  return { image: img, materials_used: [...used] };
}

/** Faces of a packed model, for validation/reporting. */
export function uvReport(src) {
  const model = normalizeModel(src);
  const [tw, th] = model.texture_size;
  let area = 0;
  for (const b of model.bones) for (const c of b.cubes) for (const r of Object.values(faceRects(c))) area += r.w * r.h;
  return { texture_size: [tw, th], cubes: model.bones.reduce((n, b) => n + b.cubes.length, 0), coverage: Number((area / (tw * th)).toFixed(3)) };
}

