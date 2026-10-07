// studio-model MCP server: model sources → Java / Bedrock / Blockbench,
// validation, turnaround renders and animation contact sheets.
import path from 'node:path';
import { createServer, tool, start, z, assetInput, registerOutput, requireOneOf } from './common.js';
import { validateModel, normalizeModel } from '../lib/model/spec.js';
import { toJavaModel, toBedrockGeometry, toBbmodel } from '../lib/model/export.js';
import { renderTurnaround, renderAnimationSheet } from '../lib/model/render.js';
import { validateAnimations, loadAnimations } from '../lib/model/animation.js';
import { writePng } from '../lib/texture/image.js';
import { readJson, writeJson, slugify, StudioError } from '../lib/core/fsutil.js';

const server = createServer('studio-model', 'Minecraft Studio modelling & animation. Author models as minecraft-studio-model/1 sources (bones, pivots, cubes, UVs in texture pixels), validate, render turnarounds and review them visually before export. Animations use Bedrock/Blockbench animation JSON; review contact sheets for timing and clipping. For live editing in Blockbench connect a Blockbench MCP server (see docs/modeling.md).');

const loadModel = (studio, a) => (a.model ? a.model : readJson(studio.abs(a.model_path)));
const loadAnim = (studio, a) => (a.animations ? a.animations : readJson(studio.abs(a.animations_path)));
const modelInput = {
  model: z.record(z.string(), z.any()).optional().describe('minecraft-studio-model/1 object'),
  model_path: z.string().optional().describe('Project-relative model source JSON'),
};

tool(server, 'model_validate', {
  title: 'Validate model source', capability: 'read',
  description: 'Structure, cube budget, micro-geometry, UV bounds, face coverage, pivot placement and target constraints (java: -16..32 bounds, single-axis 22.5° rotations, no bone rotations).',
  input: { ...modelInput, target: z.enum(['java', 'bedrock', 'bbmodel']).optional(), cube_budget: z.number().int().optional() },
}, async (a, { studio }) => { requireOneOf(a, ['model', 'model_path']); return validateModel(loadModel(studio, a), { target: a.target || 'java', cubeBudget: a.cube_budget || 120 }); });

tool(server, 'model_render', {
  title: 'Render model turnaround', capability: 'read',
  description: 'Software-render the model (textured, shaded) from GUI iso, back iso, front and top views; returns the image for visual review. Optional pose: {bone: {rotation:[x,y,z], position:[..]}}.',
  input: { ...modelInput, pose: z.record(z.string(), z.any()).optional(), size: z.number().int().optional() },
}, async (a, { studio }) => {
  requireOneOf(a, ['model', 'model_path']);
  const src = loadModel(studio, a);
  const r = renderTurnaround(src, { resolveTexture: (p) => studio.abs(p), size: a.size || 256, pose: a.pose || {} });
  const pp = studio.p('previews', `model_${slugify(src.name || 'model')}.png`);
  writePng(pp, r.image);
  return { preview: studio.rel(pp), views: r.views, missing_textures: r.missing_textures, _images: [pp] };
});

tool(server, 'model_export', {
  title: 'Export model', capability: 'write',
  description: 'Export a model source to Java block/item model JSON, Bedrock geometry and/or a Blockbench .bbmodel (textures embedded, animations included). Saves the source, renders a preview and optionally registers the asset.',
  input: {
    ...modelInput,
    java: z.string().optional().describe('Output path for Java model JSON, e.g. resourcepack/assets/ns/models/item/reactor_core.json'),
    java_parent: z.string().optional(),
    bedrock: z.string().optional().describe('Output path for Bedrock geometry JSON'),
    bbmodel: z.string().optional().describe('Output path for Blockbench project'),
    animations_path: z.string().optional().describe('Animation JSON to embed into the .bbmodel'),
    asset: assetInput,
  },
}, async (a, { studio }) => {
  requireOneOf(a, ['model', 'model_path']);
  requireOneOf(a, ['java', 'bedrock', 'bbmodel']);
  const src = loadModel(studio, a);
  normalizeModel(src);
  const files = [];
  const warnings = [];
  if (a.java) {
    const v = validateModel(src, { target: 'java' });
    if (v.verdict === 'fail') throw new StudioError('E_MODEL', `Java export blocked: ${v.checks.filter((c) => c.status === 'fail').map((c) => c.detail).join('; ')}`);
    warnings.push(...v.checks.filter((c) => c.status === 'warn').map((c) => c.detail));
    writeJson(studio.abs(a.java), toJavaModel(src, { parent: a.java_parent }));
    files.push(a.java);
  }
  if (a.bedrock) { writeJson(studio.abs(a.bedrock), toBedrockGeometry(src)); files.push(a.bedrock); }
  if (a.bbmodel) {
    const anims = a.animations_path ? readJson(studio.abs(a.animations_path)) : null;
    writeJson(studio.abs(a.bbmodel), toBbmodel(src, { animations: anims, resolveTexture: (p) => studio.abs(p) }));
    files.push(a.bbmodel);
  }
  let sourceRel = a.model_path || null;
  if (!sourceRel && a.asset) { const sf = studio.p('sources', a.asset.id, `${slugify(src.name || 'model')}.model.json`); writeJson(sf, src); sourceRel = studio.rel(sf); }
  if (sourceRel && a.asset) files.push({ path: sourceRel, role: 'source' });
  const r = renderTurnaround(src, { resolveTexture: (p) => studio.abs(p) });
  const pp = studio.p('previews', `model_${slugify(src.name || 'model')}.png`);
  writePng(pp, r.image);
  const textureAssets = studio.isInitialized() ? studio.listAssets({ type: 'texture' }).filter((t) => Object.values(src.textures).some((p) => t.files.some((f) => f.path === p))).map((t) => t.id) : [];
  const reg = registerOutput(studio, a.asset ? { dependencies: textureAssets, ...a.asset } : null, { type: 'model', files: files.map((f) => (typeof f === 'string' ? f : f)), source: { provider: 'studio-model', format: 'minecraft-studio-model/1', source_files: sourceRel ? [sourceRel] : [] }, preview: studio.rel(pp), metadata: { bones: src.bones?.map((b) => b.name), texture_size: src.texture_size } });
  return { files: files.map((f) => (typeof f === 'string' ? f : f.path)), warnings, preview: studio.rel(pp), asset: reg, _images: [pp] };
});

tool(server, 'model_import_java', {
  title: 'Import Java model', capability: 'read',
  description: 'Convert an existing Java block/item model JSON into an editable minecraft-studio-model/1 source (single "root" bone). Texture variables map to project paths using the namespace layout.',
  input: { path: z.string(), pack_dir: z.string().describe('Resource pack root containing assets/'), texture_size: z.array(z.number().int()).length(2).optional() },
}, async (a, { studio }) => {
  const m = readJson(studio.abs(a.path));
  if (!m.elements) throw new StudioError('E_MODEL', 'Model has no elements (inherits geometry from a parent?)');
  const ts = a.texture_size || [16, 16];
  const textures = {}, refs = {};
  for (const [k, v] of Object.entries(m.textures || {})) {
    if (typeof v !== 'string' || v.startsWith('#')) continue;
    const [ns, p] = v.includes(':') ? v.split(':') : ['minecraft', v];
    textures[k] = `${a.pack_dir.replace(/\/$/, '')}/assets/${ns}/textures/${p}.png`;
    refs[k] = v;
  }
  const resolveVar = (t) => { let key = t.replace(/^#/, ''); for (let i = 0; i < 8 && typeof m.textures?.[key] === 'string' && m.textures[key].startsWith('#'); i++) key = m.textures[key].slice(1); return key; };
  return {
    format: 'minecraft-studio-model/1', name: path.basename(a.path, '.json'), texture_size: ts, textures, texture_refs: refs,
    bones: [{ name: 'root', pivot: [8, 0, 8], cubes: m.elements.map((el, i) => ({
      name: el.name || `element_${i}`, from: el.from, to: el.to, ...(el.rotation ? { rotation: el.rotation } : {}),
      faces: Object.fromEntries(Object.entries(el.faces || {}).map(([f, d]) => [f, { texture: resolveVar(d.texture), uv: (d.uv || [0, 0, 16, 16]).map((v, k) => (v * (k % 2 ? ts[1] : ts[0])) / 16), ...(d.cullface ? { cullface: d.cullface } : {}), ...(d.rotation ? { rotation: d.rotation } : {}) }])),
    })) }],
    display: m.display || null,
  };
});

tool(server, 'animation_validate', {
  title: 'Validate animations', capability: 'read',
  description: 'Check Bedrock/Blockbench animation JSON: lengths, bone references (against a model), keyframes past the end, snapping/angular speed, loop seams and missing easing.',
  input: { animations: z.record(z.string(), z.any()).optional(), animations_path: z.string().optional(), ...modelInput },
}, async (a, { studio }) => {
  requireOneOf(a, ['animations', 'animations_path']);
  const boneNames = a.model || a.model_path ? normalizeModel(loadModel(studio, a)).bones.map((b) => b.name) : null;
  return validateAnimations(loadAnim(studio, a), { boneNames });
});

tool(server, 'animation_render', {
  title: 'Render animation contact sheet', capability: 'read',
  description: 'Render N frames of an animation on the model into a grid image (left→right, top→bottom) for timing/clipping review.',
  input: { ...modelInput, animations: z.record(z.string(), z.any()).optional(), animations_path: z.string().optional(), animation: z.string().describe('Animation name, e.g. animation.reactor.startup'), frames: z.number().int().min(1).max(16).optional(), yaw: z.number().optional(), pitch: z.number().optional() },
}, async (a, { studio }) => {
  requireOneOf(a, ['model', 'model_path']);
  requireOneOf(a, ['animations', 'animations_path']);
  const src = loadModel(studio, a);
  const anim = loadAnimations(loadAnim(studio, a)).find((x) => x.name === a.animation);
  if (!anim) throw new StudioError('E_NOT_FOUND', `Animation ${a.animation} not found`);
  const r = renderAnimationSheet(src, anim, { resolveTexture: (p) => studio.abs(p), frames: a.frames || 8, yaw: a.yaw ?? 225, pitch: a.pitch ?? 30 });
  const pp = studio.p('previews', `anim_${slugify(a.animation)}.png`);
  writePng(pp, r.image);
  return { preview: studio.rel(pp), times: r.times, layout: r.layout, loop: anim.loop, length: anim.length, _images: [pp] };
});

tool(server, 'animation_save', {
  title: 'Save animations', capability: 'write',
  description: 'Validate and save an animation file (Bedrock format) and optionally register it as an animation asset linked to its model asset.',
  input: { animations: z.record(z.string(), z.any()), output: z.string(), model_asset: z.string().optional(), ...modelInput, asset: assetInput },
}, async (a, { studio }) => {
  const boneNames = a.model || a.model_path ? normalizeModel(loadModel(studio, a)).bones.map((b) => b.name) : null;
  const v = validateAnimations(a.animations, { boneNames });
  if (v.verdict === 'fail') return { saved: false, validation: v };
  writeJson(studio.abs(a.output), a.animations);
  const reg = registerOutput(studio, a.asset ? { ...a.asset, dependencies: [...(a.asset.dependencies || []), ...(a.model_asset ? [a.model_asset] : [])] } : null, { type: 'animation', files: [a.output], source: { provider: 'studio-model', format: 'bedrock-animation/1.8.0' }, metadata: { animations: v.animations.map((x) => ({ name: x.name, length: x.length, loop: x.loop, bones: x.bones })) } });
  return { saved: true, output: a.output, validation: v, asset: reg };
});

await start(server);
