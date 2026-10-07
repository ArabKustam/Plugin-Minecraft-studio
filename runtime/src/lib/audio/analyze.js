// Audio QA analysis: loudness (ITU-R BS.1770 / EBU R128 integrated LUFS),
// peaks, clipping, silence, loop seams, Minecraft compatibility and a compact
// waveform envelope for the dashboard.
import fs from 'node:fs';
import { Biquad, gainToDb } from './dsp.js';
import { decodeAny, probe } from './ffmpeg.js';

function kWeight(ch, sr) {
  // Stage 1: high shelf (+4 dB @ 1.5 kHz), Stage 2: high-pass (38 Hz) — BS.1770 approximation valid for any sample rate.
  const s1 = new Biquad('highshelf', sr); s1.set(1500, 1 / Math.SQRT2, 4.0);
  const s2 = new Biquad('highpass', sr); s2.set(38, 0.5);
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = s2.process(s1.process(ch[i]));
  return out;
}

/** Integrated loudness in LUFS with absolute (-70) and relative (-10 LU) gating. */
export function integratedLoudness(audio) {
  const sr = audio.sampleRate;
  const weighted = audio.channels.map((c) => kWeight(c, sr));
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const n = weighted[0].length;
  if (n < block) {
    // short sounds (clicks, UI): use the whole clip as one block
    let z = 0;
    for (const w of weighted) { let s = 0; for (let i = 0; i < n; i++) s += w[i] * w[i]; z += s / Math.max(1, n); }
    return z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity;
  }
  const blocks = [];
  for (let start = 0; start + block <= n; start += hop) {
    let z = 0;
    for (const w of weighted) { let s = 0; for (let i = start; i < start + block; i++) s += w[i] * w[i]; z += s / block; }
    blocks.push(z);
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function analyzeAudio(audio, { silenceDb = -50, loopCheck = false, waveformPoints = 200 } = {}) {
  const sr = audio.sampleRate;
  const n = audio.channels[0].length;
  let peak = 0, sumSq = 0, clipped = 0;
  for (const ch of audio.channels) for (let i = 0; i < n; i++) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sumSq += ch[i] * ch[i];
  }
  const rms = Math.sqrt(sumSq / (n * audio.channels.length));
  const thr = 10 ** (silenceDb / 20);
  const loud = (i) => audio.channels.some((c) => Math.abs(c[i]) > thr);
  let head = 0; while (head < n && !loud(head)) head++;
  let tail = 0; while (tail < n - head && !loud(n - 1 - tail)) tail++;
  // waveform envelope (min/max per bucket of the mono sum)
  const buckets = Math.min(waveformPoints, n);
  const wf = [];
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor((b * n) / buckets), e = Math.floor(((b + 1) * n) / buckets);
    let mn = 0, mx = 0;
    for (let i = s; i < e; i++) { const v = audio.channels.reduce((a, c) => a + c[i], 0) / audio.channels.length; if (v < mn) mn = v; if (v > mx) mx = v; }
    wf.push([Number(mn.toFixed(3)), Number(mx.toFixed(3))]);
  }
  let stereo = null;
  if (audio.channels.length === 2) {
    let diff = 0, sum = 0;
    for (let i = 0; i < n; i++) { diff += Math.abs(audio.channels[0][i] - audio.channels[1][i]); sum += Math.abs(audio.channels[0][i]) + Math.abs(audio.channels[1][i]); }
    stereo = { width: Number((diff / Math.max(1e-9, sum)).toFixed(3)), effectively_mono: diff / Math.max(1e-9, sum) < 0.02 };
  }
  const res = {
    sample_rate: sr, channels: audio.channels.length, duration: Number((n / sr).toFixed(3)), samples: n,
    peak_dbfs: Number(gainToDb(peak).toFixed(2)), rms_dbfs: Number(gainToDb(rms).toFixed(2)),
    lufs: Number(integratedLoudness(audio).toFixed(2)),
    clipped_samples: clipped,
    leading_silence: Number((head / sr).toFixed(3)), trailing_silence: Number((tail / sr).toFixed(3)),
    stereo, waveform: wf,
  };
  if (loopCheck) res.loop = loopSeam(audio);
  return res;
}

/** How audible is the wrap from last sample to first? Compares the jump to typical sample deltas and RMS around the seam. */
export function loopSeam(audio) {
  const sr = audio.sampleRate;
  const ch = audio.channels[0];
  const n = ch.length;
  let typical = 0;
  for (let i = 1; i < n; i++) typical += Math.abs(ch[i] - ch[i - 1]);
  typical /= Math.max(1, n - 1);
  const jump = Math.abs(ch[0] - ch[n - 1]);
  const win = Math.min(Math.round(0.05 * sr), Math.floor(n / 4));
  const rms = (s, e) => { let a = 0; for (let i = s; i < e; i++) a += ch[i] * ch[i]; return Math.sqrt(a / Math.max(1, e - s)); };
  const headR = rms(0, win), tailR = rms(n - win, n);
  const levelDiffDb = Math.abs(gainToDb(headR + 1e-9) - gainToDb(tailR + 1e-9));
  const jumpRatio = jump / Math.max(1e-6, typical);
  // A sample discontinuity is an audible click (fail). A level step is only a problem for sustained
  // material (hums, drones); rhythmic loops legitimately end quieter than they start (warn, not fail).
  const status = jumpRatio >= 20 ? 'fail' : jumpRatio >= 6 || levelDiffDb >= 6 ? 'warn' : 'pass';
  return { status, sample_jump_ratio: Number(jumpRatio.toFixed(2)), level_difference_db: Number(levelDiffDb.toFixed(2)), note: 'jump ratio = |last-first| / mean sample delta (≤6 is click-free, ≥20 clicks); level difference compares 50 ms RMS at both ends (a step is fine for rhythmic loops, audible for sustained tones)' };
}

/**
 * Full QA for a file: technical analysis plus Minecraft-specific checks.
 * role: 'sfx' | 'music' | 'voice' | 'ambience'; positional sounds must be mono.
 */
export function auditAudioFile(file, { role = 'sfx', targetLufs = null, loop = false, positional = true } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const meta = probe(file);
  const audio = decodeAny(file);
  const a = analyzeAudio(audio, { loopCheck: loop });
  const isOgg = /\.ogg$/i.test(file);
  if (isOgg) add('format', meta?.codec ? (meta.codec === 'vorbis' ? 'pass' : 'fail') : 'warn', meta?.codec ? `codec ${meta.codec} (Minecraft needs Vorbis)` : 'codec not probed (FFmpeg missing)');
  else add('format', 'warn', 'not Ogg Vorbis yet: export with studio_audio_export_minecraft before integration');
  if (positional && role !== 'music') add('channels', a.channels === 1 ? 'pass' : 'fail', a.channels === 1 ? 'mono (attenuates with distance)' : 'stereo files do not attenuate with distance in Minecraft — export mono for positional sounds');
  if (role === 'music' && a.channels === 2) add('channels', 'pass', 'stereo music (non-positional)');
  add('clipping', a.clipped_samples === 0 ? 'pass' : a.clipped_samples < 10 ? 'warn' : 'fail', `${a.clipped_samples} clipped samples, peak ${a.peak_dbfs} dBFS`);
  add('headroom', a.peak_dbfs <= -0.5 ? 'pass' : 'warn', `peak ${a.peak_dbfs} dBFS (keep ≤ -1 dBFS)`);
  const target = targetLufs ?? { sfx: -16, music: -20, voice: -18, ambience: -24 }[role] ?? -16;
  const dev = Math.abs(a.lufs - target);
  add('loudness', !Number.isFinite(a.lufs) ? 'fail' : dev <= 3 ? 'pass' : dev <= 6 ? 'warn' : 'fail', `${a.lufs} LUFS (target ${target} ±3 for ${role})`);
  add('leading silence', a.leading_silence <= (role === 'voice' ? 0.25 : 0.05) ? 'pass' : 'warn', `${a.leading_silence}s before first sound (delays sync with game events)`);
  add('duration', a.duration > 0.02 ? 'pass' : 'fail', `${a.duration}s`);
  if (loop) add('loop seam', a.loop.status, `jump ratio ${a.loop.sample_jump_ratio}, level diff ${a.loop.level_difference_db} dB`);
  const size = fs.statSync(file).size;
  const kbps = (size * 8) / 1000 / Math.max(0.01, a.duration);
  add('file size', kbps < 260 || !isOgg ? 'pass' : 'warn', `${(size / 1024).toFixed(1)} KiB (${kbps.toFixed(0)} kbps)`);
  if (a.sample_rate !== 44100 && a.sample_rate !== 48000) add('sample rate', 'warn', `${a.sample_rate} Hz (use 44.1/48 kHz)`);
  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { verdict, file, analysis: { ...a, waveform: undefined }, waveform: a.waveform, checks };
}
