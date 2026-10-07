import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  blit,
  createImage,
  getPx,
  readPng,
  setPx
} from "./chunk-X2ZWGV6D.mjs";
import {
  StudioError
} from "./chunk-RRZML6EW.mjs";

// src/lib/model/spec.js
var FACES = ["north", "south", "east", "west", "up", "down"];
var vec3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== "number" || !Number.isFinite(n))) throw new StudioError("E_MODEL", `${what} must be [x, y, z] numbers`);
  return v;
};
function boxUvFaces(u, v, size, texture) {
  const [dx, dy, dz] = size.map((s) => Math.abs(s));
  return {
    east: { texture, uv: [u, v + dz, u + dz, v + dz + dy] },
    north: { texture, uv: [u + dz, v + dz, u + dz + dx, v + dz + dy] },
    west: { texture, uv: [u + dz + dx, v + dz, u + 2 * dz + dx, v + dz + dy] },
    south: { texture, uv: [u + 2 * dz + dx, v + dz, u + 2 * dz + 2 * dx, v + dz + dy] },
    up: { texture, uv: [u + dz, v, u + dz + dx, v + dz] },
    down: { texture, uv: [u + dz + dx, v + dz, u + dz + 2 * dx, v] }
  };
}
function normalizeModel(src) {
  if (!src || typeof src !== "object") throw new StudioError("E_MODEL", "Model source must be an object");
  if (src.format && src.format !== "minecraft-studio-model/1") throw new StudioError("E_MODEL", `Unsupported model format ${src.format}`);
  const textures = src.textures || {};
  const textureKeys = Object.keys(textures);
  if (!textureKeys.length) throw new StudioError("E_MODEL", "Model needs at least one texture");
  const ts = src.texture_size || [16, 16];
  const names = /* @__PURE__ */ new Set();
  const bones = (src.bones || []).map((b) => {
    if (!b.name || names.has(b.name)) throw new StudioError("E_MODEL", `Bone names must be unique and non-empty (${b.name})`);
    names.add(b.name);
    return {
      name: b.name,
      parent: b.parent || null,
      pivot: vec3(b.pivot || [0, 0, 0], `bone ${b.name} pivot`),
      rotation: vec3(b.rotation || [0, 0, 0], `bone ${b.name} rotation`),
      cubes: (b.cubes || []).map((c, i) => {
        const from = vec3(c.from, `${b.name}.cube[${i}].from`), to = vec3(c.to, `${b.name}.cube[${i}].to`);
        const size = to.map((t, k) => t - from[k]);
        if (size.some((s) => s < 0)) throw new StudioError("E_MODEL", `${b.name}.cube[${i}] has to < from`);
        let faces = c.faces;
        if (!faces && c.box_uv) faces = boxUvFaces(c.box_uv[0], c.box_uv[1], size, c.texture || textureKeys[0]);
        if (!faces) throw new StudioError("E_MODEL", `${b.name}.cube[${i}] needs faces or box_uv`);
        for (const [f, def] of Object.entries(faces)) {
          if (!FACES.includes(f)) throw new StudioError("E_MODEL", `Unknown face ${f}`);
          if (!textures[def.texture]) throw new StudioError("E_MODEL", `${b.name}.cube[${i}].${f} references unknown texture "${def.texture}"`);
          if (!Array.isArray(def.uv) || def.uv.length !== 4) throw new StudioError("E_MODEL", `${b.name}.cube[${i}].${f} uv must be [u1,v1,u2,v2]`);
        }
        return { name: c.name || `${b.name}_${i}`, from, to, size, faces, inflate: c.inflate || 0, rotation: c.rotation || null, emissive: !!c.emissive, box_uv: c.box_uv || null };
      })
    };
  });
  for (const b of bones) if (b.parent && !names.has(b.parent)) throw new StudioError("E_MODEL", `Bone ${b.name} has unknown parent ${b.parent}`);
  for (const b of bones) {
    let cur = b, depth = 0;
    while (cur?.parent) {
      cur = bones.find((x) => x.name === cur.parent);
      if (++depth > 64) throw new StudioError("E_MODEL", `Bone hierarchy cycle at ${b.name}`);
    }
  }
  return { format: "minecraft-studio-model/1", name: src.name || "model", texture_size: ts, textures, texture_refs: src.texture_refs || {}, bones, display: src.display || null, notes: src.notes || null };
}
function validateModel(src, { target = "java", cubeBudget = 120 } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  let m;
  try {
    m = normalizeModel(src);
  } catch (e) {
    return { verdict: "fail", checks: [{ name: "structure", status: "fail", detail: e.message }] };
  }
  add("structure", "pass", `${m.bones.length} bones`);
  const cubes = m.bones.flatMap((b) => b.cubes.map((c) => ({ ...c, bone: b.name })));
  add("cube budget", cubes.length <= cubeBudget ? "pass" : "warn", `${cubes.length} cubes (budget ${cubeBudget}; many tiny cubes hurt readability and performance)`);
  const tiny = cubes.filter((c) => c.size.filter((s) => s > 0).some((s) => s < 0.5));
  add("micro geometry", tiny.length === 0 ? "pass" : "warn", tiny.length ? `${tiny.length} cubes thinner than half a pixel: ${tiny.slice(0, 5).map((c) => c.name).join(", ")}` : "none");
  const [tw, th] = m.texture_size;
  const badUv = [];
  for (const c of cubes) for (const [f, d] of Object.entries(c.faces)) if (d.uv.some((v, i) => v < 0 || v > (i % 2 ? th : tw))) badUv.push(`${c.name}.${f}`);
  add("uv bounds", badUv.length ? "fail" : "pass", badUv.length ? `UVs outside texture: ${badUv.slice(0, 6).join(", ")}` : `all UVs within ${tw}\xD7${th}`);
  const missingFaces = cubes.filter((c) => Object.keys(c.faces).length < 6 && c.size.every((s) => s > 0));
  add("face coverage", missingFaces.length ? "warn" : "pass", missingFaces.length ? `${missingFaces.length} solid cubes have hidden/missing faces (ok if intentionally culled)` : "all faces mapped");
  if (target === "java") {
    const out = cubes.filter((c) => [...c.from, ...c.to].some((v) => v < -16 || v > 32));
    add("java bounds", out.length ? "fail" : "pass", out.length ? `${out.length} cubes outside the Java -16..32 limit` : "within -16..32");
    const badRot = cubes.filter((c) => c.rotation && (![-45, -22.5, 0, 22.5, 45].includes(c.rotation.angle) || !["x", "y", "z"].includes(c.rotation.axis)));
    add("java rotations", badRot.length ? "fail" : "pass", badRot.length ? `Java elements only rotate on one axis in 22.5\xB0 steps: ${badRot.map((c) => c.name).join(", ")}` : "ok");
    const boneRot = m.bones.filter((b) => b.rotation.some((r) => r !== 0));
    add("bone rotations", boneRot.length ? "warn" : "pass", boneRot.length ? `Java block models have no bones; rotations on ${boneRot.map((b) => b.name).join(", ")} are dropped on export. Animate these parts with display entities instead.` : "none");
  }
  const pivots = m.bones.filter((b) => b.cubes.length && !b.cubes.some((c) => c.from.every((v, i) => v <= b.pivot[i] + 16) && c.to.every((v, i) => v >= b.pivot[i] - 16)));
  add("pivot placement", pivots.length ? "warn" : "pass", pivots.length ? `pivots far from geometry: ${pivots.map((b) => b.name).join(", ")}` : "pivots near their geometry");
  const min = [0, 1, 2].map((i) => Math.min(...cubes.map((c) => c.from[i])));
  const max = [0, 1, 2].map((i) => Math.max(...cubes.map((c) => c.to[i])));
  const verdict = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";
  return { verdict, cubes: cubes.length, bones: m.bones.map((b) => ({ name: b.name, parent: b.parent, cubes: b.cubes.length })), bounds: { min, max, size_blocks: max.map((v, i) => Number(((v - min[i]) / 16).toFixed(2))) }, checks };
}

// src/lib/model/animation.js
var CHANNELS = ["rotation", "position", "scale"];
function parseKeyframes(channel) {
  if (Array.isArray(channel) || typeof channel === "number") return [{ t: 0, v: toVec(channel), lerp: "linear" }];
  return Object.entries(channel).map(([t, val]) => {
    const time = Number(t);
    if (!Number.isFinite(time)) throw new StudioError("E_ANIM", `Invalid keyframe time ${t}`);
    if (Array.isArray(val) || typeof val === "number") return { t: time, v: toVec(val), lerp: "linear" };
    const post = val.post ?? val.pre;
    if (post === void 0) throw new StudioError("E_ANIM", `Keyframe ${t} needs a vector or {post}`);
    return { t: time, v: toVec(post), pre: val.pre ? toVec(val.pre) : null, lerp: val.lerp_mode || "linear" };
  }).sort((a, b) => a.t - b.t);
}
function toVec(v) {
  if (typeof v === "number") return [v, v, v];
  if (!Array.isArray(v) || v.length !== 3) throw new StudioError("E_ANIM", `Keyframe value must be [x,y,z], got ${JSON.stringify(v)}`);
  return v.map((n) => {
    if (typeof n === "string") throw new StudioError("E_ANIM", `Molang expressions are not supported by the studio sampler: ${n}`);
    return n;
  });
}
var lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}
function sampleChannel(kfs, time) {
  if (!kfs.length) return null;
  if (time <= kfs[0].t) return kfs[0].pre || kfs[0].v;
  if (time >= kfs.at(-1).t) return kfs.at(-1).v;
  let i = kfs.findIndex((k) => k.t > time) - 1;
  const a = kfs[i], b = kfs[i + 1];
  const u = (time - a.t) / (b.t - a.t || 1);
  if (a.lerp === "step") return a.v;
  if (a.lerp === "catmullrom" || b.lerp === "catmullrom") {
    const p0 = kfs[Math.max(0, i - 1)].v, p3 = kfs[Math.min(kfs.length - 1, i + 2)].v;
    return catmull(p0, a.v, b.pre || b.v, p3, u);
  }
  return lerp(a.v, b.pre || b.v, u);
}
function loadAnimations(file) {
  if (!file?.animations) throw new StudioError("E_ANIM", 'Animation file must contain an "animations" object');
  return Object.entries(file.animations).map(([name, a]) => ({
    name,
    loop: a.loop === true || a.loop === "loop",
    hold: a.loop === "hold_on_last_frame",
    length: Number(a.animation_length ?? 0),
    bones: Object.fromEntries(Object.entries(a.bones || {}).map(([bone, chans]) => [bone, Object.fromEntries(CHANNELS.filter((c) => chans[c] !== void 0).map((c) => [c, parseKeyframes(chans[c])]))])),
    timeline: a.timeline || {}
  }));
}
function poseAt(anim, t) {
  const time = anim.loop && anim.length > 0 ? t % anim.length : Math.min(t, anim.length || t);
  const pose = {};
  for (const [bone, chans] of Object.entries(anim.bones)) {
    pose[bone] = {};
    for (const [c, kfs] of Object.entries(chans)) pose[bone][c] = sampleChannel(kfs, time);
  }
  return pose;
}
function validateAnimations(file, { boneNames = null, maxDegPerSecond = 720 } = {}) {
  const results = [];
  let anims;
  try {
    anims = loadAnimations(file);
  } catch (e) {
    return { verdict: "fail", animations: [], checks: [{ name: "structure", status: "fail", detail: e.message }] };
  }
  for (const a of anims) {
    const checks = [];
    const add = (name, status, detail) => checks.push({ name, status, detail });
    if (!(a.length > 0)) add("length", "fail", "animation_length must be > 0");
    else add("length", "pass", `${a.length}s`);
    if (boneNames) {
      const missing = Object.keys(a.bones).filter((b) => !boneNames.includes(b));
      add("bone references", missing.length ? "fail" : "pass", missing.length ? `unknown bones: ${missing.join(", ")}` : "all bones exist in model");
    }
    let late = 0, fastest = 0, fastestAt = null, linearOnly = true, seams = [];
    for (const [bone, chans] of Object.entries(a.bones)) {
      for (const [c, kfs] of Object.entries(chans)) {
        late += kfs.filter((k) => k.t > a.length + 1e-6).length;
        if (kfs.some((k) => k.lerp !== "linear") || kfs.length > 3) linearOnly = false;
        if (c === "rotation") {
          for (let i = 1; i < kfs.length; i++) {
            const dt = kfs[i].t - kfs[i - 1].t;
            const d = Math.max(...kfs[i].v.map((v, k) => Math.abs(v - kfs[i - 1].v[k])));
            const speed = dt > 0 ? d / dt : d > 0 ? Infinity : 0;
            if (speed > fastest) {
              fastest = speed;
              fastestAt = `${bone} ${kfs[i - 1].t}s\u2192${kfs[i].t}s`;
            }
          }
        }
        if (a.loop && kfs.length > 1) {
          const first = kfs[0].v, last = kfs.at(-1).v;
          const delta = Math.max(...first.map((v, k) => Math.abs(v - last[k])));
          const full = c === "rotation" && first.every((v, k) => Math.abs((last[k] - v) % 360) < 1e-6);
          if (delta > 1e-3 && !full) seams.push(`${bone}.${c}`);
          if (kfs.at(-1).t < a.length - 1e-6 && kfs.at(-1).t > 0) seams.push(`${bone}.${c} (ends at ${kfs.at(-1).t}s < length)`);
        }
      }
    }
    add("keyframes within length", late ? "warn" : "pass", late ? `${late} keyframes after animation_length` : "ok");
    add("angular speed", fastest === Infinity ? "fail" : fastest > maxDegPerSecond ? "warn" : "pass", fastest === Infinity ? `instant snap at ${fastestAt}` : `max ${Math.round(fastest)}\xB0/s${fastestAt ? ` at ${fastestAt}` : ""}`);
    if (a.loop) add("loop seam", seams.length ? "warn" : "pass", seams.length ? `first/last keyframes differ: ${seams.join(", ")}` : "seamless");
    add("easing", linearOnly && Object.keys(a.bones).length ? "warn" : "pass", linearOnly ? "only linear 2\u20133 key motion: consider anticipation, ease-in/out (catmullrom) or overshoot" : "eased / multi-key motion");
    const verdict2 = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";
    results.push({ name: a.name, length: a.length, loop: a.loop, bones: Object.keys(a.bones), timeline: a.timeline, verdict: verdict2, checks });
  }
  const verdict = results.some((r) => r.verdict === "fail") ? "fail" : results.some((r) => r.verdict === "warn") ? "warn" : "pass";
  return { verdict, animations: results };
}

// src/lib/model/render.js
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
var T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
var S = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
function RX(d) {
  const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}
function RY(d) {
  const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}
function RZ(d) {
  const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
var apply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
var rotXYZ = ([x, y, z]) => mul(RZ(z), mul(RY(y), RX(x)));
var FACE_CORNERS = {
  north: (f, t) => [[t[0], t[1], f[2]], [f[0], t[1], f[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]]],
  south: (f, t) => [[f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], f[1], t[2]], [f[0], f[1], t[2]]],
  east: (f, t) => [[t[0], t[1], t[2]], [t[0], t[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]],
  west: (f, t) => [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [f[0], f[1], t[2]], [f[0], f[1], f[2]]],
  up: (f, t) => [[f[0], t[1], f[2]], [t[0], t[1], f[2]], [t[0], t[1], t[2]], [f[0], t[1], t[2]]],
  down: (f, t) => [[f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]]]
};
var SHADE = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 };
function buildQuads(src, pose = {}) {
  const m = normalizeModel(src);
  const bones = new Map(m.bones.map((b) => [b.name, b]));
  const cache = /* @__PURE__ */ new Map();
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
        const r = c.rotation.axis === "x" ? RX(c.rotation.angle) : c.rotation.axis === "y" ? RY(c.rotation.angle) : RZ(c.rotation.angle);
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
function renderView(quads, textures, textureSize, { yaw = 225, pitch = 30, size = 256, background = [0, 0, 0, 0], bounds = null } = {}) {
  const view = mul(RX(-pitch), RY(yaw));
  const projected = quads.map((q) => ({ ...q, pts: q.corners.map((c) => apply(view, [c[0] - 8, c[1] - 8, c[2] - 8])) }));
  const all = bounds || projected.flatMap((q) => q.pts);
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = size * 0.86 / extent;
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
      const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(u / tw * tex.width - 1e-6)));
      const ty = Math.min(tex.height - 1, Math.max(0, Math.floor(v / th * Math.min(tex.height, tex.width * (th / tw)) - 1e-6)));
      color = getPx(tex, tx, ty);
      if (color[3] < 128) continue;
    }
    zbuf[idx] = z;
    setPx(img, x, y, [Math.min(255, color[0] * shade), Math.min(255, color[1] * shade), Math.min(255, color[2] * shade), 255].map(Math.round));
  }
}
function loadModelTextures(model, resolve) {
  const out = {};
  for (const [k, p] of Object.entries(model.textures)) {
    try {
      out[k] = readPng(resolve(p));
    } catch {
      out[k] = null;
    }
  }
  return out;
}
var VIEWS = [
  { name: "gui (front-left iso)", yaw: 225, pitch: 30 },
  { name: "back-right iso", yaw: 45, pitch: 30 },
  { name: "front (north)", yaw: 0, pitch: 0 },
  { name: "top", yaw: 0, pitch: 90 }
];
function sheetBg(w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(img, x, y, ((x >> 4) + (y >> 4)) % 2 ? [52, 54, 60, 255] : [44, 46, 52, 255]);
  return img;
}
function renderTurnaround(src, { resolveTexture, size = 256, pose = {} } = {}) {
  const { model, quads } = buildQuads(src, pose);
  const textures = loadModelTextures(model, resolveTexture);
  const sheet = sheetBg(size * VIEWS.length, size);
  VIEWS.forEach((v, i) => blit(sheet, renderView(quads, textures, model.texture_size, { ...v, size }), i * size, 0));
  return { image: sheet, views: VIEWS.map((v) => v.name), missing_textures: Object.entries(textures).filter(([, t]) => !t).map(([k]) => k) };
}
function renderAnimationSheet(src, anim, { resolveTexture, frames = 8, size = 192, yaw = 225, pitch = 30 } = {}) {
  const { model, quads: rest } = buildQuads(src);
  const textures = loadModelTextures(model, resolveTexture);
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
    blit(sheet, renderView(quads, textures, model.texture_size, { yaw, pitch, size, bounds: pad }), i % cols * size, Math.floor(i / cols) * size);
  }
  return { image: sheet, times, layout: `${cols}\xD7${rows} grid, left\u2192right, top\u2192bottom` };
}

export {
  FACES,
  boxUvFaces,
  normalizeModel,
  validateModel,
  loadAnimations,
  validateAnimations,
  renderTurnaround,
  renderAnimationSheet
};
