import { h, icon, fmtClock, fmtDuration } from '../dom.js';
import { api, fetchFileJson, decodeAudio, fileUrl } from '../api.js';
import { pageHeader, statusChip, empty, kv, tag, assetHeader, genericAssetSections, card, spinner, segmented, toggle, section } from '../ui.js';
import { drawWaveform } from '../audio.js';
import { player as sharedPlayer } from '../audio.js';
import { listAssets, splitLayout, listItem, replace } from './common.js';

/**
 * Plays a cue as the game would: sections in order, the loop section looping
 * seamlessly. In the loop section the stems are started on the same
 * AudioContext time so they stay sample-synchronous; mute/solo only move gains.
 */
class MusicEngine {
  constructor(meta, buffers) {
    this.meta = meta;
    this.sections = (meta.sections || []).filter((s) => buffers.sections[s.name]);
    this.buffers = buffers;
    this.loopName = meta.loop?.section || this.sections.find((s) => s.loop)?.name || null;
    this.total = this.sections.reduce((a, s) => a + s.duration_s, 0);
    this.loopOn = true;
    this.useStems = Object.keys(buffers.stems).length > 0;
    this.stemState = Object.fromEntries(Object.keys(buffers.stems).map((n) => [n, { mute: false, solo: false }]));
    this.sources = [];
    this.playing = false;
    this.startPos = 0;
    this.volume = 0.9;
  }
  ensureCtx() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
    this.stemGains = {}; this.analysers = {};
    for (const n of Object.keys(this.buffers.stems)) {
      const g = this.ctx.createGain(); const an = this.ctx.createAnalyser(); an.fftSize = 512;
      g.connect(an); an.connect(this.master);
      this.stemGains[n] = g; this.analysers[n] = an;
    }
    this.mixAnalyser = this.ctx.createAnalyser(); this.mixAnalyser.fftSize = 512;
    this.mixGain = this.ctx.createGain(); this.mixGain.connect(this.mixAnalyser); this.mixAnalyser.connect(this.master);
    this.applyGains(true);
  }
  stemGainValue(n) {
    const anySolo = Object.values(this.stemState).some((s) => s.solo);
    const st = this.stemState[n];
    return anySolo ? (st.solo ? 1 : 0) : (st.mute ? 0 : 1);
  }
  applyGains(immediate = false) {
    if (!this.ctx) return;
    for (const n of Object.keys(this.stemGains)) {
      const v = this.stemGainValue(n);
      if (immediate) this.stemGains[n].gain.value = v; else this.stemGains[n].gain.setTargetAtTime(v, this.ctx.currentTime, 0.012);
    }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  async play(pos = this.startPos) {
    this.ensureCtx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stopSources();
    pos = Math.max(0, Math.min(pos, this.total - 0.001));
    const t0 = this.ctx.currentTime + 0.06;
    let when = t0;
    let k = this.sections.findIndex((s) => pos < s.start_s + s.duration_s);
    if (k < 0) k = 0;
    this.schedule = [];
    for (let i = k; i < this.sections.length; i++) {
      const sec = this.sections[i];
      const off = i === k ? pos - sec.start_s : 0;
      const isLoop = sec.name === this.loopName;
      const loopIt = isLoop && this.loopOn;
      const start = (buf, dest) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        if (loopIt) { src.loop = true; src.loopStart = 0; src.loopEnd = Math.min(sec.duration_s, buf.duration); }
        src.connect(dest);
        src.start(when, Math.min(off, buf.duration - 0.001));
        if (!loopIt) src.stop(when + (buf.duration - off));
        this.sources.push(src);
      };
      if (isLoop && this.useStems) for (const [n, buf] of Object.entries(this.buffers.stems)) start(buf, this.stemGains[n]);
      else start(this.buffers.sections[sec.name], this.mixGain);
      this.schedule.push({ sec, at: when, off, loop: loopIt });
      if (loopIt) break;
      when += sec.duration_s - off;
    }
    this.t0 = t0; this.startPos = pos; this.playing = true;
    this.endAt = this.schedule.at(-1)?.loop ? Infinity : when;
  }
  stopSources() { for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } s.disconnect(); } this.sources = []; }
  stop() { if (this.playing) this.startPos = this.position(); this.stopSources(); this.playing = false; }
  position() {
    if (!this.playing || !this.ctx) return this.startPos;
    const now = this.ctx.currentTime;
    if (now >= this.endAt) { this.playing = false; this.stopSources(); this.startPos = 0; return 0; }
    let cur = null;
    for (const s of this.schedule) if (now >= s.at) cur = s;
    if (!cur) return this.startPos;
    const el = now - cur.at + cur.off;
    return cur.sec.start_s + (cur.loop ? el % cur.sec.duration_s : Math.min(el, cur.sec.duration_s));
  }
  level(n) {
    const an = n ? this.analysers?.[n] : this.mixAnalyser;
    if (!an || !this.playing) return 0;
    const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
    let s = 0; for (const v of d) s += v * v;
    return Math.sqrt(s / d.length);
  }
  destroy() { this.stopSources(); this.playing = false; this.ctx?.close().catch(() => {}); }
}

function cuePeaks(engine, n = 700) {
  const out = [];
  for (const sec of engine.sections) {
    const buf = engine.buffers.sections[sec.name];
    const bars = Math.max(1, Math.round((sec.duration_s / engine.total) * n));
    const len = Math.min(buf.length, Math.round(sec.duration_s * buf.sampleRate));
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    for (let b = 0; b < bars; b++) {
      const a = Math.floor((b * len) / bars), e = Math.floor(((b + 1) * len) / bars);
      let mn = 0, mx = 0;
      for (let i = a; i < e; i += 8) { let v = 0; for (const c of chans) v += c[i]; v /= chans.length; if (v < mn) mn = v; if (v > mx) mx = v; }
      out.push([mn, mx]);
    }
  }
  return out;
}

async function musicDetail(a, cleanup) {
  const m = a.metadata || {};
  let meta = m;
  if (m.metadata_file) { try { meta = { ...m, ...(await fetchFileJson(m.metadata_file)) }; } catch { /* use registry metadata */ } }
  const files = meta.files || {};
  const sectionsMeta = meta.sections || m.sections || [];
  const loopSec = sectionsMeta.find((s) => s.name === (meta.loop?.section)) || sectionsMeta.find((s) => s.loop);
  const tps = meta.transition_points_s || [];

  const tiles = h('div', { class: 'stats stats-sm' },
    h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Tempo'), h('div', { class: 'stat-value' }, meta.bpm ? `${meta.bpm}` : '—', h('small', null, ' BPM'))),
    h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Key'), h('div', { class: 'stat-value' }, meta.key || '—')),
    h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Meter'), h('div', { class: 'stat-value' }, Array.isArray(meta.meter) ? meta.meter.join('/') : meta.meter || '—')),
    h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Loop'), h('div', { class: 'stat-value' }, meta.loop ? `${meta.loop.bars} bars` : 'none'), h('div', { class: 'stat-sub muted' }, meta.loop ? `${meta.loop.section} · ${fmtDuration(meta.loop.duration_s)} · ${meta.loop.ticks ?? '—'} ticks` : '')),
    h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Transitions'), h('div', { class: 'stat-value' }, `${tps.length}`), h('div', { class: 'stat-sub muted' }, meta.transition_every_bars ? `every ${meta.transition_every_bars} bars` : 'points in loop')),
    meta.state ? h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Music state'), h('div', { class: 'stat-value' }, meta.state)) : null);

  const playerBox = h('div', { class: 'music-player' }, spinner('Decoding sections & stems…'));
  const mixerBox = h('div');
  const sectionsTable = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Section'), h('th', { class: 'num' }, 'Bars'), h('th', { class: 'num' }, 'Start'), h('th', { class: 'num' }, 'End'), h('th', { class: 'num' }, 'Length'), h('th', null, 'Render'))),
    h('tbody', null, sectionsMeta.map((s) => h('tr', null, h('td', null, h('strong', null, s.name), ' ', s.loop ? tag('loop', 'tag-accent') : null), h('td', { class: 'num mono' }, String(s.bars)), h('td', { class: 'num mono' }, `${s.start_s}s`), h('td', { class: 'num mono' }, `${s.end_s}s`), h('td', { class: 'num mono' }, fmtDuration(s.duration_s)),
      h('td', null, files.sections?.[s.name] ? h('a', { class: 'mono path small', href: fileUrl(files.sections[s.name]), target: '_blank', rel: 'noopener' }, files.sections[s.name]) : h('span', { class: 'muted' }, '—')))))));

  // decode audio, then build the player
  (async () => {
    try {
      const secEntries = Object.entries(files.sections || {});
      const stemEntries = Object.entries(files.stems || {});
      if (!secEntries.length) throw new Error('No rendered sections listed in the metadata file.');
      const [secBufs, stemBufs] = await Promise.all([
        Promise.all(secEntries.map(async ([n, p]) => [n, await decodeAudio(p)])),
        Promise.all(stemEntries.map(async ([n, p]) => [n, await decodeAudio(p)])),
      ]);
      const engine = new MusicEngine({ ...meta, sections: sectionsMeta }, { sections: Object.fromEntries(secBufs), stems: Object.fromEntries(stemBufs) });
      cleanup.push(() => engine.destroy());
      buildPlayer(engine, playerBox, mixerBox, tps, meta, cleanup);
    } catch (e) {
      playerBox.replaceChildren(h('div', { class: 'callout callout-error' }, icon('alert'), `Audio could not be decoded: ${e.message}`));
      if (Array.isArray(m.waveform)) {
        const c = h('canvas', { class: 'wave wave-lg' });
        playerBox.appendChild(c);
        requestAnimationFrame(() => drawWaveform(c, m.waveform, { height: 96 }));
      }
    }
  })();

  return h('div', { class: 'stack' },
    h('div', { class: 'detail-head' }, h('h2', null, a.name), assetHeader(a)),
    tiles,
    card('Player', playerBox, { sub: 'Plays like the game: sections in order, the loop section loops seamlessly. Click the waveform to seek; ← → jump by one bar.' }),
    mixerBox,
    card('Sections', sectionsTable),
    ...genericAssetSections(a, { skip: ['metadata'] }),
    section('Music metadata', kv([
      ['Metadata file', m.metadata_file ? h('a', { class: 'mono path small', href: fileUrl(m.metadata_file), target: '_blank', rel: 'noopener' }, m.metadata_file) : null],
      ['Beat / bar', meta.beat_seconds ? `${meta.beat_seconds}s / ${meta.bar_seconds}s` : null],
      ['Transition points', tps.length ? h('span', { class: 'mono' }, tps.map((t) => `${t}s`).join(' · ')) : null],
    ])));
}

function buildPlayer(engine, playerBox, mixerBox, tps, meta, cleanup) {
  const meterEls = new Map();
  const peaks = cuePeaks(engine);
  const loop = engine.sections.find((s) => s.name === engine.loopName);
  const canvas = h('canvas', { class: 'wave wave-lg cue-canvas', tabindex: '0', role: 'slider', 'aria-label': 'Cue position', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(engine.total)) });
  const pos = h('span', { class: 'mono anim-time' });
  const playBtn = h('button', { type: 'button', class: 'btn btn-play btn-play-lg', 'aria-label': 'Play' });
  const stopBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Stop and rewind', title: 'Stop' }, icon('stop', { size: 16 }));
  const meter = h('span', { class: 'meter meter-wide', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill' }));
  const sectionLabels = h('div', { class: 'cue-labels' }, engine.sections.map((s) => h('span', { class: `cue-label ${s.name === engine.loopName ? 'is-loop' : ''}`, style: { left: `${(s.start_s / engine.total) * 100}%`, width: `${(s.duration_s / engine.total) * 100}%` } }, s.name, s.name === engine.loopName ? ' ⟲' : '')));
  const markers = () => {
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue('--accent').trim(), warn = css.getPropertyValue('--warn').trim(), muted = css.getPropertyValue('--muted').trim();
    const mk = engine.sections.slice(1).map((s) => ({ at: s.start_s / engine.total, color: muted }));
    if (loop) {
      mk.push({ at: loop.start_s / engine.total, color: accent, width: 2 });
      mk.push({ at: Math.min(0.999, (loop.start_s + loop.duration_s) / engine.total), color: accent, width: 2 });
      for (const t of tps) if (t > 0 && t < loop.duration_s) mk.push({ at: (loop.start_s + t) / engine.total, color: warn, dashed: true });
    }
    return mk;
  };
  const regions = () => {
    const css = getComputedStyle(canvas);
    return loop ? [{ from: loop.start_s / engine.total, to: (loop.start_s + loop.duration_s) / engine.total, color: css.getPropertyValue('--loop-region').trim() || 'rgba(92,207,106,0.08)' }] : [];
  };
  let raf = 0;
  const draw = () => {
    const p = engine.position();
    drawWaveform(canvas, peaks, { progress: p / engine.total, markers: markers(), regions: regions(), height: 112 });
    pos.textContent = `${fmtClock(p)} / ${fmtClock(engine.total)}`;
    canvas.setAttribute('aria-valuenow', String(Math.round(p)));
    playBtn.replaceChildren(icon(engine.playing ? 'pause' : 'play', { size: 18 }));
    playBtn.setAttribute('aria-label', engine.playing ? 'Pause' : 'Play');
    meter.firstChild.style.width = `${Math.min(100, engine.level(null) * 260 + Object.keys(engine.stemState).reduce((acc, n) => acc + engine.level(n) * 180, 0))}%`;
    for (const [n, el] of meterEls) el.style.width = `${Math.min(100, engine.level(n) * 300)}%`;
  };
  const loopFrame = () => { draw(); raf = engine.playing ? requestAnimationFrame(loopFrame) : 0; if (!engine.playing) draw(); };
  const start = async (p) => { sharedPlayer.stop(); await engine.play(p); if (!raf) raf = requestAnimationFrame(loopFrame); };
  playBtn.addEventListener('click', async () => { if (engine.playing) { engine.stop(); draw(); } else await start(engine.startPos); });
  stopBtn.addEventListener('click', () => { engine.stop(); engine.startPos = 0; draw(); });
  const seekTo = async (p) => { if (engine.playing) await start(p); else { engine.startPos = p; draw(); } };
  canvas.addEventListener('click', (e) => { const r = canvas.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * engine.total); });
  canvas.addEventListener('keydown', (e) => {
    const p = engine.position();
    if (e.key === 'ArrowRight') { seekTo(Math.min(engine.total - 0.01, p + (meta.bar_seconds || 1))); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { seekTo(Math.max(0, p - (meta.bar_seconds || 1))); e.preventDefault(); }
    if (e.key === ' ') { playBtn.click(); e.preventDefault(); }
  });
  const ro = new ResizeObserver(draw); ro.observe(canvas);
  const onTheme = () => draw();
  window.addEventListener('themechange', onTheme);
  cleanup.push(() => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('themechange', onTheme); });

  const startFrom = segmented(engine.sections.map((s) => ({ value: s.name, label: s.name })), engine.sections[0]?.name, (v) => { const s = engine.sections.find((x) => x.name === v); seekTo(s.start_s); if (!engine.playing) start(s.start_s); }, { label: 'Play from section' });
  const vol = h('input', { type: 'range', class: 'volume', min: '0', max: '1', step: '0.01', value: String(engine.volume), 'aria-label': 'Volume', oninput: (e) => engine.setVolume(Number(e.target.value)) });
  playerBox.replaceChildren(
    h('div', { class: 'transport' }, playBtn, stopBtn, pos, meter, h('div', { class: 'toolbar-spacer' }),
      h('span', { class: 'muted small' }, 'Play from'), startFrom,
      toggle('Loop', engine.loopOn, async (v) => { engine.loopOn = v; if (engine.playing) await start(engine.position()); }),
      h('label', { class: 'vol' }, icon('sfx', { size: 15 }), vol)),
    h('div', { class: 'cue-wrap' }, sectionLabels, canvas),
    h('div', { class: 'cue-legend small muted' }, h('span', null, h('i', { class: 'lg-loop' }), 'loop region'), h('span', null, h('i', { class: 'lg-trans' }), 'transition point'), h('span', null, h('i', { class: 'lg-sec' }), 'section boundary')));

  // stem mixer
  const stems = Object.keys(engine.buffers.stems);
  if (stems.length) {
    const stemMeta = new Map((meta.stems || []).map((s) => [s.name, s]));
    const rows = stems.map((n) => {
      const st = engine.stemState[n];
      const fill = h('span', { class: 'meter-fill' });
      meterEls.set(n, fill);
      const mBtn = h('button', { type: 'button', class: 'btn btn-ms', 'aria-pressed': 'false', title: `Mute ${n}` }, 'M');
      const sBtn = h('button', { type: 'button', class: 'btn btn-ms solo', 'aria-pressed': 'false', title: `Solo ${n}` }, 'S');
      const row = h('div', { class: 'stem-row' },
        h('div', { class: 'stem-name' }, h('strong', null, n), h('span', { class: 'muted small' }, stemMeta.get(n)?.instrument || ''), stemMeta.get(n)?.gain !== undefined ? h('span', { class: 'mono muted small' }, `${stemMeta.get(n).gain} dB`) : null),
        h('span', { class: 'meter', 'aria-hidden': 'true' }, fill), mBtn, sBtn);
      const sync = () => {
        mBtn.setAttribute('aria-pressed', String(st.mute)); sBtn.setAttribute('aria-pressed', String(st.solo));
        row.classList.toggle('silent', engine.stemGainValue(n) === 0);
      };
      mBtn.addEventListener('click', () => { st.mute = !st.mute; engine.applyGains(); syncAll(); });
      sBtn.addEventListener('click', () => { st.solo = !st.solo; engine.applyGains(); syncAll(); });
      row._sync = sync;
      return row;
    });
    const syncAll = () => rows.forEach((r) => r._sync());
    syncAll();
    mixerBox.replaceChildren(card('Stem mixer', h('div', { class: 'stems' }, rows,
      h('div', { class: 'stem-actions' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { for (const s of Object.values(engine.stemState)) { s.mute = false; s.solo = false; } engine.applyGains(); syncAll(); } }, 'Reset mixer'))),
    { sub: `${stems.length} stems for the “${engine.loopName}” section — started on the same audio clock, so muting/soloing never drifts.` }));
  } else mixerBox.replaceChildren();
  draw();
}

export default {
  title: 'Music', icon: 'music',
  async mount(root, { param, app }) {
    let assets = [];
    let selected = param;
    const cleanup = [];
    const listEl = h('div', { class: 'list' });
    const detailEl = h('div', { class: 'detail' });
    const teardown = () => { while (cleanup.length) cleanup.pop()(); };
    const drawList = () => replace(listEl, assets.map((a) => listItem(a, {
      active: a.id === selected, onSelect: (x) => { location.hash = `#/music/${encodeURIComponent(x.id)}`; },
      extra: h('span', { class: 'li-chips' }, a.metadata?.bpm ? h('span', { class: 'mono muted small' }, `${a.metadata.bpm} bpm`) : null, statusChip(a.status)),
    })));
    const showDetail = async (id) => {
      teardown();
      if (!assets.some((x) => x.id === id)) { replace(detailEl, empty('music', 'Select a cue', 'Pick a music cue on the left.')); return; }
      replace(detailEl, spinner());
      const a = await api('asset', { id });
      if (selected !== id) return;
      replace(detailEl, await musicDetail(a, cleanup));
    };
    const render = async () => {
      assets = await listAssets('music', app);
      if (!selected && assets.length) selected = assets[0].id;
      if (!assets.length) { root.replaceChildren(pageHeader('Music', 'Adaptive music cues'), empty('music', 'No music yet', 'Score adaptive cues with audio_music_render (intro/loop sections, stems, transition points) to play and mix them here.')); return false; }
      drawList();
      root.replaceChildren(pageHeader('Music', `${assets.length} cue${assets.length === 1 ? '' : 's'} · section-aware playback and a sample-synchronous stem mixer`), splitLayout(listEl, detailEl));
      return true;
    };
    if (await render()) await showDetail(selected);
    return {
      update: async () => {
        if (!root.contains(listEl)) { if (await render()) await showDetail(selected); return; }
        assets = await listAssets('music', app); drawList();
      },
      setParam: async (p) => { if (!p || p === selected) return; selected = p; drawList(); await showDetail(p); },
      destroy: teardown,
    };
  },
};
