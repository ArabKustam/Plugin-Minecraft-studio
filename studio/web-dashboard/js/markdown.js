// Small, safe Markdown renderer. It builds DOM nodes directly (text always via
// text nodes), so raw HTML in a document is shown literally, never executed.
// Supports: headings, paragraphs, emphasis, code spans & fenced code, links,
// images (project-relative only), block quotes, nested lists, tables, rules.
import { h } from './dom.js';
import { fileUrl } from './api.js';

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*(?!\s)([\s\S]+?)\*|(?<![A-Za-z0-9])_(?!\s)([\s\S]+?)_(?![A-Za-z0-9])|!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>/;

function resolvePath(base, rel) {
  const parts = (base ? base.split('/').slice(0, -1) : []);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop(); else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function linkNode(textNodes, url, ctx) {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, textNodes);
  if (u.startsWith('#')) return h('a', { href: u }, textNodes);
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return h('span', { class: 'md-badlink', title: 'Link removed (unsafe scheme)' }, textNodes);
  const p = resolvePath(ctx.base, u.split('#')[0]);
  if (/\.(md|png|json|txt|ogg|wav|flac|mcmeta)$/i.test(p)) return h('a', { href: fileUrl(p), target: '_blank', rel: 'noopener' }, textNodes);
  return h('span', { class: 'md-reflink', title: p }, textNodes);
}

export function inline(text, ctx = {}) {
  const out = [];
  let rest = text;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m) { out.push(document.createTextNode(rest)); break; }
    if (m.index > 0) out.push(document.createTextNode(rest.slice(0, m.index)));
    if (m[1]) out.push(h('code', null, m[2].trim()));
    else if (m[3] || m[4]) out.push(h('strong', null, inline(m[3] || m[4], ctx)));
    else if (m[5]) out.push(h('del', null, inline(m[5], ctx)));
    else if (m[6] || m[7]) out.push(h('em', null, inline(m[6] || m[7], ctx)));
    else if (m[9] !== undefined) {
      const u = m[9];
      if (/^(https?:|data:)/i.test(u) || /^[a-z][a-z0-9+.-]*:/i.test(u)) out.push(h('span', { class: 'md-imgalt', title: u }, `[image: ${m[8] || u}]`)); // offline: no remote images
      else out.push(h('img', { src: fileUrl(resolvePath(ctx.base, u)), alt: m[8] || '', class: 'md-img', loading: 'lazy' }));
    } else if (m[10]) out.push(linkNode(inline(m[10], ctx), m[11], ctx));
    else if (m[12]) out.push(linkNode([document.createTextNode(m[12])], m[12], ctx));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const splitRow = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};
const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line || '');
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function renderMarkdown(src, { base = '' } = {}) {
  const ctx = { base };
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const root = h('div', { class: 'md' });
  let i = 0;
  const usedIds = new Set();
  const slug = (t) => { let b = t.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'section'; let k = b, n = 1; while (usedIds.has(k)) k = `${b}-${n++}`; usedIds.add(k); return k; };

  const parseList = (startIndent) => {
    const first = lines[i].match(LIST_RE);
    const ordered = /\d/.test(first[2]);
    const list = h(ordered ? 'ol' : 'ul', ordered && parseInt(first[2], 10) !== 1 ? { start: parseInt(first[2], 10) } : null);
    while (i < lines.length) {
      const m = lines[i].match(LIST_RE);
      if (!m) {
        // continuation line of previous item (indented text)
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastElementChild) { list.lastElementChild.append(' ', ...inline(lines[i].trim(), ctx)); i++; continue; }
        break;
      }
      const indent = m[1].length;
      if (indent < startIndent) break;
      if (indent > startIndent) { list.lastElementChild?.appendChild(parseList(indent)); continue; }
      let body = m[3];
      const li = h('li');
      const task = body.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) { li.className = 'task'; li.appendChild(h('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ', 'aria-label': task[1] !== ' ' ? 'done' : 'open' })); body = task[2]; }
      li.append(...inline(body, ctx));
      list.appendChild(li);
      i++;
    }
    return list;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      const close = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) buf.push(lines[i++]);
      i++;
      root.appendChild(h('pre', { class: 'md-code', 'data-lang': fence[2] || null }, h('code', null, buf.join('\n'))));
      continue;
    }
    const hd = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (hd) { const lvl = hd[1].length; root.appendChild(h(`h${lvl}`, { id: slug(hd[2]) }, inline(hd[2], ctx))); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { root.appendChild(h('hr')); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const inner = renderMarkdown(buf.join('\n'), { base });
      root.appendChild(h('blockquote', null, [...inner.childNodes]));
      continue;
    }
    if (line.includes('|') && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table md-table' },
        h('thead', null, h('tr', null, head.map((c, k) => h('th', { style: aligns[k] ? { textAlign: aligns[k] } : null }, inline(c, ctx))))),
        h('tbody', null, rows.map((r) => h('tr', null, head.map((_, k) => h('td', { style: aligns[k] ? { textAlign: aligns[k] } : null }, inline(r[k] || '', ctx)))))))));
      continue;
    }
    if (LIST_RE.test(line)) { root.appendChild(parseList(line.match(LIST_RE)[1].length)); continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^\s*(```|~~~)|^\s*>/.test(lines[i]) && !LIST_RE.test(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1]))) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]); // safety: always make progress
    const p = h('p');
    buf.forEach((l, k) => {
      if (k) { if (/\s{2,}$/.test(buf[k - 1]) || buf[k - 1].endsWith('\\')) p.appendChild(h('br')); else p.appendChild(document.createTextNode(' ')); }
      p.append(...inline(l.replace(/\\$/, '').trim(), ctx));
    });
    root.appendChild(p);
  }
  return root;
}
