import { h, icon, fmtBytes, fmtRelative, ext, basename } from '../dom.js';
import { api, fileUrl, loadImageData, fetchFileJson } from '../api.js';
import { pageHeader, statusChip, qaChip, empty, openDrawer, assetHeader, section, qaHistory, versionsList, sourceBlock, mono, tag, segmented, toggle, button, kv, filesTable, thumb, assetHref } from '../ui.js';
import { listAssets, assetToolbar, applyFilter } from './common.js';
import { prefs } from '../dom.js';

const ZOOMS = [1, 4, 8, 16, 32];
const hex2 = (n) => n.toString(16).padStart(2, '0');

function pngFile(a) { return (a.files || []).find((f) => ext(f.path) === 'png')?.path || null; }
function mcmetaFile(a) { return (a.files || []).find((f) => f.path.endsWith('.png.mcmeta'))?.path || null; }

/** Unique colours (incl. alpha) with counts, most frequent first. */
function computePalette(img) {
  const counts = new Map();
  let transparent = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) { transparent++; continue; }
    const key = (d[i] << 24 | d[i + 1] << 16 | d[i + 2] << 8 | d[i + 3]) >>> 0;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colors = [...counts.entries()].map(([k, n]) => {
    const r = k >>> 24, g = (k >>> 16) & 255, b = (k >>> 8) & 255, a = k & 255;
    return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: a, count: n, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  }).sort((x, y) => y.count - x.count);
  return { colors, transparent, total: d.length / 4 };
}

function swatches(colors, { max = 64, showCount = true } = {}) {
  return h('div', { class: 'swatches' },
    colors.slice(0, max).map((c) => h('span', { class: 'swatch-cell', title: `${c.hex}${c.alpha !== undefined && c.alpha < 255 ? ` α${c.alpha}` : ''}${showCount && c.count ? ` · ${c.count} px` : ''}` },
      h('span', { class: 'swatch-color', style: { background: c.hex, opacity: c.alpha !== undefined ? String(Math.max(0.25, c.alpha / 255)) : '1' } }),
      h('span', { class: 'swatch-hex mono' }, c.hex))),
    colors.length > max ? h('span', { class: 'muted small' }, `+${colors.length - max} more`) : null);
}

/** Large pixel-perfect viewer with zoom, grid, pixel readout and frame playback. */
function pixelViewer(img, mcmeta) {
  const w = img.width;
  const anim = mcmeta?.animation;
  const fw = anim?.width || w;
  const fh = anim ? (anim.height || (anim.width ? img.height : w)) : img.height;
  const frameCount = anim ? Math.max(1, Math.floor(img.height / fh)) : 1;
  const frames = anim?.frames?.length ? anim.frames.map((f) => (typeof f === 'number' ? { index: f, time: anim.frametime || 1 } : { index: f.index, time: f.time ?? anim.frametime ?? 1 })) : Array.from({ length: frameCount }, (_, i) => ({ index: i, time: anim?.frametime || 1 }));
  const fitZoom = ZOOMS.filter((z) => Math.max(fw, fh) * z <= 448).at(-1) || 1;
  const st = { zoom: prefs.get('texZoom', fitZoom), grid: prefs.get('texGrid', true), frame: 0, playing: frameCount > 1, sheet: false };
  if (!ZOOMS.includes(st.zoom) || Math.max(fw, fh) * st.zoom > 4096) st.zoom = fitZoom;
  const canvas = h('canvas', { class: 'pixel-canvas', tabindex: '0', 'aria-label': 'Texture at zoom' });
  const stage = h('div', { class: 'pixel-stage checker' }, canvas);
  const readout = h('div', { class: 'pixel-readout mono small' }, ' ');
  const frameLabel = h('span', { class: 'mono small' });
  let timer = null;

  const draw = () => {
    const showH = st.sheet ? img.height : fh;
    const z = st.zoom, dpr = window.devicePixelRatio || 1;
    const cw = fw * z, ch = showH * z;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const fi = frames[st.frame]?.index ?? 0;
    ctx.drawImage(img.img, 0, st.sheet ? 0 : fi * fh, fw, showH, 0, 0, canvas.width, canvas.height);
    if (st.grid && z >= 4) {
      const s2 = z * dpr;
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      for (let x = 1; x < fw; x++) ctx.fillRect(Math.round(x * s2), 0, 1, canvas.height);
      for (let y = 1; y < showH; y++) ctx.fillRect(0, Math.round(y * s2), canvas.width, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (let x = 16; x < fw; x += 16) ctx.fillRect(Math.round(x * s2), 0, Math.max(1, dpr), canvas.height);
      for (let y = 16; y < showH; y += 16) ctx.fillRect(0, Math.round(y * s2), canvas.width, Math.max(1, dpr));
    }
    frameLabel.textContent = frameCount > 1 ? `frame ${st.frame + 1}/${frames.length}` : '';
  };
  const stop = () => { clearTimeout(timer); timer = null; };
  const play = () => {
    stop();
    if (!st.playing || frames.length < 2 || st.sheet) return;
    timer = setTimeout(() => { st.frame = (st.frame + 1) % frames.length; draw(); play(); }, (frames[st.frame]?.time || 1) * 50);
  };
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / st.zoom), y = Math.floor((e.clientY - r.top) / st.zoom);
    const sy = st.sheet ? y : (frames[st.frame]?.index ?? 0) * fh + y;
    if (x < 0 || y < 0 || x >= fw || sy >= img.height) return;
    const o = (sy * img.width + x) * 4, d = img.data;
    readout.replaceChildren(h('span', { class: 'swatch-color tiny', style: { background: `rgba(${d[o]},${d[o + 1]},${d[o + 2]},${d[o + 3] / 255})` } }), ` x ${x}, y ${y} · #${hex2(d[o])}${hex2(d[o + 1])}${hex2(d[o + 2])}${d[o + 3] < 255 ? ` · α ${d[o + 3]}` : ''}`);
  });
  canvas.addEventListener('mouseleave', () => { readout.textContent = ' '; });
  canvas.addEventListener('keydown', (e) => {
    const i = ZOOMS.indexOf(st.zoom);
    if ((e.key === '+' || e.key === '=') && i < ZOOMS.length - 1) { st.zoom = ZOOMS[i + 1]; zoomSeg.replaceWith(zoomSeg = zoomControl()); draw(); e.preventDefault(); }
    if ((e.key === '-' || e.key === '_') && i > 0) { st.zoom = ZOOMS[i - 1]; zoomSeg.replaceWith(zoomSeg = zoomControl()); draw(); e.preventDefault(); }
  });
  const zoomControl = () => segmented(ZOOMS.filter((z) => Math.max(fw, fh) * z <= 4096).map((z) => ({ value: z, label: `${z}×` })), st.zoom, (z) => { st.zoom = z; prefs.set('texZoom', z); draw(); }, { label: 'Zoom' });
  let zoomSeg = zoomControl();
  const playBtn = button('', { iconName: st.playing ? 'pause' : 'play', title: 'Play / pause animation', cls: 'btn-icon' });
  playBtn.onclick = () => { st.playing = !st.playing; playBtn.replaceChildren(icon(st.playing ? 'pause' : 'play', { size: 16 })); play(); };
  const controls = h('div', { class: 'viewer-controls' }, zoomSeg,
    toggle('Pixel grid', st.grid, (v) => { st.grid = v; prefs.set('texGrid', v); draw(); }),
    frameCount > 1 ? h('div', { class: 'frame-controls' }, playBtn,
      button('', { iconName: 'chevron', title: 'Next frame', cls: 'btn-icon', onClick: () => { st.playing = false; playBtn.replaceChildren(icon('play', { size: 16 })); stop(); st.frame = (st.frame + 1) % frames.length; draw(); } }),
      toggle('Show strip', false, (v) => { st.sheet = v; draw(); play(); }), frameLabel) : null);
  draw(); play();
  const el = h('div', { class: 'pixel-viewer' }, controls, stage, readout);
  return { el, destroy: stop, redraw: draw };
}

function relatedLists(a, all) {
  const stem = (id) => id.replace(/_(texture|tex|png)$/i, '');
  const myStem = stem(a.id);
  const models = all.filter((x) => x.id !== a.id && (x.dependencies || []).includes(a.id));
  const states = all.filter((x) => {
    if (x.id === a.id || x.type !== 'texture') return false;
    const other = stem(x.id);
    const sameBase = other.startsWith(`${myStem}_`) || myStem.startsWith(`${other}_`);
    const bothVariant = a.tags?.includes('variant') && x.tags?.includes('variant');
    const sharedDep = (a.dependencies || []).some((d) => (x.dependencies || []).includes(d));
    return sameBase || bothVariant || sharedDep;
  });
  const row = (x) => h('a', { class: 'rel-item', href: assetHref(x) }, thumb(x, { size: 'xs', usePreview: x.type !== 'texture' }), h('span', null, h('span', { class: 'strong' }, x.name), h('span', { class: 'muted small mono' }, ` ${x.id}`)), statusChip(x.status));
  return {
    models: models.length ? h('div', { class: 'rel-list' }, models.map(row)) : h('p', { class: 'muted' }, 'No model or animation uses this texture yet.'),
    states: states.length ? h('div', { class: 'rel-list' }, states.map(row)) : h('p', { class: 'muted' }, 'No related state textures.'),
  };
}

async function textureDetail(id, cleanup) {
  const [a, all, style] = await Promise.all([api('asset', { id }), api('assets', { existing: 1 }), api('style').catch(() => null)]);
  const png = pngFile(a);
  const meta = mcmetaFile(a);
  const [img, mcmeta] = await Promise.all([png ? loadImageData(png).catch(() => null) : null, meta ? fetchFileJson(meta).catch(() => null) : null]);
  const rel = relatedLists(a, all);
  let viewer = null, palette = null;
  if (img) { viewer = pixelViewer(img, mcmeta); cleanup.push(viewer.destroy); palette = computePalette(img); }
  const primary = (a.files || []).find((f) => f.path === png);
  const frames = mcmeta?.animation ? Math.max(1, Math.floor(img?.height / (mcmeta.animation.height || img?.width || 1))) : 1;
  return h('div', { class: 'stack' },
    assetHeader(a),
    viewer ? viewer.el : h('div', { class: 'callout' }, icon('alert'), 'Texture file could not be loaded.'),
    h('div', { class: 'grid-2 tight' },
      section('Image', kv([
        ['Dimensions', img ? h('span', { class: 'mono' }, `${img.width} × ${img.height}px`) : null],
        ['Frames', frames > 1 ? h('span', null, `${frames} (animated, ${mcmeta.animation.frametime || 1} tick${(mcmeta.animation.frametime || 1) === 1 ? '' : 's'}/frame${mcmeta.animation.interpolate ? ', interpolated' : ''})`) : 'static'],
        ['File size', primary ? fmtBytes(primary.bytes) : null],
        ['Colours', palette ? `${palette.colors.length} unique${palette.transparent ? ` · ${Math.round((palette.transparent / palette.total) * 100)}% transparent` : ''}` : null],
      ])),
      section('Minecraft path', h('div', { class: 'stack-xs' },
        a.minecraft_ids?.length ? h('div', { class: 'chips' }, a.minecraft_ids.map((x) => mono(x, 'pill'))) : h('span', { class: 'muted small' }, 'No resource location recorded.'),
        ...(a.files || []).map((f) => h('a', { class: 'mono path small', href: fileUrl(f.path), target: '_blank', rel: 'noopener' }, f.path))))),
    palette ? section('Palette', swatches(palette.colors), h('span', { class: 'muted small' }, ` ${palette.colors.length} colours`)) : null,
    style ? section('Style profile', h('div', { class: 'stack-sm' },
      h('div', { class: 'chips' }, tag(`profile: ${style.name || 'default'}`, 'tag-accent'), style.pixel_density ? tag(`density ${style.pixel_density}`) : null, style.lighting_direction?.description ? tag(`light ${style.lighting_direction.description}`) : null, style.texture_count ? tag(`${style.texture_count} reference textures`) : null),
      style.traits?.length ? h('ul', { class: 'bullets' }, style.traits.map((t) => h('li', null, t))) : null,
      style.palette?.length ? h('div', null, h('h4', { class: 'h-sub' }, 'Profile palette'), swatches(style.palette.slice(0, 24).map((c) => ({ hex: c.hex, count: c.weight })), { showCount: false })) : null)) : section('Style profile', h('p', { class: 'muted' }, 'No style profile yet — run texture_style_profile on the existing pack.')),
    h('div', { class: 'grid-2 tight' }, section('Used by models', rel.models), section('Related states', rel.states)),
    a.preview ? section('Review sheet', h('div', { class: 'preview-sheet checker' }, h('img', { src: fileUrl(a.preview), alt: `Review sheet for ${a.name}`, class: 'pixelated' }))) : null,
    section('QA history', qaHistory(a.qa_history)),
    section('Version history', versionsList(a.versions, a.version), h('span', { class: 'muted small' }, ' archived files are kept on disk under .minecraft-studio/history')),
    section('Source', sourceBlock(a.source)),
    section('Files', filesTable(a.files)));
}

export default {
  title: 'Textures', icon: 'textures',
  async mount(root, { param, app }) {
    const state = { q: '', status: '' };
    let assets = [];
    const grid = h('div', { class: 'tex-grid' });
    const cleanup = [];
    const drawGrid = () => {
      const rows = applyFilter(assets, state);
      grid.replaceChildren(...rows.map((a) => h('a', { class: 'tex-card', href: `#/textures/${encodeURIComponent(a.id)}` },
        h('div', { class: 'tex-thumb checker' }, pngFile(a) ? (a.metadata?.frames > 1 ? h('span', { class: 'tex-frame' }, h('img', { src: fileUrl(pngFile(a)), alt: '', class: 'pixelated', loading: 'lazy' })) : h('img', { src: fileUrl(pngFile(a)), alt: '', class: 'pixelated', loading: 'lazy' })) : icon('textures', { size: 28 }),
          a.metadata?.frames > 1 ? h('span', { class: 'tex-badge' }, `${a.metadata.frames}f`) : null),
        h('div', { class: 'tex-body' },
          h('div', { class: 'tex-name' }, a.name),
          h('div', { class: 'tex-meta mono muted' }, a.metadata?.width ? `${a.metadata.width}×${a.metadata.height}` : basename(pngFile(a) || ''), ` · v${a.version}`),
          h('div', { class: 'chips' }, statusChip(a.status), a.qa_status !== 'pending' ? qaChip(a.qa_status) : null)))));
      if (!rows.length) grid.replaceChildren(h('p', { class: 'muted pad' }, 'No textures match the filter.'));
    };
    const render = async () => {
      assets = await listAssets('texture', app);
      root.replaceChildren(
        pageHeader('Textures', `${assets.length} texture asset${assets.length === 1 ? '' : 's'} · authored as pixel specs, reviewed pixel-perfect`),
        assetToolbar(app, assets, state, drawGrid),
        assets.length ? grid : empty('textures', 'No textures yet', app.showExisting ? 'No texture assets in the registry.' : 'Studio-made textures appear here. Turn on “Show existing pack assets” to browse imported pack files.'));
      drawGrid();
    };
    const open = async (id) => {
      try {
        while (cleanup.length) cleanup.pop()();
        const body = await textureDetail(id, cleanup);
        const a = assets.find((x) => x.id === id);
        openDrawer(h('div', null, h('p', { class: 'eyebrow' }, 'Texture'), h('h2', null, a?.name || id)), body, { wide: true, onClose: () => { while (cleanup.length) cleanup.pop()(); if (location.hash.startsWith('#/textures/')) history.replaceState(null, '', '#/textures'); } });
      } catch (e) { console.warn(e); }
    };
    await render();
    if (param) open(param);
    return { update: render, setParam: (p) => { if (p) open(p); }, destroy: () => { while (cleanup.length) cleanup.pop()(); } };
  },
};
