// Helpers shared by asset views.
import { h, icon, clear } from '../dom.js';
import { api } from '../api.js';
import { segmented, toggle, ASSET_STATUSES } from '../ui.js';

/** Assets of one type, hiding imported pack files unless the user enabled them. */
export async function listAssets(type, app) {
  const rows = await api('assets', { type, existing: app.showExisting ? 1 : undefined });
  return app.showExisting ? rows : rows.filter((a) => !a.tags?.includes('existing'));
}

/**
 * Toolbar with status filter, text filter and the "show existing pack assets" toggle.
 * onChange(state) is called whenever a filter changes.
 */
export function assetToolbar(app, assets, state, onChange, { existingToggle = true } = {}) {
  const counts = assets.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const statuses = ASSET_STATUSES.filter((s2) => counts[s2]);
  const input = h('input', { type: 'search', class: 'input', placeholder: 'Filter…', value: state.q || '', 'aria-label': 'Filter by name or id', oninput: (e) => { state.q = e.target.value; onChange(state); } });
  return h('div', { class: 'toolbar' },
    statuses.length > 1 ? segmented([{ value: '', label: 'All', count: assets.length }, ...statuses.map((s2) => ({ value: s2, label: s2, count: counts[s2] }))], state.status || '', (v) => { state.status = v; onChange(state); }, { label: 'Status filter' }) : null,
    h('div', { class: 'toolbar-spacer' }),
    h('div', { class: 'input-icon' }, icon('search', { size: 15 }), input),
    existingToggle ? toggle('Show existing pack assets', app.showExisting, (v) => app.setShowExisting(v)) : null);
}

export function applyFilter(assets, state) {
  const q = (state.q || '').trim().toLowerCase();
  return assets.filter((a) => (!state.status || a.status === state.status) && (!q || `${a.id} ${a.name} ${(a.minecraft_ids || []).join(' ')}`.toLowerCase().includes(q)));
}

/** Two-pane layout: list on the left, detail on the right. */
export function splitLayout(list, detail, { cls = '' } = {}) {
  return h('div', { class: `split ${cls}` }, h('div', { class: 'split-list' }, list), h('div', { class: 'split-detail' }, detail));
}

export function listItem(a, { active, onSelect, extra = null, thumbEl = null }) {
  return h('button', { type: 'button', class: `list-item ${active ? 'active' : ''}`, 'aria-pressed': String(!!active), onclick: () => onSelect(a) },
    thumbEl, h('span', { class: 'li-main' }, h('span', { class: 'li-name' }, a.name), h('span', { class: 'li-id mono' }, a.id)), extra);
}

export function replace(el, ...children) { clear(el); el.append(...children.flat().filter(Boolean)); return el; }
