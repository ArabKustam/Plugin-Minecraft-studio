// Table-style asset lists (Code, Particles) and the generic asset page.
import { h, icon, fmtRelative, fmtDate, basename } from '../dom.js';
import { api, fileUrl } from '../api.js';
import { pageHeader, statusChip, qaChip, empty, openDrawer, assetHeader, genericAssetSections, thumb, TYPE_ROUTE, mono, card } from '../ui.js';
import { listAssets, assetToolbar, applyFilter } from './common.js';

async function openAssetDrawer(id, onClose) {
  const a = await api('asset', { id });
  openDrawer(h('div', null, h('p', { class: 'eyebrow' }, a.type), h('h2', null, a.name)), h('div', { class: 'stack' }, assetHeader(a), genericAssetSections(a)), { wide: true, onClose });
}

function tableView({ type, title, icon: iconName, subtitle, emptyTitle, emptyText, columns }) {
  return {
    title, icon: iconName,
    async mount(root, { param, app }) {
      const state = { q: '', status: '' };
      const route = TYPE_ROUTE[type];
      const open = (id) => openAssetDrawer(id, () => { history.replaceState(null, '', `#/${route}`); }).catch((e) => console.warn(e));
      let assets = [];
      const body = h('div');
      const draw = () => {
        const rows = applyFilter(assets, state);
        body.replaceChildren(rows.length ? h('div', { class: 'table-wrap card' }, h('table', { class: 'table table-hover' },
          h('thead', null, h('tr', null, h('th', null, 'Asset'), ...columns.map((c) => h('th', { class: c.cls || '' }, c.label)), h('th', null, 'Status'), h('th', null, 'QA'), h('th', null, 'Modified'))),
          h('tbody', null, rows.map((a) => h('tr', { tabindex: '0', class: 'row-link', onclick: () => { location.hash = `#/${route}/${encodeURIComponent(a.id)}`; }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/${route}/${encodeURIComponent(a.id)}`; } },
            h('td', null, h('div', { class: 'cell-asset' }, thumb(a, { size: 'xs' }), h('div', null, h('div', { class: 'strong' }, a.name), h('div', { class: 'mono muted small' }, a.id)))),
            ...columns.map((c) => h('td', { class: c.cls || '' }, c.render(a))),
            h('td', null, statusChip(a.status)), h('td', null, qaChip(a.qa_status)),
            h('td', { class: 'muted small nowrap', title: fmtDate(a.modified_at) }, fmtRelative(a.modified_at))))))) : (assets.length ? h('p', { class: 'muted pad' }, 'No assets match the filter.') : empty(iconName, emptyTitle, emptyText)));
      };
      const render = async () => {
        assets = await listAssets(type, app);
        root.replaceChildren(pageHeader(title, subtitle), assets.length ? assetToolbar(app, assets, state, draw) : null, body);
        draw();
      };
      await render();
      if (param) open(param);
      return { update: render, setParam: (p) => { if (p) open(p); } };
    },
  };
}

export const codeView = tableView({
  type: 'code', title: 'Code', icon: 'code',
  subtitle: 'Source files produced or tracked by the studio (plugins, mods, datapacks).',
  emptyTitle: 'No code assets yet', emptyText: 'Code written by the developer agent and registered as assets (type "code") shows up here with its files, game ids and QA state.',
  columns: [
    { label: 'Files', render: (a) => h('div', { class: 'stack-xs' }, (a.files || []).slice(0, 3).map((f) => h('a', { class: 'mono path small', href: fileUrl(f.path), target: '_blank', rel: 'noopener', title: f.path }, basename(f.path))), (a.files || []).length > 3 ? h('span', { class: 'muted small' }, `+${a.files.length - 3} more`) : null) },
    { label: 'Minecraft ids', render: (a) => a.minecraft_ids?.length ? h('div', { class: 'chips' }, a.minecraft_ids.map((x) => mono(x, 'pill'))) : h('span', { class: 'muted' }, '—') },
    { label: 'Ver.', cls: 'num', render: (a) => `v${a.version}` },
  ],
});

export const particlesView = tableView({
  type: 'particle', title: 'Particles', icon: 'particles',
  subtitle: 'Particle definitions and their textures.',
  emptyTitle: 'No particle assets yet', emptyText: 'Particle effects registered by the studio (type "particle") will be listed here with their textures, game ids and QA results.',
  columns: [
    { label: 'Minecraft ids', render: (a) => a.minecraft_ids?.length ? h('div', { class: 'chips' }, a.minecraft_ids.map((x) => mono(x, 'pill'))) : h('span', { class: 'muted' }, '—') },
    { label: 'Files', cls: 'num', render: (a) => String(a.files?.length || 0) },
    { label: 'Ver.', cls: 'num', render: (a) => `v${a.version}` },
  ],
});

/** #/asset/<id>: route to the type's view, or show a generic asset page. */
export const assetView = {
  title: 'Asset', icon: 'file',
  async mount(root, { param }) {
    const render = async (id) => {
      if (!id) { root.replaceChildren(empty('file', 'No asset selected', 'Use the search box to find an asset.')); return; }
      const a = await api('asset', { id });
      if (TYPE_ROUTE[a.type]) { location.replace(`#/${TYPE_ROUTE[a.type]}/${encodeURIComponent(a.id)}`); return; }
      root.replaceChildren(pageHeader(a.name, `${a.type} asset`), card(null, h('div', { class: 'stack' }, h('div', { class: 'asset-top' }, thumb(a, { size: 'lg', usePreview: true }), assetHeader(a)), genericAssetSections(a))));
    };
    await render(param);
    return { update: () => render(param), setParam: (p) => { param = p; render(p); } };
  },
};
