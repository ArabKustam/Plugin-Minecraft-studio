import { h, icon, fmtRelative, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, tag, kv, empty, chip } from '../ui.js';

const CODE = { '??': ['untracked', 'new'], A: ['added', 'new'], M: ['modified', 'mod'], D: ['deleted', 'del'], R: ['renamed', 'mod'], C: ['copied', 'mod'], U: ['conflict', 'del'] };
function changeKind(st) {
  const s2 = String(st || '').trim();
  if (s2 === '??') return CODE['??'];
  for (const ch of s2) if (CODE[ch]) return CODE[ch];
  return [s2 || 'changed', 'mod'];
}

async function render(root) {
  const { status: g, log } = await api('git');
  if (!g?.repo) { root.replaceChildren(pageHeader('Git', 'Version control'), empty('git', 'Not a Git repository', g?.error || 'Initialise Git in the project so the studio can checkpoint work and you can roll back.')); return; }
  const changes = Array.isArray(g.changes) ? g.changes : [];
  const byKind = changes.reduce((acc, c) => { const k = changeKind(c.status)[0]; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  root.replaceChildren(
    pageHeader('Git', g.toplevel || ''),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-top' }, icon('branch', { size: 16 }), h('span', { class: 'stat-label' }, 'Branch')), h('div', { class: 'stat-value mono' }, g.branch || 'detached')),
      h('div', { class: `stat ${g.clean ? '' : 'tone-warn'}` }, h('div', { class: 'stat-label' }, 'Working tree'), h('div', { class: 'stat-value' }, chip(g.clean ? 'clean' : 'dirty', { kind: 'git' })), h('div', { class: 'stat-sub muted' }, g.clean ? 'nothing to commit' : `${g.change_count ?? changes.length} changed path${(g.change_count ?? changes.length) === 1 ? '' : 's'}`)),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Remote'), h('div', { class: 'stat-value small-val mono' }, g.remote ? (typeof g.remote === 'string' ? g.remote : g.remote.url || g.remote.name || JSON.stringify(g.remote)) : 'none')),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Ahead / behind'), h('div', { class: 'stat-value mono' }, g.ahead === null || g.ahead === undefined ? '—' : `↑${g.ahead} ↓${g.behind ?? 0}`), h('div', { class: 'stat-sub muted' }, g.ahead === null || g.ahead === undefined ? 'no upstream' : 'vs upstream'))),
    h('div', { class: 'grid-2' },
      card('Changes', changes.length ? h('div', { class: 'stack-sm' },
        h('div', { class: 'chips' }, Object.entries(byKind).map(([k, n]) => tag(`${n} ${k}`))),
        h('ul', { class: 'changes' }, changes.map((c) => { const [label, cls] = changeKind(c.status); return h('li', null, h('span', { class: `chg chg-${cls}`, title: label }, String(c.status || '').trim() || '?'), h('span', { class: 'mono path' }, c.path)); }))) : h('p', { class: 'ok-text' }, icon('check', { size: 15 }), ' Working tree clean.'), { sub: 'Uncommitted changes in the project' }),
      card('Commits', log?.length ? h('ol', { class: 'commits' }, log.map((c) => h('li', null,
        h('span', { class: 'commit-hash mono', title: c.hash }, c.short || (c.hash || '').slice(0, 7)),
        h('div', { class: 'commit-main' }, h('div', { class: 'commit-subject' }, c.subject), h('div', { class: 'muted small' }, `${c.author || ''} · `, h('time', { title: fmtDate(c.date) }, fmtRelative(c.date))))))) : h('p', { class: 'muted' }, 'No commits yet.'), { sub: `Last ${log?.length || 0} commits on ${g.branch || 'HEAD'}` })),
    g.last_commit ? h('p', { class: 'muted small' }, 'Last commit: ', h('span', { class: 'mono' }, (g.last_commit.hash || '').slice(0, 10)), ` — ${g.last_commit.subject} (${fmtDate(g.last_commit.date)})`) : null);
}

export default { title: 'Git', icon: 'git', async mount(root) { await render(root); return { update: () => render(root) }; } };
