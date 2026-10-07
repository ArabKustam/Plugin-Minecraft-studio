import { h, icon, fmtRelative } from '../dom.js';
import { api, fileUrl } from '../api.js';
import { pageHeader, statusChip, qaChip, empty, kv, section, tag, mono, thumb, assetHeader, genericAssetSections, card, errorBox, spinner } from '../ui.js';
import { countCubes } from '../model3d.js';
import { listAssets, splitLayout, listItem, replace } from './common.js';
import { loadModelAsset, boneTree, viewerPanel, previewFallback } from './modelutil.js';

export default {
  title: '3D', icon: 'cube',
  async mount(root, { param, app }) {
    let assets = [];
    let selected = param;
    let panel = null;
    const listEl = h('div', { class: 'list' });
    const detailEl = h('div', { class: 'detail' });

    const drawList = () => replace(listEl, assets.map((a) => listItem(a, {
      active: a.id === selected, onSelect: (x) => { location.hash = `#/3d/${encodeURIComponent(x.id)}`; },
      thumbEl: thumb(a, { size: 'sm', usePreview: true }),
      extra: h('span', { class: 'li-chips' }, statusChip(a.status)),
    })));

    const showDetail = async (id) => {
      panel?.destroy(); panel = null;
      const summary = assets.find((x) => x.id === id);
      if (!summary) { replace(detailEl, empty('cube', 'Select a model', 'Pick a model on the left to inspect it in 3D.')); return; }
      replace(detailEl, spinner('Loading model…'));
      const a = await api('asset', { id });
      if (selected !== id) return;
      let loaded = null, err = null;
      try { loaded = await loadModelAsset(a); } catch (e) { err = e; }
      if (selected !== id) return;
      const hidden = new Set();
      let viewerBox;
      if (loaded) {
        panel = viewerPanel();
        panel.viewer.setModel(loaded.model, loaded.textures);
        viewerBox = panel.el;
      } else viewerBox = previewFallback(a, err);
      const m = loaded?.model;
      const side = h('div', { class: 'stack' },
        m ? section('Bones', boneTree(m, hidden, (name, visible) => { if (visible) hidden.delete(name); else hidden.add(name); panel.viewer.setHidden(new Set(hidden)); })) : null,
        m ? section('Geometry', kv([
          ['Cubes', String(countCubes(m))],
          ['Bones', String(m.bones.length)],
          ['Texture size', h('span', { class: 'mono' }, m.texture_size.join(' × '))],
          ['Textures', h('div', { class: 'stack-xs' }, Object.entries(m.textures).map(([k, p]) => h('div', { class: 'tex-ref' }, loaded.textures[k] ? h('img', { src: fileUrl(p), alt: '', class: 'pixelated tex-ref-img' }) : icon('alert', { size: 14 }), h('span', { class: 'mono small' }, k), h('span', { class: 'mono muted small path' }, p))))],
          ['Source', h('a', { class: 'mono path small', href: fileUrl(loaded.path), target: '_blank', rel: 'noopener' }, loaded.path)],
        ])) : null,
        loaded?.missing?.length ? h('div', { class: 'callout callout-warn' }, icon('alert'), `Missing textures: ${loaded.missing.join(', ')}`) : null);
      replace(detailEl,
        h('div', { class: 'detail-head' }, h('h2', null, a.name), assetHeader(a)),
        h('div', { class: 'model-layout' }, h('div', { class: 'model-main' }, viewerBox), h('aside', { class: 'model-side' }, side)),
        a.preview && loaded ? section('Turnaround preview', h('div', { class: 'preview-sheet checker' }, h('img', { src: fileUrl(a.preview), alt: `Turnaround of ${a.name}`, class: 'pixelated' }))) : null,
        ...genericAssetSections(a));
    };

    const render = async () => {
      assets = await listAssets('model', app);
      if (!selected && assets.length) selected = assets[0].id;
      if (!assets.length) { root.replaceChildren(pageHeader('3D Models', 'Interactive model viewer'), empty('cube', 'No models yet', 'Models exported with model_export (minecraft-studio-model/1 sources) appear here with an interactive textured viewer.')); return false; }
      drawList();
      root.replaceChildren(pageHeader('3D Models', `${assets.length} model${assets.length === 1 ? '' : 's'} · software-rendered from the editable model source`), splitLayout(listEl, detailEl));
      return true;
    };
    if (await render()) await showDetail(selected);
    return {
      update: async () => {
        if (!root.contains(listEl)) { if (await render()) await showDetail(selected); return; }
        const keep = selected; assets = await listAssets('model', app); drawList(); if (!assets.some((a) => a.id === keep)) { selected = assets[0]?.id; await showDetail(selected); } },
      setParam: async (p) => { if (!p || p === selected) return; selected = p; drawList(); await showDetail(p); },
      destroy: () => panel?.destroy(),
    };
  },
};
