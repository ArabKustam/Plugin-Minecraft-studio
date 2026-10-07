import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  FACES,
  loadAnimations,
  normalizeModel,
  renderAnimationSheet,
  renderTurnaround,
  validateAnimations,
  validateModel
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
  writePng
} from "./chunks/chunk-3P6ZCJ33.mjs";
import {
  StudioError,
  readJson,
  slugify,
  writeJson
} from "./chunks/chunk-5XAWRH4I.mjs";

// src/mcp/studio-model.js
import path from "node:path";

// src/lib/model/export.js
import fs from "node:fs";
import crypto from "node:crypto";
var r4 = (v) => Math.round(v * 1e4) / 1e4;
function toJavaModel(src, { parent = null, ambientocclusion = true } = {}) {
  const m = normalizeModel(src);
  const [tw, th] = m.texture_size;
  const textures = {};
  for (const key of Object.keys(m.textures)) {
    const ref = m.texture_refs[key];
    if (!ref) throw new StudioError("E_MODEL", `texture_refs.${key} (e.g. "ns:block/name") is required for Java export`);
    textures[key] = ref;
  }
  textures.particle = textures.particle || textures[Object.keys(m.textures)[0]];
  const elements = [];
  for (const b of m.bones) for (const c of b.cubes) {
    const el = { name: `${b.name}/${c.name}`, from: c.from.map((v) => r4(v - c.inflate)), to: c.to.map((v) => r4(v + c.inflate)), faces: {} };
    if (c.rotation && c.rotation.angle) el.rotation = { angle: c.rotation.angle, axis: c.rotation.axis, origin: c.rotation.origin || b.pivot, ...c.rotation.rescale ? { rescale: true } : {} };
    for (const f of FACES) {
      const d = c.faces[f];
      if (!d) continue;
      el.faces[f] = { uv: [r4(d.uv[0] * 16 / tw), r4(d.uv[1] * 16 / th), r4(d.uv[2] * 16 / tw), r4(d.uv[3] * 16 / th)], texture: `#${d.texture}` };
      if (d.rotation) el.faces[f].rotation = d.rotation;
      if (d.cullface) el.faces[f].cullface = d.cullface;
      if (d.tintindex !== void 0) el.faces[f].tintindex = d.tintindex;
    }
    if (c.emissive) el.light_emission = 15;
    elements.push(el);
  }
  const out = { ...parent ? { parent } : {}, ...ambientocclusion ? {} : { ambientocclusion: false }, textures, elements };
  if (m.display) out.display = m.display;
  return out;
}
function toBedrockGeometry(src, { identifier = null, origin = [8, 0, 8] } = {}) {
  const m = normalizeModel(src);
  const [tw, th] = m.texture_size;
  const bones = m.bones.map((b) => ({
    name: b.name,
    ...b.parent ? { parent: b.parent } : {},
    pivot: [r4(-(b.pivot[0] - origin[0])), r4(b.pivot[1] - origin[1]), r4(b.pivot[2] - origin[2])],
    ...b.rotation.some((v) => v) ? { rotation: [-b.rotation[0], -b.rotation[1], b.rotation[2]] } : {},
    cubes: b.cubes.map((c) => {
      const cube = {
        origin: [r4(-(c.to[0] - origin[0])), r4(c.from[1] - origin[1]), r4(c.from[2] - origin[2])],
        size: c.size.map(r4),
        uv: c.box_uv ? c.box_uv : Object.fromEntries(Object.entries(c.faces).map(([f, d]) => [f, { uv: [d.uv[0], d.uv[1]], uv_size: [r4(d.uv[2] - d.uv[0]), r4(d.uv[3] - d.uv[1])] }]))
      };
      if (c.inflate) cube.inflate = c.inflate;
      if (c.rotation?.angle) {
        const rot = [0, 0, 0];
        rot["xyz".indexOf(c.rotation.axis)] = c.rotation.axis === "z" ? c.rotation.angle : -c.rotation.angle;
        cube.rotation = rot;
        const o = c.rotation.origin || b.pivot;
        cube.pivot = [r4(-(o[0] - origin[0])), r4(o[1] - origin[1]), r4(o[2] - origin[2])];
      }
      return cube;
    })
  }));
  return {
    format_version: "1.12.0",
    "minecraft:geometry": [{
      description: { identifier: identifier || `geometry.${m.name}`, texture_width: tw, texture_height: th, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 1, 0] },
      bones
    }]
  };
}
var uuid = () => crypto.randomUUID();
function toBbmodel(src, { animations = null, resolveTexture = (p) => p, modelFormat = "free" } = {}) {
  const m = normalizeModel(src);
  const [tw, th] = m.texture_size;
  const texKeys = Object.keys(m.textures);
  const textures = texKeys.map((key, i) => {
    const abs = resolveTexture(m.textures[key]);
    let source = "";
    try {
      source = `data:image/png;base64,${fs.readFileSync(abs).toString("base64")}`;
    } catch {
    }
    return { path: abs, name: `${key}.png`, folder: "block", namespace: "", id: String(i), width: tw, height: th, uv_width: tw, uv_height: th, particle: i === 0, render_mode: "default", render_sides: "auto", visible: true, internal: true, saved: true, uuid: uuid(), source };
  });
  const elements = [];
  const groupUuid = {};
  const groups = {};
  for (const b of m.bones) {
    groupUuid[b.name] = uuid();
    groups[b.name] = { name: b.name, origin: b.pivot, rotation: b.rotation, color: 0, uuid: groupUuid[b.name], export: true, isOpen: true, locked: false, visibility: true, autouv: 0, children: [] };
  }
  for (const b of m.bones) {
    for (const c of b.cubes) {
      const id = uuid();
      const rot = [0, 0, 0];
      if (c.rotation?.angle) rot["xyz".indexOf(c.rotation.axis)] = c.rotation.angle;
      elements.push({
        name: c.name,
        box_uv: false,
        rescale: false,
        locked: false,
        render_order: "default",
        allow_mirror_modeling: true,
        from: c.from,
        to: c.to,
        autouv: 0,
        color: elements.length % 8,
        inflate: c.inflate,
        origin: c.rotation?.origin || b.pivot,
        rotation: rot,
        faces: Object.fromEntries(FACES.map((f) => [f, c.faces[f] ? { uv: c.faces[f].uv, texture: texKeys.indexOf(c.faces[f].texture) } : { uv: [0, 0, 0, 0], texture: null }])),
        type: "cube",
        uuid: id
      });
      groups[b.name].children.push(id);
    }
  }
  for (const b of m.bones) if (b.parent) groups[b.parent].children.push(groups[b.name]);
  const outliner = m.bones.filter((b) => !b.parent).map((b) => groups[b.name]);
  const anims = animations ? loadAnimations(animations).map((a) => ({
    uuid: uuid(),
    name: a.name,
    loop: a.loop ? "loop" : a.hold ? "hold" : "once",
    override: false,
    length: a.length,
    snapping: 24,
    selected: false,
    anim_time_update: "",
    blend_weight: "",
    start_delay: "",
    loop_delay: "",
    animators: Object.fromEntries(Object.entries(a.bones).filter(([bone]) => groupUuid[bone]).map(([bone, chans]) => [groupUuid[bone], {
      name: bone,
      type: "bone",
      keyframes: Object.entries(chans).flatMap(([channel, kfs]) => kfs.map((k) => ({ channel, data_points: [{ x: k.v[0], y: k.v[1], z: k.v[2] }], uuid: uuid(), time: k.t, color: -1, interpolation: k.lerp === "catmullrom" ? "catmullrom" : k.lerp === "step" ? "step" : "linear" })))
    }]))
  })) : [];
  return {
    meta: { format_version: "5.0", model_format: modelFormat, box_uv: false },
    name: m.name,
    model_identifier: m.name,
    visible_box: [1, 1, 0],
    variable_placeholders: "",
    variable_placeholder_buttons: [],
    timeline_setups: [],
    unhandled_root_fields: {},
    resolution: { width: tw, height: th },
    elements,
    outliner,
    textures,
    animations: anims
  };
}

// src/mcp/studio-model.js
var server = createServer("studio-model", "Minecraft Studio modelling & animation. Author models as minecraft-studio-model/1 sources (bones, pivots, cubes, UVs in texture pixels), validate, render turnarounds and review them visually before export. Animations use Bedrock/Blockbench animation JSON; review contact sheets for timing and clipping. For live editing in Blockbench connect a Blockbench MCP server (see docs/modeling.md).");
var loadModel = (studio, a) => a.model ? a.model : readJson(studio.abs(a.model_path));
var loadAnim = (studio, a) => a.animations ? a.animations : readJson(studio.abs(a.animations_path));
var modelInput = {
  model: external_exports.record(external_exports.string(), external_exports.any()).optional().describe("minecraft-studio-model/1 object"),
  model_path: external_exports.string().optional().describe("Project-relative model source JSON")
};
tool(server, "model_validate", {
  title: "Validate model source",
  capability: "read",
  description: "Structure, cube budget, micro-geometry, UV bounds, face coverage, pivot placement and target constraints (java: -16..32 bounds, single-axis 22.5\xB0 rotations, no bone rotations).",
  input: { ...modelInput, target: external_exports.enum(["java", "bedrock", "bbmodel"]).optional(), cube_budget: external_exports.number().int().optional() }
}, async (a, { studio }) => {
  requireOneOf(a, ["model", "model_path"]);
  return validateModel(loadModel(studio, a), { target: a.target || "java", cubeBudget: a.cube_budget || 120 });
});
tool(server, "model_render", {
  title: "Render model turnaround",
  capability: "read",
  description: "Software-render the model (textured, shaded) from GUI iso, back iso, front and top views; returns the image for visual review. Optional pose: {bone: {rotation:[x,y,z], position:[..]}}.",
  input: { ...modelInput, pose: external_exports.record(external_exports.string(), external_exports.any()).optional(), size: external_exports.number().int().optional() }
}, async (a, { studio }) => {
  requireOneOf(a, ["model", "model_path"]);
  const src = loadModel(studio, a);
  const r = renderTurnaround(src, { resolveTexture: (p) => studio.abs(p), size: a.size || 256, pose: a.pose || {} });
  const pp = studio.p("previews", `model_${slugify(src.name || "model")}.png`);
  writePng(pp, r.image);
  return { preview: studio.rel(pp), views: r.views, missing_textures: r.missing_textures, _images: [pp] };
});
tool(server, "model_export", {
  title: "Export model",
  capability: "write",
  description: "Export a model source to Java block/item model JSON, Bedrock geometry and/or a Blockbench .bbmodel (textures embedded, animations included). Saves the source, renders a preview and optionally registers the asset.",
  input: {
    ...modelInput,
    java: external_exports.string().optional().describe("Output path for Java model JSON, e.g. resourcepack/assets/ns/models/item/reactor_core.json"),
    java_parent: external_exports.string().optional(),
    bedrock: external_exports.string().optional().describe("Output path for Bedrock geometry JSON"),
    bbmodel: external_exports.string().optional().describe("Output path for Blockbench project"),
    animations_path: external_exports.string().optional().describe("Animation JSON to embed into the .bbmodel"),
    asset: assetInput
  }
}, async (a, { studio }) => {
  requireOneOf(a, ["model", "model_path"]);
  requireOneOf(a, ["java", "bedrock", "bbmodel"]);
  const src = loadModel(studio, a);
  normalizeModel(src);
  const files = [];
  const warnings = [];
  if (a.java) {
    const v = validateModel(src, { target: "java" });
    if (v.verdict === "fail") throw new StudioError("E_MODEL", `Java export blocked: ${v.checks.filter((c) => c.status === "fail").map((c) => c.detail).join("; ")}`);
    warnings.push(...v.checks.filter((c) => c.status === "warn").map((c) => c.detail));
    writeJson(studio.abs(a.java), toJavaModel(src, { parent: a.java_parent }));
    files.push(a.java);
  }
  if (a.bedrock) {
    writeJson(studio.abs(a.bedrock), toBedrockGeometry(src));
    files.push(a.bedrock);
  }
  if (a.bbmodel) {
    const anims = a.animations_path ? readJson(studio.abs(a.animations_path)) : null;
    writeJson(studio.abs(a.bbmodel), toBbmodel(src, { animations: anims, resolveTexture: (p) => studio.abs(p) }));
    files.push(a.bbmodel);
  }
  let sourceRel = a.model_path || null;
  if (!sourceRel && a.asset) {
    const sf = studio.p("sources", a.asset.id, `${slugify(src.name || "model")}.model.json`);
    writeJson(sf, src);
    sourceRel = studio.rel(sf);
  }
  if (sourceRel && a.asset) files.push({ path: sourceRel, role: "source" });
  const r = renderTurnaround(src, { resolveTexture: (p) => studio.abs(p) });
  const pp = studio.p("previews", `model_${slugify(src.name || "model")}.png`);
  writePng(pp, r.image);
  const textureAssets = studio.isInitialized() ? studio.listAssets({ type: "texture" }).filter((t) => Object.values(src.textures).some((p) => t.files.some((f) => f.path === p))).map((t) => t.id) : [];
  const reg = registerOutput(studio, a.asset ? { dependencies: textureAssets, ...a.asset } : null, { type: "model", files: files.map((f) => typeof f === "string" ? f : f), source: { provider: "studio-model", format: "minecraft-studio-model/1", source_files: sourceRel ? [sourceRel] : [] }, preview: studio.rel(pp), metadata: { bones: src.bones?.map((b) => b.name), texture_size: src.texture_size } });
  return { files: files.map((f) => typeof f === "string" ? f : f.path), warnings, preview: studio.rel(pp), asset: reg, _images: [pp] };
});
tool(server, "model_import_java", {
  title: "Import Java model",
  capability: "read",
  description: 'Convert an existing Java block/item model JSON into an editable minecraft-studio-model/1 source (single "root" bone). Texture variables map to project paths using the namespace layout.',
  input: { path: external_exports.string(), pack_dir: external_exports.string().describe("Resource pack root containing assets/"), texture_size: external_exports.array(external_exports.number().int()).length(2).optional() }
}, async (a, { studio }) => {
  const m = readJson(studio.abs(a.path));
  if (!m.elements) throw new StudioError("E_MODEL", "Model has no elements (inherits geometry from a parent?)");
  const ts = a.texture_size || [16, 16];
  const textures = {}, refs = {};
  for (const [k, v] of Object.entries(m.textures || {})) {
    if (typeof v !== "string" || v.startsWith("#")) continue;
    const [ns, p] = v.includes(":") ? v.split(":") : ["minecraft", v];
    textures[k] = `${a.pack_dir.replace(/\/$/, "")}/assets/${ns}/textures/${p}.png`;
    refs[k] = v;
  }
  const resolveVar = (t) => {
    let key = t.replace(/^#/, "");
    for (let i = 0; i < 8 && typeof m.textures?.[key] === "string" && m.textures[key].startsWith("#"); i++) key = m.textures[key].slice(1);
    return key;
  };
  return {
    format: "minecraft-studio-model/1",
    name: path.basename(a.path, ".json"),
    texture_size: ts,
    textures,
    texture_refs: refs,
    bones: [{ name: "root", pivot: [8, 0, 8], cubes: m.elements.map((el, i) => ({
      name: el.name || `element_${i}`,
      from: el.from,
      to: el.to,
      ...el.rotation ? { rotation: el.rotation } : {},
      faces: Object.fromEntries(Object.entries(el.faces || {}).map(([f, d]) => [f, { texture: resolveVar(d.texture), uv: (d.uv || [0, 0, 16, 16]).map((v, k) => v * (k % 2 ? ts[1] : ts[0]) / 16), ...d.cullface ? { cullface: d.cullface } : {}, ...d.rotation ? { rotation: d.rotation } : {} }]))
    })) }],
    display: m.display || null
  };
});
tool(server, "animation_validate", {
  title: "Validate animations",
  capability: "read",
  description: "Check Bedrock/Blockbench animation JSON: lengths, bone references (against a model), keyframes past the end, snapping/angular speed, loop seams and missing easing.",
  input: { animations: external_exports.record(external_exports.string(), external_exports.any()).optional(), animations_path: external_exports.string().optional(), ...modelInput }
}, async (a, { studio }) => {
  requireOneOf(a, ["animations", "animations_path"]);
  const boneNames = a.model || a.model_path ? normalizeModel(loadModel(studio, a)).bones.map((b) => b.name) : null;
  return validateAnimations(loadAnim(studio, a), { boneNames });
});
tool(server, "animation_render", {
  title: "Render animation contact sheet",
  capability: "read",
  description: "Render N frames of an animation on the model into a grid image (left\u2192right, top\u2192bottom) for timing/clipping review.",
  input: { ...modelInput, animations: external_exports.record(external_exports.string(), external_exports.any()).optional(), animations_path: external_exports.string().optional(), animation: external_exports.string().describe("Animation name, e.g. animation.reactor.startup"), frames: external_exports.number().int().min(1).max(16).optional(), yaw: external_exports.number().optional(), pitch: external_exports.number().optional() }
}, async (a, { studio }) => {
  requireOneOf(a, ["model", "model_path"]);
  requireOneOf(a, ["animations", "animations_path"]);
  const src = loadModel(studio, a);
  const anim = loadAnimations(loadAnim(studio, a)).find((x) => x.name === a.animation);
  if (!anim) throw new StudioError("E_NOT_FOUND", `Animation ${a.animation} not found`);
  const r = renderAnimationSheet(src, anim, { resolveTexture: (p) => studio.abs(p), frames: a.frames || 8, yaw: a.yaw ?? 225, pitch: a.pitch ?? 30 });
  const pp = studio.p("previews", `anim_${slugify(a.animation)}.png`);
  writePng(pp, r.image);
  return { preview: studio.rel(pp), times: r.times, layout: r.layout, loop: anim.loop, length: anim.length, _images: [pp] };
});
tool(server, "animation_save", {
  title: "Save animations",
  capability: "write",
  description: "Validate and save an animation file (Bedrock format) and optionally register it as an animation asset linked to its model asset.",
  input: { animations: external_exports.record(external_exports.string(), external_exports.any()), output: external_exports.string(), model_asset: external_exports.string().optional(), ...modelInput, asset: assetInput }
}, async (a, { studio }) => {
  const boneNames = a.model || a.model_path ? normalizeModel(loadModel(studio, a)).bones.map((b) => b.name) : null;
  const v = validateAnimations(a.animations, { boneNames });
  if (v.verdict === "fail") return { saved: false, validation: v };
  writeJson(studio.abs(a.output), a.animations);
  const reg = registerOutput(studio, a.asset ? { ...a.asset, dependencies: [...a.asset.dependencies || [], ...a.model_asset ? [a.model_asset] : []] } : null, { type: "animation", files: [a.output], source: { provider: "studio-model", format: "bedrock-animation/1.8.0" }, metadata: { animations: v.animations.map((x) => ({ name: x.name, length: x.length, loop: x.loop, bones: x.bones })) } });
  return { saved: true, output: a.output, validation: v, asset: reg };
});
await start(server);
