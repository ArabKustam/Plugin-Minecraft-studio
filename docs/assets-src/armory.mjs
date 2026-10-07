// README artwork for Armory & Orchard (EN/RU): inventory-style item sheet,
// animated bows/staffs, rotating mannequins wearing both sets.
//   node docs/assets-src/armory.mjs   (after examples/armory/studio/produce.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createImage, setPx, blit, readPng, writePng, scaleNearest, crop, hexToRgba } from '../../runtime/src/lib/texture/image.js';
import { buildQuads, renderView } from '../../runtime/src/lib/model/render.js';
import { layout } from './pixelfont.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = path.join(ROOT, 'examples/armory');
const OUT = path.join(ROOT, 'docs/images/readme');
const C = { night: '#0c0e12', panel: '#151920', text: '#e8ebf1', muted: '#8a94a6', shadow: '#05060a', green: '#5ccf6a', gold: '#e0b02a', slot: '#8b8b8b', slotDark: '#373737', slotLight: '#ffffff', slotFill: '#8b8b8b' };
const rect = (img, x, y, w, h, hex) => { const c = hexToRgba(hex); for (let j = Math.max(0, y); j < Math.min(img.height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.width, x + w); i++) setPx(img, i, j, c); };
function text(img, s, x, y, sc, hex, align = 'left') {
  const l = layout(s); const x0 = align === 'center' ? Math.round(x - (l.width * sc) / 2) : x;
  for (const [px, py] of l.pixels) rect(img, x0 + px * sc + Math.max(1, sc >> 1), y + py * sc + Math.max(1, sc >> 1), sc, sc, C.shadow);
  for (const [px, py] of l.pixels) rect(img, x0 + px * sc, y + py * sc, sc, sc, hex);
}
function bg(w, h) { const img = createImage(w, h, hexToRgba(C.night)); for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) rect(img, x, y, 2, 2, '#161b23'); return img; }
/** Minecraft-style inventory slot with a bevel. */
function slot(img, x, y, s) {
  rect(img, x, y, s, s, '#2a2d34'); rect(img, x, y, s, 3, '#121418'); rect(img, x, y, 3, s, '#121418');
  rect(img, x, y + s - 3, s, 3, '#4a505c'); rect(img, x + s - 3, y, 3, s, '#4a505c');
}
const items = JSON.parse(fs.readFileSync(path.join(DEMO, 'art/items.json'), 'utf8'));
const tex = (id) => readPng(path.join(DEMO, 'resourcepack/assets/studio/textures/item', `${id}.png`));
const frame0 = (img) => (img.height > img.width ? crop(img, 0, 0, img.width, img.width) : img);
const L = {
  en: { title: 'ARMORY & ORCHARD', sub: 'JAVA 1.21.11 RESOURCE PACK · MADE WITH MINECRAFT STUDIO', swords: 'SWORDS', tools: 'TOOLS', bows: 'BOWS · 3 DRAW STAGES', staffs: 'STAFFS', fruits: 'FRUITS', armor: 'ARMOR & CLOTHING', ranger: 'RANGER CLOTHING', knight: 'KNIGHT PLATE', pull: 'DRAW', anim: 'ANIMATED' },
  ru: { title: 'АРСЕНАЛ И САД', sub: 'РЕСУРСПАК JAVA 1.21.11 · СДЕЛАНО В MINECRAFT STUDIO', swords: 'МЕЧИ', tools: 'ИНСТРУМЕНТЫ', bows: 'ЛУКИ · 3 СТАДИИ НАТЯЖЕНИЯ', staffs: 'ПОСОХИ', fruits: 'ФРУКТЫ', armor: 'БРОНЯ И ОДЕЖДА', ranger: 'ОДЕЖДА СЛЕДОПЫТА', knight: 'РЫЦАРСКИЕ ЛАТЫ', pull: 'НАТЯЖЕНИЕ', anim: 'АНИМАЦИЯ' },
};

function sheet(lang) {
  const t = L[lang], S = 104, G = 10, W = 1280;
  const rows = [
    [t.swords, items.filter((i) => i.category === 'sword').map((i) => i.id), t.tools, items.filter((i) => i.category === 'tool').map((i) => i.id)],
    [t.bows, items.filter((i) => i.category === 'bow').map((i) => i.id), null, []],
    [t.staffs, items.filter((i) => i.category === 'staff').map((i) => i.id), t.fruits, items.filter((i) => i.category === 'fruit').map((i) => i.id)],
    [t.armor, items.filter((i) => i.category === 'armor').map((i) => i.id), null, []],
  ];
  const H = 130 + rows.length * (S + 56) + 20;
  const img = bg(W, H);
  text(img, t.title, 40, 34, 5, C.text); text(img, t.sub, 42, 82, 2, C.muted);
  let y = 130;
  for (const [h1, ids1, h2, ids2] of rows) {
    const group = (title, ids, x0) => {
      text(img, title, x0, y, 2, C.green);
      ids.forEach((id, i) => { const x = x0 + i * (S + G); slot(img, x, y + 26, S); blit(img, scaleNearest(frame0(tex(id)), 5), x + 12, y + 26 + 12); });
    };
    group(h1, ids1, 40);
    if (h2) group(h2, ids2, 40 + (ids1.length) * (S + G) + 40);
    y += S + 56;
  }
  return img;
}

function gif(frames, out, fps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-armory-'));
  frames.forEach((f, i) => writePng(path.join(dir, `f${String(i).padStart(4, '0')}.png`), f));
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png'), '-vf', 'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', out], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** Bows drawing (standby → 3 stages → release) and staffs animating, at 8×. */
function animated(lang, out) {
  const t = L[lang], S = 184, W = 1280, H = 340, fps = 8;
  const seq = (base) => [base, `${base}_pulling_0`, `${base}_pulling_1`, `${base}_pulling_2`, `${base}_pulling_2`, base, base, base];
  const bows = [seq('storm_bow'), seq('heartwood_longbow')];
  const staffs = ['ember_staff', 'tide_staff'].map((id) => { const img = tex(id); return Array.from({ length: img.height / img.width }, (_, i) => crop(img, 0, i * img.width, img.width, img.width)); });
  const frames = [];
  const total = 24;
  for (let f = 0; f < total; f++) {
    const img = bg(W, H);
    text(img, `${t.bows.split('·')[0].trim()} · ${t.pull}`, 50, 28, 3, C.green);
    text(img, `${t.staffs} · ${t.anim}`, 680, 28, 3, C.green);
    bows.forEach((s, i) => { const x = 50 + i * (S + 40); slot(img, x, 80, S); blit(img, scaleNearest(tex(s[f % s.length]), 10), x + 12, 92); });
    staffs.forEach((fr, i) => { const x = 680 + i * (S + 40); slot(img, x, 80, S); blit(img, scaleNearest(fr[Math.floor(f / 3) % fr.length], 10), x + 12, 92); });
    // stage dots under the bows
    bows.forEach((s, i) => { const stage = Math.min(3, s.slice(0, (f % s.length) + 1).filter((x) => x.includes('pulling')).length ? Number((s[f % s.length].match(/_(\d)$/) || [0, -1])[1]) + 1 : 0); for (let d = 0; d < 4; d++) rect(img, 50 + i * (S + 40) + 56 + d * 20, 290, 12, 12, d <= stage && stage > 0 ? C.gold : '#2a2d34'); });
    frames.push(img);
  }
  gif(frames, out, fps);
}

/** Two mannequins on turntables wearing the sets. */
function wearables(lang, out) {
  const t = L[lang], size = 380, W = 1280, H = 500, frames = [];
  const J = (f) => JSON.parse(fs.readFileSync(path.join(DEMO, 'art/equipment', f), 'utf8'));
  const sets = ['ranger', 'knight'].map((s) => {
    const m = J(`mannequin_${s}.model.json`);
    const textures = { skin: readPng(path.join(DEMO, 'renders/mannequin_skin.png')), armor1: readPng(path.join(DEMO, `resourcepack/assets/studio/textures/entity/equipment/humanoid/${s}.png`)), armor2: readPng(path.join(DEMO, `resourcepack/assets/studio/textures/entity/equipment/humanoid_leggings/${s}.png`)) };
    return { s, m, textures, icons: ['head', 'chest', 'legs', 'feet'].map((slotName) => J('sets.json')[s].pieces[slotName]) };
  });
  const N = 36;
  for (let f = 0; f < N; f++) {
    const img = bg(W, H);
    sets.forEach((st, i) => {
      const x0 = i * (W / 2);
      const { quads } = buildQuads(st.m, {});
      const bounds = [[-17, -10, 0], [17, 26, 0]];
      blit(img, renderView(quads, st.textures, st.m.texture_size, { yaw: 30 + (360 * f) / N, pitch: 8, size, background: [0, 0, 0, 0], bounds }), x0 + 30, 50);
      text(img, i === 0 ? t.ranger : t.knight, x0 + W / 4, 18, 3, i === 0 ? C.green : C.gold, 'center');
      st.icons.forEach((id, k) => { const y = 90 + k * 92; slot(img, x0 + 430, y, 84); blit(img, scaleNearest(tex(id), 4), x0 + 430 + 10, y + 10); });
    });
    frames.push(img);
  }
  gif(frames, out, 12);
}

for (const lang of ['en', 'ru']) {
  writePng(path.join(OUT, `armory-sheet-${lang}.png`), sheet(lang));
  animated(lang, path.join(OUT, `armory-animated-${lang}.gif`));
  wearables(lang, path.join(OUT, `armory-wearables-${lang}.gif`));
  for (const f of [`armory-sheet-${lang}.png`, `armory-animated-${lang}.gif`, `armory-wearables-${lang}.gif`]) console.log(f, `${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KiB`);
}
