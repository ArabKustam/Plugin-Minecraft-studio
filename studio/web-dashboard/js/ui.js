// Shared UI components: chips, cards, empty states, drawer, JSON viewer,
// activity timeline, generic asset detail sections, charts.
import { h, s, icon, fmtRelative, fmtDate, fmtBytes, fmtTimeShort, ext, hash, clear } from './dom.js';
import { fileUrl } from './api.js';

export const ASSET_STATUSES = ['idea', 'draft', 'review', 'changes-requested', 'approved', 'integrated', 'deprecated'];
export const STATUS_LABEL = { 'changes-requested': 'changes req.', 'in-progress': 'in progress', 'n/a': 'n/a' };

/** Chunky pixel status chip. kind picks the colour family. */
export function chip(value, { kind = 'status', title } = {}) {
  const v = String(value ?? 'unknown');
  return h('span', { class: `chip chip-${kind} is-${v.replace(/[^a-z0-9-]/gi, '_').toLowerCase()}`, title: title || v }, STATUS_LABEL[v] || v);
}
export const statusChip = (st) => chip(st, { kind: 'status' });
export const qaChip = (qa) => chip(qa || 'pending', { kind: 'qa', title: `QA: ${qa || 'pending'}` });
export const sevChip = (sev) => chip(sev || 'info', { kind: 'sev' });
export const taskChip = (st) => chip(st, { kind: 'task' });
export function tag(text, cls = '') { return h('span', { class: `tag ${cls}` }, text); }
export function mono(text, cls = '') { return h('code', { class: `mono ${cls}` }, text); }

export function pageHeader(title, subtitle, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-title' }, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

export function card(title, body, { cls = '', actions = null, sub = null } = {}) {
  return h('section', { class: `card ${cls}` },
    title ? h('header', { class: 'card-head' }, h('div', null, h('h2', null, title), sub ? h('p', { class: 'muted small' }, sub) : null), actions) : null,
    h('div', { class: 'card-body' }, body));
}

export function empty(iconName, title, text, extra = null) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, { size: 28 })),
    h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null, extra);
}

export function errorBox(err) {
  return h('div', { class: 'callout callout-error', role: 'alert' }, icon('alert'), h('div', null, h('strong', null, 'Could not load data'), h('p', null, err?.message || String(err))));
}

export function spinner(label = 'Loading…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'pixel-spinner', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), h('span', null, label));
}

export function kv(rows) {
  return h('dl', { class: 'kv' }, rows.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v === undefined || v === null || v === '' ? h('span', { class: 'muted' }, '—') : v)]));
}

export function button(label, { iconName, onClick, cls = '', title, pressed, disabled, attrs = {} } = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`, title: title || (label ? undefined : title), 'aria-label': label ? undefined : title, 'aria-pressed': pressed === undefined ? undefined : String(!!pressed), disabled: !!disabled, onclick: onClick, ...attrs },
    iconName ? icon(iconName, { size: 16 }) : null, label ? h('span', null, label) : null);
}

export function segmented(options, value, onChange, { label = 'Filter' } = {}) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const render = (cur) => {
    clear(wrap);
    for (const o of options) {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      wrap.appendChild(h('button', { type: 'button', class: `seg ${opt.value === cur ? 'on' : ''}`, 'aria-pressed': String(opt.value === cur), onclick: () => { render(opt.value); onChange(opt.value); } },
        opt.label, opt.count !== undefined ? h('span', { class: 'seg-count' }, opt.count) : null));
    }
  };
  render(value);
  return wrap;
}

export function toggle(label, checked, onChange) {
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  return h('label', { class: 'switch', for: id },
    h('input', { type: 'checkbox', id, checked: !!checked, onchange: (e) => onChange(e.target.checked) }),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
    h('span', null, label));
}

// ------------------------------------------------------------------ JSON
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
export function jsonBlock(value, { maxHeight } = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const pre = h('pre', { class: 'json', style: maxHeight ? { maxHeight: `${maxHeight}px` } : null });
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    if (m.index > last) pre.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1]) {
      pre.appendChild(h('span', { class: m[2] ? 'j-key' : 'j-str' }, m[1]));
      if (m[2]) pre.appendChild(document.createTextNode(m[2]));
    } else if (m[3]) pre.appendChild(h('span', { class: 'j-lit' }, m[3]));
    else pre.appendChild(h('span', { class: 'j-num' }, m[4]));
    last = m.index + m[0].length;
  }
  if (last < text.length) pre.appendChild(document.createTextNode(text.slice(last)));
  return pre;
}

// ------------------------------------------------------------------ identicon (pixel avatar for agents)
export function identicon(name, size = 40) {
  const x = hash(name);
  const hue = x % 360;
  const fg = `hsl(${hue} 62% 58%)`, fg2 = `hsl(${(hue + 30) % 360} 55% 42%)`;
  const svg = s('svg', { class: 'identicon', width: size, height: size, viewBox: '0 0 5 5', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' });
  svg.appendChild(s('rect', { width: 5, height: 5, fill: `hsl(${hue} 30% 16%)` }));
  const y2 = hash(`${name}#alt`);
  for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 3; xx++) {
    const bit = yy * 3 + xx;
    if (!((x >>> (bit + 9)) & 1) && bit !== 7) continue; // centre pixel always on
    const fill = (y2 >>> bit) & 1 ? fg : fg2;
    svg.appendChild(s('rect', { x: xx, y: yy, width: 1, height: 1, fill }));
    if (xx < 2) svg.appendChild(s('rect', { x: 4 - xx, y: yy, width: 1, height: 1, fill }));
  }
  return svg;
}

// ------------------------------------------------------------------ thumbnails
export const TYPE_ICON = { texture: 'textures', model: 'cube', animation: 'animation', sfx: 'sfx', music: 'music', voice: 'voice', particle: 'particles', code: 'code', configuration: 'settings', guide: 'guides', reference: 'references', tool: 'tools', timeline: 'clock' };

export function primaryImage(asset) {
  if (asset.type === 'texture') {
    const f = (asset.files || []).find((x) => ext(x.path) === 'png');
    if (f) return f.path;
  }
  return asset.preview || null;
}

export function thumb(asset, { size = 'md', usePreview = false } = {}) {
  const p = usePreview ? (asset.preview || primaryImage(asset)) : primaryImage(asset);
  const el = h('div', { class: `thumb thumb-${size}` });
  if (p) {
    const img = h('img', { src: fileUrl(p), alt: '', loading: 'lazy', class: 'pixelated', draggable: 'false' });
    img.addEventListener('error', () => { img.remove(); el.appendChild(icon(TYPE_ICON[asset.type] || 'file', { size: 22 })); }, { once: true });
    el.appendChild(img);
  } else el.appendChild(icon(TYPE_ICON[asset.type] || 'file', { size: 22 }));
  return el;
}

// ------------------------------------------------------------------ activity timeline
export function activityTimeline(entries, { compact = false, empty: emptyText = 'No activity yet.' } = {}) {
  if (!entries?.length) return h('p', { class: 'muted pad' }, emptyText);
  return h('ol', { class: `timeline ${compact ? 'compact' : ''}` }, entries.map((e) => h('li', { class: `tl-item sev-${e.severity || 'info'}` },
    h('span', { class: 'tl-dot', 'aria-hidden': 'true' }),
    h('div', { class: 'tl-body' },
      h('div', { class: 'tl-meta' },
        h('span', { class: 'tl-agent' }, e.agent || 'studio'),
        h('span', { class: 'tl-event mono' }, e.event || ''),
        e.asset ? h('a', { class: 'tl-asset', href: assetHref({ id: e.asset }) }, e.asset) : null,
        h('time', { class: 'tl-time', datetime: e.ts, title: fmtDate(e.ts) }, compact ? fmtRelative(e.ts) : `${fmtTimeShort(e.ts)} · ${fmtRelative(e.ts)}`)),
      h('p', { class: 'tl-msg' }, e.message || '')))));
}

// ------------------------------------------------------------------ routing helpers for assets
export const TYPE_ROUTE = { texture: 'textures', model: '3d', animation: 'animations', sfx: 'sfx', music: 'music', voice: 'voice', particle: 'particles', code: 'code', guide: 'guides', reference: 'references' };
export function assetHref(a) {
  if (a.type && TYPE_ROUTE[a.type]) return `#/${TYPE_ROUTE[a.type]}/${encodeURIComponent(a.id)}`;
  return `#/asset/${encodeURIComponent(a.id)}`;
}

// ------------------------------------------------------------------ drawer
let drawerState = null;
export function openDrawer(title, content, { wide = false, subtitle = null, onClose = null } = {}) {
  closeDrawer(true);
  const prevFocus = document.activeElement;
  const closeBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Close panel', onclick: () => closeDrawer() }, icon('close'));
  const panel = h('aside', { class: `drawer ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Details', tabindex: '-1' },
    h('header', { class: 'drawer-head' }, h('div', { class: 'drawer-title' }, typeof title === 'string' ? h('h2', null, title) : title, subtitle), closeBtn),
    h('div', { class: 'drawer-body' }, content));
  const backdrop = h('div', { class: 'drawer-backdrop', onclick: () => closeDrawer() });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), canvas[tabindex]')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.body.append(backdrop, panel);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => { panel.classList.add('open'); backdrop.classList.add('open'); closeBtn.focus({ preventScroll: true }); });
  drawerState = { panel, backdrop, onKey, prevFocus, onClose };
  return panel;
}
export function closeDrawer(immediate = false) {
  if (!drawerState) return;
  const { panel, backdrop, onKey, prevFocus, onClose } = drawerState;
  drawerState = null;
  document.removeEventListener('keydown', onKey, true);
  onClose?.();
  panel.dispatchEvent(new CustomEvent('drawer-close'));
  if (immediate) { panel.remove(); backdrop.remove(); } else {
    panel.classList.remove('open'); backdrop.classList.remove('open');
    setTimeout(() => { panel.remove(); backdrop.remove(); }, 220);
  }
  if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
}
export const drawerOpen = () => !!drawerState;

// ------------------------------------------------------------------ generic asset sections
export function filesTable(files) {
  if (!files?.length) return h('p', { class: 'muted' }, 'No files.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Path'), h('th', null, 'Role'), h('th', { class: 'num' }, 'Size'), h('th', null, 'SHA-256'))),
    h('tbody', null, files.map((f) => h('tr', null,
      h('td', null, /\.(png|json|md|ogg|wav|flac|mcmeta|bbmodel|txt|mp3)$/i.test(f.path) ? h('a', { href: fileUrl(f.path), target: '_blank', rel: 'noopener', class: 'mono path' }, f.path) : h('span', { class: 'mono path' }, f.path)),
      h('td', null, tag(f.role || 'primary')),
      h('td', { class: 'num mono' }, fmtBytes(f.bytes)),
      h('td', { class: 'mono muted', title: f.sha256 || '' }, (f.sha256 || '').slice(0, 10)))))));
}

export function qaHistory(hist) {
  if (!Array.isArray(hist) || !hist.length) return h('p', { class: 'muted' }, 'No QA records yet.');
  return h('ol', { class: 'qa-list' }, [...hist].reverse().map((r) => h('li', { class: 'qa-item' },
    h('div', { class: 'qa-head' }, chip(r.verdict, { kind: 'verdict' }), h('strong', null, `v${r.version}`), h('span', { class: 'muted' }, `by ${r.by}`), h('time', { class: 'muted small', title: fmtDate(r.at) }, fmtRelative(r.at))),
    r.summary ? h('p', null, r.summary) : null,
    r.checks?.length ? h('ul', { class: 'checks' }, r.checks.map((c) => h('li', null, chip(c.status, { kind: 'verdict' }), h('span', { class: 'check-name' }, c.name), c.detail ? h('span', { class: 'muted' }, c.detail) : null))) : null)));
}

export function versionsList(versions, current) {
  if (!Array.isArray(versions) || !versions.length) return h('p', { class: 'muted' }, 'No versions recorded.');
  return h('ol', { class: 'versions' }, [...versions].reverse().map((v) => h('li', { class: v.version === current ? 'current' : '' },
    h('span', { class: 'ver-badge' }, `v${v.version}`),
    h('div', null,
      h('div', null, h('strong', null, v.note || 'revision'), v.version === current ? tag('current', 'tag-accent') : null),
      h('div', { class: 'muted small' }, `${v.by || 'studio'} · ${fmtDate(v.at)}`),
      v.archived_dir ? h('div', { class: 'muted small mono' }, `archived: ${v.archived_dir}`) : null))));
}

export function sourceBlock(src) {
  if (!src || !Object.keys(src).length) return h('p', { class: 'muted' }, 'No source recorded.');
  const { provider, prompt, text, prepared_text: prepared, source_files: files, parameters, preset, ...rest } = src;
  return h('div', { class: 'stack-sm' },
    kv([
      ['Provider', provider ? tag(provider, 'tag-accent') : null],
      preset ? ['Preset', mono(preset)] : null,
      prompt ? ['Prompt', h('q', null, prompt)] : null,
      text ? ['Text', text] : null,
      prepared ? ['Prepared text', prepared] : null,
      files?.length ? ['Source files', h('div', { class: 'stack-xs' }, files.map((f) => h('a', { class: 'mono path', href: fileUrl(f), target: '_blank', rel: 'noopener' }, f)))] : null,
    ]),
    parameters && Object.keys(parameters).length ? h('details', null, h('summary', null, 'Parameters'), jsonBlock(parameters, { maxHeight: 240 })) : null,
    Object.keys(rest).length ? h('details', null, h('summary', null, 'More source fields'), jsonBlock(rest, { maxHeight: 240 })) : null);
}

export function section(title, body, extra = null) {
  return h('section', { class: 'dsection' }, h('h3', null, title, extra), body);
}

export function assetHeader(a) {
  return h('div', { class: 'asset-head' },
    h('div', { class: 'chips' }, tag(a.type, 'tag-type'), statusChip(a.status), qaChip(a.qa_status), h('span', { class: 'ver-badge' }, `v${a.version}`), ...(a.tags || []).map((t) => tag(t))),
    a.description ? h('p', null, a.description) : null,
    h('p', { class: 'muted small' }, mono(a.id), ` · created by ${a.created_by || 'studio'} ${fmtRelative(a.created_at)} · modified ${fmtRelative(a.modified_at)}`));
}

/** Detail sections shared by every asset type. */
export function genericAssetSections(a, { skip = [] } = {}) {
  const meta = { ...(a.metadata || {}) };
  if (Array.isArray(meta.waveform)) meta.waveform = `[${meta.waveform.length} points]`;
  return [
    skip.includes('ids') ? null : section('Minecraft ids', a.minecraft_ids?.length ? h('div', { class: 'chips' }, a.minecraft_ids.map((x) => mono(x, 'pill'))) : h('p', { class: 'muted' }, 'None.')),
    skip.includes('files') ? null : section('Files', filesTable(a.files)),
    a.dependencies?.length ? section('Dependencies', h('div', { class: 'chips' }, a.dependencies.map((d) => h('a', { class: 'pill mono', href: `#/asset/${encodeURIComponent(d)}` }, d)))) : null,
    skip.includes('source') ? null : section('Source', sourceBlock(a.source)),
    section('QA history', qaHistory(a.qa_history)),
    section('Version history', versionsList(a.versions, a.version)),
    skip.includes('metadata') || !Object.keys(meta).length ? null : section('Metadata', jsonBlock(meta, { maxHeight: 320 })),
  ];
}

// ------------------------------------------------------------------ charts (hand-made SVG)
export const STATUS_COLOR = { idea: 'var(--c-idea)', draft: 'var(--c-draft)', review: 'var(--c-review)', 'changes-requested': 'var(--c-changes)', approved: 'var(--c-approved)', integrated: 'var(--c-integrated)', deprecated: 'var(--c-deprecated)' };

export function donut(entries, { size = 148, thickness = 20, center } = {}) {
  const total = entries.reduce((a, e) => a + e.value, 0);
  const r = (size - thickness) / 2, c = size / 2, circ = 2 * Math.PI * r;
  const svg = s('svg', { class: 'donut', width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': entries.map((e) => `${e.label}: ${e.value}`).join(', ') });
  svg.appendChild(s('circle', { cx: c, cy: c, r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': thickness }));
  let off = 0;
  const gap = entries.filter((e) => e.value).length > 1 ? 2 : 0;
  for (const e of entries) {
    if (!e.value) continue;
    const len = (e.value / total) * circ;
    svg.appendChild(s('circle', { cx: c, cy: c, r, fill: 'none', stroke: e.color, 'stroke-width': thickness, 'stroke-dasharray': `${Math.max(0, len - gap)} ${circ}`, 'stroke-dashoffset': -off, transform: `rotate(-90 ${c} ${c})` }, s('title', null, `${e.label}: ${e.value}`)));
    off += len;
  }
  svg.appendChild(s('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'donut-num' }, String(center ?? total)));
  svg.appendChild(s('text', { x: c, y: c + 16, 'text-anchor': 'middle', class: 'donut-label' }, 'assets'));
  return svg;
}

export function legend(entries) {
  return h('ul', { class: 'legend' }, entries.map((e) => h('li', { class: e.value ? '' : 'zero' }, h('span', { class: 'swatch', style: { background: e.color } }), h('span', null, e.label), h('span', { class: 'legend-num' }, e.value))));
}

export function hbars(entries, { max } = {}) {
  const m = max ?? Math.max(1, ...entries.map((e) => e.value));
  return h('ul', { class: 'hbars' }, entries.map((e) => h('li', null,
    h('span', { class: 'hb-label' }, e.label),
    h('span', { class: 'hb-track' }, h('span', { class: 'hb-fill', style: { width: `${(e.value / m) * 100}%`, background: e.color || 'var(--accent)' } })),
    h('span', { class: 'hb-num' }, e.value))));
}
