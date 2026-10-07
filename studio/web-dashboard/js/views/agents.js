import { h, icon, fmtRelative, fmtDate, between, fmtDuration } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, chip, taskChip, identicon, empty, activityTimeline, segmented } from '../ui.js';

function chips(items, cls = 'pill mono') {
  if (!items?.length) return h('span', { class: 'muted small' }, '—');
  return h('div', { class: 'chips' }, items.map((x) => h('code', { class: cls }, typeof x === 'object' ? JSON.stringify(x) : String(x))));
}

function agentCard(a, events) {
  const working = a.tasks.filter((t) => t.status === 'in-progress');
  return h('article', { class: `card agent-card st-${a.status}` },
    h('header', { class: 'agent-head' },
      h('div', { class: 'agent-avatar' }, identicon(a.agent, 44)),
      h('div', { class: 'agent-title' }, h('h2', null, a.agent), h('p', { class: 'muted small' }, a.last_activity ? h('time', { datetime: a.last_activity, title: fmtDate(a.last_activity), 'data-rel': '' }, `last active ${fmtRelative(a.last_activity)}`) : 'no activity yet', a.events ? ` · ${a.events} events` : '')),
      chip(a.status, { kind: 'agent' })),
    working.length ? h('div', { class: 'agent-now' }, icon('bolt', { size: 14 }), h('span', null, 'Working on '), h('a', { href: `#/tasks/${encodeURIComponent(working[0].id)}`, class: 'mono' }, working[0].id), h('span', { class: 'muted' }, ` — ${working[0].goal || ''}`)) : null,
    a.tasks.length ? h('div', { class: 'agent-tasks' }, a.tasks.map((t) => {
      const dur = between(t.started, t.finished);
      return h('details', { class: 'agent-task', open: t.status === 'in-progress' },
        h('summary', null, taskChip(t.status), h('span', { class: 'mono' }, t.id), h('span', { class: 'muted at-goal' }, t.goal || '')),
        h('div', { class: 'at-body' },
          h('div', { class: 'at-times small' },
            h('span', null, icon('clock', { size: 13 }), ' started ', t.started ? h('time', { title: fmtDate(t.started) }, fmtRelative(t.started)) : '—'),
            h('span', null, ' · finished ', t.finished ? h('time', { title: fmtDate(t.finished) }, fmtRelative(t.finished)) : '—'),
            dur !== null ? h('span', null, ` · ${fmtDuration(dur)}`) : null),
          h('div', { class: 'at-grid' },
            h('div', null, h('h4', null, 'Inputs'), chips(t.inputs)),
            h('div', null, h('h4', null, 'Outputs'), chips(t.outputs)),
            h('div', null, h('h4', null, 'Tools'), chips(t.tools))),
          t.result !== null && t.result !== undefined ? h('div', null, h('h4', null, 'Result'), h('p', { class: 'small mono' }, typeof t.result === 'object' ? JSON.stringify(t.result) : String(t.result))) : null,
          h('a', { class: 'link-more small', href: `#/tasks/${encodeURIComponent(t.id)}` }, 'Open task ', icon('chevron', { size: 12 }))));
    })) : h('p', { class: 'muted small pad-x' }, 'No assigned tasks — contributes through activity only.'),
    h('div', { class: 'agent-activity' }, h('h4', null, 'Recent activity'), activityTimeline(events.slice(0, 4), { compact: true, empty: 'No activity entries.' })));
}

async function render(root, state) {
  const [agents, activity] = await Promise.all([api('agents'), api('activity', { limit: 500 })]);
  const byAgent = new Map();
  for (const e of activity) { if (!byAgent.has(e.agent)) byAgent.set(e.agent, []); byAgent.get(e.agent).push(e); }
  const counts = agents.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const filtered = agents.filter((a) => !state.status || a.status === state.status);
  const order = { working: 0, queued: 1, idle: 2 };
  filtered.sort((a, b) => (order[a.status] - order[b.status]) || (b.last_activity || '').localeCompare(a.last_activity || ''));
  root.replaceChildren(
    pageHeader('Agent Inspector', 'What each studio agent is doing — tasks, inputs, outputs and tools. Only user-facing activity summaries are shown; hidden reasoning is never recorded.'),
    h('div', { class: 'toolbar' }, segmented([{ value: '', label: 'All', count: agents.length }, ...['working', 'queued', 'idle'].map((s2) => ({ value: s2, label: s2, count: counts[s2] || 0 }))], state.status || '', (v) => { state.status = v; render(root, state); }, { label: 'Agent status filter' })),
    filtered.length ? h('div', { class: 'agent-grid' }, filtered.map((a) => agentCard(a, byAgent.get(a.agent) || []))) : empty('agents', 'No agents', 'Agents appear once tasks are assigned or activity is logged.'));
}

export default {
  title: 'Agents', icon: 'agents',
  async mount(root) {
    const state = {};
    await render(root, state);
    return { update: () => render(root, state) };
  },
};
