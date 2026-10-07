import { h, icon } from '../dom.js';
import { fetchFileJson, fileUrl } from '../api.js';
import { normalizeModel, loadTextures, ModelViewer } from '../model3d.js';
import { button, toggle } from '../ui.js';

/** Project-relative path of a model asset's editable source JSON. */
export function modelSourcePath(asset) {
  const sf = (asset.source?.source_files || []).find((p) => /\.json$/i.test(p));
  if (sf) return sf;
  const f = (asset.files || []).find((x) => x.role === 'source' && /\.json$/i.test(x.path)) || (asset.files || []).find((x) => /\.model\.json$/i.test(x.path));
  return f?.path || null;
}

export async function loadModelAsset(asset) {
  const p = modelSourcePath(asset);
  if (!p) throw new Error('No minecraft-studio-model/1 source file recorded for this model');
  const src = await fetchFileJson(p);
  const model = normalizeModel(src);
  const { textures, missing } = await loadTextures(model);
  return { model, textures, missing, path: p, src };
}

/** Bone hierarchy tree with visibility toggles. */
export function boneTree(model, hidden, onToggle) {
  const children = new Map();
  for (const b of model.bones) { const k = b.parent || ''; if (!children.has(k)) children.set(k, []); children.get(k).push(b); }
  const build = (parent) => {
    const kids = children.get(parent) || [];
    if (!kids.length) return null;
    return h('ul', { class: 'bone-tree', role: parent ? 'group' : 'tree' }, kids.map((b) => {
      const cb = h('input', { type: 'checkbox', checked: !hidden.has(b.name), 'aria-label': `Show bone ${b.name}`, onchange: (e) => onToggle(b.name, e.target.checked) });
      return h('li', { role: 'treeitem' }, h('label', { class: 'bone-row' }, cb, h('span', { class: 'bone-name mono' }, b.name), h('span', { class: 'muted small' }, `${b.cubes.length} cube${b.cubes.length === 1 ? '' : 's'}`), h('span', { class: 'muted small mono bone-pivot', title: 'pivot' }, `[${b.pivot.join(', ')}]`)), build(b.name));
    }));
  };
  return build('') || h('p', { class: 'muted' }, 'No bones.');
}

/** Canvas + overlay controls around a ModelViewer. Returns {el, viewer, destroy}. */
export function viewerPanel({ autoRotateDefault = false } = {}) {
  const canvas = h('canvas', { class: 'model-canvas', tabindex: '0', 'aria-label': '3D model viewer. Drag or use arrow keys to orbit, wheel or +/- to zoom, 0 to reset.' });
  const viewer = new ModelViewer(canvas);
  let spin = autoRotateDefault, raf = 0, last = 0;
  const loop = (t) => { if (!spin) { raf = 0; return; } if (last) viewer.yaw -= (t - last) * 0.02; last = t; viewer.invalidate(); raf = requestAnimationFrame(loop); };
  const setSpin = (v) => { spin = v; last = 0; if (spin && !raf) raf = requestAnimationFrame(loop); };
  const controls = h('div', { class: 'viewer-overlay' },
    h('div', { class: 'vo-group', role: 'group', 'aria-label': 'Camera presets' },
      button('Iso', { cls: 'btn-sm', onClick: () => viewer.view(225, 30) }),
      button('Front', { cls: 'btn-sm', onClick: () => viewer.view(0, 0) }),
      button('Side', { cls: 'btn-sm', onClick: () => viewer.view(90, 0) }),
      button('Top', { cls: 'btn-sm', onClick: () => viewer.view(0, 89) }),
      button('', { iconName: 'reset', cls: 'btn-sm btn-icon', title: 'Reset camera', onClick: () => viewer.reset() })),
    h('div', { class: 'vo-group' },
      toggle('Grid', true, (v) => { viewer.showGrid = v; viewer.invalidate(); }),
      toggle('Auto-rotate', spin, setSpin)));
  const hint = h('div', { class: 'viewer-hint muted small' }, icon('rotate', { size: 13 }), ' drag to orbit · wheel to zoom · double-click to reset');
  const onTheme = () => viewer.invalidate();
  window.addEventListener('themechange', onTheme);
  const el = h('div', { class: 'viewer-stage' }, canvas, controls, hint);
  setSpin(spin);
  return { el, viewer, destroy: () => { spin = false; cancelAnimationFrame(raf); viewer.destroy(); window.removeEventListener('themechange', onTheme); } };
}

export function previewFallback(asset, err) {
  return h('div', { class: 'viewer-fallback' },
    h('div', { class: 'callout' }, icon('alert'), h('div', null, h('strong', null, 'Interactive view unavailable'), h('p', { class: 'small' }, err?.message || 'Model source could not be loaded.'))),
    asset.preview ? h('div', { class: 'preview-sheet checker' }, h('img', { src: fileUrl(asset.preview), alt: `Turnaround of ${asset.name}`, class: 'pixelated' })) : null);
}
