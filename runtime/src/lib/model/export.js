// Exporters from the studio model source to Minecraft & Blockbench formats.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { StudioError } from '../core/fsutil.js';
import { normalizeModel, FACES } from './spec.js';
import { loadAnimations } from './animation.js';

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Java Edition block/item model JSON (elements). Bones are flattened. */
export function toJavaModel(src, { parent = null, ambientocclusion = true } = {}) {
  const m = normalizeModel(src);
  const [tw, th] = m.texture_size;
  const textures = {};
  for (const key of Object.keys(m.textures)) {
    const ref = m.texture_refs[key];
    if (!ref) throw new StudioError('E_MODEL', `texture_refs.${key} (e.g. "ns:block/name") is required for Java export`);
    textures[key] = ref;
  }
  textures.particle = textures.particle || textures[Object.keys(m.textures)[0]];
  const elements = [];
  for (const b of m.bones) for (const c of b.cubes) {
    const el = { name: `${b.name}/${c.name}`, from: c.from.map((v) => r4(v - c.inflate)), to: c.to.map((v) => r4(v + c.inflate)), faces: {} };
    if (c.rotation && c.rotation.angle) el.rotation = { angle: c.rotation.angle, axis: c.rotation.axis, origin: c.rotation.origin || b.pivot, ...(c.rotation.rescale ? { rescale: true } : {}) };
    for (const f of FACES) {
      const d = c.faces[f];
      if (!d) continue;
      el.faces[f] = { uv: [r4((d.uv[0] * 16) / tw), r4((d.uv[1] * 16) / th), r4((d.uv[2] * 16) / tw), r4((d.uv[3] * 16) / th)], texture: `#${d.texture}` };
      if (d.rotation) el.faces[f].rotation = d.rotation;
      if (d.cullface) el.faces[f].cullface = d.cullface;
      if (d.tintindex !== undefined) el.faces[f].tintindex = d.tintindex;
    }
    if (c.emissive) el.light_emission = 15; // 1.21.2+: full-bright element
    elements.push(el);
  }
  const out = { ...(parent ? { parent } : {}), ...(ambientocclusion ? {} : { ambientocclusion: false }), textures, elements };
  if (m.display) out.display = m.display;
  return out;
}

/** Bedrock geometry (format 1.12.0). X is mirrored relative to Java/Blockbench. */
export function toBedrockGeometry(src, { identifier = null, origin = [8, 0, 8] } = {}) {
  const m = normalizeModel(src);
  const [tw, th] = m.texture_size;
  const bones = m.bones.map((b) => ({
    name: b.name,
    ...(b.parent ? { parent: b.parent } : {}),
    pivot: [r4(-(b.pivot[0] - origin[0])), r4(b.pivot[1] - origin[1]), r4(b.pivot[2] - origin[2])],
    ...(b.rotation.some((v) => v) ? { rotation: [-b.rotation[0], -b.rotation[1], b.rotation[2]] } : {}),
    cubes: b.cubes.map((c) => {
      const cube = {
        origin: [r4(-(c.to[0] - origin[0])), r4(c.from[1] - origin[1]), r4(c.from[2] - origin[2])],
        size: c.size.map(r4),
        uv: c.box_uv ? c.box_uv : Object.fromEntries(Object.entries(c.faces).map(([f, d]) => [f, { uv: [d.uv[0], d.uv[1]], uv_size: [r4(d.uv[2] - d.uv[0]), r4(d.uv[3] - d.uv[1])] }])),
      };
      if (c.inflate) cube.inflate = c.inflate;
      if (c.rotation?.angle) {
        const rot = [0, 0, 0];
        rot['xyz'.indexOf(c.rotation.axis)] = c.rotation.axis === 'z' ? c.rotation.angle : -c.rotation.angle;
        cube.rotation = rot;
        const o = c.rotation.origin || b.pivot;
        cube.pivot = [r4(-(o[0] - origin[0])), r4(o[1] - origin[1]), r4(o[2] - origin[2])];
      }
      return cube;
    }),
  }));
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: { identifier: identifier || `geometry.${m.name}`, texture_width: tw, texture_height: th, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 1, 0] },
      bones,
    }],
  };
}

const uuid = () => crypto.randomUUID();

/**
 * Blockbench project (.bbmodel, format 5.0). Textures are embedded so the file
 * opens standalone in Blockbench for manual polishing.
 */
export function toBbmodel(src, { animations = null, resolveTexture = (p) => p, modelFormat = 'free' } = {}) {
  const m = normalizeModel(src);
  const [tw, th] = m.texture_size;
  const texKeys = Object.keys(m.textures);
  const textures = texKeys.map((key, i) => {
    const abs = resolveTexture(m.textures[key]);
    let source = '';
    try { source = `data:image/png;base64,${fs.readFileSync(abs).toString('base64')}`; } catch { /* texture not rendered yet */ }
    return { path: abs, name: `${key}.png`, folder: 'block', namespace: '', id: String(i), width: tw, height: th, uv_width: tw, uv_height: th, particle: i === 0, render_mode: 'default', render_sides: 'auto', visible: true, internal: true, saved: true, uuid: uuid(), source };
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
      if (c.rotation?.angle) rot['xyz'.indexOf(c.rotation.axis)] = c.rotation.angle;
      elements.push({
        name: c.name, box_uv: false, rescale: false, locked: false, render_order: 'default', allow_mirror_modeling: true,
        from: c.from, to: c.to, autouv: 0, color: elements.length % 8, inflate: c.inflate,
        origin: c.rotation?.origin || b.pivot, rotation: rot,
        faces: Object.fromEntries(FACES.map((f) => [f, c.faces[f] ? { uv: c.faces[f].uv, texture: texKeys.indexOf(c.faces[f].texture) } : { uv: [0, 0, 0, 0], texture: null }])),
        type: 'cube', uuid: id,
      });
      groups[b.name].children.push(id);
    }
  }
  for (const b of m.bones) if (b.parent) groups[b.parent].children.push(groups[b.name]);
  const outliner = m.bones.filter((b) => !b.parent).map((b) => groups[b.name]);
  const anims = animations ? loadAnimations(animations).map((a) => ({
    uuid: uuid(), name: a.name, loop: a.loop ? 'loop' : a.hold ? 'hold' : 'once', override: false, length: a.length, snapping: 24, selected: false, anim_time_update: '', blend_weight: '', start_delay: '', loop_delay: '',
    animators: Object.fromEntries(Object.entries(a.bones).filter(([bone]) => groupUuid[bone]).map(([bone, chans]) => [groupUuid[bone], {
      name: bone, type: 'bone',
      keyframes: Object.entries(chans).flatMap(([channel, kfs]) => kfs.map((k) => ({ channel, data_points: [{ x: k.v[0], y: k.v[1], z: k.v[2] }], uuid: uuid(), time: k.t, color: -1, interpolation: k.lerp === 'catmullrom' ? 'catmullrom' : k.lerp === 'step' ? 'step' : 'linear' }))),
    }])),
  })) : [];
  return {
    meta: { format_version: '5.0', model_format: modelFormat, box_uv: false },
    name: m.name, model_identifier: m.name, visible_box: [1, 1, 0], variable_placeholders: '', variable_placeholder_buttons: [], timeline_setups: [], unhandled_root_fields: {},
    resolution: { width: tw, height: th },
    elements, outliner, textures, animations: anims,
  };
}
