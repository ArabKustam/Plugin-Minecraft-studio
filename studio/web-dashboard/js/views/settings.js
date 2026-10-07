import { h, icon, fmtRelative, fmtDate, prefs } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, card, tag, kv, chip, jsonBlock, toggle, segmented } from '../ui.js';

async function render(root, app) {
  const [settings, usage] = await Promise.all([api('settings'), api('usage')]);
  const cfg = settings.config || {};
  const providers = settings.providers || {};
  const sel = cfg.providers || {};
  const secrets = settings.secrets || {};
  const entries = usage.entries || [];
  const byProvider = entries.reduce((acc, e) => { const k = e.provider || 'unknown'; acc[k] ||= { n: 0, usd: 0, units: {} }; acc[k].n++; acc[k].usd += e.estimated_usd || 0; acc[k].units[e.unit || 'units'] = (acc[k].units[e.unit || 'units'] || 0) + (e.units || 0); return acc; }, {});
  const theme = document.documentElement.getAttribute('data-theme');

  root.replaceChildren(
    pageHeader('Settings', 'Studio configuration (read-only). Change settings through Claude Code — the dashboard never writes to the project.'),
    h('div', { class: 'grid-2' },
      card('Provider selection', h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Kind'), h('th', null, 'Selected'), h('th', null, 'Status'), h('th', null, 'Alternatives'))),
        h('tbody', null, Object.entries(sel).map(([kind, id]) => {
          const list = providers[kind] || [];
          const p = list.find((x) => x.id === id);
          const auto = id === 'auto';
          return h('tr', null,
            h('td', { class: 'strong' }, kind),
            h('td', null, h('code', { class: 'mono pill' }, id), p?.paid ? h('span', { class: 'badge-paid' }, '$') : null),
            h('td', null, auto ? tag('best available') : p ? chip(p.availability?.ok === false ? 'unavailable' : 'available', { kind: 'avail', title: p.availability?.reason || '' }) : chip('unknown', { kind: 'avail' })),
            h('td', { class: 'small' }, list.filter((x) => x.id !== id).map((x) => h('span', { class: `alt ${x.availability?.ok === false ? 'muted' : ''}`, title: x.availability?.reason || x.description }, x.id, x.paid ? ' $' : '')).flatMap((x, i) => (i ? [', ', x] : [x]))));
        })))), { sub: 'config.json → providers' }),
      card('Secrets', h('div', { class: 'stack-sm' },
        h('ul', { class: 'secrets' }, Object.entries(secrets).map(([k, v]) => h('li', null, icon('key', { size: 15 }), h('span', { class: 'mono' }, k), h('span', { class: 'push' }, chip(v === 'configured' ? 'configured' : 'missing', { kind: 'secret' }))))),
        h('p', { class: 'muted small' }, 'Only the presence of each secret is shown — values never leave the server. Configure them as environment variables or in the project .env file.')), { sub: 'Environment / .env' })),
    card('Usage & cost', h('div', { class: 'stack' },
      h('div', { class: 'stats stats-sm' },
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Estimated spend'), h('div', { class: 'stat-value' }, `$${Number(usage.total_usd || 0).toFixed(2)}`)),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Paid operations'), h('div', { class: 'stat-value' }, String(entries.length))),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Confirm above'), h('div', { class: 'stat-value' }, cfg.costs?.confirm_above_usd !== undefined ? `$${cfg.costs.confirm_above_usd}` : '—')),
        h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Max generations / asset'), h('div', { class: 'stat-value' }, String(cfg.costs?.max_generations_per_asset ?? '—')))),
      Object.keys(byProvider).length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Provider'), h('th', { class: 'num' }, 'Operations'), h('th', null, 'Units'), h('th', { class: 'num' }, 'Est. USD'))),
        h('tbody', null, Object.entries(byProvider).map(([k, v]) => h('tr', null, h('td', { class: 'mono' }, k), h('td', { class: 'num' }, String(v.n)), h('td', { class: 'small' }, Object.entries(v.units).map(([u, n]) => `${n} ${u}`).join(', ')), h('td', { class: 'num mono' }, `$${v.usd.toFixed(4)}`)))))) : h('p', { class: 'muted' }, 'No paid provider usage recorded — everything so far was generated locally.'),
      entries.length ? h('details', null, h('summary', null, `Usage log (${entries.length})`), h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Provider'), h('th', null, 'Operation'), h('th', null, 'Units'), h('th', null, 'Asset'), h('th', null, 'Agent'), h('th', { class: 'num' }, 'USD'))),
        h('tbody', null, [...entries].reverse().map((e) => h('tr', null, h('td', { class: 'small nowrap', title: fmtDate(e.ts) }, fmtRelative(e.ts)), h('td', { class: 'mono' }, e.provider), h('td', null, e.operation), h('td', { class: 'small' }, `${e.units ?? ''} ${e.unit || ''}`), h('td', { class: 'mono small' }, e.asset || '—'), h('td', null, e.agent || '—'), h('td', { class: 'num mono' }, e.estimated_usd === null || e.estimated_usd === undefined ? '—' : `$${Number(e.estimated_usd).toFixed(4)}`))))))) : null), { sub: 'logs/usage.jsonl' }),
    h('div', { class: 'grid-2' },
      card('Dashboard preferences', h('div', { class: 'stack' },
        h('div', { class: 'pref-row' }, h('span', null, 'Theme'), segmented([{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], theme, (v) => { prefs.set('theme', v); if (document.documentElement.getAttribute('data-theme') !== v) document.getElementById('theme-toggle').click(); }, { label: 'Theme' })),
        h('div', { class: 'pref-row' }, toggle('Show existing pack assets in asset views', app.showExisting, (v) => app.setShowExisting(v)))), { sub: 'Stored in this browser only' }),
      card('Audio & Minecraft', kv([
        ['Sample rate', cfg.audio?.sample_rate ? `${cfg.audio.sample_rate} Hz` : null],
        ['Loudness targets', cfg.audio ? h('span', { class: 'mono small' }, `sfx ${cfg.audio.target_lufs_sfx} · music ${cfg.audio.target_lufs_music} · voice ${cfg.audio.target_lufs_voice} LUFS`) : null],
        ['Test server', cfg.minecraft?.test_server_dir ? h('code', { class: 'mono small' }, cfg.minecraft.test_server_dir) : null],
        ['EULA accepted', cfg.minecraft ? (cfg.minecraft.accept_eula ? 'yes' : 'no') : null],
        ['Git auto-checkpoint', cfg.git ? (cfg.git.auto_checkpoint ? 'on' : 'off') : null],
        ['Telemetry', cfg.telemetry ? 'on' : 'off'],
      ]))),
    card('config.json', jsonBlock(cfg, { maxHeight: 520 }), { sub: '.minecraft-studio/config.json merged with defaults (never contains secrets)' }));
}

export default { title: 'Settings', icon: 'settings', async mount(root, { app }) { await render(root, app); return { update: () => render(root, app) }; } };
