// Minecraft Studio Dashboard — app shell: routing, sidebar, global search,
// theme, live updates (SSE with polling fallback).
import { h, icon, clear, prefs, debounce, fmtRelative } from './js/dom.js';
import { api, clearFileCache } from './js/api.js';
import { empty, errorBox, spinner, statusChip, thumb, assetHref, closeDrawer, drawerOpen, tag } from './js/ui.js';
import { VIEWS, NAV } from './js/views/index.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const crumbs = document.getElementById('crumbs');
const live = document.getElementById('live');
const foot = document.getElementById('sidebar-foot');

const app = {
  showExisting: prefs.get('showExisting', false),
  initialized: null,
  health: null,
  setShowExisting(v) { this.showExisting = v; prefs.set('showExisting', v); refresh({ full: true }); },
  navigate(hash) { if (location.hash !== hash) location.hash = hash; else route(); },
};

// ------------------------------------------------------------------ theme
const themeBtn = document.getElementById('theme-toggle');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon'));
  themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  themeBtn.title = themeBtn.getAttribute('aria-label');
  window.dispatchEvent(new CustomEvent('themechange'));
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  prefs.set('theme', next);
  applyTheme(next);
});

// ------------------------------------------------------------------ sidebar
const navLinks = new Map();
function buildNav() {
  clear(nav);
  for (const group of NAV) {
    nav.appendChild(h('div', { class: 'nav-group' },
      h('div', { class: 'nav-label' }, group.label),
      h('ul', null, group.items.map((id) => {
        const v = VIEWS[id];
        const count = h('span', { class: 'nav-count' });
        const a = h('a', { href: `#/${id}`, class: 'nav-link', title: v.title }, icon(v.icon), h('span', { class: 'nav-text' }, v.title), count);
        navLinks.set(id, { a, count });
        return h('li', null, a);
      }))));
  }
}
buildNav();

let initPoll = null;
const TYPE_FOR_VIEW ={ code: 'code', textures: 'texture', '3d': 'model', animations: 'animation', sfx: 'sfx', music: 'music', voice: 'voice', particles: 'particle', guides: 'guide' };
async function refreshSidebar() {
  try {
    const health = await api('health');
    app.health = health;
    app.initialized = health.initialized;
    // The server can only watch .minecraft-studio once it exists, so poll until init happens.
    if (!health.initialized && !initPoll) initPoll = setInterval(() => { api('health').then((hh) => { if (hh.initialized) { clearInterval(initPoll); initPoll = null; refresh({ full: true }); } }).catch(() => {}); }, 4000);
    if (!health.initialized) { foot.replaceChildren(h('div', { class: 'proj' }, h('span', { class: 'muted small' }, 'Not initialised'))); return; }
    const [ov, assets] = await Promise.all([api('overview'), api('assets', { existing: app.showExisting ? 1 : undefined })]);
    const counts = {};
    for (const a of assets) { if (!app.showExisting && a.tags?.includes('existing')) continue; counts[a.type] = (counts[a.type] || 0) + 1; }
    for (const [view, type] of Object.entries(TYPE_FOR_VIEW)) {
      const n = navLinks.get(view);
      if (n) n.count.textContent = counts[type] ? String(counts[type]) : '';
    }
    const tl = navLinks.get('tasks');
    if (tl) tl.count.textContent = ov.tasks?.counts?.['in-progress'] ? String(ov.tasks.counts['in-progress']) : '';
    const p = ov.project || {};
    foot.replaceChildren(h('div', { class: 'proj' },
      h('div', { class: 'proj-name', title: health.project }, p.name || 'Untitled project'),
      h('div', { class: 'proj-meta' }, p.minecraft_version ? tag(`MC ${p.minecraft_version}`, 'tag-accent') : null, p.platform ? tag(p.platform) : null),
      ov.git ? h('div', { class: 'proj-git muted small' }, icon('branch', { size: 14 }), h('span', null, ov.git.branch || 'detached'), h('span', { class: ov.git.clean ? 'dot ok' : 'dot warn', title: ov.git.clean ? 'clean' : `${ov.git.changes} changes` })) : null));
  } catch (e) {
    foot.replaceChildren(h('div', { class: 'proj muted small' }, 'Server unreachable'));
  }
}

// ------------------------------------------------------------------ routing
let current = null; // { id, inst, container }
let routeSeq = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, ...rest] = raw.split('/');
  return { id: id || 'overview', param: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

function setActiveNav(id) {
  for (const [k, { a }] of navLinks) {
    if (k === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function route() {
  const { id, param } = parseHash();
  const view = VIEWS[id];
  if (!view) { location.replace('#/overview'); return; }
  // same view, different param: let the view handle it without remounting
  if (current && current.id === id && current.inst?.setParam) {
    current.param = param;
    current.inst.setParam(param);
    return;
  }
  if (drawerOpen()) closeDrawer(true);
  const seq = ++routeSeq;
  current?.inst?.destroy?.();
  current = null;
  setActiveNav(id);
  crumbs.replaceChildren(h('span', { class: 'crumb-root' }, 'Studio'), h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'), h('span', { class: 'crumb-cur' }, view.title));
  document.title = `${view.title} · Minecraft Studio`;
  main.replaceChildren(spinner());
  await mountView(id, param, seq);
  if (seq === routeSeq) main.focus({ preventScroll: true });
}

async function mountView(id, param, seq, { keepScroll = false } = {}) {
  const view = VIEWS[id];
  if (app.initialized === null) await refreshSidebar();
  if (seq !== routeSeq) return;
  const container = h('div', { class: `view view-${id}` });
  if (app.initialized === false && !view.allowUninitialized) {
    main.replaceChildren(notInitialized());
    current = { id, param, inst: null, container };
    return;
  }
  let inst = null;
  try {
    inst = await view.mount(container, { param, app });
  } catch (e) {
    if (seq !== routeSeq) return;
    if (e?.status === 409) { app.initialized = false; main.replaceChildren(notInitialized()); current = { id, param, inst: null, container }; return; }
    container.replaceChildren(errorBox(e));
    console.warn(e);
  }
  if (seq !== routeSeq) { inst?.destroy?.(); return; }
  const y = main.scrollTop;
  main.replaceChildren(container);
  if (keepScroll) main.scrollTop = y;
  current = { id, param, inst, container };
}

function notInitialized() {
  return h('div', { class: 'view' }, empty('bolt', 'Minecraft Studio is not initialised here',
    'This project has no .minecraft-studio folder yet. Run the init workflow in Claude Code to analyse the project and create the studio state:',
    h('div', { class: 'stack-sm center' }, h('code', { class: 'cmd' }, '/minecraft-studio:init'), h('p', { class: 'muted small' }, app.health?.project ? `Project: ${app.health.project}` : ''))));
}

// ------------------------------------------------------------------ live refresh
let refreshing = false, pending = false;
async function refresh({ full = false } = {}) {
  if (refreshing) { pending = true; return; }
  refreshing = true;
  try {
    clearFileCache();
    const wasInit = app.initialized;
    await refreshSidebar();
    if (!current) return;
    if (wasInit !== app.initialized) { routeSeq++; await mountView(current.id, parseHash().param, routeSeq); return; }
    if (!full && current.inst?.update) await current.inst.update();
    else if (!drawerOpen() || full) { if (drawerOpen()) closeDrawer(true); current.inst?.destroy?.(); routeSeq++; await mountView(current.id, parseHash().param, routeSeq, { keepScroll: true }); }
  } catch (e) { console.warn('refresh failed', e); } finally {
    refreshing = false;
    if (pending) { pending = false; refresh(); }
  }
}
const scheduleRefresh = debounce(() => refresh(), 450);

function setLive(mode) {
  live.className = `live live-${mode}`;
  live.replaceChildren(h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('span', { class: 'live-text' }, mode === 'sse' ? 'Live' : mode === 'poll' ? 'Polling' : 'Offline'));
  live.title = mode === 'sse' ? 'Live updates via server-sent events' : mode === 'poll' ? 'Live updates unavailable — polling every 5 s' : 'Server unreachable';
}

let pollTimer = null, lastSig = null;
async function pollOnce() {
  try {
    const [ov, act] = await Promise.all([api('overview').catch((e) => (e.status === 409 ? { uninit: true } : Promise.reject(e))), api('activity', { limit: 1 }).catch(() => [])]);
    const sig = JSON.stringify(ov) + JSON.stringify(act[0] || null);
    if (lastSig !== null && sig !== lastSig) refresh();
    lastSig = sig;
    if (live.classList.contains('live-off')) setLive('poll');
  } catch { setLive('off'); }
}
function startPolling() {
  if (pollTimer) return;
  setLive('poll');
  pollOnce();
  pollTimer = setInterval(pollOnce, 5000);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

function connectEvents() {
  // ?live=0 renders a static snapshot (screenshots, printing): no event stream, no polling
  if (new URLSearchParams(location.search).get('live') === '0') return;
  if (!('EventSource' in window)) { startPolling(); return; }
  let errors = 0;
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => { errors = 0; stopPolling(); setLive('sse'); });
  es.addEventListener('change', () => scheduleRefresh());
  es.onerror = () => {
    errors++;
    if (es.readyState === EventSource.CLOSED || errors >= 2) {
      startPolling();
      if (es.readyState === EventSource.CLOSED) setTimeout(connectEvents, 15000);
    }
  };
}

// ------------------------------------------------------------------ global search
const search = document.getElementById('global-search');
const results = document.getElementById('search-results');
document.querySelector('.search-icon').appendChild(icon('search', { size: 16 }));
let resultItems = [], activeIdx = -1;

function closeResults() { results.hidden = true; search.setAttribute('aria-expanded', 'false'); search.removeAttribute('aria-activedescendant'); activeIdx = -1; }
function highlight(i) {
  activeIdx = i;
  resultItems.forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
  if (resultItems[i]) { search.setAttribute('aria-activedescendant', resultItems[i].id); resultItems[i].scrollIntoView({ block: 'nearest' }); }
}
const runSearch = debounce(async () => {
  const q = search.value.trim();
  if (!q) { closeResults(); return; }
  let list = [];
  try { list = await api('assets', { q, existing: 1 }); } catch { list = []; }
  if (search.value.trim() !== q) return;
  const ql = q.toLowerCase();
  list.sort((a, b) => (b.name.toLowerCase().startsWith(ql) - a.name.toLowerCase().startsWith(ql)) || (b.id.toLowerCase().startsWith(ql) - a.id.toLowerCase().startsWith(ql)));
  list = list.slice(0, 12);
  clear(results);
  resultItems = list.map((a, i) => {
    const li = h('li', { id: `sr-${i}`, role: 'option', class: 'sr-item', 'aria-selected': 'false', onmousedown: (e) => { e.preventDefault(); go(a); } },
      thumb(a, { size: 'xs' }),
      h('div', { class: 'sr-main' }, h('div', { class: 'sr-name' }, a.name), h('div', { class: 'sr-id mono muted' }, a.id)),
      h('span', { class: 'sr-type' }, a.type), statusChip(a.status));
    results.appendChild(li);
    return li;
  });
  if (!list.length) results.appendChild(h('li', { class: 'sr-empty muted', role: 'option', 'aria-disabled': 'true' }, `No assets match “${q}”`));
  results.hidden = false;
  search.setAttribute('aria-expanded', 'true');
  highlight(list.length ? 0 : -1);
}, 160);
function go(a) { closeResults(); search.value = ''; search.blur(); app.navigate(assetHref(a)); }
search.addEventListener('input', runSearch);
search.addEventListener('focus', () => { if (search.value.trim()) runSearch(); });
search.addEventListener('blur', () => setTimeout(closeResults, 120));
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && resultItems.length) { e.preventDefault(); highlight((activeIdx + 1) % resultItems.length); }
  else if (e.key === 'ArrowUp' && resultItems.length) { e.preventDefault(); highlight((activeIdx - 1 + resultItems.length) % resultItems.length); }
  else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); resultItems[activeIdx].dispatchEvent(new MouseEvent('mousedown')); }
  else if (e.key === 'Escape') { closeResults(); search.blur(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !drawerOpen()) { e.preventDefault(); search.focus(); }
});

// ------------------------------------------------------------------ boot
window.addEventListener('hashchange', route);
setLive('sse');
connectEvents();
route();
// keep relative times fresh
setInterval(() => { for (const t of document.querySelectorAll('time[data-rel]')) t.textContent = fmtRelative(t.getAttribute('datetime')); }, 30000);
