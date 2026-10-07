// Studio model source format ("minecraft-studio-model/1").
//
// One editable source exports to Java block/item models, Bedrock geometry and
// Blockbench .bbmodel projects. Units are Minecraft pixels (16 = one block).
//
// {
//   "format": "minecraft-studio-model/1",
//   "name": "reactor_core",
//   "texture_size": [32, 32],                       // UV space in texture pixels
//   "textures": { "main": "resourcepack/assets/ns/textures/block/reactor.png" },
//   "texture_refs": { "main": "ns:block/reactor" }, // resource locations for Java export
//   "bones": [
//     { "name": "base", "pivot": [8, 0, 8], "rotation": [0, 0, 0], "parent": null,
//       "cubes": [ { "name": "plinth", "from": [0,0,0], "to": [16,4,16],
//                    "faces": { "north": { "texture": "main", "uv": [0,0,16,4] }, … },
//                    "box_uv": [0, 0],              // alternative to explicit faces
//                    "rotation": { "axis": "y", "angle": 22.5, "origin": [8,8,8] },
//                    "inflate": 0, "emissive": false } ] }
//   ],
//   "display": { … Java display transforms … }
// }
import { StudioError } from '../core/fsutil.js';

export const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

const vec3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new StudioError('E_MODEL', `${what} must be [x, y, z] numbers`);
  return v;
};

/** Standard box-UV layout (Blockbench/Bedrock convention). */
export function boxUvFaces(u, v, size, texture) {
  const [dx, dy, dz] = size.map((s) => Math.abs(s));
  return {
    east: { texture, uv: [u, v + dz, u + dz, v + dz + dy] },
    north: { texture, uv: [u + dz, v + dz, u + dz + dx, v + dz + dy] },
    west: { texture, uv: [u + dz + dx, v + dz, u + 2 * dz + dx, v + dz + dy] },
    south: { texture, uv: [u + 2 * dz + dx, v + dz, u + 2 * dz + 2 * dx, v + dz + dy] },
    up: { texture, uv: [u + dz, v, u + dz + dx, v + dz] },
    down: { texture, uv: [u + dz + dx, v + dz, u + dz + 2 * dx, v] },
  };
}

/** Validate & normalise a model source. Throws on structural errors. */
export function normalizeModel(src) {
  if (!src || typeof src !== 'object') throw new StudioError('E_MODEL', 'Model source must be an object');
  if (src.format && src.format !== 'minecraft-studio-model/1') throw new StudioError('E_MODEL', `Unsupported model format ${src.format}`);
  const textures = src.textures || {};
  const textureKeys = Object.keys(textures);
  if (!textureKeys.length) throw new StudioError('E_MODEL', 'Model needs at least one texture');
  const ts = src.texture_size || [16, 16];
  const names = new Set();
  const bones = (src.bones || []).map((b) => {
    if (!b.name || names.has(b.name)) throw new StudioError('E_MODEL', `Bone names must be unique and non-empty (${b.name})`);
    names.add(b.name);
    return {
      name: b.name, parent: b.parent || null, pivot: vec3(b.pivot || [0, 0, 0], `bone ${b.name} pivot`), rotation: vec3(b.rotation || [0, 0, 0], `bone ${b.name} rotation`),
      cubes: (b.cubes || []).map((c, i) => {
        const from = vec3(c.from, `${b.name}.cube[${i}].from`), to = vec3(c.to, `${b.name}.cube[${i}].to`);
        const size = to.map((t, k) => t - from[k]);
        if (size.some((s) => s < 0)) throw new StudioError('E_MODEL', `${b.name}.cube[${i}] has to < from`);
        let faces = c.faces;
        if (!faces && c.box_uv) faces = boxUvFaces(c.box_uv[0], c.box_uv[1], size, c.texture || textureKeys[0]);
        if (!faces) throw new StudioError('E_MODEL', `${b.name}.cube[${i}] needs faces or box_uv`);
        for (const [f, def] of Object.entries(faces)) {
          if (!FACES.includes(f)) throw new StudioError('E_MODEL', `Unknown face ${f}`);
          if (!textures[def.texture]) throw new StudioError('E_MODEL', `${b.name}.cube[${i}].${f} references unknown texture "${def.texture}"`);
          if (!Array.isArray(def.uv) || def.uv.length !== 4) throw new StudioError('E_MODEL', `${b.name}.cube[${i}].${f} uv must be [u1,v1,u2,v2]`);
        }
        return { name: c.name || `${b.name}_${i}`, from, to, size, faces, inflate: c.inflate || 0, rotation: c.rotation || null, emissive: !!c.emissive, box_uv: c.box_uv || null };
      }),
    };
  });
  for (const b of bones) if (b.parent && !names.has(b.parent)) throw new StudioError('E_MODEL', `Bone ${b.name} has unknown parent ${b.parent}`);
  // cycle check
  for (const b of bones) {
    let cur = b, depth = 0;
    while (cur?.parent) { cur = bones.find((x) => x.name === cur.parent); if (++depth > 64) throw new StudioError('E_MODEL', `Bone hierarchy cycle at ${b.name}`); }
  }
  return { format: 'minecraft-studio-model/1', name: src.name || 'model', texture_size: ts, textures, texture_refs: src.texture_refs || {}, bones, display: src.display || null, notes: src.notes || null };
}

/** Quality & compatibility checks for a model. */
export function validateModel(src, { target = 'java', cubeBudget = 120 } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  let m;
  try { m = normalizeModel(src); } catch (e) { return { verdict: 'fail', checks: [{ name: 'structure', status: 'fail', detail: e.message }] }; }
  add('structure', 'pass', `${m.bones.length} bones`);
  const cubes = m.bones.flatMap((b) => b.cubes.map((c) => ({ ...c, bone: b.name })));
  add('cube budget', cubes.length <= cubeBudget ? 'pass' : 'warn', `${cubes.length} cubes (budget ${cubeBudget}; many tiny cubes hurt readability and performance)`);
  const tiny = cubes.filter((c) => c.size.filter((s) => s > 0).some((s) => s < 0.5));
  add('micro geometry', tiny.length === 0 ? 'pass' : 'warn', tiny.length ? `${tiny.length} cubes thinner than half a pixel: ${tiny.slice(0, 5).map((c) => c.name).join(', ')}` : 'none');
  const [tw, th] = m.texture_size;
  const badUv = [];
  for (const c of cubes) for (const [f, d] of Object.entries(c.faces)) if (d.uv.some((v, i) => v < 0 || v > (i % 2 ? th : tw))) badUv.push(`${c.name}.${f}`);
  add('uv bounds', badUv.length ? 'fail' : 'pass', badUv.length ? `UVs outside texture: ${badUv.slice(0, 6).join(', ')}` : `all UVs within ${tw}×${th}`);
  const missingFaces = cubes.filter((c) => Object.keys(c.faces).length < 6 && c.size.every((s) => s > 0));
  add('face coverage', missingFaces.length ? 'warn' : 'pass', missingFaces.length ? `${missingFaces.length} solid cubes have hidden/missing faces (ok if intentionally culled)` : 'all faces mapped');
  if (target === 'java') {
    const out = cubes.filter((c) => [...c.from, ...c.to].some((v) => v < -16 || v > 32));
    add('java bounds', out.length ? 'fail' : 'pass', out.length ? `${out.length} cubes outside the Java -16..32 limit` : 'within -16..32');
    const badRot = cubes.filter((c) => c.rotation && (![-45, -22.5, 0, 22.5, 45].includes(c.rotation.angle) || !['x', 'y', 'z'].includes(c.rotation.axis)));
    add('java rotations', badRot.length ? 'fail' : 'pass', badRot.length ? `Java elements only rotate on one axis in 22.5° steps: ${badRot.map((c) => c.name).join(', ')}` : 'ok');
    const boneRot = m.bones.filter((b) => b.rotation.some((r) => r !== 0));
    add('bone rotations', boneRot.length ? 'warn' : 'pass', boneRot.length ? `Java block models have no bones; rotations on ${boneRot.map((b) => b.name).join(', ')} are dropped on export. Animate these parts with display entities instead.` : 'none');
  }
  const pivots = m.bones.filter((b) => b.cubes.length && !b.cubes.some((c) => c.from.every((v, i) => v <= b.pivot[i] + 16) && c.to.every((v, i) => v >= b.pivot[i] - 16)));
  add('pivot placement', pivots.length ? 'warn' : 'pass', pivots.length ? `pivots far from geometry: ${pivots.map((b) => b.name).join(', ')}` : 'pivots near their geometry');
  const min = [0, 1, 2].map((i) => Math.min(...cubes.map((c) => c.from[i])));
  const max = [0, 1, 2].map((i) => Math.max(...cubes.map((c) => c.to[i])));
  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { verdict, cubes: cubes.length, bones: m.bones.map((b) => ({ name: b.name, parent: b.parent, cubes: b.cubes.length })), bounds: { min, max, size_blocks: max.map((v, i) => Number(((v - min[i]) / 16).toFixed(2))) }, checks };
}
