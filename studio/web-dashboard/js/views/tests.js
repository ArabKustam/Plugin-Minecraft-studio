import { h, icon, fmtRelative, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, chip, tag, empty, jsonBlock, segmented } from '../ui.js';

async function render(root, state) {
  const runs = await api('tests');
  const suites = [...new Set(runs.map((r) => r.suite || 'tests'))];
  const latest = new Map();
  for (const r of runs) if (!latest.has(r.suite)) latest.set(r.suite, r);
  const rows = runs.filter((r) => (!state.suite || r.suite === state.suite) && (state.result === '' || state.result === undefined || String(r.passed) === state.result));
  const passed = runs.filter((r) => r.passed).length;
  root.replaceChildren(
    pageHeader('Tests', `${runs.length} recorded run${runs.length === 1 ? '' : 's'} · ${passed} passed · ${runs.length - passed} failed`),
    latest.size ? h('div', { class: 'suite-grid' }, [...latest.values()].map((r) => h('button', { type: 'button', class: `suite-card ${r.passed ? 'ok' : 'bad'} ${state.suite === r.suite ? 'active' : ''}`, onclick: () => { state.suite = state.suite === r.suite ? '' : r.suite; render(root, state); } },
      h('div', { class: 'suite-top' }, h('span', { class: 'mono strong' }, r.suite), chip(r.passed ? 'passed' : 'failed', { kind: 'verdict' })),
      h('p', { class: 'small' }, r.summary || ''),
      h('time', { class: 'muted small', title: fmtDate(r.at) }, fmtRelative(r.at))))) : null,
    runs.length ? h('div', { class: 'toolbar' },
      segmented([{ value: '', label: 'All suites' }, ...suites.map((s2) => ({ value: s2, label: s2 }))], state.suite || '', (v) => { state.suite = v; render(root, state); }, { label: 'Suite' }),
      segmented([{ value: '', label: 'Any result' }, { value: 'true', label: 'Passed' }, { value: 'false', label: 'Failed' }], state.result || '', (v) => { state.result = v; render(root, state); }, { label: 'Result' })) : null,
    runs.length ? h('div', { class: 'run-list' }, rows.map((r) => h('details', { class: `run card ${r.passed ? 'ok' : 'bad'}`, open: state.open.has(r.id), ontoggle: (e) => { if (e.target.open) state.open.add(r.id); else state.open.delete(r.id); } },
      h('summary', null,
        h('span', { class: 'run-status', 'aria-hidden': 'true' }, icon(r.passed ? 'check' : 'x', { size: 16 })),
        h('span', { class: 'mono strong' }, r.suite || 'tests'),
        h('span', { class: 'run-summary' }, r.summary || ''),
        r.agent ? tag(r.agent) : null,
        h('time', { class: 'muted small push', datetime: r.at, title: fmtDate(r.at) }, fmtRelative(r.at)),
        chip(r.passed ? 'passed' : 'failed', { kind: 'verdict' })),
      h('div', { class: 'run-body' }, h('div', { class: 'muted small mono' }, `run ${r.id} · ${fmtDate(r.at)}`), r.details !== undefined && r.details !== null ? jsonBlock(r.details, { maxHeight: 480 }) : h('p', { class: 'muted' }, 'No details recorded.'))))) : empty('tests', 'No test runs yet', 'Build, unit, resource-pack and in-game test results recorded with studio_test_record show up here.'),
    rows.length || !runs.length ? null : h('p', { class: 'muted pad' }, 'No runs match the filter.'));
}

export default {
  title: 'Tests', icon: 'tests',
  async mount(root) {
    const state = { suite: '', result: '', open: new Set() };
    await render(root, state);
    return { update: () => render(root, state) };
  },
};
