// Rebuild every README artwork image from code + real demo assets.
//   node docs/assets-src/build.mjs
// Inputs: the produced Industrial Reactor demo (textures, models, animations) and pixelfont.mjs.
// Outputs: docs/images/readme/*.png and *.gif (GIFs need FFmpeg).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createImage, setPx, getPx, blit, scaleNearest, readPng, writePng, hexToRgba } from '../../runtime/src/lib/texture/image.js';
import { renderSpec } from '../../runtime/src/lib/texture/pixelart.js';
import { buildQuads, renderView, loadModelTextures } from '../../runtime/src/lib/model/render.js';
import { loadAnimations, poseAt } from '../../runtime/src/lib/model/animation.js';
import { layout } from './pixelfont.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = path.join(ROOT, 'examples/industrial-reactor');
const OUT = path.join(ROOT, 'docs/images/readme');
fs.mkdirSync(OUT, { recursive: true });

// ---- visual language -------------------------------------------------------
const C = {
  night: '#0c0e12', surface: '#151920', surface2: '#1b2029', border: '#242a34',
  text: '#e8ebf1', muted: '#8a94a6', grass: '#5ccf6a', grassLight: '#8fe39a', grassDark: '#3e9b4a',
  dirt: '#794f2f', steel: '#6c7683', hazard: '#d9b42a', teal: '#3fb0c8', amber: '#f0b545', shadow: '#05060a',
};
const rgba = (hex) => hexToRgba(hex);
const tex = (p) => readPng(path.join(DEMO, 'resourcepack/assets/reactor/textures', p));
const logo = renderSpec(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/images/logo.pixelspec.json'), 'utf8'))).image;

function rect(img, x, y, w, h, hex) {
  const c = rgba(hex);
  for (let j = Math.max(0, y); j < Math.min(img.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.width, x + w); i++) setPx(img, i, j, c);
}
function frame(img, x, y, w, h, hex, t = 4) { rect(img, x, y, w, t, hex); rect(img, x, y + h - t, w, t, hex); rect(img, x, y, t, h, hex); rect(img, x + w - t, y, t, h, hex); }
/** Pixel text with a hard Minecraft-style drop shadow. Returns drawn width. */
function text(img, str, x, y, scale, hex, { shadow = true, align = 'left' } = {}) {
  const l = layout(str);
  const w = l.width * scale;
  const x0 = align === 'center' ? Math.round(x - w / 2) : align === 'right' ? x - w : x;
  if (shadow) for (const [px, py] of l.pixels) rect(img, x0 + px * scale + Math.max(2, scale / 2 | 0), y + py * scale + Math.max(2, scale / 2 | 0), scale, scale, C.shadow);
  for (const [px, py] of l.pixels) rect(img, x0 + px * scale, y + py * scale, scale, scale, hex);
  return w;
}
function background(w, h) {
  const img = createImage(w, h, rgba(C.night));
  for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) rect(img, x, y, 2, 2, '#161b23');
  return img;
}
/** Grass edge + industrial floor made from the demo's own pack textures. */
function ground(img, y, tile = 64) {
  const blocks = ['block/steel_plate', 'block/vent', 'block/pipe_block', 'block/machine_casing', 'block/steel_grate', 'block/hazard_stripes'].map((p) => scaleNearest(tex(`${p}.png`), tile / 16));
  for (let i = 0, x = 0; x < img.width; i++, x += tile) blit(img, blocks[i % blocks.length], x, y);
  for (let x = 0; x < img.width; x += 4) {
    const k = (x * 7919) % 13;
    rect(img, x, y - 8, 4, 8, k < 3 ? C.grassLight : k < 10 ? C.grass : C.grassDark);
    if (k === 5) rect(img, x, y - 12, 4, 4, C.grass);
  }
}
function hazardBand(img, x, y, w, h, s = 8) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(img, x + i, y + j, rgba(((i + j) / s | 0) % 2 ? '#17191d' : C.hazard));
}

// ---- reactor renders (real model sources + textures) -------------------------
const rigSrc = JSON.parse(fs.readFileSync(path.join(DEMO, 'art/models/reactor_rig.model.json'), 'utf8'));
const anims = loadAnimations(JSON.parse(fs.readFileSync(path.join(DEMO, 'art/animations/reactor.animation.json'), 'utf8')));
const anim = (n) => anims.find((a) => a.name === `animation.reactor.${n}`);
const resolve = (p) => path.join(DEMO, p);
const sideTextures = Object.fromEntries(['off', 'active', 'warning', 'critical'].map((s) => [s, tex(`item/core_side_${s}.png`)]));
const baseTextures = loadModelTextures(rigSrc, resolve);
function renderReactor(state, pose, size, bounds) {
  const { quads } = buildQuads(rigSrc, pose);
  return renderView(quads, { ...baseTextures, side: sideTextures[state] }, rigSrc.texture_size, { yaw: 225, pitch: 24, size, background: [0, 0, 0, 0], bounds });
}
function rigBounds(scale = 1.18) {
  const { quads } = buildQuads(rigSrc, {});
  const a = (225 * Math.PI) / 180, p = (-24 * Math.PI) / 180;
  const pts = quads.flatMap((q) => q.corners.map(([x, y, z]) => {
    x -= 8; y -= 8; z -= 8;
    const x1 = Math.cos(a) * x + Math.sin(a) * z, z1 = -Math.sin(a) * x + Math.cos(a) * z;
    return [x1 * scale, (Math.cos(p) * y - Math.sin(p) * z1) * scale, (Math.sin(p) * y + Math.cos(p) * z1) * scale];
  }));
  return pts;
}
const BOUNDS = rigBounds();

// ---- banner -------------------------------------------------------------------
const L = {
  en: { tagline: 'AI PRODUCTION STUDIO FOR MINECRAFT', sub: 'POWERED BY CLAUDE · AGENTS · ART · AUDIO · CODE · QA', panels: ['PLAN · DELEGATE · SHIP', 'PIXEL ART IN YOUR STYLE', 'MODELS THAT MOVE', 'AUDIO AS A SYSTEM', 'QA BEFORE APPROVAL'],
    dia: { user: 'YOU', director: 'PROJECT DIRECTOR', agents: ['RESEARCH', 'CODE', 'TEXTURES', 'MODELS', 'AUDIO', 'VOICE'], qa: 'QA GATE', registry: 'ASSET REGISTRY', outs: ['MINECRAFT PROJECT', 'DASHBOARD', 'GIT'] } },
  ru: { tagline: 'ИИ-СТУДИЯ РАЗРАБОТКИ ДЛЯ MINECRAFT', sub: 'НА БАЗЕ CLAUDE · АГЕНТЫ · ГРАФИКА · ЗВУК · КОД · QA', panels: ['ПЛАН · АГЕНТЫ · РЕЛИЗ', 'ПИКСЕЛЬ-АРТ В ВАШЕМ СТИЛЕ', 'МОДЕЛИ, КОТОРЫЕ ДВИЖУТСЯ', 'ЗВУК КАК СИСТЕМА', 'QA ДО УТВЕРЖДЕНИЯ'],
    dia: { user: 'ВЫ', director: 'ДИРЕКТОР ПРОЕКТА', agents: ['ИССЛЕДОВАНИЕ', 'КОД', 'ТЕКСТУРЫ', 'МОДЕЛИ', 'ЗВУК', 'ГОЛОС'], qa: 'QA-ПРОВЕРКА', registry: 'РЕЕСТР АССЕТОВ', outs: ['ПРОЕКТ MINECRAFT', 'ДАШБОРД', 'GIT'] } },
};

function banner(lang, w = 1280, h = 320) {
  const t = L[lang];
  const img = background(w, h);
  ground(img, h - 64);
  const lg = scaleNearest(logo, 10);
  rect(img, 64 + 8, 48 + 8, lg.width, lg.height, C.shadow);
  blit(img, lg, 64, 48);
  text(img, 'MINECRAFT STUDIO', 264, 58, 7, C.text);
  text(img, t.tagline, 266, 132, 3, C.grass);
  text(img, t.sub, 266, 176, 2, C.muted);
  const reactor = renderReactor('active', poseAt(anim('idle_spin'), 0.12), 250, BOUNDS);
  blit(img, reactor, w - 290, h - 64 - 228);
  return img;
}

function panelHeader(title, icon, w = 1280, h = 96) {
  const img = createImage(w, h, rgba(C.surface));
  hazardBand(img, 0, 0, 16, h);
  rect(img, 0, h - 4, w, 4, C.grass);
  blit(img, scaleNearest(icon, 4), 44, 14);
  text(img, title, 140, 30, 5, C.text);
  return img;
}

// ---- diagram ------------------------------------------------------------------
function box(img, cx, y, label, color, { w = null, scale = 2, h = 56 } = {}) {
  const tw = layout(label).width * scale;
  const bw = w || tw + 48;
  const x = Math.round(cx - bw / 2);
  rect(img, x + 6, y + 6, bw, h, C.shadow);
  rect(img, x, y, bw, h, C.surface2);
  frame(img, x, y, bw, h, color, 4);
  text(img, label, cx, y + Math.round((h - 7 * scale) / 2), scale, C.text, { align: 'center' });
  return { x, y, w: bw, h, cx };
}
function arrow(img, x1, y1, x2, y2, hex = C.grass) {
  // orthogonal pixel arrow: down, across, down
  const midY = Math.round((y1 + y2) / 2);
  rect(img, x1 - 2, y1, 4, midY - y1, hex);
  rect(img, Math.min(x1, x2) - 2, midY - 2, Math.abs(x2 - x1) + 4, 4, hex);
  rect(img, x2 - 2, midY, 4, y2 - midY - 10, hex);
  for (let k = 0; k < 6; k++) rect(img, x2 - 2 - k * 2 + 0, y2 - 12 + k * 2, 4 + k * 4, 2, hex);
}
function diagram(lang, w = 1280, h = 700) {
  const d = L[lang].dia;
  const img = background(w, h);
  const cx = w / 2;
  const user = box(img, cx, 28, d.user, C.text, { scale: 3, h: 64 });
  const dir = box(img, cx, 140, d.director, C.grass, { scale: 3, h: 64 });
  arrow(img, cx, user.y + user.h, cx, dir.y);
  const xs = d.agents.map((_, i) => Math.round(100 + i * ((w - 200) / (d.agents.length - 1))));
  const agentBoxes = d.agents.map((a, i) => box(img, xs[i], 270, a, C.teal, { w: 180 }));
  for (const b of agentBoxes) arrow(img, cx, dir.y + dir.h, b.cx, b.y, C.grass);
  const qa = box(img, cx, 390, d.qa, C.amber, { scale: 3, h: 64, w: 520 });
  // agents → one bus line → QA gate
  const busY = agentBoxes[0].y + agentBoxes[0].h + 18;
  for (const b of agentBoxes) rect(img, b.cx - 2, b.y + b.h, 4, busY - (b.y + b.h), C.teal);
  rect(img, agentBoxes[0].cx - 2, busY - 2, agentBoxes.at(-1).cx - agentBoxes[0].cx + 4, 4, C.teal);
  arrow(img, cx, busY, cx, qa.y, C.teal);
  const reg = box(img, cx, 500, d.registry, C.steel, { scale: 3, h: 64, w: 520 });
  arrow(img, cx, qa.y + qa.h, cx, reg.y, C.amber);
  const ox = [cx - 380, cx, cx + 380];
  const outs = d.outs.map((o, i) => box(img, ox[i], 616, o, C.grass, { w: 300 }));
  for (const b of outs) arrow(img, cx, reg.y + reg.h, b.cx, b.y, C.steel);
  return img;
}

// ---- GIF helper -------------------------------------------------------------------
function gif(frames, out, fps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-gif-'));
  frames.forEach((f, i) => writePng(path.join(dir, `f${String(i).padStart(4, '0')}.png`), f));
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', 'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', out], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg gif failed: ${r.stderr}`);
}

/** Reactor startup → running → warning → critical, following the demo's timelines. */
function reactorGif(out, lang = 'en', size = 360, fps = 12) {
  const T = lang === 'ru' ? { STARTING: 'ЗАПУСК', RUNNING: 'РАБОТА', WARNING: 'ВНИМАНИЕ', CRITICAL: 'КРИТИЧНО', SCRAM: 'ОСТАНОВ' } : { STARTING: 'STARTING', RUNNING: 'RUNNING', WARNING: 'WARNING', CRITICAL: 'CRITICAL', SCRAM: 'SCRAM' };
  const frames = [];
  const plan = [
    { anim: 'startup', from: 0, to: 5, state: (t) => (t >= 3.5 ? 'active' : 'off'), label: (t) => (t < 5 ? 'STARTING' : 'RUNNING') },
    { anim: 'idle_spin', from: 0, to: 2, state: () => 'active', label: () => 'RUNNING' },
    { anim: 'warning', from: 0, to: 2, state: () => 'warning', label: () => 'WARNING' },
    { anim: 'warning', from: 0, to: 1.5, state: () => 'critical', label: () => 'CRITICAL' },
    { anim: 'shutdown', from: 0, to: 2.5, state: (t) => (t >= 1.5 ? 'off' : 'critical'), label: () => 'SCRAM' },
  ];
  const colors = { STARTING: C.amber, RUNNING: C.grass, WARNING: C.amber, CRITICAL: '#f2655e', SCRAM: C.teal };
  for (const seg of plan) {
    for (let t = seg.from; t < seg.to - 1e-9; t += 1 / fps) {
      const img = createImage(size, size + 48, rgba(C.night));
      ground(img, size + 48 - 32, 32);
      blit(img, renderReactor(seg.state(t), poseAt(anim(seg.anim), t), size, BOUNDS), 0, 8);
      const lbl = seg.label(t);
      rect(img, 12, 12, layout(T[lbl]).width * 3 + 20, 34, C.surface);
      rect(img, 12, 12, 6, 34, colors[lbl]);
      text(img, T[lbl], 26, 18, 3, colors[lbl]);
      frames.push(img);
    }
  }
  gif(frames, out, fps);
  return frames.length;
}

// ---- build --------------------------------------------------------------------------
const icons = [logo, tex('item/core_side_active.png'), tex('item/rotor.png'), tex('item/lamp_on.png'), tex('item/panel_front.png')];
const written = [];
for (const lang of ['en', 'ru']) {
  writePng(path.join(OUT, `banner-${lang}.png`), banner(lang)); written.push(`banner-${lang}.png`);
  L[lang].panels.forEach((p, i) => { writePng(path.join(OUT, `panel-${i + 1}-${lang}.png`), panelHeader(p, icons[i])); written.push(`panel-${i + 1}-${lang}.png`); });
  writePng(path.join(OUT, `how-it-works-${lang}.png`), diagram(lang)); written.push(`how-it-works-${lang}.png`);
}
// GitHub social preview (upload manually: Settings → General → Social preview)
const social = background(1280, 640);
ground(social, 640 - 96, 96);
blit(social, scaleNearest(logo, 14), 96, 96);
text(social, 'MINECRAFT STUDIO', 360, 120, 9, C.text);
text(social, L.en.tagline, 362, 222, 4, C.grass);
text(social, 'CLAUDE PLUGIN · 15 AGENTS · 85 TOOLS', 362, 290, 3, C.muted);
blit(social, renderReactor('active', poseAt(anim('idle_spin'), 0.2), 300, BOUNDS), 930, 640 - 96 - 272);
writePng(path.join(OUT, 'social-preview.png'), social); written.push('social-preview.png');
try { for (const lang of ['en', 'ru']) { const n = reactorGif(path.join(OUT, `reactor-states-${lang}.gif`), lang); written.push(`reactor-states-${lang}.gif (${n} frames)`); } } catch (e) { console.warn(`GIF skipped: ${e.message}`); }
console.log(written.map((f) => `docs/images/readme/${f}`).join('\n'));
