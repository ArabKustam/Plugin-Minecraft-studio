import { h, s, icon, fmtRelative, fmtDate, between, fmtDuration, clear } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, taskChip, tag, kv, jsonBlock, empty, openDrawer, section, identicon, segmented } from '../ui.js';

const TASK_ORDER = ['in-progress', 'ready', 'pending', 'blocked', 'review', 'done', 'failed', 'cancelled'];

function list(items, emptyText = '—') {
  if (!items || (Array.isArray(items) && !items.length)) return h('span', { class: 'muted' }, emptyText);
  if (!Array.isArray(items)) return typeof items === 'object' ? jsonBlock(items) : String(items);
  return h('ul', { class: 'bullets' }, items.map((x) => h('li', null, typeof x === 'object' ? jsonBlock(x) : String(x))));
}

function taskDetail(t, byId, ready) {
  const dur = between(t.started_at, t.finished_at);
  return h('div', { class: 'stack' },
    h('div', { class: 'chips' }, taskChip(ready.has(t.id) && t.status === 'pending' ? 'ready' : t.status), t.agent ? h('span', { class: 'agent-inline' }, identicon(t.agent, 18), t.agent) : tag('unassigned')),
    h('p', { class: 'lead' }, t.goal || 'No goal recorded.'),
    kv([
      ['Created', fmtDate(t.created_at)],
      ['Started', t.started_at ? fmtDate(t.started_at) : null],
      ['Finished', t.finished_at ? `${fmtDate(t.finished_at)}${dur !== null ? ` (${fmtDuration(dur)})` : ''}` : null],
      ['Destination', t.destination ? h('code', { class: 'mono path' }, t.destination) : null],
      ['Depends on', t.dependencies?.length ? h('div', { class: 'chips' }, t.dependencies.map((d) => h('a', { class: 'pill mono', href: `#/tasks/${encodeURIComponent(d)}` }, d, ' ', taskChip(byId.get(d)?.status || '?')))) : null],
      ['Assets', t.assets?.length ? h('div', { class: 'chips' }, t.assets.map((a) => h('a', { class: 'pill mono', href: `#/asset/${encodeURIComponent(a)}` }, a))) : null],
    ]),
    section('Inputs', list(t.inputs)),
    section('Outputs', list(t.outputs)),
    section('Allowed tools', t.allowed_tools?.length ? h('div', { class: 'chips' }, t.allowed_tools.map((x) => h('code', { class: 'pill mono' }, x))) : h('span', { class: 'muted' }, '—')),
    section('Constraints', list(t.constraints)),
    section('Quality bar', list(t.quality)),
    section('Validation', list(t.validation)),
    section('Result', t.result === null || t.result === undefined ? h('span', { class: 'muted' }, 'No result yet.') : typeof t.result === 'object' ? jsonBlock(t.result) : h('p', null, String(t.result))),
    t.plan ? section('Plan', typeof t.plan === 'object' ? jsonBlock(t.plan) : h('p', null, String(t.plan))) : null);
}

function drawEdges(board, svg, edges, nodes) {
  const br = board.getBoundingClientRect();
  svg.setAttribute('width', board.scrollWidth); svg.setAttribute('height', board.scrollHeight);
  clear(svg);
  svg.appendChild(s('defs', null, ['arrow', 'arrow-done'].map((id) => s('marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L8 4L0 8z', class: id })))));
  for (const e of edges) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.right - br.left + board.scrollLeft, y1 = ra.top + ra.height / 2 - br.top + board.scrollTop;
    const x2 = rb.left - br.left + board.scrollLeft - 2, y2 = rb.top + rb.height / 2 - br.top + board.scrollTop;
    const dx = Math.max(30, (x2 - x1) / 2);
    const done = a.dataset.status === 'done';
    svg.appendChild(s('path', { d: `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, class: `edge ${done ? 'edge-done' : ''}`, 'marker-end': done ? 'url(#arrow-done)' : 'url(#arrow)' }));
  }
}

async function render(root, state) {
  const { tasks, graph } = await api('tasks');
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ready = new Set(graph.ready || []);
  state.byId = byId; state.ready = ready;
  const counts = graph.counts || {};
  const head = pageHeader('Tasks', `${tasks.length} production tasks · ${graph.layers?.length || 0} dependency layers · ${ready.size} ready to start`);
  if (!tasks.length) { root.replaceChildren(head, empty('tasks', 'No tasks planned', 'The project director plans tasks with studio_task_plan; they appear here as a dependency graph.')); return; }

  const summary = h('div', { class: 'chips task-summary' }, TASK_ORDER.filter((st) => counts[st]).map((st) => h('span', { class: 'count-chip' }, taskChip(st), h('b', null, String(counts[st])))));
  const agentFilter = [...new Set(tasks.map((t) => t.agent).filter(Boolean))];
  const nodes = new Map();
  const board = h('div', { class: 'graph-board', role: 'list', 'aria-label': 'Task dependency graph' });
  const svg = s('svg', { class: 'graph-edges', 'aria-hidden': 'true' });
  board.appendChild(svg);
  const cols = h('div', { class: 'graph-cols' });
  (graph.layers || []).forEach((layer, li) => {
    const col = h('div', { class: 'graph-col' }, h('div', { class: 'graph-col-head' }, `Layer ${li + 1}`, h('span', { class: 'muted' }, ` · ${layer.length} parallel`)));
    for (const id of layer) {
      const t = byId.get(id);
      if (!t) continue;
      const st = ready.has(id) && t.status === 'pending' ? 'ready' : t.status;
      const node = h('button', { type: 'button', class: `task-node st-${st} ${state.agent && t.agent !== state.agent ? 'dim' : ''}`, 'data-status': t.status, role: 'listitem', onclick: () => { location.hash = `#/tasks/${encodeURIComponent(id)}`; } },
        h('div', { class: 'tn-head' }, h('span', { class: 'tn-id mono' }, id), taskChip(st)),
        h('p', { class: 'tn-goal' }, t.goal || '—'),
        h('div', { class: 'tn-foot' }, t.agent ? h('span', { class: 'agent-inline' }, identicon(t.agent, 16), t.agent) : h('span', { class: 'muted' }, 'unassigned'),
          t.dependencies?.length ? h('span', { class: 'muted small', title: `depends on ${t.dependencies.join(', ')}` }, `${t.dependencies.length} dep`) : null));
      nodes.set(id, node);
      col.appendChild(node);
    }
    cols.appendChild(col);
  });
  board.appendChild(cols);
  const filterBar = agentFilter.length > 1 ? segmented([{ value: '', label: 'All agents' }, ...agentFilter.map((a) => ({ value: a, label: a }))], state.agent || '', (v) => { state.agent = v; for (const [id, n] of nodes) n.classList.toggle('dim', !!v && byId.get(id).agent !== v); }, { label: 'Agent filter' }) : null;

  root.replaceChildren(head, h('div', { class: 'toolbar' }, summary, h('div', { class: 'toolbar-spacer' }), filterBar),
    card(null, board, { cls: 'card-flush' }),
    h('p', { class: 'muted small legend-note' }, 'Columns are topological layers — tasks in one column can run in parallel. Arrows point from a dependency to the task that needs it.'));
  const redraw = () => drawEdges(board, svg, graph.edges || [], nodes);
  requestAnimationFrame(redraw);
  state.ro?.disconnect();
  state.ro = new ResizeObserver(redraw);
  state.ro.observe(board);
  board.addEventListener('scroll', redraw, { passive: true });
}

function openTask(state, id) {
  const t = state.byId?.get(id);
  if (!t) return;
  openDrawer(h('div', null, h('p', { class: 'eyebrow' }, 'Task'), h('h2', { class: 'mono' }, t.id)), taskDetail(t, state.byId, state.ready), {
    onClose: () => { if (location.hash.startsWith('#/tasks/')) history.replaceState(null, '', '#/tasks'); state.param = null; },
  });
}

export default {
  title: 'Tasks', icon: 'tasks',
  async mount(root, { param }) {
    const state = { param };
    await render(root, state);
    if (param) requestAnimationFrame(() => openTask(state, param));
    return {
      update: () => render(root, state),
      setParam: (p) => { state.param = p; if (p) openTask(state, p); },
      destroy: () => state.ro?.disconnect(),
    };
  },
};
