import { h, icon, fmtDate, fmtTimeShort, fmtRelative } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, sevChip, empty, segmented, activityTimeline, assetHref } from '../ui.js';

const SEVERITIES = ['debug', 'info', 'success', 'warning', 'error'];

async function render(root, state) {
  const [all, filtered] = await Promise.all([api('logs', { limit: 1000 }), state.sev ? api('logs', { severity: state.sev, limit: 1000 }) : null]);
  const counts = all.reduce((acc, e) => { acc[e.severity] = (acc[e.severity] || 0) + 1; return acc; }, {});
  const agents = [...new Set(all.map((e) => e.agent).filter(Boolean))].sort();
  const q = state.q.trim().toLowerCase();
  const rows = (filtered || all).filter((e) => (!state.agent || e.agent === state.agent) && (!q || `${e.message} ${e.event} ${e.asset || ''} ${e.task || ''}`.toLowerCase().includes(q)));
  const key = (e) => `${e.ts}|${e.event}|${e.message}`;
  const fresh = state.seen ? new Set(rows.filter((e) => !state.seen.has(key(e))).map(key)) : new Set();
  state.seen = new Set(all.map(key));

  const agentSel = h('select', { class: 'select', 'aria-label': 'Filter by agent', onchange: (e) => { state.agent = e.target.value; render(root, state); } },
    h('option', { value: '' }, 'All agents'), agents.map((a) => h('option', { value: a, selected: a === state.agent }, a)));
  const search = h('input', { type: 'search', class: 'input', placeholder: 'Search messages…', value: state.q, 'aria-label': 'Search log messages' });
  search.addEventListener('input', () => { state.q = search.value; clearTimeout(state.qt); state.qt = setTimeout(() => render(root, state).then(() => { const s2 = root.querySelector('input[type=search]'); s2?.focus(); s2?.setSelectionRange(s2.value.length, s2.value.length); }), 200); });

  const table = rows.length ? h('div', { class: 'table-wrap card' }, h('table', { class: 'table log-table' },
    h('thead', null, h('tr', null, h('th', null, 'Time'), h('th', null, 'Severity'), h('th', null, 'Agent'), h('th', null, 'Event'), h('th', null, 'Message'), h('th', null, 'Task / asset'))),
    h('tbody', null, rows.slice(0, 600).map((e) => h('tr', { class: `sev-row sev-${e.severity} ${fresh.has(key(e)) ? 'fresh' : ''}` },
      h('td', { class: 'mono nowrap small', title: fmtDate(e.ts) }, fmtTimeShort(e.ts), h('div', { class: 'muted' }, fmtRelative(e.ts))),
      h('td', null, sevChip(e.severity)),
      h('td', { class: 'nowrap' }, e.agent || '—'),
      h('td', { class: 'mono small' }, e.event || ''),
      h('td', { class: 'msg' }, e.message || '', e.data ? h('details', { class: 'log-data' }, h('summary', null, 'data'), h('pre', { class: 'json' }, JSON.stringify(e.data, null, 2))) : null),
      h('td', { class: 'small' }, e.task ? h('a', { class: 'mono', href: `#/tasks/${encodeURIComponent(e.task)}` }, e.task) : null, e.task && e.asset ? h('br') : null, e.asset ? h('a', { class: 'mono', href: assetHref({ id: e.asset }) }, e.asset) : null)))))) : empty('logs', 'No log entries', all.length ? 'Nothing matches the current filters.' : 'Agents log user-facing activity summaries as they work.');

  root.replaceChildren(
    pageHeader('Logs', `Structured activity log · ${all.length} entries · updates live`),
    h('div', { class: 'toolbar' },
      segmented([{ value: '', label: 'All', count: all.length }, ...SEVERITIES.map((s2) => ({ value: s2, label: s2, count: counts[s2] || 0 }))], state.sev, (v) => { state.sev = v; render(root, state); }, { label: 'Severity' }),
      agentSel,
      h('div', { class: 'toolbar-spacer' }),
      h('div', { class: 'input-icon' }, icon('search', { size: 15 }), search),
      segmented([{ value: 'table', label: 'Table' }, { value: 'timeline', label: 'Timeline' }], state.mode, (v) => { state.mode = v; render(root, state); }, { label: 'Layout' })),
    state.mode === 'timeline' ? h('div', { class: 'card pad' }, activityTimeline(rows.slice(0, 300))) : table);
}

export default {
  title: 'Logs', icon: 'logs',
  async mount(root) {
    const state = { sev: '', agent: '', q: '', mode: 'table', seen: null };
    await render(root, state);
    return { update: () => render(root, state) };
  },
};
