import { h, icon, fmtRelative, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, tag, mono, chip, statusChip, thumb, assetHref, activityTimeline, donut, legend, hbars, ASSET_STATUSES, STATUS_COLOR, identicon, empty, TYPE_ICON } from '../ui.js';

const QA_ORDER = [['passed', 'var(--ok)'], ['warnings', 'var(--warn)'], ['failed', 'var(--danger)'], ['pending', 'var(--muted)'], ['n/a', 'var(--surface-3)']];

function stat(label, value, sub, { iconName, tone = '' } = {}) {
  return h('div', { class: `stat ${tone}` },
    h('div', { class: 'stat-top' }, iconName ? h('span', { class: 'stat-icon' }, icon(iconName, { size: 16 })) : null, h('span', { class: 'stat-label' }, label)),
    h('div', { class: 'stat-value' }, value),
    sub ? h('div', { class: 'stat-sub muted' }, sub) : null);
}

async function render(root) {
  const [ov, activity, all, timelines] = await Promise.all([api('overview'), api('activity', { limit: 15 }), api('assets', { existing: 1 }).catch(() => []), api('timelines').catch(() => [])]);
  const byId = new Map(all.map((a) => [a.id, a]));
  const p = ov.project || {};
  const platforms = (p.platforms || []).map((x) => x.name || x.adapter).filter(Boolean);
  const tasksCount = ov.tasks?.counts || {};
  const totalTasks = Object.values(tasksCount).reduce((a, b) => a + b, 0);
  const qa = ov.qa?.counts || {};

  const header = h('header', { class: 'hero' },
    h('div', { class: 'hero-main' },
      h('p', { class: 'eyebrow' }, 'Project overview'),
      h('h1', null, p.name || 'Untitled project'),
      h('div', { class: 'chips' },
        p.minecraft_version ? tag(`Minecraft ${p.minecraft_version}`, 'tag-accent') : tag('version unknown'),
        ...(platforms.length ? platforms : [p.platform || 'unknown platform']).map((x) => tag(x)),
        p.default_namespace ? tag(`ns: ${p.default_namespace}`, 'mono') : null)),
    h('div', { class: 'hero-side' },
      h('div', { class: 'kvi' }, h('span', { class: 'muted' }, 'Plugin version'), h('strong', { class: 'mono' }, p.plugin_version || '—')),
      h('div', { class: 'kvi' }, h('span', { class: 'muted' }, 'Resource pack'), h('strong', { class: 'mono' }, p.resource_pack_version || '—'))));

  const build = ov.build;
  const stats = h('div', { class: 'stats' },
    stat('Build', build ? chip(build.passed ? 'passed' : 'failed', { kind: 'verdict' }) : h('span', { class: 'muted' }, 'no runs'), build ? `${build.summary || ''} · ${fmtRelative(build.at)}` : 'record a "build" test run', { iconName: 'bolt' }),
    stat('Assets', String(ov.assets?.total ?? 0), `${Object.keys(ov.assets?.by_type || {}).length} types`, { iconName: 'layers' }),
    stat('QA', h('span', { class: 'qa-mini' }, QA_ORDER.filter(([k]) => qa[k]).map(([k]) => h('span', { class: `qa-n is-${k.replace('/', '_')}`, title: k }, h('b', null, String(qa[k])), ` ${k}`))), `${qa.passed || 0} passed of ${Object.values(qa).reduce((a, b) => a + b, 0)}`, { iconName: 'tests' }),
    stat('Tasks', `${tasksCount.done || 0}/${totalTasks}`, `${tasksCount['in-progress'] || 0} in progress · ${tasksCount.pending || 0} pending`, { iconName: 'tasks' }),
    stat('Git', ov.git ? h('span', { class: 'mono' }, ov.git.branch || 'detached') : h('span', { class: 'muted' }, 'no repo'), ov.git ? (ov.git.last_commit ? `${ov.git.clean ? 'clean' : `${ov.git.changes} changes`} · ${ov.git.last_commit.subject}` : 'no commits') : 'not a git repository', { iconName: 'git', tone: ov.git && !ov.git.clean ? 'tone-warn' : '' }),
    stat('Provider spend', `$${Number(ov.usage || 0).toFixed(2)}`, 'estimated, paid providers', { iconName: 'dollar' }));

  // status breakdown
  const statusEntries = ASSET_STATUSES.map((st) => ({ label: st, value: ov.assets?.by_status?.[st] || 0, color: STATUS_COLOR[st] }));
  const typeEntries = Object.entries(ov.assets?.by_type || {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: t, value: n }));
  const breakdown = card('Asset status', h('div', { class: 'donut-row' }, donut(statusEntries), legend(statusEntries)), { sub: 'All registered assets by lifecycle status' });
  const byType = card('Assets by type', typeEntries.length ? hbars(typeEntries) : h('p', { class: 'muted' }, 'No assets yet.'));

  // agents & current tasks
  const agentsCard = card('Active agents', h('div', { class: 'stack' },
    ov.agents?.length ? h('ul', { class: 'agent-pills' }, ov.agents.map((a) => h('li', null, h('a', { href: '#/agents', class: 'agent-pill' }, identicon(a, 22), h('span', null, a), chip('working', { kind: 'agent' }))))) : h('p', { class: 'muted' }, 'No agent is working right now.'),
    h('div', null, h('h3', { class: 'h-sub' }, 'Current tasks'),
      ov.tasks?.current?.length ? h('ul', { class: 'mini-list' }, ov.tasks.current.map((t) => h('li', null, h('a', { href: `#/tasks/${encodeURIComponent(t.id)}` }, h('strong', null, t.id)), h('span', { class: 'muted' }, ` · ${t.agent || 'unassigned'}`), h('p', { class: 'small' }, t.goal || '')))) : h('p', { class: 'muted' }, 'No tasks in progress.'))),
    { actions: h('a', { class: 'link-more', href: '#/agents' }, 'All agents ', icon('chevron', { size: 14 })) });

  const recent = card('Recent assets', ov.assets?.recent?.length
    ? h('div', { class: 'recent-grid' }, ov.assets.recent.map((a) => h('a', { class: 'recent-card', href: assetHref(a) },
      thumb(byId.get(a.id) || a, { size: 'md', usePreview: a.type !== 'texture' }),
      h('div', { class: 'rc-body' }, h('div', { class: 'rc-name' }, a.name), h('div', { class: 'rc-meta' }, h('span', { class: 'rc-type' }, icon(TYPE_ICON[a.type] || 'file', { size: 12 }), a.type), h('span', { class: 'muted' }, `v${a.version}`)), statusChip(a.status)))))
    : empty('layers', 'No assets yet', 'Assets created by the studio agents appear here.'),
  { actions: h('a', { class: 'link-more', href: '#/textures' }, 'Browse ', icon('chevron', { size: 14 })) });

  const runs = card('Latest test runs', ov.qa?.last_runs?.length ? h('ul', { class: 'mini-list runs' }, ov.qa.last_runs.map((r) => h('li', null, chip(r.passed ? 'passed' : 'failed', { kind: 'verdict' }), h('strong', { class: 'mono' }, r.suite), h('span', { class: 'muted small' }, r.summary || ''), h('time', { class: 'muted small push', datetime: r.at, title: fmtDate(r.at) }, fmtRelative(r.at))))) : h('p', { class: 'muted' }, 'No test runs recorded.'),
    { actions: h('a', { class: 'link-more', href: '#/tests' }, 'Tests ', icon('chevron', { size: 14 })) });

  const timeline = card('Activity', activityTimeline(activity, { compact: true }), { actions: h('a', { class: 'link-more', href: '#/logs' }, 'Full log ', icon('chevron', { size: 14 })) });

  root.replaceChildren(header, stats,
    h('div', { class: 'grid-ov' },
      h('div', { class: 'col-main' }, recent, h('div', { class: 'grid-2' }, breakdown, byType), runs),
      h('div', { class: 'col-side' }, agentsCard, timeline, timelines.length ? card('Timelines', h('ul', { class: 'mini-list' }, timelines.map((t) => h('li', null, h('strong', null, t.title || t.id), h('span', { class: 'muted small mono' }, t.id), h('span', { class: 'muted small push' }, t.compiled_cues === null ? 'invalid' : `${t.compiled_cues} cues`), h('p', { class: 'small' }, Object.keys(t.tracks || {}).join(' · '))))), { sub: 'Synchronised event timelines' }) : null)));
}

export default {
  title: 'Overview', icon: 'overview',
  async mount(root) {
    await render(root);
    return { update: () => render(root) };
  },
};
