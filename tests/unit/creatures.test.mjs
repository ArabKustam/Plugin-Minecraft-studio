// UV painter + Bedrock add-on validator (used by the Creature Pack example).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packBoxUv, paintAtlas, uvReport } from '../../runtime/src/lib/texture/uvpaint.js';
import { getPx } from '../../runtime/src/lib/texture/image.js';
import { validateBedrockAddon, packageBedrockAddon, stableUuid } from '../../runtime/src/lib/minecraft/bedrock.js';
import { PLUGIN_ROOT } from '../helpers/mcp-client.mjs';

const model = {
  name: 'blob', texture_size: [16, 16], textures: { skin: 'x.png' },
  bones: [{ name: 'body', pivot: [8, 0, 8], cubes: [{ name: 'body', from: [4, 0, 4], to: [12, 6, 12] }, { name: 'eye_bar', from: [5, 6, 5], to: [11, 8, 7] }] }],
};
const paint = { default_material: 'skin', materials: { skin: { ramp: ['#102030', '#304050', '#506070', '#708090'] } },
  cubes: { body: { faces: { north: { x: 1, y: 1, palette: { k: '#000000' }, rows: ['k'] } } } } };

test('packBoxUv assigns non-overlapping islands and grows the atlas when needed', () => {
  const packed = packBoxUv(model, { textureSize: [16, 16] });
  assert.ok(packed.texture_size[0] * packed.texture_size[1] >= 32 * 14, `grew to ${packed.texture_size}`);
  const rects = packed.bones[0].cubes.map((c) => { const [dx, dy, dz] = c.to.map((t, i) => t - c.from[i]); return { x: c.box_uv[0], y: c.box_uv[1], w: 2 * (dx + dz), h: dz + dy }; });
  const [a, b] = rects;
  assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'islands overlap');
  assert.ok(uvReport(packed).coverage > 0.3);
});

test('paintAtlas shades faces top-lit and applies face overlays', () => {
  const packed = packBoxUv(model, { textureSize: [64, 64] });
  const { image } = paintAtlas(packed, { ...paint, texture_size: packed.texture_size });
  const body = packed.bones[0].cubes[0];
  const [u, v] = body.box_uv; // dz = 8, dx = 8
  const up = getPx(image, u + 8 + 2, v + 2);
  const down = getPx(image, u + 16 + 2, v + 2);
  assert.ok(up[0] > down[0], 'up face lighter than down face');
  assert.deepEqual(getPx(image, u + 8 + 1, v + 8 + 1), [0, 0, 0, 255], 'north overlay pixel painted');
  assert.throws(() => paintAtlas(packed, { ...paint, texture_size: packed.texture_size, default_material: 'nope' }), /unknown material/);
});

test('stable UUIDs are valid and deterministic', () => {
  assert.equal(stableUuid('a'), stableUuid('a'));
  assert.match(stableUuid('b'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('bedrock validator catches broken references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-bedrock-'));
  const w = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof obj === 'string' ? obj : JSON.stringify(obj)); };
  w('RP/manifest.json', { format_version: 2, header: { uuid: stableUuid('rp'), version: [1, 0, 0] }, modules: [{ type: 'resources', uuid: stableUuid('rpm'), version: [1, 0, 0] }] });
  w('BP/manifest.json', { format_version: 2, header: { uuid: stableUuid('bp'), version: [1, 0, 0] }, modules: [{ type: 'data', uuid: stableUuid('bpm'), version: [1, 0, 0] }] });
  w('RP/entity/a.entity.json', { format_version: '1.10.0', 'minecraft:client_entity': { description: { identifier: 'x:a', textures: { default: 'textures/entity/a' }, geometry: { default: 'geometry.a' }, animations: { walk: 'animation.a.walk' }, scripts: { animate: ['walk', 'run'] }, render_controllers: ['controller.render.default'] } } });
  w('RP/sounds/sound_definitions.json', { sound_definitions: { 'mob.a.ambient': { sounds: ['sounds/a/ambient'] } } });
  w('BP/entities/b.json', { format_version: '1.21.0', 'minecraft:entity': { description: { identifier: 'x:b' }, components: {} } });
  const r = validateBedrockAddon(path.join(dir, 'RP'), path.join(dir, 'BP'));
  const kinds = r.issues.filter((i) => i.severity === 'error').map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['missing-animation', 'missing-geometry', 'missing-sound', 'missing-texture', 'script']);
  assert.ok(r.issues.some((i) => /does not depend/.test(i.detail)));
  const pkg = packageBedrockAddon(path.join(dir, 'RP'), path.join(dir, 'BP'), path.join(dir, 'out/test'));
  assert.ok(fs.existsSync(pkg.addon.file) && pkg.rp.bytes > 0);
});

test('the Creature Pack example add-on validates (when produced)', (t) => {
  const rp = path.join(PLUGIN_ROOT, 'examples/creatures/bedrock/RP');
  if (!fs.existsSync(path.join(rp, 'entity'))) return t.skip('run examples/creatures/studio/produce.mjs first');
  const r = validateBedrockAddon(rp, path.join(PLUGIN_ROOT, 'examples/creatures/bedrock/BP'));
  assert.equal(r.errors, 0, JSON.stringify(r.issues.filter((i) => i.severity === 'error')));
  assert.equal(r.counts.client_entities, 7);
  assert.equal(r.counts.behavior_entities, 7);
});

test('item shader: lighting, outline, outline opt-out and animation frames', async () => {
  const { shadeItem, itemStats } = await import('../../runtime/src/lib/texture/itempaint.js');
  const rows = Array.from({ length: 16 }, (_, y) => (y >= 4 && y <= 11 ? '....' + 'mmmmmmmm' + '....' : '.'.repeat(16)));
  const spec = { size: [16, 16], materials: { steel: { ramp: ['#202020', '#606060', '#a0a0a0', '#e0e0e0'], style: 'metal' } }, parts: { m: 'steel' }, rows };
  const { image, mcmeta } = shadeItem(spec);
  assert.equal(mcmeta, null);
  assert.ok(getPx(image, 4, 4)[0] > getPx(image, 11, 11)[0], 'top-left corner lighter than bottom-right');
  assert.equal(getPx(image, 3, 6)[3], 255, 'outline drawn left of the silhouette');
  assert.ok(getPx(image, 3, 6)[0] < 0x20, 'outline darker than the darkest ramp colour');
  const noOutline = shadeItem({ ...spec, materials: { steel: { ...spec.materials.steel, outline: false } } }).image;
  assert.equal(getPx(noOutline, 3, 6)[3], 0, 'material outline opt-out');
  const anim = shadeItem({ ...spec, frames: [{ rows }, { rows }], frametime: 4 });
  assert.equal(anim.image.height, 32);
  assert.equal(anim.mcmeta.animation.frametime, 4);
  assert.equal(itemStats(image).filled_px, 8 * 8 + 32);
  assert.throws(() => shadeItem({ ...spec, rows: rows.map((r) => r.replace('m', 'z')) }), /no part\/material/);
});
