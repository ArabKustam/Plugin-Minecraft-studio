// Guides (guide assets) and References (research notes, ADRs, reference assets, project memory).
import { h, icon, fmtRelative, fmtDate } from '../dom.js';
import { api, fetchFileText, fileUrl } from '../api.js';
import { pageHeader, statusChip, empty, tag, card, spinner, errorBox, segmented } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { splitLayout, replace } from './common.js';

async function docBody(file) {
  if (!file) return h('p', { class: 'muted' }, 'This entry has no file.');
  const text = await fetchFileText(file);
  if (/\.md$/i.test(file)) return renderMarkdown(text, { base: file });
  if (/\.json$/i.test(file)) { try { return h('pre', { class: 'json' }, JSON.stringify(JSON.parse(text), null, 2)); } catch { /* raw */ } }
  return h('pre', { class: 'md-code' }, h('code', null, text));
}

function docsView({ title, iconName, subtitle, load, route, itemMeta, emptyTitle, emptyText, extra }) {
  return {
    title, icon: iconName,
    async mount(root, { param, app }) {
      let items = [];
      let selected = param;
      const listEl = h('div', { class: 'list' });
      const docEl = h('article', { class: 'doc card' });
      const drawList = () => replace(listEl, items.map((it) => h('button', { type: 'button', class: `list-item ${it.key === selected ? 'active' : ''}`, 'aria-pressed': String(it.key === selected), onclick: () => { location.hash = `#/${route}/${encodeURIComponent(it.key)}`; } },
        h('span', { class: 'li-icon' }, icon(iconName, { size: 16 })),
        h('span', { class: 'li-main' }, h('span', { class: 'li-name' }, it.title), h('span', { class: 'li-id mono' }, it.file || it.key)), itemMeta(it))));
      const show = async (key) => {
        const it = items.find((x) => x.key === key);
        if (!it) { replace(docEl, empty(iconName, 'Select a document', 'Pick an entry on the left to read it.')); return; }
        replace(docEl, spinner());
        try {
          const body = await docBody(it.file);
          if (selected !== key) return;
          replace(docEl, h('header', { class: 'doc-head' }, h('div', { class: 'chips' }, itemMeta(it)), it.file ? h('a', { class: 'mono path small', href: fileUrl(it.file), target: '_blank', rel: 'noopener' }, icon('external', { size: 13 }), ' ', it.file) : null), body);
        } catch (e) { replace(docEl, errorBox(e)); }
      };
      const render = async () => {
        items = await load(app);
        if (!selected && items.length) selected = items[0].key;
        const extraEl = extra ? await extra() : null;
        root.replaceChildren(pageHeader(title, subtitle(items)), items.length ? splitLayout(listEl, docEl, { cls: 'split-docs' }) : empty(iconName, emptyTitle, emptyText), extraEl);
        drawList();
        if (items.length) await show(selected);
      };
      await render();
      return { update: render, setParam: async (p) => { if (!p) return; selected = p; drawList(); await show(p); } };
    },
  };
}

export const guidesView = docsView({
  title: 'Guides', iconName: 'guides', route: 'guides',
  subtitle: (items) => `${items.length} guide${items.length === 1 ? '' : 's'} for players, server owners and the team`,
  load: async () => (await api('guides')).map((g) => ({ ...g, key: g.id, title: g.name })),
  itemMeta: (g) => h('span', { class: 'li-chips' }, statusChip(g.status), g.modified_at ? h('span', { class: 'muted small', title: fmtDate(g.modified_at) }, fmtRelative(g.modified_at)) : null),
  emptyTitle: 'No guides yet', emptyText: 'Guides written by the guide agent are registered as "guide" assets and rendered here.',
});

const KIND_LABEL = { research: 'research', adr: 'ADR', asset: 'reference' };
export const referencesView = docsView({
  title: 'References', iconName: 'references', route: 'references',
  subtitle: (items) => `${items.length} research notes, decision records and reference assets`,
  load: async () => (await api('references')).map((r) => ({ ...r, key: r.id || r.file, title: r.title })),
  itemMeta: (r) => h('span', { class: 'li-chips' }, tag(KIND_LABEL[r.kind] || r.kind, r.kind === 'adr' ? 'tag-accent' : '')),
  emptyTitle: 'No references yet', emptyText: 'Markdown files in docs/research and docs/adr, and "reference" assets, are listed here.',
  extra: async () => {
    const mem = await api('memory').catch(() => ({ entries: [] }));
    const entries = (mem.entries || []).filter((e) => !e.superseded_by);
    if (!entries.length) return null;
    const cats = [...new Set(entries.map((e) => e.category))];
    const listBox = h('div', { class: 'memory-list' });
    const draw = (cat) => listBox.replaceChildren(...entries.filter((e) => !cat || e.category === cat).reverse().map((e) => h('div', { class: 'memory-item' },
      h('div', { class: 'memory-head' }, tag(e.category, 'tag-accent'), h('strong', null, e.title), h('span', { class: 'muted small push', title: fmtDate(e.at) }, `${e.by} · ${fmtRelative(e.at)}`)),
      h('p', null, e.content))));
    draw('');
    return card('Project memory', h('div', { class: 'stack' }, cats.length > 1 ? segmented([{ value: '', label: 'All', count: entries.length }, ...cats.map((c) => ({ value: c, label: c, count: entries.filter((e) => e.category === c).length }))], '', draw, { label: 'Memory category' }) : null, listBox),
      { sub: 'Decisions, conventions and limitations the studio remembers across sessions' });
  },
});
