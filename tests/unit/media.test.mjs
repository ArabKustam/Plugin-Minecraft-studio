import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderSpec, imageToSpec } from '../../runtime/src/lib/texture/pixelart.js';
import { analyzeImage, buildStyleProfile, compareToProfile } from '../../runtime/src/lib/texture/style.js';
import { checkTiling, validateTexture, applyOps, quantizeToPalette } from '../../runtime/src/lib/texture/ops.js';
import { writePng, getPx } from '../../runtime/src/lib/texture/image.js';
import { validateModel, normalizeModel } from '../../runtime/src/lib/model/spec.js';
import { toJavaModel, toBbmodel, toBedrockGeometry } from '../../runtime/src/lib/model/export.js';
import { renderTurnaround } from '../../runtime/src/lib/model/render.js';
import { validateAnimations, loadAnimations, poseAt } from '../../runtime/src/lib/model/animation.js';
import { renderRecipe, RECIPE_PRESETS } from '../../runtime/src/lib/audio/synth.js';
import { analyzeAudio, integratedLoudness } from '../../runtime/src/lib/audio/analyze.js';
import { parseSequence, timing, renderScore } from '../../runtime/src/lib/audio/music.js';
import { makeAudio, encodeWav, decodeWav } from '../../runtime/src/lib/audio/wav.js';
import { ruNumber, stressToAcute } from '../../runtime/src/lib/audio/voice.js';
import { validateResourcePack, writeZip } from '../../runtime/src/lib/minecraft/resourcepack.js';
import { detectPlatforms } from '../../runtime/src/lib/adapters/minecraft.js';
import { walk } from '../../runtime/src/lib/core/fsutil.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ms-media-'));
const plate = { size: [4, 4], palette: { a: '#404040', b: '#808080' }, rows: ['abab', 'baba', 'abab', 'baba'] };

test('pixel spec renders exact pixels and round-trips', () => {
  const r = renderSpec(plate);
  assert.deepEqual(getPx(r.image, 0, 0), [0x40, 0x40, 0x40, 255]);
  assert.deepEqual(getPx(r.image, 1, 0), [0x80, 0x80, 0x80, 255]);
  const back = imageToSpec(r.image);
  assert.equal(back.rows.length, 4);
  assert.throws(() => renderSpec({ ...plate, rows: ['ab', 'ba', 'ab', 'ba'] }), /pixels, expected 4/);
  assert.throws(() => renderSpec({ ...plate, rows: ['abaz', 'baba', 'abab', 'baba'] }), /not in the palette/);
});

test('animated spec produces strip + mcmeta', () => {
  const r = renderSpec({ size: [2, 2], palette: { a: '#000000', b: '#ffffff' }, frames: [{ rows: ['ab', 'ba'] }, { rows: ['ba', 'ab'] }], frametime: 4 });
  assert.equal(r.image.height, 4);
  assert.equal(r.mcmeta.animation.frametime, 4);
});

test('tiling: checker tiles, gradient does not', () => {
  assert.equal(checkTiling(renderSpec(plate).image).verdict, 'pass');
  const grad = renderSpec({ size: [4, 4], palette: { a: '#000000', b: '#555555', c: '#aaaaaa', d: '#ffffff' }, rows: ['abcd', 'abcd', 'abcd', 'abcd'] });
  assert.notEqual(checkTiling(grad.image).horizontal_seam.status, 'pass');
});

test('validation flags strips without mcmeta', () => {
  const strip = renderSpec({ size: [2, 2], palette: { a: '#000000' }, frames: [{ rows: ['aa', 'aa'] }, { rows: ['aa', 'aa'] }] }).image;
  assert.equal(validateTexture(strip, { mcmeta: null }).verdict, 'fail');
});

test('style profile & comparison rank similar textures higher', () => {
  const dir = tmp();
  const files = [];
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, `textures/block/p${i}.png`);
    writePng(f, renderSpec({ ...plate, palette: { a: '#404040', b: i % 2 ? '#808080' : '#7a7a7a' } }).image);
    files.push({ abs: f, rel: `textures/block/p${i}.png` });
  }
  const profile = buildStyleProfile(files);
  assert.equal(profile.pixel_density, '4x4');
  const similar = compareToProfile(renderSpec(plate).image, profile);
  const loud = compareToProfile(renderSpec({ size: [4, 4], palette: { a: '#ff0000', b: '#00ff00', c: '#0000ff', d: '#ffff00' }, rows: ['abcd', 'cdab', 'badc', 'dcba'] }).image, profile);
  assert.ok(similar.score > loud.score, `${similar.score} > ${loud.score}`);
  assert.ok(analyzeImage(renderSpec(plate).image).colors === 2);
});

test('variant ops and palette pass', () => {
  const base = renderSpec(plate).image;
  const red = applyOps(base, [{ op: 'replace', map: { '#808080': '#ff0000' } }]);
  assert.deepEqual(getPx(red, 1, 0), [255, 0, 0, 255]);
  const q = quantizeToPalette(red, ['#000000', '#ffffff']);
  assert.deepEqual(getPx(q.image, 0, 0), [0, 0, 0, 255]);
  assert.throws(() => applyOps(base, [{ op: 'nope' }]), /Unknown texture op/);
});

const cube = (tex = 'main') => ({ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, { texture: tex, uv: [0, 0, 16, 16] }])) });

test('model validation, java/bedrock/bbmodel export and render', () => {
  const dir = tmp();
  const texFile = path.join(dir, 't.png');
  writePng(texFile, renderSpec(plate).image);
  const model = { name: 'm', texture_size: [16, 16], textures: { main: texFile }, texture_refs: { main: 'ns:block/t' }, bones: [{ name: 'root', pivot: [8, 0, 8], cubes: [cube()] }, { name: 'arm', parent: 'root', pivot: [8, 16, 8], rotation: [0, 0, 10], cubes: [{ ...cube(), from: [6, 16, 6], to: [10, 40, 10] }] }] };
  const v = validateModel(model);
  assert.equal(v.verdict, 'fail'); // arm exceeds Java -16..32
  assert.ok(v.checks.find((c) => c.name === 'java bounds').status === 'fail');
  model.bones[1].cubes[0].to = [10, 28, 10];
  const java = toJavaModel(model);
  assert.equal(java.elements.length, 2);
  assert.equal(java.textures.main, 'ns:block/t');
  assert.equal(toBedrockGeometry(model)['minecraft:geometry'][0].bones.length, 2);
  const bb = toBbmodel(model);
  assert.equal(bb.meta.format_version, '5.0');
  assert.ok(bb.textures[0].source.startsWith('data:image/png;base64,'));
  const r = renderTurnaround(model, { resolveTexture: (p) => p, size: 64 });
  assert.equal(r.image.width, 256);
  assert.throws(() => normalizeModel({ textures: { a: 'x' }, bones: [{ name: 'b', parent: 'nope', cubes: [] }] }), /unknown parent/);
});

test('animation validation detects snaps, seams and unknown bones; sampling eases', () => {
  const anims = { format_version: '1.8.0', animations: {
    'animation.a': { loop: true, animation_length: 1, bones: { rotor: { rotation: { '0.0': [0, 0, 0], '0.5': [0, 90, 0], '1.0': [0, 45, 0] } } } },
    'animation.b': { animation_length: 1, bones: { ghost: { rotation: { '0.0': [0, 0, 0], '0.0001': [0, 180, 0] } } } },
  } };
  const v = validateAnimations(anims, { boneNames: ['rotor'] });
  assert.equal(v.animations[0].checks.find((c) => c.name === 'loop seam').status, 'warn');
  assert.equal(v.animations[1].checks.find((c) => c.name === 'bone references').status, 'fail');
  const pose = poseAt(loadAnimations(anims)[0], 0.25);
  assert.equal(pose.rotor.rotation[1], 45);
});

test('wav round trip and loudness normalisation of SFX recipes', () => {
  const a = makeAudio(48000, 0.1);
  a.channels[0][10] = 0.5;
  const back = decodeWav(encodeWav(a));
  assert.equal(back.sampleRate, 48000);
  assert.ok(Math.abs(back.channels[0][10] - 0.5) < 1e-3);
  const siren = renderRecipe(RECIPE_PRESETS.siren);
  const an = analyzeAudio(siren, { loopCheck: true });
  assert.ok(Math.abs(an.lufs - RECIPE_PRESETS.siren.normalize.lufs) < 1.5, `lufs ${an.lufs}`);
  assert.ok(an.peak_dbfs <= -0.9);
  assert.notEqual(an.loop.status, 'fail');
  assert.ok(Math.abs(an.duration - 4) < 0.01);
  assert.ok(Number.isFinite(integratedLoudness(renderRecipe(RECIPE_PRESETS.button))));
});

test('music: sequence parsing, timing grid and seamless loop render', () => {
  const seq = parseSequence('C4:1 [E4 G4]:1/2 r:1/2 | D4@0.5');
  assert.equal(seq.beats, 3);
  assert.equal(seq.events.length, 4);
  const score = { title: 't', bpm: 120, meter: [4, 4], sections: [{ name: 'intro', bars: 1 }, { name: 'loop', bars: 2, loop: true }], stems: [{ name: 'pad', instrument: 'pad', parts: { loop: '[C3 E3 G3]:8' } }, { name: 'drums', instrument: 'drums', parts: { loop: { kick: 'x...' } } }] };
  const t = timing(score);
  assert.equal(t.barSec, 2);
  const { outputs, metadata } = renderScore(score, { sampleRate: 22050 });
  assert.equal(metadata.loop.duration_s, 4);
  assert.equal(metadata.loop.ticks, 80);
  const loop = outputs.find((o) => o.kind === 'section' && o.section === 'loop');
  assert.equal(loop.audio.channels[0].length, 4 * 22050);
  assert.equal(outputs.filter((o) => o.kind === 'stem').length, 2);
});

test('voice helpers: Russian numbers and stress marks', () => {
  assert.equal(ruNumber(1200), 'одна тысяча двести');
  assert.equal(ruNumber(42), 'сорок два');
  assert.equal(stressToAcute('реАктор'), 'реа́ктор');
});

test('resource pack validation finds broken references; zip is deterministic', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 75, description: 'x' } }));
  fs.mkdirSync(path.join(dir, 'assets/ns/models/item'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets/ns/items'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets/ns/models/item/a.json'), JSON.stringify({ textures: { all: 'ns:item/missing' } }));
  fs.writeFileSync(path.join(dir, 'assets/ns/items/b.json'), JSON.stringify({ model: { type: 'minecraft:model', model: 'ns:item/nothing' } }));
  fs.writeFileSync(path.join(dir, 'assets/ns/sounds.json'), JSON.stringify({ 'x.y': { sounds: ['ns:x/y'] } }));
  const r = validateResourcePack(dir, { minecraftVersion: '1.21.11' });
  const kinds = r.issues.filter((i) => i.severity === 'error').map((i) => i.kind).sort();
  assert.deepEqual(kinds, ['missing-model', 'missing-sound', 'missing-texture']);
  const z1 = writeZip(path.join(dir, 'a.zip'), [{ name: 'a.txt', data: Buffer.from('hello') }]);
  const z2 = writeZip(path.join(dir, 'b.zip'), [{ name: 'a.txt', data: Buffer.from('hello') }]);
  assert.equal(z1.sha1, z2.sha1);
});

test('platform detection recognises Paper and resource packs (hybrid)', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'src/main/resources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/main/resources/plugin.yml'), 'name: X\nmain: a.B\napi-version: "1.21"\n');
  fs.writeFileSync(path.join(dir, 'build.gradle.kts'), 'dependencies { compileOnly("io.papermc.paper:paper-api:26.2.build.132-stable") }');
  fs.mkdirSync(path.join(dir, 'pack/assets/ns'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack/pack.mcmeta'), '{"pack":{"pack_format":88}}');
  fs.writeFileSync(path.join(dir, 'pack/assets/ns/x.json'), '{}');
  const p = detectPlatforms(dir, walk(dir));
  assert.equal(p[0].adapter, 'paper');
  assert.equal(p[0].minecraft_version, '26.2');
  assert.ok(p.some((x) => x.adapter === 'resourcepack'));
});
