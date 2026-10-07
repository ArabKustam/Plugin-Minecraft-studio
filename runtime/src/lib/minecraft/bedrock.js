// Bedrock add-on integration: validation of resource/behavior packs (manifests,
// client entities ↔ geometry/textures/animations, sounds, behavior entities)
// and packaging as .mcpack / .mcaddon.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, walk, exists, StudioError } from '../core/fsutil.js';
import { writeZip } from './resourcepack.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deterministic UUID (v4 layout) from a seed string — stable across regenerations. */
export function stableUuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const tryJson = (file, _issues, add) => {
  try { return readJson(file); } catch (e) { add('error', 'json', file, e.message); return null; }
};

function checkManifest(dir, kind, add) {
  const f = path.join(dir, 'manifest.json');
  if (!exists(f)) { add('error', 'manifest', `${kind}/manifest.json`, 'missing manifest.json'); return null; }
  const m = tryJson(f, null, add);
  if (!m) return null;
  if (m.format_version !== 2 && m.format_version !== 3) add('warning', 'manifest', `${kind}/manifest.json`, `format_version ${m.format_version} (expected 2)`);
  if (!UUID.test(m.header?.uuid || '')) add('error', 'manifest', `${kind}/manifest.json`, 'header.uuid is not a valid UUID');
  if (!Array.isArray(m.header?.version) && typeof m.header?.version !== 'string') add('error', 'manifest', `${kind}/manifest.json`, 'header.version missing');
  const want = kind === 'RP' ? 'resources' : 'data';
  if (!(m.modules || []).some((mod) => mod.type === want)) add('error', 'manifest', `${kind}/manifest.json`, `needs a "${want}" module`);
  for (const mod of m.modules || []) if (!UUID.test(mod.uuid || '')) add('error', 'manifest', `${kind}/manifest.json`, `module uuid invalid (${mod.type})`);
  return m;
}

export function validateBedrockAddon(rpDir, bpDir = null) {
  const issues = [];
  const add = (severity, kind, file, detail) => issues.push({ severity, kind, file: String(file).replace(/\\/g, '/'), detail });
  const rel = (base, f) => path.relative(base, f).replace(/\\/g, '/');
  const rp = checkManifest(rpDir, 'RP', add);
  const bp = bpDir ? checkManifest(bpDir, 'BP', add) : null;
  if (rp && bp) {
    const uuids = [rp.header.uuid, bp.header.uuid, ...rp.modules.map((m) => m.uuid), ...bp.modules.map((m) => m.uuid)];
    if (new Set(uuids).size !== uuids.length) add('error', 'manifest', 'manifests', 'UUIDs must be unique across packs and modules');
    if (!(bp.dependencies || []).some((d) => d.uuid === rp.header.uuid)) add('warning', 'manifest', 'BP/manifest.json', 'behavior pack does not depend on the resource pack (players may load one without the other)');
  }
  const rpFiles = walk(rpDir);
  // geometry & animations
  const geometries = new Set();
  for (const f of rpFiles.filter((x) => /^models\/.+\.json$/.test(x))) {
    const j = tryJson(path.join(rpDir, f), issues, add);
    for (const g of j?.['minecraft:geometry'] || []) geometries.add(g.description?.identifier);
  }
  const animations = new Set();
  for (const f of rpFiles.filter((x) => /^animations\/.+\.json$/.test(x))) {
    const j = tryJson(path.join(rpDir, f), issues, add);
    for (const [name, a] of Object.entries(j?.animations || {})) {
      animations.add(name);
      for (const v of Object.values(a.timeline || {})) if (typeof v === 'string' && !/[;=/]|^(query|q|variable|v)\./.test(v)) add('warning', 'animation-timeline', f, `${name}: timeline entry "${v}" is not Molang or a command`);
    }
  }
  const controllers = new Set(['controller.render.default']);
  for (const f of rpFiles.filter((x) => /^render_controllers\/.+\.json$/.test(x))) Object.keys(tryJson(path.join(rpDir, f), issues, add)?.render_controllers || {}).forEach((k) => controllers.add(k));
  // client entities
  const clientIds = new Set();
  for (const f of rpFiles.filter((x) => /^entity\/.+\.json$/.test(x))) {
    const j = tryJson(path.join(rpDir, f), issues, add);
    const d = j?.['minecraft:client_entity']?.description;
    if (!d) { add('error', 'client-entity', f, 'missing minecraft:client_entity.description'); continue; }
    clientIds.add(d.identifier);
    for (const [k, g] of Object.entries(d.geometry || {})) if (!geometries.has(g)) add('error', 'missing-geometry', f, `geometry.${k} → ${g} not found in models/`);
    for (const [k, t] of Object.entries(d.textures || {})) if (!rpFiles.includes(`${t}.png`) && !rpFiles.includes(`${t}.tga`)) add('error', 'missing-texture', f, `textures.${k} → ${t}(.png|.tga) not found`);
    for (const [k, a] of Object.entries(d.animations || {})) if (!a.startsWith('controller.') && !animations.has(a)) add('error', 'missing-animation', f, `animations.${k} → ${a} not found`);
    for (const rc of d.render_controllers || []) { const id = typeof rc === 'string' ? rc : Object.keys(rc)[0]; if (!controllers.has(id)) add('error', 'missing-render-controller', f, id); }
    for (const step of d.scripts?.animate || []) { const key = typeof step === 'string' ? step : Object.keys(step)[0]; if (!(key in (d.animations || {}))) add('error', 'script', f, `scripts.animate references unknown animation key ${key}`); }
  }
  // sounds
  const sdFile = path.join(rpDir, 'sounds', 'sound_definitions.json');
  const soundDefs = exists(sdFile) ? tryJson(sdFile, issues, add)?.sound_definitions || {} : {};
  for (const [name, def] of Object.entries(soundDefs)) {
    for (const s of def.sounds || []) {
      const p = typeof s === 'string' ? s : s.name;
      if (!['.ogg', '.fsb', '.wav'].some((ext) => rpFiles.includes(`${p}${ext}`))) add('error', 'missing-sound', 'sounds/sound_definitions.json', `${name} → ${p}(.ogg) not found`);
    }
  }
  const sj = exists(path.join(rpDir, 'sounds.json')) ? tryJson(path.join(rpDir, 'sounds.json'), issues, add) : null;
  for (const [ent, cfg] of Object.entries(sj?.entity_sounds?.entities || {})) for (const [ev, snd] of Object.entries(cfg.events || {})) {
    const s = typeof snd === 'string' ? snd : snd.sound;
    if (s && !soundDefs[s]) add('error', 'missing-sound-event', 'sounds.json', `${ent} ${ev} → ${s} not in sound_definitions`);
  }
  // behavior entities
  const bpIds = [];
  if (bpDir) {
    for (const f of walk(bpDir).filter((x) => /^entities\/.+\.json$/.test(x))) {
      const j = tryJson(path.join(bpDir, f), issues, add);
      const d = j?.['minecraft:entity']?.description;
      if (!d?.identifier) { add('error', 'entity', f, 'missing minecraft:entity.description.identifier'); continue; }
      bpIds.push(d.identifier);
      if (!clientIds.has(d.identifier)) add('warning', 'entity', f, `${d.identifier} has no client entity in the resource pack (renders as nothing)`);
      if (!j['minecraft:entity'].components?.['minecraft:collision_box']) add('info', 'entity', f, `${d.identifier} has no collision_box`);
    }
    for (const id of clientIds) if (!bpIds.includes(id)) add('warning', 'entity', 'entity/', `${id} has a client entity but no behavior entity`);
  }
  // language files
  const lang = rpFiles.filter((x) => /^texts\/.+\.lang$/.test(x));
  for (const id of clientIds) for (const l of lang) if (!fs.readFileSync(path.join(rpDir, l), 'utf8').includes(`entity.${id}.name=`)) add('info', 'lang', l, `no display name for ${id}`);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return {
    verdict: errors ? 'fail' : warnings ? 'warn' : 'pass', errors, warnings,
    counts: { geometries: geometries.size, animations: animations.size, client_entities: clientIds.size, behavior_entities: bpIds.length, sound_definitions: Object.keys(soundDefs).length, files: rpFiles.length },
    rp_uuid: rp?.header?.uuid || null, bp_uuid: bp?.header?.uuid || null, issues,
  };
}

/** Package RP (+BP) as .mcpack files and a combined .mcaddon. */
export function packageBedrockAddon(rpDir, bpDir, outBase) {
  if (!exists(path.join(rpDir, 'manifest.json'))) throw new StudioError('E_PACK', 'resource pack manifest.json missing');
  const zipDir = (dir, prefix = '') => walk(dir).map((f) => ({ name: `${prefix}${f}`, data: fs.readFileSync(path.join(dir, f)) }));
  const out = {};
  out.rp = writeZip(`${outBase}_RP.mcpack`, zipDir(rpDir));
  if (bpDir) out.bp = writeZip(`${outBase}_BP.mcpack`, zipDir(bpDir));
  out.addon = writeZip(`${outBase}.mcaddon`, [...zipDir(rpDir, `${path.basename(rpDir)}/`), ...(bpDir ? zipDir(bpDir, `${path.basename(bpDir)}/`) : [])]);
  return out;
}
