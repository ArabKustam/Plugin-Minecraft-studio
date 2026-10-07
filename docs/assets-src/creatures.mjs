// README artwork for the Creature Pack: same-scale lineup and a walk-cycle GIF (EN/RU).
//   node docs/assets-src/creatures.mjs   (after examples/creatures/studio/produce.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createImage, setPx, blit, readPng, writePng, hexToRgba } from '../../runtime/src/lib/texture/image.js';
import { buildQuads, renderView } from '../../runtime/src/lib/model/render.js';
import { loadAnimations, poseAt } from '../../runtime/src/lib/model/animation.js';
import { layout } from './pixelfont.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = path.join(ROOT, 'examples/creatures');
const OUT = path.join(ROOT, 'docs/images/readme');
const C = { night: '#0c0e12', text: '#e8ebf1', muted: '#8a94a6', shadow: '#05060a', grass: '#5ccf6a', grassLight: '#8fe39a', grassDark: '#3e9b4a', dirt: '#794f2f', dirtDark: '#5a3820', dirtLight: '#a06a3c' };
const TAG = { animal: '#5ccf6a', monster: '#f2655e', anthropomorphic: '#f0b545' };
const TAGTEXT = { en: { animal: 'ANIMAL', monster: 'MONSTER', anthropomorphic: 'ANTHRO' }, ru: { animal: 'ЖИВОТНОЕ', monster: 'МОНСТР', anthropomorphic: 'АНТРОПО' } };
const rect = (img, x, y, w, h, hex) => { const c = hexToRgba(hex); for (let j = Math.max(0, y); j < Math.min(img.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.width, x + w); i++) setPx(img, i, j, c); };
function text(img, s, x, y, sc, hex, center = true) {
  const l = layout(s); const x0 = center ? Math.round(x - (l.width * sc) / 2) : x;
  for (const [px, py] of l.pixels) rect(img, x0 + px * sc + Math.max(1, sc >> 1), y + py * sc + Math.max(1, sc >> 1), sc, sc, C.shadow);
  for (const [px, py] of l.pixels) rect(img, x0 + px * sc, y + py * sc, sc, sc, hex);
}
function ground(img, y) {
  for (let x = 0; x < img.width; x += 4) {
    const k = (x * 7919) % 13;
    rect(img, x, y, 4, 8, k < 3 ? C.grassLight : k < 10 ? C.grass : C.grassDark);
    for (let j = y + 8; j < img.height; j += 4) { const d = ((x * 31 + j * 17) % 11); rect(img, x, j, 4, 4, d < 2 ? C.dirtDark : d < 4 ? C.dirtLight : C.dirt); }
  }
}

const creatures = JSON.parse(fs.readFileSync(path.join(DEMO, 'art/creatures.json'), 'utf8'));
const data = creatures.map((c) => {
  const model = JSON.parse(fs.readFileSync(path.join(DEMO, 'art/models', `${c.id}.model.json`), 'utf8'));
  const skin = readPng(path.join(DEMO, 'bedrock/RP/textures/entity', `${c.id}.png`));
  const anims = loadAnimations(JSON.parse(fs.readFileSync(path.join(DEMO, 'art/animations', `${c.id}.animation.json`), 'utf8')));
  return { ...c, model, skin, anims };
});

// shared world scale: view-space bounds with a fixed extent, feet on a common baseline
const YAW = 30, PITCH = 18;
function viewPts(model) {
  const { quads } = buildQuads(model, {});
  const a = (YAW * Math.PI) / 180, p = (-PITCH * Math.PI) / 180;
  return quads.flatMap((q) => q.corners.map(([x, y, z]) => {
    x -= 8; y -= 8; z -= 8;
    const x1 = Math.cos(a) * x + Math.sin(a) * z, z1 = -Math.sin(a) * x + Math.cos(a) * z;
    return [x1, Math.cos(p) * y - Math.sin(p) * z1, Math.sin(p) * y + Math.cos(p) * z1];
  }));
}
const EXTENT = 48; // model units covered by one tile (fits the tallest creature)
function boundsFor(model) {
  const pts = viewPts(model);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, minY = Math.min(...ys) - 1;
  return [[cx - EXTENT / 2, minY, 0], [cx + EXTENT / 2, minY + EXTENT, 0]];
}
function render(c, pose, size) {
  const { quads } = buildQuads(c.model, pose);
  return renderView(quads, { skin: c.skin }, c.model.texture_size, { yaw: YAW, pitch: PITCH, size, background: [0, 0, 0, 0], bounds: boundsFor(c.model) });
}
const anim = (c, n) => c.anims.find((a) => a.name.endsWith(`.${n}`));

function lineup(lang) {
  const tile = 230, W = tile * data.length, H = 350;
  const img = createImage(W, H, hexToRgba(C.night));
  for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) rect(img, x, y, 2, 2, '#161b23');
  ground(img, H - 72);
  data.forEach((c, i) => {
    const sprite = render(c, poseAt(anim(c, 'idle'), 0.3), tile);
    // renderView places bounds bottom at 7% margin: shift so feet touch the grass line
    blit(img, sprite, i * tile, H - 72 - Math.round(tile * 0.93) + 2);
    text(img, c.name[lang].toUpperCase(), i * tile + tile / 2, H - 52, 2, C.text);
    const tag = TAGTEXT[lang][c.category];
    const tw = layout(tag).width * 2 + 16;
    rect(img, i * tile + tile / 2 - tw / 2, H - 28, tw, 20, '#151920');
    text(img, tag, i * tile + tile / 2, H - 25, 2, TAG[c.category]);
  });
  return img;
}

function walkGif(lang, out) {
  const tile = 280, cols = 4, rows = 2, fps = 10, seconds = 6;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-walk-'));
  for (let f = 0; f < fps * seconds; f++) {
    const t = f / fps;
    const img = createImage(tile * cols, (tile + 30) * rows, hexToRgba(C.night));
    const cells = [...data.map((c) => ({ c, a: anim(c, 'walk'), label: c.name[lang].toUpperCase() })), ...data.filter((c) => c.id === 'abyssal_seer').map((c) => ({ c, a: anim(c, 'attack'), label: (lang === 'ru' ? 'ПРОВИДЕЦ · ЗАКЛИНАНИЕ' : 'SEER · CAST') }))];
    cells.forEach(({ c, a, label }, i) => {
      const x = (i % cols) * tile, y = Math.floor(i / cols) * (tile + 30);
      rect(img, x, y + tile - 34, tile, 34, '#11151b');
      for (let gx = x; gx < x + tile; gx += 4) rect(img, gx, y + tile - 34, 4, 4, ((gx * 13) % 7) < 3 ? C.grassLight : C.grass);
      blit(img, render(c, poseAt(a, t % a.length), tile), x, y + tile - 34 - Math.round(tile * 0.93) + 6);
      text(img, label, x + tile / 2, y + tile + 6, 2, TAG[c.category]);
    });
    writePng(path.join(dir, `f${String(f).padStart(4, '0')}.png`), img);
  }
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', out], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(r.stderr);
}

function seerGif(lang, out) {
  const c = data.find((d) => d.id === 'abyssal_seer');
  const W = 900, H = 520, fps = 15, N = 45; // idle loop is 3.0 s → 45 frames = one full turn + one tentacle cycle
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-seer-'));
  const idle = anim(c, 'idle');
  const title = lang === 'ru' ? 'БЕЗДОННЫЙ ПРОВИДЕЦ' : 'ABYSSAL SEER';
  const notes = lang === 'ru' ? ['ПАЛЬЦЕХОДЯЩИЕ НОГИ', '4 ЩУПАЛЬЦА × 4 СЕГМЕНТА', 'ДЛИННЫЕ РУКИ С КОГТЯМИ', 'КОРАЛЛОВЫЙ ПОСОХ', 'МАНТИЯ С ПОЯСОМ'] : ['DIGITIGRADE LEGS', '4 TENTACLES × 4 SEGMENTS', 'LONG CLAWED ARMS', 'CORAL STAFF', 'ROBE WITH BELT'];
  for (let f = 0; f < N; f++) {
    const img = createImage(W, H, hexToRgba(C.night));
    for (let y = 16; y < H; y += 32) for (let x = 16; x < W; x += 32) rect(img, x, y, 2, 2, '#161b23');
    ground(img, H - 56);
    const { quads } = buildQuads(c.model, poseAt(idle, (f / fps) % idle.length));
    const sprite = renderView(quads, { skin: c.skin }, c.model.texture_size, { yaw: (360 * f) / N, pitch: 12, size: 470, background: [0, 0, 0, 0], bounds: [[-24, -11, 0], [24, 37, 0]] });
    blit(img, sprite, 20, H - 56 - 470 + 22);
    text(img, title, 640, 60, 3, TAG.anthropomorphic);
    notes.forEach((n, i) => { rect(img, 560, 132 + i * 44, 8, 8, '#7ff5ff'); text(img, n, 580, 128 + i * 44, 2, C.text, false); });
    writePng(path.join(dir, `f${String(f).padStart(4, '0')}.png`), img);
  }
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', 'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', out], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(r.stderr);
}

for (const lang of ['en', 'ru']) {
  seerGif(lang, path.join(OUT, `seer-${lang}.gif`));
  writePng(path.join(OUT, `creatures-lineup-${lang}.png`), lineup(lang));
  walkGif(lang, path.join(OUT, `creatures-walk-${lang}.gif`));
  console.log(`creatures-lineup-${lang}.png, creatures-walk-${lang}.gif (${(fs.statSync(path.join(OUT, `creatures-walk-${lang}.gif`)).size / 1024).toFixed(0)} KiB)`);
}
