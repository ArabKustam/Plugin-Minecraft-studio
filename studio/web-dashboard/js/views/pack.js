import { h, icon, fmtRelative, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, tag, kv, chip, sevChip, empty, jsonBlock, hbars, mono } from '../ui.js';

const COUNT_LABELS = { textures: 'Textures', models: 'Models', item_definitions: 'Item definitions', blockstates: 'Blockstates', sounds: 'Sounds', sound_events: 'Sound events', particles: 'Particles', animated_textures: 'Animated textures', functions: 'Functions' };

function issuesTable(details) {
  const issues = Array.isArray(details?.issues) ? details.issues : Array.isArray(details) ? details : null;
  if (!issues) return details ? jsonBlock(details, { maxHeight: 360 }) : h('p', { class: 'muted' }, 'No details recorded.');
  if (!issues.length) return h('p', { class: 'ok-text' }, icon('check', { size: 15 }), ' No issues found.');
  const known = ['severity', 'level', 'file', 'path', 'message', 'detail'];
  const extraKeys = [...new Set(issues.flatMap((i) => Object.keys(i || {})))].filter((k) => !known.includes(k)).slice(0, 3);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Severity'), h('th', null, 'File'), h('th', null, 'Message'), ...extraKeys.map((k) => h('th', null, k)))),
    h('tbody', null, issues.map((i) => h('tr', null,
      h('td', null, sevChip(i.severity || i.level || 'info')),
      h('td', { class: 'mono path small' }, i.file || i.path || '—'),
      h('td', null, i.message || i.detail || ''),
      ...extraKeys.map((k) => h('td', { class: 'small mono' }, typeof i[k] === 'object' ? JSON.stringify(i[k]) : String(i[k] ?? '')))))))); }

async function render(root) {
  const [proj, tests] = await Promise.all([api('project'), api('tests')]);
  const packs = proj.profile?.packs || [];
  const run = tests.find((r) => r.suite === 'resource-pack');
  const history = tests.filter((r) => r.suite === 'resource-pack').slice(0, 8);
  root.replaceChildren(
    pageHeader('Resource Pack', `${packs.length} pack${packs.length === 1 ? '' : 's'} detected · namespaces ${(proj.profile?.namespaces || []).join(', ') || '—'}`),
    packs.length ? h('div', { class: 'grid-2' }, packs.map((p) => {
      const counts = Object.entries(p.counts || {}).map(([k, v]) => ({ label: COUNT_LABELS[k] || k, value: v }));
      const res = Object.entries(p.texture_resolutions || p.resolutions || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }));
      return card(p.dir || 'pack', h('div', { class: 'stack' },
        kv([
          ['Kind', tag(p.kind || 'pack', 'tag-accent')],
          ['pack_format', p.pack_format !== undefined && p.pack_format !== null ? mono(String(p.pack_format)) : null],
          ['Supported formats', p.min_format || p.max_format ? mono(`${p.min_format ?? '?'} – ${p.max_format ?? '?'}`) : null],
          ['Description', typeof p.description === 'string' ? p.description : p.description ? JSON.stringify(p.description) : null],
          ['Namespaces', p.namespaces?.length ? h('div', { class: 'chips' }, p.namespaces.map((n) => mono(n, 'pill'))) : null],
        ]),
        h('div', { class: 'count-grid' }, counts.map((c) => h('div', { class: `count-cell ${c.value ? '' : 'zero'}` }, h('span', { class: 'count-num' }, String(c.value)), h('span', { class: 'count-label' }, c.label)))),
        res.length ? h('div', null, h('h3', { class: 'h-sub' }, 'Texture resolutions'), hbars(res)) : null), { sub: p.kind });
    })) : card(null, empty('pack', 'No resource pack detected', 'The project analysis found no pack.mcmeta. Re-run /minecraft-studio:init after adding a resource pack.')),
    card('Latest pack validation', run ? h('div', { class: 'stack' },
      h('div', { class: 'run-head' }, chip(run.passed ? 'passed' : 'failed', { kind: 'verdict' }), h('strong', null, run.summary || ''), h('time', { class: 'muted small', title: fmtDate(run.at) }, fmtRelative(run.at)), run.agent ? tag(run.agent) : null),
      issuesTable(run.details)) : empty('tests', 'No resource-pack test run yet', 'Pack validation results (suite "resource-pack") recorded with studio_test_record appear here.'),
    { sub: 'Most recent run of the "resource-pack" suite' }),
    history.length > 1 ? card('Validation history', h('ul', { class: 'mini-list runs' }, history.map((r) => h('li', null, chip(r.passed ? 'passed' : 'failed', { kind: 'verdict' }), h('span', null, r.summary || ''), h('time', { class: 'muted small push', title: fmtDate(r.at) }, fmtRelative(r.at)))))) : null);
}

export default {
  title: 'Resource Pack', icon: 'pack',
  async mount(root) { await render(root); return { update: () => render(root) }; },
};
