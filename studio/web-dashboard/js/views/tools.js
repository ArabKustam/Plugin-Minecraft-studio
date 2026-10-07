import { h, icon, fmtRelative, fmtDate } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, tag, kv, empty, chip, jsonBlock } from '../ui.js';

export function providerCard(p, { selected = false } = {}) {
  const av = p.availability || {};
  const ok = av.ok !== false;
  return h('div', { class: `provider ${ok ? '' : 'unavailable'} ${selected ? 'selected' : ''}` },
    h('div', { class: 'provider-head' },
      h('strong', { class: 'mono' }, p.id),
      p.paid ? h('span', { class: 'badge-paid', title: 'Paid provider — generations cost credits and require confirmation' }, '$ paid') : h('span', { class: 'badge-free' }, 'free'),
      selected ? tag('selected', 'tag-accent') : null,
      h('span', { class: 'push' }, chip(ok ? 'available' : 'unavailable', { kind: 'avail' }))),
    h('p', { class: 'small' }, p.description || ''),
    !ok && av.reason ? h('p', { class: 'small warn-text' }, icon('alert', { size: 13 }), ' ', av.reason) : null,
    ok && av.engine ? h('p', { class: 'small muted' }, `engine: ${av.engine}`) : null,
    p.capabilities?.length ? h('div', { class: 'chips' }, p.capabilities.map((c) => tag(c))) : null,
    p.formats?.length ? h('div', { class: 'muted small' }, 'formats: ', p.formats.join(', ')) : null);
}

async function render(root) {
  const [{ project_tools: tools, providers }, settings] = await Promise.all([api('tools'), api('settings').catch(() => null)]);
  const selected = settings?.config?.providers || {};
  root.replaceChildren(
    pageHeader('Tools', 'Project tools created by the Tool Factory, and the generation/processing providers available to the studio.'),
    card('Project tools', tools?.length ? h('div', { class: 'tool-grid' }, tools.map((t) => h('div', { class: 'tool' },
      h('div', { class: 'tool-head' }, icon('tools', { size: 16 }), h('strong', { class: 'mono' }, t.name), t.version ? h('span', { class: 'ver-badge' }, `v${t.version}`) : null),
      h('p', null, t.description || ''),
      kv([
        ['Why', t.justification || null],
        ['Entry', t.entry ? h('code', { class: 'mono' }, t.entry) : null],
        ['Test', t.test ? h('code', { class: 'mono' }, t.test) : null],
        ['Output', t.output_description || null],
        ['Created', t.created_at ? h('span', { title: fmtDate(t.created_at) }, fmtRelative(t.created_at)) : null],
      ]),
      t.input_schema && Object.keys(t.input_schema.properties || {}).length ? h('details', null, h('summary', null, 'Input schema'), jsonBlock(t.input_schema, { maxHeight: 220 })) : null))) : empty('tools', 'No project tools yet', 'The Tool Factory scaffolds reusable tools for operations the studio repeats often.'),
    { sub: `${tools?.length || 0} tool${tools?.length === 1 ? '' : 's'} in .minecraft-studio/tools` }),
    ...Object.entries(providers || {}).map(([kind, list]) => card(`${kind[0].toUpperCase()}${kind.slice(1)} providers`, h('div', { class: 'provider-grid' }, list.map((p) => providerCard(p, { selected: selected[kind] === p.id }))), { sub: `selected: ${selected[kind] || 'auto'}` })));
}

export default { title: 'Tools', icon: 'tools', async mount(root) { await render(root); return { update: () => render(root) }; } };
