import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  assetInput,
  createServer,
  external_exports,
  registerOutput,
  requireOneOf,
  start,
  tool
} from "./chunks/chunk-RWJTKMSS.mjs";
import {
  upsertSoundEvent
} from "./chunks/chunk-RU4HYO7E.mjs";
import "./chunks/chunk-3P6ZCJ33.mjs";
import {
  MUSIC_PROVIDERS,
  SFX_PROVIDERS,
  convertFile,
  decodeAny,
  encodeOgg,
  findFfmpeg,
  makeAudio,
  probe,
  processFile,
  resolveProvider,
  toMono,
  writeWav
} from "./chunks/chunk-WWXJ6DHF.mjs";
import {
  StudioError,
  assertId,
  ensureDir,
  exists,
  readJson,
  slugify,
  writeJson
} from "./chunks/chunk-5XAWRH4I.mjs";

// src/mcp/studio-audio.js
import fs2 from "node:fs";
import path from "node:path";

// src/lib/audio/dsp.js
var dbToGain = (db) => 10 ** (db / 20);
var gainToDb = (g) => g <= 0 ? -Infinity : 20 * Math.log10(g);
var midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
var NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteToMidi(n) {
  if (typeof n === "number") return n;
  const m = String(n).trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/);
  if (!m) throw new Error(`Invalid note ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
function paramFn(p, dur) {
  if (typeof p === "number") return () => p;
  if (p && typeof p === "object" && "from" in p) {
    const { from, to, curve = "linear", start: start2 = 0, end = dur } = p;
    return (t) => {
      const u = Math.max(0, Math.min(1, (t - start2) / Math.max(1e-6, end - start2)));
      return curve === "exp" && from > 0 && to > 0 ? from * (to / from) ** u : curve === "ease" ? from + (to - from) * (u * u * (3 - 2 * u)) : from + (to - from) * u;
    };
  }
  if (p && typeof p === "object" && "center" in p) {
    const { center, depth = 0, rate = 1, shape = "sine" } = p;
    return (t) => center + depth * (shape === "triangle" ? 1 - 4 * Math.abs(t * rate % 1 - 0.5) : shape === "square" ? Math.sin(2 * Math.PI * rate * t) >= 0 ? 1 : -1 : Math.sin(2 * Math.PI * rate * t));
  }
  throw new Error(`Invalid parameter ${JSON.stringify(p)}`);
}
function envelopeFn({ attack = 5e-3, decay = 0.05, sustain = 1, release = 0.05, curve = "exp" } = {}, dur) {
  return (t) => {
    let v;
    if (t < attack) v = t / Math.max(attack, 1e-6);
    else if (t < attack + decay) v = 1 - (1 - sustain) * ((t - attack) / Math.max(decay, 1e-6));
    else v = sustain;
    const relStart = dur - release;
    if (t > relStart) v *= Math.max(0, 1 - (t - relStart) / Math.max(release, 1e-6));
    return curve === "exp" ? v * v : v;
  };
}
function oscillator(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "square":
      return p < 0.5 ? 1 : -1;
    case "saw":
      return 2 * p - 1;
    case "triangle":
      return 1 - 4 * Math.abs(p - 0.5);
    case "pulse25":
      return p < 0.25 ? 1 : -1;
    default:
      throw new Error(`Unknown waveform ${wave}`);
  }
}
function rng(seed = 1) {
  let s = seed >>> 0 || 2654435769;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296 * 2 - 1;
  };
}
function noiseGen(color = "white", seed = 1) {
  const r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  return () => {
    const w = r();
    if (color === "pink") {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      return (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
    if (color === "brown") {
      last = (last + 0.02 * w) / 1.02;
      return last * 3.5;
    }
    return w;
  };
}
var Biquad = class {
  constructor(type, sr) {
    this.type = type;
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(1e3, 0.707, 0);
  }
  set(freq, q = 0.707, gainDb = 0) {
    const f = Math.max(10, Math.min(this.sr * 0.49, freq));
    const w0 = 2 * Math.PI * f / this.sr, cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * q), A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case "lowpass":
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "highpass":
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "bandpass":
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "notch":
        b0 = 1;
        b1 = -2 * cos;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "peak":
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cos + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cos);
        b2 = A * (A + 1 - (A - 1) * cos - s);
        a0 = A + 1 + (A - 1) * cos + s;
        a1 = -2 * (A - 1 + (A + 1) * cos);
        a2 = A + 1 + (A - 1) * cos - s;
        break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cos + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cos);
        b2 = A * (A + 1 + (A - 1) * cos - s);
        a0 = A + 1 - (A - 1) * cos + s;
        a1 = 2 * (A - 1 - (A + 1) * cos);
        a2 = A + 1 - (A - 1) * cos - s;
        break;
      }
      default:
        throw new Error(`Unknown filter ${this.type}`);
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
};
function filterBuffer(buf, sr, { type, freq, q = 0.707, gain = 0 }) {
  const f = new Biquad(type, sr);
  const fn = paramFn(freq, buf.length / sr);
  const dynamic = typeof freq !== "number";
  f.set(fn(0), q, gain);
  for (let i = 0; i < buf.length; i++) {
    if (dynamic && i % 32 === 0) f.set(fn(i / sr), q, gain);
    buf[i] = f.process(buf[i]);
  }
  return buf;
}
function reverb(buf, sr, { room = 0.5, damp = 0.4, mix = 0.25, predelay = 0.01 } = {}) {
  const scale = sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ b: new Float32Array(Math.round(n * scale)), i: 0, f: 0 }));
  const aps = [556, 441, 341, 225].map((n) => ({ b: new Float32Array(Math.round(n * scale)), i: 0 }));
  const fb = 0.7 + 0.28 * room;
  const pd = new Float32Array(Math.max(1, Math.round(predelay * sr)));
  let pdi = 0;
  const out = new Float32Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    const inp = pd[pdi];
    pd[pdi] = buf[n];
    pdi = (pdi + 1) % pd.length;
    let acc = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.f = y * (1 - damp) + c.f * damp;
      c.b[c.i] = inp * 0.015 + c.f * fb;
      c.i = (c.i + 1) % c.b.length;
      acc += y;
    }
    for (const a of aps) {
      const y = a.b[a.i];
      a.b[a.i] = acc + y * 0.5;
      a.i = (a.i + 1) % a.b.length;
      acc = y - acc;
    }
    out[n] = buf[n] * (1 - mix) + acc * mix;
  }
  buf.set(out);
  return buf;
}
function compress(buf, sr, { threshold = -18, ratio = 4, attack = 5e-3, release = 0.12, makeup = 0 } = {}) {
  const at = Math.exp(-1 / (attack * sr)), rt = Math.exp(-1 / (release * sr));
  let env = 0;
  const mg = dbToGain(makeup);
  for (let i = 0; i < buf.length; i++) {
    const x = Math.abs(buf[i]);
    env = x > env ? at * env + (1 - at) * x : rt * env + (1 - rt) * x;
    const db = gainToDb(env);
    const over = db - threshold;
    const gr = over > 0 ? over - over / ratio : 0;
    buf[i] *= dbToGain(-gr) * mg;
  }
  return buf;
}
function limit(buf, sr, { ceiling = -1, release = 0.05, lookahead = 3e-3 } = {}) {
  const c = dbToGain(ceiling);
  const la = Math.max(1, Math.round(lookahead * sr));
  const rt = Math.exp(-1 / (release * sr));
  let g = 1;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let peak = 0;
    for (let k = i; k < Math.min(buf.length, i + la); k += 4) peak = Math.max(peak, Math.abs(buf[k]));
    const target = peak > c ? c / peak : 1;
    g = target < g ? target : rt * g + (1 - rt) * target;
    out[i] = Math.max(-c, Math.min(c, buf[i] * g));
  }
  buf.set(out);
  return buf;
}
function distort(buf, { amount = 0.3, mode = "tanh" } = {}) {
  const k = 1 + amount * 20;
  const norm = Math.tanh(k);
  for (let i = 0; i < buf.length; i++) buf[i] = mode === "hard" ? Math.max(-1, Math.min(1, buf[i] * k)) : Math.tanh(buf[i] * k) / norm;
  return buf;
}
function bitcrush(buf, sr, { bits = 8, downsample = 4 } = {}) {
  const levels = 2 ** bits;
  let hold = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i % downsample === 0) hold = Math.round(buf[i] * levels) / levels;
    buf[i] = hold;
  }
  return buf;
}
function tremolo(buf, sr, { rate = 6, depth = 0.5 } = {}) {
  for (let i = 0; i < buf.length; i++) buf[i] *= 1 - depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * rate * i / sr));
  return buf;
}
function fade(buf, sr, { fadeIn = 0, fadeOut = 0 } = {}) {
  const fi = Math.round(fadeIn * sr), fo = Math.round(fadeOut * sr);
  for (let i = 0; i < fi && i < buf.length; i++) buf[i] *= i / fi;
  for (let i = 0; i < fo && i < buf.length; i++) buf[buf.length - 1 - i] *= i / fo;
  return buf;
}
function makeLoopable(buf, sr, { crossfade = 0.25 } = {}) {
  const n = Math.min(Math.round(crossfade * sr), Math.floor(buf.length / 3));
  const out = buf.slice(0, buf.length - n);
  for (let i = 0; i < n; i++) {
    const a = i / n;
    out[i] = buf[i] * Math.sin(a * Math.PI / 2) + buf[buf.length - n + i] * Math.cos(a * Math.PI / 2);
  }
  return out;
}
function trimSilence(buf, sr, { thresholdDb = -45, pad = 0.03 } = {}) {
  const thr = dbToGain(thresholdDb);
  let s = 0;
  while (s < buf.length && Math.abs(buf[s]) < thr) s++;
  let e = buf.length - 1;
  while (e > s && Math.abs(buf[e]) < thr) e--;
  const p = Math.round(pad * sr);
  return buf.slice(Math.max(0, s - p), Math.min(buf.length, e + p + 1));
}
function applyEffects(buf, sr, effects = []) {
  let out = buf;
  for (const fx of effects) {
    switch (fx.type) {
      case "lowpass":
      case "highpass":
      case "bandpass":
      case "notch":
        filterBuffer(out, sr, { type: fx.type, freq: fx.freq, q: fx.q });
        break;
      case "eq":
        for (const band of fx.bands || []) filterBuffer(out, sr, { type: band.type || "peak", freq: band.freq, q: band.q || 1, gain: band.gain || 0 });
        break;
      case "reverb":
        reverb(out, sr, fx);
        break;
      case "compress":
        compress(out, sr, fx);
        break;
      case "limit":
        limit(out, sr, fx);
        break;
      case "distortion":
        distort(out, fx);
        break;
      case "bitcrush":
        bitcrush(out, sr, fx);
        break;
      case "tremolo":
        tremolo(out, sr, fx);
        break;
      case "gain":
        for (let i = 0; i < out.length; i++) out[i] *= dbToGain(fx.db || 0);
        break;
      case "fade":
        fade(out, sr, fx);
        break;
      case "radio":
        filterBuffer(out, sr, { type: "highpass", freq: 400, q: 0.7 });
        filterBuffer(out, sr, { type: "lowpass", freq: 3200, q: 0.7 });
        distort(out, { amount: fx.drive ?? 0.15 });
        compress(out, sr, { threshold: -20, ratio: 6 });
        break;
      case "pa_speaker":
        filterBuffer(out, sr, { type: "highpass", freq: 280, q: 0.7 });
        filterBuffer(out, sr, { type: "lowpass", freq: 4500, q: 0.7 });
        filterBuffer(out, sr, { type: "peak", freq: 1900, q: 1.2, gain: 5 });
        distort(out, { amount: fx.drive ?? 0.08 });
        compress(out, sr, { threshold: -22, ratio: 4 });
        reverb(out, sr, { room: fx.room ?? 0.75, damp: 0.5, mix: fx.mix ?? 0.22, predelay: 0.03 });
        break;
      case "delay": {
        const d = Math.round((fx.time || 0.25) * sr), fbk = fx.feedback ?? 0.35, mix = fx.mix ?? 0.3;
        const o = new Float32Array(out.length);
        for (let i = 0; i < out.length; i++) o[i] = out[i] + (i >= d ? o[i - d] * fbk : 0);
        for (let i = 0; i < out.length; i++) out[i] = out[i] * (1 - mix) + o[i] * mix;
        break;
      }
      case "loop":
        out = makeLoopable(out, sr, fx);
        break;
      case "trim_silence":
        out = trimSilence(out, sr, fx);
        break;
      default:
        throw new Error(`Unknown effect ${fx.type}. Supported: lowpass, highpass, bandpass, notch, eq, reverb, compress, limit, distortion, bitcrush, tremolo, gain, fade, radio, pa_speaker, delay, loop, trim_silence`);
    }
  }
  return out;
}

// src/lib/audio/analyze.js
import fs from "node:fs";
function kWeight(ch, sr) {
  const s1 = new Biquad("highshelf", sr);
  s1.set(1500, 1 / Math.SQRT2, 4);
  const s2 = new Biquad("highpass", sr);
  s2.set(38, 0.5);
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = s2.process(s1.process(ch[i]));
  return out;
}
function integratedLoudness(audio) {
  const sr = audio.sampleRate;
  const weighted = audio.channels.map((c) => kWeight(c, sr));
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const n = weighted[0].length;
  if (n < block) {
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = 0; i < n; i++) s += w[i] * w[i];
      z += s / Math.max(1, n);
    }
    return z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity;
  }
  const blocks = [];
  for (let start2 = 0; start2 + block <= n; start2 += hop) {
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = start2; i < start2 + block; i++) s += w[i] * w[i];
      z += s / block;
    }
    blocks.push(z);
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}
function analyzeAudio(audio, { silenceDb = -50, loopCheck = false, waveformPoints = 200 } = {}) {
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
  let head = 0;
  while (head < n && !loud(head)) head++;
  let tail = 0;
  while (tail < n - head && !loud(n - 1 - tail)) tail++;
  const buckets = Math.min(waveformPoints, n);
  const wf = [];
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * n / buckets), e = Math.floor((b + 1) * n / buckets);
    let mn = 0, mx = 0;
    for (let i = s; i < e; i++) {
      const v = audio.channels.reduce((a, c) => a + c[i], 0) / audio.channels.length;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    wf.push([Number(mn.toFixed(3)), Number(mx.toFixed(3))]);
  }
  let stereo = null;
  if (audio.channels.length === 2) {
    let diff = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs(audio.channels[0][i] - audio.channels[1][i]);
      sum += Math.abs(audio.channels[0][i]) + Math.abs(audio.channels[1][i]);
    }
    stereo = { width: Number((diff / Math.max(1e-9, sum)).toFixed(3)), effectively_mono: diff / Math.max(1e-9, sum) < 0.02 };
  }
  const res = {
    sample_rate: sr,
    channels: audio.channels.length,
    duration: Number((n / sr).toFixed(3)),
    samples: n,
    peak_dbfs: Number(gainToDb(peak).toFixed(2)),
    rms_dbfs: Number(gainToDb(rms).toFixed(2)),
    lufs: Number(integratedLoudness(audio).toFixed(2)),
    clipped_samples: clipped,
    leading_silence: Number((head / sr).toFixed(3)),
    trailing_silence: Number((tail / sr).toFixed(3)),
    stereo,
    waveform: wf
  };
  if (loopCheck) res.loop = loopSeam(audio);
  return res;
}
function loopSeam(audio) {
  const sr = audio.sampleRate;
  const ch = audio.channels[0];
  const n = ch.length;
  let typical = 0;
  for (let i = 1; i < n; i++) typical += Math.abs(ch[i] - ch[i - 1]);
  typical /= Math.max(1, n - 1);
  const jump = Math.abs(ch[0] - ch[n - 1]);
  const win = Math.min(Math.round(0.05 * sr), Math.floor(n / 4));
  const rms = (s, e) => {
    let a = 0;
    for (let i = s; i < e; i++) a += ch[i] * ch[i];
    return Math.sqrt(a / Math.max(1, e - s));
  };
  const headR = rms(0, win), tailR = rms(n - win, n);
  const levelDiffDb = Math.abs(gainToDb(headR + 1e-9) - gainToDb(tailR + 1e-9));
  const jumpRatio = jump / Math.max(1e-6, typical);
  const status = jumpRatio >= 20 ? "fail" : jumpRatio >= 6 || levelDiffDb >= 6 ? "warn" : "pass";
  return { status, sample_jump_ratio: Number(jumpRatio.toFixed(2)), level_difference_db: Number(levelDiffDb.toFixed(2)), note: "jump ratio = |last-first| / mean sample delta (\u22646 is click-free, \u226520 clicks); level difference compares 50 ms RMS at both ends (a step is fine for rhythmic loops, audible for sustained tones)" };
}
function auditAudioFile(file, { role = "sfx", targetLufs = null, loop = false, positional = true } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const meta = probe(file);
  const audio = decodeAny(file);
  const a = analyzeAudio(audio, { loopCheck: loop });
  const isOgg = /\.ogg$/i.test(file);
  if (isOgg) add("format", meta?.codec ? meta.codec === "vorbis" ? "pass" : "fail" : "warn", meta?.codec ? `codec ${meta.codec} (Minecraft needs Vorbis)` : "codec not probed (FFmpeg missing)");
  else add("format", "warn", "not Ogg Vorbis yet: export with studio_audio_export_minecraft before integration");
  if (positional && role !== "music") add("channels", a.channels === 1 ? "pass" : "fail", a.channels === 1 ? "mono (attenuates with distance)" : "stereo files do not attenuate with distance in Minecraft \u2014 export mono for positional sounds");
  if (role === "music" && a.channels === 2) add("channels", "pass", "stereo music (non-positional)");
  add("clipping", a.clipped_samples === 0 ? "pass" : a.clipped_samples < 10 ? "warn" : "fail", `${a.clipped_samples} clipped samples, peak ${a.peak_dbfs} dBFS`);
  add("headroom", a.peak_dbfs <= -0.5 ? "pass" : "warn", `peak ${a.peak_dbfs} dBFS (keep \u2264 -1 dBFS)`);
  const target = targetLufs ?? { sfx: -16, music: -20, voice: -18, ambience: -24 }[role] ?? -16;
  const dev = Math.abs(a.lufs - target);
  add("loudness", !Number.isFinite(a.lufs) ? "fail" : dev <= 3 ? "pass" : dev <= 6 ? "warn" : "fail", `${a.lufs} LUFS (target ${target} \xB13 for ${role})`);
  add("leading silence", a.leading_silence <= (role === "voice" ? 0.25 : 0.05) ? "pass" : "warn", `${a.leading_silence}s before first sound (delays sync with game events)`);
  add("duration", a.duration > 0.02 ? "pass" : "fail", `${a.duration}s`);
  if (loop) add("loop seam", a.loop.status, `jump ratio ${a.loop.sample_jump_ratio}, level diff ${a.loop.level_difference_db} dB`);
  const size = fs.statSync(file).size;
  const kbps = size * 8 / 1e3 / Math.max(0.01, a.duration);
  add("file size", kbps < 260 || !isOgg ? "pass" : "warn", `${(size / 1024).toFixed(1)} KiB (${kbps.toFixed(0)} kbps)`);
  if (a.sample_rate !== 44100 && a.sample_rate !== 48e3) add("sample rate", "warn", `${a.sample_rate} Hz (use 44.1/48 kHz)`);
  const verdict = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";
  return { verdict, file, analysis: { ...a, waveform: void 0 }, waveform: a.waveform, checks };
}

// src/lib/audio/synth.js
var LAYER_TYPES = ["osc", "noise", "fm", "click", "impact", "sample", "chirp"];
function renderLayer(layer, sr, totalDur, index, baseDir) {
  const start2 = layer.start || 0;
  const dur = Math.max(1e-3, layer.duration ?? totalDur - start2);
  const n = Math.round(dur * sr);
  const buf = new Float32Array(n);
  const env = envelopeFn(layer.envelope || {}, dur);
  const seed = layer.seed ?? index + 1;
  switch (layer.type) {
    case "osc": {
      const f = paramFn(layer.freq ?? 440, dur);
      const harmonics = layer.harmonics || [1];
      const voices = layer.voices || 1;
      const detune = layer.detune || 0;
      const phases = new Float64Array(voices * harmonics.length);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const base = f(t);
        let s = 0;
        for (let v = 0; v < voices; v++) {
          const cents = voices === 1 ? 0 : detune * (v / (voices - 1) - 0.5) * 2;
          const fv = base * 2 ** (cents / 1200);
          harmonics.forEach((amp, h) => {
            const k = v * harmonics.length + h;
            phases[k] += fv * (h + 1) / sr;
            s += amp * oscillator(layer.wave || "sine", phases[k]);
          });
        }
        buf[i] = s / voices * env(t);
      }
      break;
    }
    case "chirp":
    // fast pitch sweep, good for UI blips and lasers
    case "fm": {
      const carrier = paramFn(layer.carrier ?? layer.freq ?? 220, dur);
      const ratio = layer.ratio ?? 2;
      const index_ = paramFn(layer.index ?? (layer.type === "chirp" ? 0 : 3), dur);
      let pc = 0, pm = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const fc = carrier(t);
        pm += fc * ratio / sr;
        const mod = Math.sin(2 * Math.PI * pm) * index_(t);
        pc += fc / sr;
        buf[i] = Math.sin(2 * Math.PI * pc + mod) * env(t);
      }
      break;
    }
    case "noise": {
      const gen = noiseGen(layer.color || "white", seed);
      for (let i = 0; i < n; i++) buf[i] = gen() * env(i / sr);
      break;
    }
    case "click": {
      const freq = layer.freq ?? 2500, decay = layer.decay ?? 6e-3;
      const gen = noiseGen("white", seed);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const e = Math.exp(-t / decay);
        buf[i] = (Math.sin(2 * Math.PI * freq * t) * 0.6 + gen() * 0.4) * e;
      }
      break;
    }
    case "impact": {
      const f0 = layer.freq ?? 120, drop = layer.drop ?? 0.5, decay = layer.decay ?? 0.25;
      const gen = noiseGen(layer.color || "brown", seed);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = f0 * (drop + (1 - drop) * Math.exp(-t / (decay * 0.3)));
        ph += f / sr;
        const e = Math.exp(-t / decay);
        buf[i] = (Math.sin(2 * Math.PI * ph) * 0.7 + gen() * (layer.noise ?? 0.5) * Math.exp(-t / (decay * 0.2))) * e;
      }
      break;
    }
    case "sample": {
      if (!layer.file) throw new StudioError("E_SFX", "sample layer needs file");
      const a = decodeAny(baseDir ? `${baseDir}/${layer.file}` : layer.file, { sampleRate: sr });
      const src = a.channels[0];
      const rate = layer.rate ?? 1;
      for (let i = 0; i < n; i++) {
        const p = i * rate;
        const k = Math.floor(p);
        buf[i] = (k + 1 < src.length ? src[k] + (src[k + 1] - src[k]) * (p - k) : 0) * env(i / sr);
      }
      break;
    }
    default:
      throw new StudioError("E_SFX", `Unknown layer type ${layer.type}. Supported: ${LAYER_TYPES.join(", ")}`);
  }
  if (layer.filter) filterBuffer(buf, sr, layer.filter);
  if (layer.filters) for (const f of layer.filters) filterBuffer(buf, sr, f);
  if (layer.effects) applyEffects(buf, sr, layer.effects);
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(buf[i]));
  const g = dbToGain(layer.gain ?? -6) / (pk || 1);
  for (let i = 0; i < n; i++) buf[i] *= g;
  return { buf, offset: Math.round(start2 * sr), pan: layer.pan || 0 };
}
function validateRecipe(recipe) {
  const problems = [];
  if (!recipe || typeof recipe !== "object") return ["recipe must be an object"];
  if (!(recipe.duration > 0 && recipe.duration <= 120)) problems.push("duration must be between 0 and 120 seconds");
  if (!Array.isArray(recipe.layers) || !recipe.layers.length) problems.push("at least one layer is required");
  (recipe.layers || []).forEach((l, i) => {
    if (!LAYER_TYPES.includes(l.type)) problems.push(`layer ${i}: unknown type ${l.type}`);
  });
  if (recipe.channels && ![1, 2].includes(recipe.channels)) problems.push("channels must be 1 or 2");
  return problems;
}
function renderRecipe(recipe, { baseDir = null } = {}) {
  const problems = validateRecipe(recipe);
  if (problems.length) throw new StudioError("E_SFX", `Invalid SFX recipe: ${problems.join("; ")}`);
  const sr = recipe.sample_rate || 48e3;
  const nch = recipe.channels || 1;
  const tail = recipe.loop ? 0 : recipe.tail ?? 0;
  const out = makeAudio(sr, recipe.duration + tail + (recipe.loop ? recipe.loop_crossfade ?? 0.25 : 0), nch);
  recipe.layers.forEach((layer, i) => {
    const { buf, offset, pan } = renderLayer(layer, sr, recipe.duration + (recipe.loop ? recipe.loop_crossfade ?? 0.25 : 0), i, baseDir);
    for (let c = 0; c < nch; c++) {
      const g = nch === 1 ? 1 : c === 0 ? Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2 : Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
      const d = out.channels[c];
      for (let k = 0; k < buf.length && k + offset < d.length; k++) d[k + offset] += buf[k] * g;
    }
  });
  for (let c = 0; c < nch; c++) {
    let ch = applyEffects(out.channels[c], sr, recipe.effects || []);
    if (recipe.loop) ch = makeLoopable(ch, sr, { crossfade: recipe.loop_crossfade ?? 0.25 });
    out.channels[c] = ch;
  }
  return normalizeAudio(out, recipe.normalize || { lufs: -16 });
}
function normalizeAudio(audio, { lufs = null, peak = null } = {}) {
  let gain = 1;
  if (lufs != null) {
    const cur = integratedLoudness(audio);
    if (Number.isFinite(cur)) gain = dbToGain(lufs - cur);
  } else if (peak != null) {
    let pk = 0;
    for (const c of audio.channels) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
    if (pk > 0) gain = dbToGain(peak) / pk;
  }
  for (const c of audio.channels) for (let i = 0; i < c.length; i++) c[i] *= gain;
  for (const c of audio.channels) limit(c, audio.sampleRate, { ceiling: -1 });
  return audio;
}
var RECIPE_PRESETS = {
  button: { duration: 0.18, layers: [{ type: "click", freq: 3200, decay: 4e-3, gain: -6 }, { type: "click", start: 0.06, freq: 1800, decay: 8e-3, gain: -10 }], effects: [{ type: "reverb", room: 0.2, mix: 0.08 }], normalize: { lufs: -18 } },
  relay: { duration: 0.25, layers: [{ type: "click", freq: 1400, decay: 0.01, gain: -4 }, { type: "impact", freq: 300, decay: 0.05, noise: 0.8, gain: -12 }, { type: "osc", wave: "square", freq: 50, start: 0.01, duration: 0.12, gain: -24, envelope: { attack: 2e-3, release: 0.05 } }], effects: [{ type: "reverb", room: 0.3, mix: 0.12 }], normalize: { lufs: -17 } },
  hydraulic: { duration: 1.6, layers: [{ type: "noise", color: "white", gain: -6, envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.6 }, filter: { type: "bandpass", freq: { from: 5e3, to: 1800, curve: "exp" }, q: 0.8 } }, { type: "noise", color: "brown", gain: -14, envelope: { attack: 0.1, release: 0.5 }, filter: { type: "lowpass", freq: 300 } }], effects: [{ type: "reverb", room: 0.5, mix: 0.2 }], normalize: { lufs: -17 } },
  engine_loop: { duration: 4, loop: true, layers: [{ type: "osc", wave: "saw", freq: { center: 55, depth: 1.5, rate: 0.3 }, harmonics: [1, 0.5, 0.33, 0.25], gain: -6, filter: { type: "lowpass", freq: 600 } }, { type: "noise", color: "brown", gain: -16, filter: { type: "bandpass", freq: 120, q: 1.5 } }, { type: "osc", wave: "sine", freq: 220, gain: -26, effects: [{ type: "tremolo", rate: 13.75, depth: 0.6 }] }], effects: [{ type: "compress", threshold: -16, ratio: 3 }], normalize: { lufs: -20 } },
  siren: { duration: 4, loop: true, layers: [{ name: "fundamental", type: "osc", wave: "saw", freq: { center: 720, depth: 260, rate: 0.5, shape: "triangle" }, harmonics: [1, 0.45, 0.2], gain: -6, filter: { type: "lowpass", freq: 3500 } }, { name: "motor", type: "noise", color: "brown", gain: -20, filter: { type: "bandpass", freq: 160, q: 2 } }], effects: [{ type: "distortion", amount: 0.12 }, { type: "pa_speaker", mix: 0.18 }], normalize: { lufs: -15 } },
  alarm_beep: { duration: 1, loop: true, layers: [{ type: "osc", wave: "square", freq: 1046, duration: 0.25, gain: -8, envelope: { attack: 3e-3, release: 0.02 }, filter: { type: "lowpass", freq: 4e3 } }, { type: "osc", wave: "square", freq: 784, start: 0.5, duration: 0.25, gain: -8, envelope: { attack: 3e-3, release: 0.02 }, filter: { type: "lowpass", freq: 4e3 } }], effects: [{ type: "reverb", room: 0.6, mix: 0.2 }], normalize: { lufs: -16 } },
  power_up: { duration: 2.4, layers: [{ type: "osc", wave: "saw", freq: { from: 40, to: 180, curve: "exp" }, harmonics: [1, 0.5, 0.3], gain: -6, envelope: { attack: 0.3, release: 0.4 }, filter: { type: "lowpass", freq: { from: 200, to: 2400, curve: "exp" } } }, { type: "noise", color: "pink", gain: -18, envelope: { attack: 1.5, release: 0.5 }, filter: { type: "highpass", freq: 3e3 } }], effects: [{ type: "reverb", room: 0.6, mix: 0.2 }], normalize: { lufs: -16 } },
  power_down: { duration: 2.6, layers: [{ type: "osc", wave: "saw", freq: { from: 180, to: 30, curve: "exp" }, harmonics: [1, 0.5, 0.3], gain: -6, envelope: { attack: 0.01, release: 1.2 }, filter: { type: "lowpass", freq: { from: 2400, to: 150, curve: "exp" } } }], effects: [{ type: "reverb", room: 0.6, mix: 0.25 }], normalize: { lufs: -17 } },
  explosion: { duration: 3, layers: [{ type: "impact", freq: 60, drop: 0.4, decay: 0.9, noise: 1, gain: -3 }, { type: "noise", color: "brown", gain: -8, envelope: { attack: 5e-3, decay: 1.5, sustain: 0, release: 1 }, filter: { type: "lowpass", freq: { from: 4e3, to: 200, curve: "exp" } } }], effects: [{ type: "distortion", amount: 0.25 }, { type: "reverb", room: 0.85, mix: 0.3 }], normalize: { lufs: -12 } },
  ui_confirm: { duration: 0.35, layers: [{ type: "osc", wave: "triangle", freq: 880, duration: 0.12, gain: -6, envelope: { attack: 2e-3, release: 0.08 } }, { type: "osc", wave: "triangle", freq: 1320, start: 0.09, duration: 0.2, gain: -6, envelope: { attack: 2e-3, release: 0.15 } }], effects: [{ type: "reverb", room: 0.3, mix: 0.15 }], normalize: { lufs: -18 } },
  ambience_hum: { duration: 8, loop: true, layers: [{ type: "osc", wave: "sine", freq: 50, harmonics: [1, 0.3, 0.15, 0.1], gain: -8 }, { type: "noise", color: "pink", gain: -26, filter: { type: "lowpass", freq: { center: 900, depth: 300, rate: 0.07 } } }], normalize: { lufs: -26 } },
  growl: { duration: 1.8, layers: [{ type: "osc", wave: "saw", freq: { from: 95, to: 70 }, harmonics: [1, 0.6, 0.4, 0.3], gain: -6, envelope: { attack: 0.15, release: 0.5 }, filter: { type: "bandpass", freq: { center: 600, depth: 250, rate: 7 }, q: 1.5 }, effects: [{ type: "tremolo", rate: 23, depth: 0.5 }] }, { type: "noise", color: "pink", gain: -16, envelope: { attack: 0.2, release: 0.6 }, filter: { type: "bandpass", freq: 900, q: 1 } }], effects: [{ type: "distortion", amount: 0.3 }, { type: "reverb", room: 0.4, mix: 0.15 }], normalize: { lufs: -15 } }
};

// src/lib/audio/music.js
var INSTRUMENTS = ["pad", "strings", "bass", "pluck", "bell", "choir", "lead", "drone", "brass", "drums", "pulse", "sub"];
function parseSequence(text) {
  if (typeof text !== "string") throw new StudioError("E_SCORE", "Melodic parts must be strings");
  const tokens = text.match(/\[[^\]]*\](?::[\d./]+)?(?:@[\d.]+)?|[^\s|]+/g) || [];
  let beat = 0;
  const events = [];
  for (const tok of tokens) {
    const m = tok.match(/^(\[[^\]]*\]|[^:@]+)(?::([\d./]+))?(?:@([\d.]+))?$/);
    if (!m) throw new StudioError("E_SCORE", `Cannot parse token "${tok}"`);
    const len = m[2] ? m[2].includes("/") ? Number(m[2].split("/")[0]) / Number(m[2].split("/")[1]) : Number(m[2]) : 1;
    if (!(len > 0)) throw new StudioError("E_SCORE", `Invalid length in "${tok}"`);
    const vel = m[3] ? Number(m[3]) : 0.8;
    const body = m[1];
    if (body !== "r") {
      const notes = body.startsWith("[") ? body.slice(1, -1).trim().split(/\s+/) : [body];
      for (const n of notes) events.push({ beat, beats: len, midi: noteToMidi(n), vel });
    }
    beat += len;
  }
  return { events, beats: beat };
}
function renderNote(instrument, freq, dur, vel, sr, opts = {}, seed = 1) {
  const spec = {
    pad: { attack: 0.8, release: 1.6 },
    strings: { attack: 0.35, release: 0.8 },
    bass: { attack: 8e-3, release: 0.12 },
    pluck: { attack: 2e-3, release: 0.3 },
    bell: { attack: 2e-3, release: 2.5 },
    choir: { attack: 0.35, release: 0.9 },
    lead: { attack: 0.02, release: 0.25 },
    drone: { attack: 1.5, release: 2.5 },
    brass: { attack: 0.06, release: 0.3 },
    pulse: { attack: 5e-3, release: 0.08 },
    sub: { attack: 0.01, release: 0.2 }
  }[instrument];
  if (!spec) throw new StudioError("E_SCORE", `Unknown instrument ${instrument}. Available: ${INSTRUMENTS.join(", ")}`);
  const total = dur + spec.release;
  const n = Math.round(total * sr);
  const out = new Float32Array(n);
  const env = envelopeFn({ attack: spec.attack, decay: 0.2, sustain: instrument === "pluck" || instrument === "bell" ? 0 : 0.85, release: spec.release, curve: "linear" }, total);
  const r = rng(seed);
  switch (instrument) {
    case "pad":
    case "strings":
    case "drone": {
      const voices = instrument === "strings" ? 5 : 3;
      const phases = Array.from({ length: voices }, () => Math.abs(r()));
      const lp = new Biquad("lowpass", sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 64 === 0) lp.set((instrument === "drone" ? 500 : instrument === "pad" ? 1100 : 2600) + 300 * Math.sin(2 * Math.PI * 0.15 * t), 0.8);
        let s = 0;
        for (let v = 0; v < voices; v++) {
          const det = 2 ** ((v - (voices - 1) / 2) * (instrument === "strings" ? 7 : 9) / 1200);
          phases[v] += freq * det * (1 + 2e-3 * Math.sin(2 * Math.PI * 5 * t)) / sr;
          s += oscillator("saw", phases[v]);
        }
        if (instrument === "drone") s += 2 * Math.sin(2 * Math.PI * freq * 0.5 * t);
        out[i] = lp.process(s / voices) * env(t);
      }
      break;
    }
    case "bass":
    case "sub": {
      const lp = new Biquad("lowpass", sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 32 === 0) lp.set(instrument === "sub" ? 180 : 220 + 900 * Math.exp(-t * 8), 1.1);
        ph += freq / sr;
        const s = instrument === "sub" ? Math.sin(2 * Math.PI * ph) : oscillator("square", ph) * 0.6 + Math.sin(2 * Math.PI * ph * 0.5) * 0.6;
        out[i] = lp.process(s) * env(t);
      }
      break;
    }
    case "pluck": {
      const period = Math.max(2, Math.round(sr / freq));
      const line = new Float32Array(period).map(() => r());
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const next = (idx + 1) % period;
        const v = line[idx];
        line[idx] = 0.996 * 0.5 * (line[idx] + line[next]);
        idx = next;
        out[i] = v * (i / sr < dur + 0.02 ? 1 : Math.exp(-(i / sr - dur) * 20));
      }
      break;
    }
    case "bell": {
      let pc = 0, pm = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        pm += freq * 3.5 / sr;
        pc += freq / sr;
        out[i] = Math.sin(2 * Math.PI * pc + Math.sin(2 * Math.PI * pm) * 4 * Math.exp(-t * 2.5)) * Math.exp(-t * 1.6);
      }
      break;
    }
    case "choir": {
      const vowel = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480], i: [270, 2290, 3010] }[opts.vowel || "a"] || [730, 1090, 2440];
      const bands = vowel.map((f, k) => {
        const b = new Biquad("bandpass", sr);
        b.set(f, k === 0 ? 6 : 9);
        return b;
      });
      const phases = [0, 0.33, 0.66];
      const gen = noiseGen("white", seed);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const vib = 1 + 6e-3 * Math.sin(2 * Math.PI * (5 + seed % 3 * 0.3) * t) * Math.min(1, t * 2);
        let src = 0;
        phases.forEach((p, v) => {
          phases[v] += freq * vib * 2 ** ((v - 1) * 6 / 1200) / sr;
          src += oscillator("saw", phases[v]);
        });
        src = src / 3 + gen() * 0.04;
        out[i] = (bands[0].process(src) * 1 + bands[1].process(src) * 0.6 + bands[2].process(src) * 0.3) * 3 * env(t);
      }
      break;
    }
    case "lead":
    case "pulse":
    case "brass": {
      const lp = new Biquad("lowpass", sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 32 === 0) lp.set(instrument === "brass" ? 600 + 2400 * Math.min(1, t / 0.12) * Math.exp(-t * 1.5) + 600 : instrument === "pulse" ? 2600 : 3200, 0.9);
        ph += freq * (instrument === "lead" ? 1 + 4e-3 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3) : 1) / sr;
        const s = instrument === "brass" ? oscillator("saw", ph) : oscillator(instrument === "pulse" ? "pulse25" : "square", ph) * 0.7;
        out[i] = lp.process(s) * env(t);
      }
      break;
    }
    default:
      break;
  }
  for (let i = 0; i < n; i++) out[i] *= vel;
  return out;
}
function renderDrum(kind, sr, vel, seed) {
  const gen = noiseGen("white", seed);
  const dur = { kick: 0.45, snare: 0.3, hat: 0.07, openhat: 0.35, tom: 0.4, clap: 0.25, impact: 1.6 }[kind];
  if (!dur) throw new StudioError("E_SCORE", `Unknown drum ${kind}. Use kick, snare, hat, openhat, tom, clap, impact`);
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const hp = new Biquad("highpass", sr);
  hp.set(kind === "hat" || kind === "openhat" ? 7e3 : 1200, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    if (kind === "kick") {
      ph += (45 + 110 * Math.exp(-t * 30)) / sr;
      s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7);
    } else if (kind === "tom") {
      ph += (90 + 60 * Math.exp(-t * 15)) / sr;
      s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 8);
    } else if (kind === "impact") {
      ph += (38 + 70 * Math.exp(-t * 6)) / sr;
      s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2) + gen() * 0.4 * Math.exp(-t * 6);
    } else if (kind === "snare") {
      ph += 185 / sr;
      s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 25) * 0.6 + hp.process(gen()) * Math.exp(-t * 14);
    } else if (kind === "clap") {
      s = hp.process(gen()) * (Math.exp(-(t % 0.012 * 300)) * (t < 0.036 ? 1 : 0) + Math.exp(-t * 18) * 0.6);
    } else {
      s = hp.process(gen()) * Math.exp(-t * (kind === "hat" ? 60 : 9));
    }
    out[i] = s * vel;
  }
  return out;
}
function addAt(dst, src, offset, gain) {
  for (let i = 0; i < src.length; i++) {
    const k = i + offset;
    if (k >= 0 && k < dst.length) dst[k] += src[i] * gain;
  }
}
function validateScore(score) {
  const problems = [];
  if (!(score.bpm >= 30 && score.bpm <= 300)) problems.push("bpm must be 30..300");
  if (!Array.isArray(score.sections) || !score.sections.length) problems.push("sections are required");
  if (!Array.isArray(score.stems) || !score.stems.length) problems.push("stems are required");
  const names = new Set((score.sections || []).map((s) => s.name));
  if ((score.sections || []).filter((s) => s.loop).length > 1) problems.push("only one loop section per cue (create separate cues per music state)");
  for (const st of score.stems || []) {
    if (!INSTRUMENTS.includes(st.instrument)) problems.push(`stem ${st.name}: unknown instrument ${st.instrument}`);
    for (const sec of Object.keys(st.parts || {})) if (!names.has(sec)) problems.push(`stem ${st.name}: part for unknown section ${sec}`);
  }
  return problems;
}
function timing(score) {
  const meter = score.meter || [4, 4];
  const beatSec = 60 / score.bpm;
  const barBeats = meter[0] * (4 / meter[1]);
  const barSec = barBeats * beatSec;
  let bar = 0;
  const sections = score.sections.map((s) => {
    const sec = { name: s.name, bars: s.bars, loop: !!s.loop, start_bar: bar, start_s: Number((bar * barSec).toFixed(6)), end_s: Number(((bar + s.bars) * barSec).toFixed(6)), duration_s: Number((s.bars * barSec).toFixed(6)) };
    bar += s.bars;
    return sec;
  });
  return { meter, beatSec, barBeats, barSec, sections, totalBars: bar };
}
function renderSection(score, sectionName, { stems = null, sampleRate = 48e3 } = {}) {
  const tm = timing(score);
  const sec = tm.sections.find((s) => s.name === sectionName);
  if (!sec) throw new StudioError("E_SCORE", `Unknown section ${sectionName}`);
  const tail = 3;
  const len = Math.round(sec.duration_s * sampleRate);
  const buf = makeAudio(sampleRate, sec.duration_s + tail, 2);
  const chosen = score.stems.filter((s) => !stems || stems.includes(s.name));
  chosen.forEach((stem, si) => {
    const part = stem.parts?.[sectionName];
    if (!part) return;
    const mono = new Float32Array(buf.channels[0].length);
    const sectionBeats = sec.bars * tm.barBeats;
    if (stem.instrument === "drums") {
      const steps = 4;
      for (const [drum, pattern] of Object.entries(part)) {
        const p = pattern.replace(/\s|\|/g, "");
        const total = Math.round(sectionBeats * steps);
        for (let k = 0; k < total; k++) {
          const ch = p[k % p.length];
          if (ch === "." || ch === "-") continue;
          const vel = ch === "X" ? 1 : ch === "o" ? 0.45 : 0.75;
          addAt(mono, renderDrum(drum, sampleRate, vel, si * 977 + k), Math.round(k / steps * tm.beatSec * sampleRate), 1);
        }
      }
    } else {
      const { events, beats } = parseSequence(typeof part === "string" ? part : part.notes);
      const repeat = stem.repeat !== false && beats > 0 && beats < sectionBeats;
      for (let rep = 0; rep * beats < sectionBeats && (rep === 0 || repeat); rep++) {
        for (const ev of events) {
          const b = ev.beat + rep * beats;
          if (b >= sectionBeats) continue;
          const dur = Math.min(ev.beats, sectionBeats - b) * tm.beatSec * (stem.legato ?? 0.98);
          const note = renderNote(stem.instrument, midiToFreq(ev.midi + (stem.transpose || 0)), dur, ev.vel, sampleRate, { vowel: stem.vowel }, ev.midi * 31 + rep);
          addAt(mono, note, Math.round(b * tm.beatSec * sampleRate), 1);
        }
      }
    }
    let processed = applyEffects(mono, sampleRate, stem.effects || []);
    const g = dbToGain(stem.gain ?? -10);
    const pan = stem.pan || 0;
    const gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    for (let i = 0; i < processed.length && i < buf.channels[0].length; i++) {
      buf.channels[0][i] += processed[i] * g * gl;
      buf.channels[1][i] += processed[i] * g * gr;
    }
  });
  for (let c = 0; c < 2; c++) {
    const ch = buf.channels[c];
    if (sec.loop) {
      for (let i = len; i < ch.length; i++) ch[i - len] += ch[i];
      buf.channels[c] = ch.slice(0, len);
    } else {
      const keep = sectionName === "outro" || sectionName.startsWith("stinger") ? ch.length : len + Math.round(0.5 * sampleRate);
      const out = ch.slice(0, keep);
      const f = Math.round(0.4 * sampleRate);
      for (let i = 0; i < f && i < out.length; i++) out[out.length - 1 - i] *= i / f;
      buf.channels[c] = out;
    }
  }
  return { audio: buf, section: sec };
}
function renderScore(score, { sampleRate = 48e3, lufs = -20 } = {}) {
  const problems = validateScore(score);
  if (problems.length) throw new StudioError("E_SCORE", `Invalid score: ${problems.join("; ")}`);
  const tm = timing(score);
  const outputs = [];
  for (const sec of tm.sections) {
    const { audio } = renderSection(score, sec.name, { sampleRate });
    outputs.push({ kind: "section", section: sec.name, audio });
  }
  const loopSec = tm.sections.find((s) => s.loop);
  if (loopSec && score.stems.length > 1) {
    for (const stem of score.stems) {
      if (!stem.parts?.[loopSec.name]) continue;
      const { audio } = renderSection(score, loopSec.name, { stems: [stem.name], sampleRate });
      outputs.push({ kind: "stem", section: loopSec.name, stem: stem.name, audio });
    }
  }
  const ref = outputs.find((o) => o.kind === "section" && o.section === (loopSec?.name || tm.sections[0].name));
  const measured = integratedLoudness(ref.audio);
  const gain = Number.isFinite(measured) ? dbToGain(lufs - measured) : 1;
  for (const o of outputs) {
    for (const c of o.audio.channels) {
      for (let i = 0; i < c.length; i++) c[i] *= gain;
      limit(c, sampleRate, { ceiling: -1 });
    }
  }
  const every = score.transition_every_bars || 1;
  const metadata = {
    title: score.title,
    state: score.state || null,
    bpm: score.bpm,
    meter: tm.meter,
    key: score.key || null,
    sample_rate: sampleRate,
    beat_seconds: Number(tm.beatSec.toFixed(6)),
    bar_seconds: Number(tm.barSec.toFixed(6)),
    sections: tm.sections,
    loop: loopSec ? { section: loopSec.name, bars: loopSec.bars, duration_s: loopSec.duration_s, samples: Math.round(loopSec.duration_s * sampleRate), ticks: Math.round(loopSec.duration_s * 20) } : null,
    transition_points_s: loopSec ? Array.from({ length: Math.floor(loopSec.bars / every) + 1 }, (_, k) => Number((k * every * tm.barSec).toFixed(4))) : [],
    transition_every_bars: every,
    stems: score.stems.map((s) => ({ name: s.name, instrument: s.instrument, gain: s.gain ?? -10 }))
  };
  return { outputs, metadata };
}

// src/lib/audio/voice.js
function voiceProfilePath(studio, id) {
  return studio.p("voices", `${assertId(id, "voice id")}.json`);
}
function saveVoiceProfile(studio, profile) {
  if (!profile.id) throw new StudioError("E_VOICE", "Voice profile needs an id");
  const full = {
    id: profile.id,
    name: profile.name || profile.id,
    language: profile.language || "en",
    character: profile.character || [],
    pace: profile.pace ?? 1,
    pitch_semitones: profile.pitch_semitones ?? 0,
    direction: profile.direction || "",
    providers: profile.providers || {},
    processing: profile.processing || [{ type: "compress", threshold: -20, ratio: 3 }],
    loudness_lufs: profile.loudness_lufs ?? -18,
    notes: profile.notes || ""
  };
  writeJson(voiceProfilePath(studio, profile.id), full);
  studio.log({ agent: "voice-director", event: "voice.profile", message: `Saved voice profile ${full.id}` });
  return full;
}
function loadVoiceProfile(studio, id) {
  const f = voiceProfilePath(studio, id);
  if (!exists(f)) throw new StudioError("E_NOT_FOUND", `Voice profile ${id} not found. Create it with studio_voice_profile_save.`);
  return readJson(f);
}
function pronunciationPath(studio) {
  return studio.p("voices", "pronunciation.json");
}
function loadPronunciation(studio) {
  return readJson(pronunciationPath(studio), { entries: [] });
}
function addPronunciation(studio, entry) {
  if (!entry.term) throw new StudioError("E_VOICE", "Pronunciation entry needs term");
  const dict = loadPronunciation(studio);
  dict.entries = dict.entries.filter((e) => e.term.toLowerCase() !== entry.term.toLowerCase());
  dict.entries.push(entry);
  writeJson(pronunciationPath(studio), dict);
  return dict;
}
var VOWELS = "\u0430\u0435\u0451\u0438\u043E\u0443\u044B\u044D\u044E\u044Faeiouy";
function stressToAcute(word) {
  let out = "";
  for (const ch of word) {
    if (VOWELS.includes(ch.toLowerCase()) && ch !== ch.toLowerCase()) out += `${ch.toLowerCase()}\u0301`;
    else out += ch;
  }
  return out;
}
var RU_ONES = ["\u043D\u043E\u043B\u044C", "\u043E\u0434\u0438\u043D", "\u0434\u0432\u0430", "\u0442\u0440\u0438", "\u0447\u0435\u0442\u044B\u0440\u0435", "\u043F\u044F\u0442\u044C", "\u0448\u0435\u0441\u0442\u044C", "\u0441\u0435\u043C\u044C", "\u0432\u043E\u0441\u0435\u043C\u044C", "\u0434\u0435\u0432\u044F\u0442\u044C", "\u0434\u0435\u0441\u044F\u0442\u044C", "\u043E\u0434\u0438\u043D\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0442\u0440\u0438\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0447\u0435\u0442\u044B\u0440\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u043F\u044F\u0442\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0448\u0435\u0441\u0442\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0441\u0435\u043C\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0432\u043E\u0441\u0435\u043C\u043D\u0430\u0434\u0446\u0430\u0442\u044C", "\u0434\u0435\u0432\u044F\u0442\u043D\u0430\u0434\u0446\u0430\u0442\u044C"];
var RU_TENS = ["", "", "\u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044C", "\u0442\u0440\u0438\u0434\u0446\u0430\u0442\u044C", "\u0441\u043E\u0440\u043E\u043A", "\u043F\u044F\u0442\u044C\u0434\u0435\u0441\u044F\u0442", "\u0448\u0435\u0441\u0442\u044C\u0434\u0435\u0441\u044F\u0442", "\u0441\u0435\u043C\u044C\u0434\u0435\u0441\u044F\u0442", "\u0432\u043E\u0441\u0435\u043C\u044C\u0434\u0435\u0441\u044F\u0442", "\u0434\u0435\u0432\u044F\u043D\u043E\u0441\u0442\u043E"];
var RU_HUNDREDS = ["", "\u0441\u0442\u043E", "\u0434\u0432\u0435\u0441\u0442\u0438", "\u0442\u0440\u0438\u0441\u0442\u0430", "\u0447\u0435\u0442\u044B\u0440\u0435\u0441\u0442\u0430", "\u043F\u044F\u0442\u044C\u0441\u043E\u0442", "\u0448\u0435\u0441\u0442\u044C\u0441\u043E\u0442", "\u0441\u0435\u043C\u044C\u0441\u043E\u0442", "\u0432\u043E\u0441\u0435\u043C\u044C\u0441\u043E\u0442", "\u0434\u0435\u0432\u044F\u0442\u044C\u0441\u043E\u0442"];
function ruNumber(n) {
  if (n < 0 || n > 999999 || !Number.isInteger(n)) return String(n);
  if (n < 20) return RU_ONES[n];
  if (n < 100) return `${RU_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${RU_ONES[n % 10]}` : ""}`;
  if (n < 1e3) return `${RU_HUNDREDS[Math.floor(n / 100)]}${n % 100 ? ` ${ruNumber(n % 100)}` : ""}`;
  const th = Math.floor(n / 1e3), rest = n % 1e3;
  const thWord = th % 10 === 1 && th % 100 !== 11 ? "\u0442\u044B\u0441\u044F\u0447\u0430" : [2, 3, 4].includes(th % 10) && ![12, 13, 14].includes(th % 100) ? "\u0442\u044B\u0441\u044F\u0447\u0438" : "\u0442\u044B\u0441\u044F\u0447";
  const thNum = ruNumber(th).replace(/один$/, "\u043E\u0434\u043D\u0430").replace(/два$/, "\u0434\u0432\u0435");
  return `${thNum} ${thWord}${rest ? ` ${ruNumber(rest)}` : ""}`;
}
function prepareText(studio, text, { language = "en", provider = "elevenlabs" } = {}) {
  const dict = loadPronunciation(studio);
  const changes = [];
  let out = text;
  for (const e of dict.entries) {
    if (e.language && e.language !== language) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${e.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    const replacement = e.say ? e.say : e.stress ? provider === "elevenlabs" ? stressToAcute(e.stress) : e.stress.toLowerCase() : null;
    if (replacement && re.test(out)) {
      out = out.replace(re, (m) => m[0] !== m[0].toLowerCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement);
      changes.push({ term: e.term, as: replacement });
    }
  }
  if (language === "ru") out = out.replace(/\d+/g, (m) => {
    const w = ruNumber(Number(m));
    if (w !== m) changes.push({ term: m, as: w });
    return w;
  });
  return { text: out, changes };
}

// src/mcp/studio-audio.js
var server = createServer("studio-audio", "Minecraft Studio audio. Design SFX as layered recipes (reproducible), music as scores with intro/loop/outro sections, stems, BPM/key/bar metadata and transition points, voice lines from persistent voice profiles with a pronunciation dictionary. Always audit (audio_audit) before QA approval; positional sounds must be mono Ogg Vorbis. Paid providers (ElevenLabs) require confirm_cost=true after the user agreed to spend credits.");
function masterExt(studio) {
  const want = studio.isInitialized() ? studio.config().audio.master_format : "flac";
  return want === "flac" && findFfmpeg() ? "flac" : "wav";
}
function masterTarget(studio, output) {
  return /\.(wav|flac)$/i.test(output) ? output.replace(/\.(wav|flac)$/i, `.${masterExt(studio)}`) : `${output.replace(/\.(ogg|mp3)$/i, "")}.${masterExt(studio)}`;
}
function writeMaster(abs, audio) {
  if (/\.flac$/i.test(abs)) {
    const tmp = `${abs}.${process.pid}.tmp.wav`;
    writeWav(tmp, audio);
    try {
      convertFile(tmp, abs);
    } finally {
      fs2.rmSync(tmp, { force: true });
    }
  } else writeWav(abs, audio);
  return abs;
}
function writeOutputs(studio, audio, output, { ogg = null, mono = false } = {}) {
  const files = [];
  const master = masterTarget(studio, output);
  const a = mono ? toMono(audio) : audio;
  writeMaster(studio.abs(master), a);
  files.push(master);
  if (ogg) {
    encodeOgg(a, studio.abs(ogg));
    files.push(ogg);
  }
  return files;
}
function costGate(studio, provider, a, estimate) {
  if (!a.confirm_cost) {
    throw new StudioError("E_COST", `${provider} is a paid provider (${estimate.note || "uses credits"}). Ask the user to confirm, then call again with confirm_cost=true. Prefer local providers or editing existing assets when possible.`);
  }
  const used = studio.isInitialized() ? studio.usage().entries.filter((e) => e.asset === a.asset?.id).length : 0;
  const max = studio.isInitialized() ? studio.config().costs.max_generations_per_asset : 6;
  if (used >= max) throw new StudioError("E_COST", `Generation limit for asset ${a.asset?.id} reached (${used}/${max}). Improve the existing result locally (audio_process) or raise costs.max_generations_per_asset with the user's consent.`);
}
tool(
  server,
  "audio_sfx_presets",
  { title: "SFX recipe presets", capability: "read", description: "Starting recipes (button, relay, hydraulic, engine_loop, siren, alarm_beep, power_up, power_down, explosion, ui_confirm, ambience_hum, growl) and the recipe format reference." },
  async () => ({
    presets: RECIPE_PRESETS,
    format: { layer_types: ["osc (wave sine|square|saw|triangle|pulse25, freq const|{from,to,curve}|{center,depth,rate,shape}, harmonics[], voices, detune)", "noise (color white|pink|brown)", "fm (carrier, ratio, index)", "chirp", "click (freq, decay)", "impact (freq, drop, decay, noise)", "sample (file, rate)"], layer_fields: ["start", "duration", "gain (dB)", "envelope {attack,decay,sustain,release}", "filter {type,freq,q}", "filters[]", "effects[]", "pan"], effects: ["lowpass", "highpass", "bandpass", "notch", "eq{bands}", "reverb{room,damp,mix,predelay}", "compress", "limit", "distortion{amount}", "bitcrush", "tremolo", "gain", "fade", "radio", "pa_speaker", "delay", "loop"], top_level: ["duration", "sample_rate", "channels", "layers", "effects", "normalize {lufs|peak}", "loop", "loop_crossfade", "tail"] }
  })
);
tool(server, "audio_sfx_render", {
  title: "Render SFX recipe",
  capability: "write",
  description: "Render a layered SFX recipe (or a preset name with overrides) locally to WAV (+ Ogg Vorbis when ogg_output is given). Saves the recipe as reproducible source, audits the result and optionally registers the asset.",
  input: {
    recipe: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    preset: external_exports.string().optional(),
    overrides: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    output: external_exports.string().describe("Project-relative WAV master path, e.g. audio/sfx/reactor_button.wav"),
    ogg_output: external_exports.string().optional().describe("Project-relative Ogg path in the resource pack, e.g. resourcepack/assets/ns/sounds/reactor/button.ogg"),
    asset: assetInput
  }
}, async (a, { studio }) => {
  requireOneOf(a, ["recipe", "preset"]);
  let recipe = a.recipe;
  if (!recipe) {
    if (!RECIPE_PRESETS[a.preset]) throw new StudioError("E_INPUT", `Unknown preset ${a.preset}`);
    recipe = { ...structuredClone(RECIPE_PRESETS[a.preset]), ...a.overrides || {} };
  }
  const audio = renderRecipe(recipe, { baseDir: studio.root });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output, mono: (recipe.channels || 1) === 1 });
  const audit = auditAudioFile(studio.abs(a.ogg_output || files[0]), { role: recipe.loop && /ambi|hum/.test(a.output) ? "ambience" : "sfx", loop: !!recipe.loop, targetLufs: recipe.normalize?.lufs });
  let src = null;
  if (a.asset) {
    const sf = studio.p("sources", a.asset.id, "recipe.json");
    writeJson(sf, recipe);
    src = studio.rel(sf);
  }
  const reg = registerOutput(studio, a.asset, { type: "sfx", files, source: { provider: "local-synth", preset: a.preset || null, source_files: src ? [src] : [] }, metadata: { duration: audit.analysis.duration, lufs: audit.analysis.lufs, loop: !!recipe.loop, waveform: audit.waveform } });
  return { files, audit: { verdict: audit.verdict, checks: audit.checks, analysis: audit.analysis }, asset: reg };
});
tool(server, "audio_sfx_generate_ai", {
  title: "Generate SFX with ElevenLabs",
  capability: "publish",
  description: "Text-to-sound-effect via ElevenLabs (paid). Requires confirm_cost=true after user consent. Output is converted to WAV (+ optional Ogg), audited, usage recorded.",
  input: { prompt: external_exports.string().describe("English description of the sound"), duration_seconds: external_exports.number().min(0.5).max(30).optional(), loop: external_exports.boolean().optional(), prompt_influence: external_exports.number().min(0).max(1).optional(), output: external_exports.string(), ogg_output: external_exports.string().optional(), mono: external_exports.boolean().optional(), confirm_cost: external_exports.boolean().optional(), asset: assetInput }
}, async (a, { studio }) => {
  const p = resolveProvider("sfx", "elevenlabs");
  costGate(studio, "ElevenLabs SFX", a, p.estimateCost(a));
  const wav = studio.abs(`${a.output.replace(/\.(wav|flac|ogg|mp3)$/i, "")}.provider.wav`);
  const meta = await SFX_PROVIDERS.elevenlabs.generate({ prompt: a.prompt, duration_seconds: a.duration_seconds, loop: a.loop, prompt_influence: a.prompt_influence, outWav: wav });
  if (studio.isInitialized()) studio.recordUsage({ provider: "elevenlabs", operation: "sound-generation", units: 1, unit: "generation", asset: a.asset?.id || null, agent: a.asset?.agent || "sfx-designer" });
  let audio = decodeAny(wav);
  fs2.rmSync(wav, { force: true });
  if (a.mono !== false) audio = toMono(audio);
  normalizeAudio(audio, { lufs: -16 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  const audit = auditAudioFile(studio.abs(a.ogg_output || files[0]), { role: "sfx", loop: !!a.loop });
  const reg = registerOutput(studio, a.asset, { type: "sfx", files, source: { provider: "elevenlabs", prompt: a.prompt, parameters: { duration_seconds: a.duration_seconds, loop: a.loop, prompt_influence: a.prompt_influence }, ...meta } });
  return { files, audit: { verdict: audit.verdict, checks: audit.checks }, asset: reg };
});
tool(server, "audio_analyze", {
  title: "Analyze audio",
  capability: "read",
  description: "Duration, sample rate, channels, peak, RMS, integrated LUFS, clipping, leading/trailing silence, stereo width, waveform envelope and optional loop-seam check.",
  input: { path: external_exports.string(), loop: external_exports.boolean().optional(), waveform_points: external_exports.number().int().optional() }
}, async (a, { studio }) => analyzeAudio(decodeAny(studio.abs(a.path)), { loopCheck: !!a.loop, waveformPoints: a.waveform_points || 120 }));
tool(server, "audio_audit", {
  title: "Audio QA audit",
  capability: "read",
  description: "Minecraft-oriented QA: Ogg Vorbis codec, mono for positional sounds, clipping, headroom, loudness vs role target (sfx -16, music -20, voice -18, ambience -24 LUFS), leading silence, loop seam, file size.",
  input: { path: external_exports.string(), role: external_exports.enum(["sfx", "music", "voice", "ambience"]).optional(), loop: external_exports.boolean().optional(), positional: external_exports.boolean().optional(), target_lufs: external_exports.number().optional() }
}, async (a, { studio }) => {
  const r = auditAudioFile(studio.abs(a.path), { role: a.role || "sfx", loop: !!a.loop, positional: a.positional !== false, targetLufs: a.target_lufs });
  delete r.waveform;
  return r;
});
tool(server, "audio_process", {
  title: "Process audio",
  capability: "write",
  description: 'Apply a processing chain. engine "ffmpeg": loudnorm, highpass, lowpass, eq, compress, limit, reverb, distortion, radio, pa_speaker, pitch{semitones}, tempo{factor}, trim{start,end}, fade{in,out}, mono, silence_trim, resample. engine "js": the studio DSP effects (reverb, compress, limit, eq, radio, pa_speaker, loop, \u2026).',
  input: { input: external_exports.string(), output: external_exports.string(), engine: external_exports.enum(["ffmpeg", "js"]).optional(), steps: external_exports.array(external_exports.record(external_exports.string(), external_exports.any())), asset: assetInput }
}, async (a, { studio }) => {
  const engine = a.engine || (findFfmpeg() ? "ffmpeg" : "js");
  let info;
  if (engine === "ffmpeg") info = processFile(studio.abs(a.input), studio.abs(a.output), a.steps);
  else {
    const audio = decodeAny(studio.abs(a.input));
    audio.channels = audio.channels.map((c) => applyEffects(c, audio.sampleRate, a.steps));
    if (a.output.endsWith(".ogg")) encodeOgg(audio, studio.abs(a.output));
    else writeMaster(studio.abs(a.output), audio);
    info = { output: a.output };
  }
  const reg = registerOutput(studio, a.asset, { type: "sfx", files: [a.output], source: { provider: `process-${engine}`, source_files: [a.input], parameters: { steps: a.steps } } });
  return { output: a.output, engine, filter: info.filter, analysis: (({ waveform, ...rest }) => rest)(analyzeAudio(decodeAny(studio.abs(a.output)))), asset: reg };
});
tool(server, "audio_music_render", {
  title: "Render adaptive music cue",
  capability: "write",
  description: `Render a score (bpm, meter, key, sections intro/loop/outro/stinger, stems with instruments ${INSTRUMENTS.join(", ")}) into section mixes, per-stem loops and metadata (BPM, bars, loop boundaries, transition points). Writes music/source, music/stems, music/rendered, music/metadata under out_dir; optional Ogg export into the pack.`,
  input: {
    score: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    score_path: external_exports.string().optional(),
    out_dir: external_exports.string().describe("Project-relative directory, e.g. audio/music"),
    ogg_dir: external_exports.string().optional().describe("Resource-pack sounds directory for Ogg exports, e.g. resourcepack/assets/ns/sounds/music"),
    lufs: external_exports.number().optional(),
    asset: assetInput
  }
}, async (a, { studio }) => {
  requireOneOf(a, ["score", "score_path"]);
  const score = a.score || readJson(studio.abs(a.score_path));
  const problems = validateScore(score);
  if (problems.length) throw new StudioError("E_SCORE", problems.join("; "));
  const title = slugify(score.title || "cue");
  const { outputs, metadata } = renderScore(score, { lufs: a.lufs ?? -20 });
  const base = a.out_dir.replace(/\/$/, "");
  const sourceFile = `${base}/source/${title}.score.json`;
  writeJson(studio.abs(sourceFile), score);
  const files = [{ path: sourceFile, role: "source" }];
  metadata.files = { source: sourceFile, sections: {}, stems: {}, ogg: {} };
  for (const o of outputs) {
    const name = o.kind === "section" ? `${title}_${o.section}` : `${title}_${o.section}_${slugify(o.stem)}`;
    const wav = o.kind === "section" ? `${base}/rendered/${name}.${masterExt(studio)}` : `${base}/stems/${name}.${masterExt(studio)}`;
    writeMaster(studio.abs(wav), o.audio);
    files.push({ path: wav, role: o.kind });
    if (o.kind === "section") metadata.files.sections[o.section] = wav;
    else metadata.files.stems[o.stem] = wav;
    if (a.ogg_dir) {
      const ogg = `${a.ogg_dir.replace(/\/$/, "")}/${name}.ogg`;
      encodeOgg(o.audio, studio.abs(ogg));
      files.push({ path: ogg, role: "minecraft" });
      metadata.files.ogg[name] = ogg;
    }
  }
  const metaFile = `${base}/metadata/${title}.json`;
  writeJson(studio.abs(metaFile), metadata);
  files.push({ path: metaFile, role: "metadata" });
  const loopWav = metadata.files.sections[metadata.loop?.section || score.sections[0].name];
  const loopAudit = auditAudioFile(studio.abs(loopWav), { role: "music", loop: !!metadata.loop, positional: false, targetLufs: a.lufs ?? -20 });
  const reg = registerOutput(studio, a.asset, { type: "music", files, source: { provider: "local-composer", format: "minecraft-studio-score/1", source_files: [sourceFile] }, metadata: { bpm: metadata.bpm, key: metadata.key, meter: metadata.meter, state: metadata.state, loop: metadata.loop, transition_points_s: metadata.transition_points_s, stems: metadata.stems, sections: metadata.sections, waveform: loopAudit.waveform, metadata_file: metaFile } });
  return { metadata_file: metaFile, files: files.map((f) => f.path), loop: metadata.loop, transition_points_s: metadata.transition_points_s, loop_audit: { verdict: loopAudit.verdict, checks: loopAudit.checks }, asset: reg };
});
tool(server, "audio_music_generate_ai", {
  title: "Generate music with ElevenLabs",
  capability: "publish",
  description: "Prompt-based music generation via ElevenLabs (paid; plan-dependent). Requires confirm_cost=true. Use for reference/inspiration or one-off cues; adaptive cues should be scored with audio_music_render.",
  input: { prompt: external_exports.string(), music_length_ms: external_exports.number().int().min(3e3).max(6e5).optional(), force_instrumental: external_exports.boolean().optional(), output: external_exports.string(), ogg_output: external_exports.string().optional(), confirm_cost: external_exports.boolean().optional(), asset: assetInput }
}, async (a, { studio }) => {
  const p = resolveProvider("music", "elevenlabs");
  costGate(studio, "ElevenLabs music", a, p.estimateCost(a));
  const wav = studio.abs(`${a.output.replace(/\.(wav|flac|ogg|mp3)$/i, "")}.provider.wav`);
  const meta = await MUSIC_PROVIDERS.elevenlabs.generate({ prompt: a.prompt, music_length_ms: a.music_length_ms, force_instrumental: a.force_instrumental !== false, outWav: wav });
  if (studio.isInitialized()) studio.recordUsage({ provider: "elevenlabs", operation: "music", units: a.music_length_ms || 3e4, unit: "ms", asset: a.asset?.id || null, agent: "composer" });
  const audio = decodeAny(wav);
  fs2.rmSync(wav, { force: true });
  normalizeAudio(audio, { lufs: -20 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  const reg = registerOutput(studio, a.asset, { type: "music", files, source: { provider: "elevenlabs", prompt: a.prompt, ...meta } });
  return { files, asset: reg };
});
tool(server, "audio_voice_profile_save", {
  title: "Save voice profile",
  capability: "write",
  needsInit: true,
  description: "Create/update a persistent voice persona: language, character traits, pace, pitch, direction notes, provider settings (elevenlabs {voice_id, model_id, voice_settings, seed}; system {espeak_voice}), processing chain (e.g. pa_speaker, compress) and loudness.",
  input: { profile: external_exports.record(external_exports.string(), external_exports.any()) }
}, async (a, { studio }) => saveVoiceProfile(studio, a.profile));
tool(
  server,
  "audio_voice_profile_get",
  { title: "Get voice profile", capability: "read", needsInit: true, description: "Read a voice profile.", input: { id: external_exports.string() } },
  async (a, { studio }) => loadVoiceProfile(studio, a.id)
);
tool(server, "audio_pronunciation_add", {
  title: "Add pronunciation rule",
  capability: "write",
  needsInit: true,
  description: 'Project pronunciation dictionary entry: {term, say?: replacement text, stress?: word with stressed vowel UPPER-CASE (e.g. "\u0440\u0435\u0410\u043A\u0442\u043E\u0440"), language?, note?}. Applied to every voice line.',
  input: { term: external_exports.string(), say: external_exports.string().optional(), stress: external_exports.string().optional(), language: external_exports.string().optional(), note: external_exports.string().optional() }
}, async (a, { studio }) => addPronunciation(studio, a));
tool(server, "audio_pronunciation_preview", {
  title: "Preview prepared voice text",
  capability: "read",
  needsInit: true,
  description: "Show exactly what text a provider will receive after dictionary, stress and number expansion.",
  input: { text: external_exports.string(), language: external_exports.string().optional(), provider: external_exports.string().optional() }
}, async (a, { studio }) => ({ ...prepareText(studio, a.text, { language: a.language || "en", provider: a.provider || "elevenlabs" }), dictionary_size: loadPronunciation(studio).entries.length }));
tool(server, "audio_voice_line", {
  title: "Synthesize voice line",
  capability: "write",
  needsInit: true,
  description: "Synthesize a line with a voice profile (provider auto: ElevenLabs if configured \u2014 paid, needs confirm_cost=true \u2014, else system TTS, else mock), apply the profile processing chain and loudness, export WAV/Ogg and register a voice asset with the original and prepared text.",
  input: {
    line_id: external_exports.string(),
    text: external_exports.string(),
    profile: external_exports.string(),
    output: external_exports.string().describe("WAV master path"),
    ogg_output: external_exports.string().optional(),
    provider: external_exports.enum(["auto", "elevenlabs", "system", "mock"]).optional(),
    previous_text: external_exports.string().optional(),
    next_text: external_exports.string().optional(),
    confirm_cost: external_exports.boolean().optional(),
    asset: assetInput
  }
}, async (a, { studio }) => {
  const profile = loadVoiceProfile(studio, a.profile);
  const preferred = a.provider || studio.config().providers.voice || "auto";
  const p = resolveProvider("voice", preferred);
  if (p.paid) costGate(studio, `ElevenLabs TTS (${[...a.text].length} chars)`, a, p.estimateCost(a));
  const prepared = prepareText(studio, a.text, { language: profile.language, provider: p.id });
  const raw = path.join(ensureDir(studio.p("sources", `voice_${slugify(a.line_id)}`)), "raw.wav");
  const meta = await p.synthesize({ text: prepared.text, profile, outWav: raw, previousText: a.previous_text, nextText: a.next_text });
  if (p.paid) studio.recordUsage({ provider: p.id, operation: "tts", units: [...prepared.text].length, unit: "characters", asset: a.asset?.id || null, agent: "voice-director" });
  let audio = toMono(decodeAny(raw, { sampleRate: 48e3 }));
  const chain = [{ type: "trim_silence", thresholdDb: -45, pad: 0.04 }, ...profile.processing || []];
  if (profile.pitch_semitones && findFfmpeg()) {
    const tmp = `${raw}.pitched.wav`;
    processFile(raw, tmp, [{ type: "pitch", semitones: profile.pitch_semitones, sample_rate: audio.sampleRate }]);
    audio = toMono(decodeAny(tmp));
    fs2.rmSync(tmp, { force: true });
  }
  audio.channels = audio.channels.map((c) => applyEffects(c, audio.sampleRate, chain));
  normalizeAudio(audio, { lufs: profile.loudness_lufs ?? -18 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  if (masterExt(studio) === "flac") {
    const rawFlac = raw.replace(/\.wav$/, ".flac");
    convertFile(raw, rawFlac);
    fs2.rmSync(raw, { force: true });
  }
  const audit = auditAudioFile(studio.abs(a.ogg_output || files[0]), { role: "voice", targetLufs: profile.loudness_lufs ?? -18 });
  studio.log({ agent: "voice-director", event: "voice.line", asset: a.asset?.id || null, message: `Voiced "${a.line_id}" with ${profile.id} via ${p.id}` });
  const reg = registerOutput(studio, a.asset || { id: `voice.${slugify(a.line_id)}`, agent: "voice-director" }, { type: "voice", files, source: { provider: p.id, text: a.text, prepared_text: prepared.text, pronunciation_changes: prepared.changes, profile: profile.id, ...meta }, metadata: { duration: audit.analysis.duration, lufs: audit.analysis.lufs, waveform: audit.waveform, profile: profile.id, text: a.text, language: profile.language } });
  return { files, provider: p.id, prepared_text: prepared.text, pronunciation_changes: prepared.changes, duration: audit.analysis.duration, audit: { verdict: audit.verdict, checks: audit.checks }, asset: reg, note: p.id !== "elevenlabs" ? `Draft voice from ${p.id}; configure ElevenLabs for production quality.` : void 0 };
});
tool(server, "audio_export_minecraft", {
  title: "Export sound to Minecraft",
  capability: "write",
  description: "Convert to Ogg Vorbis (mono by default for positional sounds) into <pack>/assets/<ns>/sounds/<path>.ogg and add/replace the event in sounds.json (with subtitle, stream for long music). Optionally link the registry asset.",
  input: {
    input: external_exports.string(),
    pack_dir: external_exports.string(),
    namespace: external_exports.string(),
    sound_path: external_exports.string().describe("Path under sounds/ without extension, e.g. reactor/startup"),
    event: external_exports.string().describe("Sound event name, e.g. reactor.startup"),
    subtitle: external_exports.string().optional(),
    stream: external_exports.boolean().optional(),
    mono: external_exports.boolean().optional(),
    volume: external_exports.number().optional(),
    pitch: external_exports.number().optional(),
    attenuation_distance: external_exports.number().int().optional(),
    asset_id: external_exports.string().optional()
  }
}, async (a, { studio }) => {
  let audio = decodeAny(studio.abs(a.input));
  if (a.mono !== false) audio = toMono(audio);
  const ogg = `${a.pack_dir.replace(/\/$/, "")}/assets/${a.namespace}/sounds/${a.sound_path}.ogg`;
  encodeOgg(audio, studio.abs(ogg));
  const entry = { name: `${a.namespace}:${a.sound_path}`, ...a.stream ? { stream: true } : {}, ...a.volume !== void 0 ? { volume: a.volume } : {}, ...a.pitch !== void 0 ? { pitch: a.pitch } : {}, ...a.attenuation_distance ? { attenuation_distance: a.attenuation_distance } : {} };
  const ev = upsertSoundEvent(studio.abs(a.pack_dir), a.namespace, a.event, { sounds: [entry], subtitle: a.subtitle });
  if (a.asset_id && studio.isInitialized() && studio.hasAsset(a.asset_id)) {
    const asset = studio.getAsset(a.asset_id);
    const files = [...asset.files.map((f) => ({ path: f.path, role: f.role })).filter((f) => f.path !== ogg), { path: ogg, role: "minecraft" }];
    studio.updateAsset(a.asset_id, { files, minecraft_ids: [.../* @__PURE__ */ new Set([...asset.minecraft_ids || [], ev.event])] }, { by: "sfx-designer", note: "exported to Minecraft" });
  }
  return { ogg, event: ev.event, sounds_json: studio.rel(ev.file), mono: a.mono !== false };
});
await start(server);
