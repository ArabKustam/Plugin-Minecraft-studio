// Audio helpers: one shared <audio> element for previews, waveform canvases
// (from registry metadata.waveform or decoded via WebAudio) with seek support.
import { h, icon, fmtClock } from './dom.js';
import { fileUrl, decodeAudio } from './api.js';

const el = new Audio();
el.preload = 'metadata';
let currentKey = null;
const listeners = new Set();
let raf = 0;
const emit = () => { for (const f of listeners) f(); };
const tick = () => { emit(); raf = el.paused ? 0 : requestAnimationFrame(tick); };
el.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); emit(); });
el.addEventListener('pause', emit);
el.addEventListener('ended', () => { emit(); });
el.addEventListener('loadedmetadata', emit);
el.addEventListener('error', () => { emit(); });

export const player = {
  get key() { return currentKey; },
  get playing() { return !el.paused && !el.ended; },
  get time() { return el.currentTime || 0; },
  get duration() { return Number.isFinite(el.duration) ? el.duration : 0; },
  get error() { return el.error; },
  play(key, path, at = 0, { loop = false } = {}) {
    if (currentKey !== key) { el.src = fileUrl(path); currentKey = key; }
    el.loop = loop;
    const go = () => { try { el.currentTime = at; } catch { /* not seekable yet */ } el.play().catch(() => emit()); };
    if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
    emit();
  },
  toggle(key, path, opts) {
    if (currentKey === key && !el.paused) { el.pause(); return; }
    if (currentKey === key) { el.loop = !!opts?.loop; el.play().catch(() => emit()); return; }
    this.play(key, path, 0, opts);
  },
  seek(key, path, frac, opts) {
    if (currentKey !== key) { this.play(key, path, 0, opts); el.addEventListener('loadedmetadata', () => { el.currentTime = frac * el.duration; }, { once: true }); return; }
    if (Number.isFinite(el.duration)) el.currentTime = frac * el.duration;
    emit();
  },
  stop() { el.pause(); emit(); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

/** Pick the most browser-friendly playable file of an asset. */
export function playableFile(asset) {
  const files = asset.files || [];
  const audio = files.filter((f) => /\.(wav|flac|ogg|mp3)$/i.test(f.path));
  return (audio.find((f) => f.role === 'primary' && /\.(wav|flac)$/i.test(f.path)) || audio.find((f) => /\.(wav|flac)$/i.test(f.path)) ||audio.find((f) => /\.ogg$/i.test(f.path)) || audio[0])?.path || null;
}

/** [min,max] peaks for an AudioBuffer (mono mix). */
export function computePeaks(buffer, n = 400) {
  const len = buffer.length;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const out = [];
  const step = Math.max(1, Math.floor(len / n));
  for (let b = 0; b < n; b++) {
    let mn = 0, mx = 0;
    const start = Math.floor((b * len) / n), end = Math.min(len, start + step);
    for (let i = start; i < end; i += 4) {
      let v = 0;
      for (const c of chans) v += c[i];
      v /= chans.length;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    out.push([mn, mx]);
  }
  return out;
}

const css = (el2, name, fb) => getComputedStyle(el2).getPropertyValue(name).trim() || fb;

/**
 * Draw a waveform. opts: progress (0..1), markers [{at (0..1), color, label, dashed}],
 * regions [{from,to,color,label}].
 */
export function drawWaveform(canvas, peaks, { progress = -1, markers = [], regions = [], height } = {}) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round((height || rect.height) * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  for (const r of regions) {
    ctx.fillStyle = r.color;
    ctx.fillRect(Math.round(r.from * W), 0, Math.max(1, Math.round((r.to - r.from) * W)), H);
  }
  const played = css(canvas, '--wave-played', '#5ccf6a'), rest = css(canvas, '--wave', '#5d6676');
  const mid = H / 2;
  if (!peaks?.length) {
    ctx.fillStyle = rest; ctx.fillRect(0, mid - dpr / 2, W, dpr);
  } else {
    const bar = Math.max(2 * dpr, Math.floor(W / Math.min(peaks.length, W / (3 * dpr))));
    const gap = bar > 3 * dpr ? dpr : Math.max(1, Math.floor(bar / 3));
    const nBars = Math.floor(W / bar);
    let peak = 0.0001;
    for (const [mn, mx] of peaks) peak = Math.max(peak, Math.abs(mn), Math.abs(mx));
    const norm = Math.min(1 / peak, 4);
    for (let i = 0; i < nBars; i++) {
      const a = Math.floor((i / nBars) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / nBars) * peaks.length));
      let mn = 0, mx = 0;
      for (let k = a; k < b && k < peaks.length; k++) { mn = Math.min(mn, peaks[k][0]); mx = Math.max(mx, peaks[k][1]); }
      const top = mid - Math.max(dpr, mx * norm * mid * 0.92), bot = mid - Math.min(-dpr, mn * norm * mid * 0.92);
      ctx.fillStyle = progress >= 0 && (i + 0.5) / nBars <= progress ? played : rest;
      ctx.fillRect(i * bar, Math.round(top), bar - gap, Math.max(dpr, Math.round(bot - top)));
    }
  }
  for (const m of markers) {
    const x = Math.round(m.at * W) + 0.5;
    ctx.strokeStyle = m.color || css(canvas, '--warn', '#f0b545');
    ctx.lineWidth = m.width ? m.width * dpr : dpr;
    ctx.setLineDash(m.dashed ? [3 * dpr, 3 * dpr] : []);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    if (m.label) {
      ctx.setLineDash([]);
      ctx.font = `${10 * dpr}px ${css(canvas, '--font-mono', 'monospace')}`;
      ctx.fillStyle = m.color || css(canvas, '--warn', '#f0b545');
      ctx.fillText(m.label, Math.min(x + 3 * dpr, W - ctx.measureText(m.label).width - 2), 11 * dpr);
    }
  }
  if (progress >= 0 && progress <= 1) {
    ctx.setLineDash([]);
    ctx.fillStyle = css(canvas, '--text', '#fff');
    ctx.fillRect(Math.round(progress * W) - dpr, 0, 2 * dpr, H);
  }
}

/**
 * Compact play button + waveform used by SFX and Voice rows.
 * Returns {el, destroy}.
 */
export function audioStrip(asset, { peaks: givenPeaks = null, duration = null, loop = false, height = 56 } = {}) {
  const path = playableFile(asset);
  const key = `asset:${asset.id}`;
  let peaks = givenPeaks;
  const btn = h('button', { type: 'button', class: 'btn btn-play', 'aria-label': `Play ${asset.name}`, disabled: !path });
  const canvas = h('canvas', { class: 'wave', style: { height: `${height}px` }, tabindex: path ? '0' : '-1', role: 'slider', 'aria-label': `Seek ${asset.name}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' });
  const time = h('span', { class: 'wave-time mono' }, duration ? fmtClock(duration) : '');
  const wrap = h('div', { class: 'audio-strip' }, btn, h('div', { class: 'wave-wrap' }, canvas), time);
  const draw = () => {
    const mine = player.key === key;
    const prog = mine && player.duration ? player.time / player.duration : -1;
    drawWaveform(canvas, peaks, { progress: prog, height });
    btn.replaceChildren(icon(mine && player.playing ? 'pause' : 'play', { size: 16 }));
    btn.setAttribute('aria-label', `${mine && player.playing ? 'Pause' : 'Play'} ${asset.name}`);
    btn.classList.toggle('on', mine && player.playing);
    canvas.setAttribute('aria-valuenow', String(Math.round(Math.max(0, prog) * 100)));
    time.textContent = mine && player.duration ? `${fmtClock(player.time)} / ${fmtClock(player.duration)}` : (duration ? fmtClock(duration) : '');
  };
  btn.addEventListener('click', () => player.toggle(key, path, { loop }));
  canvas.addEventListener('click', (e) => {
    if (!path) return;
    const r = canvas.getBoundingClientRect();
    player.seek(key, path, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), { loop });
  });
  canvas.addEventListener('keydown', (e) => {
    if (!path || player.key !== key || !player.duration) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const f = player.time / player.duration;
    if (e.key === 'ArrowRight') { player.seek(key, path, Math.min(1, f + step)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { player.seek(key, path, Math.max(0, f - step)); e.preventDefault(); }
    if (e.key === ' ' || e.key === 'Enter') { player.toggle(key, path, { loop }); e.preventDefault(); }
  });
  const unsub = player.subscribe(draw);
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  if (!peaks && path) {
    decodeAudio(path).then((b) => { peaks = computePeaks(b, 300); draw(); }).catch(() => { /* undecodable: flat line */ });
  }
  return { el: wrap, destroy: () => { unsub(); ro.disconnect(); if (player.key === key) player.stop(); } };
}
