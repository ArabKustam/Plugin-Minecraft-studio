import { h, icon, fmtDuration, ext, fmtRelative } from '../dom.js';
import { api } from '../api.js';
import { pageHeader, statusChip, qaChip, empty, kv, tag, mono, openDrawer, assetHeader, genericAssetSections, card, section } from '../ui.js';
import { audioStrip, player } from '../audio.js';
import { listAssets, assetToolbar, applyFilter } from './common.js';

function formats(a) {
  const byExt = new Map();
  for (const f of a.files || []) { const e = ext(f.path); if (/^(wav|flac|ogg|mp3)$/.test(e)) byExt.set(e, f.role); }
  return [...byExt.entries()].map(([e, role]) => tag(`${e.toUpperCase()}${role && role !== 'primary' ? ` · ${role}` : ''}`, e === 'ogg' ? 'tag-accent' : ''));
}

function lufsTag(v) {
  if (!Number.isFinite(v)) return h('span', { class: 'muted' }, '—');
  return h('span', { class: 'mono' }, `${v.toFixed(1)} LUFS`);
}

/** Prepared text with pronunciation replacements highlighted. */
function preparedText(text, changes) {
  if (!text) return null;
  const as = (changes || []).map((c) => c.as || c.say).filter(Boolean);
  if (!as.length) return h('span', null, text);
  const re = new RegExp(`(${as.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return h('span', null, text.split(re).map((part, i) => (i % 2 ? h('mark', { class: 'pron', title: 'pronunciation dictionary' }, part) : part)));
}

function soundCard(a, kind, strips) {
  const m = a.metadata || {};
  const strip = audioStrip(a, { peaks: Array.isArray(m.waveform) ? m.waveform : null, duration: m.duration, loop: !!m.loop });
  strips.push(strip);
  const src = a.source || {};
  const details = () => openDrawer(h('div', null, h('p', { class: 'eyebrow' }, kind), h('h2', null, a.name)), h('div', { class: 'stack' }, assetHeader(a), genericAssetSections(a)), { wide: true });
  return h('article', { class: 'card sound-card', id: `asset-${a.id}` },
    h('header', { class: 'sound-head' },
      h('div', { class: 'sound-title' }, h('h2', null, a.name), h('span', { class: 'mono muted small' }, a.id)),
      h('div', { class: 'chips' }, m.loop ? tag('loop', 'tag-accent') : null, statusChip(a.status), qaChip(a.qa_status), h('span', { class: 'ver-badge' }, `v${a.version}`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: details }, 'Details'))),
    strip.el,
    kind === 'voice' ? h('div', { class: 'voice-text' },
      h('div', null, h('span', { class: 'label' }, 'Original'), h('p', null, src.text || m.text || '—')),
      src.prepared_text && src.prepared_text !== src.text ? h('div', null, h('span', { class: 'label' }, 'Sent to provider'), h('p', null, preparedText(src.prepared_text, src.pronunciation_changes))) : null) : null,
    h('div', { class: 'sound-meta' },
      kv([
        ['Duration', Number.isFinite(m.duration) ? h('span', { class: 'mono' }, fmtDuration(m.duration)) : null],
        ['Format', h('div', { class: 'chips' }, formats(a))],
        ['Loudness', lufsTag(m.lufs)],
        ['Loop', m.loop ? 'seamless loop' : 'one-shot'],
      ]),
      kv([
        [kind === 'voice' ? 'Game ids' : 'Game events', a.minecraft_ids?.length ? h('div', { class: 'chips' }, a.minecraft_ids.map((x) => mono(x, 'pill'))) : null],
        ['Provider', src.provider ? tag(src.provider) : null],
        kind === 'voice' ? ['Profile', src.profile || m.profile ? h('button', { type: 'button', class: 'linklike mono', onclick: () => document.getElementById('voice-profiles')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, src.profile || m.profile) : null] : ['Preset', src.preset ? mono(src.preset) : null],
        src.prompt ? ['Prompt', h('q', null, src.prompt)] : ['Modified', fmtRelative(a.modified_at)],
      ])));
}

function soundView({ type, title, iconName, subtitle, emptyText }) {
  return {
    title, icon: iconName,
    async mount(root, { param, app }) {
      const state = { q: '', status: '' };
      let strips = [];
      let assets = [];
      const listBox = h('div', { class: 'sound-list' });
      const extraBox = h('div');
      const drawList = () => {
        for (const s2 of strips) s2.destroy();
        strips = [];
        const rows = applyFilter(assets, state);
        listBox.replaceChildren(...(rows.length ? rows.map((a) => soundCard(a, type, strips)) : [h('p', { class: 'muted pad' }, 'Nothing matches the filter.')]));
      };
      const render = async () => {
        const summary = await listAssets(type, app);
        const full = await Promise.all(summary.map((a) => api('asset', { id: a.id }).catch(() => a)));
        const sig = JSON.stringify(full.map((a) => [a.id, a.modified_at]));
        if (sig === state.sig && (root.contains(listBox) || !assets.length)) { // nothing changed: keep players alive
          if (type === 'voice') await renderVoiceExtras(extraBox);
          return;
        }
        state.sig = sig;
        assets = full;
        root.replaceChildren(pageHeader(title, subtitle), assets.length ? assetToolbar(app, assets, state, drawList) : null, assets.length ? listBox : empty(iconName, `No ${title.toLowerCase()} yet`, emptyText), extraBox);
        if (assets.length) drawList();
        if (type === 'voice') await renderVoiceExtras(extraBox);
      };
      const focus = (id) => { const el = document.getElementById(`asset-${id}`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } };
      await render();
      if (param) requestAnimationFrame(() => focus(param));
      return {
        update: render,
        setParam: (p) => p && focus(p),
        destroy: () => { for (const s2 of strips) s2.destroy(); player.stop(); },
      };
    },
  };
}

async function renderVoiceExtras(box) {
  const v = await api('voices').catch(() => ({ profiles: [], pronunciation: { entries: [] } }));
  const profiles = v.profiles || [];
  const entries = v.pronunciation?.entries || [];
  box.replaceChildren(h('div', { class: 'grid-2', id: 'voice-profiles' },
    card('Voice profiles', profiles.length ? h('div', { class: 'stack' }, profiles.map((p) => h('div', { class: 'profile' },
      h('div', { class: 'profile-head' }, h('strong', null, p.name || p.id), h('span', { class: 'mono muted small' }, p.id), p.language ? tag(p.language, 'tag-accent') : null),
      kv([
        ['Character', [...(p.character || []), ...(p.traits || [])].length ? h('div', { class: 'chips' }, [...(p.character || []), ...(p.traits || [])].map((c) => tag(c))) : null],
        ['Pace / pitch', `${p.pace || 'normal'}${p.pitch_semitones ? ` · ${p.pitch_semitones > 0 ? '+' : ''}${p.pitch_semitones} st` : ''}`],
        ['Loudness', Number.isFinite(p.loudness_lufs) ? `${p.loudness_lufs} LUFS` : null],
        ['Processing', p.processing?.length ? h('div', { class: 'chips' }, p.processing.map((s2) => mono(s2.type || JSON.stringify(s2), 'pill'))) : null],
        ['Providers', Object.keys(p.providers || {}).length ? h('div', { class: 'chips' }, Object.keys(p.providers).map((k) => tag(k))) : null],
        ['Direction', p.direction || null],
      ])))) : h('p', { class: 'muted' }, 'No voice profiles yet.'), { sub: 'Persistent voice personas used for every line' }),
    card('Pronunciation dictionary', entries.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Term'), h('th', null, 'Say'), h('th', null, 'Stress'), h('th', null, 'Lang'), h('th', null, 'Note'))),
      h('tbody', null, entries.map((e) => h('tr', null, h('td', { class: 'mono strong' }, e.term), h('td', null, e.say || '—'), h('td', { class: 'mono' }, e.stress || '—'), h('td', null, e.language || '—'), h('td', { class: 'muted' }, e.note || '')))))) : h('p', { class: 'muted' }, 'No pronunciation rules yet.'), { sub: `${entries.length} rule${entries.length === 1 ? '' : 's'} applied to every voice line` })));
}

export const sfxView = soundView({ type: 'sfx', title: 'SFX', iconName: 'sfx', subtitle: 'Sound effects — layered recipes rendered locally or generated, audited for Minecraft.', emptyText: 'Render SFX with audio_sfx_render (recipes or presets) and they appear here with waveform, loudness and game events.' });
export const voiceView = soundView({ type: 'voice', title: 'Voice', iconName: 'voice', subtitle: 'Voice lines from persistent profiles with a project pronunciation dictionary.', emptyText: 'Synthesize lines with audio_voice_line; the original and prepared text are kept for every take.' });
