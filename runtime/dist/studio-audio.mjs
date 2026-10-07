import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  assetInput,
  createServer,
  external_exports,
  registerOutput,
  requireOneOf,
  start,
  tool
} from "./chunks/chunk-XQJ3QCTZ.mjs";
import {
  DEFAULT_SOUNDFONT,
  installDefaultSoundfont,
  resolveSoundfont
} from "./chunks/chunk-HC4HRIBW.mjs";
import {
  upsertSoundEvent
} from "./chunks/chunk-EK65NMG6.mjs";
import "./chunks/chunk-X2ZWGV6D.mjs";
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
} from "./chunks/chunk-HMLAGON2.mjs";
import {
  StudioError,
  assertId,
  ensureDir,
  exists,
  readJson,
  slugify,
  writeJson
} from "./chunks/chunk-RRZML6EW.mjs";

// src/mcp/studio-audio.js
import fs3 from "node:fs";
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
    const y2 = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y2;
    return y2;
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
      const y2 = c.b[c.i];
      c.f = y2 * (1 - damp) + c.f * damp;
      c.b[c.i] = inp * 0.015 + c.f * fb;
      c.i = (c.i + 1) % c.b.length;
      acc += y2;
    }
    for (const a of aps) {
      const y2 = a.b[a.i];
      a.b[a.i] = acc + y2 * 0.5;
      a.i = (a.i + 1) % a.b.length;
      acc = y2 - acc;
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
    for (let k2 = i; k2 < Math.min(buf.length, i + la); k2 += 4) peak = Math.max(peak, Math.abs(buf[k2]));
    const target = peak > c ? c / peak : 1;
    g = target < g ? target : rt * g + (1 - rt) * target;
    out[i] = Math.max(-c, Math.min(c, buf[i] * g));
  }
  buf.set(out);
  return buf;
}
function distort(buf, { amount = 0.3, mode = "tanh" } = {}) {
  const k2 = 1 + amount * 20;
  const norm = Math.tanh(k2);
  for (let i = 0; i < buf.length; i++) buf[i] = mode === "hard" ? Math.max(-1, Math.min(1, buf[i] * k2)) : Math.tanh(buf[i] * k2) / norm;
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
          harmonics.forEach((amp, h2) => {
            const k2 = v * harmonics.length + h2;
            phases[k2] += fv * (h2 + 1) / sr;
            s += amp * oscillator(layer.wave || "sine", phases[k2]);
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
        const k2 = Math.floor(p);
        buf[i] = (k2 + 1 < src.length ? src[k2] + (src[k2 + 1] - src[k2]) * (p - k2) : 0) * env(i / sr);
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
      for (let k2 = 0; k2 < buf.length && k2 + offset < d.length; k2++) d[k2 + offset] += buf[k2] * g;
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

// src/lib/audio/sampler.js
import fs2 from "node:fs";

// node_modules/stb-vorbis/dist/index.js
var y = "AGFzbQEAAAABngEYYAF/AX9gAn9/AX9gAX8AYAN/f38AYAN/f38Bf2ACf38AYAR/f39/AX9gBX9/f39/AGACfH8BfGACfHwBfGABfAF8YAR/fn9/AX9gAABgAAF/YAF+AX9gCH9/f39/f39/AX9gAX8BfWAEf39/fwBgB39/f39/f38AYAN/fn8BfmACfn8Bf2AHf3x/f39/fwF/YAJ8fwF/YAN8fH8BfAKMAQQDZW52H2Vtc2NyaXB0ZW5fbm90aWZ5X21lbW9yeV9ncm93dGgAAhZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX2Nsb3NlAAAWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhmZF93cml0ZQAGFndhc2lfc25hcHNob3RfcHJldmlldzEHZmRfc2VlawALAz08DAMDCAAAAgUAAg0JDgYAAQACAQYCDwcHAAAAAAEAARABBAoKAQIDEQUSBQUABBMGAwADFAcVBQgBCRYXBAUBcAEJCQUHAQGCAoCAAgYIAX8BQYCJBQsHnQEJBm1lbW9yeQIABm1hbGxvYwAJBGZyZWUACg12b3JiaXNfZGVjb2RlACgLdm9yYmlzX2ZyZWUAKQtfaW5pdGlhbGl6ZQAEGV9faW5kaXJlY3RfZnVuY3Rpb25fdGFibGUBABlfZW1zY3JpcHRlbl9zdGFja19yZXN0b3JlAA0cZW1zY3JpcHRlbl9zdGFja19nZXRfY3VycmVudAAOCQ4BAEEBCwgEIiQ5OjAxMgwClAEKgZEEPCwAQbyIAUGAwAA2AgBBtIgBQYCJBTYCAEGciAFBKjYCAEG4iAFBgIAENgIAC/wCAQJ/IwBBEGsiAyQAIAMgATYCDCADIAI2AgggA0GWDDYCBCADIAA2AgAjAEEQayICJAAgAiADNgIMQQAhASMAQdABayIAJAAgACADNgLMASAAQaABaiIDQQBBKPwLACAAIAAoAswBNgLIAUEAIABByAFqIABB0ABqIAMQM0EASAR/QX8FQfiCAUH4ggEoAgAiA0FfcTYCAAJ/AkACQEGogwEoAgBFBEBBqIMBQdAANgIAQZSDAUEANgIAQYiDAUIANwMAQaSDASgCACEBQaSDASAANgIADAELQYiDASgCAA0BC0F/QfiCARAIDQEaC0H4ggEgAEHIAWogAEHQAGogAEGgAWoQMwshBCABBH9B+IIBQQBBAEGcgwEoAgARBAAaQaiDAUEANgIAQaSDASABNgIAQZSDAUEANgIAQYyDASgCABpBiIMBQgA3AwBBAAUgBAsaQfiCAUH4ggEoAgAgA0EgcXI2AgBBAAsaIABB0AFqJAAgAkEQaiQAAAuHBAECfyACQYAETwRAIAIEQCAAIAEgAvwKAAALDwsgACACaiEDAkAgACABc0EDcUUEQAJAIABBA3FFBEAgACECDAELIAJFBEAgACECDAELIAAhAgNAIAIgAS0AADoAACABQQFqIQEgAkEBaiICQQNxRQ0BIAIgA0kNAAsLIANBfHEhAAJAIANBwABJDQAgAiAAQUBqIgRLDQADQCACIAEoAgA2AgAgAiABKAIENgIEIAIgASgCCDYCCCACIAEoAgw2AgwgAiABKAIQNgIQIAIgASgCFDYCFCACIAEoAhg2AhggAiABKAIcNgIcIAIgASgCIDYCICACIAEoAiQ2AiQgAiABKAIoNgIoIAIgASgCLDYCLCACIAEoAjA2AjAgAiABKAI0NgI0IAIgASgCODYCOCACIAEoAjw2AjwgAUFAayEBIAJBQGsiAiAETQ0ACwsgACACTQ0BA0AgAiABKAIANgIAIAFBBGohASACQQRqIgIgAEkNAAsMAQsgA0EESQRAIAAhAgwBCyACQQRJBEAgACECDAELIANBBGshBCAAIQIDQCACIAEtAAA6AAAgAiABLQABOgABIAIgAS0AAjoAAiACIAEtAAM6AAMgAUEEaiEBIAJBBGoiAiAETQ0ACwsgAiADSQRAA0AgAiABLQAAOgAAIAFBAWohASACQQFqIgIgA0cNAAsLC6gBAAJAIAFBgAhOBEAgAEQAAAAAAADgf6IhACABQf8PSQRAIAFB/wdrIQEMAgsgAEQAAAAAAADgf6IhAEH9FyABIAFB/RdPG0H+D2shAQwBCyABQYF4Sg0AIABEAAAAAAAAYAOiIQAgAUG4cEsEQCABQckHaiEBDAELIABEAAAAAAAAYAOiIQBB8GggASABQfBoTRtBkg9qIQELIAAgAUH/B2qtQjSGv6ILWQEBfyAAIAAoAkgiAUEBayABcjYCSCAAKAIAIgFBCHEEQCAAIAFBIHI2AgBBfw8LIABCADcCBCAAIAAoAiwiATYCHCAAIAE2AhQgACABIAAoAjBqNgIQQQALySgBC38jAEEQayIKJAACQAJAAkACQAJAAkACQAJAAkACQCAAQfQBTQRAQYyEASgCACIEQRAgAEELakH4A3EgAEELSRsiBkEDdiIAdiIBQQNxBEACQCABQX9zQQFxIABqIgNBA3QiAUG0hAFqIgAgASgCvIQBIgIoAggiBUYEQEGMhAEgBEF+IAN3cTYCAAwBCyAFIAA2AgwgACAFNgIICyACQQhqIQAgAiABQQNyNgIEIAEgAmoiASABKAIEQQFyNgIEDAsLIAZBlIQBKAIAIghNDQEgAQRAAkBBAiAAdCICQQAgAmtyIAEgAHRxaCIDQQN0IgFBtIQBaiICIAEoAryEASIAKAIIIgVGBEBBjIQBIARBfiADd3EiBDYCAAwBCyAFIAI2AgwgAiAFNgIICyAAIAZBA3I2AgQgACAGaiIHIAEgBmsiBUEBcjYCBCAAIAFqIAU2AgAgCARAIAhBeHFBtIQBaiEBQaCEASgCACECAn8gBEEBIAhBA3Z0IgNxRQRAQYyEASADIARyNgIAIAEMAQsgASgCCAshAyABIAI2AgggAyACNgIMIAIgATYCDCACIAM2AggLIABBCGohAEGghAEgBzYCAEGUhAEgBTYCAAwLC0GQhAEoAgAiC0UNASALaEECdCgCvIYBIgEoAgRBeHEgBmshAyABIQIDQAJAIAEoAhAiAEUEQCABKAIUIgBFDQELIAAoAgRBeHEgBmsiASADIAEgA0kiARshAyAAIAIgARshAiAAIQEMAQsLIAIoAhghCSACIAIoAgwiAEcEQCACKAIIIgEgADYCDCAAIAE2AggMCgsgAigCFCIBBH8gAkEUagUgAigCECIBRQ0DIAJBEGoLIQUDQCAFIQcgASIAQRRqIQUgACgCFCIBDQAgAEEQaiEFIAAoAhAiAQ0ACyAHQQA2AgAMCQtBfyEGIABBv39LDQAgAEELaiIBQXhxIQZBkIQBKAIAIgdFDQBBHyEIQQAgBmshAyAAQfT//wdNBEAgBkEmIAFBCHZnIgBrdkEBcSAAQQF0a0E+aiEICwJAAkACQCAIQQJ0KAK8hgEiAUUEQEEAIQAMAQtBACEAIAZBGSAIQQF2a0EAIAhBH0cbdCECA0ACQCABKAIEQXhxIAZrIgQgA08NACABIQUgBCIDDQBBACEDIAEhAAwDCyAAIAEoAhQiBCAEIAEgAkEddkEEcWooAhAiAUYbIAAgBBshACACQQF0IQIgAQ0ACwsgACAFckUEQEEAIQVBAiAIdCIAQQAgAGtyIAdxIgBFDQMgAGhBAnQoAryGASEACyAARQ0BCwNAIAAoAgRBeHEgBmsiAiADSSEBIAIgAyABGyEDIAAgBSABGyEFIAAoAhAiAQR/IAEFIAAoAhQLIgANAAsLIAVFDQAgA0GUhAEoAgAgBmtPDQAgBSgCGCEIIAUgBSgCDCIARwRAIAUoAggiASAANgIMIAAgATYCCAwICyAFKAIUIgEEfyAFQRRqBSAFKAIQIgFFDQMgBUEQagshAgNAIAIhBCABIgBBFGohAiAAKAIUIgENACAAQRBqIQIgACgCECIBDQALIARBADYCAAwHCyAGQZSEASgCACIFTQRAQaCEASgCACEAAkAgBSAGayIBQRBPBEAgACAGaiICIAFBAXI2AgQgACAFaiABNgIAIAAgBkEDcjYCBAwBCyAAIAVBA3I2AgQgACAFaiIBIAEoAgRBAXI2AgRBACEBQQAhAgtBlIQBIAE2AgBBoIQBIAI2AgAgAEEIaiEADAkLIAZBmIQBKAIAIgJJBEBBmIQBIAIgBmsiATYCAEGkhAFBpIQBKAIAIgAgBmoiAjYCACACIAFBAXI2AgQgACAGQQNyNgIEIABBCGohAAwJC0EAIQAgBkEvaiIDAn9B5IcBKAIABEBB7IcBKAIADAELQfCHAUJ/NwIAQeiHAUKAoICAgIAENwIAQeSHASAKQQxqQXBxQdiq1aoFczYCAEH4hwFBADYCAEHIhwFBADYCAEGAIAsiAWoiBEEAIAFrIgdxIgEgBk0NCEHEhwEoAgAiBQRAQbyHASgCACIIIAFqIgkgCE0NCSAFIAlJDQkLAkBByIcBLQAAQQRxRQRAAkACQAJAAkBBpIQBKAIAIgUEQEHMhwEhAANAIAAoAgAiCCAFTQRAIAUgCCAAKAIEakkNAwsgACgCCCIADQALC0EAEAwiAkF/Rg0DIAEhBEHohwEoAgAiAEEBayIFIAJxBEAgASACayACIAVqQQAgAGtxaiEECyAEIAZNDQNBxIcBKAIAIgAEQEG8hwEoAgAiBSAEaiIHIAVNDQQgACAHSQ0ECyAEEAwiACACRw0BDAULIAQgAmsgB3EiBBAMIgIgACgCACAAKAIEakYNASACIQALIABBf0YNASAGQTBqIARNBEAgACECDAQLQeyHASgCACICIAMgBGtqQQAgAmtxIgIQDEF/Rg0BIAIgBGohBCAAIQIMAwsgAkF/Rw0CC0HIhwFByIcBKAIAQQRyNgIACyABEAwhAkEAEAwhACACQX9GDQUgAEF/Rg0FIAAgAk0NBSAAIAJrIgQgBkEoak0NBQtBvIcBQbyHASgCACAEaiIANgIAQcCHASgCACAASQRAQcCHASAANgIACwJAQaSEASgCACIDBEBBzIcBIQADQCACIAAoAgAiASAAKAIEIgVqRg0CIAAoAggiAA0ACwwEC0GchAEoAgAiAEEAIAAgAk0bRQRAQZyEASACNgIAC0EAIQBB0IcBIAQ2AgBBzIcBIAI2AgBBrIQBQX82AgBBsIQBQeSHASgCADYCAEHYhwFBADYCAANAIABBA3QiASABQbSEAWoiBTYCvIQBIAEgBTYCwIQBIABBAWoiAEEgRw0AC0GYhAEgBEEoayIAQXggAmtBB3EiAWsiBTYCAEGkhAEgASACaiIBNgIAIAEgBUEBcjYCBCAAIAJqQSg2AgRBqIQBQfSHASgCADYCAAwECyACIANNDQIgASADSw0CIAAoAgxBCHENAiAAIAQgBWo2AgRBpIQBIANBeCADa0EHcSIAaiIBNgIAQZiEAUGYhAEoAgAgBGoiAiAAayIANgIAIAEgAEEBcjYCBCACIANqQSg2AgRBqIQBQfSHASgCADYCAAwDC0EAIQAMBgtBACEADAQLQZyEASgCACACSwRAQZyEASACNgIACyACIARqIQVBzIcBIQACQANAIAUgACgCACIBRwRAIAAoAggiAA0BDAILCyAALQAMQQhxRQ0DC0HMhwEhAANAAkAgACgCACIBIANNBEAgAyABIAAoAgRqIgVJDQELIAAoAgghAAwBCwtBmIQBIARBKGsiAEF4IAJrQQdxIgFrIgc2AgBBpIQBIAEgAmoiATYCACABIAdBAXI2AgQgACACakEoNgIEQaiEAUH0hwEoAgA2AgAgAyAFQScgBWtBB3FqQS9rIgAgACADQRBqSRsiAUEbNgIEIAFB1IcBKQIANwIQIAFBzIcBKQIANwIIQdSHASABQQhqNgIAQdCHASAENgIAQcyHASACNgIAQdiHAUEANgIAIAFBGGohAANAIABBBzYCBCAAQQhqIQIgAEEEaiEAIAIgBUkNAAsgASADRg0AIAEgASgCBEF+cTYCBCADIAEgA2siAkEBcjYCBCABIAI2AgACfyACQf8BTQRAIAJB+AFxQbSEAWohAAJ/QYyEASgCACIBQQEgAkEDdnQiAnFFBEBBjIQBIAEgAnI2AgAgAAwBCyAAKAIICyEBIAAgAzYCCCABIAM2AgxBDCECQQgMAQtBHyEAIAJB////B00EQCACQSYgAkEIdmciAGt2QQFxIABBAXRyQT5zIQALIAMgADYCHCADQgA3AhAgAEECdEG8hgFqIQECQAJAQZCEASgCACIFQQEgAHQiBHFFBEBBkIQBIAQgBXI2AgAgASADNgIADAELIAJBGSAAQQF2a0EAIABBH0cbdCEAIAEoAgAhBQNAIAUiASgCBEF4cSACRg0CIABBHXYhBSAAQQF0IQAgASAFQQRxaiIEKAIQIgUNAAsgBCADNgIQCyADIAE2AhhBCCECIAMiASEAQQwMAQsgASgCCCIAIAM2AgwgASADNgIIIAMgADYCCEEAIQBBGCECQQwLIANqIAE2AgAgAiADaiAANgIAC0GYhAEoAgAiACAGTQ0AQZiEASAAIAZrIgE2AgBBpIQBQaSEASgCACIAIAZqIgI2AgAgAiABQQFyNgIEIAAgBkEDcjYCBCAAQQhqIQAMBAtBiIQBQTA2AgBBACEADAMLIAAgAjYCACAAIAAoAgQgBGo2AgQgAkF4IAJrQQdxaiIIIAZBA3I2AgQgAUF4IAFrQQdxaiIEIAYgCGoiA2shBwJAQaSEASgCACAERgRAQaSEASADNgIAQZiEAUGYhAEoAgAgB2oiADYCACADIABBAXI2AgQMAQtBoIQBKAIAIARGBEBBoIQBIAM2AgBBlIQBQZSEASgCACAHaiIANgIAIAMgAEEBcjYCBCAAIANqIAA2AgAMAQsgBCgCBCIAQQNxQQFGBEAgAEF4cSEJIAQoAgwhAgJAIABB/wFNBEAgBCgCCCIBIAJGBEBBjIQBQYyEASgCAEF+IABBA3Z3cTYCAAwCCyABIAI2AgwgAiABNgIIDAELIAQoAhghBgJAIAIgBEcEQCAEKAIIIgAgAjYCDCACIAA2AggMAQsCQCAEKAIUIgAEfyAEQRRqBSAEKAIQIgBFDQEgBEEQagshAQNAIAEhBSAAIgJBFGohASAAKAIUIgANACACQRBqIQEgAigCECIADQALIAVBADYCAAwBC0EAIQILIAZFDQACQCAEKAIcIgBBAnQiASgCvIYBIARGBEAgAUG8hgFqIAI2AgAgAg0BQZCEAUGQhAEoAgBBfiAAd3E2AgAMAgsCQCAEIAYoAhBGBEAgBiACNgIQDAELIAYgAjYCFAsgAkUNAQsgAiAGNgIYIAQoAhAiAARAIAIgADYCECAAIAI2AhgLIAQoAhQiAEUNACACIAA2AhQgACACNgIYCyAHIAlqIQcgBCAJaiIEKAIEIQALIAQgAEF+cTYCBCADIAdBAXI2AgQgAyAHaiAHNgIAIAdB/wFNBEAgB0H4AXFBtIQBaiEAAn9BjIQBKAIAIgFBASAHQQN2dCICcUUEQEGMhAEgASACcjYCACAADAELIAAoAggLIQEgACADNgIIIAEgAzYCDCADIAA2AgwgAyABNgIIDAELQR8hAiAHQf///wdNBEAgB0EmIAdBCHZnIgBrdkEBcSAAQQF0ckE+cyECCyADIAI2AhwgA0IANwIQIAJBAnRBvIYBaiEAAkACQEGQhAEoAgAiAUEBIAJ0IgVxRQRAQZCEASABIAVyNgIAIAAgAzYCAAwBCyAHQRkgAkEBdmtBACACQR9HG3QhAiAAKAIAIQEDQCABIgAoAgRBeHEgB0YNAiACQR12IQEgAkEBdCECIAAgAUEEcWoiBSgCECIBDQALIAUgAzYCEAsgAyAANgIYIAMgAzYCDCADIAM2AggMAQsgACgCCCIBIAM2AgwgACADNgIIIANBADYCGCADIAA2AgwgAyABNgIICyAIQQhqIQAMAgsCQCAIRQ0AAkAgBSgCHCIBQQJ0IgIoAryGASAFRgRAIAJBvIYBaiAANgIAIAANAUGQhAEgB0F+IAF3cSIHNgIADAILAkAgBSAIKAIQRgRAIAggADYCEAwBCyAIIAA2AhQLIABFDQELIAAgCDYCGCAFKAIQIgEEQCAAIAE2AhAgASAANgIYCyAFKAIUIgFFDQAgACABNgIUIAEgADYCGAsCQCADQQ9NBEAgBSADIAZqIgBBA3I2AgQgACAFaiIAIAAoAgRBAXI2AgQMAQsgBSAGQQNyNgIEIAUgBmoiBCADQQFyNgIEIAMgBGogAzYCACADQf8BTQRAIANB+AFxQbSEAWohAAJ/QYyEASgCACIBQQEgA0EDdnQiAnFFBEBBjIQBIAEgAnI2AgAgAAwBCyAAKAIICyEBIAAgBDYCCCABIAQ2AgwgBCAANgIMIAQgATYCCAwBC0EfIQAgA0H///8HTQRAIANBJiADQQh2ZyIAa3ZBAXEgAEEBdHJBPnMhAAsgBCAANgIcIARCADcCECAAQQJ0QbyGAWohAQJAAkAgB0EBIAB0IgJxRQRAQZCEASACIAdyNgIAIAEgBDYCACAEIAE2AhgMAQsgA0EZIABBAXZrQQAgAEEfRxt0IQAgASgCACEBA0AgASICKAIEQXhxIANGDQIgAEEddiEBIABBAXQhACACIAFBBHFqIgcoAhAiAQ0ACyAHIAQ2AhAgBCACNgIYCyAEIAQ2AgwgBCAENgIIDAELIAIoAggiACAENgIMIAIgBDYCCCAEQQA2AhggBCACNgIMIAQgADYCCAsgBUEIaiEADAELAkAgCUUNAAJAIAIoAhwiAUECdCIFKAK8hgEgAkYEQCAFQbyGAWogADYCACAADQFBkIQBIAtBfiABd3E2AgAMAgsCQCACIAkoAhBGBEAgCSAANgIQDAELIAkgADYCFAsgAEUNAQsgACAJNgIYIAIoAhAiAQRAIAAgATYCECABIAA2AhgLIAIoAhQiAUUNACAAIAE2AhQgASAANgIYCwJAIANBD00EQCACIAMgBmoiAEEDcjYCBCAAIAJqIgAgACgCBEEBcjYCBAwBCyACIAZBA3I2AgQgAiAGaiIFIANBAXI2AgQgAyAFaiADNgIAIAgEQCAIQXhxQbSEAWohAEGghAEoAgAhAQJ/QQEgCEEDdnQiByAEcUUEQEGMhAEgBCAHcjYCACAADAELIAAoAggLIQQgACABNgIIIAQgATYCDCABIAA2AgwgASAENgIIC0GghAEgBTYCAEGUhAEgAzYCAAsgAkEIaiEACyAKQRBqJAAgAAuCDAEIfwJAIABFDQAgAEEIayIDIABBBGsoAgAiAkF4cSIAaiEFAkAgAkEBcQ0AIAJBAnFFDQEgAyADKAIAIgRrIgNBnIQBKAIASQ0BIAAgBGohAAJAAkACQEGghAEoAgAgA0cEQCADKAIMIQEgBEH/AU0EQCABIAMoAggiAkcNAkGMhAFBjIQBKAIAQX4gBEEDdndxNgIADAULIAMoAhghByABIANHBEAgAygCCCICIAE2AgwgASACNgIIDAQLIAMoAhQiAgR/IANBFGoFIAMoAhAiAkUNAyADQRBqCyEEA0AgBCEGIAIiAUEUaiEEIAEoAhQiAg0AIAFBEGohBCABKAIQIgINAAsgBkEANgIADAMLIAUoAgQiAkEDcUEDRw0DQZSEASAANgIAIAUgAkF+cTYCBCADIABBAXI2AgQgBSAANgIADwsgAiABNgIMIAEgAjYCCAwCC0EAIQELIAdFDQACQCADKAIcIgRBAnQiAigCvIYBIANGBEAgAkG8hgFqIAE2AgAgAQ0BQZCEAUGQhAEoAgBBfiAEd3E2AgAMAgsCQCADIAcoAhBGBEAgByABNgIQDAELIAcgATYCFAsgAUUNAQsgASAHNgIYIAMoAhAiAgRAIAEgAjYCECACIAE2AhgLIAMoAhQiAkUNACABIAI2AhQgAiABNgIYCyADIAVPDQAgBSgCBCIEQQFxRQ0AAkACQAJAAkAgBEECcUUEQEGkhAEoAgAgBUYEQEGkhAEgAzYCAEGYhAFBmIQBKAIAIABqIgA2AgAgAyAAQQFyNgIEIANBoIQBKAIARw0GQZSEAUEANgIAQaCEAUEANgIADwtBoIQBKAIAIgcgBUYEQEGghAEgAzYCAEGUhAFBlIQBKAIAIABqIgA2AgAgAyAAQQFyNgIEIAAgA2ogADYCAA8LIARBeHEgAGohACAFKAIMIQEgBEH/AU0EQCAFKAIIIgIgAUYEQEGMhAFBjIQBKAIAQX4gBEEDdndxNgIADAULIAIgATYCDCABIAI2AggMBAsgBSgCGCEIIAEgBUcEQCAFKAIIIgIgATYCDCABIAI2AggMAwsgBSgCFCICBH8gBUEUagUgBSgCECICRQ0CIAVBEGoLIQQDQCAEIQYgAiIBQRRqIQQgASgCFCICDQAgAUEQaiEEIAEoAhAiAg0ACyAGQQA2AgAMAgsgBSAEQX5xNgIEIAMgAEEBcjYCBCAAIANqIAA2AgAMAwtBACEBCyAIRQ0AAkAgBSgCHCIEQQJ0IgIoAryGASAFRgRAIAJBvIYBaiABNgIAIAENAUGQhAFBkIQBKAIAQX4gBHdxNgIADAILAkAgBSAIKAIQRgRAIAggATYCEAwBCyAIIAE2AhQLIAFFDQELIAEgCDYCGCAFKAIQIgIEQCABIAI2AhAgAiABNgIYCyAFKAIUIgJFDQAgASACNgIUIAIgATYCGAsgAyAAQQFyNgIEIAAgA2ogADYCACADIAdHDQBBlIQBIAA2AgAPCyAAQf8BTQRAIABB+AFxQbSEAWohAgJ/QYyEASgCACIEQQEgAEEDdnQiAHFFBEBBjIQBIAAgBHI2AgAgAgwBCyACKAIICyEAIAIgAzYCCCAAIAM2AgwgAyACNgIMIAMgADYCCA8LQR8hASAAQf///wdNBEAgAEEmIABBCHZnIgJrdkEBcSACQQF0ckE+cyEBCyADIAE2AhwgA0IANwIQIAFBAnRBvIYBaiEEAn8CQAJ/QZCEASgCACIGQQEgAXQiAnFFBEBBkIQBIAIgBnI2AgAgBCADNgIAQRghAUEIDAELIABBGSABQQF2a0EAIAFBH0cbdCEBIAQoAgAhBANAIAQiAigCBEF4cSAARg0CIAFBHXYhBCABQQF0IQEgAiAEQQRxaiIGKAIQIgQNAAsgBiADNgIQQRghASACIQRBCAshACADIgIMAQsgAigCCCIEIAM2AgwgAiADNgIIQRghAEEIIQFBAAshBiABIANqIAQ2AgAgAyACNgIMIAAgA2ogBjYCAEGshAFBrIQBKAIAQQFrIgBBfyAAGzYCAAsLrQsBB38gACABaiEFAkACQCAAKAIEIgJBAXENACACQQJxRQ0BIAAoAgAiAiABaiEBAkACQAJAIAAgAmsiAEGghAEoAgBHBEAgACgCDCEDIAJB/wFNBEAgAyAAKAIIIgRHDQJBjIQBQYyEASgCAEF+IAJBA3Z3cTYCAAwFCyAAKAIYIQYgACADRwRAIAAoAggiAiADNgIMIAMgAjYCCAwECyAAKAIUIgQEfyAAQRRqBSAAKAIQIgRFDQMgAEEQagshAgNAIAIhByAEIgNBFGohAiADKAIUIgQNACADQRBqIQIgAygCECIEDQALIAdBADYCAAwDCyAFKAIEIgJBA3FBA0cNA0GUhAEgATYCACAFIAJBfnE2AgQgACABQQFyNgIEIAUgATYCAA8LIAQgAzYCDCADIAQ2AggMAgtBACEDCyAGRQ0AAkAgACgCHCICQQJ0IgQoAryGASAARgRAIARBvIYBaiADNgIAIAMNAUGQhAFBkIQBKAIAQX4gAndxNgIADAILAkAgACAGKAIQRgRAIAYgAzYCEAwBCyAGIAM2AhQLIANFDQELIAMgBjYCGCAAKAIQIgIEQCADIAI2AhAgAiADNgIYCyAAKAIUIgJFDQAgAyACNgIUIAIgAzYCGAsCQAJAAkACQCAFKAIEIgJBAnFFBEBBpIQBKAIAIAVGBEBBpIQBIAA2AgBBmIQBQZiEASgCACABaiIBNgIAIAAgAUEBcjYCBCAAQaCEASgCAEcNBkGUhAFBADYCAEGghAFBADYCAA8LQaCEASgCACIIIAVGBEBBoIQBIAA2AgBBlIQBQZSEASgCACABaiIBNgIAIAAgAUEBcjYCBCAAIAFqIAE2AgAPCyACQXhxIAFqIQEgBSgCDCEDIAJB/wFNBEAgBSgCCCIEIANGBEBBjIQBQYyEASgCAEF+IAJBA3Z3cTYCAAwFCyAEIAM2AgwgAyAENgIIDAQLIAUoAhghBiADIAVHBEAgBSgCCCICIAM2AgwgAyACNgIIDAMLIAUoAhQiBAR/IAVBFGoFIAUoAhAiBEUNAiAFQRBqCyECA0AgAiEHIAQiA0EUaiECIAMoAhQiBA0AIANBEGohAiADKAIQIgQNAAsgB0EANgIADAILIAUgAkF+cTYCBCAAIAFBAXI2AgQgACABaiABNgIADAMLQQAhAwsgBkUNAAJAIAUoAhwiAkECdCIEKAK8hgEgBUYEQCAEQbyGAWogAzYCACADDQFBkIQBQZCEASgCAEF+IAJ3cTYCAAwCCwJAIAUgBigCEEYEQCAGIAM2AhAMAQsgBiADNgIUCyADRQ0BCyADIAY2AhggBSgCECICBEAgAyACNgIQIAIgAzYCGAsgBSgCFCICRQ0AIAMgAjYCFCACIAM2AhgLIAAgAUEBcjYCBCAAIAFqIAE2AgAgACAIRw0AQZSEASABNgIADwsgAUH/AU0EQCABQfgBcUG0hAFqIQICf0GMhAEoAgAiA0EBIAFBA3Z0IgFxRQRAQYyEASABIANyNgIAIAIMAQsgAigCCAshASACIAA2AgggASAANgIMIAAgAjYCDCAAIAE2AggPC0EfIQMgAUH///8HTQRAIAFBJiABQQh2ZyICa3ZBAXEgAkEBdHJBPnMhAwsgACADNgIcIABCADcCECADQQJ0QbyGAWohAgJAAkBBkIQBKAIAIgRBASADdCIHcUUEQEGQhAEgBCAHcjYCACACIAA2AgAgACACNgIYDAELIAFBGSADQQF2a0EAIANBH0cbdCEDIAIoAgAhAgNAIAIiBCgCBEF4cSABRg0CIANBHXYhAiADQQF0IQMgBCACQQRxaiIHKAIQIgINAAsgByAANgIQIAAgBDYCGAsgACAANgIMIAAgADYCCA8LIAQoAggiASAANgIMIAQgADYCCCAAQQA2AhggACAENgIMIAAgATYCCAsLdQICfwF+AkBB8IIBKAIAIgKtIACtQgd8Qvj///8fg3wiA0L/////D1gEQD8AQRB0IgEgA6ciAE8NASAAIAFrQf//A2pBEHZAACIBQX9HBEBBABAACyABQX9HDQELQYiEAUEwNgIAQX8PC0HwggEgADYCACACCwYAIAAkAAsEACMAC/MLAwV8A34GfyMAQRBrIg0kAAJAAkAgAb0iCEI0iKciDEH/D3EiDkG+CGsiD0H/fksgAL0iB0I0iKciCkH/D2tBgnBPcQ0AIAhCAYYiCUKAgICAgICAEHxCgYCAgICAgBBUBEBEAAAAAAAA8D8hAiAHQoCAgICAgID4P1ENAiAJUA0CIAlCgYCAgICAgHBUIAdCAYYiB0KAgICAgICAcFhxRQRAIAAgAaAhAgwDCyAHQoCAgICAgIDw/wBRDQJEAAAAAAAAAAAgASABoiAIQgBTIAdCgICAgICAgPD/AFRzGyECDAILIAdCAYZCgICAgICAgBB8QoGAgICAgIAQVARAIAAgAKIhAiAHQgBTBEAgApogAiAIEBBBAUYbIQILIAhCAFkNAiMAQRBrIgpEAAAAAAAA8D8gAqM5AwggCisDCCECDAILIAdCAFMEQCAIEBAiC0UEQCAAIAChIgAgAKMhAgwDCyAKQf8PcSEKQYCAEEEAIAtBAUYbIQsgAL1C////////////AIMhBwsgD0H/fk0EQEQAAAAAAADwPyECIAdCgICAgICAgPg/UQ0CIA5BvQdNBEAgASABmiAHQoCAgICAgID4P1YbRAAAAAAAAPA/oCECDAMLIAxB/w9LIAdCgICAgICAgPg/VkcEQCMAQRBrIgpEAAAAAAAAAHA5AwggCisDCEQAAAAAAAAAcKIhAgwDCyMAQRBrIgpEAAAAAAAAABA5AwggCisDCEQAAAAAAAAAEKIhAgwCCyAKDQAgAEQAAAAAAAAwQ6K9Qv///////////wCDQoCAgICAgICgA30hBwsCfCAIQoCAgECDvyIFIA0gB0KAgICA0Kql8z99IghCNIe5IgNBgB8rAwCiIAhCLYinQf8AcUEFdCIKKwPYH6AgByAIQoCAgICAgIB4g30iB0KAgICACHxCgICAgHCDvyIAIAorA8AfIgSiRAAAAAAAAPC/oCICIAe/IAChIASiIgSgIgAgA0H4HisDAKIgCisD0B+gIgMgACADoCIDoaCgIAQgAEGIHysDACIEoiIGIAIgBKIiBKCioCACIASiIgIgAyADIAKgIgKhoKAgACAAIAaiIgOiIAMgAyAAQbgfKwMAokGwHysDAKCiIABBqB8rAwCiQaAfKwMAoKCiIABBmB8rAwCiQZAfKwMAoKCioCIAIAIgAiAAoCICoaA5AwggAr1CgICAQIO/IgOiIQAgASAFoSADoiABIA0rAwggAiADoaCioCEBAkAgAL1CNIinQf8PcSIKQckHa0E/SQ0AIApByQdJBEAgAEQAAAAAAADwP6AiAJogACALGwwCCyAKQYkISSEMQQAhCiAMDQAgAL1CAFMEQCMAQRBrIgpEAAAAAAAAAJBEAAAAAAAAABAgCxs5AwggCisDCEQAAAAAAAAAEKIMAgsjAEEQayIKRAAAAAAAAADwRAAAAAAAAABwIAsbOQMIIAorAwhEAAAAAAAAAHCiDAELIAEgAEGIDisDAKJBkA4rAwAiAaAiAiABoSIBQaAOKwMAoiABQZgOKwMAoiAAoKCgIgAgAKIiASABoiAAQcAOKwMAokG4DisDAKCiIAEgAEGwDisDAKJBqA4rAwCgoiACvSIIp0EEdEHwD3EiDCsD+A4gAKCgoCEAIAwpA4APIAggC618Qi2GfCEHIApFBEACfCAIQoCAgIAIg1AEQCAHQoCAgICAgICIP32/IgEgAKIgAaBEAAAAAAAAAH+iDAELIAdCgICAgICAgPA/fCIHvyIBIACiIgMgAaAiAJlEAAAAAAAA8D9jBHwjAEEQayIKIApEAAAAAAAAEAA5AwggCisDCEQAAAAAAAAQAKI5AwggB0KAgICAgICAgIB/g78gAEQAAAAAAADwv0QAAAAAAADwPyAARAAAAAAAAAAAYxsiAqAiBSADIAEgAKGgIAAgAiAFoaCgoCACoSIAIABEAAAAAAAAAABhGwUgAAtEAAAAAAAAEACiCwwBCyAHvyIBIACiIAGgCyECCyANQRBqJAAgAgtOAgF/AX4Cf0EAIABCNIinQf8PcSIBQf8HSQ0AGkECIAFBswhLDQAaQQBCAUGzCCABa62GIgJCAX0gAINCAFINABpBAkEBIAAgAoNQGwsLk4cBAil/G30jAEHAEmsiFyQAIABCADcC4AsCQAJAAkAgACgCYA0AA0ACQAJAAkACQAJAAkACQCAAKALkCkF/Rw0AIAAoAiAiBSAAKAIoIgZPDQEgACAFQQFqIgQ2AiAgBS0AAEHPAEcEQCAAQR42AmQMCQsCQAJAIAQgBk8EQCAAQQE2AmAMAQsgACAFQQJqIgQ2AiAgBS0AAUHnAEYNAQsgAEEeNgJkDAkLAkACQCAEIAZPBEAgAEEBNgJgDAELIAAgBUEDaiIENgIgIAUtAAJB5wBGDQELIABBHjYCZAwJCwJAAkAgBCAGTwRAIABBATYCYAwBCyAAIAVBBGo2AiAgBS0AA0HTAEYNAQsgAEEeNgJkDAkLIAAQEkUEQAwJCyAALQDfCkEBcUUNACAAQQA6AOAKIABBADYC6AogAEEgNgJkDAgLAkACQAJAA0AgACgC5ApBf0cNAyAAKAIgIgUgACgCKCIGTw0BIAAgBUEBaiIENgIgIAUtAABBzwBHDQIgBCAGTw0BIAAgBUECaiIENgIgIAUtAAFB5wBHDQIgBCAGTw0BIAAgBUEDaiIENgIgIAUtAAJB5wBHDQIgBCAGTw0BIAAgBUEEajYCICAFLQADQdMARw0CIAAQEkUNCyAALQDfCkEBcUUNAAsgAEEgNgJkDAoLIABBATYCYAsgAEEeNgJkDAgLIABCADcC9AogAEEANgLoCiAAQQA6AOAKIABBARATBEAgAC0AMA0CIAAtAOAKIQcDQCAHQf8BcUUEQCAAKALoCg0IIAAQFEUNCCAALQDgCiIHRQ0LCyAAIAdBAWsiBzoA4AogACAAKAL4CkEBajYC+AogACgCICIFIAAoAihPBEAgAEEBNgJgBSAAIAVBAWo2AiALIABBADYC9AoMAAsACyAAKAJQBEAgACgCVCAAKAJcRw0DCyAAAn9BACAAKAKYAyIFQQBMDQAaIAVBAWshBiAFQYCAAU0EQCAFQRBNBEAgBiwA0GAMAgsgBUGABE0EQCAGQQV2LADQYEEFagwCCyAGQQp2LADQYEEKagwBCyAFQYCAgAhNBEAgBUGAgCBNBEAgBkEPdiwA0GBBD2oMAgsgBkEUdiwA0GBBFGoMAQsgBUGAgICAAk0EQCAGQRl2LADQYEEZagwBCyAGQR52LADQYEEeagsQEyIFQX9GDQcgBSAAKAKYA04NByAAIAVBBmxqIiwtAJwDRQRAIAAoAnAhIiACQQA2AgAMBAsgACgCdCEiIABBARATIQUgAEEBEBMhBgJAAkAgLC0AnAMiB0UNACAFDQAgAiAiIAAoAnBrQQJ1NgIADAELIAJBADYCACAHRQ0ECyAGDQMgAyAiQQNsIgMgACgCcGtBAnUiKjYCACAAKAJwIANqQQJ1ISIMBAsgAEEBNgJgDAYLIABBIzYCZAwFC0GVCUHHGEHSCxAFAAsgAyAiQQF1Iio2AgALIAIoAgAhJyAAIAdBAnRqKAJoIRUgACgClAMgLC0AnQNBKGxqIRMgACgCBCIHQQBKBEAgAEHgCGohGSAAQeQHaiEeIABBhAFqIRsgE0EJaiEUA0AgEygCBCAcQQNsai0AAiEDIBxBAnQiBSAXQcAKamoiH0EANgIAIBsgAyAUai0AACIDQQF0ai8BAEUEQCAAQRU2AmRBACEHDAULIAAoAoQCIQYCQAJAAkACQCAAQQEQE0UNACAFIB5qKAIAIQkCQAJAAkACQCAGIANBvAxsaiIPLQC0DEECdEHc4ABqKAIAIgtBAE4EQCALQf//AEsNAyALQRBJDQEgC0GABE8NAiAJIAAgC0EFdiwA0GAiA0EEahATOwEAIANBBWohBwwECyAJIABBfxATOwEAQQAhBwwDCyAJIAAgCywA0GAiB0EBaxATOwEADAILIAkgACALQQp2LADQYCIDQQlqEBM7AQAgA0EKaiEHDAELIAkgAEEPQRQgC0GAgCBJG0EZQR4gC0GAgICAAkkbIAtBgICACEkiAxsiBSALIAV2LADQYGpBAWsQEzsBACADRQRAIAtB/////wFNBEAgC0EZdiwA0GBBGWohBwwCCyALQR52LADQYEEeaiEHDAELIAtB//8fTQRAIAtBD3YsANBgQQ9qIQcMAQsgC0EUdiwA0GBBFGohBwsgCSAAIAdBAWsQEzsBAiAPLQAABEAgD0HSAGohGiAPQcEAaiEoIA9BMWohIyAPQSFqIRIgD0EBaiENQQIhBkEAIQoDQCASIAogDWotAAAiBWotAAAhBEEAIRACQCAFICNqLQAAIhFFDQAgACgCfCAFIChqLQAAQbAQbGohAyAAKAL0CkEJTARAIAAQFQsCfyADIAAoAvAKIghB/wdxQQF0ai4BJCIHQQBOBEAgACAIIAMoAgggB2otAAAiCHY2AvAKIAAgACgC9AogCGsiCEEAIAhBAEobNgL0CkF/IAcgCEEASBsMAQsgACADEBYLIRAgAy0AF0UNACADKAKoECAQQQJ0aigCACEQCyAEBEBBfyARdEF/cyEpIAQgBmohBCAaIAVBBHRqISQDQEEAIQcCQCAkIBAgKXFBAXRqLgEAIghBAEgNACAAKAJ8IQwCQCAAKAL0CiIFQQlKDQAgBUUEQCAAQQA2AvAKCyAALQDgCiEHAkAgACgC6ApFBEBBACEFDAELA0AgB0H/AXFFDQIgACAHQQFrIgc6AOAKIAAgACgC+ApBAWo2AvgKAn8gACgCICIDIAAoAihPBEAgAEEBNgJgQQAMAQsgACADQQFqNgIgIAMtAAALIQ4gACAFQQhqIgM2AvQKIAAgACgC8AogDiAFdGo2AvAKIAVBEUghDiADIQUgDg0ACwwBCwNAAkAgBQRAIAdB/wFxRQ0DDAELIAdB/wFxDQACQAJAAkACQAJAIAAoAuQKIgVBf0YEQCAAIAAoAtwIQQFrNgLsCiAAKAIgIgMgACgCKCIFTw0BIAAgA0EBaiIHNgIgIAMtAABBzwBHDQIgBSAHTQ0BIAAgA0ECaiIHNgIgIAMtAAFB5wBHDQIgBSAHTQ0BIAAgA0EDaiIHNgIgIAMtAAJB5wBHDQIgBSAHTQ0BIAAgA0EEajYCICADLQADQdMARw0CIAAQEkUNAyAALQDfCkEBcUUNBCAAKALkCiEFCyAAIAVBAWoiAzYC5AogBSAZai0AACIHQf8BRwRAIAAgBTYC7AogAEEBNgLoCgsgACgC3AggA0wEQCAAQX82AuQKCyAALQDgCg0EIAAgBzoA4AogBw0FDAcLIABBATYCYAsgAEEeNgJkCyAAQQE2AugKDAQLIABBIDYCZAwDCwwSCyAAIAdBAWsiBzoA4AogACAAKAL4CkEBajYC+AoCfyAAKAIgIgMgACgCKE8EQCAAQQE2AmBBAAwBCyAAIANBAWo2AiAgAy0AAAshBSAAIAAoAvQKIgNBCGo2AvQKIAAgACgC8AogBSADdGo2AvAKIANBEU4NASAAKALoCiEFDAALAAsCQAJAIAwgCEGwEGxqIgwgACgC8AoiCEH/B3FBAXRqLgEkIgNBAE4EQCAAIAggDCgCCCADai0AACIFdjYC8AogACgC9AogBWsiB0EAIAdBAEobIQVBfyADIAdBAEgbIQcMAQsCQCAAKAL0CiIFQRhKDQAgBUUEQCAAQQA2AvAKQQAhCAsgAC0A4AohBwJAIAAoAugKRQRAQQAhBQwBCwNAIAdB/wFxRQ0CIAAgB0EBayIHOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiAyAAKAIoTwRAIABBATYCYEEADAELIAAgA0EBajYCICADLQAACyEOIAAgBUEIaiIDNgL0CiAAIA4gBXQgCGoiCDYC8AogBUERSCEOIAMhBSAODQALDAELA0ACQCAFBEAgB0H/AXFFDQMMAQsgB0H/AXENAAJAAkACQAJAAkAgACgC5AoiBUF/RgRAIAAgACgC3AhBAWs2AuwKIAAoAiAiAyAAKAIoIgVPDQEgACADQQFqIgc2AiAgAy0AAEHPAEcNAiAFIAdNDQEgACADQQJqIgc2AiAgAy0AAUHnAEcNAiAFIAdNDQEgACADQQNqIgc2AiAgAy0AAkHnAEcNAiAFIAdNDQEgACADQQRqNgIgIAMtAANB0wBHDQIgABASRQ0DIAAtAN8KQQFxRQ0EIAAoAuQKIQULIAAgBUEBaiIDNgLkCiAFIBlqLQAAIgdB/wFHBEAgACAFNgLsCiAAQQE2AugKCyAAKALcCCADTARAIABBfzYC5AoLIAAtAOAKDQQgACAHOgDgCiAHDQUMBwsgAEEBNgJgCyAAQR42AmQLIABBATYC6AoMBAsgAEEgNgJkDAMLDBQLIAAgB0EBayIHOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiAyAAKAIoTwRAIABBATYCYEEADAELIAAgA0EBajYCICADLQAACyEFIAAgACgC9AoiA0EIajYC9AogACAAKALwCiAFIAN0ajYC8AogA0ERTg0BIAAoAugKIQUMAAsACwJAAkACQCAMKAIgIghFBEAgDCgCpBAiAw0BQX8hBwwFCyAMKAIEIgVBCUgNASAMKAKkECIDRQ0BCyAAKALwCiEIQQAhByAMKAKsECIFQQJOBEAgCCAIQRB4c0GA/oN4cUEIdiAIQQh4cyIOQQR2QY+evPgAcSAOQY+evPgAcUEEdHIiDkECdkGz5syZA3EgDkGz5syZA3FBAnRyIg5BAXZB1arVqgVxIA5B1arVqgVxQQF0ciElA0AgByAFQQF2Ig4gB2oiByADIAdBAnRqKAIAICVLIiYbIQcgDiAFIA5rICYbIgVBAUoNAAsLIAwtABdFBEAgDCgCqBAgB0ECdGooAgAhBwsgACgC9AoiBSAMKAIIIAdqLQAAIgNIDQEgACAIIAN2NgLwCiAFIANrIQUMAgsgDC0AFw0JIAVBAEoEQCAMKAIIIQ5BACEHA0ACQCAHIA5qIiUtAAAiA0H/AUYNACAIIAdBAnRqKAIAIAAoAvAKIiZBfyADdEF/c3FHDQAgACgC9AoiBSADSA0DIAAgJiADdjYC8AogBSAlLQAAayEFDAQLIAdBAWoiByAFRw0ACwsgAEEVNgJkC0F/IQdBACEFCyAAIAU2AvQKCyAMLQAXRQ0AIAwoAqgQIAdBAnRqKAIAIQcLIBAgEXUhECAJIAZBAXRqIAc7AQAgBkEBaiIGIARHDQALIAQhBgsgCkEBaiIKIA8tAABJDQALCyAAKAL0CkF/Rg0AIBdBgQI7AcACIA8oArgMIgNBA0gNAiAPQdICaiEGIA9BwAhqIQ9BAiEFA0BBACAJIA8gBUEBdCIEaiIHLQABIgxBAXQiCGouAQAgCSAHLQAAIhBBAXQiCmouAQAiEWsiByAHQR91Ig5zIA5rIAQgBmovAQAgBiAKai8BACIKa2wgBiAIai8BACAKa20iCGsgCCAHQQBIGyARaiEHAkACQCAEIAlqIgovAQAiCARAIAwgF0HAAmoiBGpBAToAACAEIBBqQQE6AAAgBCAFakEBOgAAIAjBIgQgCyAHayIMIAcgByAMShtBAXROBEAgByAMSA0DIAsgBEF/c2ohBwwCCyAIQQFxBEAgByAEQQFqQQF2ayEHDAILIAcgBEEBdmohBwwBCyAXQcACaiAFakEAOgAACyAKIAc7AQALIAVBAWoiBSADRw0ACwwCCyAfQQE2AgAMAgtB7AtBoA1BrQgQBQALIANBAEwNAEEAIQcgA0EBRwRAIANBAXEhBSADQf7///8HcSEDA0AgF0HAAmogB2otAABFBEAgCSAHQQF0akH//wM7AQALIAdBAXIiBiAXQcACamotAABFBEAgCSAGQQF0akH//wM7AQALIAdBAmoiByADRw0ACyAFRQ0BCyAXQcACaiAHai0AAA0AIAkgB0EBdGpB//8DOwEACyAcQQFqIhwgACgCBCIHSA0ACwsCQAJAAkAgACgCUCIFBEAgACgCVCAAKAJcRw0BCyAHQQJ0IgMEQCAXQcACaiAXQcAKaiAD/AoAAAsgEy8BACIGBEAgEygCBCEEQQAhBwNAIAQgB0EDbGoiCy0AASEDAkAgF0HACmoiCSALLQAAQQJ0aiILKAIABEAgA0ECdCAJaigCAA0BCyAXQcAKaiADQQJ0akEANgIAIAtBADYCAAsgB0EBaiIHIAZHDQALCyAVQQF1IRwCQCATLQAIBH8gE0EYaiElIABBoAZqISZBACEIA0BBACEFIAAoAgQiA0EASgRAIBMoAgQhBEEAIQcDQCAEIAdBA2xqLQACIAhGBEAgBSAXagJ/IAdBAnQiBiAXQcAKamooAgAEQEEAIQZBAQwBCyAGICZqKAIAIQZBAAs6AAAgF0GAAmogBUECdGogBjYCACAFQQFqIQULIAdBAWoiByADRw0ACwsgF0GAAmohHiAIICVqLQAAIQZBACEJQQAhB0EAIQ8jAEEQayIEIRAgBCQAIAAoAgQiAyAAKAKMAyAGQRhsaiILKAIEIgwgHCAAIAZBAXRqLwGMAiIoQQJGdCIGIAYgDEsbIAsoAgAiDCAGIAYgDEsbayALKAIIbiIMQQJ0IgZBBGpsIQogACgCfCALLQANQbAQbGooAgAhGSAAKAJcISkCQCAAKAJQIhEEQCApIApBBGpBeHFrIgQgACgCWEgNASAAIAQ2AlwgBCARaiEPDAELIAQgCkEPakFwcWsiDyQACwJAIANBAEwNACADQQNxIREgDyADQQJ0aiEEAkAgA0EESQRAQQAhAwwBCwJAAkAgA0EEayIOQQJ2IgNFBEBBACEDDAELIANBAWpB/v///wdxIRtBACEDA0AgDyADQQJ0aiIKIAQgBmoiFCAGaiIfNgIIIAogFDYCBCAKIAQ2AgAgCiAGIB9qIgQ2AgwgCiAEIAZqIgQ2AhAgCiAEIAZqIgQ2AhQgCiAEIAZqIgQ2AhggCiAEIAZqIgQ2AhwgA0EIaiEDIAQgBmohBCAHQQJqIgcgG0cNAAsgDkEEcQ0BCyAPIANBAnRqIgcgBCAGaiIKIAZqIg42AgggByAKNgIEIAcgBDYCACAHIAYgDmoiBDYCDCADQQRqIQMgBCAGaiEECyARRQ0BCwNAIA8gA0ECdGogBDYCACADQQFqIQMgBCAGaiEEIAlBAWoiCSARRw0ACwsCQAJAAkACQAJAAkACQCAFQQBKBEAgHEECdCEDQQAhBAJAIAVBAUcEQCAFQQFxIQYgBUH+////B3EhCQNAAkAgBCAXai0AAA0AIANFDQAgHiAEQQJ0aigCAEEAIAP8CwALAkAgFyAEQQFyIgdqLQAADQAgA0UNACAeIAdBAnRqKAIAQQAgA/wLAAsgBEECaiIEIAlHDQALIAZFDQELIAQgF2otAAANACADRQ0AIB4gBEECdGooAgBBACAD/AsACyAFQQFGDQEgKEECRw0BQQAhBANAIAQgF2otAABFDQMgBEEBaiIEIAVHDQALDAMLQQAhBCAoQQJGDQELQQAhHyAMQQBMDQEgAEHgCGohIyAFQQBMISQDQCAfQQBHICRyIStBACEaQQAhBwNAQQAhBCArRQRAA0AgBCAXai0AAEUEQCAAKAJ8IAstAA1BsBBsaiEGIAAoAvQKQQlMBEAgABAVCwJ/IAYgACgC8AoiCUH/B3FBAXRqLgEkIgNBAE4EQCAAIAkgBigCCCADai0AACIJdjYC8AogACAAKAL0CiAJayIJQQAgCUEAShs2AvQKQX8gAyAJQQBIGwwBCyAAIAYQFgshAyAGLQAXBEAgBigCqBAgA0ECdGooAgAhAwsgA0F/Rg0GIA8gBEECdGooAgAgGkECdGogCygCECADQQJ0aigCADYCAAsgBEEBaiIEIAVHDQALCwJAIBlBAEwNACAHIAxODQAgJARAQQAhBANAIAdBAWohByAEQQFqIgQgGU4NAiAHIAxIDQALDAELQQAhGyAoRQRAAkACQANAQQAhEQJAA0ACQCARIBdqLQAADQAgCygCFCAPIBFBAnQiA2ooAgAgGkECdGooAgAgG2otAABBBHRqIB9BAXRqLgEAIgZBAEgNACALKAIAIQQgAyAeaigCACEDIAsoAggiEiAAKAJ8IAZBsBBsaiIJKAIAbSIUQQBMDQAgAyAHIBJsIARqIh1BAnRqISEgCUEkaiEYQQAhDgNAIAktABVFDQYCQCAAKAL0CiIDQQlKDQAgA0UEQCAAQQA2AvAKCyAALQDgCiEEIAAoAugKRQRAQQAhAwJAAkACQANAAkACQCADBEAgBEH/AXENAQwICyAEQf8BcQ0AIAAoAuQKIgNBf0YEQCAAIAAoAtwIQQFrNgLsCiAAKAIgIgMgACgCKCIGTw0CIAAgA0EBaiIENgIgIAMtAABBzwBHDQQgBCAGTw0CIAAgA0ECaiIENgIgIAMtAAFB5wBHDQQgBCAGTw0CIAAgA0EDaiIENgIgIAMtAAJB5wBHDQQgBCAGTw0CIAAgA0EEajYCICADLQADQdMARw0EIAAQEkUNBSAALQDfCkEBcUUNBiAAKALkCiEDCyAAIANBAWoiBjYC5AogAyAjai0AACIEQf8BRwRAIAAgAzYC7AogAEEBNgLoCgsgACgC3AggBkwEQCAAQX82AuQKCyAALQDgCg0VIAAgBDoA4AogBEUNBwsgACAEQQFrIgQ6AOAKIAAgACgC+ApBAWo2AvgKAn8gACgCICIDIAAoAihPBEAgAEEBNgJgQQAMAQsgACADQQFqNgIgIAMtAAALIQYgACAAKAL0CiIDQQhqNgL0CiAAIAAoAvAKIAYgA3RqNgLwCiADQRBKDQYgACgC6AohAwwBCwsgAEEBNgJgCyAAQR42AmQLIABBATYC6AoMAgsgAEEgNgJkDAELA0AgBEH/AXFFDQEgACAEQQFrIgQ6AOAKIAAgACgC+ApBAWo2AvgKAn8gACgCICIGIAAoAihPBEAgAEEBNgJgQQAMAQsgACAGQQFqNgIgIAYtAAALIQogACADQQhqIgY2AvQKIAAgACgC8AogCiADdGo2AvAKIANBEUghCiAGIQMgCg0ACwsCQAJAAkACQAJAIBggACgC8AoiCkH/B3FBAXRqLgEAIgZBAEgEQCAAKAL0CiIDQRhKDQMgA0UEQCAAQQA2AvAKQQAhCgsgAC0A4AohBCAAKALoCg0CQQAhAwNAAkAgAwRAIARB/wFxRQ0GDAELIARB/wFxDQAgABAURQ0FIAAtAOAKIgRFDQMLIAAgBEEBayIEOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiAyAAKAIoTwRAIABBATYCYEEADAELIAAgA0EBajYCICADLQAACyEGIAAgACgC9AoiA0EIajYC9AogACAAKALwCiAGIAN0ajYC8AogA0EQSg0EIAAoAugKIQMMAAsACyAAIAogCSgCCCAGai0AACIDdjYC8AogACgC9AogA2siBEEAIARBAEobIQNBfyAGIARBAEgbIQQMAwtB+gxBoQxBnQgQBQALA0AgBEH/AXFFDQEgACAEQQFrIgQ6AOAKIAAgACgC+ApBAWo2AvgKAn8gACgCICIGIAAoAihPBEAgAEEBNgJgQQAMAQsgACAGQQFqNgIgIAYtAAALIQ0gACADQQhqIgY2AvQKIAAgCiANIAN0aiIKNgLwCiADQRFIIQ0gBiEDIA0NAAsLAkACQCAJKAIgIg0EQCAJKAIEIgpBCU4EQCAJKAKkECIGDQILIAktABcNEwJAIApBAEoEQCAJKAIIIQZBACEEA0AgBCAGaiIWLQAAIgNB/wFHBEAgDSAEQQJ0aigCACAAKALwCiIgQX8gA3RBf3NxRg0DCyAEQQFqIgQgCkcNAAsLIABBFTYCZAwDCyAAKAL0CiIGIANIDQIgACAgIAN2NgLwCiAGIBYtAABrIQMMAwsgCSgCpBAiBg0AQX8hBAwDCyAAKALwCiEKQQAhBCAJKAKsECIDQQJOBEAgCiAKQRB4c0GA/oN4cUEIdiAKQQh4cyINQQR2QY+evPgAcSANQY+evPgAcUEEdHIiDUECdkGz5syZA3EgDUGz5syZA3FBAnRyIg1BAXZB1arVqgVxIA1B1arVqgVxQQF0ciEWA0AgBCADQQF2Ig0gBGoiBCAGIARBAnRqKAIAIBZLIiAbIQQgDSADIA1rICAbIgNBAUoNAAsLIAktABdFBEAgCSgCqBAgBEECdGooAgAhBAsgACgC9AoiBiAJKAIIIARqLQAAIgNIDQAgACAKIAN2NgLwCiAGIANrIQMMAQtBfyEEQQAhAwsgACADNgL0CgsgCS0AFwRAIAQgCSgCrBBODQQLIARBAEgNBQJAIBIgDiAdamsiBiAJKAIAIgMgAyAGShsiBkEATA0AICEgDkECdGohCiAGQQFxIQ0gCSgCHCADIARsQQJ0aiEDAn0CQAJAIAktABYEQCAGQQFHDQFBACEEQwAAAAAhLQwCC0EAIQQgBkEBRwRAIAZB/v///wdxIQYDQCAKIAQgFGxBAnRqIhYgFioCACADIARBAnRqKgIAQwAAAACSkjgCACAKIARBAXIiFiAUbEECdGoiICAgKgIAIAMgFkECdGoqAgBDAAAAAJKSOAIAIARBAmoiBCAGRw0ACyANRQ0ECyADIARBAnRqKgIAQwAAAACSDAILIAZB/v///wdxIQZBACEEQwAAAAAhLQNAIAogBCAUbEECdGoiFiAWKgIAIC0gAyAEQQJ0aioCAJIiLZI4AgAgCiAEQQFyIhYgFGxBAnRqIiAgICoCACAtIAMgFkECdGoqAgCSIi2SOAIAIARBAmoiBCAGRw0ACyANRQ0CCyAtIAMgBEECdGoqAgCSCyEtIAogBCAUbEECdGoiAyADKgIAIC2SOAIACyAOQQFqIg4gFEcNAAsLIBFBAWoiESAFRw0ACyAHQQFqIQcgG0EBaiIbIBlODQUgByAMTg0FDAELCwwKCyAALQDgCg0AIAAoAugKDQYLIABBFTYCZAwFCwJAAkADQEEAIRQCQANAAkAgFCAXai0AAA0AIAsoAhQgDyAUQQJ0IgNqKAIAIBpBAnRqKAIAIBtqLQAAQQR0aiAfQQF0ai4BACIGQQBIDQAgCygCCCISQQBMDQAgAyAeaigCACEdIAAoAnwgBkGwEGxqIglBJGohISALKAIAIAcgEmxqIQ5BACERA0AgCS0AFUUNBgJAIAAoAvQKIgNBCUoNACADRQRAIABBADYC8AoLIAAtAOAKIQQgACgC6ApFBEBBACEDAkACQAJAA0ACQAJAIAMEQCAEQf8BcQ0BDAgLIARB/wFxDQAgACgC5AoiA0F/RgRAIAAgACgC3AhBAWs2AuwKIAAoAiAiAyAAKAIoIgZPDQIgACADQQFqIgQ2AiAgAy0AAEHPAEcNBCAEIAZPDQIgACADQQJqIgQ2AiAgAy0AAUHnAEcNBCAEIAZPDQIgACADQQNqIgQ2AiAgAy0AAkHnAEcNBCAEIAZPDQIgACADQQRqNgIgIAMtAANB0wBHDQQgABASRQ0FIAAtAN8KQQFxRQ0GIAAoAuQKIQMLIAAgA0EBaiIGNgLkCiADICNqLQAAIgRB/wFHBEAgACADNgLsCiAAQQE2AugKCyAAKALcCCAGTARAIABBfzYC5AoLIAAtAOAKDRQgACAEOgDgCiAERQ0HCyAAIARBAWsiBDoA4AogACAAKAL4CkEBajYC+AoCfyAAKAIgIgMgACgCKE8EQCAAQQE2AmBBAAwBCyAAIANBAWo2AiAgAy0AAAshBiAAIAAoAvQKIgNBCGo2AvQKIAAgACgC8AogBiADdGo2AvAKIANBEEoNBiAAKALoCiEDDAELCyAAQQE2AmALIABBHjYCZAsgAEEBNgLoCgwCCyAAQSA2AmQMAQsDQCAEQf8BcUUNASAAIARBAWsiBDoA4AogACAAKAL4CkEBajYC+AoCfyAAKAIgIgYgACgCKE8EQCAAQQE2AmBBAAwBCyAAIAZBAWo2AiAgBi0AAAshCiAAIANBCGoiBjYC9AogACAAKALwCiAKIAN0ajYC8AogA0ERSCEKIAYhAyAKDQALCwJAAkACQAJAAkAgISAAKALwCiIKQf8HcUEBdGouAQAiBkEASARAIAAoAvQKIgNBGEoNAyADRQRAIABBADYC8ApBACEKCyAALQDgCiEEIAAoAugKDQJBACEDAkACQANAAkACQCADBEAgBEH/AXENAQwJCyAEQf8BcQ0AIAAoAuQKIgNBf0YEQCAAIAAoAtwIQQFrNgLsCiAAKAIgIgMgACgCKCIGTw0CIAAgA0EBaiIENgIgIAMtAABBzwBHDQQgBCAGTw0CIAAgA0ECaiIENgIgIAMtAAFB5wBHDQQgBCAGTw0CIAAgA0EDaiIENgIgIAMtAAJB5wBHDQQgBCAGTw0CIAAgA0EEajYCICADLQADQdMARw0EIAAQEkUNBSAALQDfCkEBcUUNByAAKALkCiEDCyAAIANBAWoiBjYC5AogAyAjai0AACIEQf8BRwRAIAAgAzYC7AogAEEBNgLoCgsgACgC3AggBkwEQCAAQX82AuQKCyAALQDgCg0XIAAgBDoA4AogBEUNCAsgACAEQQFrIgQ6AOAKIAAgACgC+ApBAWo2AvgKAn8gACgCICIDIAAoAihPBEAgAEEBNgJgQQAMAQsgACADQQFqNgIgIAMtAAALIQYgACAAKAL0CiIDQQhqNgL0CiAAIAAoAvAKIAYgA3RqNgLwCiADQRBKDQcgACgC6AohAwwBCwsgAEEBNgJgCyAAQR42AmQLIABBATYC6AoMAwsgACAKIAkoAgggBmotAAAiA3Y2AvAKIAAoAvQKIANrIgRBACAEQQBKGyEDQX8gBiAEQQBIGyEEDAMLIABBIDYCZAwBCwNAIARB/wFxRQ0BIAAgBEEBayIEOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiBiAAKAIoTwRAIABBATYCYEEADAELIAAgBkEBajYCICAGLQAACyENIAAgA0EIaiIGNgL0CiAAIAogDSADdGoiCjYC8AogA0ERSCENIAYhAyANDQALCwJAAkAgCSgCICINBEAgCSgCBCIKQQlOBEAgCSgCpBAiBg0CCyAJLQAXDRICQCAKQQBKBEAgCSgCCCEGQQAhBANAIAQgBmoiGC0AACIDQf8BRwRAIA0gBEECdGooAgAgACgC8AoiFkF/IAN0QX9zcUYNAwsgBEEBaiIEIApHDQALCyAAQRU2AmQMAwsgACgC9AoiBiADSA0CIAAgFiADdjYC8AogBiAYLQAAayEDDAMLIAkoAqQQIgYNAEF/IQQMAwsgACgC8AohCkEAIQQgCSgCrBAiA0ECTgRAIAogCkEQeHNBgP6DeHFBCHYgCkEIeHMiDUEEdkGPnrz4AHEgDUGPnrz4AHFBBHRyIg1BAnZBs+bMmQNxIA1Bs+bMmQNxQQJ0ciINQQF2QdWq1aoFcSANQdWq1aoFcUEBdHIhGANAIAQgA0EBdiINIARqIgQgBiAEQQJ0aigCACAYSyIWGyEEIA0gAyANayAWGyIDQQFKDQALCyAJLQAXRQRAIAkoAqgQIARBAnRqKAIAIQQLIAAoAvQKIgYgCSgCCCAEai0AACIDSA0AIAAgCiADdjYC8AogBiADayEDDAELQX8hBEEAIQMLIAAgAzYC9AoLIAktABcEQCAEIAkoAqwQTg0ECyAEQQBIDQUgHSAOQQJ0aiEGIBIgEWsiAyAJKAIAIgogAyAKSBshAyAEIApsIQQCQAJ9IAktABYEQCADQQBMDQIgCSgCHCAEQQJ0aiENAkAgA0EBRgRAQQAhBEMAAAAAIS0MAQsgA0EBcSEYIANB/v///wdxIRZBACEEQwAAAAAhLQNAIAYgBEECdCIDaiIgICAqAgAgLSADIA1qKgIAkiItkjgCACAGIANBBHIiA2oiICAgKgIAIC0gCSoCDJIgAyANaioCAJIiLZI4AgAgLSAJKgIMkiEtIARBAmoiBCAWRw0ACyAYRQ0DCyAtIA0gBEECdGoqAgCSDAELIANBAEwNASAJKAIcIARBAnRqIQ1BACEEIANBAUcEQCADQQFxIRggA0H+////B3EhFgNAIAYgBEECdCIDaiIgICAqAgAgAyANaioCAEMAAAAAkpI4AgAgBiADQQRyIgNqIiAgICoCACADIA1qKgIAQwAAAACSkjgCACAEQQJqIgQgFkcNAAsgGEUNAgsgDSAEQQJ0aioCAEMAAAAAkgshLSAGIARBAnRqIgMgAyoCACAtkjgCAAsgCiAOaiEOIAogEWoiESASSA0ACwsgFEEBaiIUIAVHDQALIAdBAWohByAbQQFqIhsgGU4NBCAHIAxODQQMAQsLDAkLIAAtAOAKDQAgACgC6AoNBQsgAEEVNgJkDAQLIBpBAWohGiAHIAxIDQALIB9BAWoiH0EIRw0ACwwBCyAEIAVGDQAgBUECRgRAIAxBAEwNAUEAIQkDQEEAIQRBACEGA0AgECALKAIAIAsoAgggBGxqIgNBAXE2AgwgECADQQF1NgIIIAlFBEAgACgCfCALLQANQbAQbGohBSAAKAL0CkEJTARAIAAQFQsCfyAFIAAoAvAKIgdB/wdxQQF0ai4BJCIDQQBIBEAgACAFEBYMAQsgACAHIAUoAgggA2otAAAiB3Y2AvAKIAAgACgC9AogB2siB0EAIAdBAEobNgL0CkF/IAMgB0EASBsLIQMgBS0AFwRAIAUoAqgQIANBAnRqKAIAIQMLIANBf0YNBCAPKAIAIAZBAnRqIAsoAhAgA0ECdGooAgA2AgALAkAgGUEATA0AQQAhAyAEIAxODQADQCALKAIIIQUCQCALKAIUIA8oAgAgBkECdGooAgAgA2otAABBBHRqIAlBAXRqLgEAIgdBAEgEQCAQIAsoAgAgBSAEQQFqIgRsaiIFQQF1NgIIIBAgBUEBcTYCDAwBCyAAIAAoAnwgB0GwEGxqIB5BAiAQQQxqIBBBCGogHCAFEBlFDQYgBEEBaiEECyADQQFqIgMgGU4NASAEIAxIDQALCyAGQQFqIQYgBCAMSA0ACyAJQQFqIglBCEcNAAsMAQsgBUEDSA0AIAxBAEwNAEEAIQkDQEEAIQRBACEGA0AgECALKAIAIAsoAgggBGxqIgMgAyAFbSIDIAVsazYCDCAQIAM2AgggCUUEQCAAKAJ8IAstAA1BsBBsaiEHIAAoAvQKQQlMBEAgABAVCwJ/IAcgACgC8AoiCkH/B3FBAXRqLgEkIgNBAE4EQCAAIAogBygCCCADai0AACIKdjYC8AogACAAKAL0CiAKayIKQQAgCkEAShs2AvQKQX8gAyAKQQBIGwwBCyAAIAcQFgshAyAHLQAXBEAgBygCqBAgA0ECdGooAgAhAwsgA0F/Rg0DIA8oAgAgBkECdGogCygCECADQQJ0aigCADYCAAsCQCAZQQBMDQBBACEDIAQgDE4NAANAIAsoAgghBwJAIAsoAhQgDygCACAGQQJ0aigCACADai0AAEEEdGogCUEBdGouAQAiCkEATgRAIAAgACgCfCAKQbAQbGogHiAFIBBBDGogEEEIaiAcIAcQGUUNBiAEQQFqIQQMAQsgECALKAIAIAcgBEEBaiIEbGoiByAFbSIKNgIIIBAgByAFIApsazYCDAsgA0EBaiIDIBlODQEgBCAMSA0ACwsgBkEBaiEGIAQgDEgNAAsgCUEBaiIJQQhHDQALCyAAICk2AlwgEEEQaiQADAMLQaUNQZMMQYgJEAUAC0HsC0GgDUGtCBAFAAtB1wpB+A1B8ggQBQALIAhBAWoiCCATLQAISQ0ACyAAKAJQBSAFCwRAIAAoAlQgACgCXEcNAQsCQCATLwEAIgZFDQAgHEEATA0AIABBoAZqIQUgEygCBCEEA0AgBSAEIAYiA0EBayIGQQNsaiILLQABQQJ0aigCACEJIAUgCy0AAEECdGooAgAhC0EAIQcDQCAJIAdBAnQiCGoiDCoCACEuAkAgCCALaiIIKgIAIi1DAAAAAF4EQCAuQwAAAABeBEAgLSAukyEvDAILIC0iLyAukiEtDAELIC5DAAAAAF4EQCAtIC6SIS8MAQsgLSIvIC6TIS0LIAggLTgCACAMIC84AgAgB0EBaiIHIBxHDQALIANBAUoNAAsLIAAoAgQiCUEATA0DIABBhAFqIQ4gE0EJaiEeIABB5AdqIRsgHEECdCEKIABBoAZqIShBACELA0AgKCALQQJ0IgVqKAIAIQQCQCAXQcACaiAFaigCAARAIAoEQCAEQQAgCvwLAAsgACgCBCEJDAELIA4gHiATKAIEIAtBA2xqLQACai0AACIDQQF0ai8BAEUEQCAAQRU2AmQMAQsgACgChAIgA0G8DGxqIgMtALQMIhQgBSAbaigCACIfLgEAbCEFQQAhByADKAK4DCIaQQJOBEAgA0HSAmohIyADQcYGaiESQQEhCANAIB8gCCASai0AAEEBdCIDai4BACIGQQBOBEAgBiAUbCEGIAcgAyAjai8BACIDRwRAIAYgBWsiECADIAdrIgxtIQ8CQCAHIAMgHCADIBxIGyIZTg0AIAQgB0ECdGoiESAFQf8BcUECdCoC8GAgESoCAJQ4AgAgB0EBaiIHIBlPDQAgECAQQR91IhFzIBFrIA8gD0EfdSIQcyAQayAMbGshDSARQQFyIRFBACEQA0AgBCAHQQJ0aiIpIAUgD2pBACARIA0gEGoiECAMSCIkG2oiBUH/AXFBAnQqAvBgICkqAgCUOAIAIBBBACAMICQbayEQIAdBAWoiByAZRw0ACwsgAyEHCyAGIQULIAhBAWoiCCAaRw0ACwsgByAcTg0AIAVBAnRB8OAAaioCACEtQQAhCCAcIAciBWtBA3EiAwRAA0AgBCAFQQJ0aiIGIC0gBioCAJQ4AgAgBUEBaiEFIAhBAWoiCCADRw0ACwsgByAca0F8Sw0AA0AgBCAFQQJ0aiIDIC0gAyoCAJQ4AgAgAyAtIAMqAgSUOAIEIAMgLSADKgIIlDgCCCADIC0gAyoCDJQ4AgwgBUEEaiIFIBxHDQALCyAJIAtBAWoiC0oNAAsMAgtBlQlB/hlByAgQBQALQZUJQd0ZQcgIEAUAC0EAIQcgCUEATA0AA0AgKCAHQQJ0aigCACEMICwtAJwDIR9BACEPIwAiBSEpIBVBAXUiHkECdCEDIAAoAlwhIwJAIAAoAlAiBgRAICMgA0EEakF4cWsiBSAAKAJYSA0BIAAgBTYCXCAFIAZqIQ8MAQsgBSADQQ9qQXBxayIPJAALIAMgDGohESAPIB5BAnRqIglBCGshBSAAIB9BAnRqKAKsCCELAkAgHkUEQCALIQQMAQsgCSEGIAwhCCALIQQDQCAGQQRrIAgqAgAgBCoCAJQgCCoCCCAEKgIElJM4AgAgBSIGIAgqAgAgBCoCBJQgCCoCCCAEKgIAlJI4AgAgBUEIayEFIARBCGohBCAIQRBqIgggEUcNAAsLIAUgD08EQCARQQxrIQgDQCAFIAgqAgAgBCoCBJQgCCoCCCAEKgIAlJM4AgQgBSAIKgIIjCAEKgIElCAEKgIAIAgqAgCUkzgCACAIQRBrIQggBEEIaiEEIAVBCGsiBSAPTw0ACwsgDyAVQQJ1IhlBAnQiBWohECALIAsgHkECdGoiA0EgayITTQRAIAUgDGohBSAMIQYgECEEIA8hCANAIAgqAgAhLSAEKgIAIS8gBSAEKgIEIi4gCCoCBCIwkjgCBCAFIAQqAgAgCCoCAJI4AgAgBiAuIDCTIi4gAyIKQRBrIgMqAgCUIC8gLZMiLSAKQQxrIg4qAgCUkzgCBCAGIC0gAyoCAJQgLiAOKgIAlJI4AgAgCCoCCCEtIAQqAgghLyAFIAQqAgwiLiAIKgIMIjCSOAIMIAUgBCoCCCAIKgIIkjgCCCAGIC4gMJMiLiATIgMqAgCUIC8gLZMiLSAKQRxrIhMqAgCUkzgCDCAGIC0gAyoCAJQgLiATKgIAlJI4AgggCEEQaiEIIARBEGohBCAGQRBqIQYgBUEQaiEFIANBIGsiEyALTw0ACwsgFUEDdSEbAn9BACAVQQBIDQAaIBVB//8ATQRAIBVBD00EQCAVLADQYAwCCyAVQf8DTQRAIBVBBXYsANBgQQVqDAILIBVBCnYsANBgQQpqDAELIBVB////B00EQCAVQf//H00EQCAVQQ92LADQYEEPagwCCyAVQRR2LADQYEEUagwBCyAVQf////8BTQRAIBVBGXYsANBgQRlqDAELIBVBHnYsANBgQR5qCyESIBVBBHUiAyAMIB5BAWsiE0EAIBtrIgUgCxAaIAMgDCATIBlrIAUgCxAaIBVBBXUiFCAMIBNBACADayIDIAsQGyAUIAwgEyAbayADIAsQGyAUIAwgEyAbQQF0ayADIAsQGyAUIAwgG0F9bCATaiADIAsQG0ECIQYgEkEBdUECayIKQQJKBEADQAJAQQIgBnQiJEEATA0AIBUgBkEEanVBAnUiGUEATA0AQQggBnQhJUEAIQ5BACAVIAZBAmp1IiZBAXVrISsDQCAMIBMgDiAmbGtBAnRqIgQgK0ECdGohCCAlQQJ0IRogCyEFIBkhAwNAIAhBBGsiDSoCACEtIAQgBCoCACIvIAgqAgAiLpI4AgAgBEEEayIdIB0qAgAiMCANKgIAkjgCACAIIC8gLpMiLyAFKgIAlCAwIC2TIi0gBSoCBJSTOAIAIA0gLSAFKgIAlCAvIAUqAgSUkjgCACAIQQxrIg0qAgAhLSAEQQhrIh0gHSoCACIvIAhBCGsiHSoCACIukjgCACAEQQxrIiEgISoCACIwIA0qAgCSOAIAIB0gLyAukyIvIAUgGmoiBSoCAJQgMCAtkyItIAUqAgSUkzgCACANIC0gBSoCAJQgLyAFKgIElJI4AgAgCEEUayINKgIAIS0gBEEQayIdIB0qAgAiLyAIQRBrIh0qAgAiLpI4AgAgBEEUayIhICEqAgAiMCANKgIAkjgCACAdIC8gLpMiLyAFIBpqIgUqAgCUIDAgLZMiLSAFKgIElJM4AgAgDSAtIAUqAgCUIC8gBSoCBJSSOAIAIAhBHGsiDSoCACEtIARBGGsiHSAdKgIAIi8gCEEYayIdKgIAIi6SOAIAIARBHGsiISAhKgIAIjAgDSoCAJI4AgAgHSAvIC6TIi8gBSAaaiIFKgIAlCAwIC2TIi0gBSoCBJSTOAIAIA0gLSAFKgIAlCAvIAUqAgSUkjgCACAFIBpqIQUgCEEgayEIIARBIGshBCADQQFLIQ0gA0EBayEDIA0NAAsgDkEBaiIOICRHDQALCyAGQQFqIgYgCkcNAAsgCiEGCyASQQdrIg0gBkoEQANAAkAgFSAGQQZqdSIOQQBMDQBBAiAGdCIZQQBMDQBBCCAGdCEkQSAgBnQhJUHgACAGdCEmQcAAIAZ0IStBACAVIAZBAmp1IgNrIR1BACADQQF1ayEhIAshAyATIQoDQCAMIApBAnRqIgQgIUECdGohCCADICZqIgUqAgAhLSADICtqIhoqAgAhLyADICRBAnRqIhIqAgAhLiAFKgIEIjGMITYgGioCBCI3jCE0IBIqAgQiOYwhOiADKgIAITAgAyoCBCI8jCE7IB1BAnQhGiAZIQUDQCAIQQRrIhIqAgAhMiAEIAQqAgAiMyAIKgIAIjiSOAIAIARBBGsiGCAYKgIAIjUgEioCAJI4AgAgEiA1IDKTIjIgMJQgPCAzIDiTIjOUkjgCACAIIDMgMJQgMiA7lJI4AgAgCEEMayISKgIAITIgBEEIayIYIBgqAgAiMyAIQQhrIhgqAgAiOJI4AgAgBEEMayIWIBYqAgAiNSASKgIAkjgCACASIDUgMpMiMiAulCA5IDMgOJMiM5SSOAIAIBggMyAulCAyIDqUkjgCACAIQRRrIhIqAgAhMiAEQRBrIhggGCoCACIzIAhBEGsiGCoCACI4kjgCACAEQRRrIhYgFioCACI1IBIqAgCSOAIAIBIgNSAykyIyIC+UIDcgMyA4kyIzlJI4AgAgGCAzIC+UIDIgNJSSOAIAIAhBHGsiEioCACEyIARBGGsiGCAYKgIAIjMgCEEYayIYKgIAIjiSOAIAIARBHGsiFiAWKgIAIjUgEioCAJI4AgAgEiA1IDKTIjIgLZQgMSAzIDiTIjOUkjgCACAYIDMgLZQgMiA2lJI4AgAgCCAaaiEIIAQgGmohBCAFQQFLIRIgBUEBayEFIBINAAsgCkEIayEKIAMgJUECdGohAyAOQQFKIQUgDkEBayEOIAUNAAsLIAZBAWoiBiANRw0ACwsgFEEASgRAIAwgE0ECdGoiBCAUQQZ0ayEDIAsgG0ECdGoqAgAiLYwhLwNAIAQgBCoCACIuIARBIGsiBSoCACIwkiIxIARBEGsiBioCACI2IARBMGsiCyoCACI3kiI0kiI5IARBCGsiCCoCACI6IARBKGsiEyoCACI8kiI7IARBGGsiCioCACIyIARBOGsiGSoCACIzkiI4kiI1kjgCACAIIDkgNZM4AgAgBiAxIDSTIjEgBEEMayIGKgIAIjQgBEEsayIIKgIAIjmSIjUgBEEcayIOKgIAIj0gBEE8ayIbKgIAIj6SIj+TIkCSOAIAIARBBGsiFCAUKgIAIkEgBEEkayIUKgIAIkKSIkMgBEEUayIaKgIAIkQgBEE0ayISKgIAIkWSIkaSIkcgNSA/kiI1kjgCACAKIDEgQJM4AgAgBiBHIDWTOAIAIBogQyBGkyIxIDsgOJMiO5M4AgAgDiAxIDuSOAIAIAUgLiAwkyIuIEQgRZMiMJIiMSAtIDogPJMiOiA0IDmTIjSSlCI5IC0gPSA+kyI8IDIgM5MiO5OUIjKSIjOSOAIAIBMgMSAzkzgCACALIC4gMJMiLiAtIDQgOpOUIjAgOyA8kiAvlCIxkyI0kjgCACAUIEEgQpMiOiA2IDeTIjaTIjcgMCAxkiIwkjgCACAZIC4gNJM4AgAgCCA3IDCTOAIAIBIgOiA2kiIuIDkgMpMiMJM4AgAgGyAuIDCSOAIAIARBQGoiBCADSw0ACwsgHkEEayELIA8gEEEQayIDTQRAIA8gC0ECdGohBCAAIB9BAnRqKALMCCEIA0AgBCAMIAgvAQBBAnRqIgUqAgA4AgwgBCAFKgIEOAIIIBBBBGsgBSoCCDgCACAQQQhrIAUqAgw4AgAgBCAMIAgvAQJBAnRqIgUqAgA4AgQgBCAFKgIEOAIAIBBBDGsgBSoCCDgCACADIhAgBSoCDDgCACAIQQRqIQggBEEQayEEIANBEGsiAyAPTw0ACwsgCUEQayIGIA9LBEAgACAfQQJ0aigCvAghCCAJIQUgDyEEA0AgBCAEKgIEIi0gBUEEayIDKgIAIi+TIi4gCCoCBCIwIC0gL5IiLZQgCCoCACIvIAQqAgAiMSAFQQhrIhAqAgAiNpMiN5STIjSSOAIEIAQgMSA2kiIxIDAgN5QgLSAvlJIiLZI4AgAgAyA0IC6TOAIAIBAgMSAtkzgCACAEIAQqAgwiLSAFQQxrIgMqAgAiL5MiLiAIKgIMIjAgLSAvkiItlCAIKgIIIi8gBCoCCCIxIAYiBSoCACI2kyI3lJMiNJI4AgwgBCAxIDaSIjEgMCA3lCAtIC+UkiItkjgCCCAFIDEgLZM4AgAgAyA0IC6TOAIAIAhBEGohCCAEQRBqIgQgBUEQayIGSQ0ACwsgDyAJQSBrIgNNBEAgACAfQQJ0aigCtAggHkECdGohBCAMIAtBAnRqIQUgDCAVQQJ0aiEGA0AgDCAJIgtBCGsqAgAiLSAEQQRrKgIAIi+UIAlBBGsqAgAiLiAEQQhrKgIAIjCUkyIxOAIAIAUgMYw4AgwgESAwIC2MlCAuIC+UkyItOAIAIAZBBGsgLTgCACAMIAlBEGsqAgAiLSAEQQxrKgIAIi+UIAlBDGsqAgAiLiAEQRBrKgIAIjCUkyIxOAIEIAUgMYw4AgggESAwIC2MlCAuIC+UkyItOAIEIAZBCGsgLTgCACAMIAlBGGsqAgAiLSAEQRRrKgIAIi+UIAlBFGsqAgAiLiAEQRhrKgIAIjCUkyIxOAIIIAUgMYw4AgQgESAwIC2MlCAuIC+UkyItOAIIIAZBDGsgLTgCACAMIAMiCSoCACItIARBHGsqAgAiL5QgC0EcayoCACIuIARBIGsiBCoCACIwlJMiMTgCDCAFIDGMOAIAIBEgMCAtjJQgLiAvlJMiLTgCDCAGQRBrIgYgLTgCACAFQRBrIQUgEUEQaiERIAxBEGohDCADQSBrIgMgD08NAAsLIAAgIzYCXCApJAAgB0EBaiIHIAAoAgRIDQALC0EAIBxrIQMgAC0A4AohBwNAAkACQCAHQf8BcQ0AIAAoAugKDQEgABAURQ0BIAAtAOAKIgcNAAwGCyAAIAdBAWsiBzoA4AogACAAKAL4CkEBajYC+AogACgCICIFIAAoAihPBEAgAEEBNgJgBSAAIAVBAWo2AiALDAELCwJAIAAtAOEKBEAgACADNgKkCCAAQQA6AOEKIABBATYCqAggACAVICJrNgKECwwBCyAAKAKECyIDRQ0AICogJ2siBSADTARAIAAgAyAFazYChAsgAiAqNgIAICohJwwBCyACIAMgJ2oiJzYCACAAQQA2AoQLCyAAKAKoCCECAkACQAJAIAACfyAAKALsCiAAKAL8CkYEQAJAIAJFDQAgAC0A3wpBBHFFDQAgACgCgAsiAiAAKAKkCCIDICIgJ2tqTw0AIAEgAiADayIBQQAgASACTRsgJ2oiASAiIAEgIkgbIgE2AgAgACAAKAKkCCABajYCpAgMBAsgAEEBNgKoCCAAKAKACyAnIBxragwBCyACRQ0BIAAoAqQICyAqICdrajYCpAgLIAAoAlAEQCAAKAJUIAAoAlxHDQILIAEgIjYCAAtBASEHDAMLQZUJQfIaQcgIEAUAC0EAIQcgAEEANgL0CiAAKAJgRQ0ACwsgF0HAEmokACAHDwtB+gxBoQxBnQgQBQALQaUNQZMMQYgJEAUAC4EMAQx/AkAgAC0A4QpFDQAgAC0AMA0AIAAgACgCICAAKAIka0EEazYCOAsCQAJAIAAoAiAiAiAAKAIoIgNPBEAgAEEBNgJgIAIhAQwBCyAAIAJBAWoiATYCICACLQAARQ0AQQAhAUEfIQhB5AAhBAwBCwJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgI2AiAgAS0AACEFIAIhAQsgACAFOgDfCgJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgI2AiAgAS0AACEGIAIhAQsCQCABIANPBEAgAEEBNgJgDAELIAAgAUEBaiICNgIgIAEtAABBCHQgBnIhBiACIQELAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiAjYCICABLQAAQRB0IAZyIQYgAiEBCwJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgI2AiAgAS0AAEEYdCAGciEGIAIhAQsCQCABIANPBEAgAEEBNgJgDAELIAAgAUEBaiICNgIgIAEtAAAhByACIQELAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiAjYCICABLQAAQQh0IAdyIQcgAiEBCwJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgI2AiAgAS0AAEEQdCAHciEHIAIhAQsCQCABIANPBEAgAEEBNgJgDAELIAAgAUEBaiICNgIgIAEtAABBGHQgB3IhByACIQELAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiATYCIAsCQCABIANPBEAgAEEBNgJgDAELIAAgAUEBaiIBNgIgCwJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgE2AiALAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiATYCIAsCQCABIANPBEAgAEEBNgJgQQAhBQwBCyAAIAFBAWoiAjYCICABLQAAIQUgAiEBCwJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgI2AiAgAS0AAEEIdCAFciEFIAIhAQsCQCABIANPBEAgAEEBNgJgDAELIAAgAUEBaiICNgIgIAEtAABBEHQgBXIhBSACIQELAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiAjYCICABLQAAQRh0IAVyIQUgAiEBCyAAIAU2AtgIAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiATYCIAsCQCABIANPBEAgAEEBNgJgDAELIAAgAUEBaiIBNgIgCwJAIAEgA08EQCAAQQE2AmAMAQsgACABQQFqIgE2AiALAkAgASADTwRAIABBATYCYAwBCyAAIAFBAWoiATYCIAsCQCABIANPBEAgAEEBNgJgQQAhAgwBCyAAIAFBAWoiBDYCICABLQAAIQIgBCEBCyAAIAI2AtwIAn8gAyABIAJqIgRJBEBBCiEIQeQAIQRBASEGQeAAIQVBAAwBCyAAQeAIaiEDIAIEQCADIAEgAvwKAAALIABBfjYC/AogACAENgIgAkAgBiAHcUF/Rg0AIAJFDQAgAiEBA0AgAyABQQFrIgRqLQAAQf8BRgRAIAFBAkghBSAEIQEgBUUNAQwCCwsgACAGNgKACyAAIAQ2AvwKCyAALQDhCkUEQEEBIQFB5AohBAwCC0EAIQQCQCACRQ0AIAJBA3EhCUEAIQdBACEBIAJBBE8EQAJAAkAgAkEEayILQQJ2IgFFBEBBACEFDAELIAFBAWpB/v///wdxIQxBACEFA0AgBCADIAVqIgEtAABqIAEtAAFqIAEtAAJqIAEtAANqIAEtAARqIAEtAAVqIAEtAAZqIAEtAAdqIQQgBUEIaiEFIApBAmoiCiAMRw0ACyALQQRxDQELIAQgAyAFaiIBLQAAaiABLQABaiABLQACaiABLQADaiEECyAJRQ0BIAJB/AFxIQELA0AgBCABIANqLQAAaiEEIAFBAWohASAHQQFqIgcgCUcNAAsLIAAgACgCOCACIARqakEbajYCPEHkCiEEQcAAIQVBAQshASAAIAVqIAY2AgALIAAgBGogCDYCACABC8IEAQR/AkAgACgC9AoiAkEATgRAAkACQCABIAJKBEAgAUEZTwRAAkACQCACQRhPBEAgACgC8AohBAwBCyACRQRAIABBADYC8AoLIAAtAOAKIQMDQCADQf8BcUUEQEEAIQJBfyEDIAAoAugKDQMgABAURQ0DIAAtAOAKIgNFDQkLIAAgA0EBayIDOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiAiAAKAIoTwRAIABBATYCYEEADAELIAAgAkEBajYCICACLQAACyEEIAAgACgC9AoiBUEIaiICNgL0CiAAIAAoAvAKIAQgBXRqIgQ2AvAKIAVBEEgNAAsLIAAgBEEYdjYC8AogAkEYayEDIARB////B3EhAgsgACADNgL0CiAAIAFBGGsQE0EYdCACcg8LIAJFBEAgAEEANgLwCgsgAC0A4AohAwNAIANB/wFxRQRAQQAhA0F/IQIgACgC6AoNBCAAEBRFDQQgAC0A4AoiA0UNBgsgACADQQFrIgM6AOAKIAAgACgC+ApBAWo2AvgKAn8gACgCICICIAAoAihPBEAgAEEBNgJgQQAMAQsgACACQQFqNgIgIAItAAALIQQgACAAKAL0CiIFQQhqIgI2AvQKIAAgACgC8AogBCAFdGo2AvAKIAEgAkoNAAsLIAEgAkoNACAAIAAoAvAKIgMgAXY2AvAKIAIgAWshAiADQX8gAXRBf3NxIQMMAQtBvwtB1wxB8QkQBQALIAAgAjYC9AoLIAMPC0H6DEGhDEGdCBAFAAvdAgEDfwJAAkAgACgC6ApFBEACQAJAAkAgACgC5AoiAUF/RgRAIAAgACgC3AhBAWs2AuwKIAAoAiAiASAAKAIoIgNPDQEgACABQQFqIgI2AiAgAS0AAEHPAEcNAiACIANPDQEgACABQQJqIgI2AiAgAS0AAUHnAEcNAiACIANPDQEgACABQQNqIgI2AiAgAS0AAkHnAEcNAiACIANPDQEgACABQQRqNgIgIAEtAANB0wBHDQIgABASRQ0DIAAtAN8KQQFxRQ0FIAAoAuQKIQELIAAgAUEBaiICNgLkCiAAIAFqQeAIai0AACIDQf8BRwRAIAAgATYC7AogAEEBNgLoCgsgACgC3AggAkwEQCAAQX82AuQKCyAALQDgCg0FIAAgAzoA4AogAw8LIABBATYCYAsgAEEeNgJkCyAAQQE2AugKC0EADwsgAEEgNgJkQQAPC0GlDUGTDEGICRAFAAuDAwEEfwJAAkAgACgC9AoiAkEYSg0AIAJFBEAgAEEANgLwCgsgAC0A4AohAwJAIAAoAugKRQRAQQAhAgwBCwNAIANB/wFxRQ0CIAAgA0EBayIDOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiASAAKAIoTwRAIABBATYCYEEADAELIAAgAUEBajYCICABLQAACyEEIAAgAkEIaiIBNgL0CiAAIAAoAvAKIAQgAnRqNgLwCiACQRFIIQQgASECIAQNAAsMAQsDQAJAIAIEQCADQf8BcQ0BDAMLIANB/wFxDQAgABAURQ0CIAAtAOAKIgNFDQMLIAAgA0EBayIDOgDgCiAAIAAoAvgKQQFqNgL4CgJ/IAAoAiAiASAAKAIoTwRAIABBATYCYEEADAELIAAgAUEBajYCICABLQAACyEEIAAgACgC9AoiAUEIajYC9AogACAAKALwCiAEIAF0ajYC8AogAUERTg0BIAAoAugKIQIMAAsACw8LQfoMQaEMQZ0IEAUAC/QDAQd/IAAQFQJAAkACQAJAIAEoAiAiBUUEQCABKAKkECIGDQEMAwsgASgCBCIEQQlIDQEgASgCpBAiBkUNAQsgACgC8AohBCABKAKsECIFQQJOBEAgBCAEQRB4c0GA/oN4cUEIdiAEQQh4cyIDQQR2QY+evPgAcSADQY+evPgAcUEEdHIiA0ECdkGz5syZA3EgA0Gz5syZA3FBAnRyIgNBAXZB1arVqgVxIANB1arVqgVxQQF0ciEHA0AgAiAFQQF2IgMgAmoiAiAGIAJBAnRqKAIAIAdLIggbIQIgAyAFIANrIAgbIgVBAUoNAAsLIAEtABdFBEAgASgCqBAgAkECdGooAgAhAgsgACgC9AoiBSABKAIIIAJqLQAAIgFIBEAgAEEANgL0CkF/DwsgACAEIAF2NgLwCiAAIAUgAWs2AvQKIAIPCyABLQAXDQEgBEEASgRAIAEoAgghBgNAAkAgAiAGaiIDLQAAIgFB/wFGDQAgBSACQQJ0aigCACAAKALwCiIHQX8gAXRBf3NxRw0AIAEgACgC9AoiBEwEQCAAIAcgAXY2AvAKIAAgBCADLQAAazYC9AogAg8LIABBADYC9ApBfw8LIAJBAWoiAiAERw0ACwsgAEEANgL0CiAAQRU2AmQLQX8PC0HsC0GgDUGtCBAFAAvtBQEOfwJAAkACQAJAAkACQCAAKALgByIKRQRAIAAoAgQhDQwBCyAKQQF0IgQgACgCcEYEf0HECAUgBCAAKAJ0Rw0FQcgICyAAaigCACIORQ0EIAAoAgQiDUEATARAIAAgASADazYC4AcMBgsgCkEATA0BIABBoAdqIQ8gAEGgBmohECAOIApBAnRqIQcgCkH+////B3EhESAKQQFxIQkDQCAQIAhBAnQiBGooAgAgAkECdGohCyAEIA9qKAIAIQxBACEEAkAgCkEBRwRAA0AgCyAEQQJ0IgZqIgUgBSoCACAGIA5qKgIAlCAGIAxqKgIAIAcgBEF/c0ECdGoqAgCUkjgCACALIAZBBHIiBmoiBSAFKgIAIAYgDmoqAgCUIAYgDGoqAgAgByAEQf7///8Dc0ECdGoqAgCUkjgCACAEQQJqIgQgEUcNAAsgCUUNAQsgCyAEQQJ0IgZqIgUgBSoCACAGIA5qKgIAlCAGIAxqKgIAIAcgBEF/c0ECdGoqAgCUkjgCAAsgCEEBaiIIIA1HDQALCyAAIAEgA2siBDYC4AcgDUEATA0CDAELIAAgASADayIENgLgBwsgASADTA0AIABBoAdqIQYgAEGgBmohDyAEQXxxIRAgBEEDcSEMQQAhCyADIAFrQXxLIREDQCAPIAtBAnQiBGooAgAgA0ECdGohByAEIAZqKAIAIQhBACEFQQAhBAJAIBFFBEADQCAIIAVBAnQiCWogByAJaioCADgCACAIIAlBBHIiBGogBCAHaioCADgCACAIIAlBCHIiBGogBCAHaioCADgCACAIIAlBDHIiBGogBCAHaioCADgCACAFQQRqIgUgEEcNAAsgBSEEIAxFDQELQQAhBQNAIAggBEECdCIJaiAHIAlqKgIAOAIAIARBAWohBCAFQQFqIgUgDEcNAAsLIAtBAWoiCyANRw0ACwsgCg0BC0EADwsgACABIAMgASADSBsgAmsiASAAKAKIC2o2AogLIAELqQcBBn8gACgCUCIBRQRAIAAoAhQQCiAAKAJQIQELAkAgACgCGCIDQQBKBH8gAQ0BQQAhAQNAIAAoAlBFBEAgACgCHCABQQJ0aigCABAKIAAoAhghAwsgAUEBaiIBIANIDQALIAAoAlAFIAELDQAgACgCHBAKCwJAIAAoAowDRQ0AIAAoAogCQQBMDQADQCAAKAJQIQECQCAAKAKMAyAFQRhsaiIEKAIQBH8gACgCfCIDIAQtAA0iAkGwEGxqKAIEQQBKBH8gAQ0CQQAhAQNAIAAoAlBFBEAgBCgCECABQQJ0aigCABAKIAAoAnwhAyAELQANIQILIAFBAWoiASADIAJBsBBsaigCBEgNAAsgACgCUAUgAQsNASAEKAIQEAogACgCUAUgAQsNACAEKAIUEAoLIAVBAWoiBSAAKAKIAkgNAAsLIAAoAlAhAQJAIAAoAnwEQCAAKAJ4QQBKBEAgAQ0CQQAhAQNAAkAgACgCUA0AIAAoAnwgAUGwEGxqIgIoAggQCiAAKAJQDQAgAigCHBAKIAAoAlANACACKAIgEAogACgCUA0AIAIoAqQQEAogACgCUA0AIAIoAqgQIgJBBGtBACACGxAKCyABQQFqIgEgACgCeEgNAAsgACgCUCEBCyABDQEgACgCfBAKIAAoAlAhAQsgAQ0AIAAoAoQCEAogACgCUCIBDQAgACgCjAMQCiAAKAJQIQELAkAgACgClANFDQAgACgCkAMiA0EASgRAIAENAUEAIQEDQCAAKAJQRQRAIAAoApQDIAFBKGxqKAIEEAogACgCkAMhAwsgAUEBaiIBIANIDQALIAAoAlAhAQsgAQ0AIAAoApQDEAogACgCUCEBCwJAIAAoAgRBAEoEfyABDQEgAEHkB2ohBiAAQaAHaiEDIABBoAZqIQRBACEBA0ACQCAAKAJQDQAgBCABQQJ0IgJqKAIAEAogACgCUA0AIAIgA2ooAgAQCiAAKAJQDQAgAiAGaigCABAKCyABQQFqIgIgACgCBEgEQCABQQ9JIQUgAiEBIAUNAQsLIAAoAlAFIAELDQAgACgCrAgQCiAAKAJQDQAgACgCtAgQCiAAKAJQDQAgACgCvAgQCiAAKAJQDQAgACgCxAgQCiAAKAJQDQAgACgCzAgQCiAAKAJQDQAgACgCsAgQCiAAKAJQDQAgACgCuAgQCiAAKAJQDQAgACgCwAgQCiAAKAJQDQAgACgCyAgQCiAAKAJQDQAgACgC0AgQCgsLyQQCCH8BfQJAIAEtABUEQCAFKAIAIQsgBCgCACEIQQEhDQJAIAdBAEoEQCABKAIAIQwgAyAGbCEOIAFBJGohDwNAIAAoAvQKQQlMBEAgABAVCwJ/IA8gACgC8AoiCUH/B3FBAXRqLgEAIgZBAE4EQCAAIAkgASgCCCAGai0AACIJdjYC8AogACAAKAL0CiAJayIJQQAgCUEAShs2AvQKQX8gBiAJQQBIGwwBCyAAIAEQFgshBiABLQAXBEAgBiABKAKsEE4NBQsgBkEASARAIAAtAOAKRQRAQQAhDSAAKALoCg0ECyAAQRU2AmRBAA8LIA4gAyALbCIJayAIaiAMIAkgDGogCGogDkobIQwgASgCACAGbCEJAkAgAS0AFgRAIAxBAEwNASABKAIcIAlBAnRqIQlBACEGQwAAAAAhEANAIBAgCSAGQQJ0aioCAJIhECACIAhBAnRqKAIAIgoEQCAKIAtBAnRqIgogECAKKgIAkjgCAAtBACAIQQFqIgggAyAIRiIKGyEIIAogC2ohCyAGQQFqIgYgDEcNAAsMAQtBACEGIAxBAEwNAANAIAIgCEECdGooAgAiCgRAIAogC0ECdGoiCiAKKgIAIAEoAhwgCUECdGogBkECdGoqAgBDAAAAAJKSOAIAC0EAIAhBAWoiCCADIAhGIgobIQggCiALaiELIAZBAWoiBiAMRw0ACwsgByAMayIHQQBKDQALCyAEIAg2AgAgBSALNgIACyANDwsgAEEVNgJkQQAPC0HJCkHWDkHNCRAFAAu4BAIEfQJ/IABBA3FFBEAgAEECdSIKQQBKBEAgASACQQJ0aiIAIANBAnRqIQMDQCADQQRrIgEqAgAhBSAAIAAqAgAiBiADKgIAIgeSOAIAIABBBGsiAiACKgIAIgggASoCAJI4AgAgAyAGIAeTIgYgBCoCAJQgCCAFkyIFIAQqAgSUkzgCACABIAUgBCoCAJQgBiAEKgIElJI4AgAgA0EMayIBKgIAIQUgAEEIayICIAIqAgAiBiADQQhrIgIqAgAiB5I4AgAgAEEMayIJIAkqAgAiCCABKgIAkjgCACACIAYgB5MiBiAEKgIglCAIIAWTIgUgBCoCJJSTOAIAIAEgBSAEKgIglCAGIAQqAiSUkjgCACADQRRrIgEqAgAhBSAAQRBrIgIgAioCACIGIANBEGsiAioCACIHkjgCACAAQRRrIgkgCSoCACIIIAEqAgCSOAIAIAIgBiAHkyIGIAQqAkCUIAggBZMiBSAEKgJElJM4AgAgASAFIAQqAkCUIAYgBCoCRJSSOAIAIANBHGsiASoCACEFIABBGGsiAiACKgIAIgYgA0EYayICKgIAIgeSOAIAIABBHGsiCSAJKgIAIgggASoCAJI4AgAgAiAGIAeTIgYgBCoCYJQgCCAFkyIFIAQqAmSUkzgCACABIAUgBCoCYJQgBiAEKgJklJI4AgAgA0EgayEDIABBIGshACAEQYABaiEEIApBAUshASAKQQFrIQogAQ0ACwsPC0HMDUHuEkGNCxAFAAuqBAIEfQJ/IABBAnUiCkEASgRAIAEgAkECdGoiACADQQJ0aiEDA0AgA0EEayIBKgIAIQUgACAAKgIAIgYgAyoCACIHkjgCACAAQQRrIgIgAioCACIIIAEqAgCSOAIAIAMgBiAHkyIGIAQqAgCUIAggBZMiBSAEKgIElJM4AgAgASAFIAQqAgCUIAYgBCoCBJSSOAIAIANBDGsiASoCACEFIABBCGsiAiACKgIAIgYgA0EIayICKgIAIgeSOAIAIABBDGsiCSAJKgIAIgggASoCAJI4AgAgAiAGIAeTIgYgBCoCQJQgCCAFkyIFIAQqAkSUkzgCACABIAUgBCoCQJQgBiAEKgJElJI4AgAgA0EUayIBKgIAIQUgAEEQayICIAIqAgAiBiADQRBrIgIqAgAiB5I4AgAgAEEUayIJIAkqAgAiCCABKgIAkjgCACACIAYgB5MiBiAEKgKAAZQgCCAFkyIFIAQqAoQBlJM4AgAgASAFIAQqAoABlCAGIAQqAoQBlJI4AgAgA0EcayIBKgIAIQUgAEEYayICIAIqAgAiBiADQRhrIgIqAgAiB5I4AgAgAEEcayIJIAkqAgAiCCABKgIAkjgCACACIAYgB5MiBiAEKgLAAZQgCCAFkyIFIAQqAsQBlJM4AgAgASAFIAQqAsABlCAGIAQqAsQBlJI4AgAgBEGAAmohBCADQSBrIQMgAEEgayEAIApBAUshASAKQQFrIQogAQ0ACwsLwgEBBH8CQCAAKAIgIgEgACgCKCIETwRAIABBATYCYAwBCyAAIAFBAWoiAzYCICABLQAAIQIgAyEBCwJAIAEgBE8EQCAAQQE2AmAMAQsgACABQQFqIgM2AiAgAS0AAEEIdCACciECIAMhAQsCQCABIARPBEAgAEEBNgJgDAELIAAgAUEBaiIDNgIgIAEtAABBEHQgAnIhAiADIQELIAEgBE8EQCAAQQE2AmAgAg8LIAAgAUEBajYCICABLQAAQRh0IAJyC+kBAQN/An8CQAJAAkADQCAAKALkCkF/Rw0DIAAoAiAiASAAKAIoIgNPDQEgACABQQFqIgI2AiAgAS0AAEHPAEcNAiACIANPDQEgACABQQJqIgI2AiAgAS0AAUHnAEcNAiACIANPDQEgACABQQNqIgI2AiAgAS0AAkHnAEcNAiACIANPDQEgACABQQRqNgIgIAEtAANB0wBHDQJBACAAEBJFDQQaIAAtAN8KQQFxRQ0ACyAAQSA2AmRBAA8LIABBATYCYAsgAEEeNgJkQQAPCyAAQgA3AvQKIABBADYC6AogAEEAOgDgCkEBCwuTAQEBfwJAAkAgAC0A4AoiAUUEQEF/IQEgACgC6AoNASAAEBRFDQEgAC0A4AoiAUUNAgsgACABQQFrOgDgCiAAIAAoAvgKQQFqNgL4CiAAKAIgIgEgACgCKE8EQCAAQQE2AmBBACEBDAELIAAgAUEBajYCICABLQAAIQELIABBADYC9AogAQ8LQfoMQaEMQZ0IEAUAC4cFAQV/AkACQAJ/AkACQAJAAn8CQAJAAkACfyAALQDgCiIBRQRAIAAoAugKBEAgAEEANgL0CiAAQfQKaiECQX8hBQwDCyAAEBQhAiAALQDgCiEBQX8gAkUNARogAUH/AXFFDQsLIAAgAUEBayIBOgDgCiAAIAAoAvgKQQFqNgL4CiAAKAIgIgIgACgCKE8EQCAAQQE2AmBBAAwBCyAAIAJBAWo2AiAgAi0AAAshBSAAQQA2AvQKIABB9ApqIQIgAUH/AXENAiAAKALoCkUNAQsgAkEANgIAQYB+IQMMAwsgABAUIQMgAC0A4AohAUGAfiADRQ0BGiABQf8BcUUNBwsgACABQQFrIgE6AOAKIAAgACgC+ApBAWo2AvgKIAAoAiAiAyAAKAIoTwRAIABBATYCYEEADAELIAAgA0EBajYCICADLQAAQQh0CyEDIAJBADYCACABQf8BcQ0CIAAoAugKRQ0BCyACQQA2AgBBgICAeCEBQYCAfCEEDAMLIAAQFCEEIAAtAOAKIQFBgIB8IARFDQEaIAFB/wFxRQ0DCyAAIAFBAWsiAToA4AogACAAKAL4CkEBajYC+AogACgCICIEIAAoAihPBEAgAEEBNgJgQQAMAQsgACAEQQFqNgIgIAQtAABBEHQLIQQgAkEANgIAIAFB/wFxRQRAQYCAgHghASAAKALoCg0BIAAQFEUNASAALQDgCiIBRQ0CCyAAIAFBAWs6AOAKIAAgACgC+ApBAWo2AvgKIAAoAiAiASAAKAIoTwRAIABBATYCYEEAIQEMAQsgACABQQFqNgIgIAEtAABBGHQhAQsgAkEANgIAIAMgBWogBGogAWoPC0H6DEGhDEGdCBAFAAtVAQJ/IAAgAUEHakF4cSIBIAAoAghqNgIIIAAoAlAiAgRAIAEgACgCWCIBaiIDIAAoAlxKBEBBAA8LIAAgAzYCWCABIAJqDwsgAUUEQEEADwsgARAJC58BAQF/IABBAE4EfyAAQf//AE0EQCAAQQ9NBEAgACwA0GAPCyAAQf8DTQRAIABBBXYsANBgQQVqDwsgAEEKdiwA0GBBCmoPCyAAQf///wdNBEAgAEH//x9NBEAgAEEPdiwA0GBBD2oPCyAAQRR2LADQYEEUag8LIABB/////wFNBEAgAEEZdiwA0GBBGWoPCyAAQR52LADQYEEeagVBAAsLFwAgACgCACIAIAEoAgAiAUsgACABSWsLKgEBfCAAQf///wBxuCIBmiABIABBAEgbtrsgAEEVdkH/B3FBlAZrEAe2CxcAIAAvAQAiACABLwEAIgFLIAAgAUlrC5QOAwx/AnwBfSACQQF0QQRqQXhxIgggACgCCGohBiAAIAFBAnRqAn8gACABQQJ0agJ/AkACfwJAIAAoAlAiCQRAIAAoAlgiBSAIaiIEIAAoAlwiCkwNASAEIQMgBSEEQQAMAgsgCA0CIAAgAUECdGpBADYCrAhBAAwDCyAAIAQ2AlggBCAIaiEDIAUgCWoLIQUgACABQQJ0aiILIAU2AqwIIAYgCGohBgJAIAMgCkoEQCAEIQMMAQsgACADNgJYIAQgCWohBwsgCyAHNgK0CCAAIAYgAkEEakF4cSIEaiILNgIIQQAgCiADIARqIgRIDQIaIAAgBDYCWCADIAlqDAILIAAgAUECdGogCBAJIgU2AqwIIAYgCGohBiAIEAkLIgc2ArQIIAAgBiACQQRqQXhxIgRqIgs2AghBACAERQ0AGiAEEAkLIgY2ArwIAkAgBUUNACAHRQ0AIAZFDQAgAkECdSIKQQBKBEAgArghD0EAIQNBACEEA0AgBSADQQJ0IgxqIARBAnS4RBgtRFT7IQlAoiAPoyIQECa2OAIAIAUgA0EBciINQQJ0Ig5qIBAQJ7aMOAIAIAcgDGogDbhEGC1EVPshCUCiIA+jRAAAAAAAAOA/oiIQECa2QwAAAD+UOAIAIAcgDmogEBAntkMAAAA/lDgCACADQQJqIQMgBEEBaiIEIApHDQALCyACQQN1IgdBAEoEQCACuCEPQQAhA0EAIQQDQCAGIANBAnRqIANBAXIiBUEBdLhEGC1EVPshCUCiIA+jIhAQJrY4AgAgBiAFQQJ0aiAQECe2jDgCACADQQJqIQMgBEEBaiIEIAdHDQALCyAAIAggC2oiBjYCCAJAIAAgAUECdGoCfwJAAkAgCQRAIAAoAlgiBCAIaiIDIAAoAlxKDQEgACADNgJYIAQgCWoMAwsgCA0BC0HECCEDDAILIAgQCQsiBDYCxAggBEUNASACQQF1IgVBAEoEQCAFuCEPQQAhAwNAIAQgA0ECdGogA7hEAAAAAAAA4D+gIA+jRAAAAAAAAOA/okQYLURU+yEJQKIQJ7YiESARlLtEGC1EVPsh+T+iECe2OAIAIANBAWoiAyAFRw0ACwsgACAGIApBBmpBeHEiBGo2AgggACABQQJ0agJ/IAkEQCAEIAAoAlgiBGoiAyAAKAJcSgRAQcwIIQMMAwsgACADNgJYIAQgCWoMAQsgBEUEQEHMCCEDDAILIAQQCQsiBDYCzAggBEUNAQJ/QQAgAkEASA0AGiACQf//AE0EQCACQQ9NBEAgAiwA0GAMAgsgAkH/A00EQCACQQV2LADQYEEFagwCCyACQQp2LADQYEEKagwBCyACQf///wdNBEAgAkH//x9NBEAgAkEPdiwA0GBBD2oMAgsgAkEUdiwA0GBBFGoMAQsgAkH/////AU0EQCACQRl2LADQYEEZagwBCyACQR52LADQYEEeagshAyAHQQBKBEAgB0EDcSEBQSQgA2shAEEAIQVBACEDAkAgB0EESQ0AIAdB/P///wdxIQYDQCAEIANBAXRqIAMgA0EQeHNBgP6DeHFBCHYgA0EIeHMiAkEEdkGPnrz4AHEgAkGPnrz4AHFBBHRyIgJBAnZBs+bMmQNxIAJBs+bMmQNxQQJ0ciICQQF2QdWq1aoFcSACQdWq1aoFcUEBdHIgAHZBAnQ7AQAgBCADQQFyIgJBAXRqIAMgAkEQeHNBgP6DeHFBCHYgAkEIeHMiAkEEdkGPnrz4AHEgAkGPnrz4AHFBBHRyIgJBAnZBs+bMmQNxIAJBs+bMmQNxQQJ0ciICQQF2QdWq1aoFcSACQdWq1aoFcUEBdHIgAHZBAnQ7AQAgBCADQQJyIgJBAXRqIAMgAkEQeHNBgP6DeHFBCHYgAkEIeHMiAkEEdkGPnrz4AHEgAkGPnrz4AHFBBHRyIgJBAnZBs+bMmQNxIAJBs+bMmQNxQQJ0ciICQQF2QdWq1aoFcSACQdWq1aoFcUEBdHIgAHZBAnQ7AQAgBCADQQNyIgJBAXRqIAMgAkEQeHNBgP6DeHFBCHYgAkEIeHMiAkEEdkGPnrz4AHEgAkGPnrz4AHFBBHRyIgJBAnZBs+bMmQNxIAJBs+bMmQNxQQJ0ciICQQF2QdWq1aoFcSACQdWq1aoFcUEBdHIgAHZBAnQ7AQAgA0EEaiIDIAZHDQALIAENAEEBDwsDQCAEIANBAXRqIAMgA0EQeHNBgP6DeHFBCHYgA0EIeHMiAkEEdkGPnrz4AHEgAkGPnrz4AHFBBHRyIgJBAnZBs+bMmQNxIAJBs+bMmQNxQQJ0ciICQQF2QdWq1aoFcSACQdWq1aoFcUEBdHIgAHZBAnQ7AQAgA0EBaiEDIAVBAWoiBSABRw0ACwtBAQ8LIAAgA2ogAUECdGpBADYCAAsgAEEDNgJkQQALwAECAXwCfyMAQRBrIgIkAAJ8IAC9QiCIp0H/////B3EiA0H7w6T/A00EQEQAAAAAAADwPyADQZ7BmvIDSQ0BGiAARAAAAAAAAAAAED0MAQsgACAAoSADQYCAwP8HTw0AGiAAIAIQPiEDIAIrAwghACACKwMAIQECQAJAAkACQCADQQNxQQFrDgMBAgMACyABIAAQPQwDCyABIABBARA/mgwCCyABIAAQPZoMAQsgASAAQQEQPwshASACQRBqJAAgAQvEAQICfwF8IwBBEGsiASQAAkAgAL1CIIinQf////8HcSICQfvDpP8DTQRAIAJBgIDA8gNJDQEgAEQAAAAAAAAAAEEAED8hAAwBCyACQYCAwP8HTwRAIAAgAKEhAAwBCyAAIAEQPiECIAErAwghACABKwMAIQMCQAJAAkACQCACQQNxQQFrDgMBAgMACyADIABBARA/IQAMAwsgAyAAED0hAAwCCyADIABBARA/miEADAELIAMgABA9miEACyABQRBqJAAgAAv0ewQbfwd8An4CfSMAQeATayICJAACQCAABEAgAkEEaiIDQQBB6Av8CwAgAiAANgIkIAJBfzYCkAsgAiAANgIoIAIgATYCMCACIAAgAWo2AiwgAkEBOgDlCgJAAkACQAJAIAFBAEwNACACIABBAWo2AiQgAC0AAEHPAEcNASABQQFGDQAgAiAAQQJqNgIkIAAtAAFB5wBHDQEgAUEDSA0AIAIgAEEDajYCJCAALQACQecARw0BIAFBA0YNACACIABBBGo2AiQgAC0AA0HTAEcNASADEBJFDQMgAi0A4woiAEECcQ0CIAJBIjYCaAwDCyACQQE2AmQLIAJBHjYCaAwBCyAAQQRxBEAgAkEiNgJoDAELIABBAXEEQCACQSI2AmgMAQsgAigC4AhBAUcEQCACQSI2AmgMAQsgAi0A5AgiAEEeRwRAAkAgAEHAAEcNAAJAIAIoAiQiAEEGaiIBIAIoAiwiA0sNACAALwAEIQQgACgAACEHIAIgATYCJCAHQebSzcMGRw0BIARB5cIBRw0BIAEgA08NACACIABBB2oiATYCJCAALQAGQeQARw0BAkAgASADTwRAIAJBATYCZAwBCyACIABBCGo2AiQgAC0ABw0CCyACQSY2AmgMAwsgAkEBNgJkCyACQSI2AmgMAQsCQAJAIAIoAiQiACACKAIsIgFPBEAgAkEBNgJkDAELIAIgAEEBajYCJCAALQAAQQFGDQELIAJBIjYCaAwBCyABIABBB2oiA0kEQCACQoGAgICgATcCZAwBCyAAKAABIQEgAC8ABSEAIAIgAzYCJCABQfbeyZMGcyAAQenmAXNyBEAgAkEiNgJoDAELIAJBBGoQHARAIAJBIjYCaAwBCwJAAkAgAigCJCIAIAIoAixPBEAgAkEANgIIIAJBATYCZAwBCyACIABBAWo2AiQgAiAALQAAIgA2AgggAA0BCyACQSI2AmgMAQsgAEERTwRAIAJBBTYCaAwBCyACIAJBBGoQHCIANgIEIABFBEAgAkEiNgJoDAELIAJBBGoiABAcGiAAEBwaIAAQHBoCQCACKAIkIgEgAigCLCIETwRAIAJBATYCZEEAIQAMAQsgAiABQQFqIgM2AiQgAS0AACEAIAMhAQsgAkEBIABBD3EiA3Q2AnQgAkEBIABBBHZBD3EiB3Q2AnggA0EOa0F3TQRAIAJBFDYCaAwBCyAAQSBqwEEATgRAIAJBFDYCaAwBCyADIAdLBEAgAkEUNgJoDAELAkACQCABIARPBEAgAkEBNgJkDAELIAIgAUEBajYCJCABLQAAQQFxDQELIAJBIjYCaAwBCwJ/AkACQCACQQRqIgAoAiAiASAAKAIoIgNPDQAgACABQQFqIgQ2AiAgAS0AAEHPAEcNASADIARNDQAgACABQQJqIgQ2AiAgAS0AAUHnAEcNASADIARNDQAgACABQQNqIgQ2AiAgAS0AAkHnAEcNASADIARNDQAgACABQQRqNgIgIAEtAANB0wBHDQEgABASDAILIABBATYCYAsgAEEeNgJkQQALRQ0AIAAQHUUNACAAEBRFDQACQAJAAkACQAJAIAAQHkEDRgRAIAAQHiEBIAAQHiEDIAAQHiEEIAAQHiEHIAAQHiEGIAAQHiEAAkAgAUH/AXEgA0EIdEGA/gNxIARBEHRBgID8B3EgB0EYdHJyckH23smTBkYEQCAGQf8BcSAAQQh0QYD+A3FyQenmAUYNAQsgAkEUNgJoDAcLIAIgAkEEaiIAIAAQHyIBQQFqECAiAzYCGAJAAkAgAwRAQQAhACABQQBKBH8DQCACQQRqEB4hAyACKAIYIABqIAM6AAAgAEEBaiIAIAFHDQALIAIoAhgFIAMLIAFqQQA6AAAgAkEEaiIBEB8hACACQQA2AiAgAiAANgIcAkACQCAAQQBMDQAgAiABIABBAnQQICIANgIgIABFBEAgAkEDNgJoDAwLIAIoAhxBAEwNAANAIAJBBGoiACAAEB8iAUEBahAgIQMgBUECdCIEIAIoAiBqIAM2AgAgA0UNAkEAIQAgAUEASgR/A0AgAkEEahAeIQMgAigCICAEaigCACAAaiADOgAAIABBAWoiACABRw0ACyACKAIgIARqKAIABSADCyABakEAOgAAIAVBAWoiBSACKAIcSA0ACwsgAkEEahAeQQFxRQRAIAJBFDYCaAwLCyACIAIoAiQgAi0A5ApqIgA2AiQgAigCLCAATQRAIAJBATYCZAsgAkEAOgDkCiACIAJBBGoQFCIAIAIoAiRqIgE2AiQgAigCLCABTQRAIAJBATYCZAsgAkEAOgDkCiAABEADQCACIAJBBGoQFCIAIAIoAiRqIgE2AiQgAigCLCABTQRAIAJBATYCZAsgAkEAOgDkCiAADQALCyACQQRqIgQQHUUNCgJAIAItADRFDQAgBCgCICEFAn8CQCAEKALkCiIBQX9GBH9BAQUCQCAEKALcCCIDIAFMBEAgASEADAELIARB4AhqIQcgASEAA0AgBSAAIAdqLQAAIgZqIQUgBkH/AUcNASAAQQFqIgAgA0cNAAsgAyEAC0EBIQcgBSAEKAIoSw0BIABBf0YgACADRnILIQAgAUF/RyEBA0BBASAAQQFxRQ0CGkEBIQcgBCgCKCIDIAVBGmpNDQFBFSEHIAUoAABBz86dmwVHDQEgBS0ABA0BAkAgAUUEQCAEKALgB0UNASAFLQAFQQFxRQ0BDAMLIAUtAAVBAXFFDQILQQEhByAFQRtqIgYgBS0AGiIBaiIFIANLDQFBACEAAkAgAUUNAANAIAUgACAGai0AACIHaiEFIAdB/wFHDQEgAEEBaiIAIAFHDQALIAEhAAsgACABRiEAQQEhASADIAVPDQALQQEhBwsgBCAHNgJkQQALDQAgAigCaEEVRw0LIAJBFDYCaAwLCyACQQRqIgAQHkEFRgRAIAAQHiEBIAAQHiEDIAAQHiEEIAAQHiEHIAAQHiEGIAAQHiEAAkAgAUH/AXEgA0EIdEGA/gNxIARBEHRBgID8B3EgB0EYdHJyckH23smTBkYEQCAGQf8BcSAAQQh0QYD+A3FyQenmAUYNAQsgAkEUNgJoDAwLIAIgAkEEaiIAQQgQE0EBaiIBNgJ8IAIgACABQbAQbBAgIgA2AoABIABFBEAgAkEDNgJoDAwLIAIoAnxBsBBsIgEEQCAAQQAgAfwLAAsCQAJAAkAgAigCfEEASgRAA0AgAigCgAEhACACQQRqQQgQE0H/AXFBwgBHBEAgAkEUNgJoDBELIAJBBGpBCBATQf8BcUHDAEcEQCACQRQ2AmgMEQsgAkEEakEIEBNB/wFxQdYARwRAIAJBFDYCaAwRCyAAIAxBsBBsaiIAIAJBBGoiA0EIEBNB/wFxIANBCBATQQh0cjYCACAAIANBCBATQf8BcSADQQgQE0EIdEGA/gNxIANBCBATQRB0cnI2AgRBACEBIANBARATIgRFBEAgA0EBEBMhAQsgACABOgAXIAAoAgQhAwJAIAAoAgANACADRQ0AIAJBFDYCaAwRCwJAAkACQCABQf8BcQRAIANBB2pBeHEhASACKAJUIgMEQCACKAJgIAFrIgEgAigCXEgNAyACIAE2AmAgASADaiEGDAILIAEQCSEGDAELIAAgAkEEaiADECAiBjYCCAsgBg0BCyACQQM2AmgMEQsgAEEEaiELAkAgBEUEQEEAIQNBACEBIAsoAgAiBUEATA0BA0ACQAJAIAAtABcEQCACQQRqQQEQE0UNAQsgASAGaiACQQRqQQUQE0EBaiIEOgAAIARB/wFxQSBHBEAgA0EBaiEDDAILIAJBFDYCaAwVCyABIAZqQf8BOgAACyABQQFqIgEgCygCACIFSA0ACwwBCyACQQRqQQUQEyEEQQAhA0EAIQEgCygCACIFQQBMDQADQCACQQRqIAUgAWsQIRATIQUgBEEBaiIEQSBOBEAgAkEUNgJoDBMLIAEgBWoiByALKAIASgRAIAJBFDYCaAwTCyAFBEAgASAGaiAEIAX8CwALIAsoAgAiBSAHIgFKDQALCwJAAkACQAJAAkAgAC0AFwRAIAMgBUECdUgNASACKAIUIAVIBEAgAiAFNgIUCyAAIAJBBGogBRAgIgE2AgggAUUEQCACQQM2AmgMFwsgCygCACIDBEAgASAGIAP8CgAACwJAIAIoAlQEQCACIAIoAmAgCygCACIFQQdqQXhxajYCYAwBCyAGEAogCygCACEFCyAAQQA6ABcgACgCCCEGCwJAIAVBAEwEQEEAIQgMAQsgBUEDcSEJQQAhBEEAIQFBACEIIAVBBE8EQCAFQfz///8HcSEBQQAhAwNAIAggAyAGaiIHLQAAQQtrQf8BcUH0AUlqIActAAFBC2tB/wFxQfQBSWogBy0AAkELa0H/AXFB9AFJaiAHLQADQQtrQf8BcUH0AUlqIQggA0EEaiIDIAFHDQALIAlFDQELA0AgCCABIAZqLQAAQQtrQf8BcUH0AUlqIQggAUEBaiEBIARBAWoiBCAJRw0ACwsgACAINgKsECAAIAJBBGogBUECdBAgIgE2AiAgAUUNASAAQawQaiEHIAsoAgAhBUEAIQEMBAsgACADNgKsECAAQawQaiEHIAMNAUEAIQhBACEBDAILIAJBAzYCaAwTCyAAIAJBBGogAxAgIgE2AgggAUUEQCACQQM2AmgMEwsgBygCACIFQQJ0QQRqQXhxIQECfyACKAJUIgMEQCACKAJgIAFrIgQgAigCXEgEQCAAQQA2AiAMFAsgAiAENgJgIAAgAyAEaiIENgIgIARFDRMgAigCYCABayIBIAIoAlxIDQYgAiABNgJgIAEgA2oMAQsgACABEAkiAzYCICADRQ0SIAEQCQsiAUUNBCAFQQN0IQggCygCACEFCyAFIAhqIgMgAigCFE0NACACIAM2AhQLAn8gASEJQQAhBEEAIQMjAEGAAWsiCCQAIAhBAEGAAfwLAAJAAkACQAJAAkACQAJAIAVBAEwNAANAIAQgBmotAABB/wFHDQEgBEEBaiIEIAVHDQALDAELIAQgBUcNAQtBASEKIAAoAqwQRQ0BQY4NQcYIQe0KEAUACyAEIAZqIgotAAAiDkEgTw0BIAAoAiAhAQJAIAAtABdFBEAgASAEQQJ0akEANgIADAELIAFBADYCACAAKAIIIA46AAAgCSAENgIACwJAIAotAAAiCkUNACAKQQNxIQ5BASEBIApBBE8EQAJAIApBBGsiDUECdiIKBEAgCkEBakH+////B3EhDwNAIAggAUECdGoiCkEBQRkgAWt0NgIcIApBAUEaIAFrdDYCGCAKQYCAgMAAIAF2NgIUIApBAUEcIAFrdDYCECAKQQFBHSABa3Q2AgwgCkEBQR4gAWt0NgIIIApBgICAgHggAXY2AgQgCkEBQSAgAWt0NgIAIAFBCGohASADQQJqIgMgD0cNAAsgDUEEcQ0BCyAIIAFBAnRqIgNBAUEdIAFrdDYCDCADQQFBHiABa3Q2AgggA0GAgICAeCABdjYCBCADQQFBICABa3Q2AgAgAUEEaiEBCyAORQ0BC0EAIQMDQCAIIAFBAnRqQQFBICABa3Q2AgAgAUEBaiEBIANBAWoiAyAORw0ACwtBASEKIARBAWoiAyAFTg0AQQEhDgNAAkAgAyAGaiIRLQAAIgRB/wFGDQAgBEEfSw0EQQAhCiAEIgFFDQIDQCAIIAFBAnRqIg8oAgAiDUUEQCABQQFKIQ0gAUEBayEBIA0NAQwECwsgD0EANgIAIA0gDUEQeHNBgP6DeHFBCHYgDUEIeHMiCkEEdkGPnrz4AHEgCkGPnrz4AHFBBHRyIgpBAnZBs+bMmQNxIApBs+bMmQNxQQJ0ciIKQQF2QdWq1aoFcSAKQdWq1aoFcUEBdHIhCiAAKAIgIQ8CQCAALQAXRQRAIA8gA0ECdGogCjYCAAwBCyAPIA5BAnQiEGogCjYCACAAKAIIIA5qIAQ6AAAgCSAQaiADNgIACyAOQQFqIQ4gASARLQAAIgRPDQADQCAIIARBAnRqIgooAgANBiAKQQFBICAEa3QgDWo2AgAgBEEBayIEIAFKDQALC0EBIQogA0EBaiIDIAVHDQALCyAIQYABaiQAIAoMAwtB7gxBxwhB7QoQBQALQecMQdUIQe0KEAUAC0G6DUHkCEHtChAFAAtFBEACQCAALQAXRQ0AIAIoAlQNACAJEAoLIAJBFDYCaAwRCyAHKAIAIgEEQCAAIAJBBGogAUECdEEEahAgIgE2AqQQIAFFBEAgAkEDNgJoDBILIAAgAkEEaiAAKAKsEEECdEEEahAgIgE2AqgQIAFFBEAgAkEDNgJoDBILIAAgAUEEajYCqBAgAUF/NgIAQQAhBEEAIQECQCAALQAXBEAgACgCrBAiBEEATA0BIAAoAqQQIQUgACgCICEIA0AgBSABQQJ0IgNqIAMgCGooAgAiAyADQRB4c0GA/oN4cUEIdiADQQh4cyIDQQR2QY+evPgAcSADQY+evPgAcUEEdHIiA0ECdkGz5syZA3EgA0Gz5syZA3FBAnRyIgNBAXZB1arVqgVxIANB1arVqgVxQQF0cjYCACABQQFqIgEgACgCrBAiBEgNAAsMAQsgACgCBCIFQQBKBEADQCABIAZqLQAAQQFqQf8BcUEMTwRAIAAoAqQQIARBAnRqIAAoAiAgAUECdGooAgAiAyADQRB4c0GA/oN4cUEIdiADQQh4cyIDQQR2QY+evPgAcSADQY+evPgAcUEEdHIiA0ECdkGz5syZA3EgA0Gz5syZA3FBAnRyIgNBAXZB1arVqgVxIANB1arVqgVxQQF0cjYCACAAKAIEIQUgBEEBaiEECyABQQFqIgEgBUgNAAsLIAQgACgCrBBGDQBBsgpBpwlBqAsQBQALIAAoAqQQIARBAhAqIAAoAqQQIAAoAqwQQQJ0akF/NgIAAkACQCAAQawQQQQgAC0AFxtqKAIAIg1BAEoEQEEAIQUDQAJAAkAgAC0AFyIPBEAgBiAJIAVBAnRqKAIAai0AACIDQf8BRw0BQdgMQZMJQeIIEAUACyAFIAZqLQAAIgNBAWpB/wFxQQxJDQELIAVBAnQiESAAKAIgaigCACIBIAFBEHhzQYD+g3hxQQh2IAFBCHhzIgFBBHZBj568+ABxIAFBj568+ABxQQR0ciIBQQJ2QbPmzJkDcSABQbPmzJkDcUECdHIiAUEBdkHVqtWqBXEgAUHVqtWqBXFBAXRyIQggACgCpBAhCkEAIQEgACgCrBAiBEECTgRAA0AgASAEQQF2Ig4gAWoiASAKIAFBAnRqKAIAIAhLIhAbIQEgDiAEIA5rIBAbIgRBAUoNAAsLIAogAUECdCIEaigCACAIRw0DIA8EQCAAKAKoECAEaiAJIBFqKAIANgIAIAAoAgggAWogAzoAAAwBCyAAKAKoECAEaiAFNgIACyAFQQFqIgUgDUcNAAsLDAELQfcLQcUJQagLEAUACwsgAC0AFwRAAkACQCACAn8gAigCVARAIABBIGohASAAKAKsEEECdEEEakF4cSIDIAMgAigCYGpqDAELIAkQCiAAQSBqIQEgAigCVARAIAIoAmAgBygCAEECdEEEakF4cWoMAQsgACgCIBAKIAIoAlRFDQEgAigCYAsgCygCAEEHakF4cWo2AmAMAQsgBhAKCyABQQA2AgALIAAiBEEkaiIDQf8BQYAQ/AsAAkAgAEGsEEEEIAAtABciARtqKAIAIgBBAEwNAEH//wEgACAAQf//AU4bIQYgBCgCCCEFQQAhACABRQRAA0ACQCAAIAVqIgktAABBCksNACAEKAIgIABBAnRqKAIAIgFBgAhPDQADQCADIAFBAXRqIAA7AQBBASAJLQAAdCABaiIBQYAISQ0ACwsgAEEBaiIAIAZHDQAMAgsACwNAAkAgACAFaiIJLQAAQQpLDQAgBCgCpBAgAEECdGooAgAiASABQRB4c0GA/oN4cUEIdiABQQh4cyIBQQR2QY+evPgAcSABQY+evPgAcUEEdHIiAUECdkGz5syZA3EgAUGz5syZA3FBAnRyIgFBAXZB1arVqgVxIAFB1arVqgVxQQF0ciIBQf8HSw0AA0AgAyABQQF0aiAAOwEAQQEgCS0AAHQgAWoiAUGACEkNAAsLIABBAWoiACAGRw0ACwsgBCACQQRqQQQQEyIAOgAVIABB/wFxIgBBA08EQCACQRQ2AmgMEQsCQCAARQ0AIAQgAkEEaiIAQSAQExAjOAIMIAQgAEEgEBMQIzgCECAEIABBBBATQQFqOgAUIAQgAEEBEBM6ABYgBCgCACEGIAQoAgQhAwJAIAQtABUiBUEBRgRAIAMCfEEAIQECfAJAAnwgA7K7Ih29IiRCMIinIQAgJEKAgICAgICA9z99Qv//////n8IBWARARAAAAAAAAAAAICRCgICAgICAgPg/UQ0BGiAdRAAAAAAAAPC/oCIdIB0gHUQAAAAAAACgQaIiHqAgHqEiHiAeokH4PysDACIhoiIioCIjIB0gHSAdoiIfoiIgICAgICAgQcjAACsDAKIgH0HAwAArAwCiIB1BuMAAKwMAokGwwAArAwCgoKCiIB9BqMAAKwMAoiAdQaDAACsDAKJBmMAAKwMAoKCgoiAfQZDAACsDAKIgHUGIwAArAwCiQYDAACsDAKCgoKIgHSAeoSAhoiAdIB6goiAiIB0gI6GgoKCgDAELAkAgAEHw/wFrQZ+Afk0EQCAdRAAAAAAAAAAAYQRAIwBBEGsiAEQAAAAAAADwvzkDCCAAKwMIRAAAAAAAAAAAowwDCyAkQoCAgICAgID4/wBRDQEgAEHw/wFxQfD/AUcgAEH//wFNcUUEQCAdIB2hIh0gHaMMAwsgHUQAAAAAAAAwQ6K9QoCAgICAgICgA30hJAsgJEKAgICAgICA8z99IiVCNIe5Ih9BwD8rAwCiICVCLYinQf8AcUEEdCIAKwPYQKAiICAAKwPQQCAkICVCgICAgICAgHiDfb8gACsD0FChIAArA9hQoaIiHaAiISAdIB0gHaIiHqIgHiAdQfA/KwMAokHoPysDAKCiIB1B4D8rAwCiQdg/KwMAoKCiIB5B0D8rAwCiIB9ByD8rAwCiIB0gICAhoaCgoKCgIR0LIB0LtiAGspW7Ih29QjSIp0H/D3EiAEHJB2tBP0kEQCAAIQEMAQsgHUQAAAAAAADwP6AiHiAAQckHSQ0CGiAAQYkISQ0ARAAAAAAAAAAAIB29IiRCgICAgICAgHhRDQEaIB4gAEH/D08NAhogJEIAUwRAIwBBEGsiAEQAAAAAAAAAEDkDCCAAKwMIRAAAAAAAAAAQogwDCyMAQRBrIgBEAAAAAAAAAHA5AwggACsDCEQAAAAAAAAAcKIMAgsgHUGIDisDAKJBkA4rAwAiHqAiHyAeoSIeQaAOKwMAoiAeQZgOKwMAoiAdoKAiHSAdoiIeIB6iIB1BwA4rAwCiQbgOKwMAoKIgHiAdQbAOKwMAokGoDisDAKCiIB+9IiWnQQR0QfAPcSIAKwP4DiAdoKCgIR0gACkDgA8gJUIthnwhJCABRQRAAnwgJUKAgICACINQBEAgJEKAgICAgICAiD99vyIeIB2iIB6gRAAAAAAAAAB/ogwBCyAkQoCAgICAgIDwP3y/Ih4gHaIiHyAeoCIdRAAAAAAAAPA/YwR8IwBBEGsiACAAQoCAgICAgIAINwMIIAArAwhEAAAAAAAAEACiOQMIRAAAAAAAAAAAIB1EAAAAAAAA8D+gIiAgHyAeIB2hoCAdRAAAAAAAAPA/ICChoKCgRAAAAAAAAPC/oCIdIB1EAAAAAAAAAABhGwUgHQtEAAAAAAAAEACiCwwCCyAkvyIeIB2iIB6gCwuc/AIiALJDAACAP5K7IAa3Ih0QD5z8Ak4gAGoiALIiJkMAAIA/krsgHRAPIAO3ZQR/QX8FQX8gACADICa7IB0QD5z8AkgbCyIGQQBODQEgAkEUNgJoDBMLIAMgBmwhBgsgBCAGNgIYIAZFBEAgAkEUNgJoDBILIAZBAXRBBmpBeHEhAAJ/IAIoAlQiAQRAIAIoAmAgAGsiACACKAJcSA0GIAIgADYCYCAAIAFqDAELIAAQCQsiAEUNBEEAIQECQCAGQQBKBH8DQCACQQRqIAQtABQQEyIDQX9GBEACQCACKAJUBEAgAiACKAJgIAQoAhhBAXRBBmpBeHFqNgJgDAELIAAQCgsgAkEUNgJoDBULIAAgAUEBdGogAzsBACABQQFqIgEgBCgCGCIGSA0ACyAELQAVBSAFC0H/AXFBAUYEQAJAIAQtABciCARAIAcoAgAiAQ0BDAMLIAsoAgAhAQsgBCACQQRqIAEgBCgCAGxBAnQQICIKNgIcIApFBEACQCACKAJUBEAgAiACKAJgIAQoAhhBAXRBBmpBeHFqNgJgDAELIAAQCgsgAkEDNgJoDBQLIAcgCyAIGygCACIOQQBKBEAgBCgCACEFQwAAAAAhJkEAIQMDQCADIQkgCARAIAQoAqgQIANBAnRqKAIAIQkLAkAgBUEATA0AIAogAyAFbEECdGohCyAEKAIYIQdBASEGQQAhASAELQAWRQRAA0AgCyABQQJ0aiAmIAAgCSAGbiAHcEEBdGovAQCzIAQqAhCUIAQqAgySkjgCACAFIAFBAWoiAUoEQCAHrSAGrX5CIIinDRcgBiAHbCEGCyABIAVHDQAMAgsACwNAIAsgAUECdGogJiAAIAkgBm4gB3BBAXRqLwEAsyAEKgIQlCAEKgIMkpIiJjgCACAFIAFBAWoiAUoEQCAHrSAGrX5CIIinDRYgBiAHbCEGCyABIAVHDQALCyADQQFqIgMgDkcNAAsLIARBAjoAFQwBCyAEIAJBBGogBkECdBAgIgM2AhwCQAJAIAMEQCAEKAIYIgFBAEwNAyABQQFHDQFDAAAAACEmQQAhAQwCCwJAIAIoAlQEQCACIAIoAmAgBCgCGEEBdEEGakF4cWo2AmAMAQsgABAKCyACQQM2AmgMFAsgAUEBcSEGIAFB/v///wdxIQVDAAAAACEmQQAhASAELQAWIQcDQCADIAFBAnRqICYgACABQQF0ai8BALMgBCoCEJQgBCoCDJKSIic4AgAgAyABQQFyIglBAnRqICcgJiAHGyAAIAlBAXRqLwEAsyAEKgIQlCAEKgIMkpIiJzgCACAnICYgBxshJiABQQJqIgEgBUcNAAsgBkUNAQsgAyABQQJ0aiAmIAAgAUEBdGovAQCzIAQqAhCUIAQqAgySkjgCAAsgAigCVARAIAIgAigCYCAEKAIYQQF0QQZqQXhxajYCYAwBCyAAEAoLIAxBAWoiDCACKAJ8SA0ACwsCQCACQQRqQQYQE0EBakH/AXEiAUUNAEEAIQADQCACQQRqQRAQE0UEQCABIABBAWoiAEcNAQwCCwsgAkEUNgJoDA8LIAIgAkEEaiIAQQYQE0EBaiIBNgKEASACIAAgAUG8DGwQICIANgKIAgJ/AkAgAARAIAIoAoQBQQBKDQFBAAwCCyACQQM2AmgMEAsgAkGIAWohDkEAIQxBACEKA0AgDiAMQQF0aiACQQRqQRAQEyIAOwEAIABB//8DcSIAQQJPBEAgAkEUNgJoDBELIABFBEAgAigCiAIgDEG8DGxqIgEgAkEEaiIAQQgQEzoAACABIABBEBATOwECIAEgAEEQEBM7AQQgASAAQQYQEzoABiABIABBCBATOgAHIAEgAEEEEBNB/wFxQQFqIgA6AAggACAAQf8BcUYEQCABQQlqIQNBACEAA0AgACADaiACQQRqQQgQEzoAACAAQQFqIgAgAS0ACEkNAAsLIAJBBDYCaAwRCyACKAKIAiAMQbwMbGoiACACQQRqQQUQEyIBOgAAIAFB/wFxBEAgAEEBaiEDQX8hAUEAIQgDQCADIAhqIAJBBGpBBBATIgQ6AAAgBEH/AXEiBCABIAEgBEgbIQEgCEEBaiIIIAAtAABJDQALIABB0gBqIQcgAEHBAGohBiAAQTFqIQUgAEEhaiELQQAhCQNAIAkgC2ogAkEEaiIDQQMQE0EBajoAACAFIAlqIgQgA0ECEBMiCDoAAAJAIAhB/wFxBEAgBiAJaiADQQgQEyIDOgAAIAIoAnwgA0H/AXFMDREgBC0AAEEfRg0BCyAHIAlBBHRqIQNBACEIA0AgAyAIQQF0aiACQQRqQQgQE0EBayINOwEAIAIoAnwgDcFMDREgCEEBaiIIQQEgBC0AAHRIDQALCyABIAlHIQMgCUEBaiEJIAMNAAsLQQIhCSAAIAJBBGoiAUECEBNBAWo6ALQMIAFBBBATIQEgAEECNgK4DEEAIQQgAEEAOwHSAiAAIAE6ALUMIABBASABdDsB1AIgAEHSAmohBUECIQhBACEBAkACQCAALQAAIgZFDQAgAEEhaiEDIABBAWohB0EAIQkDQEEAIQEgAyAHIAlqLQAAaiILLQAABEADQCACQQRqIAAtALUMEBMhBiAFIAAoArgMIghBAXRqIAY7AQAgACAIQQFqIgg2ArgMIAFBAWoiASALLQAASQ0ACyAALQAAIQYLIAlBAWoiCSAGQf8BcUkNAAsgCEEATA0BIAhBA3EhCUEAIQEgCEEESQ0AIAhB/P///wdxIQYDQCAFIAFBAXRqLwEAIQcgAkHwC2oiCyIDIAFBAnRqIg0gATsBAiANIAc7AQAgBSABQQFyIgdBAXRqLwEAIQ0gB0ECdCADaiIPIAc7AQIgDyANOwEAIAUgAUECciIHQQF0ai8BACENIAdBAnQgA2oiAyAHOwECIAMgDTsBACAFIAFBA3IiA0EBdGovAQAhByADQQJ0IAtqIgsgAzsBAiALIAc7AQAgAUEEaiIBIAZHDQALIAlFDQELA0AgBSABQQF0ai8BACEDIAJB8AtqIAFBAnRqIgcgATsBAiAHIAM7AQAgAUEBaiEBIARBAWoiBCAJRw0ACwsgAkHwC2ogCEEDECpBASAAKAK4DCIIIAhBAUwbQQFrIgMEQEEAIQEgAi8B8AshBgNAIAZB//8DcSACQfALaiABQQFqIgFBAnRqLwEAIgZGDQ8gASADRw0ACwsCQCAIQQBMDQAgAEHGBmohA0EAIQEDQCABIANqIAJB8AtqIAFBAnRqLQACOgAAIAFBAWoiASAAKAK4DCIISA0ACyAIQQNIDQAgAEHACGohDUECIQkDQCAFIAlBAXQiD2ohCEF/IQZBgIAEIQdBACEEQQAhA0EAIQEDQCAFIAFBAXRqLwEAIgsgBkoEQCALIAYgCyAILwEASSIRGyEGIAEgBCARGyEECyAHIAtKBEAgCyAHIAsgCC8BAEsiCxshByABIAMgCxshAwsgAUEBaiIBIAlHDQALIA0gD2oiASADOgABIAEgBDoAACAJQQFqIgkgACgCuAwiCEgNAAsLIAggCiAIIApKGyEKIAxBAWoiDCACKAKEAUgNAAsgCkEBdAshDCACIAJBBGoiAEEGEBNBAWoiATYCjAIgAiAAIAFBGGwQICIANgKQAyAARQRAIAJBAzYCaAwPCyACKAKMAkEYbCIBBEAgAEEAIAH8CwALIAIoAowCQQBKBEAgAkGQAmohCUEAIQMDQCACKAKQAyEBIAkgA0EBdGogAkEEaiIEIgBBEBATIgY7AQBBFCEHIAZB//8DcUECSw0MIAEgA0EYbGoiBSAAQRgQEzYCACAFIABBGBATIgE2AgQgASAFKAIASQ0MIAUgAEEYEBNBAWo2AgggBSAAQQYQE0EBajoADCAFIABBCBATIgA6AA0gAigCfCAAQf8BcUwNDEEAIQAgBSAEIAUtAAwEfwNAIAJBBGoiAUEDEBMhBCACQfALaiAAaiABQQEQEwR/IAFBBRATQQN0QfgPcQVBAAsgBGo6AAAgAEEBaiIAIAUtAAwiAUkNAAsgAUEEdAVBAAsQICIBNgIUIAFFDQtBACEAIAUtAAwEQANAAkAgAkHwC2ogAGotAAAiBEEBcQRAIAJBBGpBCBATIQYgBSgCFCIBIABBBHRqIAY7AQAgAigCfCAGwUwNEAwBCyABIABBBHRqQf//AzsBAAsCQCAEQQJxBEAgAkEEakEIEBMhBiAFKAIUIgEgAEEEdGogBjsBAiACKAJ8IAbBTA0QDAELIAEgAEEEdGpB//8DOwECCwJAIARBBHEEQCACQQRqQQgQEyEGIAUoAhQiASAAQQR0aiAGOwEEIAIoAnwgBsFMDRAMAQsgASAAQQR0akH//wM7AQQLAkAgBEEIcQRAIAJBBGpBCBATIQYgBSgCFCIBIABBBHRqIAY7AQYgAigCfCAGwUwNEAwBCyABIABBBHRqQf//AzsBBgsCQCAEQRBxBEAgAkEEakEIEBMhBiAFKAIUIgEgAEEEdGogBjsBCCACKAJ8IAbBTA0QDAELIAEgAEEEdGpB//8DOwEICwJAIARBIHEEQCACQQRqQQgQEyEGIAUoAhQiASAAQQR0aiAGOwEKIAIoAnwgBsFMDRAMAQsgASAAQQR0akH//wM7AQoLAkAgBEHAAHEEQCACQQRqQQgQEyEGIAUoAhQiASAAQQR0aiAGOwEMIAIoAnwgBsFMDRAMAQsgASAAQQR0akH//wM7AQwLAkAgBMBBAEgEQCACQQRqQQgQEyEEIAUoAhQiASAAQQR0aiAEOwEOIAIoAnwgBMFMDRAMAQsgASAAQQR0akH//wM7AQ4LIABBAWoiACAFLQAMSQ0ACwsgBSACQQRqIAIoAoABIAUtAA1BsBBsaigCBEECdBAgIgA2AhAgAEUNC0EAIQQgAigCgAEgBS0ADUGwEGxqKAIEQQJ0IgEEQCAAQQAgAfwLAAsgAigCgAEgBS0ADUGwEGxqIgAoAgRBAEoEQANAIAJBBGogACgCACIAECAhASAEQQJ0IgsgBSgCEGogATYCACABRQ0NIABBAEoEQCAFLQAMIQYgBCEBA0AgAEEBayIHIAUoAhAgC2ooAgBqIAEgBkH/AXFvOgAAIAEgBS0ADCIGbSEBIABBAUshCCAHIQAgCA0ACwsgBEEBaiIEIAIoAoABIAUtAA1BsBBsaiIAKAIESA0ACwsgA0EBaiIDIAIoAowCSA0ACwsgAiACQQRqIgBBBhATQQFqIgE2ApQDIAIgACABQShsECAiADYCmAMgAEUEQCACQQM2AmgMDwtBACEEIAIoApQDQShsIgEEQCAAQQAgAfwLAAsgAigClANBAEoEQANAIAIoApgDIQAgAkEEakEQEBMEQCACQRQ2AmgMEQsgACAEQShsaiIBIAJBBGogAigCCEEDbBAgIgA2AgQgAEUEQCACQQM2AmgMEQsgASACQQRqIgBBARATBH8gAEEEEBNBAWoFQQELOgAIAkAgAkEEaiIAQQEQEwRAIAEgAEEIEBNBAWoiAzsBAAJAIAIoAggiACADQf//A3EiA04EQEEAIQggAw0BDAMLIAJBFDYCaAwTCwNAIAJBBGoiAyAAQQFrECEQEyEAIAhBA2wiByABKAIEaiAAOgAAIAMgAigCCEEBaxAhEBMhAyABKAIEIAdqIgcgAzoAASACKAIIIgAgBy0AACIHTARAIAJBFDYCaAwUCyADQf8BcSIDIABPBEAgAkEUNgJoDBQLIAMgB0cEQCAIQQFqIgggAS8BAE8NAwwBCwsgAkEUNgJoDBILIAFBADsBAAsgAkEEakECEBMEQCACQRQ2AmgMEQsgAigCCCEDAkACQAJAAkACQAJAAkAgAS0ACCILQQFNBEAgA0EATA0FIANBB3EhBSABKAIEIQdBACEGQQAhCCADQQhJDQQgA0EIayIDQQN2IgANAQwCC0EAIQAgA0EATA0FA0ACQCACQQRqQQQQEyEDIAEoAgQgAEEDbGogAzoAAiABLQAIIANB/wFxTQ0AIABBAWoiACACKAIISA0BDAcLCyACQRQ2AmgMFwsgAEEBakH+////A3EhCkEAIQkDQCAHIAhBA2xqIgBBADoALyAAQQA6ACwgAEEAOgApIABBADoAJiAAQQA6ACMgAEEAOgAgIABBADoAHSAAQQA6ABogAEEAOgAXIABBADoAFCAAQQA6ABEgAEEAOgAOIABBADoACyAAQQA6AAggAEEAOgAFIABBADoAAiAIQRBqIQggCUECaiIJIApHDQALIANBCHENAQsgByAIQQNsaiIAQQA6ABcgAEEAOgAUIABBADoAESAAQQA6AA4gAEEAOgALIABBADoACCAAQQA6AAUgAEEAOgACIAhBCGohCAsgBUUNAQsDQCAHIAhBA2xqQQA6AAIgCEEBaiEIIAZBAWoiBiAFRw0ACwsgC0UNAQsgAUEYaiEHIAFBCWohBkEAIQADQCACQQRqIgNBCBATGiAAIAZqIgUgA0EIEBM6AAAgACAHaiADQQgQEyIDOgAAIAIoAoQBIAUtAABMBEAgAkEUNgJoDBMLIAIoAowCIANB/wFxSgRAIABBAWoiACABLQAITw0CDAELCyACQRQ2AmgMEQsgBEEBaiIEIAIoApQDSA0ACwsgAiACQQRqQQYQEyIAQQFqNgKcAwJAIABB/v///wdLDQAgAkGgA2ohBEEAIQEDQCAEIAFBBmxqIgAgAkEEaiIDQQEQEzoAACAAIANBEBATOwECIAAgA0EQEBM7AQQgACADQQgQEyIDOgABIAAvAQIEQCACQRQ2AmgMEQsgAC8BBARAIAJBFDYCaAwRCyACKAKUAyADQf8BcUoEQCABQQFqIgEgAigCnANODQIMAQsLIAJBFDYCaAwPCyACQQRqIgAtAOAKIQECQAJAA0ACQCABQf8BcUUEQCAAKALoCg0BIAAQFEUNASAALQDgCiIBRQ0DCyAAIAFBAWsiAToA4AogACAAKAL4CkEBajYC+AogACgCICIDIAAoAihPBEAgAEEBNgJgBSAAIANBAWo2AiALDAELCwwBC0H6DEGhDEGdCBAFAAsgAkEANgLkByACKAIIQQBKBEAgAkHoB2ohBCACQaQHaiEHIAJBpAZqIQZBACEBA0AgBiABQQJ0IgBqIgUgAkEEaiIDIAIoAnhBAnQQIDYCACAAIAdqIgkgAyACKAJ4QQF0Qf7///8HcRAgNgIAIAAgBGogAyAMECAiADYCAAJAAkAgBSgCACIDRQ0AIAkoAgBFDQAgAA0BCyACQQM2AmgMEQsgAigCeEECdCIABEAgA0EAIAD8CwALIAFBAWoiASACKAIISA0ACwsgAkEEaiIAQQAgAigCdBAlRQ0OIABBASACKAJ4ECVFDQ4gAiACKAJ0NgJsIAIgAigCeCIANgJwIAIgAEEBdEH+////B3EiBCACKAKMAiIHQQBMBH9BBAUgAEECbSEAQQAhASACKAKQAyEGQQAhCANAIAYgCEEYbGoiAygCBCIFIAAgACAFSxsgAygCACIFIAAgACAFSxtrIAMoAghuIgMgASABIANIGyEBIAhBAWoiCCAHRw0ACyABQQJ0QQRqCyACKAIIbCIAIAAgBEkbIgE2AhACQCACKAJUIgBFDQAgAigCYCIDIAIoAlhHDQMgASACKAJcakHoC2ogA00NACACQQM2AmgMDwsgAiACKALoCkF/RgR/QQAgAigCJCACKAIoayACLQA0GwVBAAs2AjggAiACKAIMQegLajYCDAJ/IAAEQCACKAJcIgFB6AtqIgMgAigCYEoNECACIAM2AlwgACABagwBC0HoCxAJCyIERQ0OIAQgAkEEakHoC/wKAAAgBCACQfALaiACQewLaiACQdwTahARBEAgBCACKALwCyACKALsCyACKALcExAXGgsgBCgCACEWIAQoAgQiCkEOdBAJIQAgCkEATA0GIABFDQYgFkEATA0GIApBAnQhGSAEQeAGaiEPIARBoAZqIQ4gCkEMdCERAkADQCAAIQMDQCAKIAQoAgQiECAKIAogEEobIgBBAWoiASABIApIGyIBQQJ0IRogASAAa0ECdCEXIBEgCiAUbCINayAKbSELIAMgDUECdGohByAAQfz///8HcSEbIABBA3EhGEEA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kARqIQcDQCAHIgUgAfwCIgZBwOwAai0AACANcjoAACABIAa3oUQAAAAAAAAwQKIhAQJAIAdBAWoiByAMQZAEamtBAUcNACABRAAAAAAAAAAAYSAIcQ0AIAVBLjoAASAFQQJqIQcLIAFEAAAAAAAAAABiDQALQX8hCiADQfv///8HIA8gECALayIIamtKDQAgAEEgIAIgA0ECaiAHIAxBkARqIgZrIg0gDUECayADSBsgDSADGyIFIAggD0ECciIDamoiByAEEDggACAJIAMQNCAAQTAgAiAHIARBgIAEcxA4IAAgBiANEDQgAEEwIAUgDWtBAEEAEDggACALIAgQNCAAQSAgAiAHIARBgMAAcxA4IAIgByACIAdKGyEKCyAMQbAEaiQAIAoLsgUCBn4DfyABIAEoAgBBB2pBeHEiAUEQajYCACAAIAEpAwAhAiABKQMIIQYjAEEgayIAJAAgBkL///////8/gyEDAn4gBkIwiEL//wGDIgSnIghBgfgAa0H9D00EQCADQgSGIAJCPIiEIQMgCEGA+ABrrSEEAkAgAkL//////////w+DIgJCgYCAgICAgIAIWgRAIANCAXwhAwwBCyACQoCAgICAgICACFINACADQgGDIAN8IQMLQgAgAyADQv////////8HViIBGyECIAGtIAR8DAELAkAgAiADhFANACAEQv//AVINACADQgSGIAJCPIiEQoCAgICAgIAEhCECQv8PDAELIAhB/ocBSwRAQgAhAkL/DwwBC0GA+ABBgfgAIARQIgkbIgogCGsiAUHwAEoEQEIAIQJCAAwBCyADIANCgICAgICAwACEIAkbIQNBACEJIAggCkcEQCACIQQgAyEFAkBBgAEgAWsiCEHAAHEEQCACIAhBQGqthiEFQgAhBAwBCyAIRQ0AIAUgCK0iB4YgBEHAACAIa62IhCEFIAQgB4YhBAsgACAENwMQIAAgBTcDGCAAKQMQIAApAxiEQgBSIQkLAkAgAUHAAHEEQCADIAFBQGqtiCECQgAhAwwBCyABRQ0AIANBwAAgAWuthiACIAGtIgSIhCECIAMgBIghAwsgACACNwMAIAAgAzcDCCAAKQMIQgSGIAApAwAiA0I8iIQhAgJAIAmtIANC//////////8Pg4QiA0KBgICAgICAgAhaBEAgAkIBfCECDAELIANCgICAgICA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QCADIQIDQCAGIAIiBEEDdGogACAGQeADaiACQQJ0aigCALeiOQMAIAJBAWshAiAARAAAAAAAAHA+oiEAIAQNAAsgAyEFA0ACQCAHIAMgBWsiBCAEIAdKGyIJQQBIBEBEAAAAAAAAAAAhAAwBCyAGIAVBA3RqIQxBACECRAAAAAAAAAAAIQADQCACQQN0IggrA7CCASAIIAxqKwMAoiAAoCEAIAIgCUchCCACQQFqIQIgCA0ACwsgBkGgAWogBEEDdGogADkDACAFQQBKIQIgBUEBayEFIAINAAsLRAAAAAAAAAAAIQAgA0EATgRAIAMhAgNAIAIiBEEBayECIAAgBkGgAWogBEEDdGorAwCgIQAgBA0ACwsgCiAAmiAAIAsbOQMAIAYrA6ABIAChIQBBASECIANBAEoEQANAIAAgBkGgAWogAkEDdGorAwCgIQAgAiADRyEEIAJBAWohAiAEDQALCyAKIACaIAAgCxs5AwggBkGwBGokACANQQdxDAILQQEhAgNAIAIiBEEBaiECIAZB4ANqIAcgBGtBAnRqKAIARQ0ACyADIARqIQQDQCAGQcACaiADIAhqIgVBA3RqIBIgA0EBaiIDQQJ0aigCALc5AwBBACECRAAAAAAAAAAAIQAgCEEASgRAA0AgDyACQQN0aisDACAGQcACaiAFIAJrQQN0aisDAKIgAKAhACACQQFqIgIgCEcNAAsLIAYgA0EDdGogADkDACADIARIDQALIAQhAwwACwALIQMgCisDACEAIBhCAFMEQCABIACaOQMAIAEgCisDCJo5AwhBACADayEDDAELIAEgADkDACABIAorAwg5AwgLIApBMGokACADC5kBAQN8IAAgAKIiAyADIAOioiADRHzVz1o62eU9okTrnCuK5uVavqCiIAMgA0R9/rFX4x3HPqJE1WHBGaABKr+gokSm+BARERGBP6CgIQUgACADoiEEIAJFBEAgBCADIAWiRElVVVVVVcW/oKIgAKAPCyAAIAMgAUQAAAAAAADgP6IgBCAFoqGiIAGhIARESVVVVVVVxT+ioKELC+V2lAEAQYAIC/gGLSsgICAwWDB4AC0wWCswWCAwWC0weCsweCAweABnZXQ4X3BhY2tldF9yYXcAY29kZWJvb2tfZGVjb2RlX3NjYWxhcl9yYXcAdm9yYmlzX2RlY29kZV9wYWNrZXRfcmVzdABpbmNsdWRlX2luX3NvcnQAY29kZWJvb2tfZGVjb2RlX3N0YXJ0AG5leHRfc2VnbWVudABmLT5hbGxvYy5hbGxvY19idWZmZXJfbGVuZ3RoX2luX2J5dGVzID09IGYtPnRlbXBfb2Zmc2V0AGNvZGVib29rX2RlY29kZV9kZWludGVybGVhdmVfcmVwZWF0AGdldF9iaXRzAGYtPnRlbXBfb2Zmc2V0ID09IGYtPmFsbG9jLmFsbG9jX2J1ZmZlcl9sZW5ndGhfaW5fYnl0ZXMAayA9PSBjLT5zb3J0ZWRfZW50cmllcwAhYy0+c3BhcnNlIHx8IHogPCBjLT5zb3J0ZWRfZW50cmllcwBjb21wdXRlX2NvZGV3b3JkcwBzdGFydF9kZWNvZGVyAGltZGN0X3N0ZXAzX2l0ZXIwX2xvb3AAbmFuAGNvbXB1dGVfc29ydGVkX2h1ZmZtYW4AZi0+dmFsaWRfYml0cyA+PSBuAHZvcmJpc19kZWNvZGVfaW5pdGlhbABpbmYAIWMtPnNwYXJzZQBjLT5zb3J0ZWRfY29kZXdvcmRzW3hdID09IGNvZGUAL2hvbWUvcnVubmVyL3dvcmsvc3RiLXZvcmJpcy9zdGItdm9yYmlzL3dhc20vc3RiX3ZvcmJpcy5jAE5BTgBJTkYAbGVuICE9IE5PX0NPREUAeiA8IDMyAGxlbltrXSA8IDMyAGYtPmJ5dGVzX2luX3NlZyA+IDAAYy0+c29ydGVkX2VudHJpZXMgPT0gMABmLT5ieXRlc19pbl9zZWcgPT0gMABhdmFpbGFibGVbeV0gPT0gMAAobiAmIDMpID09IDAALgAobnVsbCkAQXNzZXJ0aW9uIGZhaWxlZDogJXMgKCVzOiAlczogJWQpCgAAAAD+gitlRxVnQAAAAAAAADhDAAD6/kIudr86O568mvcMvb39/////98/PFRVVVVVxT+RKxfPVVWlPxfQpGcREYE/AAAAAAAAyELvOfr+Qi7mPyTEgv+9v84/tfQM1whrrD/MUEbSq7KDP4Q6Tpvg11U/AEGGDwvCEPA/br+IGk87mzw1M/upPfbvP13c2JwTYHG8YYB3Pprs7z/RZocQel6QvIV/bugV4+8/E/ZnNVLSjDx0hRXTsNnvP/qO+SOAzou83vbdKWvQ7z9hyOZhTvdgPMibdRhF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";
var k = 0;
var J = 4;
var K = 8;
var S = 12;
var M = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function U(B2) {
  if (B2 = B2.replaceAll(/[\t\n\f\r ]/g, ""), B2.length % 4 === 1) throw new Error("Invalid base64 string");
  let g = "", I = 0, A = 0;
  for (let C of B2) {
    if (C === "=") break;
    let Q = M.indexOf(C);
    if (Q === -1) throw new Error("Invalid base64 character");
    I = I << 6 | Q, A += 6, A >= 8 && (A -= 8, g += String.fromCharCode(I >> A & 255));
  }
  return g;
}
var h = { env: { emscripten_notify_memory_growth: () => {
} }, wasi_snapshot_preview1: { fd_close: () => 0, fd_write: () => 0, fd_seek: () => 0 } };
var L = class B {
  static exports;
  static ready = (async () => {
    let g = "atob" in globalThis ? atob(y) : U(y), I = Uint8Array.from(g, (C) => C.charCodeAt(0)), { instance: A } = await WebAssembly.instantiate(I, h);
    B.exports = A.exports;
  })();
  static decode(g) {
    if (!this.exports) throw new Error("Vorbis decoder not ready");
    let I = g instanceof Uint8Array ? g : new Uint8Array(g), A = this.exports, C = A.memory, Q = A.malloc(I.byteLength);
    if (Q === 0) throw new Error("Failed to allocate WASM memory for Vorbis input");
    try {
      new Uint8Array(C.buffer, Q, I.byteLength).set(I);
      let E = A.vorbis_decode(Q, I.byteLength);
      if (E === 0) throw new Error("Failed to decode Ogg Vorbis stream");
      try {
        let F = new DataView(C.buffer), D = F.getInt32(E + k, true), N = F.getInt32(E + J, true), i = F.getInt32(E + K, true);
        if (D <= 0 || i <= 0 || N <= 0) throw new Error("Invalid Vorbis decoder result");
        let s = new Float32Array(C.buffer, E + S, D * i), R = new Array(D);
        for (let o = 0; o < D; o++) {
          let G = new Float32Array(i);
          for (let w = 0; w < i; w++) G[w] = s[w * D + o];
          R[o] = G;
        }
        return { sampleRate: N, channels: R };
      } finally {
        A.vorbis_free(E);
      }
    } finally {
      A.free(Q);
    }
  }
};

// node_modules/spessasynth_core/dist/index.js
function readLE64Indexed(dataArray, bytesAmount) {
  const res = readLE64(dataArray, bytesAmount, dataArray.currentIndex);
  dataArray.currentIndex += bytesAmount;
  return res;
}
function readLE64(dataArray, bytesAmount, offset = 0) {
  let out = 0n;
  for (let i = 0; i < bytesAmount; i++) out |= BigInt(dataArray[offset + i]) << BigInt(i * 8);
  return Number(out);
}
function readLittleEndianIndexed(dataArray, bytesAmount) {
  const res = readLittleEndian(dataArray, bytesAmount, dataArray.currentIndex);
  dataArray.currentIndex += bytesAmount;
  return res;
}
function readLittleEndian(dataArray, bytesAmount, offset = 0) {
  let out = 0;
  for (let i = 0; i < bytesAmount; i++) out |= dataArray[offset + i] << i * 8;
  return out >>> 0;
}
function writeLittleEndianIndexed(dataArray, number, byteTarget) {
  for (let i = 0; i < byteTarget; i++) dataArray[dataArray.currentIndex++] = number >> i * 8 & 255;
}
function writeWord(dataArray, word) {
  dataArray[dataArray.currentIndex++] = word & 255;
  dataArray[dataArray.currentIndex++] = word >> 8;
}
function writeDword(dataArray, dword) {
  writeLittleEndianIndexed(dataArray, dword, 4);
}
function writeQword(dataArray, qword) {
  const qb = BigInt(qword);
  for (let i = 0n; i < 8n; i++) dataArray[dataArray.currentIndex++] = Number(qb >> i * 8n & 255n);
}
function signedInt16(byte1, byte2) {
  const val = byte2 << 8 | byte1;
  if (val > 32767) return val - 65536;
  return val;
}
function signedInt8(byte) {
  if (byte > 127) return byte - 256;
  return byte;
}
var IndexedByteArray = class extends Uint8Array {
  /**
  * The current index of the array.
  */
  currentIndex = 0;
  /**
  * Returns a section of an array.
  * @param start The beginning of the specified portion of the array.
  * @param end The end of the specified portion of the array. This is exclusive of the element at the index 'end'.
  */
  slice(start2, end) {
    const a = super.slice(start2, end);
    a.currentIndex = 0;
    return a;
  }
};
function readBinaryString(dataArray, bytes = dataArray.length, offset = 0) {
  let string = "";
  for (let i = 0; i < bytes; i++) {
    const byte = dataArray[offset + i];
    if (byte === 0) return string;
    string += String.fromCharCode(byte);
  }
  return string;
}
function readBinaryStringIndexed(dataArray, bytes) {
  const startIndex = dataArray.currentIndex;
  dataArray.currentIndex += bytes;
  return readBinaryString(dataArray, bytes, startIndex);
}
function getStringBytes(string, addZero = false, ensureEven = false) {
  let len = string.length;
  if (addZero) len++;
  if (ensureEven && len % 2 !== 0) len++;
  const arr = new IndexedByteArray(len);
  writeBinaryStringIndexed(arr, string);
  return arr;
}
function writeBinaryStringIndexed(outArray, string, padLength = 0) {
  if (padLength > 0 && string.length > padLength) string = string.slice(0, padLength);
  for (let i = 0; i < string.length; i++) outArray[outArray.currentIndex++] = string.charCodeAt(i);
  if (padLength > string.length) for (let i = 0; i < padLength - string.length; i++) outArray[outArray.currentIndex++] = 0;
  return outArray;
}
function splitmix32(a) {
  return function() {
    a |= 0;
    a = a + 2654435769 | 0;
    let t = a ^ a >>> 16;
    t = Math.imul(t, 569420461);
    t = t ^ t >>> 15;
    t = Math.imul(t, 1935289751);
    return ((t ^ t >>> 15) >>> 0) / 4294967296;
  };
}
var randomGenerator = splitmix32(81572);
function arrayToHexString(arr) {
  let hexString = "";
  for (let i = 0; i < arr.length; i++) {
    const hex = arr[i].toString(16).padStart(2, "0").toUpperCase();
    hexString += hex;
    if (i < arr.length - 1) hexString += " ";
  }
  return hexString;
}
var ConsoleColors = {
  warn: "color: orange;",
  unrecognized: "color: red;",
  info: "color: aqua;",
  recognized: "color: lime",
  value: "color: yellow; background-color: black;"
};
var tr;
(() => {
  var l = Uint8Array, T = Uint16Array, ur = Int32Array, W = new l([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    0,
    0,
    0
  ]), X = new l([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    0,
    0
  ]), wr = new l([
    16,
    17,
    18,
    0,
    8,
    7,
    9,
    6,
    10,
    5,
    11,
    4,
    12,
    3,
    13,
    2,
    14,
    1,
    15
  ]), Y = function(r, a) {
    for (var e = new T(31), f = 0; f < 31; ++f) e[f] = a += 1 << r[f - 1];
    for (var v = new ur(e[30]), f = 1; f < 30; ++f) for (var g = e[f]; g < e[f + 1]; ++g) v[g] = g - e[f] << 5 | f;
    return {
      b: e,
      r: v
    };
  }, Z = Y(W, 2), $ = Z.b, cr = Z.r;
  $[28] = 258, cr[258] = 28;
  var j = Y(X, 0), hr = j.b;
  j.r;
  var _ = new T(32768);
  for (i = 0; i < 32768; ++i) c = (i & 43690) >> 1 | (i & 21845) << 1, c = (c & 52428) >> 2 | (c & 13107) << 2, c = (c & 61680) >> 4 | (c & 3855) << 4, _[i] = ((c & 65280) >> 8 | (c & 255) << 8) >> 1;
  var c, i, A = function(r, a, e) {
    for (var f = r.length, v = 0, g = new T(a); v < f; ++v) r[v] && ++g[r[v] - 1];
    var k2 = new T(a);
    for (v = 1; v < a; ++v) k2[v] = k2[v - 1] + g[v - 1] << 1;
    var b;
    if (e) {
      b = new T(1 << a);
      var m = 15 - a;
      for (v = 0; v < f; ++v) if (r[v]) for (var U2 = v << 4 | r[v], x = a - r[v], n = k2[r[v] - 1]++ << x, o = n | (1 << x) - 1; n <= o; ++n) b[_[n] >> m] = U2;
    } else for (b = new T(f), v = 0; v < f; ++v) r[v] && (b[v] = _[k2[r[v] - 1]++] >> 15 - r[v]);
    return b;
  }, M2 = new l(288);
  for (i = 0; i < 144; ++i) M2[i] = 8;
  var i;
  for (i = 144; i < 256; ++i) M2[i] = 9;
  var i;
  for (i = 256; i < 280; ++i) M2[i] = 7;
  var i;
  for (i = 280; i < 288; ++i) M2[i] = 8;
  var i, L2 = new l(32);
  for (i = 0; i < 32; ++i) L2[i] = 5;
  var i, gr = A(M2, 9, 1), br = A(L2, 5, 1), q = function(r) {
    for (var a = r[0], e = 1; e < r.length; ++e) r[e] > a && (a = r[e]);
    return a;
  }, u = function(r, a, e) {
    var f = a / 8 | 0;
    return (r[f] | r[f + 1] << 8) >> (a & 7) & e;
  }, C = function(r, a) {
    var e = a / 8 | 0;
    return (r[e] | r[e + 1] << 8 | r[e + 2] << 16) >> (a & 7);
  }, kr = function(r) {
    return (r + 7) / 8 | 0;
  }, xr = function(r, a, e) {
    return (a == null || a < 0) && (a = 0), (e == null || e > r.length) && (e = r.length), new l(r.subarray(a, e));
  }, yr = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
  ], h2 = function(r, a, e) {
    var f = new Error(a || yr[r]);
    if (f.code = r, Error.captureStackTrace && Error.captureStackTrace(f, h2), !e) throw f;
    return f;
  }, Sr = function(r, a, e, f) {
    var v = r.length, g = f ? f.length : 0;
    if (!v || a.f && !a.l) return e || new l(0);
    var k2 = !e, b = k2 || a.i != 2, m = a.i;
    k2 && (e = new l(v * 3));
    var U2 = function(fr) {
      var or = e.length;
      if (fr > or) {
        var lr = new l(Math.max(or * 2, fr));
        lr.set(e), e = lr;
      }
    }, x = a.f || 0, n = a.p || 0, o = a.b || 0, S2 = a.l, I = a.d, z = a.m, D = a.n, G = v * 8;
    do {
      if (!S2) {
        x = u(r, n, 1);
        var H = u(r, n + 1, 3);
        if (n += 3, H) if (H == 1) S2 = gr, I = br, z = 9, D = 5;
        else if (H == 2) {
          var N = u(r, n, 31) + 257, s = u(r, n + 10, 15) + 4, d = N + u(r, n + 5, 31) + 1;
          n += 14;
          for (var F = new l(d), P = new l(19), t = 0; t < s; ++t) P[wr[t]] = u(r, n + t * 3, 7);
          n += s * 3;
          for (var rr = q(P), Ar = (1 << rr) - 1, Mr = A(P, rr, 1), t = 0; t < d; ) {
            var ar = Mr[u(r, n, Ar)];
            n += ar & 15;
            var w = ar >> 4;
            if (w < 16) F[t++] = w;
            else {
              var E = 0, O = 0;
              for (w == 16 ? (O = 3 + u(r, n, 3), n += 2, E = F[t - 1]) : w == 17 ? (O = 3 + u(r, n, 7), n += 3) : w == 18 && (O = 11 + u(r, n, 127), n += 7); O--; ) F[t++] = E;
            }
          }
          var er = F.subarray(0, N), y2 = F.subarray(N);
          z = q(er), D = q(y2), S2 = A(er, z, 1), I = A(y2, D, 1);
        } else h2(1);
        else {
          var w = kr(n) + 4, J2 = r[w - 4] | r[w - 3] << 8, K2 = w + J2;
          if (K2 > v) {
            m && h2(0);
            break;
          }
          b && U2(o + J2), e.set(r.subarray(w, K2), o), a.b = o += J2, a.p = n = K2 * 8, a.f = x;
          continue;
        }
        if (n > G) {
          m && h2(0);
          break;
        }
      }
      b && U2(o + 131072);
      for (var Ur = (1 << z) - 1, zr = (1 << D) - 1, Q = n; ; Q = n) {
        var E = S2[C(r, n) & Ur], p = E >> 4;
        if (n += E & 15, n > G) {
          m && h2(0);
          break;
        }
        if (E || h2(2), p < 256) e[o++] = p;
        else if (p == 256) {
          Q = n, S2 = null;
          break;
        } else {
          var nr = p - 254;
          if (p > 264) {
            var t = p - 257, B2 = W[t];
            nr = u(r, n, (1 << B2) - 1) + $[t], n += B2;
          }
          var R = I[C(r, n) & zr], V = R >> 4;
          R || h2(3), n += R & 15;
          var y2 = hr[V];
          if (V > 3) {
            var B2 = X[V];
            y2 += C(r, n) & (1 << B2) - 1, n += B2;
          }
          if (n > G) {
            m && h2(0);
            break;
          }
          b && U2(o + 131072);
          var vr = o + nr;
          if (o < y2) {
            var ir = g - y2, Dr = Math.min(y2, vr);
            for (ir + o < 0 && h2(3); o < Dr; ++o) e[o] = f[ir + o];
          }
          for (; o < vr; ++o) e[o] = e[o - y2];
        }
      }
      a.l = S2, a.p = Q, a.b = o, a.f = x, S2 && (x = 1, a.m = z, a.d = I, a.n = D);
    } while (!x);
    return o != e.length && k2 ? xr(e, 0, o) : e.subarray(0, o);
  }, Tr = new l(0);
  function mr(r, a) {
    return Sr(r, { i: 2 }, a && a.out, a && a.dictionary);
  }
  var Er = typeof TextDecoder < "u" && new TextDecoder();
  try {
    Er.decode(Tr, { stream: true });
  } catch {
  }
  tr = mr;
})();
var RIFFChunk = class RIFFChunk2 {
  /**
  * The chunks FourCC code.
  */
  header;
  /**
  * Chunk's size, in bytes.
  */
  size;
  /**
  * Chunk's binary data. Note that this will have a length of 0 if "readData" was set to false.
  */
  data;
  /**
  * The size of the chunk's header in bytes.
  * This varies for 32-bit and 64-bit RIFF chunks.
  */
  headerSize;
  /**
  * Creates a new RIFF chunk.
  */
  constructor(header, size, data, headerSize = 8) {
    this.header = header;
    this.size = size;
    this.data = data;
    this.headerSize = headerSize;
  }
  /**
  * Reads a RIFF chunk from an array.
  * @param dataArray the array to read from.
  * @param rf64 if the chunk uses a 64-bit size.
  * @param readData if the data should be read as well.
  */
  static read(dataArray, rf64 = false, readData = true) {
    const header = readBinaryStringIndexed(dataArray, 4);
    let size = rf64 ? readLE64Indexed(dataArray, 8) : readLittleEndianIndexed(dataArray, 4);
    if (header === "") size = 0;
    const chunkData = readData ? dataArray.slice(dataArray.currentIndex, dataArray.currentIndex + size) : new IndexedByteArray(0);
    if (readData) {
      dataArray.currentIndex += size;
      if (size % 2 !== 0) dataArray.currentIndex++;
    }
    return new RIFFChunk2(header, size, chunkData, rf64 ? 12 : 8);
  }
  /**
  * Writes a RIFF chunk correctly.
  * @param header the fourCC code of the header.
  * @param data the binary chunk data.
  * @param isList if a "LIST" should be set as the chunk type and the actual type should be written at the start of the data.
  * @param rf64 if the chunk uses a 64-bit size.
  * @returns the binary data.
  */
  static write(header, data, rf64 = false, isList = false) {
    if (header.length !== 4) throw new Error(`Invalid header length: ${header}`);
    let dataStartOffset = rf64 ? 12 : 8;
    let headerWritten = header;
    const dataLength = data.length;
    let writtenSize = dataLength;
    if (isList) {
      dataStartOffset += 4;
      writtenSize += 4;
      headerWritten = "LIST";
    }
    let finalSize = dataStartOffset + dataLength;
    if (finalSize % 2 !== 0) finalSize++;
    const outArray = new IndexedByteArray(finalSize);
    writeBinaryStringIndexed(outArray, headerWritten);
    if (rf64) writeQword(outArray, writtenSize);
    else writeDword(outArray, writtenSize);
    if (isList) writeBinaryStringIndexed(outArray, header);
    outArray.set(data, dataStartOffset);
    return outArray;
  }
  /**
  * "Writes" a RIFF chunk as a list of binary blobs,
  * which can be appended to a list without using more memory,
  * then finally allocated at the end with `writeParts`.
  * This allows avoiding large array allocations and only one writeParts call at the end.
  * @param header  the fourCC code of the header.
  * @param chunks binary chunk data parts, will be combined in order.
  * @param isList if a "LIST" should be set as the chunk type and the actual type should be written at the start of the data.
  * @param rf64 if the chunk uses a 64-bit size.
  * @returns the chunk as binary blobs.
  */
  static getParts(header, chunks, rf64 = false, isList = false) {
    let headerWritten = header;
    let totalSize = chunks.reduce((len, c) => c.length + len, 0);
    if (isList) {
      totalSize += 4;
      headerWritten = "LIST";
    }
    let sizeBytes;
    if (rf64) {
      sizeBytes = new IndexedByteArray(8);
      writeQword(sizeBytes, totalSize);
    } else {
      sizeBytes = new IndexedByteArray(4);
      writeDword(sizeBytes, totalSize);
    }
    const parts = [getStringBytes(headerWritten), sizeBytes];
    if (isList) parts.push(getStringBytes(header));
    parts.push(...chunks);
    if (totalSize % 2 !== 0) parts.push(new Uint8Array(1));
    return parts;
  }
  /**
  * Writes RIFF chunk given binary blobs.
  * It merges them together into data and allocates one large array.
  * @param header  the fourCC code of the header.
  * @param chunks binary chunk data parts, will be combined in order.
  * @param isList if a "LIST" should be set as the chunk type and the actual type should be written at the start of the data.
  * @param rf64 if the chunk uses a 64-bit size.
  * @returns the binary data.
  */
  static writeParts(header, chunks, rf64 = false, isList = false) {
    let dataOffset = rf64 ? 12 : 8;
    let headerWritten = header;
    const dataLength = chunks.reduce((len, c) => c.length + len, 0);
    let writtenSize = dataLength;
    if (isList) {
      dataOffset += 4;
      writtenSize += 4;
      headerWritten = "LIST";
    }
    let finalSize = dataOffset + dataLength;
    if (finalSize % 2 !== 0) finalSize++;
    const outArray = new IndexedByteArray(finalSize);
    writeBinaryStringIndexed(outArray, headerWritten);
    if (rf64) writeQword(outArray, writtenSize);
    else writeDword(outArray, writtenSize);
    if (isList) writeBinaryStringIndexed(outArray, header);
    for (const c of chunks) {
      outArray.set(c, dataOffset);
      dataOffset += c.length;
    }
    return outArray;
  }
  /**
  * Finds a given type in a list.
  * @remarks
  * Also skips the current index to after the list FourCC.
  */
  static findListType(collection, type) {
    return collection.find((c) => {
      if (c.header !== "LIST") return false;
      c.data.currentIndex = 4;
      return readBinaryString(c.data, 4) === type;
    });
  }
};
function fillWithDefaults(obj, defObj) {
  return {
    ...defObj,
    ...obj
  };
}
var SpessaLog = class SpessaLog2 {
  /**
  * The most verbose log level, prints out a lot of small details.
  */
  static infoEnabled = false;
  /**
  * The default log level, prints out warnings for unexpected and erroneous behavior.
  */
  static warnEnabled = true;
  /**
  * If grouping of the log messages is allowed. Recommended for the `info` verbosity level.
  */
  static groupEnabled = false;
  /**
  * The log functions that get called with the data.
  * By default, they use `console` object.
  *
  * This may be overridden to capture the spessasynth log data.
  */
  static logFunctions = {
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    group: console.group.bind(console),
    groupEnd: console.groupEnd.bind(console),
    groupCollapsed: console.groupCollapsed.bind(console)
  };
  /**
  * Enables or disables logging.
  * @param enableInfo enables info.
  * @param enableWarn enables warning.
  * @param enableGroup enables groups.
  */
  static setLogLevel(enableInfo, enableWarn, enableGroup) {
    this.infoEnabled = enableInfo;
    this.warnEnabled = enableWarn;
    this.groupEnabled = enableGroup;
  }
  static info(...message) {
    if (this.infoEnabled) this.logFunctions.info(...message);
  }
  static warn(...message) {
    if (this.warnEnabled) this.logFunctions.warn(...message);
  }
  static group(...message) {
    if (this.groupEnabled) this.logFunctions.group(...message);
  }
  static groupCollapsed(...message) {
    if (this.groupEnabled) this.logFunctions.groupCollapsed(...message);
  }
  static groupEnd() {
    if (this.groupEnabled) this.logFunctions.groupEnd();
  }
  /**
  * @internal
  */
  static unsupported(what, syx, reason = "") {
    if (this.infoEnabled) this.info(`%cUnsupported %c${what}%c message: %c${arrayToHexString(syx)}%c. ${reason}`, ConsoleColors.warn, ConsoleColors.recognized, ConsoleColors.warn, ConsoleColors.unrecognized, ConsoleColors.warn);
  }
  /**
  * @internal
  */
  static gmInfo(what, value, unit = "") {
    if (this.infoEnabled) this.coolInfo(`General MIDI ${what}`, value, unit);
  }
  /**
  * @internal
  */
  static gmFail(what, syx) {
    if (this.infoEnabled) this.unsupported(`General MIDI ${what}`, syx);
  }
  /**
  * @internal
  */
  static gsInfo(what, value, unit = "") {
    if (this.infoEnabled) this.coolInfo(`Roland GS ${what}`, value, unit);
  }
  /**
  * @internal
  */
  static gsFail(what, syx, reason = "") {
    if (this.infoEnabled) this.unsupported(`Roland GS ${what}`, syx, reason);
  }
  /**
  * @internal
  */
  static xgInfo(what, value, unit = "") {
    if (this.infoEnabled) this.coolInfo(`Yamaha XG ${what}`, value, unit);
  }
  /**
  * @internal
  */
  static xgFail(what, syx, reason = "") {
    if (this.infoEnabled) this.unsupported(`Yamaha XG ${what}`, syx, reason);
  }
  /**
  * @internal
  */
  static coolInfo(what, value, unit = "") {
    if (!this.infoEnabled) return;
    if (unit) SpessaLog2.info(`%c${what}%c is now set to %c${value}%c ${unit}.`, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.value, ConsoleColors.info);
    else SpessaLog2.info(`%c${what}%c is now set to %c${value}%c.`, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.value, ConsoleColors.info);
  }
};
var MIDIMessageTypes = {
  noteOff: 128,
  noteOn: 144,
  polyPressure: 160,
  controllerChange: 176,
  programChange: 192,
  channelPressure: 208,
  pitchWheel: 224,
  systemExclusive: 240,
  timecode: 241,
  songPosition: 242,
  songSelect: 243,
  tuneRequest: 246,
  clock: 248,
  start: 250,
  continue: 251,
  stop: 252,
  activeSensing: 254,
  reset: 255,
  sequenceNumber: 0,
  text: 1,
  copyright: 2,
  trackName: 3,
  instrumentName: 4,
  lyric: 5,
  marker: 6,
  cuePoint: 7,
  programName: 8,
  midiChannelPrefix: 32,
  midiPort: 33,
  endOfTrack: 47,
  setTempo: 81,
  smpteOffset: 84,
  timeSignature: 88,
  keySignature: 89,
  sequenceSpecific: 127
};
var MIDIControllers = {
  bankSelect: 0,
  modulationWheel: 1,
  breathController: 2,
  undefinedCC3: 3,
  footController: 4,
  portamentoTime: 5,
  dataEntryMSB: 6,
  mainVolume: 7,
  balance: 8,
  undefinedCC9: 9,
  pan: 10,
  expression: 11,
  effectControl1: 12,
  effectControl2: 13,
  undefinedCC14: 14,
  undefinedCC15: 15,
  generalPurposeController1: 16,
  generalPurposeController2: 17,
  generalPurposeController3: 18,
  generalPurposeController4: 19,
  undefinedCC20: 20,
  undefinedCC21: 21,
  undefinedCC22: 22,
  undefinedCC23: 23,
  undefinedCC24: 24,
  undefinedCC25: 25,
  undefinedCC26: 26,
  undefinedCC27: 27,
  undefinedCC28: 28,
  undefinedCC29: 29,
  undefinedCC30: 30,
  undefinedCC31: 31,
  bankSelectLSB: 32,
  modulationWheelLSB: 33,
  breathControllerLSB: 34,
  undefinedCC3LSB: 35,
  footControllerLSB: 36,
  portamentoTimeLSB: 37,
  dataEntryLSB: 38,
  mainVolumeLSB: 39,
  balanceLSB: 40,
  undefinedCC9LSB: 41,
  panLSB: 42,
  expressionLSB: 43,
  effectControl1LSB: 44,
  effectControl2LSB: 45,
  undefinedCC14LSB: 46,
  undefinedCC15LSB: 47,
  undefinedCC16LSB: 48,
  undefinedCC17LSB: 49,
  undefinedCC18LSB: 50,
  undefinedCC19LSB: 51,
  undefinedCC20LSB: 52,
  undefinedCC21LSB: 53,
  undefinedCC22LSB: 54,
  undefinedCC23LSB: 55,
  undefinedCC24LSB: 56,
  undefinedCC25LSB: 57,
  undefinedCC26LSB: 58,
  undefinedCC27LSB: 59,
  undefinedCC28LSB: 60,
  undefinedCC29LSB: 61,
  undefinedCC30LSB: 62,
  undefinedCC31LSB: 63,
  sustainPedal: 64,
  portamentoOnOff: 65,
  sostenutoPedal: 66,
  softPedal: 67,
  legatoFootswitch: 68,
  hold2Pedal: 69,
  soundVariation: 70,
  filterResonance: 71,
  releaseTime: 72,
  attackTime: 73,
  brightness: 74,
  decayTime: 75,
  vibratoRate: 76,
  vibratoDepth: 77,
  vibratoDelay: 78,
  soundController10: 79,
  generalPurposeController5: 80,
  generalPurposeController6: 81,
  generalPurposeController7: 82,
  generalPurposeController8: 83,
  portamentoControl: 84,
  undefinedCC85: 85,
  undefinedCC86: 86,
  undefinedCC87: 87,
  undefinedCC88: 88,
  undefinedCC89: 89,
  undefinedCC90: 90,
  reverbDepth: 91,
  tremoloDepth: 92,
  chorusDepth: 93,
  variationDepth: 94,
  phaserDepth: 95,
  dataIncrement: 96,
  dataDecrement: 97,
  nonRegisteredParameterLSB: 98,
  nonRegisteredParameterMSB: 99,
  registeredParameterLSB: 100,
  registeredParameterMSB: 101,
  undefinedCC102LSB: 102,
  undefinedCC103LSB: 103,
  undefinedCC104LSB: 104,
  undefinedCC105LSB: 105,
  undefinedCC106LSB: 106,
  undefinedCC107LSB: 107,
  undefinedCC108LSB: 108,
  undefinedCC109LSB: 109,
  undefinedCC110LSB: 110,
  undefinedCC111LSB: 111,
  undefinedCC112LSB: 112,
  undefinedCC113LSB: 113,
  undefinedCC114LSB: 114,
  undefinedCC115LSB: 115,
  undefinedCC116LSB: 116,
  undefinedCC117LSB: 117,
  undefinedCC118LSB: 118,
  undefinedCC119LSB: 119,
  allSoundOff: 120,
  resetAllControllers: 121,
  localControlOnOff: 122,
  allNotesOff: 123,
  omniModeOff: 124,
  omniModeOn: 125,
  monoModeOn: 126,
  polyModeOn: 127
};
var RegisteredParameterTypes = {
  pitchWheelRange: 0,
  fineTuning: 1,
  coarseTuning: 2,
  modulationDepth: 5,
  resetParameters: 16383
};
var NonRegisteredMSB = {
  partParameter: 1,
  drumPitch: 24,
  drumPitchFine: 25,
  drumLevel: 26,
  drumPan: 28,
  drumReverb: 29,
  drumChorus: 30,
  drumDelay: 31,
  awe32: 127,
  SF2: 120
};
var NonRegisteredLSB = {
  vibratoRate: 8,
  vibratoDepth: 9,
  vibratoDelay: 10,
  tvfCutoffFrequency: 32,
  tvfResonance: 33,
  envelopeAttackTime: 99,
  envelopeDecayTime: 100,
  envelopeReleaseTime: 102
};
var MIDIMessage = class MIDIMessage2 {
  /**
  * Absolute number of MIDI ticks from the start of the track.
  */
  ticks;
  /**
  * The MIDI message status byte. Note that for meta events, it is the second byte. (not 0xFF).
  */
  statusByte;
  /**
  * Message's binary data.
  */
  data;
  /**
  * Creates a new MIDI message.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param byte the message status byte.
  * @param data the message's binary data.
  */
  constructor(ticks, byte, data) {
    this.ticks = ticks;
    this.statusByte = byte;
    this.data = data;
  }
  /**
  * Returns a new MIDI Pitch Wheel message.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param channel the channel number of this message.
  * @param value the new value, between 0 and 16383, where 8192 is the center (no pitch change).
  */
  static pitchWheel(ticks, channel, value) {
    return new MIDIMessage2(ticks, MIDIMessageTypes.pitchWheel | channel % 16, new Uint8Array([value & 127, value >> 7 & 127]));
  }
  /**
  * Returns a new MIDI Channel Pressure message.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param channel the channel number of this message.
  * @param value the new value, between 0 and 127.
  */
  static channelPressure(ticks, channel, value) {
    return new MIDIMessage2(ticks, MIDIMessageTypes.channelPressure | channel % 16, new Uint8Array([value]));
  }
  /**
  * Returns a new MIDI Program Change message.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param channel the channel number of this message.
  * @param program the new MIDI program number, between 0 and 127.
  */
  static programChange(ticks, channel, program) {
    return new MIDIMessage2(ticks, MIDIMessageTypes.programChange | channel % 16, new Uint8Array([program]));
  }
  /**
  * Returns a new MIDI Controller Change message.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param channel the channel number of this message.
  * @param controller the MIDI controller.
  * @param value the new value.
  */
  static controllerChange(ticks, channel, controller, value) {
    return new MIDIMessage2(ticks, MIDIMessageTypes.controllerChange | channel % 16, new Uint8Array([controller, value]));
  }
  /**
  * Returns a new MIDI System Exclusive message.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param data the data of the system exclusive message,
  * excluding the starting 0xF0 byte.
  */
  static systemExclusive(ticks, data) {
    return new MIDIMessage2(ticks, MIDIMessageTypes.systemExclusive, new Uint8Array(data));
  }
  /**
  * Returns a new MIDI Registered Parameter message. Sends both data MSB and LSB.
  * @param ticks time of this message in absolute MIDI ticks.
  * @param channel the channel number of this message.
  * @param parameter the 14-bit MIDI registered parameter number.
  * @param value the 14-bit new value.
  */
  static registeredParameter(ticks, channel, parameter, value) {
    if (parameter > 16383 || parameter < 0 || value > 16383 || value < 0) throw new Error("Parameter and value must be between 0 and 16383.");
    return [
      MIDIMessage2.controllerChange(ticks, channel, MIDIControllers.registeredParameterMSB, parameter >> 7),
      MIDIMessage2.controllerChange(ticks, channel, MIDIControllers.registeredParameterLSB, parameter & 127),
      MIDIMessage2.controllerChange(ticks, channel, MIDIControllers.dataEntryMSB, value >> 7),
      MIDIMessage2.controllerChange(ticks, channel, MIDIControllers.dataEntryLSB, value & 127)
    ];
  }
};
var EMBEDDED_SOUND_BANK_ID = `SPESSASYNTH_EMBEDDED_BANK_${Math.random()}_DO_NOT_DELETE`;
var GENERATOR_OVERRIDE_NO_CHANGE_VALUE = 32767;
var DEFAULT_SYNTH_METHOD_OPTIONS = { time: 0 };
var MIN_NOTE_LENGTH = 0.03;
var MIN_EXCLUSIVE_LENGTH = 0.07;
var SPESSASYNTH_GAIN_FACTOR = 0.6;
var EFX_SENDS_GAIN_CORRECTION = 1 / Math.cos(Math.PI / 4) ** 2;
var GM2_DEFAULT_BANK = 121;
var BankSelectHacks = class {
  /**
  * GM2 has a different default bank number
  */
  static getDefaultBank(sys) {
    return sys === "gm2" ? GM2_DEFAULT_BANK : 0;
  }
  static getDrumBank(sys) {
    switch (sys) {
      default:
        throw new Error(`${sys} doesn't have a bank MSB for drums.`);
      case "gm2":
        return 120;
      case "xg":
        return 127;
    }
  }
  /**
  * Checks if this bank number is XG drums.
  */
  static isXGDrum(bankMSB) {
    return bankMSB === 120 || bankMSB === 127;
  }
  /**
  * Checks if this MSB is a valid XG MSB
  */
  static isValidXGMSB(bankMSB) {
    return this.isXGDrum(bankMSB) || bankMSB === 64 || bankMSB === GM2_DEFAULT_BANK;
  }
  static isSystemXG(system) {
    return system === "gm2" || system === "xg";
  }
  static addBankOffset(bankMSB, bankOffset, isXG) {
    if (this.isXGDrum(bankMSB) && isXG) return bankMSB;
    return Math.min(bankMSB + bankOffset, 127);
  }
  static subtractBankOffset(bankMSB, bankOffset, isXG) {
    if (this.isXGDrum(bankMSB) && isXG) return bankMSB;
    return Math.max(0, bankMSB - bankOffset);
  }
};
var MIDIPatchTools = class MIDIPatchTools2 {
  /**
  * Converts a given `MIDIPatch` to a string.
  * The format is:
  * - `DRUM:program` for `GMGSDrum` set to `true`.
  * - `bankLSB:bankMSB:program` for `GMGSDrum` set to `false`.
  */
  static toMIDIString(patch) {
    if (patch.isGMGSDrum) return `DRUM:${patch.program}`;
    return `${patch.bankLSB}:${patch.bankMSB}:${patch.program}`;
  }
  /**
  * Gets `MIDIPatch` from a given string.
  */
  static fromMIDIString(string) {
    const parts = string.split(":");
    if (parts.length > 3 || parts.length < 2) throw new Error(`Invalid MIDI string: ${string}`);
    return string.startsWith("DRUM") ? {
      bankMSB: 0,
      bankLSB: 0,
      program: Number.parseInt(parts[1]),
      isGMGSDrum: true
    } : {
      bankLSB: Number.parseInt(parts[0]),
      bankMSB: Number.parseInt(parts[1]),
      program: Number.parseInt(parts[2]),
      isGMGSDrum: false
    };
  }
  /**
  * Converts a given `MIDIPatchFull`to string.
  * The format is:
  * - `<MIDIPatch string> D <name>` for `isDrum` set to `true`.
  * - `<MIDIPatch string> M <name>` for `isDrum` set to `true`.
  */
  static toFullMIDIString(patch) {
    return `${this.toMIDIString(patch)} ${patch.isDrum ? "D" : "M"} ${patch.name}`;
  }
  /**
  * Gets `MIDIPatchFull` from a given string.
  */
  static fromFullMIDIString(string) {
    const firstSpace = string.indexOf(" ");
    const secondSpace = string.indexOf(" ", firstSpace + 1);
    if (firstSpace === -1 || secondSpace === -1) throw new Error(`Invalid named MIDI string: ${string}`);
    const midiPart = string.slice(0, Math.max(0, firstSpace));
    const drumMode = string.slice(firstSpace + 1, secondSpace);
    const name = string.slice(Math.max(0, secondSpace + 1));
    return {
      ...MIDIPatchTools2.fromMIDIString(midiPart),
      isDrum: drumMode === "D",
      name
    };
  }
  /**
  * Checks if two MIDI patches represent the same one.
  */
  static matches(patch1, patch2) {
    if (patch1.isGMGSDrum || patch2.isGMGSDrum) return patch1.isGMGSDrum === patch2.isGMGSDrum && patch1.program === patch2.program;
    return patch1.program === patch2.program && patch1.bankLSB === patch2.bankLSB && patch1.bankMSB === patch2.bankMSB;
  }
  /**
  * A comparison function for `.sort()` or `.toSorted()`,
  * ordering the patches in ascending order.
  */
  static compare(a, b) {
    if (a.isGMGSDrum && !b.isGMGSDrum) return 1;
    if (!a.isGMGSDrum && b.isGMGSDrum) return -1;
    if (a.program !== b.program) return a.program - b.program;
    if (a.bankMSB !== b.bankMSB) return a.bankMSB - b.bankMSB;
    return a.bankLSB - b.bankLSB;
  }
  /**
  * Checks if the given `MIDIPatchFull` is an XG/GM2 drum patch.
  */
  static isXGDrum(p) {
    return p.isDrum && !p.isGMGSDrum;
  }
  /**
  * A sophisticated patch selection system based on the MIDI Patch system.
  * This is the algorithm that the synthesizer uses for selecting presets.
  * @param patches The `MIDIPatchFull` array to select from.
  * @param patch The `MIDIPatch` to select.
  * @param system The MIDI system to select for.
  * @returns The selected patch.
  */
  static selectPatch(patches, patch, system) {
    if (patches.length === 0) throw new Error("No presets!");
    if (patch.isGMGSDrum && BankSelectHacks.isSystemXG(system)) patch = {
      ...patch,
      isGMGSDrum: false,
      bankLSB: 0,
      bankMSB: BankSelectHacks.getDrumBank(system)
    };
    const { isGMGSDrum, bankLSB, bankMSB, program } = patch;
    const isXG = BankSelectHacks.isSystemXG(system);
    const xgDrums = BankSelectHacks.isXGDrum(bankMSB) && isXG;
    let p = patches.find((p2) => this.matches(p2, patch));
    if (p && (!xgDrums || xgDrums && this.isXGDrum(p))) return p;
    const returnReplacement = (pres) => {
      SpessaLog.info(`%cPreset %c${MIDIPatchTools2.toMIDIString(patch)}%c not found. (${system}) Replaced with %c${this.toFullMIDIString(pres)}`, ConsoleColors.warn, ConsoleColors.unrecognized, ConsoleColors.warn, ConsoleColors.value);
    };
    if (isGMGSDrum) {
      let p2 = patches.find((p3) => p3.isGMGSDrum && p3.program === program);
      if (p2) {
        returnReplacement(p2);
        return p2;
      }
      p2 = patches.find((p3) => p3.isDrum && p3.program === program);
      if (p2) {
        returnReplacement(p2);
        return p2;
      }
      p2 = this.getAnyDrums(patches, false);
      returnReplacement(p2);
      return p2;
    }
    if (xgDrums) {
      let p2 = patches.find((p3) => p3.program === program && p3.isDrum && !p3.isGMGSDrum);
      if (p2) {
        returnReplacement(p2);
        return p2;
      }
      p2 = patches.find((p3) => p3.isDrum && p3.program === program);
      if (p2 && p2.program < 49) {
        returnReplacement(p2);
        return p2;
      }
      p2 = this.getAnyDrums(patches, true);
      returnReplacement(p2);
      return p2;
    }
    const matchingPrograms = patches.filter((p2) => p2.program === program && !p2.isDrum);
    if (matchingPrograms.length === 0) {
      returnReplacement(patches[0]);
      return patches[0];
    }
    p = isXG ? matchingPrograms.find((p2) => p2.bankLSB === bankLSB) : matchingPrograms.find((p2) => p2.bankMSB === bankMSB);
    if (p) {
      returnReplacement(p);
      return p;
    }
    if (bankLSB !== 64 || !isXG) {
      const bank = Math.max(bankMSB, bankLSB);
      p = matchingPrograms.find((p2) => p2.bankLSB === bank || p2.bankMSB === bank);
      if (p) {
        returnReplacement(p);
        return p;
      }
    }
    returnReplacement(matchingPrograms[0]);
    return matchingPrograms[0];
  }
  static getAnyDrums(presets, preferXG) {
    const p = preferXG ? presets.find((p2) => this.isXGDrum(p2)) : presets.find((p2) => p2.isGMGSDrum);
    if (p) return p;
    return presets.find((p2) => p2.isDrum) ?? presets[0];
  }
};
var OTHER = Object.freeze({ type: "Other" });
var MIDIUtils = class MIDIUtils2 {
  /**
  * Analyzes a MIDI System Exclusive message
  * and returns an identification and data for it.
  * @param syx the System Exclusive message, WITHOUT the first 0xF0 System Exclusive byte!
  */
  static analyzeSysEx(syx) {
    if (syx.length < 3) return OTHER;
    switch (syx[0]) {
      default:
        return OTHER;
      case 126:
      case 127:
        return this.analyzeGM(syx);
      case 65:
        return this.analyzeGS(syx);
      case 67:
        return this.analyzeXG(syx);
    }
  }
  /**
  * Analyzes a MIDI Registered Parameter Number
  * and returns an identification and data for it.
  * @param channel The MIDI channel number.
  * @param rpn The 14-bit RPN number.
  * @param value The 14-bit value for that number.
  */
  static analyzeRPN(channel, rpn, value) {
    switch (rpn) {
      default:
        return OTHER;
      case RegisteredParameterTypes.pitchWheelRange:
        return {
          type: "Channel MIDI Param",
          channel,
          parameter: "pitchWheelRange",
          value: value / 128
        };
      case RegisteredParameterTypes.fineTuning:
        return {
          type: "Channel MIDI Param",
          channel,
          parameter: "fineTune",
          value: (value - 8192) / 81.92
        };
      case RegisteredParameterTypes.coarseTuning:
        return {
          type: "Channel MIDI Param",
          channel,
          parameter: "keyShift",
          value: (value >> 7) - 64
        };
      case RegisteredParameterTypes.modulationDepth:
        return {
          type: "Channel MIDI Param",
          channel,
          parameter: "modulationDepth",
          value: value / 1.28
        };
    }
  }
  /**
  * Analyzes a MIDI Non-Registered Parameter Number
  * and returns an identification and data for it.
  * @param channel The MIDI channel number.
  * @param nrpn The 14-bit NRPN number.
  * @param value The 14-bit value for that number.
  */
  static analyzeNRPN(channel, nrpn, value) {
    const msb = nrpn >> 7;
    const lsb = nrpn & 127;
    switch (msb) {
      default:
        return OTHER;
      case NonRegisteredMSB.partParameter:
        switch (lsb) {
          default:
            return OTHER;
          case NonRegisteredLSB.vibratoRate:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.vibratoRate,
              value: value >> 7
            };
          case NonRegisteredLSB.vibratoDepth:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.vibratoDepth,
              value: value >> 7
            };
          case NonRegisteredLSB.vibratoDelay:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.vibratoDelay,
              value: value >> 7
            };
          case NonRegisteredLSB.tvfCutoffFrequency:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.brightness,
              value: value >> 7
            };
          case NonRegisteredLSB.tvfResonance:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.filterResonance,
              value: value >> 7
            };
          case NonRegisteredLSB.envelopeAttackTime:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.attackTime,
              value: value >> 7
            };
          case NonRegisteredLSB.envelopeDecayTime:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.decayTime,
              value: value >> 7
            };
          case NonRegisteredLSB.envelopeReleaseTime:
            return {
              type: "Controller Change",
              channel,
              controller: MIDIControllers.releaseTime,
              value: value >> 7
            };
        }
      case NonRegisteredMSB.drumPitch:
      case NonRegisteredMSB.drumPitchFine:
      case NonRegisteredMSB.drumLevel:
      case NonRegisteredMSB.drumPan:
      case NonRegisteredMSB.drumReverb:
      case NonRegisteredMSB.drumChorus:
      case NonRegisteredMSB.drumDelay:
        return { type: "Drum Setup" };
    }
  }
  /**
  * Returns a list of MIDI events needed to set the given parameter.
  * @param ticks The ticks for all events.
  * @param system If the message has multiple ways of setting it,
  * this selects the preferred way. Otherwise, it prefers Universal (GM).
  * @param parameter The parameter to set.
  * @param value The value to set it to.
  */
  static setGlobalMIDIParameter(ticks, system, parameter, value) {
    switch (parameter) {
      case "system":
        return [MIDIUtils2.reset(ticks, value)];
      case "keyShift":
        switch (system) {
          default:
            return [MIDIUtils2.deviceControlMessage(ticks, 4, [0, value + 64])];
          case "xg":
            return [MIDIUtils2.xgMessage(ticks, 0, 0, 6, [value + 64])];
          case "gs":
            return [MIDIUtils2.gsMessage(ticks, 64, 0, 5, [value + 64])];
        }
      case "fineTune":
        switch (system) {
          default: {
            const tuneValue = Math.floor(value * 81.92 + 8192);
            return [MIDIUtils2.deviceControlMessage(ticks, 3, [tuneValue & 127, tuneValue >> 7 & 127])];
          }
          case "xg": {
            const tuneValue = Math.floor(value * 10 + 1024);
            return [MIDIUtils2.xgMessage(ticks, 0, 0, 0, [
              tuneValue >> 12 & 15,
              tuneValue >> 8 & 15,
              tuneValue >> 4 & 15,
              tuneValue & 15
            ])];
          }
          case "gs": {
            const tuneValue = Math.floor(value * 10 + 1024);
            return [MIDIUtils2.gsMessage(ticks, 64, 0, 0, [
              tuneValue >> 12 & 15,
              tuneValue >> 8 & 15,
              tuneValue >> 4 & 15,
              tuneValue & 15
            ])];
          }
        }
      case "volume":
        switch (system) {
          default: {
            const gainValue = Math.floor(value * 16383);
            return [MIDIUtils2.deviceControlMessage(ticks, 1, [gainValue & 127, gainValue >> 7 & 127])];
          }
          case "xg": {
            const gainValue = Math.floor(value * 127);
            return [MIDIUtils2.xgMessage(ticks, 0, 0, 4, [gainValue])];
          }
          case "gs": {
            const gainValue = Math.floor(value * 127);
            return [MIDIUtils2.gsMessage(ticks, 64, 0, 4, [gainValue])];
          }
        }
      case "pan":
        switch (system) {
          default: {
            const balance = Math.floor(value * 8192) + 8192;
            return [MIDIUtils2.deviceControlMessage(ticks, 2, [balance & 127, balance >> 7 & 127])];
          }
          case "gs": {
            const balance = Math.floor(value * 63) + 64;
            return [MIDIUtils2.gsMessage(ticks, 64, 0, 6, [balance])];
          }
        }
    }
  }
  /**
  * Returns a list of MIDI events needed to set the given parameter.
  * @param ticks The ticks for all events.
  * @param channel The channel number.
  * @param system If the message has multiple ways of setting it,
  * this selects the preferred way. Otherwise, it prefers Universal (GM).
  * @param parameter The parameter to set.
  * @param value The value to set it to.
  * @returns The list of `MIDIMessage`s that set the parameter.
  */
  static setChannelMIDIParameter(ticks, channel, system, parameter, value) {
    channel %= 16;
    const gsChannel = MIDIUtils2.channelToSyx(channel);
    switch (parameter) {
      case "pressure":
        return [MIDIMessage.channelPressure(ticks, channel, value)];
      case "pitchWheel":
        return [MIDIMessage.pitchWheel(ticks, channel, value)];
      case "pitchWheelRange":
        return MIDIMessage.registeredParameter(ticks, channel, RegisteredParameterTypes.pitchWheelRange, Math.floor(value * 128));
      case "modulationDepth":
        return MIDIMessage.registeredParameter(ticks, channel, RegisteredParameterTypes.modulationDepth, Math.floor(value * 1.28));
      case "rxChannel":
        return system === "xg" ? [MIDIUtils2.xgMessage(ticks, 8, channel, 4, [value])] : [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 2, [value])];
      case "polyMode":
        return value ? [MIDIMessage.controllerChange(ticks, channel, MIDIControllers.polyModeOn, 0)] : [MIDIMessage.controllerChange(ticks, channel, MIDIControllers.monoModeOn, 0)];
      case "keyShift":
        return MIDIMessage.registeredParameter(ticks, channel, RegisteredParameterTypes.coarseTuning, value + 64 << 7);
      case "fineTune":
        return MIDIMessage.registeredParameter(ticks, channel, RegisteredParameterTypes.fineTuning, Math.floor(value * 81.92 + 8192));
      case "randomPan":
        return system === "xg" ? [MIDIUtils2.xgMessage(ticks, 8, channel, 14, [0])] : [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 28, [0])];
      case "assignMode":
        switch (system) {
          default:
          case "gs":
            return [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 20, [value])];
          case "xg":
            return [MIDIUtils2.xgMessage(ticks, 8, channel, 6, [value])];
        }
      case "efxAssign":
        return [MIDIUtils2.gsMessage(ticks, 64, 64 | gsChannel, 34, [value ? 1 : 0])];
      case "cc1":
        return [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 31, [value])];
      case "cc2":
        return [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 32, [value])];
      case "drumMap":
        return [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 21, [value])];
      case "velocitySenseDepth":
        return system === "xg" ? [MIDIUtils2.xgMessage(ticks, 8, channel, 12, [value])] : [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 26, [value])];
      case "velocitySenseOffset":
        return system === "xg" ? [MIDIUtils2.xgMessage(ticks, 8, channel, 13, [value])] : [MIDIUtils2.gsMessage(ticks, 64, 16 | gsChannel, 27, [value])];
    }
  }
  /**
  * Converts GS/XG "part number" to MIDI channel number.
  * @param part The part number.
  */
  static syxToChannel(part) {
    return [
      9,
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      10,
      11,
      12,
      13,
      14,
      15
    ][part % 16];
  }
  /**
  * Converts MIDI channel number to GS/XG "part number".
  * @param channel The MIDI channel number.
  */
  static channelToSyx(channel) {
    return [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      0,
      10,
      11,
      12,
      13,
      14,
      15
    ][channel % 16];
  }
  /**
  * Gets raw GS System Exclusive message bytes, without the 0xF0 status byte.
  * @param a1 Address 1
  * @param a2 Address 2
  * @param a3 Address 3
  * @param data Data, can be multiple bytes.
  */
  static gs(a1, a2, a3, data) {
    const checksum = 128 - (a1 + a2 + a3 + data.reduce((sum, cur) => sum + cur, 0)) % 128 & 127;
    return [
      65,
      16,
      66,
      18,
      a1,
      a2,
      a3,
      ...data,
      checksum,
      247
    ];
  }
  /**
  * Gets a GS System Exclusive MIDI message.
  * @param ticks The tick time of the message.
  * @param a1 Address 1
  * @param a2 Address 2
  * @param a3 Address 3
  * @param data Data, can be multiple bytes.
  */
  static gsMessage(ticks, a1, a2, a3, data) {
    return MIDIMessage.systemExclusive(ticks, this.gs(a1, a2, a3, data));
  }
  /**
  * Gets raw XG System Exclusive message bytes, without the 0xF0 status byte.
  * @param a1 Address 1
  * @param a2 Address 2
  * @param a3 Address 3
  * @param data Data, can be multiple bytes.
  */
  static xg(a1, a2, a3, data) {
    return [
      67,
      16,
      76,
      a1,
      a2,
      a3,
      ...data,
      247
    ];
  }
  /**
  * Gets a XG System Exclusive MIDI message.
  * @param ticks The tick time of the message.
  * @param a1 Address 1
  * @param a2 Address 2
  * @param a3 Address 3
  * @param data Data, can be multiple bytes.
  */
  static xgMessage(ticks, a1, a2, a3, data) {
    return MIDIMessage.systemExclusive(ticks, this.xg(a1, a2, a3, data));
  }
  /**
  * Gets a raw Device Control System Exclusive message bytes, without the 0xF0 status byte.
  * @param subID The sub ID.
  * @param data Data, can be multiple bytes.
  */
  static deviceControl(subID, data) {
    return [
      127,
      127,
      4,
      subID,
      ...data,
      247
    ];
  }
  /**
  * Gets a Device Control System Exclusive MIDI message.
  * @param ticks The tick time of the message.
  * @param subID The sub ID.
  * @param data Data, can be multiple bytes.
  */
  static deviceControlMessage(ticks, subID, data) {
    return MIDIMessage.systemExclusive(ticks, this.deviceControl(subID, data));
  }
  /**
  * Gets a selected reset System Exclusive MIDI message.
  * @param ticks The tick time of the message.
  * @param system The system to reset into.
  */
  static reset(ticks, system) {
    switch (system) {
      case "gs":
        return this.gsMessage(ticks, 64, 0, 127, [0]);
      case "xg":
        return this.xgMessage(ticks, 0, 0, 126, [0]);
      case "gm":
        return MIDIMessage.systemExclusive(ticks, [
          126,
          127,
          9,
          1,
          127
        ]);
      case "gm2":
        return MIDIMessage.systemExclusive(ticks, [
          126,
          127,
          9,
          3,
          127
        ]);
    }
  }
  static analyzeGM(syx) {
    if (syx.length < 4) return OTHER;
    if (syx[2] === 4) switch (syx[3]) {
      default:
        return OTHER;
      case 1: {
        const value = (syx[5] << 7 | syx[4]) / 16383;
        return {
          type: "Global MIDI Param",
          parameter: "volume",
          value: Math.pow(value, 2)
        };
      }
      case 2:
        return {
          type: "Global MIDI Param",
          parameter: "pan",
          value: ((syx[5] << 7 | syx[4]) - 8192) / 8192
        };
      case 3:
        return {
          type: "Global MIDI Param",
          parameter: "fineTune",
          value: ((syx[5] << 7 | syx[4]) - 8192) / 81.92
        };
      case 4:
        return {
          type: "Global MIDI Param",
          parameter: "keyShift",
          value: syx[5] - 64
        };
      case 5:
        if (syx[4] !== 1 || syx[5] !== 1 || syx[6] !== 1 || syx[7] !== 1) return OTHER;
        switch (syx[8]) {
          default:
            return OTHER;
          case 1:
            switch (syx[9]) {
              default:
                return OTHER;
              case 0:
              case 1:
                return { type: "Reverb Param" };
            }
          case 2:
            switch (syx[9]) {
              default:
                return OTHER;
              case 0:
              case 1:
              case 2:
              case 3:
              case 4:
                return { type: "Chorus Param" };
            }
        }
    }
    if (syx[2] !== 9) return OTHER;
    switch (syx[3]) {
      default:
        return OTHER;
      case 1:
        return {
          type: "Global MIDI Param",
          parameter: "system",
          value: "gm"
        };
      case 2:
        return {
          type: "Global MIDI Param",
          parameter: "system",
          value: "gm"
        };
      case 3:
        return {
          type: "Global MIDI Param",
          parameter: "system",
          value: "gm2"
        };
    }
  }
  static analyzeXG(syx) {
    if (syx[2] !== 76 || syx.length < 7) return OTHER;
    const a1 = syx[3];
    const a2 = syx[4];
    const a3 = syx[5];
    const data = syx[6];
    if (a1 === 6 || a1 === 7) return { type: "Display Data" };
    if (a1 === 0 && a2 === 0) switch (a3) {
      default:
        return OTHER;
      case 0:
        return {
          type: "Global MIDI Param",
          parameter: "fineTune",
          value: (((syx[6] & 15) << 12 | (syx[7] & 15) << 8 | (syx[8] & 15) << 4 | syx[9] & 15) - 1024) / 10
        };
      case 6:
        return {
          type: "Global MIDI Param",
          parameter: "keyShift",
          value: data - 64
        };
      case 126:
      case 127:
        return {
          type: "Global MIDI Param",
          parameter: "system",
          value: "xg"
        };
    }
    if (a1 === 2 && a2 === 1) {
      if (a3 <= 21) return { type: "Reverb Param" };
      if (a3 <= 53) return { type: "Chorus Param" };
      return { type: "Variation Param" };
    }
    if (a1 === 3 && a2 === 0) return { type: "Variation Param" };
    if (a1 === 8) {
      const channel = a2;
      switch (a3) {
        default:
          return OTHER;
        case 1:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.bankSelect,
            value: data
          };
        case 2:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.bankSelectLSB,
            value: data
          };
        case 3:
          return {
            type: "Program Change",
            channel,
            value: data
          };
        case 5:
          return {
            type: "Controller Change",
            channel,
            controller: data === 1 ? MIDIControllers.polyModeOn : MIDIControllers.monoModeOn,
            value: 0
          };
        case 6:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "assignMode",
            value: data
          };
        case 7:
          return {
            type: "Drums On",
            channel,
            isDrum: data > 0
          };
        case 8:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "keyShift",
            value: data - 64
          };
        case 11:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.mainVolume,
            value: data
          };
        case 14:
          if (data === 0) return {
            type: "Channel MIDI Param",
            channel,
            parameter: "randomPan",
            value: true
          };
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.pan,
            value: data
          };
        case 18:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.chorusDepth,
            value: data
          };
        case 19:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.reverbDepth,
            value: data
          };
        case 21:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.vibratoRate,
            value: data
          };
        case 22:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.vibratoDepth,
            value: data
          };
        case 23:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.vibratoDelay,
            value: data
          };
        case 24:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.brightness,
            value: data
          };
        case 25:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.filterResonance,
            value: data
          };
        case 26:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.attackTime,
            value: data
          };
        case 27:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.decayTime,
            value: data
          };
        case 12:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.releaseTime,
            value: data
          };
      }
    }
    if (a1 >> 4 === 3) return { type: "Drum Setup" };
    return OTHER;
  }
  static analyzeGS(syx) {
    if (syx.length < 10 || syx[3] !== 18) return OTHER;
    if (syx[2] === 69) return { type: "Display Data" };
    if (syx[2] !== 66) return OTHER;
    const a1 = syx[4];
    const a2 = syx[5];
    const a3 = syx[6];
    const data = syx[7];
    if ((a1 === 0 || a1 === 64) && a2 === 0) switch (a3) {
      case 0:
        return {
          type: "Global MIDI Param",
          parameter: "fineTune",
          value: ((data << 12 | syx[8] << 8 | syx[9] << 4 | syx[10]) - 1024) / 10
        };
      case 4:
        return {
          type: "Global MIDI Param",
          parameter: "volume",
          value: data / 127
        };
      case 5:
        return {
          type: "Global MIDI Param",
          parameter: "keyShift",
          value: data - 64
        };
      case 6:
        return {
          type: "Global MIDI Param",
          parameter: "pan",
          value: (data - 64) / 63
        };
      case 127:
        switch (data) {
          case 0:
          case 1:
            return {
              type: "Global MIDI Param",
              parameter: "system",
              value: "gs"
            };
          case 127:
            return {
              type: "Global MIDI Param",
              parameter: "system",
              value: "gm"
            };
        }
        return OTHER;
    }
    if (a1 === 65) return { type: "Drum Setup" };
    if (a1 !== 64 && a1 !== 80) return OTHER;
    const channelOffset = a1 === 80 ? 16 : 0;
    if (a2 === 1) {
      if (a3 >= 48 && a3 <= 55) return { type: "Reverb Param" };
      if (a3 >= 56 && a3 <= 64) return { type: "Chorus Param" };
      if (a3 >= 80 && a3 <= 90) return { type: "Delay Param" };
    }
    if (a2 === 3 && a3 >= 0 && a3 <= 127) return { type: "Insertion Param" };
    if (a2 >> 4 === 1) {
      const channel = MIDIUtils2.syxToChannel(a2 & 15) + channelOffset;
      switch (a3) {
        default:
          return OTHER;
        case 0:
          return {
            type: "Program Change",
            channel,
            value: data
          };
        case 19:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "polyMode",
            value: data === 1
          };
        case 20:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "assignMode",
            value: data
          };
        case 21:
          return {
            type: "Drums On",
            channel,
            isDrum: data > 0
          };
        case 22:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "keyShift",
            value: data - 64
          };
        case 25:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.mainVolume,
            value: data
          };
        case 26:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "velocitySenseDepth",
            value: data
          };
        case 27:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "velocitySenseOffset",
            value: data
          };
        case 28:
          if (data === 0) return {
            type: "Channel MIDI Param",
            channel,
            parameter: "randomPan",
            value: true
          };
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.pan,
            value: data
          };
        case 31:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "cc1",
            value: data
          };
        case 32:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "cc2",
            value: data
          };
        case 33:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.chorusDepth,
            value: data
          };
        case 34:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.reverbDepth,
            value: data
          };
        case 42:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "fineTune",
            value: ((data << 7 | syx[8]) - 8192) / 81.92
          };
        case 44:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.variationDepth,
            value: data
          };
        case 48:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.vibratoRate,
            value: data
          };
        case 49:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.vibratoDepth,
            value: data
          };
        case 50:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.brightness,
            value: data
          };
        case 51:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.filterResonance,
            value: data
          };
        case 52:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.attackTime,
            value: data
          };
        case 53:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.decayTime,
            value: data
          };
        case 54:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.releaseTime,
            value: data
          };
        case 55:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.vibratoDelay,
            value: data
          };
      }
    }
    if (a2 >> 4 === 4) {
      const channel = MIDIUtils2.syxToChannel(a2 & 15) + channelOffset;
      switch (a3) {
        default:
          return OTHER;
        case 0:
        case 1:
          return {
            type: "Controller Change",
            channel,
            controller: MIDIControllers.bankSelectLSB,
            value: data
          };
        case 34:
          return {
            type: "Channel MIDI Param",
            channel,
            parameter: "efxAssign",
            value: data === 1
          };
      }
    }
    return OTHER;
  }
};
function toISODateString(date) {
  return date.toISOString().split(".")[0] + "Z";
}
var translations = [/* @__PURE__ */ new Map([
  ["domingo", "Sunday"],
  ["segunda-feira", "Monday"],
  ["ter\xE7a-feira", "Tuesday"],
  ["quarta-feira", "Wednesday"],
  ["quinta-feira", "Thursday"],
  ["sexta-feira", "Friday"],
  ["s\xE1bado", "Saturday"],
  ["janeiro", "January"],
  ["fevereiro", "February"],
  ["mar\xE7o", "March"],
  ["abril", "April"],
  ["maio", "May"],
  ["junho", "June"],
  ["julho", "July"],
  ["agosto", "August"],
  ["setembro", "September"],
  ["outubro", "October"],
  ["novembro", "November"],
  ["dezembro", "December"]
])];
function tryTranslate(dateString) {
  for (const translation of translations) {
    let translated = dateString;
    for (const [pt, english] of translation.entries()) {
      const regex = new RegExp(pt, "gi");
      translated = translated.replace(regex, english);
    }
    const date = new Date(translated);
    if (!Number.isNaN(date.getTime())) return date;
  }
}
function tryDotted(dateString) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateString);
  if (match) {
    const day = Number.parseInt(match[1]);
    const month = Number.parseInt(match[2]) - 1;
    const year = Number.parseInt(match[3]);
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime())) return date;
  }
}
function tryAWE(dateString) {
  const match = /^(\d{1,2})\s{1,2}(\d{1,2})\s{1,2}(\d{2})$/.exec(dateString);
  if (match) {
    const day = match[1];
    const month = (Number.parseInt(match[2]) + 1).toString();
    const year = match[3];
    const date = /* @__PURE__ */ new Date(`${month}/${day}/${year}`);
    if (!Number.isNaN(date.getTime())) return date;
  }
}
function tryYear(dateString) {
  const match = /\b\d{4}\b/.exec(dateString);
  return match ? new Date(match[0]) : void 0;
}
function parseDateString(dateString) {
  dateString = dateString.trim();
  if (dateString.length === 0) return /* @__PURE__ */ new Date();
  const filtered = dateString.replaceAll(/\b(\d+)(st|nd|rd|th)\b/g, "$1").replace(/\s+at\s+/i, " ");
  const date = new Date(filtered);
  if (Number.isNaN(date.getTime())) {
    const translated = tryTranslate(dateString);
    if (translated) return translated;
    const dotted = tryDotted(dateString);
    if (dotted) return dotted;
    const awe = tryAWE(dateString);
    if (awe) return awe;
    const year = tryYear(dateString);
    if (year) return year;
    SpessaLog.warn(`Invalid date: "${dateString}". Replacing with the current date!`);
    return /* @__PURE__ */ new Date();
  }
  return date;
}
var DEFAULT_MIDI_CONTROLLERS = new Int16Array(128).fill(0);
var setResetValue = (i, v) => DEFAULT_MIDI_CONTROLLERS[i] = v << 7;
setResetValue(MIDIControllers.mainVolume, 100);
setResetValue(MIDIControllers.balance, 64);
setResetValue(MIDIControllers.expression, 127);
setResetValue(MIDIControllers.pan, 64);
setResetValue(MIDIControllers.filterResonance, 64);
setResetValue(MIDIControllers.releaseTime, 64);
setResetValue(MIDIControllers.attackTime, 64);
setResetValue(MIDIControllers.brightness, 64);
setResetValue(MIDIControllers.decayTime, 64);
setResetValue(MIDIControllers.vibratoRate, 64);
setResetValue(MIDIControllers.vibratoDepth, 64);
setResetValue(MIDIControllers.vibratoDelay, 64);
setResetValue(MIDIControllers.generalPurposeController6, 64);
setResetValue(MIDIControllers.generalPurposeController8, 64);
setResetValue(MIDIControllers.registeredParameterLSB, 127);
setResetValue(MIDIControllers.registeredParameterMSB, 127);
setResetValue(MIDIControllers.nonRegisteredParameterLSB, 0);
setResetValue(MIDIControllers.nonRegisteredParameterMSB, 0);
var DEFAULT_DRUM_REVERB = new Int8Array(128).fill(127);
DEFAULT_DRUM_REVERB[35] = 0;
DEFAULT_DRUM_REVERB[36] = 0;
function resetChannelInternal(sendCCEvents = true) {
  for (let cc = 0; cc < 128; cc++) {
    if (this.lockedControllers[cc]) {
      this.synthCore.callEvent("controllerChange", {
        channel: this.channel,
        controller: cc,
        value: this._midiControllers[cc] >> 7
      });
      continue;
    }
    const resetValue = DEFAULT_MIDI_CONTROLLERS[cc];
    if (this._midiControllers[cc] !== resetValue && cc !== MIDIControllers.portamentoControl && cc !== MIDIControllers.dataEntryMSB && cc !== MIDIControllers.registeredParameterMSB && cc !== MIDIControllers.registeredParameterLSB && cc !== MIDIControllers.nonRegisteredParameterMSB && cc !== MIDIControllers.nonRegisteredParameterLSB) this.controllerChange(cc, resetValue >> 7, sendCCEvents);
  }
  this.setMIDIParameter("pressure", 0);
  this.setMIDIParameter("pitchWheelRange", 2);
  this.setMIDIParameter("modulationDepth", 50);
  this.setMIDIParameter("rxChannel", this.channel);
  this.setMIDIParameter("efxAssign", false);
  this.setMIDIParameter("polyMode", true);
  this.setMIDIParameter("keyShift", 0);
  this.setMIDIParameter("fineTune", 0);
  this.setMIDIParameter("assignMode", 2);
  this.setMIDIParameter("randomPan", false);
  this.setMIDIParameter("cc1", 16);
  this.setMIDIParameter("cc2", 17);
  this.setMIDIParameter("drumMap", this.channel % 16 === 9 ? 1 : 0);
  this.setMIDIParameter("velocitySenseOffset", 64);
  this.setMIDIParameter("velocitySenseDepth", 64);
  this.pitchWheel(8192);
  this.octaveTuning.fill(0);
  this.lastPortamentoNote = this.channelSystem === "xg" ? 60 : -1;
  this.resetDrumParams();
  this.resetGeneratorOverrides();
  this.resetGeneratorOffsets();
  this.dynamicModulators.resetModulators();
  this.sf2NRPNGeneratorLSB = 0;
  this.playingNotes.fill(false);
  this.lastParameterIsRegistered = true;
  this._midiControllers[MIDIControllers.nonRegisteredParameterLSB] = 0;
  this._midiControllers[MIDIControllers.nonRegisteredParameterMSB] = 0;
  this._midiControllers[MIDIControllers.registeredParameterLSB] = 16256;
  this._midiControllers[MIDIControllers.registeredParameterMSB] = 16256;
  this._midiControllers[MIDIControllers.dataEntryMSB] = 0;
  this._midiControllers[MIDIControllers.dataEntryLSB] = 0;
  this.setBankMSB(BankSelectHacks.getDefaultBank(this.channelSystem));
  this.setBankLSB(0);
  this.setGSDrums(false);
  this.setDrums(this.channel % 16 === 9);
  this.programChange(0);
}
var RP_15_RESET_CC_NUMS = [
  MIDIControllers.modulationWheel,
  MIDIControllers.expression,
  MIDIControllers.sustainPedal,
  MIDIControllers.portamentoOnOff,
  MIDIControllers.sostenutoPedal,
  MIDIControllers.softPedal,
  MIDIControllers.registeredParameterMSB,
  MIDIControllers.registeredParameterLSB
];
function resetRP15() {
  this.pitchWheel(8192);
  this.setMIDIParameter("pressure", 0);
  for (const resetCC of RP_15_RESET_CC_NUMS) {
    const resetValue = DEFAULT_MIDI_CONTROLLERS[resetCC];
    if (resetValue !== this._midiControllers[resetCC]) this.controllerChange(resetCC, resetValue >> 7);
  }
}
var nonSkippableCCs = /* @__PURE__ */ new Set([
  MIDIControllers.dataDecrement,
  MIDIControllers.dataIncrement,
  MIDIControllers.dataEntryMSB,
  MIDIControllers.dataEntryLSB,
  MIDIControllers.registeredParameterLSB,
  MIDIControllers.registeredParameterMSB,
  MIDIControllers.nonRegisteredParameterLSB,
  MIDIControllers.nonRegisteredParameterMSB,
  MIDIControllers.bankSelect,
  MIDIControllers.bankSelectLSB,
  MIDIControllers.resetAllControllers,
  MIDIControllers.monoModeOn,
  MIDIControllers.polyModeOn
]);
var InterpolationTypes = {
  linear: 0,
  nearestNeighbor: 1,
  hermite: 2
};
var DEFAULT_SYNTH_OPTIONS = {
  effectsEnabled: true,
  maxBufferSize: 128,
  initialTime: 0,
  eventsEnabled: true
};
var KeyModifierManager = class {
  /**
  * The velocity override mappings for MIDI keys
  * stored as [channelNumber][midiNote].
  */
  keyMappings = [];
  /**
  * Add a mapping for a MIDI key to a KeyModifier.
  * @param channel The MIDI channel number.
  * @param midiNote The MIDI note number (0-127).
  * @param mapping The KeyModifier to apply for this key.
  */
  addMapping(channel, midiNote, mapping) {
    this.keyMappings[channel] ??= [];
    this.keyMappings[channel][midiNote] = mapping;
  }
  /**
  * Delete a mapping for a MIDI key.
  * @param channel The MIDI channel number.
  * @param midiNote The MIDI note number (0-127).
  */
  deleteMapping(channel, midiNote) {
    if (this.keyMappings[channel]?.[midiNote] === void 0) return;
    this.keyMappings[channel][midiNote] = void 0;
  }
  /**
  * Clear all key mappings.
  */
  clearMappings() {
    this.keyMappings = [];
  }
  /**
  * Sets the key mappings to a new array.
  * @param mappings A 2D array where the first dimension is the channel number and the second dimension is the MIDI note number.
  */
  setMappings(mappings) {
    this.keyMappings = mappings;
  }
  /**
  * Returns the current key mappings.
  */
  getMappings() {
    return this.keyMappings;
  }
  /**
  * Gets the velocity override for a MIDI key.
  * @param channel The MIDI channel number.
  * @param midiNote The MIDI note number (0-127).
  * @returns The velocity override, or -1 if no override is set.
  */
  getVelocity(channel, midiNote) {
    return this.keyMappings[channel]?.[midiNote]?.velocity ?? -1;
  }
  /**
  * Gets the gain override for a MIDI key.
  * @param channel The MIDI channel number.
  * @param midiNote The MIDI note number (0-127).
  * @returns The gain override, or 1 if no override is set.
  */
  getGain(channel, midiNote) {
    return this.keyMappings[channel]?.[midiNote]?.gain ?? 1;
  }
  /**
  * Checks if a MIDI key has an override for the patch.
  * @param channel The MIDI channel number.
  * @param midiNote The MIDI note number (0-127).
  * @returns True if the key has an override patch, false otherwise.
  */
  hasOverridePatch(channel, midiNote) {
    const bank = this.keyMappings[channel]?.[midiNote]?.patch?.bankMSB;
    return bank !== void 0 && bank >= 0;
  }
  /**
  * Gets the patch override for a MIDI key.
  * @param channel The MIDI channel number.
  * @param midiNote The MIDI note number (0-127).
  * @returns An object containing the bank and program numbers.
  * @throws Error if no modifier is set for the key.
  */
  getPatch(channel, midiNote) {
    const modifier = this.keyMappings[channel]?.[midiNote];
    if (modifier) return modifier.patch;
    throw new Error("No modifier.");
  }
};
function applySnapshot$1(snapshot) {
  this.keyModifierManager.setMappings(snapshot.keyMappings);
  while (this.midiChannels.length < snapshot.midiChannels.length) this.createMIDIChannel(true);
  for (let i = 0; i < snapshot.midiChannels.length; i++) this.midiChannels[i].applySnapshot(snapshot.midiChannels[i]);
  for (const [key, value] of Object.entries(snapshot.reverbProcessor)) this.reverbProcessor[key] = value;
  for (const [key, value] of Object.entries(this.chorusProcessor)) this.chorusProcessor[key] = value;
  for (const [key, value] of Object.entries(this.delayProcessor)) this.delayProcessor[key] = value;
  const is = snapshot.insertionProcessor;
  this.systemExclusive(MIDIUtils.gs(64, 3, 0, [is.type >> 8, is.type & 127]));
  for (let i = 0; i < is.params.length; i++) if (is.params[i] !== 255) this.systemExclusive(MIDIUtils.gs(64, 3, 3 + i, [is.params[i]]));
  for (const parameter of Object.keys(snapshot.lockedMIDIParameters)) this.lockMIDIParameter(parameter, false);
  for (const [parameter, value] of Object.entries(snapshot.midiParameters)) this.setMIDIParameter(parameter, value);
  for (const [parameter, isLocked] of Object.entries(snapshot.lockedMIDIParameters)) this.lockMIDIParameter(parameter, isLocked);
  for (const [parameter, value] of Object.entries(snapshot.systemParameters)) this.setSystemParameter(parameter, value);
  this.updateActiveEffects();
}
function getSynthesizerSnapshot() {
  return {
    midiParameters: { ...this.midiParameters },
    lockedMIDIParameters: { ...this.lockedMIDIParameters },
    systemParameters: { ...this.systemParameters },
    midiChannels: this.midiChannels.map((c) => c.getSnapshot()),
    keyMappings: this.keyModifierManager.getMappings(),
    reverbProcessor: this.reverbProcessor.getSnapshot(),
    chorusProcessor: this.chorusProcessor.getSnapshot(),
    delayProcessor: this.delayProcessor.getSnapshot(),
    insertionProcessor: this.getInsertionSnapshot()
  };
}
var MIN_TIMECENT = -15e3;
var timecentLookupTable = new Float32Array(15e3 - MIN_TIMECENT + 1);
for (let i = 0; i < timecentLookupTable.length; i++) {
  const timecents = MIN_TIMECENT + i;
  timecentLookupTable[i] = Math.pow(2, timecents / 1200);
}
function timecentsToSeconds(timecents) {
  if (timecents <= -32767) return 0;
  return timecentLookupTable[timecents - MIN_TIMECENT];
}
var MIN_ABS_CENT = -2e4;
var MAX_ABS_CENT = 16500;
var absoluteCentLookupTable = new Float32Array(MAX_ABS_CENT - MIN_ABS_CENT + 1);
for (let i = 0; i < absoluteCentLookupTable.length; i++) {
  const absoluteCents = MIN_ABS_CENT + i;
  absoluteCentLookupTable[i] = 440 * Math.pow(2, (absoluteCents - 6900) / 1200);
}
function absCentsToHz(cents) {
  if (cents < MIN_ABS_CENT || cents > MAX_ABS_CENT) return 440 * Math.pow(2, (cents - 6900) / 1200);
  return absoluteCentLookupTable[cents - MIN_ABS_CENT | 0];
}
var MIN_CENTIBELS = -16600;
var CENTIBEL_LOOKUP_TABLE = new Float32Array(16e3 - MIN_CENTIBELS + 1);
for (let i = 0; i < CENTIBEL_LOOKUP_TABLE.length; i++) {
  const centibels = MIN_CENTIBELS + i;
  CENTIBEL_LOOKUP_TABLE[i] = Math.pow(10, -centibels / 200);
}
function cbAttenuationToGain(centibels) {
  return CENTIBEL_LOOKUP_TABLE[centibels - MIN_CENTIBELS | 0];
}
var GeneratorTypes = Object.freeze({
  invalid: -1,
  startAddrsOffset: 0,
  endAddrOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modLfoToPitch: 5,
  vibLfoToPitch: 6,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modLfoToFilterFc: 10,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  modLfoToVolume: 13,
  chorusEffectsSend: 15,
  reverbEffectsSend: 16,
  pan: 17,
  delayModLFO: 21,
  freqModLFO: 22,
  delayVibLFO: 23,
  freqVibLFO: 24,
  delayModEnv: 25,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  keyNumToModEnvHold: 31,
  keyNumToModEnvDecay: 32,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keyNumToVolEnvHold: 39,
  keyNumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keyNum: 46,
  velocity: 47,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
  endOper: 60,
  amplitude: 61,
  vibLfoRate: 62,
  vibLfoAmplitudeDepth: 63,
  vibLfoToFilterFc: 64,
  modLfoRate: 65,
  modLfoAmplitudeDepth: 66
});
var MAX_GENERATOR = Math.max(...Object.values(GeneratorTypes));
var GENERATORS_AMOUNT = MAX_GENERATOR + 1;
var GeneratorLimits = Object.freeze({
  [GeneratorTypes.invalid]: {
    min: 0,
    max: 0,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.endOper]: {
    min: 0,
    max: 0,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.instrument]: {
    min: 0,
    max: 0,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.sampleID]: {
    min: 0,
    max: 0,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.keyRange]: {
    min: 0,
    max: 0,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.velRange]: {
    min: 0,
    max: 0,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.startAddrsOffset]: {
    min: 0,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.endAddrOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.startloopAddrsOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.endloopAddrsOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.startAddrsCoarseOffset]: {
    min: 0,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.modLfoToPitch]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [GeneratorTypes.vibLfoToPitch]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [GeneratorTypes.modEnvToPitch]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [GeneratorTypes.initialFilterFc]: {
    min: 1500,
    max: 13500,
    def: 13500,
    nrpn: 2
  },
  [GeneratorTypes.initialFilterQ]: {
    min: 0,
    max: 960,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.modLfoToFilterFc]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [GeneratorTypes.modEnvToFilterFc]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [GeneratorTypes.endAddrsCoarseOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.modLfoToVolume]: {
    min: -960,
    max: 960,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.chorusEffectsSend]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.reverbEffectsSend]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.pan]: {
    min: -500,
    max: 500,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.delayModLFO]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.freqModLFO]: {
    min: -16e3,
    max: 4500,
    def: 0,
    nrpn: 4
  },
  [GeneratorTypes.delayVibLFO]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.freqVibLFO]: {
    min: -16e3,
    max: 4500,
    def: 0,
    nrpn: 4
  },
  [GeneratorTypes.delayModEnv]: {
    min: -32768,
    max: 5e3,
    def: -32768,
    nrpn: 2
  },
  [GeneratorTypes.attackModEnv]: {
    min: -32768,
    max: 8e3,
    def: -32768,
    nrpn: 2
  },
  [GeneratorTypes.holdModEnv]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.decayModEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.sustainModEnv]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.releaseModEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.keyNumToModEnvHold]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.keyNumToModEnvDecay]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.delayVolEnv]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.attackVolEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.holdVolEnv]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.decayVolEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.sustainVolEnv]: {
    min: 0,
    max: 1440,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.releaseVolEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [GeneratorTypes.keyNumToVolEnvHold]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.keyNumToVolEnvDecay]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.startloopAddrsCoarseOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.keyNum]: {
    min: -1,
    max: 127,
    def: -1,
    nrpn: 1
  },
  [GeneratorTypes.velocity]: {
    min: -1,
    max: 127,
    def: -1,
    nrpn: 1
  },
  [GeneratorTypes.initialAttenuation]: {
    min: 0,
    max: 1440,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.endloopAddrsCoarseOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.coarseTune]: {
    min: -120,
    max: 120,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.fineTune]: {
    min: -12700,
    max: 12700,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.scaleTuning]: {
    min: 0,
    max: 1200,
    def: 100,
    nrpn: 1
  },
  [GeneratorTypes.exclusiveClass]: {
    min: 0,
    max: 99999,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.overridingRootKey]: {
    min: -1,
    max: 127,
    def: -1,
    nrpn: 0
  },
  [GeneratorTypes.sampleModes]: {
    min: 0,
    max: 3,
    def: 0,
    nrpn: 0
  },
  [GeneratorTypes.amplitude]: {
    min: -1e3,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.vibLfoRate]: {
    min: -1e3,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.vibLfoToFilterFc]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [GeneratorTypes.vibLfoAmplitudeDepth]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.modLfoRate]: {
    min: -1e3,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [GeneratorTypes.modLfoAmplitudeDepth]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  }
});
var FILTER_SMOOTHING_FACTOR = 0.03;
var LowpassFilter = class LowpassFilter2 {
  /**
  * For smoothing the filter cutoff frequency.
  */
  static smoothingConstant = 1;
  /**
  * Cached coefficient calculations.
  * stored as cachedCoefficients[resonanceCb + currentInitialFc * 961].
  */
  static cachedCoefficients = /* @__PURE__ */ new Map();
  /**
  * Resonance in centibels.
  */
  resonanceCb = 0;
  /**
  * Current cutoff frequency in absolute cents.
  */
  currentInitialFc = 13500;
  /**
  * Filter coefficient 1.
  */
  a0 = 0;
  /**
  * Filter coefficient 2.
  */
  a1 = 0;
  /**
  * Filter coefficient 3.
  */
  a2 = 0;
  /**
  * Filter coefficient 4.
  */
  a3 = 0;
  /**
  * Filter coefficient 5.
  */
  a4 = 0;
  /**
  * Input history 1.
  */
  x1 = 0;
  /**
  * Input history 2.
  */
  x2 = 0;
  /**
  * Output history 1.
  */
  y1 = 0;
  /**
  * Output history 2.
  */
  y2 = 0;
  /**
  * For tracking the last cutoff frequency in the apply method, absolute cents.
  * Set to infinity to force recalculation.
  */
  lastTargetCutoff = Infinity;
  /**
  * Used for tracking if the filter has been initialized.
  */
  initialized = false;
  /**
  * Filter's sample rate in Hz.
  */
  sampleRate;
  /**
  * Maximum cutoff frequency in Hz.
  * This is used to prevent aliasing and ensure the filter operates within the valid frequency range.
  */
  maxCutoff;
  /**
  * Initializes a new instance of the filter.
  * @param sampleRate the sample rate of the audio engine in Hz.
  */
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.maxCutoff = sampleRate * 0.45;
  }
  static initCache(sampleRate) {
    LowpassFilter2.smoothingConstant = FILTER_SMOOTHING_FACTOR * (44100 / sampleRate);
    const dummy = new LowpassFilter2(sampleRate);
    dummy.resonanceCb = 0;
    for (let i = 8e3; i < 13500; i++) {
      dummy.currentInitialFc = i;
      dummy.calculateCoefficients(i);
    }
  }
  init() {
    this.lastTargetCutoff = Infinity;
    this.resonanceCb = 0;
    this.currentInitialFc = 13500;
    this.a0 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.a4 = 0;
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
    this.initialized = false;
  }
  /**
  * Calculates the filter coefficients based on the current resonance and cutoff frequency and caches them.
  * @param cutoffCents The cutoff frequency in cents.
  */
  calculateCoefficients(cutoffCents) {
    cutoffCents = cutoffCents | 0;
    const qCb = this.resonanceCb;
    const cached = LowpassFilter2.cachedCoefficients.get(qCb + cutoffCents * 961);
    if (cached !== void 0) {
      this.a0 = cached.a0;
      this.a1 = cached.a1;
      this.a2 = cached.a2;
      this.a3 = cached.a3;
      this.a4 = cached.a4;
      return;
    }
    let cutoffHz = absCentsToHz(cutoffCents);
    cutoffHz = Math.min(cutoffHz, this.maxCutoff);
    const resonanceGain = cbAttenuationToGain(-(qCb - 3.01));
    const qGain = 1 / Math.sqrt(cbAttenuationToGain(-qCb));
    const w = 2 * Math.PI * cutoffHz / this.sampleRate;
    const cosw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * resonanceGain);
    const b1 = (1 - cosw) * qGain;
    const b0 = b1 / 2;
    const b2 = b0;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha;
    const toCache = {
      a0: b0 / a0,
      a1: b1 / a0,
      a2: b2 / a0,
      a3: a1 / a0,
      a4: a2 / a0
    };
    this.a0 = toCache.a0;
    this.a1 = toCache.a1;
    this.a2 = toCache.a2;
    this.a3 = toCache.a3;
    this.a4 = toCache.a4;
    LowpassFilter2.cachedCoefficients.set(qCb + cutoffCents * 961, toCache);
  }
};
var HALF_PI$1 = Math.PI / 2;
var MIN_PAN$1 = -500;
var MAX_PAN$1 = 500;
var PAN_RESOLUTION$1 = MAX_PAN$1 - MIN_PAN$1;
var panTableLeft = new Float32Array(PAN_RESOLUTION$1 + 1);
var panTableRight = new Float32Array(PAN_RESOLUTION$1 + 1);
for (let pan = MIN_PAN$1; pan <= MAX_PAN$1; pan++) {
  const realPan = (pan - MIN_PAN$1) / PAN_RESOLUTION$1;
  const tableIndex = pan - MIN_PAN$1;
  panTableLeft[tableIndex] = Math.cos(HALF_PI$1 * realPan);
  panTableRight[tableIndex] = Math.sin(HALF_PI$1 * realPan);
}
function renderVoice(voice, timeNow, outputL, outputR, startIndex, sampleCount) {
  if (!voice.isInRelease && timeNow >= voice.releaseStartTime) {
    voice.isInRelease = true;
    voice.volEnv.startRelease(voice);
    voice.modEnv.startRelease(voice);
    if (voice.loopingMode === 3) voice.wavetable.isLooping = false;
  }
  voice.hasRendered = true;
  if (!voice.isActive) return;
  const core = this.synthCore;
  const sampleRate = core.sampleRate;
  const modulated = voice.modulatedGenerators;
  let targetKey = voice.targetKey;
  let cents = voice.pitchOffset + modulated[GeneratorTypes.fineTune] + this.octaveTuning[targetKey] + this.currentTuning;
  let semitones = modulated[GeneratorTypes.coarseTune];
  const tuning = core.tunings[this.preset.program * 128 + voice.midiNote];
  if (tuning !== -1) {
    targetKey = Math.trunc(tuning);
    semitones += tuning - targetKey;
  }
  if (voice.portamentoFromKey > -1) {
    const elapsed = Math.min((timeNow - voice.startTime) / voice.portamentoDuration, 1);
    const diff = targetKey - voice.portamentoFromKey;
    semitones -= diff * (1 - elapsed);
  }
  cents += (targetKey - voice.rootKey) * modulated[GeneratorTypes.scaleTuning];
  let lowpassExcursion = 0;
  let volumeExcursionCentibels = 0;
  let voiceGain = voice.gainModifier * (1 + modulated[GeneratorTypes.amplitude] / 1e3);
  if (timeNow >= voice.vibLfoStartTime) {
    const vibPitchDepth = modulated[GeneratorTypes.vibLfoToPitch];
    const vibFilterDepth = modulated[GeneratorTypes.vibLfoToFilterFc];
    const vibAmplitudeDepth = modulated[GeneratorTypes.vibLfoAmplitudeDepth];
    if (vibPitchDepth !== 0 || vibFilterDepth !== 0 || vibAmplitudeDepth !== 0) {
      const rateInc = Math.max(0, absCentsToHz(modulated[GeneratorTypes.freqVibLFO]) + modulated[GeneratorTypes.vibLfoRate] / 100) * sampleCount / sampleRate;
      const vibLfoValue = 1 - 4 * Math.abs(voice.vibLfoPhase - 0.5);
      if ((voice.vibLfoPhase += rateInc) >= 1) voice.vibLfoPhase -= 1;
      cents += vibLfoValue * vibPitchDepth;
      lowpassExcursion += vibLfoValue * vibFilterDepth;
      voiceGain *= 1 - (vibLfoValue + 1) / 2 * (vibAmplitudeDepth / 1e3);
    }
  }
  if (timeNow >= voice.modLfoStartTime) {
    const modPitchDepth = modulated[GeneratorTypes.modLfoToPitch];
    const modVolDepth = modulated[GeneratorTypes.modLfoToVolume];
    const modFilterDepth = modulated[GeneratorTypes.modLfoToFilterFc];
    const modAmplitudeDepth = modulated[GeneratorTypes.modLfoAmplitudeDepth];
    if (modPitchDepth !== 0 || modFilterDepth !== 0 || modVolDepth !== 0 || modAmplitudeDepth !== 0) {
      const rateInc = Math.max(0, absCentsToHz(modulated[GeneratorTypes.freqModLFO]) + modulated[GeneratorTypes.modLfoRate] / 100) * sampleCount / sampleRate;
      const modLfoValue = 1 - 4 * Math.abs(voice.modLfoPhase - 0.5);
      if ((voice.modLfoPhase += rateInc) >= 1) voice.modLfoPhase -= 1;
      cents += modLfoValue * modPitchDepth;
      volumeExcursionCentibels += -modLfoValue * modVolDepth;
      lowpassExcursion += modLfoValue * modFilterDepth;
      voiceGain *= 1 - (modLfoValue + 1) / 2 * (modAmplitudeDepth / 1e3);
    }
  }
  const modEnvPitchDepth = modulated[GeneratorTypes.modEnvToPitch];
  const modEnvFilterDepth = modulated[GeneratorTypes.modEnvToFilterFc];
  if (modEnvFilterDepth !== 0 || modEnvPitchDepth !== 0) {
    const modEnv = voice.modEnv.process(voice, timeNow);
    lowpassExcursion += modEnv * modEnvFilterDepth;
    cents += modEnv * modEnvPitchDepth;
  }
  volumeExcursionCentibels -= voice.resonanceOffset;
  const centsTotal = cents + semitones * 100;
  const centsRounded = centsTotal | 0;
  if (centsRounded !== voice.tuningCents) {
    voice.tuningCents = centsRounded;
    voice.tuningRatio = Math.pow(2, centsTotal / 1200);
  }
  const gainTarget = cbAttenuationToGain(modulated[GeneratorTypes.initialAttenuation]) * cbAttenuationToGain(volumeExcursionCentibels);
  if (voice.loopingMode === 2 && !voice.isInRelease) {
    voice.isActive = voice.volEnv.process(sampleCount, gainTarget);
    return;
  }
  const buffer = core.voiceBuffer;
  voice.isActive = voice.wavetable.process(sampleCount, voice.tuningRatio, buffer);
  let gain = voice.volEnv.outputGain;
  const envActive = voice.volEnv.process(sampleCount, gainTarget);
  const gainInc = (voice.volEnv.outputGain - gain) / sampleCount;
  {
    const f = voice.filter;
    const initialFc = modulated[GeneratorTypes.initialFilterFc];
    if (f.initialized) f.currentInitialFc += (initialFc - f.currentInitialFc) * LowpassFilter.smoothingConstant;
    else {
      f.initialized = true;
      f.currentInitialFc = initialFc;
    }
    const targetCutoff = f.currentInitialFc + lowpassExcursion;
    const modulatedResonance = modulated[GeneratorTypes.initialFilterQ];
    if (f.currentInitialFc > 13499 && targetCutoff > 13499 && modulatedResonance === 0) {
      f.currentInitialFc = 13500;
      for (let i = 0; i < sampleCount; i++) {
        buffer[i] *= gain;
        gain += gainInc;
      }
    } else {
      if (Math.abs(f.lastTargetCutoff - targetCutoff) > 1 || f.resonanceCb !== modulatedResonance) {
        f.lastTargetCutoff = targetCutoff;
        f.resonanceCb = modulatedResonance;
        f.calculateCoefficients(targetCutoff);
      }
      const { a0, a1, a2, a3, a4 } = f;
      let { x1, x2, y1, y2 } = f;
      for (let i = 0; i < sampleCount; i++) {
        const input = buffer[i];
        const filtered = a0 * input + a1 * x1 + a2 * x2 - a3 * y1 - y2 * a4;
        x2 = x1;
        x1 = input;
        y2 = y1;
        y1 = filtered;
        buffer[i] = filtered * gain;
        gain += gainInc;
      }
      f.x1 = x1;
      f.x2 = x2;
      f.y1 = y1;
      f.y2 = y2;
    }
  }
  voice.isActive = voice.isActive && envActive;
  let pan;
  if (voice.overridePan) pan = voice.overridePan;
  else {
    voice.currentPan += (modulated[GeneratorTypes.pan] - voice.currentPan) * core.panSmoothingFactor;
    pan = voice.currentPan;
  }
  const { systemParameters } = core;
  const outputGain = this.currentGain * voiceGain;
  const index = Math.min(Math.max(-500, pan + this.currentPan), 500) + 500 | 0;
  const gainLeft = panTableLeft[index] * outputGain;
  const gainRight = panTableRight[index] * outputGain;
  if (this._midiParameters.efxAssign && systemParameters.effectsEnabled && core.insertionActive) {
    const insertionL = core.insertionInputL;
    const insertionR = core.insertionInputR;
    for (let i = 0; i < sampleCount; i++) {
      const s = buffer[i];
      insertionL[i] += gainLeft * s;
      insertionR[i] += gainRight * s;
    }
    return;
  }
  for (let i = 0; i < sampleCount; i++) {
    const s = buffer[i];
    const idx = i + startIndex;
    outputL[idx] += gainLeft * s;
    outputR[idx] += gainRight * s;
  }
  if (!systemParameters.effectsEnabled) return;
  const reverbSend = modulated[GeneratorTypes.reverbEffectsSend] * voice.reverbSend;
  if (reverbSend > 0) {
    const reverbGain = systemParameters.reverbGain * outputGain * (reverbSend / 1e3);
    const reverb2 = core.reverbInput;
    for (let i = 0; i < sampleCount; i++) reverb2[i] += reverbGain * buffer[i];
  }
  const chorusSend = modulated[GeneratorTypes.chorusEffectsSend] * voice.chorusSend;
  if (chorusSend > 0) {
    const chorusGain = systemParameters.chorusGain * (chorusSend / 1e3) * outputGain;
    const chorus = core.chorusInput;
    for (let i = 0; i < sampleCount; i++) chorus[i] += chorusGain * buffer[i];
  }
  if (core.delayActive) {
    const delaySend = this._midiControllers[MIDIControllers.variationDepth] * voice.delaySend;
    if (delaySend > 0) {
      const delayGain = outputGain * systemParameters.delayGain * ((delaySend >> 7) / 127);
      const delay = core.delayInput;
      for (let i = 0; i < sampleCount; i++) delay[i] += delayGain * buffer[i];
    }
  }
}
function controllerChange(controller, value, sendEvent = true) {
  if (controller > 127 || value < 0) throw new Error("Invalid MIDI Controller.");
  if (controller >= MIDIControllers.modulationWheelLSB && controller <= MIDIControllers.effectControl2LSB) {
    const actualCCNum = controller - 32;
    if (this.lockedControllers[actualCCNum]) return;
    this._midiControllers[actualCCNum] = this._midiControllers[actualCCNum] & 16256 | value & 127;
    this.computeModulatorsAll(1, actualCCNum);
  }
  if (this.lockedControllers[controller]) return;
  this._midiControllers[controller] = value << 7 | this._midiControllers[controller] & 127;
  switch (controller) {
    case MIDIControllers.omniModeOff:
    case MIDIControllers.omniModeOn:
    case MIDIControllers.allNotesOff:
      this.stopAllNotes();
      break;
    case MIDIControllers.allSoundOff:
      this.stopAllNotes(true);
      break;
    case MIDIControllers.polyModeOn:
      this.stopAllNotes(true);
      this.setMIDIParameter("polyMode", true);
      break;
    case MIDIControllers.monoModeOn:
      this.stopAllNotes(true);
      this.setMIDIParameter("polyMode", false);
      break;
    case MIDIControllers.bankSelect:
      this.setBankMSB(value);
      if (this.channel % 16 === 9 && BankSelectHacks.isSystemXG(this.channelSystem)) this.setBankMSB(127);
      break;
    case MIDIControllers.bankSelectLSB:
      this.setBankLSB(value);
      break;
    case MIDIControllers.variationDepth:
      this.synthCore.updateActiveEffects();
      break;
    case MIDIControllers.registeredParameterLSB:
    case MIDIControllers.registeredParameterMSB:
      this._midiControllers[MIDIControllers.dataEntryMSB] = 0;
      this.lastParameterIsRegistered = true;
      break;
    case MIDIControllers.nonRegisteredParameterMSB:
      this.sf2NRPNGeneratorLSB = 0;
      this._midiControllers[MIDIControllers.dataEntryMSB] = 0;
      this.lastParameterIsRegistered = false;
      break;
    case MIDIControllers.nonRegisteredParameterLSB:
      if (this._midiControllers[MIDIControllers.nonRegisteredParameterMSB] >> 7 === NonRegisteredMSB.SF2) {
        if (this.sf2NRPNGeneratorLSB % 100 !== 0) this.sf2NRPNGeneratorLSB = 0;
        switch (value) {
          case 100:
            this.sf2NRPNGeneratorLSB += 100;
            break;
          case 101:
            this.sf2NRPNGeneratorLSB += 1e3;
            break;
          case 102:
            this.sf2NRPNGeneratorLSB += 1e4;
            break;
          default:
            if (value < 100) this.sf2NRPNGeneratorLSB += value;
        }
      }
      this._midiControllers[MIDIControllers.dataEntryMSB] = 0;
      this.lastParameterIsRegistered = false;
      break;
    case MIDIControllers.dataEntryMSB:
    case MIDIControllers.dataEntryLSB:
      this.dataEntry();
      break;
    case MIDIControllers.resetAllControllers:
      this.resetRP15();
      break;
    case MIDIControllers.sustainPedal:
      if (value < 64) {
        let vc = 0;
        if (this._voiceCount > 0) {
          for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive && v.isHeld) {
            v.isHeld = false;
            v.releaseVoice(this.synthCore.currentTime);
            if (++vc >= this._voiceCount) break;
          }
        }
      }
      break;
    case MIDIControllers.portamentoControl:
      this.lastPortamentoNote = value;
      this.portamentoForce = true;
      break;
    default:
      this.computeModulatorsAll(1, controller);
      break;
  }
  if (!sendEvent) return;
  this.synthCore.callEvent("controllerChange", {
    channel: this.channel,
    controller,
    value
  });
}
var AWE_NRPN_GENERATOR_MAPPINGS = [
  GeneratorTypes.delayModLFO,
  GeneratorTypes.freqModLFO,
  GeneratorTypes.delayVibLFO,
  GeneratorTypes.freqVibLFO,
  GeneratorTypes.delayModEnv,
  GeneratorTypes.attackModEnv,
  GeneratorTypes.holdModEnv,
  GeneratorTypes.decayModEnv,
  GeneratorTypes.sustainModEnv,
  GeneratorTypes.releaseModEnv,
  GeneratorTypes.delayVolEnv,
  GeneratorTypes.attackVolEnv,
  GeneratorTypes.holdVolEnv,
  GeneratorTypes.decayVolEnv,
  GeneratorTypes.sustainVolEnv,
  GeneratorTypes.releaseVolEnv,
  GeneratorTypes.fineTune,
  GeneratorTypes.modLfoToPitch,
  GeneratorTypes.vibLfoToPitch,
  GeneratorTypes.modEnvToPitch,
  GeneratorTypes.modLfoToVolume,
  GeneratorTypes.initialFilterFc,
  GeneratorTypes.initialFilterQ,
  GeneratorTypes.modLfoToFilterFc,
  GeneratorTypes.modEnvToFilterFc,
  GeneratorTypes.chorusEffectsSend,
  GeneratorTypes.reverbEffectsSend
];
var clip = (v, min, max) => Math.max(min, Math.min(max, v));
var msToTimecents = (ms) => Math.max(-32768, 1200 * Math.log2(ms / 1e3));
var hzToCents = (hz) => 6900 + 1200 * Math.log2(hz / 440);
function handleAWE32NRPN(paramLSB, dataValue) {
  const dataLSB = dataValue & 127;
  dataValue -= 8192;
  const generator = AWE_NRPN_GENERATOR_MAPPINGS[paramLSB];
  if (!generator) SpessaLog.unsupported(`AWE32 LSB for ${this.channel}`, [paramLSB], "Invalid Generator Number");
  let milliseconds, hertz, centibels, cents;
  switch (generator) {
    default:
      break;
    case GeneratorTypes.delayModLFO:
    case GeneratorTypes.delayVibLFO:
    case GeneratorTypes.delayVolEnv:
    case GeneratorTypes.delayModEnv:
      milliseconds = 4 * clip(dataValue, 0, 5900);
      this.setGeneratorOverride(generator, msToTimecents(milliseconds));
      break;
    case GeneratorTypes.attackVolEnv:
    case GeneratorTypes.attackModEnv:
      milliseconds = clip(dataValue, 0, 5940);
      this.setGeneratorOverride(generator, msToTimecents(milliseconds));
      break;
    case GeneratorTypes.holdVolEnv:
    case GeneratorTypes.holdModEnv:
      milliseconds = clip(dataValue, 0, 8191);
      this.setGeneratorOverride(generator, msToTimecents(milliseconds));
      break;
    case GeneratorTypes.decayModEnv:
    case GeneratorTypes.decayVolEnv:
    case GeneratorTypes.releaseVolEnv:
    case GeneratorTypes.releaseModEnv:
      milliseconds = 4 * clip(dataValue, 0, 5940);
      this.setGeneratorOverride(generator, msToTimecents(milliseconds));
      break;
    case GeneratorTypes.freqVibLFO:
    case GeneratorTypes.freqModLFO:
      hertz = 0.084 * dataLSB;
      this.setGeneratorOverride(generator, hzToCents(hertz), true);
      break;
    case GeneratorTypes.sustainVolEnv:
    case GeneratorTypes.sustainModEnv:
      centibels = dataLSB * 7.5;
      this.setGeneratorOverride(generator, centibels);
      break;
    case GeneratorTypes.fineTune:
      this.setGeneratorOverride(generator, dataValue, true);
      break;
    case GeneratorTypes.modLfoToPitch:
    case GeneratorTypes.vibLfoToPitch:
      cents = clip(dataValue, -127, 127) * 9.375;
      this.setGeneratorOverride(generator, cents, true);
      break;
    case GeneratorTypes.modEnvToPitch:
      cents = clip(dataValue, -127, 127) * 9.375;
      this.setGeneratorOverride(generator, cents);
      break;
    case GeneratorTypes.modLfoToVolume:
      centibels = 1.875 * dataLSB;
      this.setGeneratorOverride(generator, centibels, true);
      break;
    case GeneratorTypes.initialFilterFc: {
      const fcCents = 4335 + 59 * dataLSB;
      this.setGeneratorOverride(generator, fcCents, true);
      break;
    }
    case GeneratorTypes.initialFilterQ:
      centibels = 215 * (dataLSB / 127);
      this.setGeneratorOverride(generator, centibels, true);
      break;
    case GeneratorTypes.modLfoToFilterFc:
      cents = clip(dataValue, -64, 63) * 56.25;
      this.setGeneratorOverride(generator, cents, true);
      break;
    case GeneratorTypes.modEnvToFilterFc:
      cents = clip(dataValue, -64, 63) * 56.25;
      this.setGeneratorOverride(generator, cents);
      break;
    case GeneratorTypes.chorusEffectsSend:
    case GeneratorTypes.reverbEffectsSend:
      this.setGeneratorOverride(generator, clip(dataValue, 0, 255) * (1e3 / 255));
      break;
  }
}
function dataEntry() {
  const dataValue = this._midiControllers[MIDIControllers.dataEntryMSB];
  if (this.lastParameterIsRegistered) {
    const rpnValue = this._midiControllers[MIDIControllers.registeredParameterMSB] | this._midiControllers[MIDIControllers.registeredParameterLSB] >> 7;
    switch (rpnValue) {
      default:
        SpessaLog.info(`%cUnrecognized RPN for %c${this.channel}%c: %c(0x${rpnValue.toString(16)})%c data value: %c${dataValue}`, ConsoleColors.warn, ConsoleColors.recognized, ConsoleColors.warn, ConsoleColors.unrecognized, ConsoleColors.warn, ConsoleColors.value);
        break;
      case RegisteredParameterTypes.pitchWheelRange: {
        const range = dataValue / 128;
        this.setMIDIParameter("pitchWheelRange", range);
        SpessaLog.coolInfo(`Pitch Wheel Range for ${this.channel}`, range, "semitones");
        break;
      }
      case RegisteredParameterTypes.coarseTuning: {
        const semitones = (dataValue >> 7) - 64;
        this.setMIDIParameter("keyShift", semitones);
        SpessaLog.coolInfo(`Key shift for ${this.channel}`, semitones);
        break;
      }
      case RegisteredParameterTypes.fineTuning: {
        const cents = (dataValue - 8192) / 81.92;
        this.setMIDIParameter("fineTune", cents);
        SpessaLog.coolInfo(`Fine tuning for ${this.channel}`, Math.round(cents), "cents");
        break;
      }
      case RegisteredParameterTypes.modulationDepth: {
        const cents = dataValue / 1.28;
        this.setMIDIParameter("modulationDepth", cents);
        SpessaLog.coolInfo(`Modulation depth for ${this.channel}`, Math.round(cents), "cents");
        break;
      }
      case RegisteredParameterTypes.resetParameters:
        break;
    }
    return;
  }
  const paramCoarse = this._midiControllers[MIDIControllers.nonRegisteredParameterMSB] >> 7;
  const paramFine = this._midiControllers[MIDIControllers.nonRegisteredParameterLSB] >> 7;
  const dataCoarse = dataValue >> 7;
  if (this.synthCore.systemParameters.drumLock && paramCoarse >= NonRegisteredMSB.drumPitch && paramCoarse <= NonRegisteredMSB.drumDelay) return;
  switch (paramCoarse) {
    default:
      SpessaLog.info(`%cUnrecognized NRPN for %c${this.channel}%c: %c(0x${paramCoarse.toString(16).toUpperCase()} 0x${paramFine.toString(16).toUpperCase()})%c data value: %c${dataCoarse}`, ConsoleColors.warn, ConsoleColors.recognized, ConsoleColors.warn, ConsoleColors.unrecognized, ConsoleColors.warn, ConsoleColors.value);
      break;
    case NonRegisteredMSB.partParameter: {
      const paramLock = this._systemParameters.nrpnParamLock ?? this.synthCore.systemParameters.nrpnParamLock;
      switch (paramFine) {
        default:
          SpessaLog.info(`%cUnrecognized NRPN for %c${this.channel}%c: %c(0x${paramCoarse.toString(16)} 0x${paramFine.toString(16)})%c data value: %c${dataCoarse}`, ConsoleColors.warn, ConsoleColors.recognized, ConsoleColors.warn, ConsoleColors.unrecognized, ConsoleColors.warn, ConsoleColors.value);
          break;
        case NonRegisteredLSB.vibratoRate:
          this.controllerChange(MIDIControllers.vibratoRate, dataCoarse);
          break;
        case NonRegisteredLSB.vibratoDepth:
          this.controllerChange(MIDIControllers.vibratoDepth, dataCoarse);
          break;
        case NonRegisteredLSB.vibratoDelay:
          this.controllerChange(MIDIControllers.vibratoDelay, dataCoarse);
          break;
        case NonRegisteredLSB.tvfCutoffFrequency:
          if (paramLock) return;
          this.controllerChange(MIDIControllers.brightness, dataCoarse);
          SpessaLog.coolInfo(`Filter cutoff for ${this.channel}`, dataCoarse.toString(), "");
          break;
        case NonRegisteredLSB.tvfResonance:
          if (paramLock) return;
          this.controllerChange(MIDIControllers.filterResonance, dataCoarse);
          SpessaLog.coolInfo(`Filter resonance for ${this.channel}`, dataCoarse.toString(), "");
          break;
        case NonRegisteredLSB.envelopeAttackTime:
          if (paramLock) return;
          this.controllerChange(MIDIControllers.attackTime, dataCoarse);
          SpessaLog.coolInfo(`EG attack time for ${this.channel}`, dataCoarse.toString(), "");
          break;
        case NonRegisteredLSB.envelopeDecayTime:
          if (paramLock) return;
          this.controllerChange(MIDIControllers.decayTime, dataCoarse);
          SpessaLog.coolInfo(`EG decay time for ${this.channel}`, dataCoarse.toString(), "");
          break;
        case NonRegisteredLSB.envelopeReleaseTime:
          if (paramLock) return;
          this.controllerChange(MIDIControllers.releaseTime, dataCoarse);
          SpessaLog.coolInfo(`EG release time for ${this.channel}`, dataCoarse.toString(), "");
          break;
      }
      break;
    }
    case NonRegisteredMSB.drumPitch: {
      const pitch = this.channelSystem === "xg" || this.patch.bankLSB === 1 ? (dataCoarse - 64) * 100 : (dataCoarse - 64) * 50;
      this.drumParams[paramFine].pitch = pitch;
      SpessaLog.coolInfo(`Drum ${paramFine} pitch for ${this.channel}`, pitch, "cents");
      break;
    }
    case NonRegisteredMSB.drumPitchFine: {
      const pitch = dataCoarse - 64;
      this.drumParams[paramFine].pitch += pitch;
      SpessaLog.coolInfo(`Drum ${paramFine} pitch fine for ${this.channel}`, this.drumParams[paramFine].pitch, "cents");
      break;
    }
    case NonRegisteredMSB.drumLevel:
      this.drumParams[paramFine].gain = dataCoarse / 120;
      SpessaLog.coolInfo(`Drum ${paramFine} level for ${this.channel}`, dataCoarse, "");
      break;
    case NonRegisteredMSB.drumPan:
      this.drumParams[paramFine].pan = dataCoarse;
      SpessaLog.coolInfo(`Drum ${paramFine} pan for ${this.channel}`, dataCoarse, "");
      break;
    case NonRegisteredMSB.drumReverb:
      this.drumParams[paramFine].reverbGain = dataCoarse / 127;
      SpessaLog.coolInfo(`Drum ${paramFine} reverb level for ${this.channel}`, dataCoarse, "");
      break;
    case NonRegisteredMSB.drumChorus:
      this.drumParams[paramFine].chorusGain = dataCoarse / 127;
      SpessaLog.coolInfo(`Drum ${paramFine} chorus level for ${this.channel}`, dataCoarse, "");
      break;
    case NonRegisteredMSB.drumDelay:
      this.drumParams[paramFine].delayGain = dataCoarse / 127;
      SpessaLog.coolInfo(`Drum ${paramFine} delay level for ${this.channel}`, dataValue, "");
      break;
    case NonRegisteredMSB.awe32:
      handleAWE32NRPN.call(this, paramFine, dataValue);
      break;
    case NonRegisteredMSB.SF2: {
      if (paramFine > 100) break;
      const gen = this.sf2NRPNGeneratorLSB;
      const offset = dataValue - 8192;
      this.setGeneratorOffset(gen, offset);
      break;
    }
  }
}
var PORTA_DIVISION_CONSTANT = 40;
function portaTimeToRate(cc) {
  if (cc < 1) return 0;
  else {
    const x0 = [
      1,
      2,
      4,
      8,
      16,
      32,
      64,
      80,
      96,
      112,
      120,
      124
    ];
    const ih = [
      1,
      0.5,
      0.25,
      0.125,
      0.0625,
      0.03125,
      0.0625,
      0.0625,
      0.0625,
      0.125,
      0.25,
      1 / 3
    ];
    const a = [
      -0.16653127382501215,
      0.11863875218299408,
      0.029479047361245264,
      -0.005442312089231738,
      0.1451520875973037,
      -0.005056281449558275,
      -0.005095486882876532,
      0.03334009551111544,
      -0.09361368678020432,
      0.14132569702451822,
      -0.15805565301011382,
      -0.09918856955881927
    ];
    const b = [
      0.028212773333433472,
      -0.3388502064992847,
      -0.15839529890929713,
      -0.12398131766775483,
      -0.2874848552685111,
      0.012254866302537692,
      0.005957797193345771,
      -0.03745899330347374,
      0.12911781869810196,
      -0.15867193224162568,
      0.504406322732748,
      0.3786845131875458
    ];
    const c = [
      0.7218950861255283,
      0.5574536226347168,
      0.47133893237025826,
      0.48597095327079914,
      0.44336276333518854,
      0.6076986311801551,
      0.30851975971827794,
      0.30514889345633955,
      0.3302511933827384,
      0.153822885219165,
      0.1302280559047337,
      0.49865530675491687
    ];
    const d = [
      -2.2218487496163566,
      -1.6382721639824072,
      -1.3010299956639813,
      -0.958607314841775,
      -0.6020599913279624,
      -0.3010299956639812,
      0.31386722036915343,
      0.6232492903979004,
      0.9242792860618817,
      1.290034611362518,
      1.4265112613645752,
      1.9030899869919435
    ];
    const thresholds = [
      2,
      4,
      8,
      16,
      32,
      64,
      80,
      96,
      112,
      120,
      124
    ];
    let s = -1;
    for (let i = thresholds.length - 1; i >= 0; i--) if (thresholds[i] < cc) {
      s = i;
      break;
    }
    s += 1;
    const t = (cc - x0[s]) * ih[s];
    return Math.exp(2.302585092994046 * (((a[s] * t + b[s]) * t + c[s]) * t + d[s])) / PORTA_DIVISION_CONSTANT;
  }
}
function portamentoTimeToSeconds(time, distance) {
  return portaTimeToRate(time) * distance;
}
var SampleTypes = {
  monoSample: 1,
  rightSample: 2,
  leftSample: 4,
  linkedSample: 8,
  romMonoSample: 32769,
  romRightSample: 32770,
  romLeftSample: 32772,
  romLinkedSample: 32776
};
var ModulatorControllerSources = {
  noController: 0,
  noteOnVelocity: 2,
  noteOnKeyNum: 3,
  polyPressure: 10,
  channelPressure: 13,
  pitchWheel: 14,
  pitchWheelRange: 16,
  link: 127
};
var ModulatorCurveTypes = {
  linear: 0,
  concave: 1,
  convex: 2,
  switch: 3
};
function bitMaskToBool(num, bit) {
  return (num >> bit & 1) > 0;
}
function toNumericBool(bool) {
  return bool ? 1 : 0;
}
var MODULATOR_RESOLUTION = 16384;
var MOD_CURVE_TYPES_AMOUNT = Object.keys(ModulatorCurveTypes).length;
var concave = new Float32Array(MODULATOR_RESOLUTION + 1);
var convex = new Float32Array(MODULATOR_RESOLUTION + 1);
concave[0] = 0;
concave[concave.length - 1] = 1;
convex[0] = 0;
convex[convex.length - 1] = 1;
for (let i = 1; i < MODULATOR_RESOLUTION - 1; i++) {
  const x = -400 / 960 * Math.log(i / (concave.length - 1)) / Math.LN10;
  convex[i] = 1 - x;
  concave[concave.length - 1 - i] = x;
}
function getModulatorCurveValue(transformType, curveType, value) {
  const isBipolar = !!(transformType & 2);
  if (!!(transformType & 1)) value = 1 - value;
  switch (curveType) {
    case ModulatorCurveTypes.linear:
      if (isBipolar) return value * 2 - 1;
      return value;
    case ModulatorCurveTypes.switch:
      value = value > 0.5 ? 1 : 0;
      if (isBipolar) return value * 2 - 1;
      return value;
    case ModulatorCurveTypes.concave:
      if (isBipolar) {
        value = value * 2 - 1;
        if (value < 0) return -concave[Math.trunc(value * -MODULATOR_RESOLUTION)];
        return concave[Math.trunc(value * MODULATOR_RESOLUTION)];
      }
      return concave[Math.trunc(value * MODULATOR_RESOLUTION)];
    case ModulatorCurveTypes.convex:
      if (isBipolar) {
        value = value * 2 - 1;
        if (value < 0) return -convex[Math.trunc(value * -MODULATOR_RESOLUTION)];
        return convex[Math.trunc(value * MODULATOR_RESOLUTION)];
      }
      return convex[Math.trunc(value * MODULATOR_RESOLUTION)];
  }
}
var ModulatorSource = class ModulatorSource2 {
  /**
  * If this field is set to false, the controller should be mapped with a minimum value of 0 and a maximum value of 1. This is also
  * called Unipolar. Thus, it behaves similar to the Modulation Wheel controller of the MIDI specification.
  *
  * If this field is set to true, the controller should be mapped with a minimum value of -1 and a maximum value of 1. This is also
  * called Bipolar. Thus, it behaves similar to the Pitch Wheel controller of the MIDI specification.
  */
  isBipolar;
  /**
  * If this field is set true, the direction of the controller should be from the maximum value to the minimum value. So, for
  * example, if the controller source is Key Number, then a Key Number value of 0 corresponds to the maximum possible
  * controller output, and the Key Number value of 127 corresponds to the minimum possible controller input.
  */
  isNegative;
  /**
  * The index of the source.
  * It can point to one of the MIDI controllers or one of the predefined sources, depending on the 'isCC' flag.
  */
  index;
  /**
  * If this field is set to true, the MIDI Controller Palette is selected. The ‘index’ field value corresponds to one of the 128
  * MIDI Continuous Controller messages as defined in the MIDI specification.
  */
  isCC;
  /**
  * This field specifies how the minimum value approaches the maximum value.
  */
  curveType;
  /**
  * @internal
  * @param index
  * @param curveType
  * @param isCC
  * @param isBipolar
  * @param isNegative
  */
  constructor(index = ModulatorControllerSources.noController, curveType = ModulatorCurveTypes.linear, isCC = false, isBipolar = false, isNegative = false) {
    this.isBipolar = isBipolar;
    this.isNegative = isNegative;
    this.index = index;
    this.isCC = isCC;
    this.curveType = curveType;
  }
  get sourceName() {
    return this.isCC ? Object.keys(MIDIControllers).find((k2) => MIDIControllers[k2] === this.index) ?? this.index.toString() : Object.keys(ModulatorControllerSources).find((k2) => ModulatorControllerSources[k2] === this.index) ?? this.index.toString();
  }
  get curveTypeName() {
    return Object.keys(ModulatorCurveTypes).find((k2) => ModulatorCurveTypes[k2] === this.curveType) ?? this.curveType.toString();
  }
  static fromSourceEnum(sourceEnum) {
    const isBipolar = bitMaskToBool(sourceEnum, 9);
    const isNegative = bitMaskToBool(sourceEnum, 8);
    const isCC = bitMaskToBool(sourceEnum, 7);
    return new ModulatorSource2(sourceEnum & 127, sourceEnum >> 10 & 3, isCC, isBipolar, isNegative);
  }
  /**
  * Copies the modulator source.
  * @param source The source to copy from.
  * @returns the copied source.
  */
  static copyFrom(source) {
    return new ModulatorSource2(source.index, source.curveType, source.isCC, source.isBipolar, source.isNegative);
  }
  toString() {
    return `${this.sourceName} ${this.curveTypeName} ${this.isBipolar ? "bipolar" : "unipolar"} ${this.isNegative ? "negative" : "positive"}`;
  }
  toSourceEnum() {
    return this.curveType << 10 | toNumericBool(this.isBipolar) << 9 | toNumericBool(this.isNegative) << 8 | toNumericBool(this.isCC) << 7 | this.index;
  }
  isIdentical(source) {
    return this.index === source.index && this.isNegative === source.isNegative && this.isCC === source.isCC && this.isBipolar === source.isBipolar && this.curveType === source.curveType;
  }
  /**
  * Gets the current value from this source.
  * @param channel the MIDI channel to compute for.
  * @param pitchWheel the pitch wheel value, as channel determines if it's a per-note or a global value.
  * @param voice The voice to get the data for.
  */
  getValue(channel, pitchWheel, voice) {
    let rawValue;
    if (this.isCC) rawValue = channel.midiControllers[this.index];
    else switch (this.index) {
      default:
      case ModulatorControllerSources.noController:
        rawValue = 16383;
        break;
      case ModulatorControllerSources.noteOnVelocity:
        rawValue = voice.velocity << 7;
        break;
      case ModulatorControllerSources.noteOnKeyNum:
        rawValue = voice.targetKey << 7;
        break;
      case ModulatorControllerSources.polyPressure:
        rawValue = voice.pressure << 7;
        break;
      case ModulatorControllerSources.channelPressure:
        rawValue = channel.midiParameters.pressure << 7;
        break;
      case ModulatorControllerSources.pitchWheel:
        rawValue = pitchWheel;
        break;
      case ModulatorControllerSources.pitchWheelRange:
        rawValue = Math.floor(channel.midiParameters.pitchWheelRange * 128);
    }
    const transformType = (this.isBipolar ? 2 : 0) | (this.isNegative ? 1 : 0);
    return MODULATOR_TRANSFORMS[MODULATOR_RESOLUTION * (this.curveType * MOD_CURVE_TYPES_AMOUNT + transformType) + rawValue];
  }
};
var MODULATOR_TRANSFORMS = new Float32Array(MODULATOR_RESOLUTION * 4 * MOD_CURVE_TYPES_AMOUNT);
for (let curveType = 0; curveType < MOD_CURVE_TYPES_AMOUNT; curveType++) for (let transformType = 0; transformType < 4; transformType++) {
  const tableIndex = MODULATOR_RESOLUTION * (curveType * MOD_CURVE_TYPES_AMOUNT + transformType);
  for (let value = 0; value < MODULATOR_RESOLUTION; value++) MODULATOR_TRANSFORMS[tableIndex + value] = getModulatorCurveValue(transformType, curveType, value / MODULATOR_RESOLUTION);
}
function getModSourceEnum(curveType, isBipolar, isNegative, isCC, index) {
  return new ModulatorSource(index, curveType, isCC, isBipolar, isNegative).toSourceEnum();
}
var DEFAULT_RESONANT_MOD_SOURCE = getModSourceEnum(ModulatorCurveTypes.linear, true, false, true, MIDIControllers.filterResonance);
var Modulator = class Modulator2 {
  /**
  * The generator destination of this modulator.
  */
  destination = GeneratorTypes.initialAttenuation;
  /**
  * The transform amount for this modulator.
  */
  transformAmount = 0;
  /**
  * The transform type for this modulator.
  */
  transformType = 0;
  /**
  * The primary source of this modulator.
  */
  primarySource;
  /**
  * The secondary source of this modulator.
  */
  secondarySource;
  /**
  * Creates a new SF2 Modulator
  */
  constructor(primarySource = new ModulatorSource(), secondarySource = new ModulatorSource(), destination = GeneratorTypes.invalid, amount = 0, transformType = 0) {
    this.primarySource = primarySource;
    this.secondarySource = secondarySource;
    this.destination = destination;
    this.transformAmount = amount;
    this.transformType = transformType;
  }
  get destinationName() {
    return Object.keys(GeneratorTypes).find((k2) => GeneratorTypes[k2] === this.destination);
  }
  /**
  * Checks if the pair of modulators is identical (in SF2 terms)
  * @param mod1 modulator 1
  * @param mod2 modulator 2
  * @param checkAmount if the amount should be checked too.
  * @returns if they are identical
  */
  static isIdentical(mod1, mod2, checkAmount = false) {
    return mod1.primarySource.isIdentical(mod2.primarySource) && mod1.secondarySource.isIdentical(mod2.secondarySource) && mod1.destination === mod2.destination && mod1.transformType === mod2.transformType && (!checkAmount || mod1.transformAmount === mod2.transformAmount);
  }
  /**
  * Copies a modulator.
  * @param mod The modulator to copy.
  * @returns The copied modulator.
  */
  static copyFrom(mod) {
    return new Modulator2(ModulatorSource.copyFrom(mod.primarySource), ModulatorSource.copyFrom(mod.secondarySource), mod.destination, mod.transformAmount, mod.transformType);
  }
  toString() {
    return `Source: ${this.primarySource.toString()}
Secondary source: ${this.secondarySource.toString()}
to: ${this.destinationName}
amount: ${this.transformAmount}` + (this.transformType === 2 ? "absolute value" : "");
  }
  write(modData, indexes) {
    writeWord(modData, this.primarySource.toSourceEnum());
    writeWord(modData, this.destination);
    writeWord(modData, this.transformAmount);
    writeWord(modData, this.secondarySource.toSourceEnum());
    writeWord(modData, this.transformType);
    if (!indexes) return;
    indexes.mod++;
  }
  /**
  * Sums transform and create a NEW modulator
  * @param modulator the modulator to sum with
  * @returns the new modulator
  */
  sumTransform(modulator) {
    const m = Modulator2.copyFrom(this);
    m.transformAmount += modulator.transformAmount;
    return m;
  }
};
var DecodedModulator = class extends Modulator {
  /**
  * Reads an SF2 modulator
  * @param sourceEnum SF2 source enum
  * @param secondarySourceEnum SF2 secondary source enum
  * @param destination destination
  * @param amount amount
  * @param transformType transform type
  */
  constructor(sourceEnum, secondarySourceEnum, destination, amount, transformType) {
    super(ModulatorSource.fromSourceEnum(sourceEnum), ModulatorSource.fromSourceEnum(secondarySourceEnum), destination, amount, transformType);
    if (this.destination > MAX_GENERATOR) this.destination = GeneratorTypes.invalid;
  }
};
var defaultSoundFont2Modulators = [
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.concave, false, true, false, ModulatorControllerSources.noteOnVelocity), 0, GeneratorTypes.initialAttenuation, 960, 0),
  new DecodedModulator(129, 0, GeneratorTypes.vibLfoToPitch, 50, 0),
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.concave, false, true, true, MIDIControllers.mainVolume), 0, GeneratorTypes.initialAttenuation, 960, 0),
  new DecodedModulator(13, 0, GeneratorTypes.vibLfoToPitch, 50, 0),
  new DecodedModulator(526, 16, GeneratorTypes.fineTune, 12700, 0),
  new DecodedModulator(650, 0, GeneratorTypes.pan, 500, 0),
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.concave, false, true, true, MIDIControllers.expression), 0, GeneratorTypes.initialAttenuation, 960, 0),
  new DecodedModulator(219, 0, GeneratorTypes.reverbEffectsSend, 200, 0),
  new DecodedModulator(221, 0, GeneratorTypes.chorusEffectsSend, 200, 0)
];
var defaultSpessaSynthModulators = [
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.convex, true, false, true, MIDIControllers.attackTime), 0, GeneratorTypes.attackVolEnv, 6e3, 0),
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.linear, true, false, true, MIDIControllers.releaseTime), 0, GeneratorTypes.releaseVolEnv, 3600, 0),
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.linear, true, false, true, MIDIControllers.decayTime), 0, GeneratorTypes.decayVolEnv, 3600, 0),
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.linear, true, false, true, MIDIControllers.brightness), 0, GeneratorTypes.initialFilterFc, 9600, 0),
  new DecodedModulator(DEFAULT_RESONANT_MOD_SOURCE, 0, GeneratorTypes.initialFilterQ, 250, 0),
  new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.switch, false, false, true, MIDIControllers.softPedal), 0, GeneratorTypes.initialFilterFc, -1200, 0)
];
var SPESSASYNTH_DEFAULT_MODULATORS = [...defaultSoundFont2Modulators, ...defaultSpessaSynthModulators];
var clamp = (num, min, max) => Math.max(min, Math.min(max, num));
function noteOn(midiNote, velocity, emit = true) {
  if (velocity < 1) {
    this.noteOff(midiNote);
    return;
  }
  const black = this.synthCore.systemParameters.blackMIDIMode;
  if (black && this.synthCore.voiceCount > 200 && velocity < 40 || black && velocity < 10 || this._systemParameters.isMuted || !this.preset) return;
  let realVelocity = clamp(Math.floor(velocity * (this._midiParameters.velocitySenseDepth / 64) + (this._midiParameters.velocitySenseOffset - 64) * 2), 0, 127);
  let soundBankNote = midiNote + this.currentKeyShift;
  if (midiNote > 127 || midiNote < 0) return;
  const program = this.preset.program;
  const tune = this.synthCore.tunings[program * 128 + midiNote];
  if (tune >= 0) soundBankNote = Math.trunc(tune);
  if ((this._systemParameters.monophonicRetrigger ?? this.synthCore.systemParameters.monophonicRetrigger) || this._midiParameters.assignMode === 0) this.killNote(midiNote);
  const keyVel = this.synthCore.keyModifierManager.getVelocity(this.channel, midiNote);
  if (keyVel > -1) realVelocity = keyVel;
  let voiceGain = this.synthCore.keyModifierManager.getGain(this.channel, midiNote);
  const previousNote = this.lastPortamentoNote;
  const portamentoEnabled = this.portamentoForce || this._midiControllers[MIDIControllers.portamentoOnOff] >= 8192;
  const portamentoTime = this._midiControllers[MIDIControllers.portamentoTime] >> 7;
  const canApplyPortamento = portamentoEnabled && !this._drumChannel && previousNote >= 0 && previousNote !== midiNote && portamentoTime > 0;
  let portaFromKey = -1;
  let portaTime = 0;
  if (canApplyPortamento) {
    const keyDistance = Math.abs(midiNote - previousNote);
    portaFromKey = previousNote;
    portaTime = portamentoTimeToSeconds(portamentoTime, keyDistance);
    this.portamentoForce = false;
  }
  this.lastPortamentoNote = midiNote;
  this.playingNotes[midiNote] = true;
  if (!this._midiParameters.polyMode) {
    if (this.lastMonoNote >= 0 && this.lastMonoNote !== midiNote) this.killNote(this.lastMonoNote);
    this.lastMonoNote = midiNote;
    this.lastMonoVelocity = velocity;
  }
  const voices = this.synthCore.getVoices(this.channel, soundBankNote, realVelocity);
  let panOverride = 0;
  let exclusiveOverride = 0;
  let pitchOffset = 0;
  let reverbSend = 1;
  let chorusSend = 1;
  let delaySend = 1;
  if (this._midiParameters.randomPan) panOverride = Math.round(randomGenerator() * 1e3 - 500);
  if (this._drumChannel) {
    const p = this.drumParams[midiNote];
    if (!p.rxNoteOn) return;
    const drumPan = p.pan - 64;
    if (drumPan !== 0) if (drumPan === -64) panOverride = Math.round(randomGenerator() * 1e3 - 500);
    else {
      const channelPan = (this._midiControllers[MIDIControllers.pan] >> 7) - 64;
      panOverride = Math.max(-63, Math.min(drumPan + channelPan, 63)) / 63 * 500 || 1;
    }
    pitchOffset = p.pitch;
    exclusiveOverride = p.exclusiveClass;
    reverbSend = p.reverbGain;
    chorusSend = p.chorusGain;
    delaySend = p.delayGain;
    if (voiceGain === 1) voiceGain = p.gain;
  }
  const noteID = emit ? this.noteOnID[midiNote]++ : this.noteOnID[midiNote];
  for (const cached of voices) {
    const voice = this.synthCore.assignVoice();
    const now = this.synthCore.currentTime;
    voice.setup(now, this.channel, midiNote, noteID);
    voice.wavetable = voice.oscillators[this._systemParameters.interpolationType ?? this.synthCore.systemParameters.interpolationType];
    voice.targetKey = cached.targetKey;
    voice.velocity = cached.velocity;
    voice.generators.set(cached.generators);
    voice.exclusiveClass = exclusiveOverride || cached.exclusiveClass;
    voice.rootKey = cached.rootKey;
    voice.loopingMode = cached.loopingMode;
    voice.wavetable.sampleData = cached.sampleData;
    voice.wavetable.playbackStep = cached.playbackStep;
    if (this.dynamicModulators.active) {
      voice.modulators = [...cached.modulators];
      for (const m of this.dynamicModulators.modulatorList) {
        const existingModIndex = voice.modulators.findIndex((voiceMod) => Modulator.isIdentical(voiceMod, m.mod));
        if (existingModIndex === -1) voice.modulators.push(m.mod);
        else voice.modulators[existingModIndex] = m.mod;
      }
    } else voice.modulators = cached.modulators;
    if (voice.modulators.length > voice.modulatorValues.length) {
      SpessaLog.warn(`${voice.modulators.length} modulators! Increasing modulatorValues table.`);
      voice.modulatorValues = new Int16Array(voice.modulators.length);
    }
    if (this.generators.overridesEnabled) {
      const g = this.generators.overrides;
      for (let type = 0; type < GENERATORS_AMOUNT; type++) {
        const overrideValue = g[type];
        if (overrideValue === 32767) continue;
        voice.generators[type] = overrideValue;
      }
    }
    if (voice.exclusiveClass !== 0 && this._midiParameters.polyMode) {
      let vc = 0;
      if (this._voiceCount > 0) {
        for (const v of this.synthCore.voices) if (v.isActive && v.channel === this.channel && v.exclusiveClass === voice.exclusiveClass && v.hasRendered) {
          v.exclusiveRelease(this.synthCore.currentTime);
          if (++vc >= this._voiceCount) break;
        }
      }
    }
    this.computeModulators(voice);
    voice.volEnv.init(voice);
    voice.modEnv.init(voice);
    voice.filter.init();
    voice.vibLfoStartTime = now + timecentsToSeconds(voice.modulatedGenerators[GeneratorTypes.delayVibLFO]);
    voice.modLfoStartTime = now + timecentsToSeconds(voice.modulatedGenerators[GeneratorTypes.delayModLFO]);
    const cursorStartOffset = voice.modulatedGenerators[GeneratorTypes.startAddrsOffset] + voice.modulatedGenerators[GeneratorTypes.startAddrsCoarseOffset] * 32768;
    const endOffset = voice.modulatedGenerators[GeneratorTypes.endAddrOffset] + voice.modulatedGenerators[GeneratorTypes.endAddrsCoarseOffset] * 32768;
    const loopStartOffset = voice.modulatedGenerators[GeneratorTypes.startloopAddrsOffset] + voice.modulatedGenerators[GeneratorTypes.startloopAddrsCoarseOffset] * 32768;
    const loopEndOffset = voice.modulatedGenerators[GeneratorTypes.endloopAddrsOffset] + voice.modulatedGenerators[GeneratorTypes.endloopAddrsCoarseOffset] * 32768;
    const endExclusive = cached.sampleData.length;
    voice.wavetable.cursor = clamp(cursorStartOffset, 0, endExclusive - 1);
    voice.wavetable.end = clamp(endExclusive + endOffset, 0, endExclusive);
    voice.wavetable.loopStart = clamp(cached.loopStart + loopStartOffset, 0, endExclusive);
    voice.wavetable.loopEnd = clamp(cached.loopEnd + loopEndOffset, 0, endExclusive);
    if (voice.wavetable.loopEnd < voice.wavetable.loopStart) {
      const temp = voice.wavetable.loopStart;
      voice.wavetable.loopStart = voice.wavetable.loopEnd;
      voice.wavetable.loopEnd = temp;
    }
    if (voice.wavetable.loopEnd - voice.wavetable.loopStart < 1 && (voice.loopingMode === 1 || voice.loopingMode === 3)) voice.loopingMode = 0;
    voice.wavetable.loopLength = voice.wavetable.loopEnd - voice.wavetable.loopStart;
    voice.wavetable.isLooping = voice.loopingMode === 1 || voice.loopingMode === 3;
    voice.portamentoFromKey = portaFromKey;
    voice.portamentoDuration = portaTime;
    voice.overridePan = panOverride;
    voice.gainModifier = voiceGain;
    voice.pitchOffset = pitchOffset;
    voice.reverbSend = reverbSend;
    voice.chorusSend = chorusSend;
    voice.delaySend = delaySend;
    voice.currentPan = Math.max(-500, Math.min(500, panOverride || voice.modulatedGenerators[GeneratorTypes.pan]));
  }
  this._voiceCount += voices.length;
  if (emit) this.synthCore.callEvent("noteOn", {
    midiNote,
    channel: this.channel,
    velocity
  });
}
function noteOff(midiNote) {
  if (midiNote > 127 || midiNote < 0) return;
  if (this.synthCore.systemParameters.blackMIDIMode && !this._drumChannel || this._drumChannel && this.drumParams[midiNote].rxNoteOff) {
    this.killNote(midiNote);
    this.synthCore.callEvent("noteOff", {
      midiNote,
      channel: this.channel
    });
    return;
  }
  this.playingNotes[midiNote] = false;
  const mono = !this._midiParameters.polyMode;
  const sustain = this._midiControllers[MIDIControllers.sustainPedal] >= 8192 && !mono;
  let vc = 0;
  const noteID = this.noteOffID[midiNote];
  if (noteID < this.noteOnID[midiNote]) this.noteOffID[midiNote]++;
  if (this._voiceCount > 0) {
    for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive && v.midiNote === midiNote && v.noteID === noteID && !v.isInRelease) {
      if (sustain) v.isHeld = true;
      else v.releaseVoice(this.synthCore.currentTime);
      if (++vc >= this._voiceCount) break;
    }
  }
  this.synthCore.callEvent("noteOff", {
    midiNote,
    channel: this.channel
  });
  if (mono) {
    const highest = this.playingNotes.lastIndexOf(true);
    if (highest === -1) this.lastMonoNote = -1;
    else if (this.lastMonoNote === midiNote) this.noteOn(highest, this.lastMonoVelocity, false);
  }
}
function programChange(program) {
  if (this._systemParameters.presetLock) return;
  this.patch.program = program;
  let preset = this.synthCore.soundBankManager.getPreset(this.patch, this.channelSystem);
  if (!preset) {
    preset = this.synthCore.missingPresetHandler(this.patch, this.channelSystem);
    if (!preset) return;
  }
  this.preset = preset;
  if (preset.isDrum !== this._drumChannel) this.setDrumFlag(preset.isDrum);
  this.resetDrumParams();
  this.synthCore.callEvent("programChange", {
    channel: this.channel,
    bankLSB: this.preset.bankLSB,
    bankMSB: this.preset.bankMSB,
    program: this.preset.program,
    name: this.preset.name,
    isGMGSDrum: this.preset.isGMGSDrum,
    isDrum: this.preset.isDrum
  });
}
var Generator = class {
  /**
  * The generator's SF2 type.
  */
  type;
  /**
  * The generator's 16-bit value.
  */
  value = 0;
  /**
  * Constructs a new generator
  * @param type generator type
  * @param value generator value
  * @param validate if the limits should be validated and clamped.
  */
  constructor(type, value, validate = true) {
    this.type = type;
    if (value === void 0) throw new Error("No value provided.");
    this.value = Math.round(value);
    if (validate) {
      const lim = GeneratorLimits[type];
      if (lim !== void 0) this.value = Math.max(lim.min, Math.min(lim.max, this.value));
    }
  }
  write(genData) {
    writeWord(genData, this.type);
    writeWord(genData, this.value);
  }
  toString() {
    return `${Object.keys(GeneratorTypes).find((k2) => GeneratorTypes[k2] === this.type)}: ${this.value}`;
  }
};
var BasicZone = class {
  /**
  * The zone's velocity range.
  * min -1 means that it is a default value
  */
  velRange = {
    min: -1,
    max: 127
  };
  /**
  * The zone's key range.
  * min -1 means that it is a default value.
  */
  keyRange = {
    min: -1,
    max: 127
  };
  /**
  * The zone's generators.
  */
  generators = [];
  /**
  * The zone's modulators.
  */
  modulators = [];
  get hasKeyRange() {
    return this.keyRange.min !== -1;
  }
  get hasVelRange() {
    return this.velRange.min !== -1;
  }
  /**
  * The current tuning in cents, taking in both coarse and fine generators.
  */
  get fineTuning() {
    const currentCoarse = this.getGenerator(GeneratorTypes.coarseTune, 0);
    const currentFine = this.getGenerator(GeneratorTypes.fineTune, 0);
    return currentCoarse * 100 + currentFine;
  }
  /**
  * The current tuning in cents, taking in both coarse and fine generators.
  */
  set fineTuning(tuningCents) {
    const coarse = Math.trunc(tuningCents / 100);
    const fine = tuningCents % 100;
    this.setGenerator(GeneratorTypes.coarseTune, coarse);
    this.setGenerator(GeneratorTypes.fineTune, fine);
  }
  /**
  * Adds to a given generator, or its default value.
  * @param type the generator type.
  * @param value the value to add.
  * @param validate if the value should be clamped to allowed limits.
  */
  addToGenerator(type, value, validate = true) {
    const genValue = this.getGenerator(type, GeneratorLimits[type].def);
    this.setGenerator(type, value + genValue, validate);
  }
  /**
  * Sets a generator to a given value if preset, otherwise adds a new one.
  * @param type the generator type.
  * @param value the value to set. Set to null to remove this generator (set as "unset").
  * @param validate if the value should be clamped to allowed limits.
  */
  setGenerator(type, value, validate = true) {
    switch (type) {
      case GeneratorTypes.sampleID:
        throw new Error("Use setSample()");
      case GeneratorTypes.instrument:
        throw new Error("Use setInstrument()");
      case GeneratorTypes.velRange:
      case GeneratorTypes.keyRange:
        throw new Error("Set the range manually");
    }
    if (value === null) {
      this.generators = this.generators.filter((g) => g.type !== type);
      return;
    }
    const index = this.generators.findIndex((g) => g.type === type);
    if (index === -1) this.addGenerators(new Generator(type, value, validate));
    else this.generators[index] = new Generator(type, value, validate);
  }
  /**
  * Adds generators to the zone.
  * @param generators the generators to add.
  */
  addGenerators(...generators) {
    for (const g of generators) switch (g.type) {
      default:
        this.generators.push(g);
        break;
      case GeneratorTypes.sampleID:
      case GeneratorTypes.instrument:
        break;
      case GeneratorTypes.velRange:
        this.velRange.min = g.value & 127;
        this.velRange.max = g.value >> 8 & 127;
        break;
      case GeneratorTypes.keyRange:
        this.keyRange.min = g.value & 127;
        this.keyRange.max = g.value >> 8 & 127;
    }
  }
  /**
  * Adds modulators to the zone.
  * @param modulators the modulators to add.
  */
  addModulators(...modulators) {
    this.modulators.push(...modulators);
  }
  /**
  * Gets a generator value.
  * @param generatorType the generator type.
  * @param notFoundValue if the generator is not found, this value is returned. A default value can be passed here, or null for example,
  * to check if the generator is set.
  */
  getGenerator(generatorType, notFoundValue) {
    return this.generators.find((g) => g.type === generatorType)?.value ?? notFoundValue;
  }
  copyFrom(zone) {
    this.generators = zone.generators.map((g) => new Generator(g.type, g.value, false));
    this.modulators = zone.modulators.map(Modulator.copyFrom.bind(Modulator));
    this.velRange = { ...zone.velRange };
    this.keyRange = { ...zone.keyRange };
  }
  /**
  * Filters the generators and prepends the range generators.
  */
  getWriteGenerators(bank) {
    const generators = this.generators.filter((g) => g.type !== GeneratorTypes.sampleID && g.type !== GeneratorTypes.instrument && g.type !== GeneratorTypes.keyRange && g.type !== GeneratorTypes.velRange);
    if (!bank) throw new Error("No bank provided! ");
    if (this.hasVelRange) generators.unshift(new Generator(GeneratorTypes.velRange, this.velRange.max << 8 | Math.max(this.velRange.min, 0), false));
    if (this.hasKeyRange) generators.unshift(new Generator(GeneratorTypes.keyRange, this.keyRange.max << 8 | Math.max(this.keyRange.min, 0), false));
    return generators;
  }
};
var RESAMPLE_RATE = 48e3;
var BasicSample = class {
  /**
  * The sample's name.
  */
  name;
  /**
  * Sample rate in Hz.
  */
  sampleRate;
  /**
  * Original pitch of the sample as a MIDI note number.
  */
  originalKey;
  /**
  * Pitch correction, in cents. Can be negative.
  */
  pitchCorrection;
  /**
  * Linked sample, unused if mono.
  */
  linkedSample;
  /**
  * The type of the sample.
  */
  sampleType;
  /**
  * The sample's loop start index, inclusive.
  * In sample data points, relative to the start of the sample.
  *
  * Minimum allowed value is 0.
  */
  loopStart;
  /**
  * The sample's loop end index, exclusive.
  * In sample data points, relative to the start of the sample.
  *
  * Maximum allowed value is the sample data length.
  */
  loopEnd;
  /**
  * Sample's linked instruments (the instruments that use it)
  * note that duplicates are allowed since one instrument can use the same sample multiple times.
  */
  linkedTo = [];
  /**
  * Indicates if the data was overridden, so it cannot be copied back unchanged.
  */
  dataOverridden = true;
  /**
  * The compressed sample data if the sample has been compressed.
  */
  compressedData;
  /**
  * The sample's audio data.
  */
  audioData;
  /**
  * The basic representation of a sample.
  * @param sampleName The sample's name.
  * @param sampleRate The sample's rate in Hz.
  * @param originalKey The sample's pitch as a MIDI note number.
  * @param pitchCorrection The sample's pitch correction in cents.
  * @param sampleType The sample's type, an enum that can indicate SF3.
  * @param loopStart The sample's loop start relative to the sample start in sample points.
  * @param loopEnd The sample's loop end relative to the sample start in sample points. Inclusive.
  */
  constructor(sampleName, sampleRate, originalKey, pitchCorrection, sampleType, loopStart, loopEnd) {
    this.name = sampleName;
    this.sampleRate = sampleRate;
    this.originalKey = originalKey;
    this.pitchCorrection = pitchCorrection;
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.sampleType = sampleType;
  }
  /**
  * Indicates if the sample is compressed using vorbis SF3.
  */
  get isCompressed() {
    return this.compressedData !== void 0;
  }
  /**
  * If the sample is linked to another sample.
  */
  get isLinked() {
    return this.sampleType === SampleTypes.rightSample || this.sampleType === SampleTypes.leftSample || this.sampleType === SampleTypes.linkedSample;
  }
  /**
  * The sample's use count
  */
  get useCount() {
    return this.linkedTo.length;
  }
  /**
  * Get raw data for writing the file, either a compressed bit stream or signed 16-bit little endian PCM data.
  * @param allowVorbis if vorbis file data is allowed.
  * @return either s16le or vorbis data.
  */
  getRawData(allowVorbis) {
    if (this.compressedData && allowVorbis && !this.dataOverridden) return this.compressedData;
    return this.encodeS16LE();
  }
  /**
  * Resamples the audio data to a given sample rate.
  */
  resampleData(newSampleRate) {
    let audioData = this.getAudioData();
    const ratio = newSampleRate / this.sampleRate;
    const resampled = new Float32Array(Math.floor(audioData.length * ratio));
    for (let i = 0; i < resampled.length; i++) resampled[i] = audioData[Math.floor(i * (1 / ratio))];
    audioData = resampled;
    this.sampleRate = newSampleRate;
    this.loopStart = Math.floor(this.loopStart * ratio);
    this.loopEnd = Math.floor(this.loopEnd * ratio);
    this.audioData = audioData;
  }
  /**
  * Compresses the audio data
  * @param encodeVorbis the compression function to use when compressing
  */
  async compressSample(encodeVorbis) {
    if (this.isCompressed) return;
    try {
      let audioData = this.getAudioData();
      if (this.sampleRate < 8e3 || this.sampleRate > 96e3) {
        this.resampleData(RESAMPLE_RATE);
        audioData = this.getAudioData();
      }
      const compressed = await encodeVorbis(audioData, this.sampleRate);
      this.setCompressedData(compressed);
    } catch (error) {
      SpessaLog.warn(`Failed to compress ${this.name}. Leaving as uncompressed!`, error);
      this.compressedData = void 0;
    }
  }
  /**
  * Sets the sample type and unlinks if needed.
  * @param type The type to set it to.
  */
  setSampleType(type) {
    this.sampleType = type;
    if (!this.isLinked) {
      if (this.linkedSample) {
        this.linkedSample.linkedSample = void 0;
        this.linkedSample.sampleType = type;
      }
      this.linkedSample = void 0;
    }
    if ((type & 32768) > 0) throw new Error("ROM samples are not supported.");
  }
  /**
  * Unlinks the sample from its stereo link if it has any.
  */
  unlinkSample() {
    this.setSampleType(SampleTypes.monoSample);
  }
  /**
  * Links a stereo sample.
  * @param sample the sample to link to.
  * @param type either left, right or linked.
  */
  setLinkedSample(sample, type) {
    if (sample.linkedSample) throw new Error(`${sample.name} is linked tp ${sample.linkedSample.name}. Unlink it first.`);
    if (this === sample) throw new Error(`${sample.name} cannot be linked to itself.`);
    this.linkedSample = sample;
    sample.linkedSample = this;
    switch (type) {
      case SampleTypes.leftSample:
        this.setSampleType(SampleTypes.leftSample);
        sample.setSampleType(SampleTypes.rightSample);
        break;
      case SampleTypes.rightSample:
        this.setSampleType(SampleTypes.rightSample);
        sample.setSampleType(SampleTypes.leftSample);
        break;
      case SampleTypes.linkedSample:
        this.setSampleType(SampleTypes.linkedSample);
        sample.setSampleType(SampleTypes.linkedSample);
        break;
      default:
        throw new Error("Invalid sample type: " + type);
    }
  }
  /**
  * Links the sample to a given instrument
  * @param instrument the instrument to link to
  */
  linkTo(instrument) {
    this.linkedTo.push(instrument);
  }
  /**
  * Unlinks the sample from a given instrument
  * @param instrument the instrument to unlink from
  */
  unlinkFrom(instrument) {
    const index = this.linkedTo.indexOf(instrument);
    if (index === -1) {
      SpessaLog.warn(`Cannot unlink ${instrument.name} from ${this.name}: not linked.`);
      return;
    }
    this.linkedTo.splice(index, 1);
  }
  /**
  * Get the float32 audio data.
  * Note that this either decodes the compressed data or passes the ready sampleData.
  * If neither are set then it will throw an error!
  * @returns the audio data
  */
  getAudioData() {
    if (this.audioData) return this.audioData;
    if (this.isCompressed) {
      this.audioData = this.decodeVorbis();
      return this.audioData;
    }
    throw new Error("Sample data is undefined for a BasicSample instance.");
  }
  /**
  * Replaces the audio data *in-place*.
  * @param audioData The new audio data as Float32.
  * @param sampleRate The new sample rate, in Hertz.
  */
  setAudioData(audioData, sampleRate) {
    this.audioData = audioData;
    this.sampleRate = sampleRate;
    this.dataOverridden = true;
    this.compressedData = void 0;
  }
  /**
  * Replaces the audio with a compressed data sample and flags the sample as compressed
  * @param data the new compressed data
  */
  setCompressedData(data) {
    this.audioData = void 0;
    this.compressedData = data;
    this.dataOverridden = false;
  }
  /**
  * Encodes s16le sample
  * @return the encoded data
  */
  encodeS16LE() {
    const data = this.getAudioData();
    const data16 = new Int16Array(data.length);
    const len = data.length;
    for (let i = 0; i < len; i++) {
      let sample = data[i] * 32768;
      if (sample > 32767) sample = 32767;
      else if (sample < -32768) sample = -32768;
      data16[i] = sample;
    }
    return new IndexedByteArray(data16.buffer);
  }
  /**
  * Decode binary vorbis into a float32 pcm
  */
  decodeVorbis() {
    if (this.audioData) return this.audioData;
    if (!this.compressedData) throw new Error("Compressed data is missing.");
    try {
      const vorbis = L.decode(this.compressedData);
      if (vorbis.sampleRate !== this.sampleRate) SpessaLog.warn(`Sample ${this.name}: Sample rate mismatch. Expected ${this.sampleRate}, got ${vorbis.sampleRate}.`);
      if (vorbis.channels.length === 0) {
        SpessaLog.warn(`Error decoding sample ${this.name}: No channels!`);
        return new Float32Array(this.loopEnd);
      } else if (vorbis.channels.length > 1) SpessaLog.warn(`Sample ${this.name}: Returned ${vorbis.channels.length} channels instead of mono.`);
      const decoded = vorbis.channels[0];
      for (let i = 0; i < decoded.length; i++) decoded[i] = Math.max(-1, Math.min(decoded[i], 0.999969482421875));
      return decoded;
    } catch (error) {
      SpessaLog.warn(`Error decoding sample ${this.name}: ${error}`);
      return new Float32Array(this.loopEnd);
    }
  }
};
var EmptySample = class extends BasicSample {
  /**
  * A simplified class for creating samples.
  */
  constructor() {
    super("", 44100, 60, 0, SampleTypes.monoSample, 0, 0);
  }
};
var BasicInstrumentZone = class extends BasicZone {
  /**
  * The instrument this zone belongs to.
  */
  parentInstrument;
  /**
  * For tracking on the individual zone level, since multiple presets can refer to the same instrument.
  */
  useCount;
  /**
  * Creates a new instrument zone.
  * @param instrument The parent instrument.
  * @param sample The sample to use in this zone.
  */
  constructor(instrument, sample) {
    super();
    this.parentInstrument = instrument;
    this._sample = sample;
    sample.linkTo(this.parentInstrument);
    this.useCount = instrument.useCount;
  }
  /**
  * Zone's sample.
  */
  _sample;
  /**
  * Zone's sample.
  */
  get sample() {
    return this._sample;
  }
  /**
  * Sets a sample for this zone.
  * @param sample the sample to set.
  */
  set sample(sample) {
    if (this._sample) this._sample.unlinkFrom(this.parentInstrument);
    this._sample = sample;
    sample.linkTo(this.parentInstrument);
  }
  getWriteGenerators(bank) {
    const gens = super.getWriteGenerators(bank);
    const sampleID = bank.samples.indexOf(this.sample);
    if (sampleID === -1) throw new Error(`${this.sample.name} does not exist in ${bank.soundBankInfo.name}! Cannot write sampleID generator.`);
    gens.push(new Generator(GeneratorTypes.sampleID, sampleID, false));
    return gens;
  }
};
var BasicPresetZone = class extends BasicZone {
  /**
  * The preset this zone belongs to.
  */
  parentPreset;
  /**
  * Creates a new preset zone.
  * @param preset the preset this zone belongs to.
  * @param instrument the instrument to use in this zone.
  */
  constructor(preset, instrument) {
    super();
    this.parentPreset = preset;
    this._instrument = instrument;
    this._instrument.linkTo(this.parentPreset);
  }
  /**
  * Zone's instrument.
  */
  _instrument;
  /**
  * Zone's instrument.
  */
  get instrument() {
    return this._instrument;
  }
  /**
  * Zone's instrument.
  */
  set instrument(instrument) {
    if (this._instrument) this._instrument.unlinkFrom(this.parentPreset);
    this._instrument = instrument;
    this._instrument.linkTo(this.parentPreset);
  }
  getWriteGenerators(bank) {
    const gens = super.getWriteGenerators(bank);
    if (!bank) throw new Error("Instrument ID cannot be determined without the sound bank itself.");
    const instrumentID = bank.instruments.indexOf(this.instrument);
    if (instrumentID === -1) throw new Error(`${this.instrument.name} does not exist in ${bank.soundBankInfo.name}! Cannot write instrument generator.`);
    gens.push(new Generator(GeneratorTypes.instrument, instrumentID, false));
    return gens;
  }
};
var defaultGeneratorValues = new Int16Array(GENERATORS_AMOUNT);
for (let i = 0; i < defaultGeneratorValues.length; i++) if (GeneratorLimits[i]) defaultGeneratorValues[i] = GeneratorLimits[i].def;
var BasicPreset = class BasicPreset2 {
  /**
  * The parent soundbank instance
  * Currently used for determining default modulators and XG status
  */
  parentSoundBank;
  /**
  * The preset's name
  */
  name = "";
  program = 0;
  bankMSB = 0;
  bankLSB = 0;
  isGMGSDrum = false;
  /**
  * The preset's zones
  */
  zones = [];
  /**
  * Preset's global zone
  */
  globalZone;
  /**
  * Unused metadata
  */
  library = 0;
  /**
  * Unused metadata
  */
  genre = 0;
  /**
  * Unused metadata
  */
  morphology = 0;
  /**
  * Creates a new preset representation.
  * @param parentSoundBank the sound bank this preset belongs to.
  * @param globalZone optional, a global zone to use.
  */
  constructor(parentSoundBank, globalZone = new BasicZone()) {
    this.parentSoundBank = parentSoundBank;
    this.globalZone = globalZone;
  }
  /**
  * Checks if this preset is a drum preset
  */
  get isDrum() {
    const xg = this.parentSoundBank.isXGBank;
    return this.isGMGSDrum || xg && BankSelectHacks.isXGDrum(this.bankMSB);
  }
  static isInRange(range, number) {
    return number >= range.min && number <= range.max;
  }
  static addUniqueModulators(main, adder) {
    for (const addedMod of adder) if (!main.some((mm) => Modulator.isIdentical(addedMod, mm))) main.push(addedMod);
  }
  static subtractRanges(r1, r2) {
    return {
      min: Math.max(r1.min, r2.min),
      max: Math.min(r1.max, r2.max)
    };
  }
  /**
  * Unlinks everything from this preset.
  */
  delete() {
    for (const z of this.zones) z.instrument?.unlinkFrom(this);
  }
  /**
  * Deletes an instrument zone from this preset.
  * @param index the zone's index to delete.
  */
  deleteZone(index) {
    this.zones[index]?.instrument?.unlinkFrom(this);
    this.zones.splice(index, 1);
  }
  /**
  * Creates a new preset zone and returns it.
  * @param instrument the instrument to use in the zone.
  */
  createZone(instrument) {
    const z = new BasicPresetZone(this, instrument);
    this.zones.push(z);
    return z;
  }
  /**
  * Preloads (loads and caches synthesis data) for a given key range.
  */
  preload(keyMin, keyMax) {
    for (let key = keyMin; key < keyMax + 1; key++) for (let velocity = 0; velocity < 128; velocity++) for (const synthesisData of this.getVoiceParameters(key, velocity)) synthesisData.sample.getAudioData();
  }
  /**
  * Checks if the bank and program numbers are the same for the given preset as this one.
  * @param preset The preset to check.
  */
  matches(preset) {
    return MIDIPatchTools.matches(this, preset);
  }
  /**
  * Returns the voice synthesis data for this preset.
  * @param midiNote the MIDI note number.
  * @param velocity the MIDI velocity.
  * @returns the returned sound data.
  */
  getVoiceParameters(midiNote, velocity) {
    const voiceParameters = new Array();
    for (const presetZone of this.zones) {
      if (!BasicPreset2.isInRange(presetZone.hasKeyRange ? presetZone.keyRange : this.globalZone.keyRange, midiNote) || !BasicPreset2.isInRange(presetZone.hasVelRange ? presetZone.velRange : this.globalZone.velRange, velocity)) continue;
      const instrument = presetZone.instrument;
      if (!instrument || instrument.zones.length === 0) continue;
      const presetGenerators = new Int16Array(GENERATORS_AMOUNT);
      for (const generator of this.globalZone.generators) presetGenerators[generator.type] = generator.value;
      for (const generator of presetZone.generators) presetGenerators[generator.type] = generator.value;
      const presetModulators = [...presetZone.modulators];
      BasicPreset2.addUniqueModulators(presetModulators, this.globalZone.modulators);
      for (const instZone of instrument.zones) {
        if (!BasicPreset2.isInRange(instZone.hasKeyRange ? instZone.keyRange : instrument.globalZone.keyRange, midiNote) || !BasicPreset2.isInRange(instZone.hasVelRange ? instZone.velRange : instrument.globalZone.velRange, velocity)) continue;
        const modulators = [...instZone.modulators];
        BasicPreset2.addUniqueModulators(modulators, instrument.globalZone.modulators);
        BasicPreset2.addUniqueModulators(modulators, this.parentSoundBank.defaultModulators);
        for (const presetMod of presetModulators) {
          const matchIndex = modulators.findIndex((m) => Modulator.isIdentical(presetMod, m));
          if (matchIndex === -1) modulators.push(presetMod);
          else modulators[matchIndex] = modulators[matchIndex].sumTransform(presetMod);
        }
        const generators = new Int16Array(defaultGeneratorValues);
        for (const generator of instrument.globalZone.generators) generators[generator.type] = generator.value;
        for (const generator of instZone.generators) generators[generator.type] = generator.value;
        for (let i = 0; i < generators.length; i++) generators[i] = Math.max(-32768, Math.min(32767, generators[i] + presetGenerators[i]));
        generators[GeneratorTypes.initialAttenuation] = Math.floor(generators[GeneratorTypes.initialAttenuation] * 0.4);
        voiceParameters.push({
          sample: instZone.sample,
          generators,
          modulators
        });
      }
    }
    return voiceParameters;
  }
  /**
  * BankMSB:bankLSB:program:isGMGSDrum
  */
  toMIDIString() {
    return MIDIPatchTools.toMIDIString(this);
  }
  toString() {
    return MIDIPatchTools.toFullMIDIString(this);
  }
  /**
  * Combines preset into an instrument, flattening the preset zones into instrument zones.
  * This is a really complex function that attempts to work around the DLS limitations of only having the instrument layer.
  * @returns The instrument containing the flattened zones. In theory, it should exactly the same as this preset.
  */
  toFlattenedInstrument() {
    const addUnique = (main, adder) => {
      main.push(...adder.filter((g) => !main.some((mg) => mg.type === g.type)));
    };
    const addUniqueMods = (main, adder) => {
      main.push(...adder.filter((m) => !main.some((mm) => Modulator.isIdentical(m, mm))));
    };
    const outputInstrument = new BasicInstrument();
    outputInstrument.name = this.name;
    const globalPresetGenerators = [];
    const globalPresetModulators = [];
    const globalPresetZone = this.globalZone;
    globalPresetGenerators.push(...globalPresetZone.generators);
    globalPresetModulators.push(...globalPresetZone.modulators);
    const globalPresetKeyRange = globalPresetZone.keyRange;
    const globalPresetVelRange = globalPresetZone.velRange;
    for (const presetZone of this.zones) {
      if (!presetZone.instrument) throw new Error("No instrument in a preset zone.");
      let presetZoneKeyRange = presetZone.keyRange;
      if (!presetZone.hasKeyRange) presetZoneKeyRange = globalPresetKeyRange;
      let presetZoneVelRange = presetZone.velRange;
      if (!presetZone.hasVelRange) presetZoneVelRange = globalPresetVelRange;
      const presetGenerators = presetZone.generators.map((g) => new Generator(g.type, g.value));
      addUnique(presetGenerators, globalPresetGenerators);
      const presetModulators = [...presetZone.modulators];
      addUniqueMods(presetModulators, globalPresetModulators);
      const instrument = presetZone.instrument;
      const iZones = instrument.zones;
      const globalInstGenerators = [];
      const globalInstModulators = [];
      const globalInstZone = instrument.globalZone;
      globalInstGenerators.push(...globalInstZone.generators);
      globalInstModulators.push(...globalInstZone.modulators);
      const globalInstKeyRange = globalInstZone.keyRange;
      const globalInstVelRange = globalInstZone.velRange;
      for (const instZone of iZones) {
        if (!instZone.sample) throw new Error("No sample in an instrument zone.");
        let instZoneKeyRange = instZone.keyRange;
        if (!instZone.hasKeyRange) instZoneKeyRange = globalInstKeyRange;
        let instZoneVelRange = instZone.velRange;
        if (!instZone.hasVelRange) instZoneVelRange = globalInstVelRange;
        instZoneKeyRange = BasicPreset2.subtractRanges(instZoneKeyRange, presetZoneKeyRange);
        instZoneVelRange = BasicPreset2.subtractRanges(instZoneVelRange, presetZoneVelRange);
        if (instZoneKeyRange.max < instZoneKeyRange.min || instZoneVelRange.max < instZoneVelRange.min) continue;
        const instGenerators = instZone.generators.map((g) => new Generator(g.type, g.value));
        addUnique(instGenerators, globalInstGenerators);
        const instModulators = [...instZone.modulators];
        addUniqueMods(instModulators, globalInstModulators);
        const finalModList = [...instModulators];
        for (const mod of presetModulators) {
          const identicalInstMod = finalModList.findIndex((m) => Modulator.isIdentical(mod, m));
          if (identicalInstMod === -1) finalModList.push(mod);
          else finalModList[identicalInstMod] = finalModList[identicalInstMod].sumTransform(mod);
        }
        let finalGenList = instGenerators.map((g) => new Generator(g.type, g.value));
        for (const gen of presetGenerators) {
          if (gen.type === GeneratorTypes.velRange || gen.type === GeneratorTypes.keyRange || gen.type === GeneratorTypes.instrument || gen.type === GeneratorTypes.endOper || gen.type === GeneratorTypes.sampleModes) continue;
          const identicalInstGen = instGenerators.findIndex((g) => g.type === gen.type);
          if (identicalInstGen === -1) {
            const newAmount = GeneratorLimits[gen.type].def + gen.value;
            finalGenList.push(new Generator(gen.type, newAmount));
          } else {
            const newAmount = finalGenList[identicalInstGen].value + gen.value;
            finalGenList[identicalInstGen] = new Generator(gen.type, newAmount);
          }
        }
        finalGenList = finalGenList.filter((g) => g.type !== GeneratorTypes.sampleID && g.type !== GeneratorTypes.keyRange && g.type !== GeneratorTypes.velRange && g.type !== GeneratorTypes.endOper && g.type !== GeneratorTypes.instrument && (!(g.type in GeneratorLimits) || g.value !== GeneratorLimits[g.type].def));
        const zone = outputInstrument.createZone(instZone.sample);
        zone.keyRange = instZoneKeyRange;
        zone.velRange = instZoneVelRange;
        if (zone.keyRange.min === 0 && zone.keyRange.max === 127) zone.keyRange.min = -1;
        if (zone.velRange.min === 0 && zone.velRange.max === 127) zone.velRange.min = -1;
        zone.addGenerators(...finalGenList);
        zone.addModulators(...finalModList);
      }
    }
    return outputInstrument;
  }
  /**
  * Writes the SF2 header
  * @param phdrData
  * @param index
  * @param writeLSB
  * @internal
  */
  write(phdrData, index, writeLSB) {
    SpessaLog.info(`%cWriting ${this.name}...`, ConsoleColors.info);
    writeBinaryStringIndexed(phdrData.pdta, this.name.slice(0, 20), 20);
    writeBinaryStringIndexed(phdrData.xdta, this.name.slice(20), 20);
    writeWord(phdrData.pdta, this.program);
    let wBank = this.bankMSB;
    if (writeLSB) {
      wBank = this.bankMSB & 127 | (this.bankLSB & 127) << 8;
      if (this.isGMGSDrum) wBank |= 128;
    } else if (this.isGMGSDrum) wBank = 128;
    else if (this.bankMSB === 0) wBank = this.bankLSB;
    writeWord(phdrData.pdta, wBank);
    phdrData.xdta.currentIndex += 4;
    writeWord(phdrData.pdta, index & 65535);
    writeWord(phdrData.xdta, index >> 16);
    writeDword(phdrData.pdta, this.library);
    writeDword(phdrData.pdta, this.genre);
    writeDword(phdrData.pdta, this.morphology);
    phdrData.xdta.currentIndex += 12;
  }
};
var notGlobalizedTypes = /* @__PURE__ */ new Set([
  GeneratorTypes.velRange,
  GeneratorTypes.keyRange,
  GeneratorTypes.instrument,
  GeneratorTypes.sampleID,
  GeneratorTypes.exclusiveClass,
  GeneratorTypes.endOper,
  GeneratorTypes.sampleModes,
  GeneratorTypes.startloopAddrsOffset,
  GeneratorTypes.startloopAddrsCoarseOffset,
  GeneratorTypes.endloopAddrsOffset,
  GeneratorTypes.endloopAddrsCoarseOffset,
  GeneratorTypes.startAddrsOffset,
  GeneratorTypes.startAddrsCoarseOffset,
  GeneratorTypes.endAddrOffset,
  GeneratorTypes.endAddrsCoarseOffset,
  GeneratorTypes.initialAttenuation,
  GeneratorTypes.fineTune,
  GeneratorTypes.coarseTune,
  GeneratorTypes.keyNumToVolEnvHold,
  GeneratorTypes.keyNumToVolEnvDecay,
  GeneratorTypes.keyNumToModEnvHold,
  GeneratorTypes.keyNumToModEnvDecay
]);
var BasicInstrument = class {
  /**
  * The instrument's name
  */
  name = "";
  /**
  * The instrument's zones
  */
  zones = [];
  /**
  * Instrument's global zone
  */
  globalZone = new BasicZone();
  /**
  * Instrument's linked presets (the presets that use it)
  * note that duplicates are allowed since one preset can use the same instrument multiple times.
  */
  linkedTo = [];
  /**
  * How many presets is this instrument used by
  */
  get useCount() {
    return this.linkedTo.length;
  }
  /**
  * Creates a new instrument zone and returns it.
  * @param sample The sample to use in the zone.
  */
  createZone(sample) {
    const zone = new BasicInstrumentZone(this, sample);
    this.zones.push(zone);
    return zone;
  }
  /**
  * Links the instrument ta a given preset
  * @param preset the preset to link to
  */
  linkTo(preset) {
    this.linkedTo.push(preset);
    for (const z of this.zones) z.useCount++;
  }
  /**
  * Unlinks the instrument from a given preset
  * @param preset the preset to unlink from
  */
  unlinkFrom(preset) {
    const index = this.linkedTo.indexOf(preset);
    if (index === -1) {
      SpessaLog.warn(`Cannot unlink ${preset.name} from ${this.name}: not linked.`);
      return;
    }
    this.linkedTo.splice(index, 1);
    for (const z of this.zones) z.useCount--;
  }
  deleteUnusedZones() {
    this.zones = this.zones.filter((z) => {
      const stays = z.useCount > 0;
      if (!stays) z.sample.unlinkFrom(this);
      return stays;
    });
  }
  delete() {
    if (this.useCount > 0) throw new Error(`Cannot delete an instrument that is used by: ${this.linkedTo.map((p) => p.name).toString()}.`);
    for (const z of this.zones) z.sample.unlinkFrom(this);
  }
  /**
  * Deletes a given instrument zone if it has no uses
  * @param index the index of the zone to delete
  * @param force ignores the use count and deletes forcibly
  * @returns if the zone has been deleted
  */
  deleteZone(index, force = false) {
    const zone = this.zones[index];
    zone.useCount -= 1;
    if (zone.useCount < 1 || force) {
      zone.sample.unlinkFrom(this);
      this.zones.splice(index, 1);
      return true;
    }
    return false;
  }
  /**
  * Globalizes the instrument *in-place.*
  * This means trying to move as many generators and modulators
  * to the global zone as possible to reduce clutter and the count of parameters.
  */
  globalize() {
    const globalZone = this.globalZone;
    for (let checkedType = 0; checkedType < 58; checkedType++) {
      if (notGlobalizedTypes.has(checkedType)) continue;
      checkedType = checkedType;
      let occurrencesForValues = {};
      const defaultForChecked = GeneratorLimits[checkedType]?.def || 0;
      occurrencesForValues[defaultForChecked] = 0;
      for (const zone of this.zones) {
        const value = zone.getGenerator(checkedType, void 0);
        if (value === void 0) occurrencesForValues[defaultForChecked]++;
        else if (occurrencesForValues[value] === void 0) occurrencesForValues[value] = 1;
        else occurrencesForValues[value]++;
        let relativeCounterpart;
        switch (checkedType) {
          default:
            continue;
          case GeneratorTypes.decayVolEnv:
            relativeCounterpart = GeneratorTypes.keyNumToVolEnvDecay;
            break;
          case GeneratorTypes.holdVolEnv:
            relativeCounterpart = GeneratorTypes.keyNumToVolEnvHold;
            break;
          case GeneratorTypes.decayModEnv:
            relativeCounterpart = GeneratorTypes.keyNumToModEnvDecay;
            break;
          case GeneratorTypes.holdModEnv:
            relativeCounterpart = GeneratorTypes.keyNumToModEnvHold;
        }
        if (zone.getGenerator(relativeCounterpart, void 0) !== void 0) {
          occurrencesForValues = {};
          break;
        }
      }
      if (Object.keys(occurrencesForValues).length > 0) {
        let valueToGlobalize = ["0", 0];
        for (const [value, count] of Object.entries(occurrencesForValues)) if (count > valueToGlobalize[1]) valueToGlobalize = [value, count];
        const targetValue = Number.parseInt(valueToGlobalize[0]);
        if (targetValue !== defaultForChecked) globalZone.setGenerator(checkedType, targetValue, false);
        for (const z of this.zones) {
          const genValue = z.getGenerator(checkedType, void 0);
          if (genValue === void 0) {
            if (targetValue !== defaultForChecked) z.setGenerator(checkedType, defaultForChecked);
          } else if (genValue === targetValue) z.setGenerator(checkedType, null);
        }
      }
    }
    const modulators = this.zones.length === 0 ? [] : this.zones[0].modulators.map((m) => Modulator.copyFrom(m));
    for (const checkedModulator of modulators) {
      let existsForAllZones = true;
      for (const zone of this.zones) {
        if (!existsForAllZones) continue;
        if (!zone.modulators.find((m) => Modulator.isIdentical(m, checkedModulator))) existsForAllZones = false;
      }
      if (existsForAllZones) {
        globalZone.addModulators(Modulator.copyFrom(checkedModulator));
        for (const zone of this.zones) {
          const modulator = zone.modulators.find((m) => Modulator.isIdentical(m, checkedModulator));
          if (!modulator) continue;
          if (modulator.transformAmount === checkedModulator.transformAmount) zone.modulators.splice(zone.modulators.indexOf(modulator), 1);
        }
      }
    }
  }
  /**
  * @internal
  * @param instData
  * @param index
  */
  write(instData, index) {
    SpessaLog.info(`%cWriting ${this.name}...`, ConsoleColors.info);
    writeBinaryStringIndexed(instData.pdta, this.name.slice(0, 20), 20);
    writeBinaryStringIndexed(instData.xdta, this.name.slice(20), 20);
    writeWord(instData.pdta, index & 65535);
    writeWord(instData.xdta, index >>> 16);
  }
};
function getSDTA(bank, smplStartOffsets, smplEndOffsets, rf64, progressFunction) {
  let writtenCount = 0;
  const sampleData = [];
  const sampleSize = [];
  for (const s of bank.samples) {
    const r = s.getRawData(true);
    writtenCount++;
    progressFunction?.(writtenCount / bank.samples.length);
    SpessaLog.info(`%cWrote sample %c${writtenCount}. ${s.name}%c of %c${bank.samples.length}.`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized);
    sampleData.push(r);
    sampleSize.push(r.length);
    if (!s.isCompressed) sampleData.push(new Uint8Array(92));
  }
  const smpl = RIFFChunk.getParts("smpl", sampleData, rf64);
  const sdta = RIFFChunk.getParts("sdta", smpl, rf64, true);
  let offset = 0;
  for (const [i, sample] of bank.samples.entries()) {
    const size = sampleSize[i];
    let startOffset;
    let endOffset;
    if (sample.isCompressed) {
      startOffset = offset;
      endOffset = startOffset + size;
    } else {
      startOffset = offset / 2;
      endOffset = startOffset + size / 2;
      offset += 92;
    }
    offset += size;
    smplStartOffsets.push(startOffset);
    smplEndOffsets.push(endOffset);
  }
  return sdta;
}
var SoundFontSample = class extends BasicSample {
  /**
  * Linked sample index for retrieving linked samples in sf2
  */
  linkedSampleIndex;
  /**
  * The sliced sample from the smpl chunk.
  */
  s16leData;
  startByteOffset;
  endByteOffset;
  sampleID;
  /**
  * Creates a sample
  * @param sampleName
  * @param sampleStartIndex
  * @param sampleEndIndex
  * @param sampleLoopStartIndex
  * @param sampleLoopEndIndex
  * @param sampleRate
  * @param samplePitch
  * @param samplePitchCorrection
  * @param linkedSampleIndex
  * @param sampleType
  * @param sampleDataArray
  * @param sampleIndex initial sample index when loading the sfont
  * Used for SF2Pack support
  */
  constructor(sampleName, sampleStartIndex, sampleEndIndex, sampleLoopStartIndex, sampleLoopEndIndex, sampleRate, samplePitch, samplePitchCorrection, linkedSampleIndex, sampleType, sampleDataArray, sampleIndex) {
    const compressed = (sampleType & 16) > 0;
    sampleType &= -17;
    super(sampleName, sampleRate, samplePitch, samplePitchCorrection, sampleType, sampleLoopStartIndex - sampleStartIndex / 2, sampleLoopEndIndex - sampleStartIndex / 2);
    this.dataOverridden = false;
    this.name = sampleName;
    this.startByteOffset = sampleStartIndex;
    this.endByteOffset = sampleEndIndex;
    this.sampleID = sampleIndex;
    const smplStart = sampleDataArray instanceof IndexedByteArray ? sampleDataArray.currentIndex : 0;
    if (sampleDataArray instanceof IndexedByteArray) if (compressed) {
      this.loopStart += this.startByteOffset / 2;
      this.loopEnd += this.startByteOffset / 2;
      this.setCompressedData(sampleDataArray.slice(this.startByteOffset / 2 + smplStart, this.endByteOffset / 2 + smplStart));
    } else this.s16leData = sampleDataArray.slice(smplStart + this.startByteOffset, smplStart + this.endByteOffset);
    else this.setAudioData(sampleDataArray.slice(this.startByteOffset / 2, this.endByteOffset / 2), sampleRate);
    this.linkedSampleIndex = linkedSampleIndex;
  }
  getLinkedSample(samplesArray) {
    if (this.linkedSample || !this.isLinked) return;
    const linked = samplesArray[this.linkedSampleIndex];
    if (linked) if (linked.linkedSample) {
      SpessaLog.info(`%cInvalid linked sample for ${this.name}: ${linked.name} is already linked to ${linked.linkedSample.name}`, ConsoleColors.warn);
      this.unlinkSample();
    } else if (linked === this) {
      SpessaLog.info(`%cInvalid linked sample for ${this.name}: linked to itself.`, ConsoleColors.warn);
      this.unlinkSample();
    } else this.setLinkedSample(linked, this.sampleType);
    else {
      SpessaLog.info(`%cInvalid linked sample for ${this.name}. Setting to mono.`, ConsoleColors.warn);
      this.unlinkSample();
    }
  }
  /**
  * Loads the audio data and stores it for reuse
  * @returns  The audio data
  */
  getAudioData() {
    if (this.audioData) return this.audioData;
    if (this.isCompressed) return super.getAudioData();
    if (!this.s16leData) {
      console.error(this);
      throw new Error("Unexpected lack of audio data.");
    }
    const byteLength = this.endByteOffset - this.startByteOffset;
    if (byteLength < 1) {
      SpessaLog.warn(`Invalid sample ${this.name}! Invalid length: ${byteLength}`);
      return new Float32Array(1);
    }
    const audioData = new Float32Array(byteLength / 2);
    const convertedSigned16 = new Int16Array(this.s16leData.buffer);
    const l = convertedSigned16.length;
    for (let i = 0; i < l; i++) audioData[i] = convertedSigned16[i] / 32768;
    this.audioData = audioData;
    return audioData;
  }
  getRawData(allowVorbis) {
    if (this.dataOverridden || this.compressedData) return super.getRawData(allowVorbis);
    return this.s16leData ?? new Uint8Array(0);
  }
};
function readSamples(sampleHeadersChunk, smplChunkData, linkSamples = true) {
  const samples = [];
  let index = 0;
  while (sampleHeadersChunk.data.length > sampleHeadersChunk.data.currentIndex) {
    const sample = readSample(index, sampleHeadersChunk.data, smplChunkData);
    samples.push(sample);
    index++;
  }
  samples.pop();
  if (linkSamples) for (const s of samples) s.getLinkedSample(samples);
  return samples;
}
function readSample(index, sampleHeaderData, smplArrayData) {
  const sampleName = readBinaryStringIndexed(sampleHeaderData, 20);
  const sampleStartIndex = readLittleEndianIndexed(sampleHeaderData, 4) * 2;
  const sampleEndIndex = readLittleEndianIndexed(sampleHeaderData, 4) * 2;
  const sampleLoopStartIndex = readLittleEndianIndexed(sampleHeaderData, 4);
  const sampleLoopEndIndex = readLittleEndianIndexed(sampleHeaderData, 4);
  const sampleRate = readLittleEndianIndexed(sampleHeaderData, 4);
  let samplePitch = sampleHeaderData[sampleHeaderData.currentIndex++];
  if (samplePitch > 127) samplePitch = 60;
  const samplePitchCorrection = signedInt8(sampleHeaderData[sampleHeaderData.currentIndex++]);
  const sampleLink = readLittleEndianIndexed(sampleHeaderData, 2);
  const sampleType = readLittleEndianIndexed(sampleHeaderData, 2);
  return new SoundFontSample(sampleName, sampleStartIndex, sampleEndIndex, sampleLoopStartIndex, sampleLoopEndIndex, sampleRate, samplePitch, samplePitchCorrection, sampleLink, sampleType, smplArrayData, index);
}
function getSHDR(bank, smplStartOffsets, smplEndOffsets, rf64) {
  const sampleLength = 46;
  const shdrSize = sampleLength * (bank.samples.length + 1);
  const shdrData = new IndexedByteArray(shdrSize);
  const xshdrData = new IndexedByteArray(shdrSize);
  let maxSampleLink = 0;
  for (const [index, sample] of bank.samples.entries()) {
    writeBinaryStringIndexed(shdrData, sample.name.slice(0, 20), 20);
    writeBinaryStringIndexed(xshdrData, sample.name.slice(20), 20);
    const dwStart = smplStartOffsets[index];
    writeDword(shdrData, dwStart);
    xshdrData.currentIndex += 4;
    const dwEnd = smplEndOffsets[index];
    writeDword(shdrData, dwEnd);
    xshdrData.currentIndex += 4;
    let loopStart = sample.loopStart + dwStart;
    let loopEnd = sample.loopEnd + dwStart;
    if (sample.isCompressed) {
      loopStart -= dwStart;
      loopEnd -= dwStart;
    }
    writeDword(shdrData, loopStart);
    writeDword(shdrData, loopEnd);
    writeDword(shdrData, sample.sampleRate);
    shdrData[shdrData.currentIndex++] = sample.originalKey;
    shdrData[shdrData.currentIndex++] = sample.pitchCorrection;
    xshdrData.currentIndex += 14;
    const sampleLinkIndex = sample.linkedSample ? bank.samples.indexOf(sample.linkedSample) : 0;
    writeWord(shdrData, Math.max(0, sampleLinkIndex) & 65535);
    writeWord(xshdrData, Math.max(0, sampleLinkIndex) >> 16);
    maxSampleLink = Math.max(maxSampleLink, sampleLinkIndex);
    let type = sample.sampleType;
    if (sample.isCompressed) type |= 16;
    writeWord(shdrData, type);
    xshdrData.currentIndex += 2;
  }
  writeBinaryStringIndexed(shdrData, "EOS", sampleLength);
  writeBinaryStringIndexed(xshdrData, "EOS", sampleLength);
  return {
    pdta: RIFFChunk.write("shdr", shdrData, rf64),
    xdta: RIFFChunk.write("shdr", xshdrData, rf64)
  };
}
function writeSF2Elements(bank, rf64, isPreset, writeBankLSB = false) {
  const elements = isPreset ? bank.presets : bank.instruments;
  const genHeader = isPreset ? "pgen" : "igen";
  const modHeader = isPreset ? "pmod" : "imod";
  const bagHeader = isPreset ? "pbag" : "ibag";
  const hdrHeader = isPreset ? "phdr" : "inst";
  const hdrByteSize = isPreset ? 38 : 22;
  let currentGenIndex = 0;
  const generatorIndexes = new Array();
  let currentModIndex = 0;
  const modulatorIndexes = new Array();
  const generators = new Array();
  const modulators = new Array();
  let zoneIndex = 0;
  const zoneIndexes = new Array();
  const writeZone = (z) => {
    generatorIndexes.push(currentGenIndex);
    const gens = z.getWriteGenerators(bank);
    currentGenIndex += gens.length;
    generators.push(...gens);
    modulatorIndexes.push(currentModIndex);
    const mods = z.modulators;
    currentModIndex += mods.length;
    modulators.push(...mods);
  };
  for (const el of elements) {
    zoneIndexes.push(zoneIndex);
    writeZone(el.globalZone);
    for (const zone of el.zones) writeZone(zone);
    zoneIndex += el.zones.length + 1;
  }
  generators.push(new Generator(0, 0, false));
  modulators.push(new DecodedModulator(0, 0, 0, 0, 0));
  generatorIndexes.push(currentGenIndex);
  modulatorIndexes.push(currentModIndex);
  zoneIndexes.push(zoneIndex);
  const genData = new IndexedByteArray(generators.length * 4);
  for (const g of generators) g.write(genData);
  const modData = new IndexedByteArray(modulators.length * 10);
  for (const m of modulators) m.write(modData);
  const bagSize = modulatorIndexes.length * 4;
  const bagData = {
    pdta: new IndexedByteArray(bagSize),
    xdta: new IndexedByteArray(bagSize)
  };
  for (const [i, modulatorIndex] of modulatorIndexes.entries()) {
    const generatorIndex = generatorIndexes[i];
    writeWord(bagData.pdta, generatorIndex & 65535);
    writeWord(bagData.pdta, modulatorIndex & 65535);
    writeWord(bagData.xdta, generatorIndex >> 16);
    writeWord(bagData.xdta, modulatorIndex >> 16);
  }
  const hdrSize = (elements.length + 1) * hdrByteSize;
  const hdrData = {
    pdta: new IndexedByteArray(hdrSize),
    xdta: new IndexedByteArray(hdrSize)
  };
  for (const [i, el] of elements.entries()) el.write(hdrData, zoneIndexes[i], writeBankLSB);
  if (isPreset) {
    writeBinaryStringIndexed(hdrData.pdta, "EOP", 20);
    hdrData.pdta.currentIndex += 4;
    writeWord(hdrData.pdta, zoneIndex & 65535);
    hdrData.pdta.currentIndex += 12;
    writeBinaryStringIndexed(hdrData.xdta, "", 20);
    hdrData.xdta.currentIndex += 4;
    writeWord(hdrData.xdta, zoneIndex >> 16);
    hdrData.xdta.currentIndex += 12;
  } else {
    writeBinaryStringIndexed(hdrData.pdta, "EOI", 20);
    writeWord(hdrData.pdta, zoneIndex & 65535);
    writeBinaryStringIndexed(hdrData.xdta, "", 20);
    writeWord(hdrData.xdta, zoneIndex >> 16);
  }
  return {
    writeXdta: Math.max(currentGenIndex, currentModIndex, zoneIndex) > 65535,
    gen: {
      pdta: RIFFChunk.write(genHeader, genData, rf64),
      xdta: RIFFChunk.write(modHeader, new IndexedByteArray(4), rf64)
    },
    mod: {
      pdta: RIFFChunk.write(modHeader, modData, rf64),
      xdta: RIFFChunk.write(modHeader, new IndexedByteArray(10), rf64)
    },
    bag: {
      pdta: RIFFChunk.write(bagHeader, bagData.pdta, rf64),
      xdta: RIFFChunk.write(bagHeader, bagData.xdta, rf64)
    },
    hdr: {
      pdta: RIFFChunk.write(hdrHeader, hdrData.pdta, rf64),
      xdta: RIFFChunk.write(hdrHeader, hdrData.xdta, rf64)
    }
  };
}
var DEFAULT_SF2_WRITE_OPTIONS = {
  writeDefaultModulators: true,
  writeExtendedLimits: true,
  software: "SpessaSynth"
};
var DEFAULT_SFE_WRITE_OPTIONS = {
  rf64: true,
  software: "SpessaSynth"
};
function writeSF2Internal(bank, writeOptions) {
  const options = fillWithDefaults(writeOptions, DEFAULT_SF2_WRITE_OPTIONS);
  return writeSF(bank, options.software, options.writeDefaultModulators, options.writeExtendedLimits, false, false);
}
function writeSFEInternal(bank, writeOptions) {
  return writeSF(bank, fillWithDefaults(writeOptions, DEFAULT_SFE_WRITE_OPTIONS).software, true, true, true, true);
}
function writeSF(bank, software, writeDefaultModulators, writeExtendedLimits, writeBankLSB, rf64) {
  SpessaLog.groupCollapsed("%cSaving soundbank...", ConsoleColors.info);
  SpessaLog.group("%cWriting INFO...", ConsoleColors.info);
  const infoArrays = [];
  const writeSF2Info = (type, data) => {
    if (!data) return;
    infoArrays.push(...RIFFChunk.getParts(type, [getStringBytes(data, true, true)], rf64));
  };
  const info = bank.soundBankInfo;
  {
    const ifilData = new IndexedByteArray(4);
    writeWord(ifilData, info.version.major);
    writeWord(ifilData, info.version.minor);
    infoArrays.push(RIFFChunk.write("ifil", ifilData, rf64));
  }
  writeSF2Info("isng", info.soundEngine);
  writeSF2Info("INAM", info.name);
  writeSF2Info("irom", info.romInfo);
  if (info.romVersion) {
    const ifilData = new IndexedByteArray(4);
    writeWord(ifilData, info.romVersion.major);
    writeWord(ifilData, info.romVersion.minor);
    infoArrays.push(RIFFChunk.write("iver", ifilData, rf64));
  }
  writeSF2Info("ICRD", toISODateString(info.creationDate));
  writeSF2Info("IENG", info.engineer);
  writeSF2Info("IPRD", info.product);
  writeSF2Info("ICOP", info.copyright);
  writeSF2Info("ICMT", info?.subject ? (info?.comment ? info.comment + "\n" : "") + info.subject : info?.comment);
  writeSF2Info("ISFT", software);
  if (bank.defaultModulators.some((mod) => !SPESSASYNTH_DEFAULT_MODULATORS.some((m) => Modulator.isIdentical(m, mod, true))) && writeDefaultModulators) {
    const mods = bank.defaultModulators;
    SpessaLog.info(`%cWriting %c${mods.length}%c default modulators...`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
    const dmodData = new IndexedByteArray(10 + mods.length * 10);
    for (const mod of mods) mod.write(dmodData);
    writeLittleEndianIndexed(dmodData, 0, 10);
    infoArrays.push(...RIFFChunk.getParts("DMOD", [dmodData], rf64));
  }
  SpessaLog.groupEnd();
  SpessaLog.info("%cWriting SDTA...", ConsoleColors.info);
  const smplStartOffsets = [];
  const smplEndOffsets = [];
  const sdtaChunk = getSDTA(bank, smplStartOffsets, smplEndOffsets, rf64);
  SpessaLog.info("%cWriting PDTA...", ConsoleColors.info);
  SpessaLog.info("%cWriting SHDR...", ConsoleColors.info);
  const shdrChunk = getSHDR(bank, smplStartOffsets, smplEndOffsets, rf64);
  SpessaLog.group("%cWriting instruments...", ConsoleColors.info);
  const instData = writeSF2Elements(bank, rf64, false);
  SpessaLog.groupEnd();
  SpessaLog.group("%cWriting presets...", ConsoleColors.info);
  const presData = writeSF2Elements(bank, rf64, true, writeBankLSB);
  SpessaLog.groupEnd();
  const chunks = [
    presData.hdr,
    presData.bag,
    presData.mod,
    presData.gen,
    instData.hdr,
    instData.bag,
    instData.mod,
    instData.gen,
    shdrChunk
  ];
  const pdtaChunk = RIFFChunk.getParts("pdta", chunks.map((c) => c.pdta), rf64, true);
  if (writeExtendedLimits && (instData.writeXdta || presData.writeXdta || bank.presets.some((p) => p.name.length > 20) || bank.instruments.some((i) => i.name.length > 20) || bank.samples.some((s) => s.name.length > 20))) {
    SpessaLog.info(`%cWriting the xdta chunk as writeExtendedLimits is enabled and at least one condition was met.`, ConsoleColors.info, ConsoleColors.value);
    infoArrays.push(...RIFFChunk.getParts("xdta", chunks.map((c) => c.xdta), rf64, true));
  }
  const infoChunk = RIFFChunk.getParts("INFO", infoArrays, rf64, true);
  SpessaLog.info("%cWriting the output file...", ConsoleColors.info);
  const main = RIFFChunk.writeParts(rf64 ? "RIFS" : "RIFF", [
    getStringBytes(writeBankLSB ? "sfen" : "sfbk"),
    ...infoChunk,
    ...sdtaChunk,
    ...pdtaChunk
  ], rf64);
  SpessaLog.info(`%cSaved successfully! Final file size: %c${main.length}`, ConsoleColors.info, ConsoleColors.recognized);
  SpessaLog.groupEnd();
  return main.buffer;
}
var DLSVerifier = class {
  /**
  * @param chunk
  * @param expected
  * @throws error if the check doesn't pass
  */
  static verifyHeader(chunk, ...expected) {
    for (const expect of expected) if (chunk.header.toLowerCase() === expect.toLowerCase()) return;
    this.parsingError(`Invalid DLS chunk header! Expected "${expected.join(", or ")}" got "${chunk.header.toLowerCase()}"`);
  }
  /**
  * @param text {string}
  * @param expected {string}
  * @throws error if the check doesn't pass
  */
  static verifyText(text, ...expected) {
    for (const expect of expected) if (text.toLowerCase() === expect.toLowerCase()) return;
    this.parsingError(`FourCC error: Expected "${expected.join(", or ")}" got "${text.toLowerCase()}"`);
  }
  /**
  * @throws error if the check doesn't pass
  */
  static parsingError(error) {
    SpessaLog.groupEnd();
    throw new Error(`DLS parse error: ${error} The file may be corrupted.`);
  }
  static verifyAndReadList(chunk, ...type) {
    this.verifyHeader(chunk, "LIST");
    chunk.data.currentIndex = 0;
    this.verifyText(readBinaryStringIndexed(chunk.data, 4), ...type);
    const chunks = [];
    while (chunk.data.length > chunk.data.currentIndex) chunks.push(RIFFChunk.read(chunk.data));
    return chunks;
  }
};
var DLSSources = {
  none: 0,
  modLfo: 1,
  velocity: 2,
  keyNum: 3,
  volEnv: 4,
  modEnv: 5,
  pitchWheel: 6,
  polyPressure: 7,
  channelPressure: 8,
  vibratoLfo: 9,
  modulationWheel: 129,
  volume: 135,
  pan: 138,
  expression: 139,
  chorus: 221,
  reverb: 219,
  pitchWheelRange: 256,
  fineTune: 257,
  coarseTune: 258
};
var DLSDestinations = {
  none: 0,
  gain: 1,
  reserved: 2,
  pitch: 3,
  pan: 4,
  keyNum: 5,
  chorusSend: 128,
  reverbSend: 129,
  modLfoFreq: 260,
  modLfoDelay: 261,
  vibLfoFreq: 276,
  vibLfoDelay: 277,
  volEnvAttack: 518,
  volEnvDecay: 519,
  reservedEG1: 520,
  volEnvRelease: 521,
  volEnvSustain: 522,
  volEnvDelay: 523,
  volEnvHold: 524,
  modEnvAttack: 778,
  modEnvDecay: 779,
  reservedEG2: 780,
  modEnvRelease: 781,
  modEnvSustain: 782,
  modEnvDelay: 783,
  modEnvHold: 784,
  filterCutoff: 1280,
  filterQ: 1281
};
var DLSLoopTypes = {
  forward: 0,
  loopAndRelease: 1
};
var WSMP_SIZE = 20;
var WSMP_LOOP_SIZE = 16;
var WaveSample = class WaveSample2 extends DLSVerifier {
  /**
  * Specifies the gain to be applied to this sample in 32 bit relative gain units.
  * Each unit of gain represents 1/655360 dB.
  */
  gain = 0;
  /**
  * Specifies the MIDI note which will replay the sample at original pitch. This value ranges
  * from 0 to 127 (a value of 60 represents Middle C, as defined by the MIDI specification).
  */
  unityNote = 60;
  /**
  * Specifies the tuning offset from the usUnityNote in 16 bit relative pitch. (cents)
  */
  fineTune = 0;
  /**
  * Specifies the number (count) of <wavesample-loop> records that are contained in the
  * <wsmp-ck> chunk. The <wavesample-loop> records are stored immediately following the
  * cSampleLoops data field. One shot sounds will have the cSampleLoops field set to 0.
  * Looped sounds will have the cSampleLoops field set to 1. Values greater than 1 are not yet
  * defined at this time.
  */
  loops = new Array();
  /**
  * Specifies flag options for the digital audio sample.
  * Default to F_WSMP_NO_COMPRESSION,
  * according to all DLS files I have.
  */
  fulOptions = 2;
  static copyFrom(inputWaveSample) {
    const outputWaveSample = new WaveSample2();
    outputWaveSample.unityNote = inputWaveSample.unityNote;
    outputWaveSample.gain = inputWaveSample.gain;
    outputWaveSample.fineTune = inputWaveSample.fineTune;
    outputWaveSample.loops = inputWaveSample.loops.map((l) => {
      return { ...l };
    });
    outputWaveSample.fulOptions = inputWaveSample.fulOptions;
    return outputWaveSample;
  }
  static read(chunk) {
    this.verifyHeader(chunk, "wsmp");
    const waveSample = new WaveSample2();
    const cbSize = readLittleEndianIndexed(chunk.data, 4);
    if (cbSize !== WSMP_SIZE) SpessaLog.warn(`Wsmp cbSize mismatch: got ${cbSize}, expected ${WSMP_SIZE}.`);
    waveSample.unityNote = readLittleEndianIndexed(chunk.data, 2);
    waveSample.fineTune = signedInt16(chunk.data[chunk.data.currentIndex++], chunk.data[chunk.data.currentIndex++]);
    waveSample.gain = readLittleEndianIndexed(chunk.data, 4) | 0;
    waveSample.fulOptions = readLittleEndianIndexed(chunk.data, 4);
    if (readLittleEndianIndexed(chunk.data, 4) === 0) {
    } else {
      const cbSize2 = readLittleEndianIndexed(chunk.data, 4);
      if (cbSize2 !== WSMP_LOOP_SIZE) SpessaLog.warn(`CbSize for loop in wsmp mismatch. Expected ${WSMP_LOOP_SIZE}, got ${cbSize2}.`);
      const loopType = readLittleEndianIndexed(chunk.data, 4);
      const loopStart = readLittleEndianIndexed(chunk.data, 4);
      const loopLength = readLittleEndianIndexed(chunk.data, 4);
      waveSample.loops.push({
        loopStart,
        loopLength,
        loopType
      });
    }
    return waveSample;
  }
  static fromSFSample(sample) {
    const waveSample = new WaveSample2();
    waveSample.unityNote = sample.originalKey;
    waveSample.fineTune = sample.pitchCorrection;
    if (sample.loopEnd !== 0 || sample.loopStart !== 0) waveSample.loops.push({
      loopStart: sample.loopStart,
      loopLength: sample.loopEnd - sample.loopStart,
      loopType: DLSLoopTypes.forward
    });
    return waveSample;
  }
  static fromSFZone(zone) {
    const waveSample = new WaveSample2();
    waveSample.unityNote = zone.getGenerator(GeneratorTypes.overridingRootKey, zone.sample.originalKey);
    if (zone.getGenerator(GeneratorTypes.scaleTuning, 100) === 0 && zone.keyRange.max - zone.keyRange.min === 0) waveSample.unityNote = zone.keyRange.min;
    waveSample.fineTune = zone.fineTuning + zone.sample.pitchCorrection;
    waveSample.gain = -(zone.getGenerator(GeneratorTypes.initialAttenuation, 0) * 0.4) << 16;
    const loopingMode = zone.getGenerator(GeneratorTypes.sampleModes, 0);
    if (loopingMode !== 0) {
      const loopStart = zone.sample.loopStart + zone.getGenerator(GeneratorTypes.startloopAddrsOffset, 0) + zone.getGenerator(GeneratorTypes.startloopAddrsCoarseOffset, 0) * 32768;
      const loopEnd = zone.sample.loopEnd + zone.getGenerator(GeneratorTypes.endloopAddrsOffset, 0) + zone.getGenerator(GeneratorTypes.endloopAddrsCoarseOffset, 0) * 32768;
      let dlsLoopType;
      switch (loopingMode) {
        case 1:
        default:
          dlsLoopType = 0;
          break;
        case 3:
          dlsLoopType = 1;
      }
      waveSample.loops.push({
        loopType: dlsLoopType,
        loopStart,
        loopLength: loopEnd - loopStart
      });
    }
    return waveSample;
  }
  /**
  * Converts the wsmp data into an SF zone.
  */
  toSFZone(zone, sample) {
    let loopingMode = 0;
    const loop = this.loops[0];
    if (loop) loopingMode = loop.loopType === DLSLoopTypes.loopAndRelease ? 3 : 1;
    if (loopingMode !== 0) zone.setGenerator(GeneratorTypes.sampleModes, loopingMode);
    const wsmpAttenuationCorrected = -(this.gain >> 16) / 0.4;
    if (wsmpAttenuationCorrected !== 0) zone.setGenerator(GeneratorTypes.initialAttenuation, wsmpAttenuationCorrected);
    zone.fineTuning = this.fineTune - sample.pitchCorrection;
    if (this.unityNote !== sample.originalKey) zone.setGenerator(GeneratorTypes.overridingRootKey, this.unityNote);
    if (loop) {
      const diffStart = loop.loopStart - sample.loopStart;
      const diffEnd = loop.loopStart + loop.loopLength - sample.loopEnd;
      if (diffStart !== 0) {
        const fine = diffStart % 32768;
        zone.setGenerator(GeneratorTypes.startloopAddrsOffset, fine);
        const coarse = Math.trunc(diffStart / 32768);
        if (coarse !== 0) zone.setGenerator(GeneratorTypes.startloopAddrsCoarseOffset, coarse);
      }
      if (diffEnd !== 0) {
        const fine = diffEnd % 32768;
        zone.setGenerator(GeneratorTypes.endloopAddrsOffset, fine);
        const coarse = Math.trunc(diffEnd / 32768);
        if (coarse !== 0) zone.setGenerator(GeneratorTypes.endloopAddrsCoarseOffset, coarse);
      }
    }
  }
  write() {
    const wsmpData = new IndexedByteArray(WSMP_SIZE + this.loops.length * WSMP_LOOP_SIZE);
    writeDword(wsmpData, WSMP_SIZE);
    writeWord(wsmpData, this.unityNote);
    writeWord(wsmpData, this.fineTune);
    writeDword(wsmpData, this.gain);
    writeDword(wsmpData, this.fulOptions);
    writeDword(wsmpData, this.loops.length);
    for (const loop of this.loops) {
      writeDword(wsmpData, WSMP_LOOP_SIZE);
      writeDword(wsmpData, loop.loopType);
      writeDword(wsmpData, loop.loopStart);
      writeDword(wsmpData, loop.loopLength);
    }
    return RIFFChunk.write("wsmp", wsmpData);
  }
};
var W_FORMAT_TAG = {
  PCM: 1,
  ALAW: 6
};
function readPCM(data, bytesPerSample) {
  const maxSampleValue = Math.pow(2, bytesPerSample * 8 - 1);
  const maxUnsigned = Math.pow(2, bytesPerSample * 8);
  let normalizationFactor;
  let isUnsigned = false;
  if (bytesPerSample === 1) {
    normalizationFactor = 255;
    isUnsigned = true;
  } else normalizationFactor = maxSampleValue;
  const sampleLength = data.length / bytesPerSample;
  const sampleData = new Float32Array(sampleLength);
  if (bytesPerSample === 2) {
    const s16 = new Int16Array(data.buffer);
    const s16l = s16.length;
    for (let i = 0; i < s16l; i++) sampleData[i] = s16[i] / 32768;
  } else for (let i = 0; i < sampleData.length; i++) {
    let sample = readLittleEndianIndexed(data, bytesPerSample);
    if (isUnsigned) sampleData[i] = sample / normalizationFactor - 0.5;
    else {
      if (sample >= maxSampleValue) sample -= maxUnsigned;
      sampleData[i] = sample / normalizationFactor;
    }
  }
  return sampleData;
}
function readALAW(data, bytesPerSample) {
  const sampleLength = data.length / bytesPerSample;
  const sampleData = new Float32Array(sampleLength);
  for (let i = 0; i < sampleData.length; i++) {
    const input = readLittleEndianIndexed(data, bytesPerSample);
    let sample = input ^ 85;
    sample &= 127;
    const exponent = sample >> 4;
    let mantissa = sample & 15;
    if (exponent > 0) mantissa += 16;
    mantissa = (mantissa << 4) + 8;
    if (exponent > 1) mantissa = mantissa << exponent - 1;
    sampleData[i] = (input > 127 ? mantissa : -mantissa) / 32768;
  }
  return sampleData;
}
var DLSSample = class extends BasicSample {
  wFormatTag;
  bytesPerSample;
  /**
  * Sample's raw data before decoding it, for faster writing
  */
  rawData;
  /**
  * @param name
  * @param rate
  * @param pitch
  * @param pitchCorrection
  * @param loopStart sample data points
  * @param loopEnd sample data points
  * @param dataChunk
  * @param wFormatTag
  * @param bytesPerSample
  */
  constructor(name, rate, pitch, pitchCorrection, loopStart, loopEnd, dataChunk, wFormatTag, bytesPerSample) {
    super(name, rate, pitch, pitchCorrection, SampleTypes.monoSample, loopStart, loopEnd);
    this.dataOverridden = false;
    this.rawData = dataChunk.data;
    this.wFormatTag = wFormatTag;
    this.bytesPerSample = bytesPerSample;
  }
  getAudioData() {
    if (!this.rawData) return new Float32Array(0);
    if (!this.audioData) {
      let sampleData;
      switch (this.wFormatTag) {
        default:
          SpessaLog.warn(`Failed to decode sample. Unknown wFormatTag: ${this.wFormatTag}`);
          sampleData = new Float32Array(this.rawData.length / this.bytesPerSample);
          break;
        case W_FORMAT_TAG.PCM:
          sampleData = readPCM(this.rawData, this.bytesPerSample);
          break;
        case W_FORMAT_TAG.ALAW:
          sampleData = readALAW(this.rawData, this.bytesPerSample);
          break;
      }
      this.setAudioData(sampleData, this.sampleRate);
    }
    return this.audioData ?? new Float32Array(0);
  }
  getRawData(allowVorbis) {
    if (this.dataOverridden || this.isCompressed) return super.getRawData(allowVorbis);
    if (this.wFormatTag === W_FORMAT_TAG.PCM && this.bytesPerSample === 2) return this.rawData;
    return this.encodeS16LE();
  }
};
var DownloadableSoundsSample = class DownloadableSoundsSample2 extends DLSVerifier {
  waveSample = new WaveSample();
  wFormatTag;
  bytesPerSample;
  sampleRate;
  dataChunk;
  name = "Unnamed sample";
  constructor(wFormatTag, bytesPerSample, sampleRate, dataChunk) {
    super();
    this.wFormatTag = wFormatTag;
    this.bytesPerSample = bytesPerSample;
    this.sampleRate = sampleRate;
    this.dataChunk = dataChunk;
  }
  static read(waveChunk) {
    const chunks = this.verifyAndReadList(waveChunk, "wave");
    const fmtChunk = chunks.find((c) => c.header === "fmt ");
    if (!fmtChunk) throw new Error("No fmt chunk in the wave file!");
    const wFormatTag = readLittleEndianIndexed(fmtChunk.data, 2);
    const channelsAmount = readLittleEndianIndexed(fmtChunk.data, 2);
    if (channelsAmount !== 1) throw new Error(`Only mono samples are supported. Fmt reports ${channelsAmount} channels.`);
    const sampleRate = readLittleEndianIndexed(fmtChunk.data, 4);
    readLittleEndianIndexed(fmtChunk.data, 4);
    readLittleEndianIndexed(fmtChunk.data, 2);
    const bytesPerSample = readLittleEndianIndexed(fmtChunk.data, 2) / 8;
    const dataChunk = chunks.find((c) => c.header === "data");
    if (!dataChunk) throw new Error("No data chunk in the WAVE chunk!");
    const sample = new DownloadableSoundsSample2(wFormatTag, bytesPerSample, sampleRate, dataChunk);
    const waveInfo = RIFFChunk.findListType(chunks, "INFO");
    if (waveInfo) {
      let infoChunk = RIFFChunk.read(waveInfo.data);
      while (infoChunk.header !== "INAM" && waveInfo.data.currentIndex < waveInfo.data.length) infoChunk = RIFFChunk.read(waveInfo.data);
      if (infoChunk.header === "INAM") sample.name = readBinaryStringIndexed(infoChunk.data, infoChunk.size).trim();
    }
    const wsmpChunk = chunks.find((c) => c.header === "wsmp");
    if (wsmpChunk) sample.waveSample = WaveSample.read(wsmpChunk);
    return sample;
  }
  static fromSFSample(sample) {
    const raw = sample.getRawData(false);
    const dlsSample = new DownloadableSoundsSample2(1, 2, sample.sampleRate, new RIFFChunk("data", raw.length, new IndexedByteArray(raw.buffer)));
    dlsSample.name = sample.name;
    dlsSample.waveSample = WaveSample.fromSFSample(sample);
    return dlsSample;
  }
  toSFSample(soundBank) {
    let originalKey = this.waveSample.unityNote;
    let pitchCorrection = this.waveSample.fineTune;
    const samplePitchSemitones = Math.trunc(pitchCorrection / 100);
    originalKey += samplePitchSemitones;
    pitchCorrection -= samplePitchSemitones * 100;
    let loopStart = 0;
    let loopEnd = 0;
    const loop = this.waveSample.loops?.[0];
    if (loop) {
      loopStart = loop.loopStart;
      loopEnd = loop.loopStart + loop.loopLength;
    }
    const sample = new DLSSample(this.name, this.sampleRate, originalKey, pitchCorrection, loopStart, loopEnd, this.dataChunk, this.wFormatTag, this.bytesPerSample);
    soundBank.addSamples(sample);
  }
  write() {
    const fmt = this.writeFmt();
    const wsmp = this.waveSample.write();
    const data = RIFFChunk.getParts("data", [this.dataChunk.data]);
    const inam = RIFFChunk.write("INAM", getStringBytes(this.name, true));
    const info = RIFFChunk.write("INFO", inam, false, true);
    SpessaLog.info(`%cSaved %c${this.name}%c successfully!`, ConsoleColors.recognized, ConsoleColors.value, ConsoleColors.recognized);
    return RIFFChunk.getParts("wave", [
      fmt,
      wsmp,
      ...data,
      info
    ], false, true);
  }
  writeFmt() {
    const fmtData = new IndexedByteArray(18);
    writeWord(fmtData, this.wFormatTag);
    writeWord(fmtData, 1);
    writeDword(fmtData, this.sampleRate);
    writeDword(fmtData, this.sampleRate * 2);
    writeWord(fmtData, 2);
    writeWord(fmtData, this.bytesPerSample * 8);
    return RIFFChunk.write("fmt ", fmtData);
  }
};
var ConnectionSource = class ConnectionSource2 {
  source;
  transform;
  bipolar;
  invert;
  constructor(source = DLSSources.none, transform = ModulatorCurveTypes.linear, bipolar = false, invert = false) {
    this.source = source;
    this.transform = transform;
    this.bipolar = bipolar;
    this.invert = invert;
  }
  get sourceName() {
    return Object.keys(DLSSources).find((k2) => DLSSources[k2] === this.source) ?? this.source.toString();
  }
  get transformName() {
    return Object.keys(ModulatorCurveTypes).find((k2) => ModulatorCurveTypes[k2] === this.transform) ?? this.transform.toString();
  }
  static copyFrom(inputSource) {
    return new ConnectionSource2(inputSource.source, inputSource.transform, inputSource.bipolar, inputSource.invert);
  }
  static fromSFSource(source) {
    let sourceEnum = void 0;
    if (source.isCC) switch (source.index) {
      case MIDIControllers.modulationWheel:
        sourceEnum = DLSSources.modulationWheel;
        break;
      case MIDIControllers.mainVolume:
        sourceEnum = DLSSources.volume;
        break;
      case MIDIControllers.pan:
        sourceEnum = DLSSources.pan;
        break;
      case MIDIControllers.expression:
        sourceEnum = DLSSources.expression;
        break;
      case MIDIControllers.chorusDepth:
        sourceEnum = DLSSources.chorus;
        break;
      case MIDIControllers.reverbDepth:
        sourceEnum = DLSSources.reverb;
        break;
    }
    else switch (source.index) {
      case ModulatorControllerSources.noController:
        sourceEnum = DLSSources.none;
        break;
      case ModulatorControllerSources.noteOnKeyNum:
        sourceEnum = DLSSources.keyNum;
        break;
      case ModulatorControllerSources.noteOnVelocity:
        sourceEnum = DLSSources.velocity;
        break;
      case ModulatorControllerSources.pitchWheel:
        sourceEnum = DLSSources.pitchWheel;
        break;
      case ModulatorControllerSources.pitchWheelRange:
        sourceEnum = DLSSources.pitchWheelRange;
        break;
      case ModulatorControllerSources.polyPressure:
        sourceEnum = DLSSources.polyPressure;
        break;
      case ModulatorControllerSources.channelPressure:
        sourceEnum = DLSSources.channelPressure;
    }
    if (sourceEnum === void 0) return;
    return new ConnectionSource2(sourceEnum, source.curveType, source.isBipolar, source.isNegative);
  }
  toString() {
    return `${this.sourceName} ${this.transformName} ${this.bipolar ? "bipolar" : "unipolar"} ${this.invert ? "inverted" : "positive"}`;
  }
  toTransformFlag() {
    return this.transform | (this.bipolar ? 1 : 0) << 4 | (this.invert ? 1 : 0) << 5;
  }
  toSFSource() {
    let sourceEnum;
    let isCC = false;
    switch (this.source) {
      default:
      case DLSSources.modLfo:
      case DLSSources.vibratoLfo:
      case DLSSources.coarseTune:
      case DLSSources.fineTune:
      case DLSSources.modEnv:
        return;
      case DLSSources.keyNum:
        sourceEnum = ModulatorControllerSources.noteOnKeyNum;
        break;
      case DLSSources.none:
        sourceEnum = ModulatorControllerSources.noController;
        break;
      case DLSSources.modulationWheel:
        sourceEnum = MIDIControllers.modulationWheel;
        isCC = true;
        break;
      case DLSSources.pan:
        sourceEnum = MIDIControllers.pan;
        isCC = true;
        break;
      case DLSSources.reverb:
        sourceEnum = MIDIControllers.reverbDepth;
        isCC = true;
        break;
      case DLSSources.chorus:
        sourceEnum = MIDIControllers.chorusDepth;
        isCC = true;
        break;
      case DLSSources.expression:
        sourceEnum = MIDIControllers.expression;
        isCC = true;
        break;
      case DLSSources.volume:
        sourceEnum = MIDIControllers.mainVolume;
        isCC = true;
        break;
      case DLSSources.velocity:
        sourceEnum = ModulatorControllerSources.noteOnVelocity;
        break;
      case DLSSources.polyPressure:
        sourceEnum = ModulatorControllerSources.polyPressure;
        break;
      case DLSSources.channelPressure:
        sourceEnum = ModulatorControllerSources.channelPressure;
        break;
      case DLSSources.pitchWheel:
        sourceEnum = ModulatorControllerSources.pitchWheel;
        break;
      case DLSSources.pitchWheelRange:
        sourceEnum = ModulatorControllerSources.pitchWheelRange;
        break;
    }
    if (sourceEnum === void 0) return;
    return new ModulatorSource(sourceEnum, this.transform, isCC, this.bipolar, this.invert);
  }
};
var DEFAULT_DLS_REVERB = new DecodedModulator(219, 0, GeneratorTypes.reverbEffectsSend, 1e3, 0);
var DEFAULT_DLS_CHORUS = new DecodedModulator(221, 0, GeneratorTypes.chorusEffectsSend, 1e3, 0);
new DecodedModulator(129, 0, GeneratorTypes.vibLfoToPitch, 0, 0);
new DecodedModulator(13, 0, GeneratorTypes.vibLfoToPitch, 0, 0);
var invalidGeneratorTypes = /* @__PURE__ */ new Set([
  GeneratorTypes.sampleModes,
  GeneratorTypes.initialAttenuation,
  GeneratorTypes.keyRange,
  GeneratorTypes.velRange,
  GeneratorTypes.sampleID,
  GeneratorTypes.fineTune,
  GeneratorTypes.coarseTune,
  GeneratorTypes.startAddrsOffset,
  GeneratorTypes.startAddrsCoarseOffset,
  GeneratorTypes.endAddrOffset,
  GeneratorTypes.endAddrsCoarseOffset,
  GeneratorTypes.startloopAddrsOffset,
  GeneratorTypes.startloopAddrsCoarseOffset,
  GeneratorTypes.endloopAddrsOffset,
  GeneratorTypes.endloopAddrsCoarseOffset,
  GeneratorTypes.overridingRootKey,
  GeneratorTypes.exclusiveClass
]);
var ConnectionBlock = class ConnectionBlock2 {
  /**
  * Like SF2 modulator source.
  */
  source;
  /**
  * Like SF2 modulator secondary source.
  */
  control;
  /**
  * Like SF2 destination.
  */
  destination;
  /**
  * Like SF2 amount, but long (32-bit) instead of short.
  */
  scale;
  /**
  * Like SF2 source transforms.
  */
  transform;
  constructor(source = new ConnectionSource(), control = new ConnectionSource(), destination, transform, scale) {
    this.source = source;
    this.control = control;
    this.destination = destination;
    this.transform = transform;
    this.scale = scale;
  }
  get isStaticParameter() {
    return this.source.source === DLSSources.none && this.control.source === DLSSources.none;
  }
  get shortScale() {
    return this.scale >> 16;
  }
  get transformName() {
    return Object.keys(ModulatorCurveTypes).find((k2) => ModulatorCurveTypes[k2] === this.transform) ?? this.transform.toString();
  }
  get destinationName() {
    return Object.keys(DLSDestinations).find((k2) => DLSDestinations[k2] === this.destination) ?? this.destination.toString();
  }
  static read(artData) {
    const usSource = readLittleEndianIndexed(artData, 2);
    const usControl = readLittleEndianIndexed(artData, 2);
    const usDestination = readLittleEndianIndexed(artData, 2);
    const usTransform = readLittleEndianIndexed(artData, 2);
    const lScale = readLittleEndianIndexed(artData, 4) | 0;
    const transform = usTransform & 15;
    const control = new ConnectionSource(usControl, usTransform >> 4 & 15, bitMaskToBool(usTransform, 8), bitMaskToBool(usTransform, 9));
    return new ConnectionBlock2(new ConnectionSource(usSource, usTransform >> 10 & 15, bitMaskToBool(usTransform, 14), bitMaskToBool(usTransform, 15)), control, usDestination, transform, lScale);
  }
  static fromSFModulator(m, articulation) {
    const failed = (msg) => {
      SpessaLog.warn(`Failed converting SF modulator into DLS:
 ${m.toString()} 
(${msg})`);
    };
    if (m.transformType !== 0) {
      failed("Absolute transform type is not supported");
      return;
    }
    if (Modulator.isIdentical(m, DEFAULT_DLS_CHORUS, true) || Modulator.isIdentical(m, DEFAULT_DLS_REVERB, true)) return;
    let source = ConnectionSource.fromSFSource(m.primarySource);
    if (!source) {
      failed("Invalid primary source");
      return;
    }
    let control = ConnectionSource.fromSFSource(m.secondarySource);
    if (!control) {
      failed("Invalid secondary source");
      return;
    }
    const dlsDestination = ConnectionBlock2.fromSFDestination(m.destination, m.transformAmount);
    if (dlsDestination === void 0) {
      failed("Invalid destination");
      return;
    }
    let amount = m.transformAmount;
    let destination;
    if (typeof dlsDestination === "number") destination = dlsDestination;
    else {
      destination = dlsDestination.destination;
      amount = dlsDestination.amount;
      if (dlsDestination.source !== DLSSources.none) {
        if (control.source !== DLSSources.none && source.source !== DLSSources.none) {
          failed("Articulation generators with secondary source are not supported");
          return;
        }
        if (source.source !== DLSSources.none) control = source;
        source = new ConnectionSource(dlsDestination.source, ModulatorCurveTypes.linear, dlsDestination.isBipolar);
      }
    }
    const bloc = new ConnectionBlock2(source, control, destination, 0, amount << 16);
    articulation.connectionBlocks.push(bloc);
  }
  static copyFrom(inputBlock) {
    return new ConnectionBlock2(ConnectionSource.copyFrom(inputBlock.source), ConnectionSource.copyFrom(inputBlock.control), inputBlock.destination, inputBlock.transform, inputBlock.scale);
  }
  static fromSFGenerator(generator, articulation) {
    if (invalidGeneratorTypes.has(generator.type)) return;
    const failed = (msg) => {
      SpessaLog.warn(`Failed converting SF2 generator into DLS:
 ${generator.toString()} 
(${msg})`);
    };
    const dlsDestination = ConnectionBlock2.fromSFDestination(generator.type, generator.value);
    if (dlsDestination === void 0) {
      failed("Invalid type");
      return;
    }
    const source = new ConnectionSource();
    let destination;
    let amount = generator.value;
    if (typeof dlsDestination === "number") destination = dlsDestination;
    else {
      destination = dlsDestination.destination;
      amount = dlsDestination.amount;
      source.source = dlsDestination.source;
      source.bipolar = dlsDestination.isBipolar;
    }
    articulation.connectionBlocks.push(new ConnectionBlock2(source, new ConnectionSource(), destination, 0, amount << 16));
  }
  static fromSFDestination(dest, amount) {
    switch (dest) {
      default:
        return;
      case GeneratorTypes.initialAttenuation:
        return {
          destination: DLSDestinations.gain,
          amount: -amount,
          isBipolar: false,
          source: DLSSources.none
        };
      case GeneratorTypes.fineTune:
        return DLSDestinations.pitch;
      case GeneratorTypes.pan:
        return DLSDestinations.pan;
      case GeneratorTypes.keyNum:
        return DLSDestinations.keyNum;
      case GeneratorTypes.reverbEffectsSend:
        return DLSDestinations.reverbSend;
      case GeneratorTypes.chorusEffectsSend:
        return DLSDestinations.chorusSend;
      case GeneratorTypes.freqModLFO:
        return DLSDestinations.modLfoFreq;
      case GeneratorTypes.delayModLFO:
        return DLSDestinations.modLfoDelay;
      case GeneratorTypes.delayVibLFO:
        return DLSDestinations.vibLfoDelay;
      case GeneratorTypes.freqVibLFO:
        return DLSDestinations.vibLfoFreq;
      case GeneratorTypes.delayVolEnv:
        return DLSDestinations.volEnvDelay;
      case GeneratorTypes.attackVolEnv:
        return DLSDestinations.volEnvAttack;
      case GeneratorTypes.holdVolEnv:
        return DLSDestinations.volEnvHold;
      case GeneratorTypes.decayVolEnv:
        return DLSDestinations.volEnvDecay;
      case GeneratorTypes.sustainVolEnv:
        return {
          destination: DLSDestinations.volEnvSustain,
          amount: 1e3 - amount,
          isBipolar: false,
          source: DLSSources.none
        };
      case GeneratorTypes.releaseVolEnv:
        return DLSDestinations.volEnvRelease;
      case GeneratorTypes.delayModEnv:
        return DLSDestinations.modEnvDelay;
      case GeneratorTypes.attackModEnv:
        return DLSDestinations.modEnvAttack;
      case GeneratorTypes.holdModEnv:
        return DLSDestinations.modEnvHold;
      case GeneratorTypes.decayModEnv:
        return DLSDestinations.modEnvDecay;
      case GeneratorTypes.sustainModEnv:
        return {
          destination: DLSDestinations.modEnvSustain,
          amount: 1e3 - amount,
          isBipolar: false,
          source: DLSSources.none
        };
      case GeneratorTypes.releaseModEnv:
        return DLSDestinations.modEnvRelease;
      case GeneratorTypes.initialFilterFc:
        return DLSDestinations.filterCutoff;
      case GeneratorTypes.initialFilterQ:
        return DLSDestinations.filterQ;
      case GeneratorTypes.modEnvToFilterFc:
        return {
          source: DLSSources.modEnv,
          destination: DLSDestinations.filterCutoff,
          amount,
          isBipolar: false
        };
      case GeneratorTypes.modEnvToPitch:
        return {
          source: DLSSources.modEnv,
          destination: DLSDestinations.pitch,
          amount,
          isBipolar: false
        };
      case GeneratorTypes.modLfoToFilterFc:
        return {
          source: DLSSources.modLfo,
          destination: DLSDestinations.filterCutoff,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.modLfoToVolume:
        return {
          source: DLSSources.modLfo,
          destination: DLSDestinations.gain,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.modLfoToPitch:
        return {
          source: DLSSources.modLfo,
          destination: DLSDestinations.pitch,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.vibLfoToPitch:
        return {
          source: DLSSources.vibratoLfo,
          destination: DLSDestinations.pitch,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.keyNumToVolEnvHold:
        return {
          source: DLSSources.keyNum,
          destination: DLSDestinations.volEnvHold,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.keyNumToVolEnvDecay:
        return {
          source: DLSSources.keyNum,
          destination: DLSDestinations.volEnvDecay,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.keyNumToModEnvHold:
        return {
          source: DLSSources.keyNum,
          destination: DLSDestinations.modEnvHold,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.keyNumToModEnvDecay:
        return {
          source: DLSSources.keyNum,
          destination: DLSDestinations.modEnvDecay,
          amount,
          isBipolar: true
        };
      case GeneratorTypes.scaleTuning:
        return {
          source: DLSSources.keyNum,
          destination: DLSDestinations.pitch,
          amount: amount * 128,
          isBipolar: false
        };
    }
  }
  toString() {
    return `Source: ${this.source.toString()},
Control: ${this.control.toString()},
Scale: ${this.scale} >> 16 = ${this.shortScale},
Output transform: ${this.transformName}
Destination: ${this.destinationName}`;
  }
  write() {
    const out = new IndexedByteArray(12);
    writeWord(out, this.source.source);
    writeWord(out, this.control.source);
    writeWord(out, this.destination);
    writeWord(out, this.transform | this.control.toTransformFlag() << 4 | this.source.toTransformFlag() << 10);
    writeDword(out, this.scale);
    return out;
  }
  toSFGenerator(zone) {
    const destination = this.destination;
    const value = this.shortScale;
    switch (destination) {
      default:
        SpessaLog.info(`%cFailed converting DLS articulator into SF generator: %c${this.toString()}%c
(invalid destination)`, ConsoleColors.warn, ConsoleColors.value, ConsoleColors.unrecognized);
        return;
      case DLSDestinations.keyNum:
        zone.setGenerator(GeneratorTypes.keyNum, value);
        break;
      case DLSDestinations.pan:
        zone.setGenerator(GeneratorTypes.pan, value);
        break;
      case DLSDestinations.gain:
        zone.addToGenerator(GeneratorTypes.initialAttenuation, -value / 0.4);
        break;
      case DLSDestinations.filterCutoff:
        zone.setGenerator(GeneratorTypes.initialFilterFc, value);
        break;
      case DLSDestinations.filterQ:
        zone.setGenerator(GeneratorTypes.initialFilterQ, value);
        break;
      case DLSDestinations.modLfoFreq:
        zone.setGenerator(GeneratorTypes.freqModLFO, value);
        break;
      case DLSDestinations.modLfoDelay:
        zone.setGenerator(GeneratorTypes.delayModLFO, value);
        break;
      case DLSDestinations.vibLfoFreq:
        zone.setGenerator(GeneratorTypes.freqVibLFO, value);
        break;
      case DLSDestinations.vibLfoDelay:
        zone.setGenerator(GeneratorTypes.delayVibLFO, value);
        break;
      case DLSDestinations.volEnvDelay:
        zone.setGenerator(GeneratorTypes.delayVolEnv, value);
        break;
      case DLSDestinations.volEnvAttack:
        zone.setGenerator(GeneratorTypes.attackVolEnv, value);
        break;
      case DLSDestinations.volEnvHold:
        zone.setGenerator(GeneratorTypes.holdVolEnv, value);
        break;
      case DLSDestinations.volEnvDecay:
        zone.setGenerator(GeneratorTypes.decayVolEnv, value);
        break;
      case DLSDestinations.volEnvRelease:
        zone.setGenerator(GeneratorTypes.releaseVolEnv, value);
        break;
      case DLSDestinations.volEnvSustain:
        zone.setGenerator(GeneratorTypes.sustainVolEnv, 1e3 - value);
        break;
      case DLSDestinations.modEnvDelay:
        zone.setGenerator(GeneratorTypes.delayModEnv, value);
        break;
      case DLSDestinations.modEnvAttack:
        zone.setGenerator(GeneratorTypes.attackModEnv, value);
        break;
      case DLSDestinations.modEnvHold:
        zone.setGenerator(GeneratorTypes.holdModEnv, value);
        break;
      case DLSDestinations.modEnvDecay:
        zone.setGenerator(GeneratorTypes.decayModEnv, value);
        break;
      case DLSDestinations.modEnvRelease:
        zone.setGenerator(GeneratorTypes.releaseModEnv, value);
        break;
      case DLSDestinations.modEnvSustain:
        zone.setGenerator(GeneratorTypes.sustainModEnv, 1e3 - value);
        break;
      case DLSDestinations.reverbSend:
        zone.setGenerator(GeneratorTypes.reverbEffectsSend, value);
        break;
      case DLSDestinations.chorusSend:
        zone.setGenerator(GeneratorTypes.chorusEffectsSend, value);
        break;
      case DLSDestinations.pitch:
        zone.fineTuning += value;
        break;
    }
  }
  toSFModulator(zone) {
    let amount = this.shortScale;
    let modulatorDestination;
    let primarySource;
    let secondarySource = new ModulatorSource();
    const specialDestination = this.toCombinedSFDestination();
    if (specialDestination) {
      modulatorDestination = specialDestination;
      const controlSF = this.control.toSFSource();
      if (!controlSF) {
        this.failedConversion("Invalid control");
        return;
      }
      primarySource = controlSF;
    } else {
      const convertedDestination = this.toSFDestination();
      if (!convertedDestination) {
        this.failedConversion("Invalid destination");
        return;
      }
      if (typeof convertedDestination === "object") {
        amount = convertedDestination.newAmount;
        modulatorDestination = convertedDestination.gen;
      } else modulatorDestination = convertedDestination;
      const convertedPrimary = this.source.toSFSource();
      if (!convertedPrimary) {
        this.failedConversion("Invalid source");
        return;
      }
      primarySource = convertedPrimary;
      const convertedSecondary = this.control.toSFSource();
      if (!convertedSecondary) {
        this.failedConversion("Invalid control");
        return;
      }
      secondarySource = convertedSecondary;
    }
    if (this.transform !== ModulatorCurveTypes.linear && primarySource.curveType === ModulatorCurveTypes.linear) primarySource.curveType = this.transform;
    if (modulatorDestination === GeneratorTypes.initialAttenuation) {
      if (this.source.source === DLSSources.velocity || this.source.source === DLSSources.volume || this.source.source === DLSSources.expression) primarySource.isNegative = true;
      amount = Math.min(960, Math.max(0, amount));
    }
    const mod = new Modulator(primarySource, secondarySource, modulatorDestination, amount, 0);
    zone.addModulators(mod);
  }
  /**
  * Checks for an SF generator that consists of DLS source and destination (such as mod LFO and pitch)
  * @returns either a matching SF generator or nothing.
  */
  toCombinedSFDestination() {
    const source = this.source.source;
    const destination = this.destination;
    if (source === DLSSources.vibratoLfo && destination === DLSDestinations.pitch) return GeneratorTypes.vibLfoToPitch;
    else if (source === DLSSources.modLfo && destination === DLSDestinations.pitch) return GeneratorTypes.modLfoToPitch;
    else if (source === DLSSources.modLfo && destination === DLSDestinations.filterCutoff) return GeneratorTypes.modLfoToFilterFc;
    else if (source === DLSSources.modLfo && destination === DLSDestinations.gain) return GeneratorTypes.modLfoToVolume;
    else if (source === DLSSources.modEnv && destination === DLSDestinations.filterCutoff) return GeneratorTypes.modEnvToFilterFc;
    else if (source === DLSSources.modEnv && destination === DLSDestinations.pitch) return GeneratorTypes.modEnvToPitch;
    else return;
  }
  failedConversion(msg) {
    SpessaLog.info(`%cFailed converting DLS articulator into SF2:
 %c${this.toString()}%c
(${msg})`, ConsoleColors.warn, ConsoleColors.value, ConsoleColors.unrecognized);
  }
  /**
  * Converts DLS destination of this block to an SF2 one, also with the correct amount.
  * @private
  */
  toSFDestination() {
    const amount = this.shortScale;
    switch (this.destination) {
      default:
      case DLSDestinations.none:
        return;
      case DLSDestinations.pan:
        return GeneratorTypes.pan;
      case DLSDestinations.gain:
        return {
          gen: GeneratorTypes.initialAttenuation,
          newAmount: -amount
        };
      case DLSDestinations.pitch:
        return GeneratorTypes.fineTune;
      case DLSDestinations.keyNum:
        return GeneratorTypes.keyNum;
      case DLSDestinations.volEnvDelay:
        return GeneratorTypes.delayVolEnv;
      case DLSDestinations.volEnvAttack:
        return GeneratorTypes.attackVolEnv;
      case DLSDestinations.volEnvHold:
        return GeneratorTypes.holdVolEnv;
      case DLSDestinations.volEnvDecay:
        return GeneratorTypes.decayVolEnv;
      case DLSDestinations.volEnvSustain:
        return {
          gen: GeneratorTypes.sustainVolEnv,
          newAmount: 1e3 - amount
        };
      case DLSDestinations.volEnvRelease:
        return GeneratorTypes.releaseVolEnv;
      case DLSDestinations.modEnvDelay:
        return GeneratorTypes.delayModEnv;
      case DLSDestinations.modEnvAttack:
        return GeneratorTypes.attackModEnv;
      case DLSDestinations.modEnvHold:
        return GeneratorTypes.holdModEnv;
      case DLSDestinations.modEnvDecay:
        return GeneratorTypes.decayModEnv;
      case DLSDestinations.modEnvSustain:
        return {
          gen: GeneratorTypes.sustainModEnv,
          newAmount: 1e3 - amount
        };
      case DLSDestinations.modEnvRelease:
        return GeneratorTypes.releaseModEnv;
      case DLSDestinations.filterCutoff:
        return GeneratorTypes.initialFilterFc;
      case DLSDestinations.filterQ:
        return GeneratorTypes.initialFilterQ;
      case DLSDestinations.chorusSend:
        return GeneratorTypes.chorusEffectsSend;
      case DLSDestinations.reverbSend:
        return GeneratorTypes.reverbEffectsSend;
      case DLSDestinations.modLfoFreq:
        return GeneratorTypes.freqModLFO;
      case DLSDestinations.modLfoDelay:
        return GeneratorTypes.delayModLFO;
      case DLSDestinations.vibLfoFreq:
        return GeneratorTypes.freqVibLFO;
      case DLSDestinations.vibLfoDelay:
        return GeneratorTypes.delayVibLFO;
    }
  }
};
var DownloadableSoundsArticulation = class extends DLSVerifier {
  connectionBlocks = new Array();
  mode = "dls2";
  get length() {
    return this.connectionBlocks.length;
  }
  copyFrom(inputArticulation) {
    this.mode = inputArticulation.mode;
    for (const block of inputArticulation.connectionBlocks) this.connectionBlocks.push(ConnectionBlock.copyFrom(block));
  }
  fromSFZone(z) {
    this.mode = "dls2";
    const zone = new BasicZone();
    zone.copyFrom(z);
    for (const relativeGenerator of zone.generators) {
      let absoluteCounterpart;
      switch (relativeGenerator.type) {
        default:
          continue;
        case GeneratorTypes.keyNumToVolEnvDecay:
          absoluteCounterpart = GeneratorTypes.decayVolEnv;
          break;
        case GeneratorTypes.keyNumToVolEnvHold:
          absoluteCounterpart = GeneratorTypes.holdVolEnv;
          break;
        case GeneratorTypes.keyNumToModEnvDecay:
          absoluteCounterpart = GeneratorTypes.decayModEnv;
          break;
        case GeneratorTypes.keyNumToModEnvHold:
          absoluteCounterpart = GeneratorTypes.holdModEnv;
      }
      const absoluteValue = zone.getGenerator(absoluteCounterpart, void 0);
      const dlsRelative = relativeGenerator.value * -128;
      if (absoluteValue === void 0) continue;
      const newAbsolute = absoluteValue - 60 / 128 * dlsRelative;
      zone.setGenerator(relativeGenerator.type, dlsRelative, false);
      zone.setGenerator(absoluteCounterpart, newAbsolute, false);
    }
    for (const generator of zone.generators) ConnectionBlock.fromSFGenerator(generator, this);
    for (const modulator of zone.modulators) ConnectionBlock.fromSFModulator(modulator, this);
  }
  /**
  * Chunk list for the region/instrument (containing lar2 or lart)
  * @param chunks
  */
  read(chunks) {
    const lart = RIFFChunk.findListType(chunks, "lart");
    const lar2 = RIFFChunk.findListType(chunks, "lar2");
    if (lart) {
      this.mode = "dls1";
      while (lart.data.currentIndex < lart.data.length) {
        const chunk = RIFFChunk.read(lart.data);
        if (chunk.header !== "art1" && chunk.header !== "art2") continue;
        const artData = chunk.data;
        const cbSize = readLittleEndianIndexed(artData, 4);
        if (cbSize !== 8) SpessaLog.warn(`CbSize in articulation mismatch. Expected 8, got ${cbSize}`);
        const connectionsAmount = readLittleEndianIndexed(artData, 4);
        for (let i = 0; i < connectionsAmount; i++) this.connectionBlocks.push(ConnectionBlock.read(artData));
      }
    } else if (lar2) {
      this.mode = "dls2";
      while (lar2.data.currentIndex < lar2.data.length) {
        const chunk = RIFFChunk.read(lar2.data);
        if (chunk.header !== "art1" && chunk.header !== "art2") continue;
        const artData = chunk.data;
        const cbSize = readLittleEndianIndexed(artData, 4);
        if (cbSize !== 8) SpessaLog.warn(`CbSize in articulation mismatch. Expected 8, got ${cbSize}`);
        const connectionsAmount = readLittleEndianIndexed(artData, 4);
        for (let i = 0; i < connectionsAmount; i++) this.connectionBlocks.push(ConnectionBlock.read(artData));
      }
    }
  }
  /**
  * Note: this writes "lar2", not just "art2"
  */
  write() {
    const art2Data = new IndexedByteArray(8);
    writeDword(art2Data, 8);
    writeDword(art2Data, this.connectionBlocks.length);
    const out = this.connectionBlocks.map((a) => a.write());
    const art2 = RIFFChunk.getParts(this.mode === "dls2" ? "art2" : "art1", [art2Data, ...out]);
    return RIFFChunk.getParts(this.mode === "dls2" ? "lar2" : "lart", art2, false, true);
  }
  /**
  * Converts DLS articulation into an SF zone.
  * @param zone The zone to write to.
  */
  toSFZone(zone) {
    const applyKeyToCorrection = (value, keyToGen, realGen, dlsDestination) => {
      const keyToGenValue = value / -128;
      zone.setGenerator(keyToGen, keyToGenValue);
      if (keyToGenValue <= 120) {
        const correction = Math.round(60 / 128 * value);
        const realValueConnection = this.connectionBlocks.find((block) => block.isStaticParameter && block.destination === dlsDestination);
        if (realValueConnection) zone.setGenerator(realGen, correction + realValueConnection.shortScale);
      }
    };
    for (const connection of this.connectionBlocks) {
      const amount = connection.shortScale;
      const source = connection.source.source;
      const control = connection.control.source;
      const destination = connection.destination;
      if (connection.isStaticParameter) {
        connection.toSFGenerator(zone);
        continue;
      }
      if (control === DLSSources.none) if (source === DLSSources.keyNum) {
        if (destination === DLSDestinations.pitch) {
          zone.setGenerator(GeneratorTypes.scaleTuning, amount / 128);
          continue;
        }
        if (destination === DLSDestinations.modEnvHold || destination === DLSDestinations.modEnvDecay || destination === DLSDestinations.volEnvHold || destination === DLSDestinations.volEnvDecay) continue;
      } else {
        const specialGen = connection.toCombinedSFDestination();
        if (specialGen) {
          zone.setGenerator(specialGen, amount);
          continue;
        }
      }
      connection.toSFModulator(zone);
    }
    for (const connection of this.connectionBlocks) {
      if (connection.source.source !== DLSSources.keyNum) continue;
      const generatorAmount = connection.shortScale;
      switch (connection.destination) {
        default:
        case DLSDestinations.volEnvHold:
          applyKeyToCorrection(generatorAmount, GeneratorTypes.keyNumToVolEnvHold, GeneratorTypes.holdVolEnv, DLSDestinations.volEnvHold);
          break;
        case DLSDestinations.volEnvDecay:
          applyKeyToCorrection(generatorAmount, GeneratorTypes.keyNumToVolEnvDecay, GeneratorTypes.decayVolEnv, DLSDestinations.volEnvDecay);
          break;
        case DLSDestinations.modEnvHold:
          applyKeyToCorrection(generatorAmount, GeneratorTypes.keyNumToModEnvHold, GeneratorTypes.holdModEnv, DLSDestinations.modEnvHold);
          break;
        case DLSDestinations.modEnvDecay:
          applyKeyToCorrection(generatorAmount, GeneratorTypes.keyNumToModEnvDecay, GeneratorTypes.decayModEnv, DLSDestinations.modEnvDecay);
          break;
      }
    }
    if (this.mode === "dls1") {
      zone.setGenerator(GeneratorTypes.delayVibLFO, zone.getGenerator(GeneratorTypes.delayModLFO, null));
      zone.setGenerator(GeneratorTypes.freqVibLFO, zone.getGenerator(GeneratorTypes.freqModLFO, null));
      zone.setGenerator(GeneratorTypes.vibLfoToPitch, zone.getGenerator(GeneratorTypes.modLfoToPitch, null));
      zone.setGenerator(GeneratorTypes.modLfoToPitch, null);
      for (const mod of zone.modulators) if (mod.destination === GeneratorTypes.modLfoToPitch) mod.destination = GeneratorTypes.vibLfoToPitch;
    }
  }
};
var WaveLink = class WaveLink2 {
  /**
  * Specifies the channel placement of the sample. This is used to place mono sounds within a
  * stereo pair or for multi-track placement. Each bit position within the ulChannel field specifies
  * a channel placement with bit 0 specifying a mono sample or the left channel of a stereo file.
  */
  channel = 1;
  /**
  * Specifies the 0 based index of the cue entry in the wave pool table.
  */
  tableIndex;
  /**
  * Specifies flag options for this wave link. All bits not defined must be set to 0.
  */
  fusOptions = 0;
  /**
  * Specifies a group number for samples which are phase locked. All waves in a set of wave
  * links with the same group are phase locked and follow the wave in the group with the
  * F_WAVELINK_PHASE_MASTER flag set. If a wave is not a member of a phase locked
  * group, this value should be set to 0.
  */
  phaseGroup = 0;
  constructor(tableIndex) {
    this.tableIndex = tableIndex;
  }
  static copyFrom(waveLink) {
    const wlnk = new WaveLink2(waveLink.tableIndex);
    wlnk.channel = waveLink.channel;
    wlnk.phaseGroup = waveLink.phaseGroup;
    wlnk.fusOptions = waveLink.fusOptions;
    return wlnk;
  }
  static read(chunk) {
    const fusOptions = readLittleEndianIndexed(chunk.data, 2);
    const phaseGroup = readLittleEndianIndexed(chunk.data, 2);
    const ulChannel = readLittleEndianIndexed(chunk.data, 4);
    const wlnk = new WaveLink2(readLittleEndianIndexed(chunk.data, 4));
    wlnk.channel = ulChannel;
    wlnk.fusOptions = fusOptions;
    wlnk.phaseGroup = phaseGroup;
    return wlnk;
  }
  static fromSFZone(samples, zone) {
    const index = samples.indexOf(zone.sample);
    if (index === -1) throw new Error(`Wave link error: Sample ${zone.sample.name} does not exist in the sample list.`);
    const waveLink = new WaveLink2(index);
    switch (zone.sample.sampleType) {
      default:
      case SampleTypes.leftSample:
      case SampleTypes.monoSample:
        waveLink.channel = Math.trunc(1);
        break;
      case SampleTypes.rightSample:
        waveLink.channel = 2;
    }
    return waveLink;
  }
  write() {
    const wlnkData = new IndexedByteArray(12);
    writeWord(wlnkData, this.fusOptions);
    writeWord(wlnkData, this.phaseGroup);
    writeDword(wlnkData, this.channel);
    writeDword(wlnkData, this.tableIndex);
    return RIFFChunk.write("wlnk", wlnkData);
  }
};
var DownloadableSoundsRegion = class DownloadableSoundsRegion2 extends DLSVerifier {
  articulation = new DownloadableSoundsArticulation();
  /**
  * Specifies the key range for this region.
  */
  keyRange = {
    min: 0,
    max: 127
  };
  /**
  * Specifies the velocity range for this region.
  */
  velRange = {
    min: 0,
    max: 127
  };
  /**
  * Specifies the key group for a drum instrument. Key group values allow multiple regions
  * within a drum instrument to belong to the same "key group." If a synthesis engine is
  * instructed to play a note with a key group setting and any other notes are currently playing
  * with this same key group, then the synthesis engine should turn off all notes with the same
  * key group value as soon as possible.
  */
  keyGroup = 0;
  /**
  * Specifies flag options for the synthesis of this region.
  */
  fusOptions = 0;
  /**
  * Indicates the layer of this region for editing purposes. This field facilitates the
  * organization of overlapping regions into layers for display to the user of a DLS sound editor.
  * For example, if a piano sound and a string section are overlapped to create a piano/string pad,
  * all the regions of the piano might be labeled as layer 1, and all the regions of the string
  * section might be labeled as layer 2
  */
  usLayer = 0;
  waveSample;
  waveLink;
  constructor(waveLink, waveSample) {
    super();
    this.waveSample = waveSample;
    this.waveLink = waveLink;
  }
  static copyFrom(inputRegion) {
    const outputRegion = new DownloadableSoundsRegion2(WaveLink.copyFrom(inputRegion.waveLink), WaveSample.copyFrom(inputRegion.waveSample));
    outputRegion.keyGroup = inputRegion.keyGroup;
    outputRegion.keyRange = { ...inputRegion.keyRange };
    outputRegion.velRange = { ...inputRegion.velRange };
    outputRegion.usLayer = inputRegion.usLayer;
    outputRegion.fusOptions = inputRegion.fusOptions;
    outputRegion.articulation.copyFrom(inputRegion.articulation);
    return outputRegion;
  }
  static read(samples, chunk) {
    const regionChunks = this.verifyAndReadList(chunk, "rgn ", "rgn2");
    const waveSampleChunk = regionChunks.find((c) => c.header === "wsmp");
    let waveSample = waveSampleChunk ? WaveSample.read(waveSampleChunk) : void 0;
    const waveLinkChunk = regionChunks.find((c) => c.header === "wlnk");
    if (!waveLinkChunk) {
      SpessaLog.warn("Invalid DLS region: missing 'wlnk' chunk! Discarding...");
      return;
    }
    const waveLink = WaveLink.read(waveLinkChunk);
    const regionHeader = regionChunks.find((c) => c.header === "rgnh");
    if (!regionHeader) {
      SpessaLog.warn("Invalid DLS region: missing 'rgnh' chunk! Discarding...");
      return;
    }
    const sample = samples[waveLink.tableIndex];
    if (!sample) DownloadableSoundsRegion2.parsingError(`Invalid sample index: ${waveLink.tableIndex}. Samples available: ${samples.length}`);
    waveSample ??= sample.waveSample;
    const region = new DownloadableSoundsRegion2(waveLink, waveSample);
    const keyMin = readLittleEndianIndexed(regionHeader.data, 2);
    const keyMax = readLittleEndianIndexed(regionHeader.data, 2);
    let velMin = readLittleEndianIndexed(regionHeader.data, 2);
    let velMax = readLittleEndianIndexed(regionHeader.data, 2);
    if (velMin === 0 && velMax === 0) {
      velMax = 127;
      velMin = 0;
    }
    region.keyRange.max = keyMax;
    region.keyRange.min = keyMin;
    region.velRange.max = velMax;
    region.velRange.min = velMin;
    region.fusOptions = readLittleEndianIndexed(regionHeader.data, 2);
    region.keyGroup = readLittleEndianIndexed(regionHeader.data, 2);
    if (regionHeader.data.length - regionHeader.data.currentIndex >= 2) region.usLayer = readLittleEndianIndexed(regionHeader.data, 2);
    region.articulation.read(regionChunks);
    return region;
  }
  static fromSFZone(zone, samples) {
    const waveSample = WaveSample.fromSFZone(zone);
    const region = new DownloadableSoundsRegion2(WaveLink.fromSFZone(samples, zone), waveSample);
    region.keyRange.min = Math.max(zone.keyRange.min, 0);
    region.keyRange.max = zone.keyRange.max;
    region.velRange.min = Math.max(zone.velRange.min, 0);
    region.velRange.max = zone.velRange.max;
    region.keyGroup = zone.getGenerator(GeneratorTypes.exclusiveClass, 0);
    region.articulation.fromSFZone(zone);
    return region;
  }
  write() {
    const chunks = [
      this.writeHeader(),
      this.waveSample.write(),
      this.waveLink.write(),
      ...this.articulation.write()
    ];
    return RIFFChunk.getParts("rgn2", chunks, false, true);
  }
  toSFZone(instrument, samples) {
    const sample = samples[this.waveLink.tableIndex];
    if (!sample) DownloadableSoundsRegion2.parsingError(`Invalid sample index: ${this.waveLink.tableIndex}`);
    const zone = instrument.createZone(sample);
    zone.keyRange = this.keyRange;
    zone.velRange = this.velRange;
    if (this.keyRange.max === 127 && this.keyRange.min === 0) zone.keyRange.min = -1;
    if (this.velRange.max === 127 && this.velRange.min === 0) zone.velRange.min = -1;
    if (this.keyGroup !== 0) zone.setGenerator(GeneratorTypes.exclusiveClass, this.keyGroup);
    this.waveSample.toSFZone(zone, sample);
    this.articulation.toSFZone(zone);
    zone.generators = zone.generators.filter((g) => g.value !== GeneratorLimits[g.type].def);
    return zone;
  }
  writeHeader() {
    const rgnhData = new IndexedByteArray(14);
    writeWord(rgnhData, Math.max(this.keyRange.min, 0));
    writeWord(rgnhData, this.keyRange.max);
    writeWord(rgnhData, Math.max(this.velRange.min, 0));
    writeWord(rgnhData, this.velRange.max);
    writeWord(rgnhData, this.fusOptions);
    writeWord(rgnhData, this.keyGroup);
    writeWord(rgnhData, this.usLayer);
    return RIFFChunk.write("rgnh", rgnhData);
  }
};
var DownloadableSoundsInstrument = class DownloadableSoundsInstrument2 extends DLSVerifier {
  articulation = new DownloadableSoundsArticulation();
  regions = new Array();
  name = "Unnamed";
  bankLSB = 0;
  bankMSB = 0;
  isGMGSDrum = false;
  program = 0;
  static copyFrom(inputInstrument) {
    const outputInstrument = new DownloadableSoundsInstrument2();
    outputInstrument.name = inputInstrument.name;
    outputInstrument.isGMGSDrum = inputInstrument.isGMGSDrum;
    outputInstrument.bankMSB = inputInstrument.bankMSB;
    outputInstrument.bankLSB = inputInstrument.bankLSB;
    outputInstrument.program = inputInstrument.program;
    outputInstrument.articulation.copyFrom(inputInstrument.articulation);
    for (const region of inputInstrument.regions) outputInstrument.regions.push(DownloadableSoundsRegion.copyFrom(region));
    return outputInstrument;
  }
  static read(samples, chunk) {
    const chunks = this.verifyAndReadList(chunk, "ins ");
    const instrumentHeader = chunks.find((c) => c.header === "insh");
    if (!instrumentHeader) {
      SpessaLog.groupEnd();
      throw new Error("No instrument header!");
    }
    let instrumentName = ``;
    const infoChunk = RIFFChunk.findListType(chunks, "INFO");
    if (infoChunk) {
      let info = RIFFChunk.read(infoChunk.data);
      while (info.header !== "INAM") info = RIFFChunk.read(infoChunk.data);
      instrumentName = readBinaryStringIndexed(info.data, info.data.length).trim();
    }
    if (instrumentName.length === 0) instrumentName = `Unnamed Instrument`;
    const instrument = new DownloadableSoundsInstrument2();
    instrument.name = instrumentName;
    const regions = readLittleEndianIndexed(instrumentHeader.data, 4);
    const ulBank = readLittleEndianIndexed(instrumentHeader.data, 4);
    instrument.program = readLittleEndianIndexed(instrumentHeader.data, 4) & 127;
    instrument.bankMSB = ulBank >>> 8 & 127;
    instrument.bankLSB = ulBank & 127;
    instrument.isGMGSDrum = ulBank >>> 31 > 0;
    SpessaLog.groupCollapsed(`%cParsing %c"${instrumentName}"%c...`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
    const regionListChunk = RIFFChunk.findListType(chunks, "lrgn");
    if (!regionListChunk) {
      SpessaLog.groupEnd();
      throw new Error("No region list!");
    }
    instrument.articulation.read(chunks);
    for (let i = 0; i < regions; i++) {
      const chunk2 = RIFFChunk.read(regionListChunk.data);
      this.verifyHeader(chunk2, "LIST");
      const type = readBinaryStringIndexed(chunk2.data, 4);
      if (type !== "rgn " && type !== "rgn2") {
        SpessaLog.groupEnd();
        this.parsingError(`Invalid DLS region! Expected "rgn " or "rgn2" got "${type}"`);
      }
      const region = DownloadableSoundsRegion.read(samples, chunk2);
      if (region) instrument.regions.push(region);
    }
    SpessaLog.groupEnd();
    return instrument;
  }
  static fromSFPreset(preset, samples) {
    const instrument = new DownloadableSoundsInstrument2();
    instrument.name = preset.name;
    instrument.bankLSB = preset.bankLSB;
    instrument.bankMSB = preset.bankMSB;
    instrument.program = preset.program;
    instrument.isGMGSDrum = preset.isGMGSDrum;
    SpessaLog.group(`%cConverting %c${preset.toString()}%c to DLS...`, ConsoleColors.info, ConsoleColors.value, ConsoleColors.info);
    const inst = preset.toFlattenedInstrument();
    for (const z of inst.zones) instrument.regions.push(DownloadableSoundsRegion.fromSFZone(z, samples));
    SpessaLog.groupEnd();
    return instrument;
  }
  write() {
    SpessaLog.groupCollapsed(`%cWriting %c${this.name}%c...`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
    const chunks = [this.writeHeader()];
    const regionChunks = this.regions.flatMap((r) => r.write());
    chunks.push(...RIFFChunk.getParts("lrgn", regionChunks, false, true));
    if (this.articulation.length > 0) chunks.push(...this.articulation.write());
    const inam = RIFFChunk.write("INAM", getStringBytes(this.name, true));
    chunks.push(RIFFChunk.write("INFO", inam, false, true));
    SpessaLog.groupEnd();
    return RIFFChunk.writeParts("ins ", chunks, false, true);
  }
  /**
  * Performs the full DLS to SF2 instrument conversion.
  */
  toSFPreset(soundBank) {
    const preset = new BasicPreset(soundBank);
    preset.name = this.name;
    preset.bankMSB = this.bankMSB;
    preset.bankLSB = this.bankLSB;
    preset.isGMGSDrum = this.isGMGSDrum;
    preset.program = this.program;
    const instrument = new BasicInstrument();
    instrument.name = this.name;
    preset.createZone(instrument);
    this.articulation.toSFZone(instrument.globalZone);
    for (const region of this.regions) region.toSFZone(instrument, soundBank.samples);
    instrument.globalize();
    if (!instrument.globalZone.modulators.some((m) => m.destination === GeneratorTypes.reverbEffectsSend)) instrument.globalZone.addModulators(Modulator.copyFrom(DEFAULT_DLS_REVERB));
    if (!instrument.globalZone.modulators.some((m) => m.destination === GeneratorTypes.chorusEffectsSend)) instrument.globalZone.addModulators(Modulator.copyFrom(DEFAULT_DLS_CHORUS));
    instrument.globalZone.generators = instrument.globalZone.generators.filter((g) => g.value !== GeneratorLimits[g.type].def);
    soundBank.addPresets(preset);
    soundBank.addInstruments(instrument);
  }
  writeHeader() {
    const inshData = new IndexedByteArray(12);
    writeDword(inshData, this.regions.length);
    let ulBank = (this.bankMSB & 127) << 8 | this.bankLSB & 127;
    if (this.isGMGSDrum) ulBank |= 1 << 31;
    writeDword(inshData, ulBank);
    writeDword(inshData, this.program & 127);
    return RIFFChunk.write("insh", inshData);
  }
};
var DEFAULT_DLS_OPTIONS = { software: "SpessaSynth" };
var DownloadableSounds = class DownloadableSounds2 extends DLSVerifier {
  samples = new Array();
  instruments = new Array();
  soundBankInfo = {
    name: "Unnamed DLS sound bank",
    creationDate: /* @__PURE__ */ new Date(),
    software: "SpessaSynth",
    soundEngine: "DLS Level 2.2",
    product: "SpessaSynth DLS",
    version: {
      major: 2,
      minor: 4
    }
  };
  static read(buffer) {
    if (!buffer) throw new Error("No data provided!");
    const dataArray = new IndexedByteArray(buffer);
    SpessaLog.group("%cParsing DLS file...", ConsoleColors.info);
    const firstChunk = RIFFChunk.read(dataArray, false, false);
    this.verifyHeader(firstChunk, "RIFF");
    this.verifyText(readBinaryStringIndexed(dataArray, 4).toLowerCase(), "dls ");
    const chunks = [];
    while (dataArray.currentIndex < dataArray.length) chunks.push(RIFFChunk.read(dataArray));
    const dls = new DownloadableSounds2();
    const infoChunk = RIFFChunk.findListType(chunks, "INFO");
    if (infoChunk) while (infoChunk.data.currentIndex < infoChunk.data.length) {
      const infoPart = RIFFChunk.read(infoChunk.data);
      const headerTyped = infoPart.header;
      const text = readBinaryStringIndexed(infoPart.data, infoPart.size);
      switch (headerTyped) {
        case "INAM":
          dls.soundBankInfo.name = text;
          break;
        case "ICRD":
          dls.soundBankInfo.creationDate = parseDateString(text);
          break;
        case "ICMT":
          dls.soundBankInfo.comment = text;
          break;
        case "ISBJ":
          dls.soundBankInfo.subject = text;
          break;
        case "ICOP":
          dls.soundBankInfo.copyright = text;
          break;
        case "IENG":
          dls.soundBankInfo.engineer = text;
          break;
        case "IPRD":
          dls.soundBankInfo.product = text;
          break;
        case "ISFT":
          dls.soundBankInfo.software = text;
      }
    }
    this.printInfo(dls);
    const colhChunk = chunks.find((c) => c.header === "colh");
    if (!colhChunk) {
      this.parsingError("No colh chunk!");
      return 5;
    }
    const instrumentAmount = readLittleEndianIndexed(colhChunk.data, 4);
    SpessaLog.info(`%cInstruments amount: %c${instrumentAmount}`, ConsoleColors.info, ConsoleColors.recognized);
    const waveListChunk = RIFFChunk.findListType(chunks, "wvpl");
    if (!waveListChunk) {
      this.parsingError("No wvpl chunk!");
      return 5;
    }
    const waveList = this.verifyAndReadList(waveListChunk, "wvpl");
    for (const wave of waveList) dls.samples.push(DownloadableSoundsSample.read(wave));
    const instrumentListChunk = RIFFChunk.findListType(chunks, "lins");
    if (!instrumentListChunk) {
      this.parsingError("No lins chunk!");
      return 5;
    }
    const instruments = this.verifyAndReadList(instrumentListChunk, "lins");
    SpessaLog.groupCollapsed("%cLoading instruments...", ConsoleColors.info);
    if (instruments.length !== instrumentAmount) SpessaLog.warn(`Colh reported invalid amount of instruments. Detected ${instruments.length}, expected ${instrumentAmount}`);
    for (const ins of instruments) dls.instruments.push(DownloadableSoundsInstrument.read(dls.samples, ins));
    SpessaLog.groupEnd();
    const aliasingChunk = chunks.find((c) => c.header === "pgal");
    if (aliasingChunk) {
      SpessaLog.info("%cFound the instrument aliasing chunk!", ConsoleColors.recognized);
      const pgalData = aliasingChunk.data;
      if (pgalData[0] !== 0 || pgalData[1] !== 1 || pgalData[2] !== 2 || pgalData[3] !== 3) pgalData.currentIndex += 4;
      const drumInstrument = dls.instruments.find((i) => BankSelectHacks.isXGDrum(i.bankMSB) || i.isGMGSDrum);
      if (!drumInstrument) {
        SpessaLog.warn("MobileBAE aliasing chunk without a drum preset. Aborting!");
        return dls;
      }
      const drumAliases = pgalData.slice(pgalData.currentIndex, pgalData.currentIndex + 128);
      pgalData.currentIndex += 128;
      for (let keyNum = 0; keyNum < 128; keyNum++) {
        const source = drumAliases[keyNum];
        if (source === keyNum) continue;
        const region = drumInstrument.regions.find((r) => r.keyRange.max === source && r.keyRange.min === source);
        if (!region) {
          SpessaLog.warn(`Invalid drum alias ${keyNum} to ${source}: region does not exist.`);
          continue;
        }
        const copied = DownloadableSoundsRegion.copyFrom(region);
        copied.keyRange.max = keyNum;
        copied.keyRange.min = keyNum;
        const fixedKeyBlock = new ConnectionBlock(new ConnectionSource(DLSSources.none, 0, false, false), new ConnectionSource(DLSSources.none, 0, false, false), DLSDestinations.keyNum, 0, source << 16);
        copied.articulation.connectionBlocks.push(fixedKeyBlock);
        drumInstrument.regions.push(copied);
      }
      pgalData.currentIndex += 4;
      while (pgalData.currentIndex < pgalData.length) {
        const aliasBankNum = readLittleEndianIndexed(pgalData, 2);
        const aliasBankLSB = aliasBankNum & 127;
        const aliasBankMSB = aliasBankNum >> 7 & 127;
        const aliasProgram = pgalData[pgalData.currentIndex++];
        let nullByte = pgalData[pgalData.currentIndex++];
        if (nullByte !== 0) SpessaLog.warn(`Invalid alias byte. Expected 0, got ${nullByte}`);
        const inputBankNum = readLittleEndianIndexed(pgalData, 2);
        const inputBankLSB = inputBankNum & 127;
        const inputBankMSB = inputBankNum >> 7 & 127;
        const inputProgram = pgalData[pgalData.currentIndex++];
        nullByte = pgalData[pgalData.currentIndex++];
        if (nullByte !== 0) SpessaLog.warn(`Invalid alias header. Expected 0, got ${nullByte}`);
        const inputInstrument = dls.instruments.find((inst) => inst.bankLSB === inputBankLSB && inst.bankMSB === inputBankMSB && inst.program === inputProgram && !inst.isGMGSDrum);
        if (!inputInstrument) {
          SpessaLog.warn(`Invalid alias. Missing instrument: ${inputBankLSB}:${inputBankMSB}:${inputProgram}`);
          continue;
        }
        const alias = DownloadableSoundsInstrument.copyFrom(inputInstrument);
        alias.bankMSB = aliasBankMSB;
        alias.bankLSB = aliasBankLSB;
        alias.program = aliasProgram;
        dls.instruments.push(alias);
      }
    }
    SpessaLog.info(`%cParsing finished! %c"${dls.soundBankInfo.name || "UNNAMED"}"%c has %c${dls.instruments.length}%c instruments and %c${dls.samples.length}%c samples.`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
    SpessaLog.groupEnd();
    return dls;
  }
  /**
  * Performs a full conversion from BasicSoundBank to DownloadableSounds.
  * Includes an optional progress function for transforming the samples.
  */
  static fromSF(bank, progressFunc) {
    SpessaLog.groupCollapsed("%cSaving SF2 to DLS level 2...", ConsoleColors.info);
    const dls = new DownloadableSounds2();
    dls.soundBankInfo = { ...bank.soundBankInfo };
    for (let i = 0; i < bank.samples.length; i++) {
      const s = bank.samples[i];
      dls.samples.push(DownloadableSoundsSample.fromSFSample(s));
      progressFunc?.(i / bank.samples.length);
    }
    for (const p of bank.presets) dls.instruments.push(DownloadableSoundsInstrument.fromSFPreset(p, bank.samples));
    SpessaLog.info("%cConversion complete!", ConsoleColors.recognized);
    SpessaLog.groupEnd();
    return dls;
  }
  static printInfo(dls) {
    for (const [info, value] of Object.entries(dls.soundBankInfo)) if (typeof value === "object" && "major" in value) {
      const v = value;
      SpessaLog.info(`%c${info}: %c"${v.major}.${v.minor}"`, ConsoleColors.info, ConsoleColors.recognized);
    } else SpessaLog.info(`%c${info}: %c${value.toLocaleString()}`, ConsoleColors.info, ConsoleColors.recognized);
  }
  /**
  * Writes a DLS file.
  * @param writeOptions the options for writing the file.
  */
  write(writeOptions = DEFAULT_DLS_OPTIONS) {
    const options = fillWithDefaults(writeOptions, DEFAULT_DLS_OPTIONS);
    SpessaLog.groupCollapsed("%cSaving DLS...", ConsoleColors.info);
    const colhNum = new IndexedByteArray(4);
    writeDword(colhNum, this.instruments.length);
    const colh = RIFFChunk.write("colh", colhNum);
    SpessaLog.groupCollapsed("%cWriting instruments...", ConsoleColors.info);
    const lins = RIFFChunk.getParts("lins", this.instruments.map((i) => i.write()), false, true);
    SpessaLog.info("%cSuccess!", ConsoleColors.recognized);
    SpessaLog.groupEnd();
    SpessaLog.groupCollapsed("%cWriting WAVE samples...", ConsoleColors.info);
    let currentIndex = 0;
    const ptblOffsets = [];
    const samples = [];
    let written = 0;
    for (const s of this.samples) {
      const out2 = s.write();
      options.progressFunction?.(written / this.samples.length);
      SpessaLog.info(`%cWrote sample %c${written}. ${s.name}%c of %c${this.samples.length}.`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized);
      ptblOffsets.push(currentIndex);
      currentIndex += out2.reduce((sum, cur) => sum + cur.length, 0);
      samples.push(...out2);
      written++;
    }
    const wvpl = RIFFChunk.getParts("wvpl", samples, false, true);
    SpessaLog.info("%cSucceeded!", ConsoleColors.recognized);
    const ptblData = new IndexedByteArray(8 + 4 * ptblOffsets.length);
    writeDword(ptblData, 8);
    writeDword(ptblData, ptblOffsets.length);
    for (const offset of ptblOffsets) writeDword(ptblData, offset);
    const ptbl = RIFFChunk.write("ptbl", ptblData);
    this.soundBankInfo.software = options.software;
    const infos = [];
    const info = this.soundBankInfo;
    const writeDLSInfo = (type, data) => {
      if (!data) return;
      infos.push(...RIFFChunk.getParts(type, [getStringBytes(data, true)]));
    };
    writeDLSInfo("INAM", info.name);
    writeDLSInfo("ICMT", info.comment);
    writeDLSInfo("ICOP", info.copyright);
    writeDLSInfo("ICRD", toISODateString(info.creationDate));
    writeDLSInfo("IENG", info.engineer);
    writeDLSInfo("IPRD", info.product);
    writeDLSInfo("ISFT", options.software);
    writeDLSInfo("ISBJ", info.subject);
    SpessaLog.info("%cCombining everything...");
    const out = RIFFChunk.writeParts("RIFF", [
      getStringBytes("DLS "),
      colh,
      ...lins,
      ptbl,
      ...wvpl,
      ...RIFFChunk.getParts("INFO", infos, false, true)
    ]);
    SpessaLog.info("%cSaved successfully!", ConsoleColors.recognized);
    SpessaLog.groupEnd();
    return out.buffer;
  }
  /**
  * Performs a full conversion from DownloadableSounds to BasicSoundBank.
  */
  toSF() {
    SpessaLog.group("%cConverting DLS to SF2...", ConsoleColors.info);
    const soundBank = new BasicSoundBank("dls");
    soundBank.soundBankInfo.version.minor = 4;
    soundBank.soundBankInfo.version.major = 2;
    soundBank.soundBankInfo = { ...this.soundBankInfo };
    for (const sample of this.samples) sample.toSFSample(soundBank);
    for (const instrument of this.instruments) instrument.toSFPreset(soundBank);
    soundBank.flush();
    SpessaLog.info("%cConversion complete!", ConsoleColors.recognized);
    SpessaLog.groupEnd();
    return soundBank;
  }
};
var BasicSoundBank = class BasicSoundBank2 {
  /**
  * Indicates if the SF3/SF2Pack decoder is ready.
  */
  static isSF3DecoderReady = L.ready;
  /**
  * The type of the sound bank that was loaded.
  * Either `sf2` for SoundFont2/SoundFont3 or `dls` for DownLoadable Sounds or `sfe` for SF-Enhanced.
  *
  * Please note that SF3 or SFOGG files are parsed as `sf2` files, but with compressed samples.
  * The type is still `sf2`.
  */
  type;
  /**
  * Sound bank's info.
  */
  soundBankInfo = {
    name: "Unnamed",
    creationDate: /* @__PURE__ */ new Date(),
    software: "SpessaSynth",
    soundEngine: "E-mu 10K2",
    version: {
      major: 2,
      minor: 4
    }
  };
  /**
  * The sound bank's presets.
  */
  presets = [];
  /**
  * The sound bank's samples.
  */
  samples = [];
  /**
  * The sound bank's instruments.
  */
  instruments = [];
  /**
  * Sound bank's default modulators.
  */
  defaultModulators = SPESSASYNTH_DEFAULT_MODULATORS.map(Modulator.copyFrom.bind(Modulator));
  /**
  * If the sound bank has custom default modulators (DMOD).
  */
  customDefaultModulators = false;
  constructor(type = "sf2") {
    this.type = type;
  }
  _isXGBank = false;
  /**
  * Checks for XG drum sets and considers if this sound bank is XG.
  */
  get isXGBank() {
    return this._isXGBank;
  }
  /**
  * Merges sound banks with the given order. Keep in mind that the info read is copied from the first one
  * @param soundBanks the sound banks to merge, the first overwrites the last
  */
  static mergeSoundBanks(...soundBanks) {
    const mainSf = soundBanks.shift();
    if (!mainSf) throw new Error("No sound banks provided!");
    const presets = mainSf.presets;
    while (soundBanks.length > 0) {
      const newPresets = soundBanks?.shift()?.presets;
      if (newPresets) {
        for (const newPreset of newPresets) if (!presets.some((existingPreset) => newPreset.matches(existingPreset))) presets.push(newPreset);
      }
    }
    const b = new BasicSoundBank2();
    b.addCompletePresets(presets);
    b.soundBankInfo = { ...mainSf.soundBankInfo };
    return b;
  }
  /**
  * Creates a simple sound bank with one saw wave preset.
  */
  static getSampleSoundBankFile() {
    const font = new BasicSoundBank2();
    const sampleData = new Float32Array(128);
    for (let i = 0; i < 128; i++) sampleData[i] = i / 128 * 2 - 1;
    const sample = new EmptySample();
    sample.name = "Saw";
    sample.originalKey = 65;
    sample.pitchCorrection = 20;
    sample.loopEnd = 128;
    sample.setAudioData(sampleData, 44100);
    font.addSamples(sample);
    const inst = new BasicInstrument();
    inst.name = "Saw Wave";
    inst.globalZone.addGenerators(new Generator(GeneratorTypes.initialAttenuation, 375), new Generator(GeneratorTypes.releaseVolEnv, -1e3), new Generator(GeneratorTypes.sampleModes, 1));
    inst.createZone(sample);
    inst.createZone(sample).setGenerator(GeneratorTypes.fineTune, -9);
    font.addInstruments(inst);
    const preset = new BasicPreset(font);
    preset.name = "Saw Wave";
    preset.createZone(inst);
    font.addPresets(preset);
    font.soundBankInfo.name = "SpessaSynth Sample Sound Bank";
    font.flush();
    return font.writeSF2();
  }
  /**
  * Copies a given sound bank.
  * @param bank The sound bank to copy.
  */
  static copyFrom(bank) {
    const copied = new BasicSoundBank2();
    for (const p of bank.presets) copied.clonePreset(p);
    copied.soundBankInfo = { ...bank.soundBankInfo };
    return copied;
  }
  /**
  * Adds complete presets along with their instruments and samples.
  * @param presets The presets to add.
  */
  addCompletePresets(presets) {
    this.addPresets(...presets);
    const instrumentList = [];
    for (const preset of presets) for (const zone of preset.zones) if (zone.instrument && !instrumentList.includes(zone.instrument)) instrumentList.push(zone.instrument);
    this.addInstruments(...instrumentList);
    const sampleList = [];
    for (const instrument of instrumentList) for (const zone of instrument.zones) if (zone.sample && !sampleList.includes(zone.sample)) sampleList.push(zone.sample);
    this.addSamples(...sampleList);
  }
  /**
  * Sets the sound bank's sample format _in place_.
  * @param options options for writing the file.
  */
  async setSampleFormat(options) {
    let writtenCount = 0;
    const format = options.format;
    const progressFunc = options.progressFunction;
    for (const s of this.samples) {
      switch (format) {
        default:
        case "pcm":
          s.setAudioData(s.getAudioData(), s.sampleRate);
          break;
        case "compressed": {
          const f = options.compressionFunction;
          if (!f) throw new Error(`No compression function supplied but '${format}' was requested.`);
          await s.compressSample(f);
        }
      }
      writtenCount++;
      progressFunc?.(writtenCount / this.samples.length);
      SpessaLog.info(`%cEncoded sample %c${writtenCount}. ${s.name}%c of %c${this.samples.length}%c. Compressed: %c${s.isCompressed}%c.`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, s.isCompressed ? ConsoleColors.recognized : ConsoleColors.unrecognized, ConsoleColors.info);
    }
    switch (format) {
      default:
      case "pcm":
        this.soundBankInfo.version.major = 2;
        this.soundBankInfo.version.minor = 4;
        break;
      case "compressed":
        this.soundBankInfo.version.major = 3;
        this.soundBankInfo.version.minor = 0;
    }
  }
  /**
  * Write the sound bank as a .dls file. This may not be 100% accurate.
  * Note that samples are always written in the s16le PCM encoding.
  * @param options options for writing the file.
  * @returns the binary file.
  */
  writeDLS(options = DEFAULT_DLS_OPTIONS) {
    const pFunc = options.progressFunction;
    return DownloadableSounds.fromSF(this, pFunc ? (p) => pFunc(p / 2) : void 0).write({
      ...options,
      progressFunction: pFunc ? (p) => pFunc(0.5 + p / 2) : void 0
    });
  }
  /**
  * Writes the sound bank as an SF2 file.
  * @param writeOptions the options for writing.
  * @returns the binary file data.
  */
  writeSF2(writeOptions = DEFAULT_SF2_WRITE_OPTIONS) {
    return writeSF2Internal(this, writeOptions);
  }
  /**
  * Writes the sound bank as an [SFE 4](https://sfe-team-was-taken.github.io/SFE/) file.
  * This enables features such as bank LSB and RIFF64.
  * Note that spessasynth is currently the only software that can read these files.
  * @param writeOptions the options for writing.
  * @returns the binary file data.
  */
  writeSFE(writeOptions = DEFAULT_SFE_WRITE_OPTIONS) {
    return writeSFEInternal(this, writeOptions);
  }
  addPresets(...presets) {
    this.presets.push(...presets);
  }
  addInstruments(...instruments) {
    this.instruments.push(...instruments);
  }
  addSamples(...samples) {
    this.samples.push(...samples);
  }
  /**
  * Clones a sample into this bank.
  * @param sample The sample to copy.
  * @returns the copied sample, if a sample exists with that name, it is returned instead
  */
  cloneSample(sample) {
    const duplicate = this.samples.find((s) => s.name === sample.name);
    if (duplicate) return duplicate;
    const newSample = new BasicSample(sample.name, sample.sampleRate, sample.originalKey, sample.pitchCorrection, sample.sampleType, sample.loopStart, sample.loopEnd);
    if (sample.isCompressed) newSample.setCompressedData(sample.getRawData(true));
    else newSample.setAudioData(sample.getAudioData(), sample.sampleRate);
    this.addSamples(newSample);
    if (sample.linkedSample) {
      const clonedLinked = this.cloneSample(sample.linkedSample);
      if (!clonedLinked.linkedSample) newSample.setLinkedSample(clonedLinked, newSample.sampleType);
    }
    return newSample;
  }
  /**
  * Recursively clones an instrument into this sound bank, as well as its samples.
  * @returns the copied instrument, if an instrument exists with that name, it is returned instead.
  */
  cloneInstrument(instrument) {
    const duplicate = this.instruments.find((i) => i.name === instrument.name);
    if (duplicate) return duplicate;
    const newInstrument = new BasicInstrument();
    newInstrument.name = instrument.name;
    newInstrument.globalZone.copyFrom(instrument.globalZone);
    for (const zone of instrument.zones) newInstrument.createZone(this.cloneSample(zone.sample)).copyFrom(zone);
    this.addInstruments(newInstrument);
    return newInstrument;
  }
  /**
  * Recursively clones a preset into this sound bank, as well as its instruments and samples.
  * @returns the copied preset, if a preset exists with that name, it is returned instead.
  */
  clonePreset(preset) {
    const duplicate = this.presets.find((p) => p.name === preset.name);
    if (duplicate) return duplicate;
    const newPreset = new BasicPreset(this);
    newPreset.name = preset.name;
    newPreset.bankMSB = preset.bankMSB;
    newPreset.bankLSB = preset.bankLSB;
    newPreset.isGMGSDrum = preset.isGMGSDrum;
    newPreset.program = preset.program;
    newPreset.library = preset.library;
    newPreset.genre = preset.genre;
    newPreset.morphology = preset.morphology;
    newPreset.globalZone.copyFrom(preset.globalZone);
    for (const zone of preset.zones) newPreset.createZone(this.cloneInstrument(zone.instrument)).copyFrom(zone);
    this.addPresets(newPreset);
    return newPreset;
  }
  /**
  * Updates internal values.
  */
  flush() {
    this.presets.sort(MIDIPatchTools.compare.bind(MIDIPatchTools));
    this.parseInternal();
  }
  /**
  * Trims the sound bank _in-place_ to only contain samples in a given MIDI file.
  * @param presetData - A `Map`: `BasicPreset` -> `Set<"key-velocity">`.
  * Absent presets will be removed from the sound bank,
  * and samples that don't get activated in the remaining presets will be removed as well.
  */
  trim(presetData) {
    const trimInstrumentZones = (instrument, keyCombos) => {
      let trimmedIZones = 0;
      for (let iZoneIndex = 0; iZoneIndex < instrument.zones.length; iZoneIndex++) {
        const iZone = instrument.zones[iZoneIndex];
        const iKeyRange = iZone.keyRange;
        const iVelRange = iZone.velRange;
        let isIZoneUsed = false;
        for (const [key, velocities] of keyCombos) if (key >= iKeyRange.min && key <= iKeyRange.max && [...velocities].some((velocity) => velocity >= iVelRange.min && velocity <= iVelRange.max)) {
          isIZoneUsed = true;
          break;
        }
        if (!isIZoneUsed) {
          SpessaLog.info(`%c${iZone.sample.name}%c removed from %c${instrument.name}%c.`, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
          if (instrument.deleteZone(iZoneIndex)) {
            trimmedIZones++;
            iZoneIndex--;
            SpessaLog.info(`%c${iZone.sample.name}%c deleted`, ConsoleColors.recognized, ConsoleColors.info);
          }
          if (iZone.sample.useCount < 1) this.deleteSample(iZone.sample);
        }
      }
      return trimmedIZones;
    };
    SpessaLog.groupCollapsed("%cTrimming sound bank...", ConsoleColors.info);
    SpessaLog.info("Combinations to trim for:", presetData);
    for (let presetIndex = 0; presetIndex < this.presets.length; presetIndex++) {
      const p = this.presets[presetIndex];
      const keyCombos = presetData.get(p);
      if (keyCombos === void 0) {
        SpessaLog.info(`%cDeleting preset %c${p.name}%c and its zones`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
        this.deletePreset(p);
        presetIndex--;
      } else {
        SpessaLog.groupCollapsed(`%cTrimming %c${p.name}`, ConsoleColors.info, ConsoleColors.recognized);
        SpessaLog.info(`Keys for ${p.name}:`, keyCombos);
        let trimmedZones = 0;
        for (let zoneIndex = 0; zoneIndex < p.zones.length; zoneIndex++) {
          const zone = p.zones[zoneIndex];
          const keyRange = zone.keyRange;
          const velRange = zone.velRange;
          let isZoneUsed = false;
          for (const [key, velocities] of keyCombos) if (key >= keyRange.min && key <= keyRange.max && [...velocities].some((velocity) => velocity >= velRange.min && velocity <= velRange.max)) {
            isZoneUsed = true;
            const trimmedIZones = trimInstrumentZones(zone.instrument, keyCombos);
            SpessaLog.info(`%cTrimmed off %c${trimmedIZones}%c instrument zones from %c${zone.instrument.name}`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized);
            break;
          }
          if (!isZoneUsed) {
            trimmedZones++;
            p.deleteZone(zoneIndex);
            if (zone.instrument.useCount < 1) this.deleteInstrument(zone.instrument);
            zoneIndex--;
          }
        }
        SpessaLog.info(`%cTrimmed off %c${trimmedZones}%c preset zones from %c${p.name}`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized);
        SpessaLog.groupEnd();
      }
    }
    this.removeUnusedElements();
    SpessaLog.info("%cSound bank modified!", ConsoleColors.recognized);
    SpessaLog.groupEnd();
  }
  removeUnusedElements() {
    this.instruments = this.instruments.filter((i) => {
      i.deleteUnusedZones();
      const deletable = i.useCount < 1;
      if (deletable) i.delete();
      return !deletable;
    });
    this.samples = this.samples.filter((s) => {
      const deletable = s.useCount < 1;
      if (deletable) s.unlinkSample();
      return !deletable;
    });
  }
  deleteInstrument(instrument) {
    instrument.delete();
    this.instruments.splice(this.instruments.indexOf(instrument), 1);
  }
  deletePreset(preset) {
    preset.delete();
    this.presets.splice(this.presets.indexOf(preset), 1);
  }
  deleteSample(sample) {
    sample.unlinkSample();
    this.samples.splice(this.samples.indexOf(sample), 1);
  }
  /**
  * Get the appropriate preset.
  */
  getPreset(patch, system) {
    return MIDIPatchTools.selectPatch(this.presets, patch, system);
  }
  destroySoundBank() {
    this.presets.length = 0;
    this.instruments.length = 0;
    this.samples.length = 0;
  }
  parsingError(error) {
    throw new Error(`SF parsing error: ${error} The file may be corrupted.`);
  }
  /**
  * Parses the bank after loading is done
  * @protected
  */
  parseInternal() {
    this._isXGBank = false;
    const allowedPrograms = /* @__PURE__ */ new Set([
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      16,
      17,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      40,
      41,
      48,
      56,
      57,
      58,
      64,
      65,
      66,
      126,
      127
    ]);
    for (const preset of this.presets) if (BankSelectHacks.isXGDrum(preset.bankMSB)) {
      this._isXGBank = true;
      if (!allowedPrograms.has(preset.program)) {
        this._isXGBank = false;
        SpessaLog.info(`%cThis bank is not valid XG. Preset %c${preset.toString()}%c is not a valid XG drum. XG mode will use presets on bank 128.`, ConsoleColors.info, ConsoleColors.value, ConsoleColors.info);
        break;
      }
    }
  }
  printInfo() {
    for (const [info, value] of Object.entries(this.soundBankInfo)) if (typeof value === "object" && "major" in value) {
      const v = value;
      SpessaLog.info(`%c${info}: %c"${v.major}.${v.minor}"`, ConsoleColors.info, ConsoleColors.recognized);
    } else SpessaLog.info(`%c${info}: %c${value.toLocaleString()}`, ConsoleColors.info, ConsoleColors.recognized);
  }
};
var ReadGenerator = class extends Generator {
  /**
  * Creates a generator
  */
  constructor(dataArray) {
    const i = dataArray.currentIndex;
    const generatorType = dataArray[i + 1] << 8 | dataArray[i];
    const generatorValue = signedInt16(dataArray[i + 2], dataArray[i + 3]);
    dataArray.currentIndex += 4;
    super(generatorType, generatorValue, false);
  }
};
function readGenerators(generatorChunk) {
  const gens = [];
  while (generatorChunk.data.length > generatorChunk.data.currentIndex) gens.push(new ReadGenerator(generatorChunk.data));
  gens.pop();
  return gens;
}
function applyPresetZones(indexes, presetGens, presetMods, instruments, presets) {
  const genStartIndexes = indexes.gen;
  const modStartIndexes = indexes.mod;
  let modIndex = 0;
  let genIndex = 0;
  for (const preset of presets) for (let i = 0; i < preset.zonesCount; i++) {
    const gensStart = genStartIndexes[genIndex++];
    const gensEnd = genStartIndexes[genIndex];
    const gens = presetGens.slice(gensStart, gensEnd);
    const modsStart = modStartIndexes[modIndex++];
    const modsEnd = modStartIndexes[modIndex];
    const mods = presetMods.slice(modsStart, modsEnd);
    if (gens.some((g) => g.type === GeneratorTypes.instrument)) preset.createSoundFontZone(mods, gens, instruments);
    else {
      preset.globalZone.addGenerators(...gens);
      preset.globalZone.addModulators(...mods);
    }
  }
}
var SoundFontPreset = class extends BasicPreset {
  zoneStartIndex;
  zonesCount = 0;
  /**
  * Creates a preset
  */
  constructor(presetChunk, sf2) {
    super(sf2);
    this.name = readBinaryStringIndexed(presetChunk.data, 20);
    this.program = readLittleEndianIndexed(presetChunk.data, 2);
    const wBank = readLittleEndianIndexed(presetChunk.data, 2);
    this.bankMSB = wBank & 127;
    this.isGMGSDrum = (wBank & 128) > 0;
    this.bankLSB = wBank >> 8;
    this.zoneStartIndex = readLittleEndianIndexed(presetChunk.data, 2);
    this.library = readLittleEndianIndexed(presetChunk.data, 4);
    this.genre = readLittleEndianIndexed(presetChunk.data, 4);
    this.morphology = readLittleEndianIndexed(presetChunk.data, 4);
  }
  createSoundFontZone(modulators, generators, instruments) {
    const instrumentID = generators.find((g) => g.type === GeneratorTypes.instrument);
    let instrument;
    if (instrumentID) instrument = instruments[instrumentID.value];
    else throw new Error("No instrument ID found in preset zone.");
    if (!instrument) throw new Error(`Invalid instrument ID: ${instrumentID.value}, available instruments: ${instruments.length}`);
    const z = new BasicPresetZone(this, instrument);
    z.addGenerators(...generators);
    z.addModulators(...modulators);
    this.zones.push(z);
    return z;
  }
};
function readPresets(presetChunk, parent) {
  const presets = [];
  while (presetChunk.data.length > presetChunk.data.currentIndex) {
    const preset = new SoundFontPreset(presetChunk, parent);
    if (presets.length > 0) {
      const previous = presets[presets.length - 1];
      previous.zonesCount = preset.zoneStartIndex - previous.zoneStartIndex;
    }
    presets.push(preset);
  }
  presets.pop();
  return presets;
}
var SoundFontInstrument = class extends BasicInstrument {
  zoneStartIndex;
  zonesCount = 0;
  /**
  * Creates an instrument
  */
  constructor(instrumentChunk) {
    super();
    this.name = readBinaryStringIndexed(instrumentChunk.data, 20);
    this.zoneStartIndex = readLittleEndianIndexed(instrumentChunk.data, 2);
  }
  createSoundFontZone(modulators, generators, samples) {
    const sampleID = generators.find((g) => g.type === GeneratorTypes.sampleID);
    let sample;
    if (sampleID) sample = samples[sampleID.value];
    else throw new Error("No sample ID found in instrument zone.");
    if (!sample) throw new Error(`Invalid sample ID: ${sampleID.value}, available samples: ${samples.length}`);
    const z = new BasicInstrumentZone(this, sample);
    z.addGenerators(...generators);
    z.addModulators(...modulators);
    this.zones.push(z);
    return z;
  }
};
function readInstruments(instrumentChunk) {
  const instruments = [];
  while (instrumentChunk.data.length > instrumentChunk.data.currentIndex) {
    const instrument = new SoundFontInstrument(instrumentChunk);
    if (instruments.length > 0) {
      const previous = instruments[instruments.length - 1];
      previous.zonesCount = instrument.zoneStartIndex - previous.zoneStartIndex;
    }
    instruments.push(instrument);
  }
  instruments.pop();
  return instruments;
}
function readModulators(modulatorChunk) {
  const mods = [];
  while (modulatorChunk.data.length > modulatorChunk.data.currentIndex) {
    const dataArray = modulatorChunk.data;
    const sourceEnum = readLittleEndianIndexed(dataArray, 2);
    const destination = readLittleEndianIndexed(dataArray, 2);
    const amount = signedInt16(dataArray[dataArray.currentIndex++], dataArray[dataArray.currentIndex++]);
    const secondarySourceEnum = readLittleEndianIndexed(dataArray, 2);
    const transformType = readLittleEndianIndexed(dataArray, 2);
    mods.push(new DecodedModulator(sourceEnum, secondarySourceEnum, destination, amount, transformType));
  }
  mods.pop();
  return mods;
}
function applyInstrumentZones(indexes, instrumentGenerators, instrumentModulators, samples, instruments) {
  const genStartIndexes = indexes.gen;
  const modStartIndexes = indexes.mod;
  let modIndex = 0;
  let genIndex = 0;
  for (const instrument of instruments) for (let i = 0; i < instrument.zonesCount; i++) {
    const gensStart = genStartIndexes[genIndex++];
    const gensEnd = genStartIndexes[genIndex];
    const gens = instrumentGenerators.slice(gensStart, gensEnd);
    const modsStart = modStartIndexes[modIndex++];
    const modsEnd = modStartIndexes[modIndex];
    const mods = instrumentModulators.slice(modsStart, modsEnd);
    if (gens.some((g) => g.type === GeneratorTypes.sampleID)) instrument.createSoundFontZone(mods, gens, samples);
    else {
      instrument.globalZone.addGenerators(...gens);
      instrument.globalZone.addModulators(...mods);
    }
  }
}
function readZoneIndexes(zonesChunk) {
  const modStartIndexes = [];
  const genStartIndexes = [];
  while (zonesChunk.data.length > zonesChunk.data.currentIndex) {
    genStartIndexes.push(readLittleEndianIndexed(zonesChunk.data, 2));
    modStartIndexes.push(readLittleEndianIndexed(zonesChunk.data, 2));
  }
  return {
    mod: modStartIndexes,
    gen: genStartIndexes
  };
}
var SoundFont2 = class extends BasicSoundBank {
  sampleDataStartIndex = 0;
  /**
  * Initializes a new SoundFont2 Parser and parses the given data array
  */
  constructor(arrayBuffer, sfe) {
    super(sfe ? "sfe" : "sf2");
    const mainFileArray = new IndexedByteArray(arrayBuffer);
    SpessaLog.group("%cParsing a SoundFont2 file...", ConsoleColors.info);
    const fourCC = readBinaryString(mainFileArray, 4).toLowerCase();
    this.verifyTexts(fourCC, ["riff", "rifs"]);
    const rf64 = fourCC === "rifs";
    if (rf64) SpessaLog.info("%cRIFF64 Detected!", ConsoleColors.recognized);
    RIFFChunk.read(mainFileArray, rf64, false);
    const type = readBinaryStringIndexed(mainFileArray, 4).toLowerCase();
    this.verifyTexts(type, [
      "sfbk",
      "sfpk",
      "sfen"
    ]);
    const isSF2Pack = type === "sfpk";
    const infoChunk = RIFFChunk.read(mainFileArray, rf64);
    this.verifyHeader(infoChunk, "list");
    const infoString = readBinaryStringIndexed(infoChunk.data, 4);
    this.verifyText(infoString, "info");
    let xdtaChunk;
    while (infoChunk.data.length > infoChunk.data.currentIndex) {
      const chunk = RIFFChunk.read(infoChunk.data, rf64);
      const text = readBinaryString(chunk.data, chunk.data.length);
      const headerTyped = chunk.header;
      switch (headerTyped) {
        case "ifil":
        case "iver": {
          const major = readLittleEndianIndexed(chunk.data, 2);
          const minor = readLittleEndianIndexed(chunk.data, 2);
          if (headerTyped === "ifil") this.soundBankInfo.version = {
            major,
            minor
          };
          else this.soundBankInfo.romVersion = {
            major,
            minor
          };
          break;
        }
        case "DMOD":
          this.defaultModulators = readModulators(chunk);
          this.customDefaultModulators = true;
          break;
        case "LIST":
          if (readBinaryStringIndexed(chunk.data, 4) === "xdta") {
            SpessaLog.info("%cExtended SF2 found!", ConsoleColors.recognized);
            xdtaChunk = chunk;
          }
          break;
        case "ICRD":
          this.soundBankInfo.creationDate = parseDateString(readBinaryStringIndexed(chunk.data, chunk.data.length));
          break;
        case "ISFT":
          this.soundBankInfo.software = text;
          break;
        case "IPRD":
          this.soundBankInfo.product = text;
          break;
        case "IENG":
          this.soundBankInfo.engineer = text;
          break;
        case "ICOP":
          this.soundBankInfo.copyright = text;
          break;
        case "INAM":
          this.soundBankInfo.name = text;
          break;
        case "ICMT":
          this.soundBankInfo.comment = text;
          break;
        case "irom":
          this.soundBankInfo.romInfo = text;
          break;
        case "isng":
          this.soundBankInfo.soundEngine = text;
      }
    }
    this.printInfo();
    const xChunks = {};
    if (xdtaChunk !== void 0) {
      xChunks.phdr = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.pbag = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.pmod = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.pgen = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.inst = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.ibag = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.imod = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.igen = RIFFChunk.read(xdtaChunk.data, rf64);
      xChunks.shdr = RIFFChunk.read(xdtaChunk.data, rf64);
    }
    const sdtaChunk = RIFFChunk.read(mainFileArray, rf64, false);
    this.verifyHeader(sdtaChunk, "list");
    this.verifyText(readBinaryStringIndexed(mainFileArray, 4), "sdta");
    SpessaLog.info("%cVerifying smpl chunk...", ConsoleColors.warn);
    const sampleDataChunk = RIFFChunk.read(mainFileArray, rf64, false);
    this.verifyHeader(sampleDataChunk, "smpl");
    let sampleData;
    if (isSF2Pack) {
      SpessaLog.info("%cSF2Pack detected, attempting to decode the smpl chunk...", ConsoleColors.info);
      let vorbis;
      try {
        vorbis = L.decode(mainFileArray.buffer.slice(mainFileArray.currentIndex, mainFileArray.currentIndex + sdtaChunk.size - 4 - sdtaChunk.headerSize));
      } catch (error) {
        SpessaLog.groupEnd();
        throw new Error(`SF2Pack Ogg Vorbis decode error: ${error}`, { cause: error });
      }
      if (vorbis.channels.length !== 1) throw new Error(`The encoded sample data must be mono, received ${vorbis.channels.length} channels.`);
      sampleData = vorbis.channels[0];
      SpessaLog.info(`%cDecoded the smpl chunk! Length: %c${sampleData.length}`, ConsoleColors.info, ConsoleColors.value);
    } else {
      sampleData = mainFileArray;
      this.sampleDataStartIndex = mainFileArray.currentIndex;
    }
    SpessaLog.info(`%cSkipping sample chunk, length: %c${sdtaChunk.size - 4 - sdtaChunk.headerSize}`, ConsoleColors.info, ConsoleColors.value);
    mainFileArray.currentIndex += sdtaChunk.size - 4 - sdtaChunk.headerSize;
    SpessaLog.info("%cLoading preset data chunk...", ConsoleColors.warn);
    const presetChunk = RIFFChunk.read(mainFileArray, rf64);
    this.verifyHeader(presetChunk, "list");
    readBinaryStringIndexed(presetChunk.data, 4);
    const phdrChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(phdrChunk, "phdr");
    const pbagChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(pbagChunk, "pbag");
    const pmodChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(pmodChunk, "pmod");
    const pgenChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(pgenChunk, "pgen");
    const instChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(instChunk, "inst");
    const ibagChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(ibagChunk, "ibag");
    const imodChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(imodChunk, "imod");
    const igenChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(igenChunk, "igen");
    const shdrChunk = RIFFChunk.read(presetChunk.data, rf64);
    this.verifyHeader(shdrChunk, "shdr");
    SpessaLog.info("%cParsing samples...", ConsoleColors.info);
    mainFileArray.currentIndex = this.sampleDataStartIndex;
    const samples = readSamples(shdrChunk, sampleData, xdtaChunk === void 0);
    if (xdtaChunk && xChunks.shdr) {
      const xSamples = readSamples(xChunks.shdr, new Float32Array(1), false);
      if (xSamples.length === samples.length) for (const [i, s] of samples.entries()) {
        s.name += xSamples[i].name;
        s.linkedSampleIndex |= xSamples[i].linkedSampleIndex << 16;
      }
    }
    for (const s of samples) s.name = s.name.trim();
    this.samples.push(...samples);
    const instrumentGenerators = readGenerators(igenChunk);
    const instrumentModulators = readModulators(imodChunk);
    const instruments = readInstruments(instChunk);
    if (xdtaChunk && xChunks.inst) {
      const xInst = readInstruments(xChunks.inst);
      if (xInst.length === instruments.length) {
        for (const [i, inst] of instruments.entries()) {
          inst.name += xInst[i].name;
          inst.zoneStartIndex |= xInst[i].zoneStartIndex << 16;
        }
        for (const [i, inst] of instruments.entries()) if (i < instruments.length - 1) inst.zonesCount = instruments[i + 1].zoneStartIndex - inst.zoneStartIndex;
      }
    }
    for (const i of instruments) i.name = i.name.trim();
    this.instruments.push(...instruments);
    const ibagIndexes = readZoneIndexes(ibagChunk);
    if (xdtaChunk && xChunks.ibag) {
      const extraIndexes = readZoneIndexes(xChunks.ibag);
      for (let i = 0; i < ibagIndexes.mod.length; i++) ibagIndexes.mod[i] |= extraIndexes.mod[i] << 16;
      for (let i = 0; i < ibagIndexes.gen.length; i++) ibagIndexes.gen[i] |= extraIndexes.gen[i] << 16;
    }
    applyInstrumentZones(ibagIndexes, instrumentGenerators, instrumentModulators, this.samples, instruments);
    const presetGenerators = readGenerators(pgenChunk);
    const presetModulators = readModulators(pmodChunk);
    const presets = readPresets(phdrChunk, this);
    if (xdtaChunk && xChunks.phdr) {
      const xPreset = readPresets(xChunks.phdr, this);
      if (xPreset.length === presets.length) {
        for (const [i, pres] of presets.entries()) {
          pres.name += xPreset[i].name;
          pres.zoneStartIndex |= xPreset[i].zoneStartIndex << 16;
        }
        for (const [i, preset] of presets.entries()) if (i < presets.length - 1) preset.zonesCount = presets[i + 1].zoneStartIndex - preset.zoneStartIndex;
      }
    }
    for (const p of presets) p.name = p.name.trim();
    this.addPresets(...presets);
    const pbagIndexes = readZoneIndexes(pbagChunk);
    if (xdtaChunk && xChunks.pbag) {
      const extraIndexes = readZoneIndexes(xChunks.pbag);
      for (let i = 0; i < pbagIndexes.mod.length; i++) pbagIndexes.mod[i] |= extraIndexes.mod[i] << 16;
      for (let i = 0; i < pbagIndexes.gen.length; i++) pbagIndexes.gen[i] |= extraIndexes.gen[i] << 16;
    }
    applyPresetZones(pbagIndexes, presetGenerators, presetModulators, this.instruments, presets);
    this.flush();
    SpessaLog.info(`%cParsing finished! %c"${this.soundBankInfo.name}"%c has %c${this.presets.length}%c presets,
        %c${this.instruments.length}%c instruments and %c${this.samples.length}%c samples.`, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info, ConsoleColors.recognized, ConsoleColors.info);
    SpessaLog.groupEnd();
  }
  verifyHeader(chunk, expected) {
    if (chunk.header.toLowerCase() !== expected.toLowerCase()) {
      SpessaLog.groupEnd();
      this.parsingError(`Invalid chunk header! Expected "${expected.toLowerCase()}" got "${chunk.header.toLowerCase()}"`);
    }
  }
  verifyText(text, expected) {
    if (text.toLowerCase() !== expected.toLowerCase()) {
      SpessaLog.groupEnd();
      this.parsingError(`Invalid FourCC: Expected "${expected.toLowerCase()}" got "${text.toLowerCase()}"\``);
    }
  }
  verifyTexts(text, expected) {
    if (!expected.includes(text.toLowerCase())) {
      SpessaLog.groupEnd();
      this.parsingError(`Invalid FourCC: Expected ${expected.map((s) => `"${s}"`).join(", ")} but got "${text.toLowerCase()}"`);
    }
  }
};
var SoundBankLoader = class {
  /**
  * Loads a sound bank from a file buffer.
  * @param buffer The binary file buffer to load.
  * @returns The loaded sound bank, a BasicSoundBank instance.
  */
  static fromArrayBuffer(buffer) {
    const riffText = readBinaryStringIndexed(new IndexedByteArray(buffer.slice(0, 4)), 4);
    if (riffText !== "RIFF" && riffText !== "RIFS") throw new Error(`Expected 'RIFF' or 'RIFS' header, got '${riffText}'`);
    const id = readBinaryStringIndexed(new IndexedByteArray(riffText === "RIFS" ? buffer.slice(12, 16) : buffer.slice(8, 12)), 4).toLowerCase();
    if (id === "dls ") return this.loadDLS(buffer);
    return new SoundFont2(buffer, id === "sfen");
  }
  static loadDLS(buffer) {
    return DownloadableSounds.read(buffer).toSF();
  }
};
var VoiceModulator = class VoiceModulator2 extends Modulator {
  /**
  * Indicates if the given modulator is chorus or reverb effects modulator.
  * This is done to simulate BASSMIDI effects behavior:
  * - defaults to 1000 transform amount rather than 200
  * - values can be changed, but anything above 200 is 1000
  * (except for values above 1000, they are copied directly)
  * - all values below are multiplied by 5 (200 * 5 = 1000)
  * - still can be disabled if the soundfont has its own modulator curve
  * - this fixes the very low amount of reverb by default and doesn't break soundfonts
  */
  isEffectModulator;
  /**
  * The default resonant modulator does not affect the filter gain.
  * Neither XG nor GS responded to cc #74 in that way.
  */
  isDefaultResonantModulator;
  /**
  * If this is a modulation wheel modulator (for modulation depth range).
  */
  isModWheelModulator;
  constructor(s1, s2, destination, amount, transformType, isEffectModulator, isDefaultResonantModulator, isModWheelModulator) {
    super(s1, s2, destination, amount, transformType);
    this.isEffectModulator = isEffectModulator;
    this.isDefaultResonantModulator = isDefaultResonantModulator;
    this.isModWheelModulator = isModWheelModulator;
  }
  static fromData(s1, s2, destination, amount, transformType) {
    const s1Enum = s1.toSourceEnum();
    const s2Enum = s2.toSourceEnum();
    return new VoiceModulator2(s1, s2, destination, amount, transformType, (s1Enum === 219 || s1Enum === 221) && s2Enum === 0 && (destination === GeneratorTypes.reverbEffectsSend || destination === GeneratorTypes.chorusEffectsSend), s1Enum === DEFAULT_RESONANT_MOD_SOURCE && s2Enum === 0 && destination === GeneratorTypes.initialFilterQ, (s1.isCC && s1.index === MIDIControllers.modulationWheel || s2.isCC && s2.index === MIDIControllers.modulationWheel) && (destination === GeneratorTypes.modLfoToPitch || destination === GeneratorTypes.vibLfoToPitch));
  }
  static fromModulator(mod) {
    return this.fromData(mod.primarySource, mod.secondarySource, mod.destination, mod.transformAmount, mod.transformType);
  }
};
var INITIAL_MODULATORS = [VoiceModulator.fromModulator(new DecodedModulator(getModSourceEnum(ModulatorCurveTypes.linear, true, false, true, MIDIControllers.vibratoRate), 0, GeneratorTypes.vibLfoRate, 1e3, 0))];
var DynamicModulatorManager = class {
  /**
  * The current dynamic modulator list.
  */
  modulatorList = [];
  active = false;
  channel;
  constructor(channel) {
    this.channel = channel;
  }
  resetModulators() {
    this.modulatorList = INITIAL_MODULATORS.map((m) => {
      return {
        mod: m,
        id: this.getModulatorID(m.primarySource.toSourceEnum(), m.destination, m.primarySource.isBipolar, m.primarySource.isNegative)
      };
    });
    this.active = false;
  }
  setupReceiver(addr3, data, source, isCC, sourceName, bipolar = false) {
    this.active = true;
    const centeredValue = data - 64;
    const centeredNormalized = centeredValue / 64;
    const normalizedNotCentered = data / 127;
    switch (addr3 & 15) {
      case 0: {
        const v = Math.min(24, Math.max(-24, centeredValue));
        this.setModulator(source, isCC, GeneratorTypes.fineTune, v * 100, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} pitch control`, v, "semitones");
        break;
      }
      case 1:
        this.setModulator(source, isCC, GeneratorTypes.initialFilterFc, centeredNormalized * 9600, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} filter control`, centeredNormalized * 9600, "cents");
        break;
      case 2:
        this.setModulator(source, isCC, GeneratorTypes.amplitude, centeredNormalized * 1e3, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} amplitude control`, centeredNormalized * 100, "%");
        break;
      case 3:
        this.setModulator(source, isCC, GeneratorTypes.vibLfoRate, centeredNormalized * 1e3, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO1 rate control`, centeredNormalized * 10, "Hz");
        break;
      case 4:
        this.setModulator(source, isCC, GeneratorTypes.vibLfoToPitch, normalizedNotCentered * 600, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO1 pitch depth control`, normalizedNotCentered * 600, "cents");
        break;
      case 5:
        this.setModulator(source, isCC, GeneratorTypes.vibLfoToFilterFc, normalizedNotCentered * 2400, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO1 filter depth control`, normalizedNotCentered * 2400, "cents");
        break;
      case 6:
        this.setModulator(source, isCC, GeneratorTypes.vibLfoAmplitudeDepth, normalizedNotCentered * 1e3, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO1 amplitude depth control`, normalizedNotCentered * 100, "%");
        break;
      case 7:
        this.setModulator(source, isCC, GeneratorTypes.modLfoRate, centeredNormalized * 1e3, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO2 rate control`, centeredNormalized * 10, "Hz");
        break;
      case 8:
        this.setModulator(source, isCC, GeneratorTypes.modLfoToPitch, normalizedNotCentered * 600, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO2 pitch depth control`, normalizedNotCentered * 600, "cents");
        break;
      case 9:
        this.setModulator(source, isCC, GeneratorTypes.modLfoToFilterFc, normalizedNotCentered * 2400, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO2 filter depth control`, normalizedNotCentered * 2400, "cents");
        break;
      case 10:
        this.setModulator(source, isCC, GeneratorTypes.modLfoAmplitudeDepth, normalizedNotCentered * 1e3, bipolar);
        SpessaLog.coolInfo(`Channel ${this.channel} ${sourceName} LFO2 amplitude depth control`, normalizedNotCentered * 100, "%");
        break;
    }
  }
  /**
  * @param source The source index.
  * @param isCC If the source is an SF2 source or a MIDI CC source.
  * @param destination The generator type to modulate.
  * @param amount The amount of modulation to apply.
  * @param isBipolar If true, the modulation is bipolar (ranges from -1 to 1 instead of from 0 to 1).
  * @param isNegative If true, the modulation is negative (goes from 1 to 0 instead of from 0 to 1).
  */
  setModulator(source, isCC, destination, amount, isBipolar = false, isNegative = false) {
    const id = this.getModulatorID(source, destination, isBipolar, isNegative);
    if (amount === 0) this.deleteModulator(id);
    const mod = this.modulatorList.find((m) => m.id === id);
    if (mod) mod.mod.transformAmount = amount;
    else {
      const modulator = VoiceModulator.fromData(new ModulatorSource(source, ModulatorCurveTypes.linear, isCC, isBipolar), new ModulatorSource(), destination, amount, 0);
      this.modulatorList.push({
        mod: modulator,
        id
      });
    }
  }
  getModulatorID(source, destination, isBipolar, isNegative) {
    return `${source}-${destination}-${isBipolar}-${isNegative}`;
  }
  deleteModulator(id) {
    this.modulatorList = this.modulatorList.filter((m) => m.id !== id);
  }
};
var EFFECT_MODULATOR_TRANSFORM_MULTIPLIER = 1e3 / 200;
function computeModulator(voice, pitchWheel, modulatorIndex) {
  const modulator = voice.modulators[modulatorIndex];
  if (modulator.transformAmount === 0) {
    voice.modulatorValues[modulatorIndex] = 0;
    return 0;
  }
  const sourceValue = modulator.primarySource.getValue(this, pitchWheel, voice);
  const secondSrcValue = modulator.secondarySource.getValue(this, pitchWheel, voice);
  let transformAmount = modulator.transformAmount;
  if (modulator.isEffectModulator && transformAmount <= 1e3) {
    transformAmount *= EFFECT_MODULATOR_TRANSFORM_MULTIPLIER;
    transformAmount = Math.min(transformAmount, 1e3);
  }
  let computedValue = sourceValue * secondSrcValue * transformAmount;
  if (modulator.transformType === 2) computedValue = Math.abs(computedValue);
  if (modulator.isDefaultResonantModulator) voice.resonanceOffset = Math.max(0, computedValue / 2);
  if (modulator.isModWheelModulator) computedValue *= this._midiParameters.modulationDepth / 50;
  voice.modulatorValues[modulatorIndex] = computedValue;
  return computedValue;
}
function computeModulators(voice, sourceUsesCC = -1, sourceIndex = 0) {
  const modulators = voice.modulators;
  let generators = voice.generators;
  if (this.generators.offsetsEnabled) {
    const g = this.generators.offsets;
    generators = new Int16Array(generators);
    for (let i = 0; i < generators.length; i++) generators[i] += g[i];
  }
  const modulatedGenerators = voice.modulatedGenerators;
  const pitch = this.perNotePitch ? this.pitchWheels[voice.midiNote] : this._midiParameters.pitchWheel;
  if (sourceUsesCC === -1) {
    modulatedGenerators.set(generators);
    for (let i = 0; i < modulators.length; i++) {
      const mod = modulators[i];
      modulatedGenerators[mod.destination] = Math.min(32767, Math.max(-32768, modulatedGenerators[mod.destination] + this.computeModulator(voice, pitch, i)));
    }
    for (let gen = 0; gen < modulatedGenerators.length; gen++) {
      const limit2 = GeneratorLimits[gen];
      if (!limit2) continue;
      modulatedGenerators[gen] = Math.min(limit2.max, Math.max(limit2.min, modulatedGenerators[gen]));
    }
    return;
  }
  const sourceCC = !!sourceUsesCC;
  for (let i = 0; i < modulators.length; i++) {
    const mod = modulators[i];
    if (mod.primarySource.isCC === sourceCC && mod.primarySource.index === sourceIndex || mod.secondarySource.isCC === sourceCC && mod.secondarySource.index === sourceIndex) {
      const destination = mod.destination;
      let outputValue = generators[destination];
      this.computeModulator(voice, pitch, i);
      for (let j = 0; j < modulators.length; j++) if (modulators[j].destination === destination) outputValue += voice.modulatorValues[j];
      const limits = GeneratorLimits[destination];
      modulatedGenerators[destination] = Math.max(limits.min, Math.min(outputValue, limits.max));
    }
  }
}
var DrumParameters = class DrumParameters2 {
  /**
  * Pitch offset in cents.
  */
  pitch = 0;
  /**
  * Gain multiplier.
  */
  gain = 1;
  /**
  * Exclusive class override.
  */
  exclusiveClass = 0;
  /**
  * Pan, 1-64-127, 0 is random. This adds to the channel pan!
  */
  pan = 64;
  /**
  * Reverb multiplier.
  */
  reverbGain = 0;
  /**
  * Chorus multiplier.
  */
  chorusGain = 1;
  /**
  * Delay multiplier.
  */
  delayGain = 1;
  /**
  * If note on should be received.
  */
  rxNoteOn = true;
  /**
  * If note off should be received.
  * Note:
  * Due to the way sound banks implement drums (as 100s release time),
  * this means killing the voice on note off, not releasing it.
  */
  rxNoteOff = false;
  static copyFrom(p) {
    const d = new DrumParameters2();
    d.pitch = p.pitch;
    d.chorusGain = p.chorusGain;
    d.reverbGain = p.reverbGain;
    d.exclusiveClass = p.exclusiveClass;
    d.gain = p.gain;
    d.pan = p.pan;
    d.rxNoteOff = p.rxNoteOff;
    d.rxNoteOn = p.rxNoteOn;
    return d;
  }
};
function getChannelSnapshot() {
  return {
    patch: this.preset ? {
      ...this.patch,
      name: this.preset.name,
      isDrum: this.preset.isDrum
    } : void 0,
    lockedSystem: this.lockedSystem,
    midiControllers: this._midiControllers.slice(),
    lockedControllers: [...this.lockedControllers],
    pitchWheels: this.pitchWheels.slice(),
    generators: {
      ...this.generators,
      offsets: this.generators.offsets.slice(),
      overrides: this.generators.overrides.slice()
    },
    midiParameters: { ...this._midiParameters },
    lockedMIDIParameters: { ...this.lockedMIDIParameters },
    systemParameters: { ...this._systemParameters },
    octaveTuning: this.octaveTuning.slice(),
    perNotePitch: this.perNotePitch,
    drumParams: this.drumParams.map((d) => ({ ...d })),
    drumChannel: this._drumChannel,
    channel: this.channel
  };
}
function applySnapshot(snapshot) {
  this.setDrums(snapshot.drumChannel);
  this._midiControllers.set(snapshot.midiControllers);
  for (let i = 0; i < 128; i++) this.lockController(i, snapshot.lockedControllers[i]);
  this.pitchWheels.set(snapshot.pitchWheels);
  this.octaveTuning.set(snapshot.octaveTuning);
  this.perNotePitch = snapshot.perNotePitch;
  this.generators.offsets.set(snapshot.generators.offsets);
  this.generators.overrides.set(snapshot.generators.overrides);
  this.generators.offsetsEnabled = snapshot.generators.offsetsEnabled;
  this.generators.overridesEnabled = snapshot.generators.overridesEnabled;
  for (let i = 0; i < 128; i++) this.drumParams[i] = DrumParameters.copyFrom(snapshot.drumParams[i]);
  this.setSystemParameter("presetLock", false);
  if (snapshot.patch) this.setPatch(snapshot.patch);
  this.lockedSystem = snapshot.lockedSystem;
  for (const parameter of Object.keys(snapshot.lockedMIDIParameters)) this.lockMIDIParameter(parameter, false);
  for (const [parameter, value] of Object.entries(snapshot.midiParameters)) this.setMIDIParameter(parameter, value);
  for (const [parameter, isLocked] of Object.entries(snapshot.lockedMIDIParameters)) this.lockMIDIParameter(parameter, isLocked);
  for (const [parameter, value] of Object.entries(snapshot.systemParameters)) this.setSystemParameter(parameter, value);
}
var DEFAULT_CHANNEL_MIDI_PARAMETERS = {
  pitchWheel: 8192,
  pitchWheelRange: 2,
  pressure: 0,
  modulationDepth: 50,
  rxChannel: 0,
  polyMode: true,
  keyShift: 0,
  fineTune: 0,
  randomPan: false,
  assignMode: 2,
  efxAssign: false,
  cc1: 16,
  cc2: 17,
  drumMap: 0,
  velocitySenseDepth: 64,
  velocitySenseOffset: 64
};
function setMIDIParameterInternal$1(parameter, value) {
  if (this.lockedMIDIParameters[parameter]) return;
  this._midiParameters[parameter] = value;
  switch (parameter) {
    case "pitchWheel":
      this.computeModulatorsAll(0, ModulatorControllerSources.pitchWheel);
      break;
    case "pressure":
      this.computeModulatorsAll(0, ModulatorControllerSources.channelPressure);
      break;
  }
  this.updateInternalParams();
  this.synthCore.callEvent("channelParamChange", {
    channel: this.channel,
    parameter,
    value
  });
}
function lockMIDIParameterInternal$1(parameter, isLocked) {
  this.lockedMIDIParameters[parameter] = isLocked;
}
var DEFAULT_CHANNEL_SYSTEM_PARAMETERS = {
  presetLock: false,
  isMuted: false,
  gain: 1,
  pan: 0,
  keyShift: 0,
  fineTune: 0,
  interpolationType: null,
  nrpnParamLock: null,
  monophonicRetrigger: null
};
function setSystemParameterInternal$1(parameter, value) {
  if (this._systemParameters[parameter] === value) return;
  const prev = this._systemParameters[parameter];
  this._systemParameters[parameter] = value;
  this.updateInternalParams();
  switch (parameter) {
    default:
      break;
    case "presetLock":
      if (value) this.lockedSystem = this.synthCore.midiParameters.system;
      break;
    case "isMuted":
      if (value) this.stopAllNotes(true);
      break;
    case "keyShift":
      if (!this._drumChannel && prev !== value) this.stopAllNotes(true);
  }
}
var MIDIChannel = class {
  /**
  * An array for the MIDI 2.0 Per-note pitch wheels.
  * @internal
  */
  pitchWheels = new Int16Array(128).fill(8192);
  /**
  * Parameters for each drum instrument.
  * @internal
  */
  drumParams = [];
  /**
  * A system for dynamic modulator assignment for advanced system exclusives.
  * @internal
  */
  dynamicModulators;
  /**
  * SF2 NRPN LSB for selecting a generator value.
  * @internal
  */
  sf2NRPNGeneratorLSB = 0;
  /**
  * The currently selected MIDI patch of the channel.
  * Note that the exact matching preset may not be available, but this represents exactly what MIDI asks for.
  */
  patch = {
    bankMSB: 0,
    bankLSB: 0,
    program: 0,
    isGMGSDrum: false
  };
  /**
  * The preset currently assigned to the channel.
  * Note that this may be undefined in some cases.
  */
  preset;
  /**
  * Indicates the MIDI system when the preset was locked.
  * @internal
  */
  lockedSystem = "gs";
  /**
  * The channel's number (0-based index)
  */
  channel;
  /**
  * Core synthesis engine.
  * @internal
  */
  synthCore;
  /**
  * Sets a system parameter of the channel.
  * @param parameter The type of the system parameter to set.
  * @param value The value to set for the system parameter.
  */
  setSystemParameter = setSystemParameterInternal$1.bind(this);
  /**
  * Locks or unlocks a given Channel MIDI Parameter.
  * This prevents any changes to it until it's unlocked.
  * @param parameter The Channel MIDI Parameter to lock.
  * @param isLocked If the parameter should be locked.
  */
  lockMIDIParameter = lockMIDIParameterInternal$1.bind(this);
  /**
  * Sends a "MIDI Note on" message and starts a note.
  * @param midiNote The MIDI note number (0-127).
  * @param velocity The velocity of the note (0-127). If less than 1, it will send a note off instead.
  * @internal
  */
  noteOn = noteOn.bind(this);
  /**
  * Releases a note by its MIDI note number.
  * If the note is in high performance mode and the channel is not a drum channel,
  * it kills the note instead of releasing it.
  * @param midiNote The MIDI note number to release (0-127).
  * @internal
  */
  noteOff = noteOff.bind(this);
  /**
  * Changes the program (preset) of the channel.
  * @param programNumber The program number (0-127) to change to.
  * @internal
  */
  programChange = programChange.bind(this);
  /**
  * Handles MIDI controller changes for a channel.
  * @param controllerNumber The MIDI controller number (0-127).
  * @param controllerValue The value of the controller (0-127).
  * @param sendEvent If an event should be emitted.
  * @remarks
  * This function processes MIDI controller changes, updating the channel's
  * midiControllers table and handling special cases like bank select,
  * data entry, and sustain pedal. It also computes modulators for all voices
  * in the channel based on the controller change.
  * to allow changes.
  * @internal
  */
  controllerChange = controllerChange.bind(this);
  /**
  * Reset this channel to its default state.
  * Except for the locked controllers.
  * @internal
  */
  reset = resetChannelInternal.bind(this);
  /**
  * Renders a voice to the stereo output buffer
  * @param voice the voice to render
  * @param timeNow current time in seconds
  * @param outputL the left output buffer
  * @param outputR the right output buffer
  * @param startIndex
  * @param sampleCount
  * @internal
  */
  renderVoice = renderVoice.bind(this);
  /**
  * Sets a channel MIDI parameter of the synthesizer.
  * @param parameter The type of the channel MIDI parameter to set.
  * @param value The value to set for the channel MIDI parameter.
  * @internal
  */
  setMIDIParameter = setMIDIParameterInternal$1.bind(this);
  /**
  * An array indicating if a controller, at the equivalent index in the midiControllers array, is locked
  * (i.e., not allowed changing).
  * A locked controller cannot be modified.
  * @internal
  */
  lockedControllers = new Array(128).fill(false);
  /**
  * An array of MIDI controllers for the channel.
  * This array is used to store the state of various MIDI controllers
  * such as volume, pan, modulation, etc.
  * @remarks
  * A bit of an explanation:
  * The controller table is stored as an int16 array, it stores 14-bit values, allowing for full 14-bit LSB resolution.
  * The only exception from this are the Registered and Non-Registered Parameter Numbers.
  * Data entries do store it!
  */
  _midiControllers = new Int16Array(128);
  /**
  * An array of octave tuning values for each note on the channel.
  * Each index corresponds to a note (0 = C, 1 = C#, ..., 11 = B).
  * Note: Repeated every 12 notes.
  */
  octaveTuning = new Int8Array(128);
  /**
  * https://amei.or.jp/midistandardcommittee/Recommended_Practice/e/rp15.pdf
  * Reset controllers according to RP-15 Recommended Practice.
  * @internal
  */
  resetRP15 = resetRP15.bind(this);
  /**
  * Executes a data entry coarse (MSB) change for the current channel.
  * @param dataValue The value to set for the data entry coarse controller (0-127).
  * @internal
  */
  dataEntry = dataEntry.bind(this);
  /**
  * An object indicating if a Channel MIDI parameter, at the equivalent key, is locked
  * (i.e., not allowed changing).
  * A locked parameter cannot be modified.
  * @internal
  */
  lockedMIDIParameters = Object.fromEntries(Object.keys(DEFAULT_CHANNEL_MIDI_PARAMETERS).map((key) => [key, false]));
  _midiParameters = { ...DEFAULT_CHANNEL_MIDI_PARAMETERS };
  /**
  * All system parameters of this channel.
  * @internal
  */
  _systemParameters = { ...DEFAULT_CHANNEL_SYSTEM_PARAMETERS };
  /**
  * Note On message tracking, for grouping voices for specific Note On messages.
  * Used for overlapping Note Ons.
  * MIDI note: current note on ID
  * @protected
  */
  noteOnID = new Array(128).fill(0);
  /**
  * Note Off message tracking, for grouping voices for specific Note On messages.
  * Used for overlapping Note Ons.
  * MIDI note: current note on ID
  * @protected
  */
  noteOffID = new Array(128).fill(0);
  /**
  * If the last Parameter was RPN.
  * If false then the last parameter was NRPN.
  * @protected
  */
  lastParameterIsRegistered = true;
  /**
  * Per-note pitch wheel mode uses the pitchWheels table as source
  * instead of the regular entry in the midiControllers table.
  */
  perNotePitch = false;
  /**
  * Current pan in range [-500;500]
  * Updated in `updateInternalParams`.
  * This is used to avoid a big addition for every voice rendering call.
  */
  currentPan = 0;
  /**
  * Current tuning in cents.
  * Updated in `updateInternalParams`.
  * This is used to avoid a big addition for every voice rendering call.
  */
  currentTuning = 0;
  /**
  * Current key-shift.
  * Updated in `updateInternalParams`.
  */
  currentKeyShift = 0;
  /**
  * Current gain.
  * Updated in `updateInternalParams`.
  * This is used to avoid a big multiplication for every voice rendering call.
  */
  currentGain = 0;
  /**
  * The last pressed note on this channel for portamento tracking.
  * -1 means none.
  * This is not a `ChannelMIDIParameter` and is strictly internal,
  * mostly because we don't want to send events for every note on message.
  * It can be set with Portamento Control CC anyway.
  * @protected
  */
  lastPortamentoNote = -1;
  /**
  * If the portamento should be executed once regardless of Portamento on/off.
  * Adhering to the MIDI spec, CC#84 ignores on/off.
  * This is also not a `ChannelMIDIParameter` for the same reason as `lastPortamentoNote`
  * @protected
  */
  portamentoForce = false;
  /**
  * The last pressed note on this channel in mono mode.
  * Used for tracking and releasing this note on a new Note On event.
  * -1 means none.
  * @protected
  */
  lastMonoNote = -1;
  /**
  * The last pressed note's velocity on this channel in mono mode.
  * @protected
  */
  lastMonoVelocity = 0;
  /**
  * For Mono Mode restoring notes.
  * playingNotes[midiNote]
  * @protected
  */
  playingNotes = new Array(128).fill(false);
  generators = {
    offsets: new Int16Array(GENERATORS_AMOUNT),
    offsetsEnabled: false,
    overrides: new Int16Array(GENERATORS_AMOUNT),
    overridesEnabled: false
  };
  computeModulator = computeModulator.bind(this);
  computeModulators = computeModulators.bind(this);
  /**
  * Constructs a new MIDI channel.
  * @internal
  */
  constructor(synthProps, preset, channelNumber) {
    this.synthCore = synthProps;
    this.preset = preset;
    this.channel = channelNumber;
    this._midiParameters.rxChannel = channelNumber;
    this.dynamicModulators = new DynamicModulatorManager(channelNumber);
    this.resetGeneratorOverrides();
    this.resetGeneratorOffsets();
    for (let i = 0; i < 128; i++) this.drumParams.push(new DrumParameters());
    this.resetDrumParams();
  }
  /**
  * Current amount of voices that are playing on this channel.
  */
  _voiceCount = 0;
  /**
  * Current amount of voices that are playing on this channel.
  */
  get voiceCount() {
    return this._voiceCount;
  }
  /**
  * Current amount of voices that are playing on this channel.
  * @internal
  */
  set voiceCount(value) {
    this._voiceCount = value;
  }
  /**
  * Indicates whether this channel is a drum channel.
  */
  _drumChannel = false;
  /**
  * Indicates whether this channel is a drum channel.
  */
  get drumChannel() {
    return this._drumChannel;
  }
  /**
  * An array of MIDI controllers for the channel.
  * This array is used to store the state of various MIDI controllers
  * such as volume, pan, modulation, etc.
  * @remarks
  * A bit of an explanation:
  * The controller table is stored as an int16 array, it stores 14-bit values, allowing for full 14-bit LSB resolution.
  * The only exception from this are the Registered and Non-Registered Parameter Numbers.
  * Data entries do store it!
  */
  get midiControllers() {
    return this._midiControllers;
  }
  /**
  * The channel system parameters of this channel.
  * These are only editable via the API.
  */
  get systemParameters() {
    return this._systemParameters;
  }
  /**
  * The channel MIDI parameters of this channel.
  * These are only editable via MIDI messages.
  */
  get midiParameters() {
    return this._midiParameters;
  }
  get channelSystem() {
    return this._systemParameters.presetLock ? this.lockedSystem : this.synthCore.midiParameters.system;
  }
  /**
  * Locks or unlocks a given controller.
  * This prevents any changes to it until it's unlocked.
  * @param controller The MIDI controller number (0-127).
  * @param isLocked If the controller should be locked.
  */
  lockController(controller, isLocked) {
    this.lockedControllers[controller] = isLocked;
  }
  /**
  * Changes the preset to, or from drums.
  * Note that this executes a program change.
  * @param isDrum If the channel should be a drum preset or not.
  */
  setDrums(isDrum) {
    if (BankSelectHacks.isSystemXG(this.channelSystem)) if (isDrum) {
      this.setBankMSB(BankSelectHacks.getDrumBank(this.channelSystem));
      this.setBankLSB(0);
    } else {
      if (this.channel % 16 === 9) throw new Error(`Cannot disable drums on channel ${this.channel} for XG.`);
      this.setBankMSB(0);
      this.setBankLSB(0);
    }
    else this.setGSDrums(isDrum);
    this.setDrumFlag(isDrum);
    this.programChange(this.patch.program);
  }
  /**
  * Stops all notes on the channel.
  * @param force If true, stops all notes immediately, otherwise applies release time.
  */
  stopAllNotes(force = false) {
    this.noteOnID.fill(0);
    this.noteOffID.fill(0);
    this.playingNotes.fill(false);
    if (force) {
      let vc = 0;
      if (this._voiceCount > 0) {
        for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive) {
          v.isActive = false;
          if (++vc >= this._voiceCount) break;
        }
      }
      this.clearVoiceCount();
    } else {
      let vc = 0;
      if (this._voiceCount > 0) {
        for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive) {
          v.releaseVoice(this.synthCore.currentTime);
          if (++vc >= this._voiceCount) break;
        }
      }
    }
    this.synthCore.callEvent("stopAll", {
      channel: this.channel,
      force
    });
  }
  /**
  * @internal
  */
  clearVoiceCount() {
    this._voiceCount = 0;
  }
  /**
  * Sets the octave tuning for a given channel.
  * @param tuning The tuning array of 12 values, each representing the tuning for a note in the octave.
  * @remarks
  * Cent tunings are relative.
  * @internal
  */
  setOctaveTuning(tuning) {
    if (tuning.length !== 12) throw new Error("Tuning is not the length of 12.");
    for (let i = 0; i < 128; i++) this.octaveTuning[i] = tuning[i % 12];
  }
  /**
  * Sets the pitch of the given channel.
  * @param pitch The pitch (0 - 16383)
  * @param midiNote The MIDI note number, pass -1 for the regular pitch wheel
  * @internal
  */
  pitchWheel(pitch, midiNote = -1) {
    if (midiNote === -1) {
      this.perNotePitch = false;
      this.setMIDIParameter("pitchWheel", pitch);
    } else {
      if (!this.perNotePitch) this.pitchWheels.fill(this._midiParameters.pitchWheel);
      this.perNotePitch = true;
      this.pitchWheels[midiNote] = pitch;
      this.computeModulatorsAll(0, ModulatorControllerSources.pitchWheel);
    }
  }
  /**
  * Sets the pressure of the given note on a specific channel.
  * This is used for polyphonic pressure (aftertouch).
  * @param midiNote 0 - 127, the MIDI note number to set the pressure for.
  * @param pressure 0 - 127, the pressure value to set for the note.
  * @internal
  */
  polyPressure(midiNote, pressure) {
    let vc = 0;
    if (this._voiceCount > 0) {
      for (const v of this.synthCore.voices) if (v.isActive && v.channel === this.channel && v.midiNote === midiNote) {
        v.pressure = pressure;
        this.computeModulators(v, 0, ModulatorControllerSources.polyPressure);
        if (++vc >= this._voiceCount) break;
      }
    }
    this.synthCore.callEvent("polyPressure", {
      channel: this.channel,
      midiNote,
      pressure
    });
  }
  /**
  * @internal
  */
  updateInternalParams() {
    const globalSystem = this.synthCore.systemParameters;
    const channelSystem = this._systemParameters;
    const globalMIDI = this.synthCore.midiParameters;
    const channelMIDI = this._midiParameters;
    const currentKeyShift = this._drumChannel ? channelSystem.keyShift : globalSystem.keyShift + globalMIDI.keyShift + channelSystem.keyShift + channelMIDI.keyShift;
    this.currentKeyShift = Math.trunc(currentKeyShift);
    this.currentTuning = this._drumChannel ? channelSystem.fineTune : globalSystem.fineTune + globalMIDI.fineTune + channelSystem.fineTune + channelMIDI.fineTune;
    const currentPanNormalized = globalSystem.pan + globalMIDI.pan + channelSystem.pan;
    this.currentPan = currentPanNormalized * 500;
    this.currentGain = SPESSASYNTH_GAIN_FACTOR * globalSystem.gain * Math.pow(globalMIDI.volume, 2) * channelSystem.gain;
  }
  /**
  * Sets the channel to a given MIDI patch.
  * Note that this executes a program change.
  * @param patch The MIDI patch to set the channel to.
  * @internal
  */
  setPatch(patch) {
    this.setBankMSB(patch.bankMSB);
    this.setBankLSB(patch.bankLSB);
    this.setGSDrums(patch.isGMGSDrum);
    this.programChange(patch.program);
  }
  /**
  * Sets the GM/GS drum flag.
  * @param drums
  * @internal
  */
  setGSDrums(drums) {
    if (drums === this.patch.isGMGSDrum) return;
    this.setBankLSB(0);
    this.setBankMSB(0);
    this.patch.isGMGSDrum = drums;
  }
  /**
  * Stops a note nearly instantly.
  * @param midiNote The note to stop.
  * @param releaseTime in timecents, defaults to -12000 (very short release).
  * @internal
  */
  killNote(midiNote, releaseTime2 = -12e3) {
    let vc = 0;
    this.noteOffID[midiNote] = 0;
    this.noteOnID[midiNote] = 0;
    if (this._voiceCount > 0) {
      for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive && v.midiNote === midiNote) {
        v.overrideReleaseVolEnv = releaseTime2;
        v.isInRelease = false;
        v.releaseVoice(this.synthCore.currentTime);
        if (++vc >= this._voiceCount) break;
      }
    }
  }
  /**
  * Applies the `ChannelSnapshot` to this `MIDIChannel` instance.
  * @param snapshot The snapshot to apply.
  * @internal
  */
  applySnapshot(snapshot) {
    applySnapshot.call(this, snapshot);
  }
  /**
  * @internal
  */
  getSnapshot() {
    return getChannelSnapshot.call(this);
  }
  /**
  * Strictly internal, used by the sequencer for
  * very accurate portamento recreation.
  * @internal
  * @param midiNote
  */
  setLastNote(midiNote) {
    this.lastPortamentoNote = midiNote;
  }
  /**
  * @internal
  */
  destroy() {
    this.preset = void 0;
    this.lockedControllers = void 0;
    this._systemParameters = void 0;
    this._midiControllers = void 0;
    this._midiParameters = void 0;
  }
  resetGeneratorOverrides() {
    this.generators.overrides.fill(GENERATOR_OVERRIDE_NO_CHANGE_VALUE);
    this.generators.overridesEnabled = false;
  }
  setGeneratorOverride(gen, value, realtime = false) {
    this.generators.overrides[gen] = value;
    this.generators.overridesEnabled = true;
    if (realtime) {
      let vc = 0;
      if (this._voiceCount > 0) {
        for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive) {
          v.generators[gen] = value;
          this.computeModulators(v);
          if (++vc >= this._voiceCount) break;
        }
      }
    }
  }
  resetGeneratorOffsets() {
    this.generators.offsets.fill(0);
    this.generators.offsetsEnabled = false;
  }
  setGeneratorOffset(gen, value) {
    this.generators.offsets[gen] = value * GeneratorLimits[gen].nrpn;
    this.generators.offsetsEnabled = true;
    let vc = 0;
    if (this._voiceCount > 0) {
      for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive) {
        this.computeModulators(v);
        if (++vc >= this._voiceCount) break;
      }
    }
  }
  resetDrumParams() {
    if (this.synthCore.systemParameters.drumLock || !this._drumChannel) return;
    for (let i = 0; i < 128; i++) {
      const p = this.drumParams[i];
      p.pitch = 0;
      p.gain = 1;
      p.exclusiveClass = 0;
      p.pan = 64;
      p.reverbGain = DEFAULT_DRUM_REVERB[i] / 127;
      p.chorusGain = this.channelSystem === "xg" ? DEFAULT_DRUM_REVERB[i] / 127 : 0;
      p.delayGain = 0;
      p.rxNoteOn = true;
      p.rxNoteOff = false;
    }
  }
  computeModulatorsAll(sourceUsesCC, sourceIndex) {
    let vc = 0;
    if (this._voiceCount > 0) {
      for (const v of this.synthCore.voices) if (v.channel === this.channel && v.isActive) {
        this.computeModulators(v, sourceUsesCC, sourceIndex);
        if (++vc >= this._voiceCount) break;
      }
    }
  }
  setBankMSB(bankMSB) {
    if (this._systemParameters.presetLock) return;
    this.patch.bankMSB = bankMSB;
  }
  setBankLSB(bankLSB) {
    if (this._systemParameters.presetLock) return;
    this.patch.bankLSB = bankLSB;
  }
  /**
  * Sets drums on channel.
  */
  setDrumFlag(isDrum) {
    if (this._systemParameters.presetLock || !this.preset || this._drumChannel === isDrum) return;
    this._drumChannel = isDrum;
    this.updateInternalParams();
  }
};
var DEFAULT_GLOBAL_SYSTEM_PARAMETERS = {
  effectsEnabled: true,
  eventsEnabled: true,
  voiceCap: 350,
  autoAllocateVoices: false,
  reverbGain: 1,
  reverbLock: false,
  chorusGain: 1,
  chorusLock: false,
  delayGain: 1,
  delayLock: false,
  insertionEffectLock: false,
  drumLock: false,
  blackMIDIMode: false,
  deviceID: -1,
  gain: 1,
  pan: 0,
  keyShift: 0,
  fineTune: 0,
  interpolationType: InterpolationTypes.hermite,
  nrpnParamLock: false,
  monophonicRetrigger: false
};
function setSystemParameterInternal(parameter, value) {
  if (this.systemParameters[parameter] === value) return;
  const prev = this.systemParameters[parameter];
  this.systemParameters[parameter] = value;
  for (const ch of this.midiChannels) ch.updateInternalParams();
  switch (parameter) {
    default:
      break;
    case "voiceCap": {
      const cap = Math.min(value, 1e6);
      this.systemParameters.voiceCap = cap;
      for (let i = cap; i < this.voices.length; i++) this.voices[i].isActive = false;
      if (cap > this.voices.length) {
        SpessaLog.warn(`Allocating ${cap - this.voices.length} new voices!`);
        this.allocateNewVoices(cap - this.voices.length);
      }
      break;
    }
    case "keyShift":
      if (prev !== value) this.stopAllChannels(true);
  }
}
var SoundBankManagerPreset = class extends BasicPreset {
  constructor(p, offset) {
    super(p.parentSoundBank, p.globalZone);
    this.bankMSB = BankSelectHacks.addBankOffset(p.bankMSB, offset, true);
    this.name = p.name;
    this.bankLSB = p.bankLSB;
    this.isGMGSDrum = p.isGMGSDrum;
    this.program = p.program;
    this.genre = p.genre;
    this.morphology = p.morphology;
    this.library = p.library;
    this.zones = p.zones;
  }
};
var SoundBankManager = class {
  /**
  * All the sound banks, ordered from the most important to the least.
  */
  soundBankList = [];
  presetListChangeCallback;
  selectablePresetList = [];
  /**
  * @param presetListChangeCallback Supplied by the parent synthesizer class,
  * this is called whenever the preset list changes.
  */
  constructor(presetListChangeCallback) {
    this.presetListChangeCallback = presetListChangeCallback;
  }
  _presetList = [];
  /**
  * The list of all presets in the sound bank stack.
  */
  get presetList() {
    return [...this._presetList];
  }
  /**
  * The current sound bank priority order.
  * @returns The IDs of the sound banks in the current order.
  */
  get priorityOrder() {
    return this.soundBankList.map((s) => s.id);
  }
  /**
  * The current sound bank priority order.
  * @param newList The new order of sound bank IDs.
  */
  set priorityOrder(newList) {
    this.soundBankList.sort((a, b) => newList.indexOf(a.id) - newList.indexOf(b.id));
    this.generatePresetList();
  }
  /**
  * Deletes a given sound bank by its ID.
  * @param id the ID of the sound bank to delete.
  */
  deleteSoundBank(id) {
    if (this.soundBankList.length === 0) {
      SpessaLog.warn("1 soundbank left. Aborting!");
      return;
    }
    const index = this.soundBankList.findIndex((s) => s.id === id);
    if (index === -1) throw new Error(`No sound bank with id "${id}"`);
    this.soundBankList.splice(index, 1);
    this.generatePresetList();
  }
  /**
  * Adds a new sound bank with a given ID, or replaces an existing one.
  * @param font the sound bank to add.
  * @param id the ID of the sound bank.
  * @param bankOffset the bank offset of the sound bank.
  */
  addSoundBank(font, id, bankOffset = 0) {
    const foundBank = this.soundBankList.find((s) => s.id === id);
    if (foundBank === void 0) this.soundBankList.push({
      id,
      soundBank: font,
      bankOffset
    });
    else {
      foundBank.soundBank = font;
      foundBank.bankOffset = bankOffset;
    }
    this.generatePresetList();
  }
  /**
  * Gets a given preset from the sound bank stack.
  * @param patch The MIDI patch to search for.
  * @param system The MIDI system to select the preset for.
  * @returns An object containing the preset and its bank offset.
  * @internal
  */
  getPreset(patch, system) {
    if (this.soundBankList.length === 0 || this.selectablePresetList.length === 0) return;
    return MIDIPatchTools.selectPatch(this.selectablePresetList, patch, system);
  }
  destroy() {
    for (const s of this.soundBankList) s.soundBank.destroySoundBank();
    this.soundBankList = [];
  }
  generatePresetList() {
    const presetList = new Array();
    const addedPresets = /* @__PURE__ */ new Set();
    for (const s of this.soundBankList) {
      const bank = s.soundBank;
      const bankOffset = s.bankOffset;
      for (const p of bank.presets) {
        const selectablePreset = new SoundBankManagerPreset(p, bankOffset);
        if (!addedPresets.has(selectablePreset.toMIDIString())) {
          addedPresets.add(selectablePreset.toMIDIString());
          presetList.push(selectablePreset);
        }
      }
    }
    presetList.sort(MIDIPatchTools.compare.bind(MIDIPatchTools));
    this.selectablePresetList = presetList;
    this._presetList = presetList.map((p) => {
      return {
        bankMSB: p.bankMSB,
        bankLSB: p.bankLSB,
        program: p.program,
        isGMGSDrum: p.isGMGSDrum,
        name: p.name,
        isDrum: p.isDrum
      };
    });
    this.presetListChangeCallback();
  }
};
function getTuning(byte1, byte2, byte3) {
  const midiNote = byte1;
  const fraction = byte2 << 7 | byte3;
  if (byte1 === 127 && byte2 === 127 && byte3 === 127) return -1;
  return midiNote + fraction * 61e-6;
}
function universalSystemExclusive(syx, channelOffset = 0) {
  switch (syx[2]) {
    case 4:
      switch (syx[3]) {
        default:
          SpessaLog.gmFail("Device Control", syx);
          break;
        case 1: {
          const vol = syx[5] << 7 | syx[4];
          this.setMIDIParameter("volume", vol / 16383);
          SpessaLog.gmInfo("Master Volume", vol);
          break;
        }
        case 2: {
          const pan = ((syx[5] << 7 | syx[4]) - 8192) / 8192;
          this.setMIDIParameter("pan", pan);
          SpessaLog.gmInfo("Master Balance", pan);
          break;
        }
        case 3: {
          const cents = ((syx[5] << 7 | syx[4]) - 8192) / 81.92;
          this.setMIDIParameter("fineTune", cents);
          SpessaLog.gmInfo("Master Fine Tuning", cents, "cents");
          break;
        }
        case 4: {
          const keyShift = syx[5] - 64;
          this.setMIDIParameter("keyShift", keyShift);
          SpessaLog.gmInfo("Master Coarse Tuning", keyShift, "keys");
          break;
        }
        case 5:
          if (syx[4] !== 1 || syx[5] !== 1 || syx[6] !== 1 || syx[7] !== 1) {
            SpessaLog.gmFail("Global Parameter Control", syx);
            break;
          }
          switch (syx[8]) {
            default:
              SpessaLog.gmFail("Global Parameter Control", syx);
              break;
            case 1: {
              const value = syx[10];
              switch (syx[9]) {
                default:
                  SpessaLog.gmFail("Reverb Parameter Control", syx);
                  break;
                case 0: {
                  const macro = value === 8 ? 5 : value;
                  this.setReverbMacro(macro);
                  SpessaLog.gmInfo("Reverb Type", macro);
                  break;
                }
                case 1:
                  this.reverbProcessor.time = value;
                  SpessaLog.gmInfo("Reverb Time", value);
              }
              break;
            }
            case 2: {
              const value = syx[10];
              switch (syx[9]) {
                default:
                  SpessaLog.gmFail("Chorus Parameter Control", syx);
                  break;
                case 0:
                  this.setChorusMacro(value);
                  SpessaLog.gmInfo("Chorus Type", value);
                  break;
                case 1:
                  this.chorusProcessor.rate = value;
                  SpessaLog.gmInfo("Chorus Mod Rate", value);
                  break;
                case 2:
                  this.chorusProcessor.depth = value;
                  SpessaLog.gmInfo("Chorus Mod Depth", value);
                  break;
                case 3:
                  this.chorusProcessor.feedback = value;
                  SpessaLog.gmInfo("Chorus Mod Feedback", value);
                  break;
                case 4:
                  this.chorusProcessor.sendLevelToReverb = value;
                  SpessaLog.gmInfo("Chorus Send to Reverb", value);
                  break;
              }
            }
          }
      }
      break;
    case 9:
      switch (syx[3]) {
        default:
          SpessaLog.gmFail("System Exclusive", syx);
          break;
        case 1:
          SpessaLog.coolInfo("MIDI System", "General MIDI 1");
          this.reset("gm");
          break;
        case 2:
          SpessaLog.coolInfo("MIDI System", "Roland GS");
          this.reset("gs");
          break;
        case 3:
          SpessaLog.coolInfo("MIDI System", "General MIDI 2");
          this.reset("gm2");
          break;
      }
      break;
    case 8: {
      let currentMessageIndex = 4;
      switch (syx[3]) {
        case 1: {
          const program = syx[currentMessageIndex++];
          const tuningName = readBinaryString(syx, 16, currentMessageIndex);
          currentMessageIndex += 16;
          if (syx.length < 384) {
            SpessaLog.warn(`The Bulk Tuning Dump is too short! (${syx.length} bytes, at least 384 are expected)`);
            return;
          }
          for (let midiNote = 0; midiNote < 128; midiNote++) this.tunings[program * 128 + midiNote] = getTuning(syx[currentMessageIndex++], syx[currentMessageIndex++], syx[currentMessageIndex++]);
          SpessaLog.gmInfo("Bulk Tuning Dump", `${tuningName}, program ${program}`);
          break;
        }
        case 2:
        case 7: {
          if (syx[3] === 7) currentMessageIndex++;
          const tuningProgram = syx[currentMessageIndex++];
          const numberOfChanges = syx[currentMessageIndex++];
          for (let i = 0; i < numberOfChanges; i++) {
            const midiNote = syx[currentMessageIndex++];
            this.tunings[tuningProgram * 128 + midiNote] = getTuning(syx[currentMessageIndex++], syx[currentMessageIndex++], syx[currentMessageIndex++]);
          }
          SpessaLog.gmInfo("Single Note Tuning", `program: ${tuningProgram}. Keys affected: ${numberOfChanges}`);
          break;
        }
        case 9:
        case 8: {
          const newOctaveTuning = new Int8Array(12);
          if (syx[3] === 8) for (let i = 0; i < 12; i++) newOctaveTuning[i] = syx[7 + i] - 64;
          else for (let i = 0; i < 24; i += 2) {
            const tuning = (syx[7 + i] << 7 | syx[8 + i]) - 8192;
            newOctaveTuning[i / 2] = Math.floor(tuning / 81.92);
          }
          if ((syx[4] & 1) === 1) this.midiChannels[14 + channelOffset].setOctaveTuning(newOctaveTuning);
          if ((syx[4] >> 1 & 1) === 1) this.midiChannels[15 + channelOffset].setOctaveTuning(newOctaveTuning);
          for (let i = 0; i < 7; i++) if ((syx[5] >> i & 1) === 1) this.midiChannels[7 + i + channelOffset].setOctaveTuning(newOctaveTuning);
          for (let i = 0; i < 7; i++) if ((syx[6] >> i & 1) === 1) this.midiChannels[i + channelOffset].setOctaveTuning(newOctaveTuning);
          SpessaLog.gmInfo("Octave Scale Tuning", newOctaveTuning.join(" "));
          break;
        }
        default:
          SpessaLog.gmFail("MIDI Tuning Standard", syx);
          break;
      }
      break;
    }
    default:
      SpessaLog.gmFail("Universal System Exclusive", syx);
  }
}
function rolandSystemExclusive(syx, channelOffset = 0) {
  if (syx[3] === 18) switch (syx[2]) {
    case 66: {
      const a1 = syx[4];
      const a2 = syx[5];
      const a3 = syx[6];
      const data = Math.min(syx[7], 127);
      if (a1 === 0 && a2 === 0 && a3 === 127 && (data === 0 || data === 1)) {
        if (data === 1) {
          SpessaLog.gsInfo("Mode", "Double Module");
          while (this.midiChannels.length < 32) this.createMIDIChannel(true);
        }
        SpessaLog.coolInfo("MIDI System", "Roland GS");
        this.reset("gs");
        return;
      }
      if (a1 === 64 || a1 === 80) {
        if (a1 === 80) channelOffset += 16;
        if (a2 === 0) {
          switch (a3) {
            case 0: {
              const cents = ((data << 12 | syx[8] << 8 | syx[9] << 4 | syx[10]) - 1024) / 10;
              this.setMIDIParameter("fineTune", cents);
              SpessaLog.gsInfo("Master Tune", cents, "cents");
              break;
            }
            case 4:
              SpessaLog.gsInfo("Master Volume", data);
              this.setMIDIParameter("volume", data / 127);
              break;
            case 5: {
              const transpose = data - 64;
              SpessaLog.gsInfo("Master Key-Shift", transpose, "keys");
              this.setMIDIParameter("keyShift", transpose);
              break;
            }
            case 6: {
              const pan = (data - 64) / 63;
              SpessaLog.gsInfo("Master Pan", pan);
              this.setMIDIParameter("pan", pan);
              break;
            }
            case 127:
              if (data === 0) {
                SpessaLog.coolInfo("MIDI System", "Roland GS");
                this.reset("gs");
              } else if (data === 127) {
                SpessaLog.coolInfo("MIDI System", "General MIDI 1");
                this.reset("gm");
              }
              break;
            default:
              SpessaLog.gsFail("System Parameter", syx);
              break;
          }
          return;
        }
        if (a2 === 1) {
          const isReverb = a3 >= 48 && a3 <= 55;
          const isChorus = a3 >= 56 && a3 <= 64;
          const isDelay = a3 >= 80 && a3 <= 90;
          if (isReverb && this.systemParameters.reverbLock) return;
          if (isChorus && this.systemParameters.chorusLock) return;
          if (isDelay && this.systemParameters.delayLock) return;
          switch (a3) {
            default:
              SpessaLog.gsFail("Patch Common Parameter", [a3]);
              break;
            case 0: {
              const patchName = readBinaryString(syx, 16, 7);
              SpessaLog.gsInfo("Patch name", patchName);
              this.callEvent("displayMessage", [...syx]);
              break;
            }
            case 48:
              this.setReverbMacro(data);
              SpessaLog.gsInfo("Reverb Macro", data);
              break;
            case 49:
              this.reverbProcessor.character = data;
              SpessaLog.gsInfo("Reverb Character", data);
              this.callEvent("effectChange", {
                effect: "reverb",
                parameter: "character",
                value: data
              });
              break;
            case 50:
              this.reverbProcessor.preLowpass = data;
              SpessaLog.gsInfo("Reverb Pre-LPF", data);
              this.callEvent("effectChange", {
                effect: "reverb",
                parameter: "preLowpass",
                value: data
              });
              break;
            case 51:
              this.reverbProcessor.level = data;
              SpessaLog.gsInfo("Reverb Level", data);
              this.callEvent("effectChange", {
                effect: "reverb",
                parameter: "level",
                value: data
              });
              break;
            case 52:
              this.reverbProcessor.time = data;
              SpessaLog.gsInfo("Reverb Time", data);
              this.callEvent("effectChange", {
                effect: "reverb",
                parameter: "time",
                value: data
              });
              break;
            case 53:
              this.reverbProcessor.delayFeedback = data;
              SpessaLog.gsInfo("Reverb Delay Feedback", data);
              this.callEvent("effectChange", {
                effect: "reverb",
                parameter: "delayFeedback",
                value: data
              });
              break;
            case 54:
              break;
            case 55:
              this.reverbProcessor.preDelayTime = data;
              SpessaLog.gsInfo("Reverb Predelay Time", data);
              this.callEvent("effectChange", {
                effect: "reverb",
                parameter: "preDelayTime",
                value: data
              });
              break;
            case 56:
              this.setChorusMacro(data);
              SpessaLog.gsInfo("Chorus Macro", data);
              break;
            case 57:
              this.chorusProcessor.preLowpass = data;
              SpessaLog.gsInfo("Chorus Pre-LPF", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "preLowpass",
                value: data
              });
              break;
            case 58:
              this.chorusProcessor.level = data;
              SpessaLog.gsInfo("Chorus Level", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "level",
                value: data
              });
              break;
            case 59:
              this.chorusProcessor.feedback = data;
              SpessaLog.gsInfo("Chorus Feedback", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "feedback",
                value: data
              });
              break;
            case 60:
              this.chorusProcessor.delay = data;
              SpessaLog.gsInfo("Chorus Delay", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "delay",
                value: data
              });
              break;
            case 61:
              this.chorusProcessor.rate = data;
              SpessaLog.gsInfo("Chorus Rate", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "rate",
                value: data
              });
              break;
            case 62:
              this.chorusProcessor.depth = data;
              SpessaLog.gsInfo("Chorus Depth", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "depth",
                value: data
              });
              break;
            case 63:
              this.chorusProcessor.sendLevelToReverb = data;
              SpessaLog.gsInfo("Chorus Send Level To Reverb", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "sendLevelToReverb",
                value: data
              });
              break;
            case 64:
              this.chorusProcessor.sendLevelToDelay = data;
              this.updateActiveEffects();
              SpessaLog.gsInfo("Chorus Send Level To Delay", data);
              this.callEvent("effectChange", {
                effect: "chorus",
                parameter: "sendLevelToDelay",
                value: data
              });
              break;
            case 80:
              this.setDelayMacro(data);
              SpessaLog.gsInfo("Delay Macro", data);
              break;
            case 81:
              this.delayProcessor.preLowpass = data;
              SpessaLog.gsInfo("Delay Pre-LPF", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "preLowpass",
                value: data
              });
              break;
            case 82:
              this.delayProcessor.timeCenter = data;
              SpessaLog.gsInfo("Delay Time Center", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "timeCenter",
                value: data
              });
              break;
            case 83:
              this.delayProcessor.timeRatioLeft = data;
              SpessaLog.gsInfo("Delay Time Ratio Left", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "timeRatioLeft",
                value: data
              });
              break;
            case 84:
              this.delayProcessor.timeRatioRight = data;
              SpessaLog.gsInfo("Delay Time Ratio Right", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "timeRatioRight",
                value: data
              });
              break;
            case 85:
              this.delayProcessor.levelCenter = data;
              SpessaLog.gsInfo("Delay Level Center", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "levelCenter",
                value: data
              });
              break;
            case 86:
              this.delayProcessor.levelLeft = data;
              SpessaLog.gsInfo("Delay Level Left", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "levelLeft",
                value: data
              });
              break;
            case 87:
              this.delayProcessor.levelRight = data;
              SpessaLog.gsInfo("Delay Level Right", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "levelRight",
                value: data
              });
              break;
            case 88:
              this.delayProcessor.level = data;
              SpessaLog.gsInfo("Delay Level", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "level",
                value: data
              });
              break;
            case 89:
              this.delayProcessor.feedback = data;
              SpessaLog.gsInfo("Delay Feedback", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "feedback",
                value: data
              });
              break;
            case 90:
              this.delayProcessor.sendLevelToReverb = data;
              SpessaLog.gsInfo("Delay Send Level To Reverb", data);
              this.callEvent("effectChange", {
                effect: "delay",
                parameter: "sendLevelToReverb",
                value: data
              });
              break;
          }
          break;
        }
        if (a2 === 3) {
          if (this.systemParameters.insertionEffectLock) return;
          if (a3 >= 3 && a3 <= 25) this.insertionParams[a3 - 3] = data;
          if (a3 >= 3 && a3 <= 22) {
            this.insertionProcessor.setParameter(a3, data);
            SpessaLog.gsInfo(`EFX Parameter ${a3 - 2}`, data);
            this.callEvent("effectChange", {
              effect: "insertion",
              parameter: a3,
              value: data
            });
            return;
          }
          switch (a3) {
            default:
              SpessaLog.gsFail("Insertion Effect", [a3]);
              return;
            case 0: {
              const type = data << 8 | syx[8];
              const proc = this.insertionEffects.get(type);
              if (proc) {
                SpessaLog.gsInfo("EFX Type", type.toString(16));
                this.insertionProcessor = proc;
              } else {
                this.insertionProcessor = this.insertionFallback;
                SpessaLog.gsFail("EFX Processor", [type], "Using Thru.");
              }
              this.resetInsertionParams();
              this.insertionProcessor.reset();
              this.callEvent("effectChange", {
                effect: "insertion",
                parameter: 0,
                value: type
              });
              return;
            }
            case 23:
              this.insertionProcessor.sendLevelToReverb = data / 127 * EFX_SENDS_GAIN_CORRECTION;
              SpessaLog.gsInfo("EFX Send Level to Reverb", data);
              this.callEvent("effectChange", {
                effect: "insertion",
                parameter: a3,
                value: data
              });
              return;
            case 24:
              this.insertionProcessor.sendLevelToChorus = data / 127 * EFX_SENDS_GAIN_CORRECTION;
              SpessaLog.gsInfo("EFX Send Level to Chorus", data);
              this.callEvent("effectChange", {
                effect: "insertion",
                parameter: a3,
                value: data
              });
              return;
            case 25:
              this.insertionProcessor.sendLevelToDelay = data / 127 * EFX_SENDS_GAIN_CORRECTION;
              this.updateActiveEffects();
              SpessaLog.gsInfo("EFX Send Level to Delay", data);
              this.callEvent("effectChange", {
                effect: "insertion",
                parameter: a3,
                value: data
              });
              return;
          }
        }
        if (a2 >> 4 === 1) {
          const channel = MIDIUtils.syxToChannel(a2 & 15) + channelOffset;
          const ch = this.midiChannels[channel];
          if (!ch) {
            SpessaLog.gsFail(`Patch Parameter for ${channel}`, syx, "Invalid part number.");
            return;
          }
          switch (a3) {
            default:
              SpessaLog.gsFail(`Patch Part Parameter for ${channel}`, [a3]);
              return;
            case 0:
              ch.controllerChange(MIDIControllers.bankSelect, data);
              ch.programChange(syx[8]);
              break;
            case 2: {
              const rxChannel = data === 16 ? -1 : data + channelOffset;
              ch.setMIDIParameter("rxChannel", rxChannel);
              this.customChannelNumbers ||= rxChannel !== ch.channel;
              SpessaLog.gsInfo(`Rx. Channel on ${channel}`, rxChannel);
              break;
            }
            case 19:
              ch.setMIDIParameter("polyMode", data === 1);
              SpessaLog.gsInfo(`Mono/poly on ${channel}`, ch.midiParameters.polyMode ? "POLY" : "MONO");
              break;
            case 20:
              ch.setMIDIParameter("assignMode", data);
              SpessaLog.gsInfo(`Assign mode on ${channel}`, data);
              break;
            case 21: {
              ch.setMIDIParameter("drumMap", data);
              const isDrums = data > 0;
              ch.setGSDrums(isDrums);
              SpessaLog.gsInfo(`Drums on ${channel}`, isDrums.toString());
              return;
            }
            case 22: {
              const keyShift = data - 64;
              ch.setMIDIParameter("keyShift", keyShift);
              SpessaLog.gsInfo(`Key Shift for ${channel}`, keyShift);
              return;
            }
            case 25:
              ch.controllerChange(MIDIControllers.mainVolume, data);
              return;
            case 26:
              ch.setMIDIParameter("velocitySenseDepth", data);
              SpessaLog.gsInfo(`Velocity Sense Depth for ${channel}`, data);
              return;
            case 27:
              ch.setMIDIParameter("velocitySenseOffset", data);
              SpessaLog.gsInfo(`Velocity Sense Offset for ${channel}`, data);
              return;
            case 28: {
              const panPosition = data;
              const randomPan = panPosition === 0;
              ch.setMIDIParameter("randomPan", randomPan);
              if (randomPan) SpessaLog.gsInfo(`Random pan on ${channel}`, "ON");
              else ch.controllerChange(MIDIControllers.pan, panPosition);
              break;
            }
            case 31:
              ch.setMIDIParameter("cc1", data);
              SpessaLog.gsInfo(`CC1 Controller Number for ${channel}`, data);
              break;
            case 32:
              ch.setMIDIParameter("cc2", data);
              SpessaLog.gsInfo(`CC2 Controller Number for ${channel}`, data);
              break;
            case 33:
              ch.controllerChange(MIDIControllers.chorusDepth, data);
              break;
            case 34:
              ch.controllerChange(MIDIControllers.reverbDepth, data);
              break;
            case 42: {
              const cents = ((data << 7 | syx[8]) - 8192) / 81.92;
              ch.setMIDIParameter("fineTune", cents);
              SpessaLog.gsInfo(`Fine tuning for ${channel}`, Math.round(cents), "cents");
              break;
            }
            case 44:
              ch.controllerChange(MIDIControllers.variationDepth, data);
              break;
            case 48:
              ch.controllerChange(MIDIControllers.vibratoRate, data);
              break;
            case 49:
              ch.controllerChange(MIDIControllers.vibratoDepth, data);
              break;
            case 50:
              ch.controllerChange(MIDIControllers.brightness, data);
              break;
            case 51:
              ch.controllerChange(MIDIControllers.filterResonance, data);
              break;
            case 52:
              ch.controllerChange(MIDIControllers.attackTime, data);
              break;
            case 53:
              ch.controllerChange(MIDIControllers.decayTime, data);
              break;
            case 54:
              ch.controllerChange(MIDIControllers.releaseTime, data);
              break;
            case 55:
              ch.controllerChange(MIDIControllers.vibratoDelay, data);
              break;
            case 64: {
              const tuningBytes = syx.length - 9;
              const newTuning = new Int8Array(12);
              for (let i = 0; i < tuningBytes; i++) newTuning[i] = syx[i + 7] - 64;
              ch.setOctaveTuning(newTuning);
              SpessaLog.gsInfo(`Octave Scale Tuning for ${channel}`, newTuning.join(", "));
              break;
            }
          }
          return;
        }
        if (a2 >> 4 === 2) {
          const channel = MIDIUtils.syxToChannel(a2 & 15) + channelOffset;
          const ch = this.midiChannels[channel];
          switch (a3 & 240) {
            default:
              SpessaLog.gsFail(`Patch Parameter Controller for ${channel}`, [a3 & 240]);
              break;
            case 0:
              if ((a3 & 15) === 4) {
                const cents = data / 127 * 600;
                ch.setMIDIParameter("modulationDepth", cents);
                SpessaLog.gsInfo(`Modulation depth for ${channel}`, Math.round(cents), "cents");
                break;
              }
              ch.dynamicModulators.setupReceiver(a3, data, MIDIControllers.modulationWheel, true, "mod wheel");
              break;
            case 16:
              if ((a3 & 15) === 0) {
                const centeredValue = data - 64;
                ch.setMIDIParameter("pitchWheelRange", centeredValue);
                SpessaLog.gsInfo(`Pitch Wheel Range for ${channel}`, centeredValue, "semitones");
                break;
              }
              ch.dynamicModulators.setupReceiver(a3, data, ModulatorControllerSources.pitchWheel, false, "pitch wheel", true);
              break;
            case 32:
              ch.dynamicModulators.setupReceiver(a3, data, ModulatorControllerSources.channelPressure, false, "channel pressure");
              break;
            case 48:
              ch.dynamicModulators.setupReceiver(a3, data, ModulatorControllerSources.polyPressure, false, "poly pressure");
              break;
            case 64:
              ch.dynamicModulators.setupReceiver(a3, data, ch.midiParameters.cc1, true, "CC1");
              break;
            case 80:
              ch.dynamicModulators.setupReceiver(a3, data, ch.midiParameters.cc2, true, "CC2");
          }
          return;
        }
        if (a2 >> 4 === 4) {
          const channel = MIDIUtils.syxToChannel(a2 & 15) + channelOffset;
          const ch = this.midiChannels[channel];
          switch (a3) {
            default:
              SpessaLog.gsFail("Patch Part Parameter", [a3]);
              break;
            case 0:
            case 1:
              ch.controllerChange(MIDIControllers.bankSelectLSB, data);
              break;
            case 34: {
              const efx = data === 1;
              ch.setMIDIParameter("efxAssign", efx);
              SpessaLog.gsInfo(`EFX assign for ${channel}`, efx ? "EFX" : "BYPASS");
              this.updateActiveEffects();
            }
          }
          return;
        }
        SpessaLog.gsFail("Patch Parameter", syx);
        return;
      }
      if (a1 === 65 || a1 === 81) {
        if (this.systemParameters.drumLock) return;
        const map = (a2 >> 4) + 1;
        const drumKey = a3;
        const param = a2 & 15;
        switch (param) {
          default:
            SpessaLog.gsFail("Drum Setup", [param]);
            return;
          case 0: {
            const patchName = readBinaryString(syx, 12, 7);
            SpessaLog.gsInfo(`Drum Map Name for MAP${map}`, patchName);
            this.callEvent("displayMessage", [...syx]);
            break;
          }
          case 1: {
            const pitch = data - 60;
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].pitch = pitch * (ch.patch.bankLSB === 1 ? 100 : 50);
            }
            SpessaLog.gsInfo(`Drum Pitch for MAP${map}, key ${drumKey}`, pitch);
            break;
          }
          case 2:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].gain = data / 120;
            }
            SpessaLog.gsInfo(`Drum Level for MAP${map}, key ${drumKey}`, data);
            break;
          case 3:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].exclusiveClass = data;
            }
            SpessaLog.gsInfo(`Drum Assign Group for MAP${map}, key ${drumKey}`, data);
            break;
          case 4:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].pan = data;
            }
            SpessaLog.gsInfo(`Drum Pan for MAP${map}, key ${drumKey}`, data);
            break;
          case 5:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].reverbGain = data / 127;
            }
            SpessaLog.gsInfo(`Drum Reverb for MAP${map}, key ${drumKey}`, data);
            break;
          case 6:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].chorusGain = data / 127;
            }
            SpessaLog.gsInfo(`Drum Chorus for MAP${map}, key ${drumKey}`, data);
            break;
          case 7:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].rxNoteOff = data === 1;
            }
            SpessaLog.gsInfo(`Drum Note Off for MAP${map}, key ${drumKey}`, data === 1 ? "ON" : "OFF");
            break;
          case 8:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].rxNoteOn = data === 1;
            }
            SpessaLog.gsInfo(`Drum Note On for MAP${map}, key ${drumKey}`, data === 1 ? "ON" : "OFF");
            break;
          case 9:
            for (const ch of this.midiChannels) {
              if (ch.midiParameters.drumMap !== map) continue;
              ch.drumParams[drumKey].delayGain = data / 127;
            }
            SpessaLog.gsInfo(`Drum Delay for MAP${map}, key ${drumKey}`, data);
            break;
        }
        return;
      }
      SpessaLog.gsFail("System Exclusive", syx);
      return;
    }
    case 69:
      if (syx[4] === 16) this.callEvent("displayMessage", [...syx]);
      return;
    case 22:
      if (syx[4] === 16) {
        this.setMIDIParameter("volume", syx[7] / 100);
        SpessaLog.coolInfo("Roland Master Volume Control", syx[7]);
        return;
      } else SpessaLog.unsupported("Roland", syx);
  }
  else {
    SpessaLog.unsupported("Roland", syx);
    return;
  }
}
function yamahaSystemExclusive(syx, channelOffset = 0) {
  if (syx[2] === 76) {
    const a1 = syx[3];
    const a2 = syx[4];
    const a3 = syx[5];
    const data = syx[6];
    if (a1 === 0 && a2 === 0) {
      switch (a3) {
        case 0:
          {
            const cents = (((syx[6] & 15) << 12 | (syx[7] & 15) << 8 | (syx[8] & 15) << 4 | syx[9] & 15) - 1024) / 10;
            this.setMIDIParameter("fineTune", cents);
            SpessaLog.xgInfo("Master Tune", cents, "cents");
          }
          break;
        case 4:
          this.setMIDIParameter("volume", data / 127);
          SpessaLog.xgInfo("Master Volume", data);
          break;
        case 5: {
          const vol = 127 - data;
          this.setMIDIParameter("volume", vol / 127);
          SpessaLog.xgInfo("Master Attenuation", data);
          break;
        }
        case 6: {
          const transpose = data - 64;
          this.setMIDIParameter("keyShift", transpose);
          SpessaLog.xgInfo("Master Transpose", data);
          break;
        }
        case 127:
        case 126:
          SpessaLog.coolInfo("MIDI System", "Yamaha XG");
          this.reset("xg");
          break;
      }
      return;
    }
    if (a1 === 2 && a2 === 1) {
      let effectType;
      const effect = a3;
      if (effect <= 21) effectType = "Reverb";
      else if (effect <= 53) effectType = "Chorus";
      else effectType = "Variation";
      SpessaLog.xgFail(`${effectType} parameter`, [effect]);
      return;
    }
    if (a1 === 8) {
      const channel = a2 + channelOffset;
      const ch = this.midiChannels[channel];
      if (!ch) {
        SpessaLog.xgFail(`Part Setup for ${channel}`, syx, `Invalid part number.`);
        return;
      }
      switch (a3) {
        default:
          SpessaLog.xgFail("Part Setup", [syx[5]]);
          break;
        case 1:
          ch.controllerChange(MIDIControllers.bankSelect, data);
          break;
        case 2:
          ch.controllerChange(MIDIControllers.bankSelectLSB, data);
          break;
        case 3:
          ch.programChange(data);
          break;
        case 4: {
          const rxChannel = data + channelOffset;
          ch.setMIDIParameter("rxChannel", rxChannel);
          this.customChannelNumbers ||= rxChannel !== ch.channel;
          SpessaLog.xgInfo(`Rev. Channel on ${channel}`, rxChannel);
          break;
        }
        case 5: {
          const poly = data === 1;
          ch.setMIDIParameter("polyMode", poly);
          SpessaLog.xgInfo(`Mono/poly on ${channel}`, poly ? "POLY" : "MONO");
          break;
        }
        case 6:
          ch.setMIDIParameter("assignMode", data);
          SpessaLog.xgInfo(`Same Note Number Key On Assign on ${channel}`, data);
          break;
        case 7: {
          const drums = data !== 0;
          ch.setDrums(drums);
          SpessaLog.xgInfo(`Part Mode on ${channel}`, drums ? "DRUM" : "MELODIC");
          break;
        }
        case 8: {
          const keyShift = data - 64;
          ch.setMIDIParameter("keyShift", keyShift);
          SpessaLog.xgInfo(`Key Shift on ${channel}`, keyShift);
          break;
        }
        case 11:
          ch.controllerChange(MIDIControllers.mainVolume, data);
          break;
        case 12:
          ch.setMIDIParameter("velocitySenseDepth", data);
          SpessaLog.xgInfo(`Velocity Sense Depth on ${channel}`, data);
          return;
        case 13:
          ch.setMIDIParameter("velocitySenseOffset", data);
          SpessaLog.xgInfo(`Velocity Sense Offset on ${channel}`, data);
          return;
        case 14: {
          const pan = data;
          const randomPan = pan === 0;
          ch.setMIDIParameter("randomPan", randomPan);
          if (randomPan) SpessaLog.xgInfo(`Random Pan for ${channel}`, "ON");
          else ch.controllerChange(MIDIControllers.pan, pan);
          break;
        }
        case 18:
          ch.controllerChange(MIDIControllers.chorusDepth, data);
          break;
        case 19:
          ch.controllerChange(MIDIControllers.reverbDepth, data);
          break;
        case 21:
          ch.controllerChange(MIDIControllers.vibratoRate, data);
          break;
        case 22:
          ch.controllerChange(MIDIControllers.vibratoDepth, data);
          break;
        case 23:
          ch.controllerChange(MIDIControllers.vibratoDelay, data);
          break;
        case 24:
          ch.controllerChange(MIDIControllers.brightness, data);
          break;
        case 25:
          ch.controllerChange(MIDIControllers.filterResonance, data);
          break;
        case 26:
          ch.controllerChange(MIDIControllers.attackTime, data);
          break;
        case 27:
          ch.controllerChange(MIDIControllers.decayTime, data);
          break;
        case 28:
          ch.controllerChange(MIDIControllers.releaseTime, data);
          break;
        case 35: {
          const centeredValue = data - 64;
          ch.setMIDIParameter("pitchWheelRange", centeredValue);
          SpessaLog.xgInfo(`Pitch Wheel Range for ${channel}`, centeredValue, "semitones");
        }
      }
      return;
    }
    if (a1 >> 4 === 3) {
      if (this.systemParameters.drumLock) return;
      const drumKey = a2;
      switch (a3) {
        default:
          SpessaLog.xgFail("Drum Setup", [a3]);
          return;
        case 0: {
          const pitch = (data - 64) * 100;
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].pitch = pitch;
          }
          SpessaLog.xgInfo(`Drum Pitch for key ${drumKey}`, pitch, "semitones");
          break;
        }
        case 1: {
          const pitch = data - 64;
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].pitch += pitch;
            SpessaLog.xgInfo(`Drum Pitch for key ${drumKey}`, ch.drumParams[drumKey].pitch, "semitones");
          }
          break;
        }
        case 2:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].gain = data / 120;
          }
          SpessaLog.xgInfo(`Drum Level for key ${drumKey}`, data);
          break;
        case 3:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].exclusiveClass = data;
          }
          SpessaLog.xgInfo(`Drum Alternate Group for key ${drumKey}`, data);
          break;
        case 4:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].pan = data;
          }
          SpessaLog.xgInfo(`Drum Pan for key ${drumKey}`, data);
          break;
        case 5:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].reverbGain = data / 127;
          }
          SpessaLog.xgInfo(`Drum Reverb for key ${drumKey}`, data);
          break;
        case 6:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].chorusGain = data / 127;
          }
          SpessaLog.xgInfo(`Drum Chorus for key ${drumKey}`, data);
          break;
        case 9:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].rxNoteOff = data === 1;
          }
          SpessaLog.xgInfo(`Drum Note Off for key ${drumKey}`, data === 1 ? "ON" : "OFF");
          break;
        case 10:
          for (const ch of this.midiChannels) {
            if (!ch.drumChannel) continue;
            ch.drumParams[drumKey].rxNoteOn = data === 1;
          }
          SpessaLog.xgInfo(`Drum Note On for key ${drumKey}`, data === 1 ? "ON" : "OFF");
          break;
      }
      return;
    }
    if (a1 === 6 || a1 === 7) {
      this.callEvent("displayMessage", [...syx]);
      return;
    }
    SpessaLog.xgFail("System Exclusive", syx, "Unknown address");
  } else SpessaLog.xgFail("System Exclusive", syx);
}
function systemExclusiveInternal(syx, channelOffset = 0) {
  channelOffset += this.portSelectChannelOffset;
  const manufacturer = syx[0];
  if (this.systemParameters.deviceID !== -1 && syx[1] !== 127 && this.systemParameters.deviceID !== syx[1]) return;
  switch (manufacturer) {
    default:
      SpessaLog.unsupported("System Exclusive", syx, `Unknown manufacturer: ${manufacturer}`);
      break;
    case 126:
    case 127:
      universalSystemExclusive.call(this, syx, channelOffset);
      break;
    case 65:
      rolandSystemExclusive.call(this, syx, channelOffset);
      break;
    case 67:
      yamahaSystemExclusive.call(this, syx, channelOffset);
      break;
    case 245:
      if (syx.length < 2) return;
      this.portSelectChannelOffset = (syx[1] - 1) * 16;
      while (this.midiChannels.length <= this.portSelectChannelOffset) {
        SpessaLog.info(`%cPort select, channel offset %c${this.portSelectChannelOffset}%c. Creating a new port!`, ConsoleColors.info, ConsoleColors.value, ConsoleColors.info);
        for (let i = 0; i < 16; i++) this.createMIDIChannel(true);
      }
      break;
  }
}
var CB_SILENCE = 960;
var PERCEIVED_CB_SILENCE = 900;
var VolumeEnvelope = class {
  /**
  * The target gain for the current rendering block.
  */
  outputGain = 0;
  /**
  * The current attenuation of the envelope in cB.
  */
  attenuationCb = CB_SILENCE;
  /**
  * The current stage of the volume envelope.
  */
  state = 0;
  /**
  * The sample rate in Hz.
  */
  sampleRate;
  /**
  * The sample count between updates of the volume envelope.
  * Since the volume envelope calculation runs once per rendering quantum,
  * this effectively the buffer size.
  */
  updateInterval;
  /**
  * The envelope's current time in samples.
  */
  sampleTime = 0;
  /**
  * The dB attenuation of the envelope when it entered the release stage.
  */
  releaseStartCb = CB_SILENCE;
  /**
  * The time in samples relative to the start of the envelope.
  */
  releaseStartTimeSamples = 0;
  /**
  * The attack duration in samples.
  */
  attackDuration = 0;
  /**
  * The decay duration in samples.
  */
  decayDuration = 0;
  /**
  * The release duration in samples.
  */
  releaseDuration = 0;
  /**
  * The voice's sustain amount in cB.
  */
  sustainCb = 0;
  /**
  * The time in samples to the end of delay stage, relative to the start of the envelope.
  */
  delayEnd = 0;
  /**
  * The time in samples to the end of attack stage, relative to the start of the envelope.
  */
  attackEnd = 0;
  /**
  * The time in samples to the end of hold stage, relative to the start of the envelope.
  */
  holdEnd = 0;
  /**
  * The time in samples to the end of decay stage, relative to the start of the envelope.
  */
  decayEnd = 0;
  /**
  * If the volume envelope has ever entered the release phase.
  * @private
  */
  enteredRelease = false;
  /**
  * If sustain stage is silent,
  * then we can turn off the voice when it is silent.
  * We can't do that with modulated as it can silence the volume and then raise it again, and the voice must keep playing.
  */
  canEndOnSilentSustain = false;
  /**
  * @param sampleRate Hz
  * @param bufferSize samples
  */
  constructor(sampleRate, bufferSize) {
    this.sampleRate = sampleRate;
    this.updateInterval = bufferSize;
  }
  /**
  * Starts the release phase in the envelope.
  * @param voice the voice this envelope belongs to.
  */
  startRelease(voice) {
    this.releaseStartTimeSamples = this.sampleTime;
    const timecents = voice.overrideReleaseVolEnv || voice.modulatedGenerators[GeneratorTypes.releaseVolEnv];
    this.releaseDuration = this.timecentsToSamples(Math.max(-7200, timecents));
    if (this.enteredRelease) this.releaseStartCb = this.attenuationCb;
    else {
      const sustainCb = Math.max(0, Math.min(CB_SILENCE, this.sustainCb));
      const fraction = sustainCb / CB_SILENCE;
      const keyNumAddition = (60 - voice.targetKey) * voice.modulatedGenerators[GeneratorTypes.keyNumToVolEnvDecay];
      this.decayDuration = this.timecentsToSamples(voice.modulatedGenerators[GeneratorTypes.decayVolEnv] + keyNumAddition) * fraction;
      switch (this.state) {
        case 0:
          this.releaseStartCb = CB_SILENCE;
          break;
        case 1: {
          const elapsed = 1 - (this.attackEnd - this.releaseStartTimeSamples) / this.attackDuration;
          this.releaseStartCb = 200 * Math.log10(elapsed) * -1;
          break;
        }
        case 2:
          this.releaseStartCb = 0;
          break;
        case 3:
          this.releaseStartCb = (1 - (this.decayEnd - this.releaseStartTimeSamples) / this.decayDuration) * sustainCb;
          break;
        case 4:
          this.releaseStartCb = sustainCb;
          break;
      }
      this.releaseStartCb = Math.max(0, Math.min(this.releaseStartCb, CB_SILENCE));
      this.attenuationCb = this.releaseStartCb;
    }
    this.enteredRelease = true;
    const releaseFraction = (CB_SILENCE - this.releaseStartCb) / CB_SILENCE;
    this.releaseDuration *= releaseFraction;
    if (this.releaseStartCb >= PERCEIVED_CB_SILENCE) voice.isActive = false;
  }
  /**
  * Initialize the volume envelope
  * @param voice The voice this envelope belongs to
  */
  init(voice) {
    this.enteredRelease = false;
    this.state = 0;
    this.sampleTime = 0;
    this.outputGain = 0;
    this.attenuationCb = CB_SILENCE;
    this.releaseStartCb = CB_SILENCE;
    this.releaseStartTimeSamples = 0;
    this.releaseDuration = 0;
    this.canEndOnSilentSustain = voice.modulatedGenerators[GeneratorTypes.sustainVolEnv] >= PERCEIVED_CB_SILENCE;
    this.sustainCb = Math.min(CB_SILENCE, voice.modulatedGenerators[GeneratorTypes.sustainVolEnv]);
    this.attackDuration = this.timecentsToSamples(voice.modulatedGenerators[GeneratorTypes.attackVolEnv]);
    const keyNumAddition = (60 - voice.targetKey) * voice.modulatedGenerators[GeneratorTypes.keyNumToVolEnvDecay];
    const fraction = this.sustainCb / CB_SILENCE;
    this.decayDuration = this.timecentsToSamples(voice.modulatedGenerators[GeneratorTypes.decayVolEnv] + keyNumAddition) * fraction;
    this.delayEnd = this.timecentsToSamples(voice.modulatedGenerators[GeneratorTypes.delayVolEnv]);
    this.attackEnd = this.attackDuration + this.delayEnd;
    const holdExcursion = (60 - voice.targetKey) * voice.modulatedGenerators[GeneratorTypes.keyNumToVolEnvHold];
    this.holdEnd = this.timecentsToSamples(voice.modulatedGenerators[GeneratorTypes.holdVolEnv] + holdExcursion) + this.attackEnd;
    this.decayEnd = this.decayDuration + this.holdEnd;
    if (this.attackEnd <= this.updateInterval) this.state = 2;
  }
  /**
  * Calculates the gain value for the last sample in the block and writes it to `outputGain`.
  * Essentially we use approach of 100dB is silence, 0dB is peak.
  * @param sampleCount the amount of samples to write
  * @param gainTarget the gain to apply.
  * @returns if the voice has finished.
  */
  process(sampleCount, gainTarget) {
    const { releaseStartTimeSamples, releaseStartCb, releaseDuration, delayEnd, attackEnd, attackDuration, holdEnd, decayEnd, decayDuration, sustainCb } = this;
    const sampleTime = this.sampleTime += sampleCount;
    if (this.enteredRelease) {
      const elapsedRelease = sampleTime - releaseStartTimeSamples;
      const cbDifference = CB_SILENCE - releaseStartCb;
      this.attenuationCb = elapsedRelease / releaseDuration * cbDifference + releaseStartCb;
      this.outputGain = CENTIBEL_LOOKUP_TABLE[this.attenuationCb - MIN_CENTIBELS | 0] * gainTarget;
      return this.attenuationCb < PERCEIVED_CB_SILENCE;
    }
    switch (this.state) {
      case 0:
        if (sampleTime < delayEnd) {
          this.attenuationCb = CB_SILENCE;
          this.outputGain = 0;
          return true;
        }
        this.state++;
      case 1:
        if (sampleTime < attackEnd) {
          this.attenuationCb = 0;
          const linearGain = 1 - (attackEnd - sampleTime) / attackDuration;
          this.outputGain = linearGain * gainTarget;
          return true;
        }
        this.state++;
      case 2:
        if (sampleTime < holdEnd) {
          this.attenuationCb = 0;
          this.outputGain = gainTarget;
          return true;
        }
        this.state++;
      case 3:
        if (sampleTime < decayEnd) {
          this.attenuationCb = (1 - (decayEnd - sampleTime) / decayDuration) * sustainCb;
          this.outputGain = gainTarget * CENTIBEL_LOOKUP_TABLE[this.attenuationCb - MIN_CENTIBELS | 0];
          return true;
        }
        this.state++;
      case 4:
        if (this.canEndOnSilentSustain && sustainCb >= PERCEIVED_CB_SILENCE) {
          this.attenuationCb = CB_SILENCE;
          this.outputGain = 0;
          return false;
        }
        this.attenuationCb = sustainCb;
        this.outputGain = gainTarget * CENTIBEL_LOOKUP_TABLE[sustainCb - MIN_CENTIBELS | 0];
        return true;
    }
  }
  timecentsToSamples(tc) {
    return Math.max(0, Math.floor(timecentsToSeconds(tc) * this.sampleRate));
  }
};
var MODENV_PEAK = 1;
var CONVEX_ATTACK = new Float32Array(1e3);
for (let i = 0; i < CONVEX_ATTACK.length; i++) CONVEX_ATTACK[i] = getModulatorCurveValue(0, ModulatorCurveTypes.convex, i / 1e3);
var ModulationEnvelope = class {
  /**
  * The attack duration, in seconds.
  */
  attackDuration = 0;
  /**
  * The decay duration, in seconds.
  */
  decayDuration = 0;
  /**
  * The hold duration, in seconds.
  */
  holdDuration = 0;
  /**
  * Release duration, in seconds.
  */
  releaseDuration = 0;
  /**
  * The sustain level 0-1.
  */
  sustainLevel = 0;
  /**
  * Delay phase end time in seconds, absolute (audio context time).
  */
  delayEnd = 0;
  /**
  * Attack phase end time in seconds, absolute (audio context time).
  */
  attackEnd = 0;
  /**
  * Hold phase end time in seconds, absolute (audio context time).
  */
  holdEnd = 0;
  /**
  * The level of the envelope when the release phase starts.
  */
  releaseStartLevel = 0;
  /**
  * The current modulation envelope value.
  */
  currentValue = 0;
  /**
  * If the modulation envelope has ever entered the release phase.
  */
  enteredRelease = false;
  /**
  * Decay phase end time in seconds, absolute (audio context time).
  */
  decayEnd = 0;
  /**
  * Calculates the current modulation envelope value for the given time and voice.
  * @param voice the voice we are working on.
  * @param currentTime in seconds.
  * @returns  mod env value, from 0 to 1.
  */
  process(voice, currentTime) {
    if (this.enteredRelease) {
      if (this.releaseStartLevel === 0) return 0;
      return Math.max(0, (1 - (currentTime - voice.releaseStartTime) / this.releaseDuration) * this.releaseStartLevel);
    }
    if (currentTime < this.delayEnd) this.currentValue = 0;
    else if (currentTime < this.attackEnd) this.currentValue = CONVEX_ATTACK[~~((1 - (this.attackEnd - currentTime) / this.attackDuration) * 1e3)];
    else if (currentTime < this.holdEnd) this.currentValue = MODENV_PEAK;
    else if (currentTime < this.decayEnd) this.currentValue = (1 - (this.decayEnd - currentTime) / this.decayDuration) * (this.sustainLevel - MODENV_PEAK) + MODENV_PEAK;
    else this.currentValue = this.sustainLevel;
    return this.currentValue;
  }
  /**
  * Starts the release phase in the envelope.
  * @param voice the voice this envelope belongs to.
  */
  startRelease(voice) {
    this.releaseStartLevel = this.currentValue;
    this.enteredRelease = true;
    const releaseTime2 = this.tc2Sec(Math.max(voice.modulatedGenerators[GeneratorTypes.releaseModEnv], -7200));
    this.releaseDuration = releaseTime2 * this.releaseStartLevel;
  }
  /**
  * Initializes the modulation envelope.
  * @param voice the voice this envelope belongs to.
  */
  init(voice) {
    this.enteredRelease = false;
    this.sustainLevel = 1 - voice.modulatedGenerators[GeneratorTypes.sustainModEnv] / 1e3;
    this.attackDuration = this.tc2Sec(voice.modulatedGenerators[GeneratorTypes.attackModEnv]);
    const decayKeyExcursionCents = (60 - voice.targetKey) * voice.modulatedGenerators[GeneratorTypes.keyNumToModEnvDecay];
    const decayTime = this.tc2Sec(voice.modulatedGenerators[GeneratorTypes.decayModEnv] + decayKeyExcursionCents);
    this.decayDuration = decayTime * (1 - this.sustainLevel);
    const holdKeyExcursionCents = (60 - voice.targetKey) * voice.modulatedGenerators[GeneratorTypes.keyNumToModEnvHold];
    this.holdDuration = this.tc2Sec(holdKeyExcursionCents + voice.modulatedGenerators[GeneratorTypes.holdModEnv]);
    this.delayEnd = voice.startTime + this.tc2Sec(voice.modulatedGenerators[GeneratorTypes.delayModEnv]);
    this.attackEnd = this.delayEnd + this.attackDuration;
    this.holdEnd = this.attackEnd + this.holdDuration;
    this.decayEnd = this.holdEnd + this.decayDuration;
  }
  tc2Sec(timecents) {
    if (timecents <= -10114) return 0;
    return timecentsToSeconds(timecents);
  }
};
var WavetableOscillator = class {
  /**
  * Is the loop on?
  */
  isLooping = false;
  /**
  * Sample data of the voice.
  */
  sampleData;
  /**
  * Playback step (rate) for sample pitch correction.
  */
  playbackStep = 0;
  /**
  * Start position of the loop.
  * Inclusive.
  */
  loopStart = 0;
  /**
  * End position of the loop.
  * Exclusive.
  */
  loopEnd = 0;
  /**
  * Length of the loop.
  * @private
  */
  loopLength = 0;
  /**
  * End position of the sample.
  * Exclusive
  */
  end = 0;
  /**
  * The current cursor of the sample.
  */
  cursor = 0;
};
var LinearOscillator = class extends WavetableOscillator {
  process(sampleCount, tuningRatio, outputBuffer) {
    const step = tuningRatio * this.playbackStep;
    const data = this.sampleData;
    const { loopEnd, loopLength, end } = this;
    let cursor = this.cursor;
    if (this.isLooping) for (let i = 0; i < sampleCount; i++) {
      while (cursor >= loopEnd) cursor -= loopLength;
      const floor = cursor | 0;
      let ceil = floor + 1;
      if (ceil >= loopEnd) ceil -= loopLength;
      const fraction = cursor - floor;
      const upper = data[ceil];
      const lower = data[floor];
      outputBuffer[i] = lower + (upper - lower) * fraction;
      cursor += step;
    }
    else for (let i = 0; i < sampleCount; i++) {
      const floor = cursor | 0;
      const ceil = floor + 1;
      if (ceil >= end) {
        outputBuffer.fill(0, i, sampleCount);
        return false;
      }
      const fraction = cursor - floor;
      const upper = data[ceil];
      const lower = data[floor];
      outputBuffer[i] = lower + (upper - lower) * fraction;
      cursor += step;
    }
    this.cursor = cursor;
    return true;
  }
};
var NearestOscillator = class extends WavetableOscillator {
  process(sampleCount, tuningRatio, outputBuffer) {
    const step = tuningRatio * this.playbackStep;
    const sampleData = this.sampleData;
    const { loopEnd, loopLength, end } = this;
    let cursor = this.cursor;
    if (this.isLooping) for (let i = 0; i < sampleCount; i++) {
      while (cursor >= loopEnd) cursor -= loopLength;
      outputBuffer[i] = sampleData[cursor | 0];
      cursor += step;
    }
    else for (let i = 0; i < sampleCount; i++) {
      if (cursor >= end) {
        outputBuffer.fill(0, i, sampleCount);
        return false;
      }
      outputBuffer[i] = sampleData[cursor | 0];
      cursor += step;
    }
    this.cursor = cursor;
    return true;
  }
};
var HermiteOscillator = class extends WavetableOscillator {
  process(sampleCount, tuningRatio, outputBuffer) {
    const step = tuningRatio * this.playbackStep;
    const sampleData = this.sampleData;
    const { loopEnd, loopLength, end } = this;
    let cursor = this.cursor;
    if (this.isLooping) for (let i = 0; i < sampleCount; i++) {
      while (cursor >= loopEnd) cursor -= loopLength;
      const y0 = cursor | 0;
      let y1 = y0 + 1;
      let y2 = y0 + 2;
      let y3 = y0 + 3;
      const t = cursor - y0;
      while (y1 >= loopEnd) y1 -= loopLength;
      while (y2 >= loopEnd) y2 -= loopLength;
      while (y3 >= loopEnd) y3 -= loopLength;
      const xm1 = sampleData[y0];
      const x0 = sampleData[y1];
      const x1 = sampleData[y2];
      const x2 = sampleData[y3];
      const c = (x1 - xm1) * 0.5;
      const v = x0 - x1;
      const w = c + v;
      const a = w + v + (x2 - x0) * 0.5;
      const b = w + a;
      outputBuffer[i] = ((a * t - b) * t + c) * t + x0;
      cursor += step;
    }
    else for (let i = 0; i < sampleCount; i++) {
      const y0 = cursor | 0;
      const y1 = y0 + 1;
      const y2 = y0 + 2;
      const y3 = y0 + 3;
      const t = cursor - y0;
      if (y3 >= end) {
        outputBuffer.fill(0, i, sampleCount);
        return false;
      }
      const xm1 = sampleData[y0];
      const x0 = sampleData[y1];
      const x1 = sampleData[y2];
      const x2 = sampleData[y3];
      const c = (x1 - xm1) * 0.5;
      const v = x0 - x1;
      const w = c + v;
      const a = w + v + (x2 - x0) * 0.5;
      const b = w + a;
      outputBuffer[i] = ((a * t - b) * t + c) * t + x0;
      cursor += step;
    }
    this.cursor = cursor;
    return true;
  }
};
var EXCLUSIVE_CUTOFF_TIME = -2320;
var Voice = class {
  /**
  * All oscillators currently available to the voice.
  */
  oscillators = [
    new LinearOscillator(),
    new NearestOscillator(),
    new HermiteOscillator()
  ];
  /**
  * The oscillator currently used by this voice.
  */
  wavetable = this.oscillators[DEFAULT_GLOBAL_SYSTEM_PARAMETERS.interpolationType];
  /**
  * Lowpass filter applied to the voice.
  */
  filter;
  /**
  * The unmodulated (copied to) generators of the voice.
  */
  generators = new Int16Array(GENERATORS_AMOUNT);
  /**
  * The generators in real-time, affected by modulators.
  * This is used during rendering.
  */
  modulatedGenerators = new Int16Array(GENERATORS_AMOUNT);
  /**
  * The voice's modulators.
  */
  modulators = new Array();
  /**
  * The current values for the respective modulators.
  * If there are more modulators, the array must be resized.
  */
  modulatorValues = new Int16Array(64);
  /**
  * Modulation envelope.
  */
  modEnv = new ModulationEnvelope();
  /**
  * Volume envelope.
  */
  volEnv;
  /**
  * Resonance offset, it is affected by the default resonant modulator
  */
  resonanceOffset = 0;
  /**
  * Priority of the voice. Used for stealing.
  */
  priority = 0;
  /**
  * If the voice is currently active.
  * If not, it can be used.
  */
  isActive = false;
  /**
  * Indicates if the voice has rendered at least one buffer.
  * Used for exclusive class to prevent killing voices set on the same note.
  */
  hasRendered = false;
  /**
  * Indicates if the voice is in the release phase.
  */
  isInRelease = false;
  /**
  * Indicates if the voice is currently held by the sustain pedal.
  */
  isHeld = false;
  /**
  * MIDI channel number of the voice.
  */
  channel = 0;
  /**
  * Grouping voices for specific Note On messages.
  * Used for overlapping Note Ons.
  */
  noteID = 0;
  /**
  * MIDI note number of the voice.
  * Direct number from the Note On message and is
  * used for Note Off and external parameters:
  * MTS and Per note Pitch Wheel.
  */
  midiNote = 0;
  /**
  * Target key of the voice.
  * This is the effective MIDI note number,
  * used to calculate scale tuning and envelope times,
  * and can be overridden by generators.
  * It is also used
  */
  targetKey = 0;
  /**
  * MIDI Velocity of the voice.
  * This can be overridden by generators and is the effective velocity.
  * MIDI Note On velocity is only used for zone filtering.
  */
  velocity = 0;
  /**
  * The root key of the voice.
  */
  rootKey = 0;
  /**
  * The pressure of the voice
  */
  pressure = 0;
  /**
  * Linear gain of the voice. Used with Key Modifiers.
  */
  gainModifier = 1;
  /**
  * Looping mode of the sample:
  * 0 - no loop
  * 1 - loop
  * 2 - UNOFFICIAL: polyphone 2.4 added start on release
  * 3 - loop then play when released
  */
  loopingMode = 0;
  /**
  * Start time of the voice, absolute.
  */
  startTime = 0;
  /**
  * Start time of the release phase, absolute.
  */
  releaseStartTime = Infinity;
  /**
  * Current tuning in cents.
  */
  tuningCents = 0;
  /**
  * Current calculated tuning. (as in ratio)
  */
  tuningRatio = 1;
  /**
  * From -500 to 500. Used for smoothing.
  */
  currentPan = 0;
  /**
  * Initial key to glide from, MIDI Note number. If -1, the portamento is OFF.
  */
  portamentoFromKey = -1;
  /**
  * Duration of the linear glide, in seconds.
  */
  portamentoDuration = 0;
  /**
  * From -500 to 500, where zero means disabled (use the channel pan). Used for random pan.
  */
  overridePan = 0;
  /**
  * In cents.
  */
  pitchOffset = 0;
  /**
  * Reverb send of the voice, used for drum parts, otherwise 1.
  */
  reverbSend = 1;
  /**
  * Chorus send of the voice, used for drum parts, otherwise 1.
  */
  chorusSend = 1;
  /**
  * Delay send of the voice, used for drum parts, otherwise 1.
  */
  delaySend = 1;
  /**
  * Exclusive class number for hi-hats etc.
  */
  exclusiveClass = 0;
  /**
  * In timecents, where zero means disabled (use the modulatedGenerators table).
  * Used for exclusive notes and killing notes.
  */
  overrideReleaseVolEnv = 0;
  vibLfoPhase = 0;
  vibLfoStartTime = 0;
  modLfoPhase = 0;
  modLfoStartTime = 0;
  constructor(sampleRate, bufferSize) {
    this.volEnv = new VolumeEnvelope(sampleRate, bufferSize);
    this.filter = new LowpassFilter(sampleRate);
  }
  /**
  * Releases the voice as exclusiveClass.
  */
  exclusiveRelease(currentTime, minExclusiveLength = MIN_EXCLUSIVE_LENGTH) {
    this.overrideReleaseVolEnv = EXCLUSIVE_CUTOFF_TIME;
    this.isInRelease = false;
    this.releaseVoice(currentTime, minExclusiveLength);
  }
  /**
  * Stops the voice
  * @param currentTime
  * @param minNoteLength minimum note length in seconds
  */
  releaseVoice(currentTime, minNoteLength = MIN_NOTE_LENGTH) {
    this.releaseStartTime = currentTime;
    if (this.releaseStartTime - this.startTime < minNoteLength) this.releaseStartTime = this.startTime + minNoteLength;
  }
  setup(currentTime, channel, midiNote, noteID) {
    this.isActive = true;
    this.isInRelease = false;
    this.hasRendered = false;
    this.isHeld = false;
    this.releaseStartTime = Infinity;
    this.pressure = 0;
    this.overrideReleaseVolEnv = 0;
    this.portamentoDuration = 0;
    this.portamentoFromKey = -1;
    this.tuningCents = 0;
    this.tuningRatio = 1;
    this.vibLfoPhase = 0.25;
    this.modLfoPhase = 0.25;
    this.startTime = currentTime;
    this.channel = channel;
    this.midiNote = midiNote;
    this.noteID = noteID;
  }
};
var CachedVoice = class {
  /**
  * Sample data of this voice.
  */
  sampleData;
  /**
  * The unmodulated (copied to) generators of the voice.
  */
  generators;
  /**
  * The voice's modulators.
  */
  modulators;
  /**
  * Exclusive class number for hi-hats etc.
  */
  exclusiveClass;
  /**
  * Target key of the voice (can be overridden by generators)
  */
  targetKey;
  /**
  * Target velocity of the voice (can be overridden by generators)
  */
  velocity;
  /**
  * MIDI root key of the sample
  */
  rootKey;
  /**
  * Start position of the loop
  */
  loopStart;
  /**
  * End position of the loop
  */
  loopEnd;
  /**
  * Playback step (rate) for sample pitch correction
  */
  playbackStep;
  loopingMode;
  constructor(voiceParams, midiNote, velocity, sampleRate) {
    const sample = voiceParams.sample;
    const generators = voiceParams.generators;
    this.modulators = voiceParams.modulators.map(VoiceModulator.fromModulator.bind(VoiceModulator));
    this.generators = generators;
    this.rootKey = sample.originalKey;
    if (generators[GeneratorTypes.overridingRootKey] > -1) this.rootKey = generators[GeneratorTypes.overridingRootKey];
    this.targetKey = midiNote;
    if (generators[GeneratorTypes.keyNum] > -1) this.targetKey = generators[GeneratorTypes.keyNum];
    this.velocity = velocity;
    if (generators[GeneratorTypes.velocity] > -1) this.velocity = generators[GeneratorTypes.velocity];
    this.exclusiveClass = generators[GeneratorTypes.exclusiveClass];
    this.loopStart = sample.loopStart;
    this.loopEnd = sample.loopEnd;
    this.sampleData = sample.getAudioData();
    this.playbackStep = sample.sampleRate / sampleRate * Math.pow(2, sample.pitchCorrection / 1200);
    this.loopingMode = generators[GeneratorTypes.sampleModes];
  }
};
var CHORUS_GAIN = 1.3;
var SpessaSynthChorus = class {
  /**
  * Cutoff frequency
  * @private
  */
  preLPFfc = 8e3;
  /**
  * Alpha
  * @private
  */
  preLPFa = 0;
  /**
  * Previous value
  * @private
  */
  preLPFz = 0;
  leftDelayBuffer;
  rightDelayBuffer;
  sampleRate;
  phase = 0;
  write = 0;
  gain = 0.5;
  reverbGain = 0;
  delayGain = 0;
  depthSamples = 0;
  delaySamples = 1;
  rateInc = 0;
  feedbackGain = 0;
  constructor(sampleRate, maxBufferSize) {
    this.sampleRate = sampleRate;
    this.leftDelayBuffer = new Float32Array(sampleRate);
    this.rightDelayBuffer = new Float32Array(sampleRate);
    this.preLowpass = 0;
  }
  _sendLevelToReverb = 0;
  get sendLevelToReverb() {
    return this._sendLevelToReverb;
  }
  set sendLevelToReverb(value) {
    this._sendLevelToReverb = value;
    this.reverbGain = value / 127;
  }
  _sendLevelToDelay = 0;
  get sendLevelToDelay() {
    return this._sendLevelToDelay;
  }
  set sendLevelToDelay(value) {
    this._sendLevelToDelay = value;
    this.delayGain = value / 127;
  }
  _preLowpass = 0;
  get preLowpass() {
    return this._preLowpass;
  }
  set preLowpass(value) {
    this._preLowpass = value;
    this.preLPFfc = 8e3 * 0.63 ** this._preLowpass;
    const decay = Math.exp(-2 * Math.PI * this.preLPFfc / this.sampleRate);
    this.preLPFa = 1 - decay;
  }
  _depth = 0;
  get depth() {
    return this._depth;
  }
  set depth(value) {
    this._depth = value;
    this.depthSamples = value / 127 * 0.025 * this.sampleRate;
  }
  _delay = 0;
  get delay() {
    return this._delay;
  }
  set delay(value) {
    this._delay = value;
    this.delaySamples = Math.max(1, value / 127 * 0.025 * this.sampleRate);
  }
  _feedback = 0;
  get feedback() {
    return this._feedback;
  }
  set feedback(value) {
    this._feedback = value;
    this.feedbackGain = value * 763e-5;
  }
  _rate = 0;
  get rate() {
    return this._rate;
  }
  set rate(value) {
    this._rate = value;
    const rate = value * 0.122;
    this.rateInc = rate / this.sampleRate;
  }
  _level = 64;
  get level() {
    return this._level;
  }
  set level(value) {
    this.gain = value / 127 * CHORUS_GAIN;
    this._level = value;
  }
  process(input, outputLeft, outputRight, outputReverb, outputDelay, startIndex, sampleCount) {
    const bufferL = this.leftDelayBuffer;
    const bufferR = this.rightDelayBuffer;
    const rateInc = this.rateInc;
    const bufferLen = bufferL.length;
    const depth = this.depthSamples;
    const delay = this.delaySamples;
    const gain = this.gain;
    const reverbGain = this.reverbGain;
    const delayGain = this.delayGain;
    const feedback = this.feedbackGain;
    const preLPF = this._preLowpass > 0;
    let phase = this.phase;
    let write = this.write;
    let z = this.preLPFz;
    const a = this.preLPFa;
    for (let i = 0; i < sampleCount; i++) {
      let inputSample = input[i];
      if (preLPF) {
        z += a * (inputSample - z);
        inputSample = z;
      }
      const lfo = 2 * Math.abs(phase - 0.5);
      const dL = Math.max(1, Math.min(delay + lfo * depth, bufferLen));
      let readPosL = write - dL;
      if (readPosL < 0) readPosL += bufferLen;
      let x0 = readPosL | 0;
      let x1 = x0 + 1;
      if (x1 >= bufferLen) x1 -= bufferLen;
      let frac = readPosL - x0;
      const outL = bufferL[x0] * (1 - frac) + bufferL[x1] * frac;
      bufferL[write] = inputSample + outL * feedback;
      const dR = Math.max(1, Math.min(delay + (1 - lfo) * depth, bufferLen));
      let readPosR = write - dR;
      if (readPosR < 0) readPosR += bufferLen;
      x0 = readPosR | 0;
      x1 = x0 + 1;
      if (x1 >= bufferLen) x1 -= bufferLen;
      frac = readPosR - x0;
      const outR = bufferR[x0] * (1 - frac) + bufferR[x1] * frac;
      const o = i + startIndex;
      outputLeft[o] += outL * gain;
      outputRight[o] += outR * gain;
      const mono = (outL + outR) / 2;
      outputReverb[i] += mono * reverbGain;
      outputDelay[i] += mono * delayGain;
      bufferR[write] = inputSample + outR * feedback;
      if (++write >= bufferLen) write = 0;
      if ((phase += rateInc) >= 1) phase -= 1;
    }
    this.write = write;
    this.phase = phase;
    this.preLPFz = z;
  }
  getSnapshot() {
    return {
      preLowpass: this._preLowpass,
      depth: this._depth,
      delay: this._delay,
      sendLevelToDelay: this._sendLevelToDelay,
      sendLevelToReverb: this._sendLevelToReverb,
      rate: this._rate,
      feedback: this._feedback,
      level: this._level
    };
  }
};
var DelayLine = class {
  feedback = 0;
  gain = 1;
  buffer;
  bufferLength;
  writeIndex = 0;
  constructor(maxDelay) {
    this.buffer = new Float32Array(maxDelay);
    this.bufferLength = this.buffer.length;
    this._time = maxDelay - 5;
  }
  /**
  * Samples
  */
  _time;
  get time() {
    return this._time;
  }
  set time(value) {
    this._time = Math.min(this.bufferLength, value) | 0;
  }
  clear() {
    this.buffer.fill(0);
  }
  /**
  * OVERWRITES the output
  * @param input
  * @param output
  * @param sampleCount
  */
  process(input, output, sampleCount) {
    let writeIndex = this.writeIndex;
    const delay = this._time;
    const buffer = this.buffer;
    const bufferLength = this.bufferLength;
    const feedback = this.feedback;
    const gain = this.gain;
    for (let i = 0; i < sampleCount; i++) {
      let readIndex = writeIndex - delay;
      if (readIndex < 0) readIndex += bufferLength;
      const delayed = buffer[readIndex];
      output[i] = delayed * gain;
      buffer[writeIndex] = input[i] + delayed * feedback;
      if (++writeIndex >= bufferLength) writeIndex = 0;
    }
    this.writeIndex = writeIndex;
  }
};
var delayTimeSegments = [
  {
    start: 1,
    end: 20,
    timeStart: 0.1,
    resolution: 0.1
  },
  {
    start: 20,
    end: 35,
    timeStart: 2,
    resolution: 0.2
  },
  {
    start: 35,
    end: 45,
    timeStart: 5,
    resolution: 0.5
  },
  {
    start: 45,
    end: 55,
    timeStart: 10,
    resolution: 1
  },
  {
    start: 55,
    end: 70,
    timeStart: 20,
    resolution: 2
  },
  {
    start: 70,
    end: 80,
    timeStart: 50,
    resolution: 5
  },
  {
    start: 80,
    end: 90,
    timeStart: 100,
    resolution: 10
  },
  {
    start: 90,
    end: 105,
    timeStart: 200,
    resolution: 20
  },
  {
    start: 105,
    end: 116,
    timeStart: 500,
    resolution: 50
  }
];
var DELAY_GAIN$1 = 1.66;
var SpessaSynthDelay = class {
  /**
  * Cutoff frequency
  * @private
  */
  preLPFfc = 8e3;
  /**
  * Alpha
  * @private
  */
  preLPFa = 0;
  /**
  * Previous value
  * @private
  */
  preLPFz = 0;
  delayLeft;
  delayRight;
  delayCenter;
  sampleRate;
  delayCenterOutput;
  delayPreLPF;
  delayCenterTime;
  delayLeftMultiplier = 0.04;
  delayRightMultiplier = 0.04;
  gain = 0;
  reverbGain = 0;
  constructor(sampleRate, maxBufferSize) {
    this.sampleRate = sampleRate;
    this.delayCenterOutput = new Float32Array(maxBufferSize);
    this.delayPreLPF = new Float32Array(maxBufferSize);
    this.delayCenterTime = 0.34 * sampleRate;
    this.delayCenter = new DelayLine(sampleRate);
    this.delayLeft = new DelayLine(sampleRate);
    this.delayRight = new DelayLine(sampleRate);
  }
  _sendLevelToReverb = 0;
  get sendLevelToReverb() {
    return this._sendLevelToReverb;
  }
  set sendLevelToReverb(value) {
    this._sendLevelToReverb = value;
    this.reverbGain = value / 127;
  }
  _preLowpass = 0;
  get preLowpass() {
    return this._preLowpass;
  }
  set preLowpass(value) {
    this._preLowpass = value;
    this.preLPFfc = 8e3 * 0.63 ** this._preLowpass;
    const decay = Math.exp(-2 * Math.PI * this.preLPFfc / this.sampleRate);
    this.preLPFa = 1 - decay;
  }
  _levelRight = 0;
  get levelRight() {
    return this._levelRight;
  }
  set levelRight(value) {
    this._levelRight = value;
    this.updateGain();
  }
  _level = 64;
  get level() {
    return this._level;
  }
  set level(value) {
    this._level = value;
    this.gain = value / 127 * DELAY_GAIN$1;
  }
  _levelCenter = 127;
  get levelCenter() {
    return this._levelCenter;
  }
  set levelCenter(value) {
    this._levelCenter = value;
    this.updateGain();
  }
  _levelLeft = 0;
  get levelLeft() {
    return this._levelLeft;
  }
  set levelLeft(value) {
    this._levelLeft = value;
    this.updateGain();
  }
  _feedback = 16;
  get feedback() {
    return this._feedback;
  }
  set feedback(value) {
    this._feedback = value;
    this.delayLeft.feedback = this.delayRight.feedback = 0;
    this.delayCenter.feedback = (value - 64) / 66;
  }
  _timeRatioRight = 0;
  get timeRatioRight() {
    return this._timeRatioRight;
  }
  set timeRatioRight(value) {
    this._timeRatioRight = value;
    this.delayRightMultiplier = value * (100 / 2400);
    this.delayRight.time = this.delayCenterTime * this.delayRightMultiplier;
  }
  _timeRatioLeft = 0;
  get timeRatioLeft() {
    return this._timeRatioLeft;
  }
  set timeRatioLeft(value) {
    this._timeRatioLeft = value;
    this.delayLeftMultiplier = value * (100 / 2400);
    this.delayLeft.time = this.delayCenterTime * this.delayLeftMultiplier;
  }
  _timeCenter = 12;
  get timeCenter() {
    return this._timeCenter;
  }
  set timeCenter(value) {
    this._timeCenter = value;
    let delayMs = 0.1;
    for (const segment of delayTimeSegments) if (value >= segment.start && value < segment.end) {
      delayMs = segment.timeStart + (value - segment.start) * segment.resolution;
      break;
    }
    this.delayCenterTime = Math.max(2, this.sampleRate * (delayMs / 1e3));
    this.delayCenter.time = this.delayCenterTime;
    this.delayLeft.time = this.delayCenterTime * this.delayLeftMultiplier;
    this.delayRight.time = this.delayCenterTime * this.delayRightMultiplier;
  }
  process(input, outputLeft, outputRight, outputReverb, startIndex, sampleCount) {
    let delayIn;
    if (this._preLowpass > 0) {
      const preLPF = this.delayPreLPF;
      let z = this.preLPFz;
      const a = this.preLPFa;
      for (let i = 0; i < sampleCount; i++) {
        const x = input[i];
        z += a * (x - z);
        preLPF[i] = z;
      }
      this.preLPFz = z;
      delayIn = preLPF;
    } else delayIn = input;
    const { gain, reverbGain } = this;
    this.delayCenter.process(delayIn, this.delayCenterOutput, sampleCount);
    const center = this.delayCenterOutput;
    for (let i = 0, o = startIndex; i < sampleCount; i++, o++) {
      const sample = center[i];
      outputReverb[i] += sample * reverbGain;
      const outSample = sample * gain;
      outputLeft[o] += outSample;
      outputRight[o] += outSample;
    }
    for (let i = 0; i < sampleCount; i++) center[i] += input[i];
    const stereoOut = this.delayPreLPF;
    this.delayLeft.process(center, stereoOut, sampleCount);
    for (let i = 0, o = startIndex; i < sampleCount; i++, o++) {
      const sample = stereoOut[i];
      outputLeft[o] += sample * gain;
      outputReverb[i] += sample * reverbGain;
    }
    this.delayRight.process(center, stereoOut, sampleCount);
    for (let i = 0, o = startIndex; i < sampleCount; i++, o++) {
      const sample = stereoOut[i];
      outputRight[o] += sample * gain;
      outputReverb[i] += sample * reverbGain;
    }
  }
  getSnapshot() {
    return {
      level: this._level,
      preLowpass: this._preLowpass,
      timeCenter: this._timeCenter,
      timeRatioRight: this._timeRatioRight,
      timeRatioLeft: this._timeRatioLeft,
      levelCenter: this._levelCenter,
      levelLeft: this._levelLeft,
      levelRight: this._levelRight,
      feedback: this._feedback,
      sendLevelToReverb: this._sendLevelToReverb
    };
  }
  updateGain() {
    this.delayCenter.gain = this._levelCenter / 127;
    this.delayLeft.gain = this._levelLeft / 127;
    this.delayRight.gain = this._levelRight / 127;
  }
};
var ThruFX = class {
  sendLevelToReverb = 40 / 127;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  type = 0;
  reset() {
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { sendLevelToReverb, sendLevelToChorus, sendLevelToDelay } = this;
    for (let i = 0; i < sampleCount; i++) {
      const sL = inputLeft[i];
      const sR = inputRight[i];
      const idx = startIndex + i;
      outputLeft[idx] += sL;
      outputRight[idx] += sR;
      const mono = (sL + sR) * 0.5;
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
  }
  setParameter(parameter, value) {
  }
};
var InsertionValueConverter = class {
  static data = [
    [
      0,
      200,
      200,
      0,
      0,
      0.05,
      0.05,
      315,
      250,
      200,
      250,
      100,
      -180,
      0
    ],
    [
      0.1,
      205,
      205,
      0.1,
      5,
      0.1,
      0.1,
      315,
      250,
      200,
      250,
      110,
      -180,
      1
    ],
    [
      0.2,
      210,
      210,
      0.2,
      10,
      0.15,
      0.15,
      315,
      250,
      200,
      250,
      120,
      -180,
      2
    ],
    [
      0.3,
      215,
      215,
      0.3,
      15,
      0.2,
      0.2,
      315,
      250,
      200,
      250,
      130,
      -180,
      3
    ],
    [
      0.4,
      220,
      220,
      0.4,
      20,
      0.25,
      0.25,
      315,
      250,
      200,
      250,
      140,
      -180,
      4
    ],
    [
      0.5,
      225,
      225,
      0.5,
      25,
      0.3,
      0.3,
      315,
      250,
      200,
      250,
      150,
      -180,
      5
    ],
    [
      0.6,
      230,
      230,
      0.6,
      30,
      0.35,
      0.35,
      315,
      250,
      200,
      250,
      160,
      -168,
      5
    ],
    [
      0.7,
      235,
      235,
      0.7,
      35,
      0.4,
      0.4,
      315,
      250,
      200,
      250,
      170,
      -168,
      5
    ],
    [
      0.8,
      240,
      240,
      0.8,
      40,
      0.45,
      0.45,
      400,
      315,
      250,
      315,
      180,
      -168,
      5
    ],
    [
      0.9,
      245,
      245,
      0.9,
      45,
      0.5,
      0.5,
      400,
      315,
      250,
      315,
      190,
      -168,
      5
    ],
    [
      1,
      250,
      250,
      1,
      50,
      0.55,
      0.55,
      400,
      315,
      250,
      315,
      200,
      -156,
      5
    ],
    [
      1.1,
      255,
      255,
      1.1,
      55,
      0.6,
      0.6,
      400,
      315,
      250,
      315,
      210,
      -156,
      5
    ],
    [
      1.2,
      260,
      260,
      1.2,
      60,
      0.65,
      0.65,
      400,
      315,
      250,
      315,
      220,
      -156,
      5
    ],
    [
      1.3,
      265,
      265,
      1.3,
      65,
      0.7,
      0.7,
      400,
      315,
      250,
      315,
      230,
      -156,
      5
    ],
    [
      1.4,
      270,
      270,
      1.4,
      70,
      0.75,
      0.75,
      400,
      315,
      250,
      315,
      240,
      -144,
      5
    ],
    [
      1.5,
      275,
      275,
      1.5,
      75,
      0.8,
      0.8,
      400,
      315,
      250,
      315,
      250,
      -144,
      5
    ],
    [
      1.6,
      280,
      280,
      1.6,
      80,
      0.85,
      0.85,
      500,
      400,
      315,
      400,
      260,
      -144,
      5
    ],
    [
      1.7,
      285,
      285,
      1.7,
      85,
      0.9,
      0.9,
      500,
      400,
      315,
      400,
      270,
      -144,
      5
    ],
    [
      1.8,
      290,
      290,
      1.8,
      90,
      0.95,
      0.95,
      500,
      400,
      315,
      400,
      280,
      -132,
      5
    ],
    [
      1.9,
      295,
      295,
      1.9,
      95,
      1,
      1,
      500,
      400,
      315,
      400,
      290,
      -132,
      5
    ],
    [
      2,
      300,
      300,
      2,
      100,
      1.05,
      1.05,
      500,
      400,
      315,
      400,
      300,
      -132,
      5
    ],
    [
      2.1,
      305,
      305,
      2.1,
      105,
      1.1,
      1.1,
      500,
      400,
      315,
      400,
      320,
      -132,
      5
    ],
    [
      2.2,
      310,
      310,
      2.2,
      110,
      1.15,
      1.15,
      500,
      400,
      315,
      400,
      340,
      -120,
      5
    ],
    [
      2.3,
      315,
      315,
      2.3,
      115,
      1.2,
      1.2,
      500,
      400,
      315,
      400,
      360,
      -120,
      5
    ],
    [
      2.4,
      320,
      320,
      2.4,
      120,
      1.25,
      1.25,
      630,
      500,
      400,
      500,
      380,
      -120,
      5
    ],
    [
      2.5,
      325,
      325,
      2.5,
      125,
      1.3,
      1.3,
      630,
      500,
      400,
      500,
      400,
      -120,
      5
    ],
    [
      2.6,
      330,
      330,
      2.6,
      130,
      1.35,
      1.35,
      630,
      500,
      400,
      500,
      420,
      -108,
      5
    ],
    [
      2.7,
      335,
      335,
      2.7,
      135,
      1.4,
      1.4,
      630,
      500,
      400,
      500,
      440,
      -108,
      5
    ],
    [
      2.8,
      340,
      340,
      2.8,
      140,
      1.45,
      1.45,
      630,
      500,
      400,
      500,
      460,
      -108,
      5
    ],
    [
      2.9,
      345,
      345,
      2.9,
      145,
      1.5,
      1.5,
      630,
      500,
      400,
      500,
      480,
      -108,
      5
    ],
    [
      3,
      350,
      350,
      3,
      150,
      1.55,
      1.55,
      630,
      500,
      400,
      500,
      500,
      -96,
      6
    ],
    [
      3.1,
      355,
      355,
      3.1,
      155,
      1.6,
      1.6,
      630,
      500,
      400,
      500,
      520,
      -96,
      6
    ],
    [
      3.2,
      360,
      360,
      3.2,
      160,
      1.65,
      1.65,
      800,
      630,
      500,
      630,
      540,
      -96,
      6
    ],
    [
      3.3,
      365,
      365,
      3.3,
      165,
      1.7,
      1.7,
      800,
      630,
      500,
      630,
      560,
      -96,
      6
    ],
    [
      3.4,
      370,
      370,
      3.4,
      170,
      1.75,
      1.75,
      800,
      630,
      500,
      630,
      580,
      -84,
      6
    ],
    [
      3.5,
      375,
      375,
      3.5,
      175,
      1.8,
      1.8,
      800,
      630,
      500,
      630,
      600,
      -84,
      6
    ],
    [
      3.6,
      380,
      380,
      3.6,
      180,
      1.85,
      1.85,
      800,
      630,
      500,
      630,
      620,
      -84,
      6
    ],
    [
      3.7,
      385,
      385,
      3.7,
      185,
      1.9,
      1.9,
      800,
      630,
      500,
      630,
      640,
      -84,
      6
    ],
    [
      3.8,
      390,
      390,
      3.8,
      190,
      1.95,
      1.95,
      800,
      630,
      500,
      630,
      660,
      -72,
      6
    ],
    [
      3.9,
      395,
      395,
      3.9,
      195,
      2,
      2,
      800,
      630,
      500,
      630,
      680,
      -72,
      6
    ],
    [
      4,
      400,
      400,
      4,
      200,
      2.05,
      2.05,
      1e3,
      800,
      630,
      800,
      700,
      -72,
      6
    ],
    [
      4.1,
      405,
      405,
      4.1,
      205,
      2.1,
      2.1,
      1e3,
      800,
      630,
      800,
      720,
      -72,
      6
    ],
    [
      4.2,
      410,
      410,
      4.2,
      210,
      2.15,
      2.15,
      1e3,
      800,
      630,
      800,
      740,
      -60,
      6
    ],
    [
      4.3,
      415,
      415,
      4.3,
      215,
      2.2,
      2.2,
      1e3,
      800,
      630,
      800,
      760,
      -60,
      6
    ],
    [
      4.4,
      420,
      420,
      4.4,
      220,
      2.25,
      2.25,
      1e3,
      800,
      630,
      800,
      780,
      -60,
      6
    ],
    [
      4.5,
      425,
      425,
      4.5,
      225,
      2.3,
      2.3,
      1e3,
      800,
      630,
      800,
      800,
      -60,
      6
    ],
    [
      4.6,
      430,
      430,
      4.6,
      230,
      2.35,
      2.35,
      1e3,
      800,
      630,
      800,
      820,
      -48,
      6
    ],
    [
      4.7,
      435,
      435,
      4.7,
      235,
      2.4,
      2.4,
      1e3,
      800,
      630,
      800,
      840,
      -48,
      6
    ],
    [
      4.8,
      440,
      440,
      4.8,
      240,
      2.45,
      2.45,
      1250,
      1e3,
      800,
      1e3,
      860,
      -48,
      9
    ],
    [
      4.9,
      445,
      445,
      4.9,
      245,
      2.5,
      2.5,
      1250,
      1e3,
      800,
      1e3,
      880,
      -48,
      9
    ],
    [
      5,
      450,
      450,
      5,
      250,
      2.55,
      2.55,
      1250,
      1e3,
      800,
      1e3,
      900,
      -36,
      9
    ],
    [
      5.5,
      455,
      455,
      5.5,
      255,
      2.6,
      2.6,
      1250,
      1e3,
      800,
      1e3,
      920,
      -36,
      9
    ],
    [
      6,
      460,
      460,
      6,
      260,
      2.65,
      2.65,
      1250,
      1e3,
      800,
      1e3,
      940,
      -36,
      9
    ],
    [
      6.5,
      465,
      465,
      6.5,
      265,
      2.7,
      2.7,
      1250,
      1e3,
      800,
      1e3,
      960,
      -36,
      9
    ],
    [
      7,
      470,
      470,
      7,
      270,
      2.75,
      2.75,
      1250,
      1e3,
      800,
      1e3,
      980,
      -24,
      9
    ],
    [
      7.5,
      475,
      475,
      7.5,
      275,
      2.8,
      2.8,
      1250,
      1e3,
      800,
      1e3,
      1e3,
      -24,
      9
    ],
    [
      8,
      480,
      480,
      8,
      280,
      2.85,
      2.85,
      1600,
      1250,
      1e3,
      1250,
      1100,
      -24,
      9
    ],
    [
      8.5,
      485,
      485,
      8.5,
      285,
      2.9,
      2.9,
      1600,
      1250,
      1e3,
      1250,
      1200,
      -24,
      9
    ],
    [
      9,
      490,
      490,
      9,
      290,
      2.95,
      2.95,
      1600,
      1250,
      1e3,
      1250,
      1300,
      -12,
      9
    ],
    [
      9.5,
      495,
      495,
      9.5,
      295,
      3,
      3,
      1600,
      1250,
      1e3,
      1250,
      1400,
      -12,
      9
    ],
    [
      10,
      500,
      500,
      10,
      300,
      3.05,
      3.05,
      1600,
      1250,
      1e3,
      1250,
      1500,
      -12,
      9
    ],
    [
      11,
      505,
      505,
      11,
      305,
      3.1,
      3.1,
      1600,
      1250,
      1e3,
      1250,
      1600,
      -12,
      9
    ],
    [
      12,
      510,
      510,
      12,
      310,
      3.15,
      3.15,
      1600,
      1250,
      1e3,
      1250,
      1700,
      0,
      9
    ],
    [
      13,
      515,
      515,
      13,
      315,
      3.2,
      3.2,
      1600,
      1250,
      1e3,
      1250,
      1800,
      0,
      9
    ],
    [
      14,
      520,
      520,
      14,
      320,
      3.25,
      3.25,
      2e3,
      1600,
      1250,
      1600,
      1900,
      0,
      12
    ],
    [
      15,
      525,
      525,
      15,
      325,
      3.3,
      3.3,
      2e3,
      1600,
      1250,
      1600,
      2e3,
      0,
      12
    ],
    [
      16,
      530,
      530,
      16,
      330,
      3.35,
      3.35,
      2e3,
      1600,
      1250,
      1600,
      2100,
      12,
      12
    ],
    [
      17,
      535,
      535,
      17,
      335,
      3.4,
      3.4,
      2e3,
      1600,
      1250,
      1600,
      2200,
      12,
      12
    ],
    [
      18,
      540,
      540,
      18,
      340,
      3.45,
      3.45,
      2e3,
      1600,
      1250,
      1600,
      2300,
      12,
      12
    ],
    [
      19,
      545,
      545,
      19,
      345,
      3.5,
      3.5,
      2e3,
      1600,
      1250,
      1600,
      2400,
      12,
      12
    ],
    [
      20,
      550,
      550,
      20,
      350,
      3.55,
      3.55,
      2e3,
      1600,
      1250,
      1600,
      2500,
      24,
      12
    ],
    [
      21,
      560,
      555,
      21,
      355,
      3.6,
      3.6,
      2e3,
      1600,
      1250,
      1600,
      2600,
      24,
      12
    ],
    [
      22,
      570,
      560,
      22,
      360,
      3.65,
      3.65,
      2500,
      2e3,
      1600,
      2e3,
      2700,
      24,
      12
    ],
    [
      23,
      580,
      565,
      23,
      365,
      3.7,
      3.7,
      2500,
      2e3,
      1600,
      2e3,
      2800,
      24,
      12
    ],
    [
      24,
      590,
      570,
      24,
      370,
      3.75,
      3.75,
      2500,
      2e3,
      1600,
      2e3,
      2900,
      36,
      12
    ],
    [
      25,
      600,
      575,
      25,
      375,
      3.8,
      3.8,
      2500,
      2e3,
      1600,
      2e3,
      3e3,
      36,
      12
    ],
    [
      26,
      610,
      580,
      26,
      380,
      3.85,
      3.85,
      2500,
      2e3,
      1600,
      2e3,
      3100,
      36,
      12
    ],
    [
      27,
      620,
      585,
      27,
      385,
      3.9,
      3.9,
      2500,
      2e3,
      1600,
      2e3,
      3200,
      36,
      12
    ],
    [
      28,
      630,
      590,
      28,
      390,
      3.95,
      3.95,
      2500,
      2e3,
      1600,
      2e3,
      3300,
      48,
      12
    ],
    [
      29,
      640,
      595,
      29,
      395,
      4,
      4,
      2500,
      2e3,
      1600,
      2e3,
      3400,
      48,
      12
    ],
    [
      30,
      650,
      600,
      30,
      400,
      4.05,
      4.05,
      3150,
      2500,
      2e3,
      2500,
      3500,
      48,
      10
    ],
    [
      31,
      660,
      610,
      31,
      405,
      4.1,
      4.1,
      3150,
      2500,
      2e3,
      2500,
      3600,
      48,
      10
    ],
    [
      32,
      670,
      620,
      32,
      410,
      4.15,
      4.15,
      3150,
      2500,
      2e3,
      2500,
      3700,
      60,
      10
    ],
    [
      33,
      680,
      630,
      33,
      415,
      4.2,
      4.2,
      3150,
      2500,
      2e3,
      2500,
      3800,
      60,
      10
    ],
    [
      34,
      690,
      640,
      34,
      420,
      4.25,
      4.25,
      3150,
      2500,
      2e3,
      2500,
      3900,
      60,
      10
    ],
    [
      35,
      700,
      650,
      35,
      425,
      4.3,
      4.3,
      3150,
      2500,
      2e3,
      2500,
      4e3,
      60,
      10
    ],
    [
      36,
      710,
      660,
      36,
      430,
      4.35,
      4.35,
      3150,
      2500,
      2e3,
      2500,
      4100,
      72,
      10
    ],
    [
      37,
      720,
      670,
      37,
      435,
      4.4,
      4.4,
      3150,
      2500,
      2e3,
      2500,
      4200,
      72,
      10
    ],
    [
      38,
      730,
      680,
      38,
      440,
      4.45,
      4.45,
      4e3,
      3150,
      2500,
      3150,
      4300,
      72,
      11
    ],
    [
      39,
      740,
      690,
      39,
      445,
      4.5,
      4.5,
      4e3,
      3150,
      2500,
      3150,
      4400,
      72,
      11
    ],
    [
      40,
      750,
      700,
      40,
      450,
      4.55,
      4.55,
      4e3,
      3150,
      2500,
      3150,
      4500,
      84,
      11
    ],
    [
      41,
      760,
      710,
      50,
      455,
      4.6,
      4.6,
      4e3,
      3150,
      2500,
      3150,
      4600,
      84,
      11
    ],
    [
      42,
      770,
      720,
      60,
      460,
      4.65,
      4.65,
      4e3,
      3150,
      2500,
      3150,
      4700,
      84,
      11
    ],
    [
      43,
      780,
      730,
      70,
      465,
      4.7,
      4.7,
      4e3,
      3150,
      2500,
      3150,
      4800,
      84,
      11
    ],
    [
      44,
      790,
      740,
      80,
      470,
      4.75,
      4.75,
      4e3,
      3150,
      2500,
      3150,
      4900,
      96,
      11
    ],
    [
      45,
      800,
      750,
      90,
      475,
      4.8,
      4.8,
      4e3,
      3150,
      2500,
      3150,
      5e3,
      96,
      11
    ],
    [
      46,
      810,
      760,
      100,
      480,
      4.85,
      4.85,
      5e3,
      4e3,
      3150,
      4e3,
      5100,
      96,
      12
    ],
    [
      47,
      820,
      770,
      110,
      485,
      4.9,
      4.9,
      5e3,
      4e3,
      3150,
      4e3,
      5200,
      96,
      12
    ],
    [
      48,
      830,
      780,
      120,
      490,
      4.95,
      4.95,
      5e3,
      4e3,
      3150,
      4e3,
      5300,
      108,
      12
    ],
    [
      49,
      840,
      790,
      130,
      495,
      5,
      5,
      5e3,
      4e3,
      3150,
      4e3,
      5400,
      108,
      12
    ],
    [
      50,
      850,
      800,
      140,
      500,
      5.1,
      5.05,
      5e3,
      4e3,
      3150,
      4e3,
      5500,
      108,
      12
    ],
    [
      52,
      860,
      810,
      150,
      505,
      5.2,
      5.1,
      5e3,
      4e3,
      3150,
      4e3,
      5600,
      108,
      12
    ],
    [
      54,
      870,
      820,
      160,
      510,
      5.3,
      5.15,
      5e3,
      4e3,
      3150,
      4e3,
      5700,
      120,
      12
    ],
    [
      56,
      880,
      830,
      170,
      515,
      5.4,
      5.2,
      5e3,
      4e3,
      3150,
      4e3,
      5800,
      120,
      12
    ],
    [
      58,
      890,
      840,
      180,
      520,
      5.5,
      5.25,
      6300,
      5e3,
      4e3,
      5e3,
      5900,
      120,
      13
    ],
    [
      60,
      900,
      850,
      190,
      525,
      5.6,
      5.3,
      6300,
      5e3,
      4e3,
      5e3,
      6e3,
      120,
      13
    ],
    [
      62,
      910,
      860,
      200,
      530,
      5.7,
      5.35,
      6300,
      5e3,
      4e3,
      5e3,
      6100,
      132,
      13
    ],
    [
      64,
      920,
      870,
      210,
      535,
      5.8,
      5.4,
      6300,
      5e3,
      4e3,
      5e3,
      6200,
      132,
      13
    ],
    [
      66,
      930,
      880,
      220,
      540,
      5.9,
      5.45,
      6300,
      5e3,
      4e3,
      5e3,
      6300,
      132,
      13
    ],
    [
      68,
      940,
      890,
      230,
      545,
      6,
      5.5,
      6300,
      5e3,
      4e3,
      5e3,
      6400,
      132,
      13
    ],
    [
      70,
      950,
      900,
      240,
      550,
      6.1,
      5.55,
      6300,
      5e3,
      4e3,
      5e3,
      6500,
      144,
      13
    ],
    [
      72,
      960,
      910,
      250,
      555,
      6.2,
      5.6,
      6300,
      5e3,
      4e3,
      5e3,
      6600,
      144,
      13
    ],
    [
      74,
      970,
      920,
      260,
      560,
      6.3,
      5.65,
      8e3,
      6300,
      5e3,
      6300,
      6700,
      144,
      14
    ],
    [
      76,
      980,
      930,
      270,
      565,
      6.4,
      5.7,
      8e3,
      6300,
      5e3,
      6300,
      6800,
      144,
      14
    ],
    [
      78,
      990,
      940,
      280,
      570,
      6.5,
      5.75,
      8e3,
      6300,
      5e3,
      6300,
      6900,
      156,
      14
    ],
    [
      80,
      1e3,
      950,
      290,
      575,
      6.6,
      5.8,
      8e3,
      6300,
      5e3,
      6300,
      7e3,
      156,
      14
    ],
    [
      82,
      1e3,
      960,
      300,
      580,
      6.7,
      5.85,
      8e3,
      6300,
      5e3,
      6300,
      7100,
      156,
      14
    ],
    [
      84,
      1e3,
      970,
      320,
      585,
      6.8,
      5.9,
      8e3,
      6300,
      5e3,
      6300,
      7200,
      156,
      14
    ],
    [
      86,
      1e3,
      980,
      340,
      590,
      6.9,
      5.95,
      8e3,
      6300,
      5e3,
      6300,
      7300,
      168,
      14
    ],
    [
      88,
      1e3,
      990,
      360,
      595,
      7,
      6,
      8e3,
      6300,
      5e3,
      6300,
      7400,
      168,
      14
    ],
    [
      90,
      1e3,
      1e3,
      380,
      600,
      7.5,
      6.05,
      13500,
      8e3,
      6300,
      13500,
      7500,
      168,
      15
    ],
    [
      92,
      1e3,
      1e3,
      400,
      605,
      8,
      6.1,
      13500,
      8e3,
      6300,
      13500,
      7600,
      168,
      15
    ],
    [
      94,
      1e3,
      1e3,
      420,
      610,
      8.5,
      6.15,
      13500,
      8e3,
      6300,
      13500,
      7700,
      -180,
      15
    ],
    [
      96,
      1e3,
      1e3,
      440,
      615,
      9,
      6.2,
      13500,
      8e3,
      6300,
      13500,
      7800,
      -180,
      15
    ],
    [
      98,
      1e3,
      1e3,
      460,
      620,
      9.5,
      6.25,
      13500,
      8e3,
      6300,
      13500,
      7900,
      -180,
      15
    ],
    [
      100,
      1e3,
      1e3,
      480,
      625,
      10,
      6.3,
      13500,
      8e3,
      6300,
      13500,
      8e3,
      -180,
      15
    ],
    [
      100,
      1e3,
      1e3,
      500,
      630,
      10,
      6.35,
      13500,
      8e3,
      6300,
      13500,
      8e3,
      -180,
      15
    ],
    [
      100,
      1e3,
      1e3,
      500,
      635,
      10,
      6.4,
      13500,
      8e3,
      6300,
      13500,
      8e3,
      -180,
      15
    ]
  ];
  static preDelayTime(value) {
    return this.data[value][0];
  }
  static delayTime1(value) {
    return this.data[value][1];
  }
  static delayTime2(value) {
    return this.data[value][2];
  }
  static delayTime3(value) {
    return this.data[value][3];
  }
  static delayTime4(value) {
    return this.data[value][4];
  }
  static rate1(value) {
    return this.data[value][5];
  }
  static rate2(value) {
    return this.data[value][6];
  }
  static hfDamp(value) {
    return this.data[value][7];
  }
  static cutoffFreq(value) {
    return this.data[value][8];
  }
  static eqFreq(value) {
    return this.data[value][9];
  }
  static lpf(value) {
    return this.data[value][10];
  }
  static manual(value) {
    return this.data[value][11];
  }
  static azimuth(value) {
    return this.data[value][12];
  }
  static accl(value) {
    return this.data[value][13];
  }
};
var HALF_PI = Math.PI / 2;
var MIN_PAN = -64;
var MAX_PAN = 63;
var PAN_RESOLUTION = MAX_PAN - MIN_PAN;
var PAN_TABLE_LEFT = new Float32Array(PAN_RESOLUTION + 1);
var PAN_TABLE_RIGHT = new Float32Array(PAN_RESOLUTION + 1);
for (let pan = MIN_PAN; pan <= MAX_PAN; pan++) {
  const realPan = (pan - MIN_PAN) / PAN_RESOLUTION;
  const tableIndex = pan - MIN_PAN;
  PAN_TABLE_LEFT[tableIndex] = Math.cos(HALF_PI * realPan);
  PAN_TABLE_RIGHT[tableIndex] = Math.sin(HALF_PI * realPan);
}
function zeroState(h2) {
  h2.x1 = h2.x2 = h2.y1 = h2.y2 = 0;
}
var ZERO_COEFFS = {
  b0: 1,
  b1: 0,
  b2: 0,
  a0: 1,
  a1: 0,
  a2: 0
};
function applyShelves(x, lowC, highC, lowS, highS) {
  const l = lowC.b0 * x + lowC.b1 * lowS.x1 + lowC.b2 * lowS.x2 - lowC.a1 * lowS.y1 - lowC.a2 * lowS.y2;
  lowS.x2 = lowS.x1;
  lowS.x1 = x;
  lowS.y2 = lowS.y1;
  lowS.y1 = l;
  const h2 = highC.b0 * l + highC.b1 * highS.x1 + highC.b2 * highS.x2 - highC.a1 * highS.y1 - highC.a2 * highS.y2;
  highS.x2 = highS.x1;
  highS.x1 = l;
  highS.y2 = highS.y1;
  highS.y1 = h2;
  return h2;
}
function processBiquad(x, coeffs, state) {
  const y2 = coeffs.b0 * x + coeffs.b1 * state.x1 + coeffs.b2 * state.x2 - coeffs.a1 * state.y1 - coeffs.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = x;
  state.y2 = state.y1;
  state.y1 = y2;
  return y2;
}
function computeShelfCoeffs(coeffs, dbGain, f0, fs4, isLow) {
  const A = Math.pow(10, dbGain / 40);
  const w0 = 2 * Math.PI * f0 / fs4;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / 2 * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
  let b0, b1, b2, a0, a1, a2;
  if (isLow) {
    b0 = A * (A + 1 - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
    b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
    b2 = A * (A + 1 - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
    a0 = A + 1 + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
    a1 = -2 * (A - 1 + (A + 1) * cosw0);
    a2 = A + 1 + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
  } else {
    b0 = A * (A + 1 + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
    b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
    b2 = A * (A + 1 + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
    a0 = A + 1 - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
    a1 = 2 * (A - 1 - (A + 1) * cosw0);
    a2 = A + 1 - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
  }
  coeffs.b0 = b0 / a0;
  coeffs.b1 = b1 / a0;
  coeffs.b2 = b2 / a0;
  coeffs.a0 = 1;
  coeffs.a1 = a1 / a0;
  coeffs.a2 = a2 / a0;
}
var ZeroStateC = {
  x1: 0,
  x2: 0,
  y1: 0,
  y2: 0
};
var StereoEQFX = class {
  type = 256;
  sendLevelToReverb = 0;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  sampleRate;
  level = 1;
  /**
  * Selects the frequency of the low range (200 Hz/400 Hz).
  * @private
  */
  lowFreq = 400;
  /**
  * Adjusts the gain of the low frequency.
  * [-12;12]
  * @private
  */
  lowGain = 5;
  /**
  * Selects the frequency of the high range (4kHz/8kHz).
  * @private
  */
  hiFreq = 8e3;
  /**
  * Adjusts the gain of the high frequency.
  * [-12;12]
  * @private
  */
  hiGain = -12;
  /**
  * Adjusts the frequency of Mid 1 (mid range1).
  * [200;6300]
  * @private
  */
  m1Freq = 1600;
  /**
  * This parameter adjusts the width of the area around the M1
  * Freq parameter that will be affected by the Gain setting.
  * Higher values of Q will result in a narrower area being
  * affected.
  * 0.5/1.0/2.0/4.0/9.0
  * @private
  */
  m1Q = 0.5;
  /**
  * Adjusts the gain for the area specified by the M1 Freq
  * parameter and M1 Q parameter settings.
  * [-12;12]
  * @private
  */
  m1Gain = 8;
  /**
  * Adjusts the frequency of Mid 2 (mid range2).
  * [200;6300]
  * @private
  */
  m2Freq = 1e3;
  /**
  * This parameter adjusts the width of the area around the M2
  * Freq parameter that will be affected by the Gain setting.
  * Higher values of Q will result in a narrower area being
  * affected.
  * 0.5/1.0/2.0/4.0/9.0
  * @private
  */
  m2Q = 0.5;
  /**
  * Adjusts the gain for the area specified by the M2 Freq
  * parameter and M2 Q parameter settings.
  * [-12;12]
  * @private
  */
  m2Gain = -8;
  lowCoeffs = { ...ZERO_COEFFS };
  m1Coeffs = { ...ZERO_COEFFS };
  m2Coeffs = { ...ZERO_COEFFS };
  hiCoeffs = { ...ZERO_COEFFS };
  lowStateL = { ...ZeroStateC };
  lowStateR = { ...ZeroStateC };
  m1StateL = { ...ZeroStateC };
  m1StateR = { ...ZeroStateC };
  m2StateL = { ...ZeroStateC };
  m2StateR = { ...ZeroStateC };
  hiStateL = { ...ZeroStateC };
  hiStateR = { ...ZeroStateC };
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.reset();
    this.updateCoefficients();
  }
  reset() {
    this.level = 1;
    this.lowFreq = 400;
    this.lowGain = 5;
    this.hiGain = -12;
    this.hiFreq = 8e3;
    this.m1Freq = 1600;
    this.m1Q = 0.5;
    this.m1Gain = 8;
    this.m2Freq = 1e3;
    this.m2Q = 0.5;
    this.m2Gain = -8;
    zeroState(this.lowStateL);
    zeroState(this.lowStateR);
    zeroState(this.m1StateL);
    zeroState(this.m1StateR);
    zeroState(this.m2StateL);
    zeroState(this.m2StateR);
    zeroState(this.hiStateL);
    zeroState(this.hiStateR);
    this.updateCoefficients();
  }
  setParameter(parameter, value) {
    switch (parameter) {
      default:
        break;
      case 3:
        this.lowFreq = value === 1 ? 400 : 200;
        break;
      case 4:
        this.lowGain = value - 64;
        break;
      case 5:
        this.hiFreq = value === 1 ? 8e3 : 4e3;
        break;
      case 6:
        this.hiGain = value - 64;
        break;
      case 7:
        this.m1Freq = InsertionValueConverter.eqFreq(value);
        break;
      case 8:
        this.m1Q = [
          0.5,
          1,
          2,
          4,
          9
        ][value] || 1;
        break;
      case 9:
        this.m1Gain = value - 64;
        break;
      case 10:
        this.m2Freq = InsertionValueConverter.eqFreq(value);
        break;
      case 11:
        this.m2Q = [
          0.5,
          1,
          2,
          4,
          9
        ][value] || 1;
        break;
      case 12:
        this.m2Gain = value - 64;
        break;
      case 22:
        this.level = value / 127;
        break;
    }
    this.updateCoefficients();
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { level, sendLevelToChorus, sendLevelToDelay, sendLevelToReverb, lowCoeffs, lowStateL, lowStateR, m1Coeffs, m1StateL, m1StateR, m2StateL, m2StateR, m2Coeffs, hiCoeffs, hiStateL, hiStateR } = this;
    for (let i = 0; i < sampleCount; i++) {
      let sL = inputLeft[i];
      let sR = inputRight[i];
      sL = processBiquad(sL, lowCoeffs, lowStateL);
      sR = processBiquad(sR, lowCoeffs, lowStateR);
      sL = processBiquad(sL, m1Coeffs, m1StateL);
      sR = processBiquad(sR, m1Coeffs, m1StateR);
      sL = processBiquad(sL, m2Coeffs, m2StateL);
      sR = processBiquad(sR, m2Coeffs, m2StateR);
      sL = processBiquad(sL, hiCoeffs, hiStateL);
      sR = processBiquad(sR, hiCoeffs, hiStateR);
      const idx = startIndex + i;
      outputLeft[idx] += sL * level;
      outputRight[idx] += sR * level;
      const mono = 0.5 * (sL + sR);
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
  }
  updateCoefficients() {
    computeLowShelfCoeffs(this.lowCoeffs, this.lowFreq, this.lowGain / 2, this.sampleRate);
    computePeakingEQCoeffs(this.m1Coeffs, this.m1Freq, this.m1Gain, this.m1Q, this.sampleRate);
    computePeakingEQCoeffs(this.m2Coeffs, this.m2Freq, this.m2Gain, this.m2Q, this.sampleRate);
    computeHighShelfCoeffs(this.hiCoeffs, this.hiFreq, this.hiGain / 2, this.sampleRate);
  }
};
var SHELF_SLOPE = 1;
function computePeakingEQCoeffs(coeffs, freq, gainDB, Q, sampleRate) {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * cosw0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha / A;
  coeffs.a0 = 1;
  coeffs.a1 = a1 / a0;
  coeffs.a2 = a2 / a0;
  coeffs.b0 = b0 / a0;
  coeffs.b1 = b1 / a0;
  coeffs.b2 = b2 / a0;
}
function computeLowShelfCoeffs(coeffs, freq, gainDB, sampleRate) {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / 2 * Math.sqrt((A + 1 / A) * (1 / SHELF_SLOPE - 1) + 2);
  const b0 = A * (A + 1 - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
  const b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
  const b2 = A * (A + 1 - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
  const a0 = A + 1 + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
  const a1 = -2 * (A - 1 + (A + 1) * cosw0);
  const a2 = A + 1 + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
  coeffs.a0 = 1;
  coeffs.a1 = a1 / a0;
  coeffs.a2 = a2 / a0;
  coeffs.b0 = b0 / a0;
  coeffs.b1 = b1 / a0;
  coeffs.b2 = b2 / a0;
}
function computeHighShelfCoeffs(coeffs, freq, gainDB, sampleRate) {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / 2 * Math.sqrt((A + 1 / A) * (1 / SHELF_SLOPE - 1) + 2);
  const b0 = A * (A + 1 + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
  const b2 = A * (A + 1 + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
  const a0 = A + 1 - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosw0);
  const a2 = A + 1 - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
  coeffs.a0 = 1;
  coeffs.a1 = a1 / a0;
  coeffs.a2 = a2 / a0;
  coeffs.b0 = b0 / a0;
  coeffs.b1 = b1 / a0;
  coeffs.b2 = b2 / a0;
}
var ALL_PASS_STAGES = 8;
var DEPTH_DIV = 128;
var MANUAL_MULTIPLIER = 4;
var MANUAL_OFFSET = 600;
var FEEDBACK = 0.9;
var PHASE_START = 0.35;
var PhaserFX = class {
  sendLevelToReverb = 40 / 127;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  type = 288;
  /**
  * Adjusts the basic frequency from which the sound will be
  * modulated.
  * [100;8000]
  * @private
  */
  manual = 620;
  /**
  * Adjusts the frequency (period) of modulation.
  * @private
  * [0.05;10.0]
  */
  rate = 0.85;
  /**
  * Adjusts the depth of modulation.
  * [0;1]
  * @private
  */
  depth = 64 / DEPTH_DIV;
  /**
  * Adjusts the amount of emphasis added to the frequency
  * range surrounding the basic frequency determined by the
  * Manual parameter setting.
  * [0;1]
  * @private
  */
  reso = 16 / 127;
  /**
  * Adjusts the proportion by which the phase-shifted sound is
  * combined with the direct sound.
  * [0;1]
  * @private
  */
  mix = 1;
  /**
  * Adjusts the gain of the low frequency range. (200Hz)
  * [-12;12]
  * @private
  */
  lowGain = 0;
  /**
  * Adjusts the gain of the high frequency range. (4kHz)
  * [-12;12]
  * @private
  */
  hiGain = 0;
  prevInL;
  prevOutL;
  prevInR;
  prevOutR;
  lowShelfCoef = { ...ZERO_COEFFS };
  highShelfCoef = { ...ZERO_COEFFS };
  manualOffset = MANUAL_OFFSET;
  lowShelfStateL = {
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0
  };
  lowShelfStateR = {
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0
  };
  highShelfStateL = {
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0
  };
  highShelfStateR = {
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0
  };
  prevL = 0;
  prevR = 0;
  /**
  * Adjusts the output level.
  * [0;1]
  * @private
  */
  level = 104 / 127;
  phase = PHASE_START;
  sampleRate;
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.prevInL = new Float32Array(ALL_PASS_STAGES);
    this.prevOutL = new Float32Array(ALL_PASS_STAGES);
    this.prevInR = new Float32Array(ALL_PASS_STAGES);
    this.prevOutR = new Float32Array(ALL_PASS_STAGES);
    this.reset();
  }
  reset() {
    this.phase = PHASE_START;
    this.setManual(620);
    this.rate = 0.85;
    this.depth = 64 / DEPTH_DIV;
    this.reso = 16 / 127;
    this.mix = 1;
    this.lowGain = 0;
    this.hiGain = 0;
    this.level = 104 / 127;
    zeroState(this.highShelfStateL);
    zeroState(this.highShelfStateR);
    zeroState(this.lowShelfStateL);
    zeroState(this.lowShelfStateR);
    this.updateShelves();
    this.clearAllPass();
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { sendLevelToReverb, sendLevelToChorus, sendLevelToDelay, level, manual, manualOffset, mix, lowShelfCoef, lowShelfStateR, lowShelfStateL, highShelfCoef, highShelfStateL, highShelfStateR, prevInL, prevInR, prevOutL, prevOutR, sampleRate, depth } = this;
    let { prevL, prevR, phase } = this;
    const rateInc = this.rate / this.sampleRate;
    const fb = this.reso * FEEDBACK;
    for (let i = 0; i < sampleCount; i++) {
      const sL = applyShelves(inputLeft[i], lowShelfCoef, highShelfCoef, lowShelfStateL, highShelfStateL);
      const sR = applyShelves(inputRight[i], lowShelfCoef, highShelfCoef, lowShelfStateR, highShelfStateR);
      const lfo = 2 * Math.abs(phase - 0.5);
      if ((phase += rateInc) >= 1) phase -= 1;
      const fc = manualOffset + manual * (1 - depth * lfo);
      const tanTerm = Math.tan(Math.PI * fc / sampleRate);
      const a = Math.max(-0.9999, Math.min(0.9999, (1 - tanTerm) / (1 + tanTerm)));
      let apL = sL + fb * prevL;
      let apR = sR + fb * prevR;
      for (let stage = 0; stage < ALL_PASS_STAGES; stage++) {
        const outL2 = -a * apL + prevInL[stage] + a * prevOutL[stage];
        prevInL[stage] = apL;
        prevOutL[stage] = outL2;
        apL = outL2;
        const outR2 = -a * apR + prevInR[stage] + a * prevOutR[stage];
        prevInR[stage] = apR;
        prevOutR[stage] = outR2;
        apR = outR2;
      }
      prevL = apL;
      prevR = apR;
      const outL = (sL + apL * mix) * level;
      const outR = (sR + apR * mix) * level;
      const idx = startIndex + i;
      outputLeft[idx] += outL;
      outputRight[idx] += outR;
      const mono = (outL + outR) * 0.5;
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
    this.phase = phase;
    this.prevL = prevL;
    this.prevR = prevR;
  }
  setParameter(parameter, value) {
    switch (parameter) {
      default:
        break;
      case 3:
        this.setManual(InsertionValueConverter.manual(value));
        break;
      case 4:
        this.rate = InsertionValueConverter.rate1(value);
        break;
      case 5:
        this.depth = value / DEPTH_DIV;
        break;
      case 6:
        this.reso = value / 127;
        break;
      case 7:
        this.mix = value / 127;
        break;
      case 19:
        this.lowGain = value - 64;
        break;
      case 20:
        this.hiGain = value - 64;
        break;
      case 22:
        this.level = value / 127;
        break;
    }
    this.updateShelves();
  }
  setManual(manualIn) {
    if (manualIn > 1e3) {
      this.manualOffset = MANUAL_OFFSET * 1.5 * MANUAL_MULTIPLIER;
      this.manual = manualIn;
    } else {
      this.manualOffset = MANUAL_OFFSET;
      this.manual = manualIn * MANUAL_MULTIPLIER;
    }
  }
  clearAllPass() {
    this.prevR = 0;
    this.prevL = 0;
    for (let i = 0; i < ALL_PASS_STAGES; i++) {
      this.prevInL[i] = 0;
      this.prevOutL[i] = 0;
      this.prevInR[i] = 0;
      this.prevOutR[i] = 0;
    }
  }
  updateShelves() {
    computeShelfCoeffs(this.lowShelfCoef, this.lowGain, 200, this.sampleRate, true);
    computeShelfCoeffs(this.highShelfCoef, this.hiGain, 4e3, this.sampleRate, false);
  }
};
var PI_2$1 = Math.PI * 2;
var GAIN_LVL = 0.935;
var LEVEL_EXP = 2;
var PAN_SMOOTHING = 0.01;
var DEFAULT_LEVEL$3 = 127;
var AutoPanFX = class {
  sendLevelToReverb = 40 / 127;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  type = 294;
  /**
  * Selects the type of modulation.
  * Tri:
  *  The sound will be modulated like a triangle
  * wave.
  * Sqr:
  *  The sound will be modulated like a square
  * wave.
  * Sin:
  *  The sound will be modulated like a sine
  * wave.
  * Saw1,2: The sound will be modulated like a
  * sawtooth wave. The teeth in Saw1 and
  * Saw2 point at opposite direction.
  *
  * [Tri/Sqr/Sin/Saw1/Saw2 -> 00/01/02/03/04]
  * @private
  */
  modWave = 1;
  /**
  * Adjusts the frequency of modulation.
  * [Rate1 conversion]
  * @private
  */
  modRate = 3.05;
  /**
  * Adjusts the depth of modulation.
  * [0;127]
  * @private
  */
  modDepth = 96;
  /**
  * Adjusts the gain of the low frequency range. (200Hz)
  * [-12;12]
  * @private
  */
  lowGain = 0;
  /**
  * Adjusts the gain of the high frequency range. (4kHz)
  * [-12;12]
  * @private
  */
  hiGain = 0;
  /**
  * Adjusts the output level.
  * [0;1]
  * @private
  */
  level = DEFAULT_LEVEL$3 / 127;
  currentPan = 0;
  phase = 0;
  lsCoeffs = { ...ZERO_COEFFS };
  hsCoeffs = { ...ZERO_COEFFS };
  lsStateR = { ...ZeroStateC };
  lsStateL = { ...ZeroStateC };
  hsStateR = { ...ZeroStateC };
  hsStateL = { ...ZeroStateC };
  sampleRate;
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.reset();
  }
  reset() {
    this.modWave = 1;
    this.modRate = 3.05;
    this.modDepth = 96;
    this.lowGain = 0;
    this.hiGain = 0;
    this.level = DEFAULT_LEVEL$3 / 127;
    this.currentPan = 0;
    this.phase = 0;
    zeroState(this.hsStateR);
    zeroState(this.hsStateL);
    zeroState(this.lsStateR);
    zeroState(this.lsStateL);
    this.updateShelves();
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { sendLevelToReverb, sendLevelToChorus, sendLevelToDelay, level, lsCoeffs, lsStateL, lsStateR, hsCoeffs, hsStateR, hsStateL, modWave } = this;
    const depth = Math.pow(this.modDepth / 127, LEVEL_EXP);
    const scale = 2 / (1 + depth) * GAIN_LVL;
    const rateInc = this.modRate / this.sampleRate;
    let { phase, currentPan } = this;
    for (let i = 0; i < sampleCount; i++) {
      const sL = applyShelves(inputLeft[i], lsCoeffs, hsCoeffs, lsStateL, hsStateL);
      const sR = applyShelves(inputRight[i], lsCoeffs, hsCoeffs, lsStateR, hsStateR);
      let lfo;
      switch (modWave) {
        default:
          lfo = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case 1:
          lfo = phase > 0.5 ? -1 : -Math.cos((phase - 0.75) * PI_2$1);
          break;
        case 2:
          lfo = Math.sin(PI_2$1 * phase);
          break;
        case 3:
          lfo = 1 - 2 * phase;
          break;
        case 4:
          lfo = 2 * phase - 1;
          break;
      }
      if ((phase += rateInc) >= 1) phase -= 1;
      currentPan += (lfo - currentPan) * PAN_SMOOTHING;
      const pan = currentPan * depth;
      const gainL = (1 - pan) * 0.5 * scale;
      const gainR = (1 + pan) * 0.5 * scale;
      const outL = sL * level * gainL;
      const outR = sR * level * gainR;
      const idx = startIndex + i;
      outputLeft[idx] += outL;
      outputRight[idx] += outR;
      const mono = (outL + outR) * 0.5;
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
    this.currentPan = currentPan;
    this.phase = phase;
  }
  setParameter(parameter, value) {
    switch (parameter) {
      default:
        break;
      case 3:
        this.modWave = value;
        break;
      case 4:
        this.modRate = InsertionValueConverter.rate1(value);
        break;
      case 5:
        this.modDepth = value;
        break;
      case 19:
        this.lowGain = value - 64;
        break;
      case 20:
        this.hiGain = value - 64;
        break;
      case 22:
        this.level = value / 127;
        break;
    }
    this.updateShelves();
  }
  updateShelves() {
    computeShelfCoeffs(this.lsCoeffs, this.lowGain, 200, this.sampleRate, true);
    computeShelfCoeffs(this.hsCoeffs, this.hiGain, 4e3, this.sampleRate, false);
  }
};
var DEFAULT_LEVEL$2 = 96;
var attackTime = 0.1;
var releaseTime = 0.1;
var SENS_COEFF = 27;
var PEAK_DB = 28;
var HPF_Q = -28;
var HPF_FC = 400;
var MANUAL_SCALE = 0.62;
var FC_SMOOTH = 5e-3;
var DEPTH_MUL = 5;
var LFO_SMOOTH_FRAC = DEPTH_MUL * 0.5;
var AutoWahFX = class {
  sendLevelToReverb = 40 / 127;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  type = 289;
  /**
  * Selects the type of filter.
  * LPF: The wah effect will be applied over a wide
  * frequency range.
  * BPF: The wah effect will be applied over a narrow
  * frequency range.
  * 0 - LPF
  * 1 - BPF
  * @private
  */
  filType = 1;
  /**
  * Adjusts the sensitivity with which the filter is controlled. If
  * this value is increased, the filter frequency will change more
  * readily in response to the input level.
  * [0;127]
  * @private
  */
  sens = 0;
  /**
  * Adjusts the center frequency from which the effect is
  * applied.
  *
  * Note: Doesn't use "Manual" conversion??
  * [0;127] (assuming manual though, seems to use a part of the curve)
  * @private
  */
  manual = 68;
  /**
  * Adjusts the amount of the wah effect that will occur in the
  * area of the center frequency. Lower settings will cause the
  * effect to be applied in a broad area around the center
  * frequency. Higher settings will cause the effect to be
  * applied in a more narrow range. In the case of LPF,
  * decreasing the value will cause the wah effect to change
  * less.
  * [0;127]
  * @private
  */
  peak = 62;
  /**
  * Adjusts the speed of the modulation.
  * [Rate1 conversion]
  * @private
  */
  rate = 2.05;
  /**
  * Adjusts the depth of the modulation.
  * [0;127]
  * @private
  */
  depth = 72;
  /**
  * Sets the direction in which the frequency will change when
  * the filter is modulated. With a setting of Up, the filter will
  * change toward a higher frequency. With a setting of Down
  * it will change toward a lower frequency.
  * 0 - down
  * 1 - up
  * @private
  */
  polarity = 1;
  /**
  * Adjusts the stereo location of the output sound. L63 is far
  * left, 0 is center, and R63 is far right.
  * [-64;63]
  * @private
  */
  pan = 0;
  /**
  * Adjusts the gain of the low frequency range. (200Hz)
  * [-12;12]
  * @private
  */
  lowGain = 0;
  /**
  * Adjusts the gain of the high frequency range. (4kHz)
  * [-12;12]
  * @private
  */
  hiGain = 0;
  /**
  * Adjusts the output level.
  * [0;1]
  * @private
  */
  level = DEFAULT_LEVEL$2 / 127;
  coeffs = { ...ZERO_COEFFS };
  state = { ...ZeroStateC };
  hpCoeffs = { ...ZERO_COEFFS };
  hpState = { ...ZeroStateC };
  phase = 0;
  lsCoeffs = { ...ZERO_COEFFS };
  hsCoeffs = { ...ZERO_COEFFS };
  lsState = { ...ZeroStateC };
  hsState = { ...ZeroStateC };
  sampleRate;
  lastFc = this.manual;
  attackCoeff;
  releaseCoeff;
  envelope = 0;
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.attackCoeff = Math.exp(-1 / (attackTime * sampleRate));
    this.releaseCoeff = Math.exp(-1 / (releaseTime * sampleRate));
    this.reset();
  }
  reset() {
    this.filType = 1;
    this.sens = 0;
    this.setManual(68);
    this.peak = 62;
    this.rate = 2.05;
    this.depth = 72;
    this.polarity = 1;
    this.lowGain = 0;
    this.hiGain = 0;
    this.pan = 0;
    this.level = DEFAULT_LEVEL$2 / 127;
    this.phase = 0.2;
    this.lastFc = this.manual;
    zeroState(this.hsState);
    zeroState(this.lsState);
    zeroState(this.state);
    zeroState(this.hpState);
    this.updateShelves();
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { sendLevelToReverb, sendLevelToChorus, sendLevelToDelay, level, lsCoeffs, lsState, hsCoeffs, hsState, coeffs, state, sampleRate, filType, manual, pan, attackCoeff, releaseCoeff, hpState, hpCoeffs } = this;
    let { phase, lastFc, envelope } = this;
    const rateInc = this.rate / this.sampleRate;
    const peak = Math.pow(10, this.peak / 127 * PEAK_DB / 20);
    const hpfPeak = Math.pow(10, this.peak / 127 * HPF_Q / 20);
    const pol = this.polarity === 0 ? -1 : DEPTH_MUL;
    const depth = this.depth / 127 * pol;
    const sens = this.sens / 127;
    const index = pan + 64 | 0;
    const gainL = PAN_TABLE_LEFT[index];
    const gainR = PAN_TABLE_RIGHT[index];
    for (let i = 0; i < sampleCount; i++) {
      const s = applyShelves((inputLeft[i] + inputRight[i]) * 0.5, lsCoeffs, hsCoeffs, lsState, hsState);
      const rectified = Math.abs(s);
      envelope = rectified > envelope ? attackCoeff * envelope + (1 - attackCoeff) * rectified : releaseCoeff * envelope + (1 - releaseCoeff) * rectified;
      const lfo = 2 * Math.abs(phase - 0.5) * depth;
      if ((phase += rateInc) >= 1) phase -= 1;
      const lfoMul = lfo >= LFO_SMOOTH_FRAC || pol < 0 ? 1 : Math.sin(lfo * Math.PI / (2 * LFO_SMOOTH_FRAC));
      const base = manual * (1 + sens * envelope * SENS_COEFF);
      const fc = Math.max(20, base * (1 + lfoMul * lfo));
      lastFc += (Math.max(10, fc) - lastFc) * FC_SMOOTH;
      computeLowpassCoeffs(coeffs, lastFc, peak, sampleRate);
      let processedSample = s;
      if (filType === 1) {
        computeHighpassCoeffs(hpCoeffs, HPF_FC, hpfPeak, sampleRate);
        processedSample = processBiquad(processedSample, hpCoeffs, hpState);
      }
      const mono = processBiquad(processedSample, coeffs, state) * level;
      const outL = mono * gainL;
      const outR = mono * gainR;
      const idx = startIndex + i;
      outputLeft[idx] += outL;
      outputRight[idx] += outR;
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
    this.phase = phase;
    this.lastFc = lastFc;
    this.envelope = envelope;
  }
  setParameter(parameter, value) {
    switch (parameter) {
      default:
        break;
      case 3:
        this.filType = value;
        break;
      case 4:
        this.sens = value;
        break;
      case 5:
        this.setManual(value);
        break;
      case 6:
        this.peak = value;
        break;
      case 7:
        this.rate = InsertionValueConverter.rate1(value);
        break;
      case 8:
        this.depth = value;
        break;
      case 9:
        this.polarity = value;
        break;
      case 19:
        this.lowGain = value - 64;
        break;
      case 20:
        this.hiGain = value - 64;
        break;
      case 21:
        this.pan = value - 64;
        break;
      case 22:
        this.level = value / 127;
        break;
    }
    this.updateShelves();
  }
  setManual(value) {
    const target = value * MANUAL_SCALE;
    const floor = InsertionValueConverter.manual(Math.floor(target));
    const ceil = InsertionValueConverter.manual(Math.ceil(target));
    const frac = target - Math.floor(target);
    this.manual = floor + (ceil - floor) * frac;
  }
  updateShelves() {
    computeShelfCoeffs(this.lsCoeffs, this.lowGain, 200, this.sampleRate, true);
    computeShelfCoeffs(this.hsCoeffs, this.hiGain, 4e3, this.sampleRate, false);
  }
};
function computeLowpassCoeffs(coeffs, freq, Q, sampleRate) {
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const b1 = 1 - cosw0;
  const b0 = b1 / 2;
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  coeffs.a0 = 1;
  coeffs.a1 = a1 / a0;
  coeffs.a2 = a2 / a0;
  coeffs.b0 = b0 / a0;
  coeffs.b1 = b1 / a0;
  coeffs.b2 = b2 / a0;
}
function computeHighpassCoeffs(coeffs, freq, Q, sampleRate) {
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = b0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  coeffs.a0 = 1;
  coeffs.a1 = a1 / a0;
  coeffs.a2 = a2 / a0;
  coeffs.b0 = b0 / a0;
  coeffs.b1 = b1 / a0;
  coeffs.b2 = b2 / a0;
}
var DEFAULT_LEVEL$1 = 127;
var PhAutoWahFx = class {
  sendLevelToReverb = 40 / 127;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  type = 4360;
  /**
  * Sets the stereo location of the phaser sound. L63 is far left, 0
  * is center, and R63 is far right.
  * [0;127]
  * @private
  */
  phPan = 0;
  /**
  * Sets the stereo location of the aut-wah sound. L63 is far left, 0
  * is center, and R63 is far right.
  * [0;127]
  * @private
  */
  awPan = 127;
  /**
  * Adjusts the output level.
  * [0;1]
  * @private
  */
  level = DEFAULT_LEVEL$1 / 127;
  phaser;
  autoWah;
  bufferPh;
  bufferAw;
  constructor(sampleRate, maxBufferSize) {
    this.phaser = new PhaserFX(sampleRate);
    this.autoWah = new AutoWahFX(sampleRate);
    this.bufferAw = new Float32Array(maxBufferSize);
    this.bufferPh = new Float32Array(maxBufferSize);
    this.phaser.sendLevelToReverb = 0;
    this.phaser.sendLevelToChorus = 0;
    this.phaser.sendLevelToDelay = 0;
    this.autoWah.sendLevelToReverb = 0;
    this.autoWah.sendLevelToChorus = 0;
    this.autoWah.sendLevelToDelay = 0;
    this.reset();
  }
  reset() {
    this.phPan = 0;
    this.awPan = 127;
    this.level = DEFAULT_LEVEL$1 / 127;
    this.phaser.reset();
    this.autoWah.reset();
    this.phaser.setParameter(22, 127);
    this.autoWah.setParameter(22, 127);
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { sendLevelToReverb, sendLevelToChorus, sendLevelToDelay, level } = this;
    const { bufferPh, bufferAw } = this;
    this.bufferPh.fill(0);
    this.phaser.process(inputLeft, inputLeft, bufferPh, bufferPh, bufferPh, bufferPh, bufferPh, 0, sampleCount);
    this.bufferAw.fill(0);
    this.autoWah.process(inputRight, inputRight, bufferAw, bufferAw, bufferAw, bufferAw, bufferAw, 0, sampleCount);
    const phPan = this.phPan | 0;
    const phL = PAN_TABLE_LEFT[phPan];
    const phR = PAN_TABLE_RIGHT[phPan];
    const awPan = this.awPan | 0;
    const awL = PAN_TABLE_LEFT[awPan];
    const awR = PAN_TABLE_RIGHT[awPan];
    for (let i = 0; i < sampleCount; i++) {
      const outPhaser = bufferPh[i] * 0.5 * level;
      const outAutoWah = bufferAw[i] * 0.5 * level;
      const outL = outPhaser * phL + outAutoWah * awL;
      const outR = outPhaser * phR + outAutoWah * awR;
      const idx = startIndex + i;
      outputLeft[idx] += outL;
      outputRight[idx] += outR;
      const mono = (outL + outR) * 0.5;
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
  }
  setParameter(parameter, value) {
    if (parameter >= 3 && parameter <= 7) {
      this.phaser.setParameter(parameter, value);
      return;
    }
    if (parameter >= 8 && parameter <= 14) {
      this.autoWah.setParameter(parameter - 5, value);
      return;
    }
    switch (parameter) {
      default:
        break;
      case 18:
        this.phPan = value;
        break;
      case 19:
        this.phaser.setParameter(22, value);
        break;
      case 20:
        this.awPan = value;
        break;
      case 21:
        this.autoWah.setParameter(22, value);
        break;
      case 22:
        this.level = value / 127;
        break;
    }
  }
};
var DEFAULT_LEVEL = 127;
var PI_2 = Math.PI * 2;
var GAIN_SMOOTHING = 0.01;
var TremoloFX = class {
  sendLevelToReverb = 40 / 127;
  sendLevelToChorus = 0;
  sendLevelToDelay = 0;
  type = 293;
  /**
  * Selects the type of modulation.
  * Tri:
  *  The sound will be modulated like a triangle
  * wave.
  * Sqr:
  *  The sound will be modulated like a square
  * wave.
  * Sin:
  *  The sound will be modulated like a sine
  * wave.
  * Saw1,2: The sound will be modulated like a
  * sawtooth wave. The teeth in Saw1 and
  * Saw2 point at opposite direction.
  *
  * [Tri/Sqr/Sin/Saw1/Saw2 -> 00/01/02/03/04]
  * @private
  */
  modWave = 1;
  /**
  * Adjusts the frequency of modulation.
  * [Rate1 conversion]
  * @private
  */
  modRate = 3.05;
  /**
  * Adjusts the depth of modulation.
  * [0;127]
  * @private
  */
  modDepth = 96;
  /**
  * Adjusts the gain of the low frequency range. (200Hz)
  * [-12;12]
  * @private
  */
  lowGain = 0;
  /**
  * Adjusts the gain of the high frequency range. (4kHz)
  * [-12;12]
  * @private
  */
  hiGain = 0;
  /**
  * Adjusts the output level.
  * [0;1]
  * @private
  */
  level = DEFAULT_LEVEL / 127;
  phase = 0;
  currentGain = 1;
  lsCoeffs = { ...ZERO_COEFFS };
  hsCoeffs = { ...ZERO_COEFFS };
  lsStateR = { ...ZeroStateC };
  lsStateL = { ...ZeroStateC };
  hsStateR = { ...ZeroStateC };
  hsStateL = { ...ZeroStateC };
  sampleRate;
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.reset();
  }
  reset() {
    this.modWave = 1;
    this.modRate = 3.05;
    this.modDepth = 96;
    this.lowGain = 0;
    this.hiGain = 0;
    this.level = DEFAULT_LEVEL / 127;
    this.phase = 0;
    this.currentGain = 1;
    zeroState(this.hsStateR);
    zeroState(this.hsStateL);
    zeroState(this.lsStateR);
    zeroState(this.lsStateL);
    this.updateShelves();
  }
  process(inputLeft, inputRight, outputLeft, outputRight, outputReverb, outputChorus, outputDelay, startIndex, sampleCount) {
    const { sendLevelToReverb, sendLevelToChorus, sendLevelToDelay, level, lsCoeffs, lsStateL, lsStateR, hsCoeffs, hsStateR, hsStateL, modDepth, modWave } = this;
    const rateInc = this.modRate / this.sampleRate;
    let { currentGain, phase } = this;
    for (let i = 0; i < sampleCount; i++) {
      const sL = applyShelves(inputLeft[i], lsCoeffs, hsCoeffs, lsStateL, hsStateL);
      const sR = applyShelves(inputRight[i], lsCoeffs, hsCoeffs, lsStateR, hsStateR);
      let lfo;
      switch (modWave) {
        default:
          lfo = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case 1:
          lfo = phase > 0.5 ? -1 : -Math.cos((phase - 0.75) * PI_2);
          break;
        case 2:
          lfo = Math.sin(PI_2 * phase);
          break;
        case 3:
          lfo = 1 - 2 * phase;
          break;
        case 4:
          lfo = 2 * phase - 1;
          break;
      }
      if ((phase += rateInc) >= 1) phase -= 1;
      const tremoloLevel = 1 - (lfo / 2 + 0.5) * (modDepth / 127);
      currentGain += (tremoloLevel - currentGain) * GAIN_SMOOTHING;
      const outL = sL * level * currentGain;
      const outR = sR * level * currentGain;
      const idx = startIndex + i;
      outputLeft[idx] += outL;
      outputRight[idx] += outR;
      const mono = (outL + outR) * 0.5;
      outputReverb[i] += mono * sendLevelToReverb;
      outputChorus[i] += mono * sendLevelToChorus;
      outputDelay[i] += mono * sendLevelToDelay;
    }
    this.phase = phase;
    this.currentGain = currentGain;
  }
  setParameter(parameter, value) {
    switch (parameter) {
      default:
        break;
      case 3:
        this.modWave = value;
        break;
      case 4:
        this.modRate = InsertionValueConverter.rate1(value);
        break;
      case 5:
        this.modDepth = value;
        break;
      case 19:
        this.lowGain = value - 64;
        break;
      case 20:
        this.hiGain = value - 64;
        break;
      case 22:
        this.level = value / 127;
        break;
    }
    this.updateShelves();
  }
  updateShelves() {
    computeShelfCoeffs(this.lsCoeffs, this.lowGain, 200, this.sampleRate, true);
    computeShelfCoeffs(this.hsCoeffs, this.hiGain, 4e3, this.sampleRate, false);
  }
};
var INSERTION_EFFECT_LIST = [
  ThruFX,
  StereoEQFX,
  PhaserFX,
  AutoPanFX,
  AutoWahFX,
  PhAutoWahFx,
  TremoloFX
];
var DattorroReverb = class {
  preDelay = 0;
  preLPF = 0.5;
  inputDiffusion1 = 0.75;
  inputDiffusion2 = 0.625;
  decay = 0.5;
  decayDiffusion1 = 0.7;
  decayDiffusion2 = 0.5;
  damping = 5e-3;
  excursionRate = 0.1;
  excursionDepth = 0.2;
  gain = 1;
  sampleRate;
  lp1 = 0;
  lp2 = 0;
  lp3 = 0;
  excPhase = 0;
  pDWrite = 0;
  taps;
  pDelay;
  pDLength;
  delays = new Array();
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.pDLength = sampleRate;
    this.pDelay = new Float32Array(this.pDLength);
    for (const delay of [
      4771345e-9,
      3595309e-9,
      0.012734787,
      9307483e-9,
      0.022579886,
      0.149625349,
      0.060481839,
      0.1249958,
      0.030509727,
      0.141695508,
      0.089244313,
      0.106280031
    ]) this.makeDelayLine(delay);
    this.taps = Int16Array.from([
      8937872e-9,
      0.099929438,
      0.064278754,
      0.067067639,
      0.066866033,
      6283391e-9,
      0.035818689,
      0.011861161,
      0.121870905,
      0.041262054,
      0.08981553,
      0.070931756,
      0.011256342,
      4065724e-9
    ], (x) => Math.round(x * this.sampleRate));
  }
  process(input, outputLeft, outputRight, startIndex, sampleCount) {
    const pd = this.preDelay | 0;
    const fi = this.inputDiffusion1;
    const si = this.inputDiffusion2;
    const dc = this.decay;
    const ft = this.decayDiffusion1;
    const st = this.decayDiffusion2;
    const dp = 1 - this.damping;
    const ex = this.excursionRate / this.sampleRate;
    const ed = this.excursionDepth * this.sampleRate / 1e3;
    const blockStart = this.pDWrite;
    for (let j = 0; j < sampleCount; j++) this.pDelay[(blockStart + j) % this.pDLength] = input[j];
    for (let i = 0; i < sampleCount; i++) {
      this.lp1 += this.preLPF * (this.pDelay[(this.pDLength + this.pDWrite - pd + i) % this.pDLength] - this.lp1);
      let pre = this.writeDelay(0, this.lp1 - fi * this.readDelay(0));
      pre = this.writeDelay(1, fi * (pre - this.readDelay(1)) + this.readDelay(0));
      pre = this.writeDelay(2, fi * pre + this.readDelay(1) - si * this.readDelay(2));
      pre = this.writeDelay(3, si * (pre - this.readDelay(3)) + this.readDelay(2));
      const split = si * pre + this.readDelay(3);
      const exc = ed * (1 + Math.cos(this.excPhase * 6.28));
      const exc2 = ed * (1 + Math.sin(this.excPhase * 6.2847));
      let temp = this.writeDelay(4, split + dc * this.readDelay(11) + ft * this.readDelayCAt(4, exc));
      this.writeDelay(5, this.readDelayCAt(4, exc) - ft * temp);
      this.lp2 += dp * (this.readDelay(5) - this.lp2);
      temp = this.writeDelay(6, dc * this.lp2 - st * this.readDelay(6));
      this.writeDelay(7, this.readDelay(6) + st * temp);
      temp = this.writeDelay(8, split + dc * this.readDelay(7) + ft * this.readDelayCAt(8, exc2));
      this.writeDelay(9, this.readDelayCAt(8, exc2) - ft * temp);
      this.lp3 += dp * (this.readDelay(9) - this.lp3);
      temp = this.writeDelay(10, dc * this.lp3 - st * this.readDelay(10));
      this.writeDelay(11, this.readDelay(10) + st * temp);
      const leftSample = this.readDelayAt(9, this.taps[0]) + this.readDelayAt(9, this.taps[1]) - this.readDelayAt(10, this.taps[2]) + this.readDelayAt(11, this.taps[3]) - this.readDelayAt(5, this.taps[4]) - this.readDelayAt(6, this.taps[5]) - this.readDelayAt(7, this.taps[6]);
      const idx = i + startIndex;
      outputLeft[idx] += leftSample * this.gain;
      const rightSample = this.readDelayAt(5, this.taps[7]) + this.readDelayAt(5, this.taps[8]) - this.readDelayAt(6, this.taps[9]) + this.readDelayAt(7, this.taps[10]) - this.readDelayAt(9, this.taps[11]) - this.readDelayAt(10, this.taps[12]) - this.readDelayAt(11, this.taps[13]);
      outputRight[idx] += rightSample * this.gain;
      this.excPhase += ex;
      for (let j = 0, d = this.delays[0]; j < this.delays.length; d = this.delays[++j]) {
        d[1] = d[1] + 1 & d[3];
        d[2] = d[2] + 1 & d[3];
      }
    }
    this.pDWrite = (blockStart + sampleCount) % this.pDLength;
  }
  makeDelayLine(length) {
    const len = Math.round(length * this.sampleRate);
    const nextPow2 = 2 ** Math.ceil(Math.log2(len));
    this.delays.push([
      new Float32Array(nextPow2),
      len - 1,
      0,
      nextPow2 - 1
    ]);
  }
  writeDelay(index, sample) {
    return this.delays[index][0][this.delays[index][1]] = sample;
  }
  readDelay(index) {
    return this.delays[index][0][this.delays[index][2]];
  }
  readDelayAt(index, i) {
    const delay = this.delays[index];
    return delay[0][delay[2] + i & delay[3]];
  }
  readDelayCAt(index, i) {
    const d = this.delays[index], frac = i - ~~i, mask = d[3];
    let int = ~~i + d[2] - 1;
    const x0 = d[0][int++ & mask], x1 = d[0][int++ & mask], x2 = d[0][int++ & mask], x3 = d[0][int & mask];
    const a = (3 * (x1 - x2) - x0 + x3) / 2, b = 2 * x2 + x0 - (5 * x1 + x3) / 2, c = (x2 - x0) / 2;
    return ((a * frac + b) * frac + c) * frac + x1;
  }
};
var DELAY_GAIN = 1.5;
var SpessaSynthReverb = class {
  /**
  * Dattorro reverb processor.
  * @private
  */
  dattorro;
  /**
  * Left delay line, also used for the mono delay. (character 6)
  * @private
  */
  delayLeft;
  /**
  * Right delay line.
  * @private
  */
  delayRight;
  /**
  * Output of the left (and mono) delay.
  * @private
  */
  delayLeftOutput;
  /**
  * Output of the right delay.
  * @private
  */
  delayRightOutput;
  /**
  * Input into the left delay. Mixed dry input and right output.
  * @private
  */
  delayLeftInput;
  /**
  * Pre LPF buffer for the delay characters.
  * @private
  */
  delayPreLPF;
  /**
  * Sample rate of the processor.
  * @private
  */
  sampleRate;
  /**
  * Cutoff frequency
  * @private
  */
  preLPFfc = 8e3;
  /**
  * Alpha
  * @private
  */
  preLPFa = 0;
  /**
  * Previous value
  * @private
  */
  preLPFz = 0;
  /**
  * Reverb time coefficient for different reverb characters.
  * @private
  */
  characterTimeCoefficient = 1;
  /**
  * Reverb gain coefficient for different reverb characters.
  * @private
  */
  characterGainCoefficient = 1;
  /**
  * Reverb pre-lowpass coefficient for different reverb characters.
  * @private
  */
  characterLPFCoefficient = 0;
  /**
  * Gain for the delay output.
  * @private
  */
  delayGain = 1;
  /**
  * Panning delay feedback gain (from the right to the left delay).
  * @private
  */
  panDelayFeedback = 0;
  constructor(sampleRate, maxBufferSize) {
    this.sampleRate = sampleRate;
    this.delayLeftOutput = new Float32Array(maxBufferSize);
    this.delayRightOutput = new Float32Array(maxBufferSize);
    this.delayLeftInput = new Float32Array(maxBufferSize);
    this.delayPreLPF = new Float32Array(maxBufferSize);
    this.dattorro = new DattorroReverb(sampleRate);
    this.delayLeft = new DelayLine(sampleRate);
    this.delayRight = new DelayLine(sampleRate);
  }
  _delayFeedback = 0;
  get delayFeedback() {
    return this._delayFeedback;
  }
  set delayFeedback(value) {
    this._delayFeedback = value;
    this.updateFeedback();
  }
  _character = 0;
  get character() {
    return this._character;
  }
  set character(value) {
    this._character = value;
    this.dattorro.damping = 5e-3;
    this.characterTimeCoefficient = 1;
    this.characterGainCoefficient = 1;
    this.characterLPFCoefficient = 0;
    this.dattorro.inputDiffusion1 = 0.75;
    this.dattorro.inputDiffusion2 = 0.625;
    this.dattorro.decayDiffusion1 = 0.7;
    this.dattorro.decayDiffusion2 = 0.5;
    this.dattorro.excursionRate = 0.5;
    this.dattorro.excursionDepth = 0.7;
    switch (value) {
      case 0:
        this.dattorro.damping = 0.85;
        this.characterTimeCoefficient = 0.9;
        this.characterGainCoefficient = 0.9;
        this.characterLPFCoefficient = 0.2;
        break;
      case 1:
        this.dattorro.damping = 0.2;
        this.characterGainCoefficient = 0.7;
        this.characterTimeCoefficient = 1;
        this.dattorro.decayDiffusion2 = 0.64;
        this.dattorro.decayDiffusion1 = 0.6;
        this.characterLPFCoefficient = 0.2;
        break;
      case 2:
        this.dattorro.damping = 0.56;
        this.characterGainCoefficient = 0.75;
        this.characterTimeCoefficient = 1;
        this.dattorro.decayDiffusion2 = 0.64;
        this.dattorro.decayDiffusion1 = 0.6;
        this.characterLPFCoefficient = 0.1;
        break;
      case 3:
        this.dattorro.damping = 0.3;
        this.characterGainCoefficient = 1.25;
        this.characterTimeCoefficient = 1.3;
        this.characterLPFCoefficient = 0;
        this.dattorro.decayDiffusion2 = 0.7;
        this.dattorro.decayDiffusion1 = 0.66;
        break;
      case 4:
        this.characterGainCoefficient = 1;
        this.characterTimeCoefficient = 1.2;
        this.characterLPFCoefficient = 0.1;
        this.dattorro.damping = 0.1;
        this.dattorro.decayDiffusion2 = 0.69;
        this.dattorro.decayDiffusion1 = 0.67;
        break;
      case 5:
        this.characterGainCoefficient = 0.75;
        this.dattorro.damping = 0.65;
        this.characterTimeCoefficient = 0.5;
        break;
    }
    this.updateTime();
    this.updateGain();
    this.updateLowpass();
    this.updateFeedback();
    this.delayLeft.clear();
    this.delayRight.clear();
  }
  _time = 0;
  get time() {
    return this._time;
  }
  set time(value) {
    this._time = value;
    this.updateTime();
  }
  _preDelayTime = 0;
  get preDelayTime() {
    return this._preDelayTime;
  }
  set preDelayTime(value) {
    this._preDelayTime = value;
    this.dattorro.preDelay = value / 1e3 * this.sampleRate;
  }
  _level = 0;
  get level() {
    return this._level;
  }
  set level(value) {
    this._level = value;
    this.updateGain();
  }
  _preLowpass = 0;
  get preLowpass() {
    return this._preLowpass;
  }
  set preLowpass(value) {
    this._preLowpass = value;
    this.preLPFfc = 8e3 * 0.63 ** this._preLowpass;
    const decay = Math.exp(-2 * Math.PI * this.preLPFfc / this.sampleRate);
    this.preLPFa = 1 - decay;
    this.updateLowpass();
  }
  /**
  *
  * @param input 0-based
  * @param outputLeft startIndex-based
  * @param outputRight startIndex-based
  * @param startIndex
  * @param sampleCount
  */
  process(input, outputLeft, outputRight, startIndex, sampleCount) {
    switch (this._character) {
      default:
        this.dattorro.process(input, outputLeft, outputRight, startIndex, sampleCount);
        return;
      case 6: {
        let delayIn;
        if (this._preLowpass > 0) {
          const preLPF = this.delayPreLPF;
          let z = this.preLPFz;
          const a = this.preLPFa;
          for (let i = 0; i < sampleCount; i++) {
            const x = input[i];
            z += a * (x - z);
            preLPF[i] = z;
          }
          this.preLPFz = z;
          delayIn = preLPF;
        } else delayIn = input;
        this.delayLeft.process(delayIn, this.delayLeftOutput, sampleCount);
        const g = this.delayGain;
        const delay = this.delayLeftOutput;
        for (let i = 0, o = startIndex; i < sampleCount; i++, o++) {
          const sample = delay[i] * g;
          outputRight[o] += sample;
          outputLeft[o] += sample;
        }
        return;
      }
      case 7: {
        let delayIn;
        if (this._preLowpass > 0) {
          const preLPF = this.delayPreLPF;
          let z = this.preLPFz;
          const a = this.preLPFa;
          for (let i = 0; i < sampleCount; i++) {
            const x = input[i];
            z += a * (x - z);
            preLPF[i] = z;
          }
          this.preLPFz = z;
          delayIn = preLPF;
        } else delayIn = input;
        const fb = this.panDelayFeedback;
        const { delayLeftInput, delayLeftOutput, delayRightOutput } = this;
        for (let i = 0; i < sampleCount; i++) delayLeftInput[i] = delayIn[i] + delayRightOutput[i] * fb;
        this.delayLeft.process(delayLeftInput, delayLeftOutput, sampleCount);
        this.delayRight.process(delayLeftOutput, delayRightOutput, sampleCount);
        const g = this.delayGain;
        for (let i = 0, o = startIndex; i < sampleCount; i++, o++) {
          outputLeft[o] += delayLeftOutput[i] * g;
          outputRight[o] += delayRightOutput[i] * g;
        }
        return;
      }
    }
  }
  getSnapshot() {
    return {
      level: this._level,
      preLowpass: this._preLowpass,
      character: this._character,
      time: this._time,
      delayFeedback: this._delayFeedback,
      preDelayTime: this._preDelayTime
    };
  }
  updateFeedback() {
    const exp = 1 - (1 - this._delayFeedback / 127) ** 1.9;
    if (this._character === 6) this.delayLeft.feedback = exp * 0.73;
    else {
      this.delayLeft.feedback = this.delayRight.feedback = 0;
      this.panDelayFeedback = exp * 0.73;
    }
  }
  updateLowpass() {
    this.dattorro.preLPF = Math.min(1, 0.1 + (7 - this.preLowpass) / 14 + this.characterLPFCoefficient);
  }
  updateGain() {
    this.dattorro.gain = this._level / 345 * this.characterGainCoefficient;
    this.delayGain = this._level / 127 * DELAY_GAIN;
  }
  updateTime() {
    const t = this._time / 127;
    this.dattorro.decay = this.characterTimeCoefficient * (0.05 + 0.65 * t);
    const timeSamples = Math.max(21, t * this.sampleRate * 0.4468 | 0);
    if (this.character === 7) this.delayRight.time = this.delayLeft.time = Math.floor(timeSamples / 2);
    else this.delayLeft.time = timeSamples;
  }
};
var DEFAULT_GLOBAL_MIDI_PARAMETERS = {
  volume: 1,
  pan: 0,
  keyShift: 0,
  fineTune: 0,
  system: "gs"
};
function setMIDIParameterInternal(parameter, value) {
  if (this.lockedMIDIParameters[parameter]) return;
  this.midiParameters[parameter] = value;
  for (const ch of this.midiChannels) ch.updateInternalParams();
  this.callEvent("globalParamChange", {
    parameter,
    value
  });
}
function lockMIDIParameterInternal(parameter, isLocked) {
  this.lockedMIDIParameters[parameter] = isLocked;
}
var GAIN_SMOOTHING_FACTOR = 0.01;
var PAN_SMOOTHING_FACTOR = 0.05;
var SynthesizerCore = class {
  /**
  * Voices of this synthesizer, as a fixed voice pool.
  */
  voices = [];
  /**
  * All MIDI channels of the synthesizer.
  */
  midiChannels = [];
  /**
  * The maximum allowed buffer size to render.
  */
  maxBufferSize;
  /**
  * The buffer to use when rendering a voice.
  */
  voiceBuffer;
  /**
  * The insertion processor's left input buffer.
  */
  insertionInputL;
  /**
  * The insertion processor's right input buffer.
  */
  insertionInputR;
  /**
  * The reverb processor's input buffer.
  */
  reverbInput;
  /**
  * The chorus processor's input buffer.
  */
  chorusInput;
  /**
  * The delay processor's input buffer.
  */
  delayInput;
  /**
  * Delay is not used outside SC-88+ MIDIs, this is an optimization.
  */
  delayActive = false;
  /**
  * The sound bank manager, which manages all sound banks and presets.
  */
  soundBankManager = new SoundBankManager(this.updatePresetList.bind(this));
  /**
  * Handles the custom key overrides: velocity and preset
  */
  keyModifierManager = new KeyModifierManager();
  sampleRate;
  /**
  * This.tunings[program * 128 + key] = midiNote,cents (fraction)
  * All MIDI Tuning Standard tunings, 128 keys for each of 128 programs.
  * -1 means no change.
  */
  tunings = new Float32Array(16384).fill(-1);
  /**
  * An object indicating if a Global MIDI parameter, at the equivalent key, is locked
  * (i.e., not allowed changing).
  * A locked parameter cannot be modified.
  * @internal
  */
  lockedMIDIParameters = Object.fromEntries(Object.keys(DEFAULT_GLOBAL_MIDI_PARAMETERS).map((key) => [key, false]));
  /**
  * The global MIDI parameters of the synthesizer.
  */
  midiParameters = { ...DEFAULT_GLOBAL_MIDI_PARAMETERS };
  /**
  * The system parameters of the synthesizer.
  */
  systemParameters = { ...DEFAULT_GLOBAL_SYSTEM_PARAMETERS };
  /**
  * The current time of the synthesizer, in seconds.
  */
  currentTime = 0;
  /**
  * Synth's default (reset) preset.
  */
  defaultPreset;
  /**
  * Synth's default (reset) drum preset.
  */
  drumPreset;
  /**
  * Gain smoothing factor, adjusted to the sample rate.
  */
  gainSmoothingFactor;
  /**
  * Pan smoothing factor, adjusted to the sample rate.
  */
  panSmoothingFactor;
  /**
  * Calls when an event occurs.
  * @param eventType The event type.
  * @param eventData The event data.
  */
  eventCallbackHandler;
  missingPresetHandler;
  /**
  * Cached voices for all presets for this synthesizer.
  * Nesting is calculated in getCachedVoiceIndex, returns a list of voices for this note.
  */
  cachedVoices = /* @__PURE__ */ new Map();
  /**
  * Locks or unlocks a given Global MIDI Parameter.
  * This prevents any changes to it until it's unlocked.
  * @param parameter The Global MIDI Parameter to lock.
  * @param isLocked If the parameter should be locked.
  */
  lockMIDIParameter = lockMIDIParameterInternal.bind(this);
  /**
  * Sets a system parameter of the synthesizer.
  * @param type The type of the system parameter to set.
  * @param value The value to set for the system parameter.
  */
  setSystemParameter = setSystemParameterInternal.bind(this);
  systemExclusive = systemExclusiveInternal.bind(this);
  /**
  * The synthesizer's reverb processor.
  */
  reverbProcessor;
  /**
  * The synthesizer's chorus processor.
  */
  chorusProcessor;
  /**
  * The synthesizer's delay processor.
  */
  delayProcessor;
  /**
  * Insertion is not used outside SC-88Pro+ MIDIs, this is an optimization.
  */
  insertionActive = false;
  /**
  * A sysEx may set a "Part" (channel) to receive on a different channel number.
  * This slows down the access, so this toggle tracks if it's enabled or not.
  */
  customChannelNumbers = false;
  /**
  * Sets a global MIDI parameter of the synthesizer.
  * @param parameter The type of the global MIDI parameter to set.
  * @param value The value to set for the global MIDI parameter.
  */
  setMIDIParameter = setMIDIParameterInternal.bind(this);
  /**
  * The fallback processor when the requested insertion is not available.
  */
  insertionFallback = new ThruFX();
  /**
  * The current insertion processor.
  */
  insertionProcessor = this.insertionFallback;
  /**
  * All the insertion effects available to the processor.
  * The key is the EFX type stored as MSB << 8 | LSB
  */
  insertionEffects = /* @__PURE__ */ new Map();
  /**
  * For F5 system exclusive.
  */
  portSelectChannelOffset = 0;
  /**
  * For insertion snapshot tracking
  * 20 parameters (0-19) + 3 sends
  * Index to gs is Addr3 - 3 (for example EFX PARAMETER 1 is 0x03 and here it's 0)
  * note: 255 means "no change"
  * @protected
  */
  insertionParams = new Uint8Array(23).fill(255);
  /**
  * Last time the priorities were assigned.
  * Used to prevent assigning priorities multiple times when more than one voice is triggered during a quantum.
  */
  lastPriorityAssignmentTime = 0;
  /**
  * Synth's event queue from the main thread
  */
  eventQueue = [];
  /**
  * The time of a single sample, in seconds.
  */
  sampleTime;
  constructor(eventCallbackHandler, missingPresetHandler, sampleRate, options) {
    this.eventCallbackHandler = eventCallbackHandler;
    this.missingPresetHandler = missingPresetHandler;
    this.sampleRate = sampleRate;
    this.sampleTime = 1 / sampleRate;
    this.currentTime = options.initialTime;
    this.setSystemParameter("effectsEnabled", options.effectsEnabled);
    this.setSystemParameter("eventsEnabled", options.eventsEnabled);
    this.maxBufferSize = options.maxBufferSize;
    this.gainSmoothingFactor = GAIN_SMOOTHING_FACTOR * (44100 / sampleRate);
    this.panSmoothingFactor = PAN_SMOOTHING_FACTOR * (44100 / sampleRate);
    LowpassFilter.initCache(this.sampleRate);
    const bufSize = this.maxBufferSize;
    this.reverbProcessor = options.reverbProcessor ?? new SpessaSynthReverb(sampleRate, bufSize);
    this.chorusProcessor = options.chorusProcessor ?? new SpessaSynthChorus(sampleRate, bufSize);
    this.delayProcessor = options.delayProcessor ?? new SpessaSynthDelay(sampleRate, bufSize);
    this.voiceBuffer = new Float32Array(bufSize);
    this.insertionInputL = new Float32Array(bufSize);
    this.insertionInputR = new Float32Array(bufSize);
    this.reverbInput = new Float32Array(bufSize);
    this.chorusInput = new Float32Array(bufSize);
    this.delayInput = new Float32Array(bufSize);
    for (const insertion of INSERTION_EFFECT_LIST) this.registerInsertionProcessor(insertion);
    this.resetInsertionParams();
    this.allocateNewVoices(this.systemParameters.voiceCap);
  }
  /**
  * Current total amount of voices that are playing.
  */
  _voiceCount = 0;
  /**
  * Current total amount of voices that are playing.
  */
  get voiceCount() {
    return this._voiceCount;
  }
  controllerChange(channel, controller, value) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.controllerChange(controller, value);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].controllerChange(controller, value);
  }
  noteOn(channel, midiNote, velocity) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.noteOn(midiNote, velocity);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].noteOn(midiNote, velocity);
  }
  noteOff(channel, midiNote) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.noteOff(midiNote);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].noteOff(midiNote);
  }
  polyPressure(channel, midiNote, pressure) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.polyPressure(midiNote, pressure);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].polyPressure(midiNote, pressure);
  }
  channelPressure(channel, pressure) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.setMIDIParameter("pressure", pressure);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].setMIDIParameter("pressure", pressure);
  }
  pitchWheel(channel, pitch, midiNote = -1) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.pitchWheel(pitch, midiNote);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].pitchWheel(pitch, midiNote);
  }
  programChange(channel, programNumber) {
    if (this.customChannelNumbers) {
      for (const ch of this.midiChannels) if (ch.midiParameters.rxChannel === channel) ch.programChange(programNumber);
      return;
    }
    this.midiChannels[channel + this.portSelectChannelOffset].programChange(programNumber);
  }
  /**
  * Assigns the first available voice for use.
  * If none available, will assign priorities.
  */
  assignVoice() {
    for (let i = 0; i < this.systemParameters.voiceCap; i++) {
      const v = this.voices[i];
      if (!v.isActive) {
        v.priority = Infinity;
        return v;
      }
    }
    if (this.systemParameters.autoAllocateVoices) {
      SpessaLog.info(`%cAllocating a new voice, total count %c${this.systemParameters.voiceCap + 1}.`, ConsoleColors.info, ConsoleColors.value);
      this.allocateNewVoices(1);
      const v = this.voices[this.voices.length - 1];
      this.systemParameters.voiceCap++;
      v.priority = Infinity;
      return v;
    }
    this.assignVoicePriorities();
    let lowest = this.voices[0];
    for (let i = 0; i < this.systemParameters.voiceCap; i++) {
      const v = this.voices[i];
      if (v.priority < lowest.priority) lowest = v;
    }
    lowest.priority = Infinity;
    return lowest;
  }
  /**
  * Stops all notes on all channels.
  * @param force if true, all notes are stopped immediately, otherwise they are stopped gracefully.
  */
  stopAllChannels(force) {
    SpessaLog.info("%cStop all received!", ConsoleColors.info);
    for (const channel of this.midiChannels) channel.stopAllNotes(force);
  }
  /**
  * Processes a raw MIDI message.
  * @param message The message to process.
  * @param channelOffset The channel offset for the message.
  * @param options Additional options for scheduling the message.
  */
  processMessage(message, channelOffset = 0, options = DEFAULT_SYNTH_METHOD_OPTIONS) {
    const raw = message instanceof MIDIMessage ? [message.statusByte, ...message.data] : message;
    const time = options.time;
    if (time > this.currentTime) {
      this.eventQueue.push({
        message: raw,
        channelOffset,
        time
      });
      this.eventQueue.sort((e1, e2) => e1.time - e2.time);
    } else this.processMessageInternal(raw, channelOffset);
  }
  /**
  * Processes multiple MIDI messages.
  * @param messages The messages to process.
  * @param channelOffset The channel offset for the messages
  * @param options Additional options for scheduling the messages.
  */
  processMessages(messages, channelOffset = 0, options = DEFAULT_SYNTH_METHOD_OPTIONS) {
    for (const message of messages) this.processMessage(message, channelOffset, options);
  }
  destroySynthProcessor() {
    this.voices.length = 0;
    for (const c of this.midiChannels) c.destroy();
    this.clearCache();
    this.midiChannels.length = 0;
    this.soundBankManager.destroy();
  }
  /**
  * @param channel channel to get voices for
  * @param midiNote the MIDI note to use
  * @param velocity the velocity to use
  * @returns output is an array of Voices
  */
  getVoices(channel, midiNote, velocity) {
    const channelObject = this.midiChannels[channel];
    const overridePatch = this.keyModifierManager.hasOverridePatch(channel, midiNote);
    let preset = channelObject.preset;
    if (overridePatch) {
      const patch = this.keyModifierManager.getPatch(channel, midiNote);
      preset = this.soundBankManager.getPreset(patch, this.midiParameters.system);
    }
    if (!preset) return [];
    return this.getVoicesForPreset(preset, midiNote, velocity);
  }
  createMIDIChannel(sendEvent) {
    const channel = new MIDIChannel(this, this.defaultPreset, this.midiChannels.length);
    this.midiChannels.push(channel);
    if (sendEvent) {
      this.callEvent("channelAdded", void 0);
      channel.setDrums(true);
    }
  }
  /**
  * Executes a full system reset of the synthesizer.
  * This will reset all controllers to their default values,
  * except for the locked controllers.
  * @param system The MIDI system to reset the synthesizer to. Defaults to `gs`.
  */
  reset(system = "gs") {
    this.callEvent("reset", system);
    this.setMIDIParameter("system", system);
    this.setMIDIParameter("volume", 1);
    this.setMIDIParameter("pan", 0);
    this.setMIDIParameter("keyShift", 0);
    this.setMIDIParameter("fineTune", 0);
    this.tunings.fill(-1);
    this.portSelectChannelOffset = 0;
    this.customChannelNumbers = false;
    this.setReverbMacro(4);
    this.setChorusMacro(2);
    this.setDelayMacro(0);
    this.resetInsertion();
    if (!this.drumPreset || !this.defaultPreset) return;
    for (const ch of this.midiChannels) ch.reset(false);
    this.updateActiveEffects();
  }
  process(left, right, startIndex = 0, sampleCount = 0) {
    this.processSplit([[left, right]], left, right, startIndex, sampleCount);
  }
  /**
  * The main rendering pipeline, renders all voices and processes the effects:
  * ```
  *                   ┌────────────────────────────────┐
  *                   │        Voice Processor         │
  *                   └───────────────┬────────────────┘
  *                                   │
  *                   ┌───────────────┴────────────────┐
  *                   │      Insertion Processor       │
  *                   │      (Bypass or Process)       │
  *                   └───────────────┬────────────────┘
  *                                   │
  *              ┌──────────┬─────────┼────────────────────────┐
  *              │          │         │                        │
  *              │          │         𜸊                        │
  *              │          │ ┌───────┴───────┐                │
  *              │          │ │    Chorus     │                │
  *              │          │ │   Processor   ├──────────┐     │
  *              │          │ └─┬──────────┬──┘          │     │
  *              │          │   │          │             │     │
  *              │          │   │          │             │     │
  *              │          │   │          │             │     │
  *              │          │   │          │             │     │
  *              │          │   │          𜸊             𜸊     𜸊
  *              │          │   │ ┌────────┴───────┐   ┌─┴─────┴────────┐
  *              │          └───┼>┤     Delay      ├─>>┤     Reverb     │
  *              │              │ │   Processor    │   │   Processor    │
  *              │              │ └────────┬───────┘   └───────┬────────┘
  *              │              │          │                   │
  *              │              │          │                   │
  *              │              │          │                   │
  *              │              │          │                   │
  *              𜸊              𜸊          𜸊                   𜸊
  *    ┌─────────┴──────────┐ ┌─┴──────────┴───────────────────┴────┐
  *    │  Dry Output Pairs  │ │        Stereo Effects Output        │
  *    └────────────────────┘ └─────────────────────────────────────┘
  * ```
  * The pipeline is quite similar to the one on SC-8850 manual page 78.
  * All output arrays must be the same length, the method will crash otherwise.
  * @param outputs The stereo pairs for each MIDI channel's dry output, will be wrapped if less.
  * @param effectsLeft The left stereo effect output buffer.
  * @param effectsRight The right stereo effect output buffer.
  * @param startIndex The index to start writing at into the output buffer.
  * @param samples The amount of samples to write.
  */
  processSplit(outputs, effectsLeft, effectsRight, startIndex = 0, samples = 0) {
    if (this.eventQueue.length > 0) {
      const time = this.currentTime;
      while (this.eventQueue[0]?.time <= time) {
        const q = this.eventQueue.shift();
        if (q) this.processMessageInternal(q.message, q.channelOffset);
      }
    }
    startIndex = Math.max(startIndex, 0);
    const sampleCount = samples || outputs[0][0].length - startIndex;
    if (sampleCount > this.maxBufferSize) throw new Error(`Requested ${sampleCount} samples, but maxBufferSize is ${this.maxBufferSize}`);
    this.reverbInput.fill(0);
    this.chorusInput.fill(0);
    if (this.delayActive) this.delayInput.fill(0);
    if (this.insertionActive) {
      this.insertionInputL.fill(0);
      this.insertionInputR.fill(0);
    }
    for (const c of this.midiChannels) c.clearVoiceCount();
    this._voiceCount = 0;
    const cap = this.systemParameters.voiceCap;
    const outputCount = outputs.length;
    for (let i = 0; i < cap; i++) {
      const v = this.voices[i];
      const ch = this.midiChannels[v.channel];
      if (!v.isActive) continue;
      const outputIndex = v.channel % outputCount;
      ch.renderVoice(v, this.currentTime, outputs[outputIndex][0], outputs[outputIndex][1], startIndex, sampleCount);
      ch.voiceCount++;
      this._voiceCount++;
    }
    if (this.systemParameters.effectsEnabled) {
      const { chorusInput, delayInput, reverbInput, insertionInputR, insertionInputL } = this;
      if (this.insertionActive) this.insertionProcessor.process(insertionInputL, insertionInputR, effectsLeft, effectsRight, reverbInput, chorusInput, delayInput, startIndex, sampleCount);
      this.chorusProcessor.process(chorusInput, effectsLeft, effectsRight, reverbInput, delayInput, startIndex, sampleCount);
      if (this.delayActive && this.midiParameters.system !== "xg") this.delayProcessor.process(delayInput, effectsLeft, effectsRight, reverbInput, startIndex, sampleCount);
      this.reverbProcessor.process(reverbInput, effectsLeft, effectsRight, startIndex, sampleCount);
    }
    this.currentTime += sampleCount * this.sampleTime;
  }
  /**
  * Gets voices for a preset.
  * @param preset The preset to get voices for.
  * @param midiNote The MIDI note to use.
  * @param velocity The velocity to use.
  * @returns Output is an array of voices.
  */
  getVoicesForPreset(preset, midiNote, velocity) {
    const cached = this.getCachedVoice(preset, midiNote, velocity);
    if (cached !== void 0) return cached;
    const voices = new Array();
    for (const voiceParams of preset.getVoiceParameters(midiNote, velocity)) {
      const sample = voiceParams.sample;
      if (voiceParams.sample.getAudioData() === void 0) {
        SpessaLog.warn(`Discarding invalid sample: ${sample.name}`);
        continue;
      }
      voices.push(new CachedVoice(voiceParams, midiNote, velocity, this.sampleRate));
    }
    this.setCachedVoice(preset, midiNote, velocity, voices);
    return voices;
  }
  clearCache() {
    this.cachedVoices.clear();
  }
  /**
  * Copied callback so MIDI channels can call it.
  */
  callEvent(eventName, eventData) {
    this.eventCallbackHandler(eventName, eventData);
  }
  /**
  * @internal
  * Checks if we can disable insertion and delay effects.
  */
  updateActiveEffects() {
    if (!this.systemParameters.insertionEffectLock) this.insertionActive = this.midiChannels.some((c) => c.midiParameters.efxAssign);
    if (!this.systemParameters.delayLock) this.delayActive = this.midiParameters.system === "xg" ? false : this.chorusProcessor.sendLevelToDelay > 0 || this.insertionProcessor.sendLevelToDelay > 0 || this.midiChannels.some((c) => c.midiControllers[MIDIControllers.variationDepth] > 0);
  }
  getInsertionSnapshot() {
    return {
      type: this.insertionProcessor.type,
      params: this.insertionParams.slice()
    };
  }
  resetInsertionParams() {
    this.insertionParams.fill(255);
    this.insertionParams[20] = 40;
    this.insertionParams[21] = 0;
    this.insertionParams[22] = 0;
  }
  resetInsertion() {
    if (this.systemParameters.insertionEffectLock) return;
    this.insertionProcessor = this.insertionFallback;
    this.insertionProcessor.reset();
    this.resetInsertionParams();
    this.insertionProcessor.sendLevelToReverb = 40 / 127 * EFX_SENDS_GAIN_CORRECTION;
    this.insertionProcessor.sendLevelToChorus = 0;
    this.insertionProcessor.sendLevelToDelay = 0;
    this.callEvent("effectChange", {
      effect: "insertion",
      parameter: 0,
      value: this.insertionProcessor.type
    });
  }
  setReverbMacro(macro) {
    if (this.systemParameters.reverbLock) return;
    const rev = this.reverbProcessor;
    rev.level = 64;
    rev.preDelayTime = 0;
    rev.character = macro;
    switch (macro) {
      /**
      * REVERB MACRO is a macro parameter that allows global setting of reverb parameters.
      * When you select the reverb type with REVERB MACRO, each reverb parameter will be set to their most
      * suitable value.
      *
      * Room1, Room2, Room3
      * These reverbs simulate the reverberation of a room. They provide a well-defined
      * spacious reverberation.
      * Hall1, Hall2
      * These reverbs simulate the reverberation of a concert hall. They provide a deeper
      * reverberation than the Room reverbs.
      * Plate
      * This simulates a plate reverb (a studio device using a metal plate).
      * Delay
      * This is a conventional delay that produces echo effects.
      * Panning Delay
      * This is a special delay in which the delayed sounds move left and right.
      * It is effective when you are listening in stereo.
      */
      case 0:
        rev.character = 0;
        rev.preLowpass = 3;
        rev.time = 80;
        rev.delayFeedback = 0;
        rev.preDelayTime = 0;
        break;
      case 1:
        rev.preLowpass = 4;
        rev.time = 56;
        rev.delayFeedback = 0;
        break;
      case 2:
        rev.preLowpass = 0;
        rev.time = 72;
        rev.delayFeedback = 0;
        break;
      case 3:
        rev.preLowpass = 4;
        rev.time = 72;
        rev.delayFeedback = 0;
        break;
      case 4:
        rev.preLowpass = 0;
        rev.time = 64;
        rev.delayFeedback = 0;
        break;
      case 5:
        rev.preLowpass = 0;
        rev.time = 88;
        rev.delayFeedback = 0;
        break;
      case 6:
        rev.preLowpass = 0;
        rev.time = 32;
        rev.delayFeedback = 40;
        break;
      case 7:
        rev.preLowpass = 0;
        rev.time = 64;
        rev.delayFeedback = 32;
        break;
      default:
        SpessaLog.warn(`Invalid reverb macro: ${macro}`);
        return;
    }
    this.callEvent("effectChange", {
      effect: "reverb",
      parameter: "macro",
      value: macro
    });
  }
  setChorusMacro(macro) {
    if (this.systemParameters.chorusLock) return;
    const chr = this.chorusProcessor;
    chr.level = 64;
    chr.preLowpass = 0;
    chr.delay = 127;
    chr.sendLevelToDelay = 0;
    chr.sendLevelToReverb = 0;
    switch (macro) {
      /**
      * CHORUS MACRO is a macro parameter that allows global setting of chorus parameters.
      * When you select the chorus type with CHORUS MACRO, each chorus parameter will be set to their
      * most suitable value.
      *
      * Chorus1, Chorus2, Chorus3, Chorus4
      * These are conventional chorus effects that add spaciousness and depth to the
      * sound.
      * Feedback Chorus
      * This is a chorus with a flanger-like effect and a soft sound.
      * Flanger
      * This is an effect sounding somewhat like a jet airplane taking off and landing.
      * Short Delay
      * This is a delay with a short delay time.
      * Short Delay (FB)
      * This is a short delay with many repeats.
      */
      case 0:
        chr.feedback = 0;
        chr.delay = 112;
        chr.rate = 3;
        chr.depth = 5;
        break;
      case 1:
        chr.feedback = 5;
        chr.delay = 80;
        chr.rate = 9;
        chr.depth = 19;
        break;
      case 2:
        chr.feedback = 8;
        chr.delay = 80;
        chr.rate = 3;
        chr.depth = 19;
        break;
      case 3:
        chr.feedback = 16;
        chr.delay = 64;
        chr.rate = 9;
        chr.depth = 16;
        break;
      case 4:
        chr.feedback = 64;
        chr.delay = 127;
        chr.rate = 2;
        chr.depth = 24;
        break;
      case 5:
        chr.feedback = 112;
        chr.delay = 127;
        chr.rate = 1;
        chr.depth = 5;
        break;
      case 6:
        chr.feedback = 0;
        chr.depth = 127;
        chr.rate = 0;
        chr.depth = 127;
        break;
      case 7:
        chr.feedback = 80;
        chr.depth = 127;
        chr.rate = 0;
        chr.depth = 127;
        break;
      default:
        SpessaLog.warn(`Invalid chorus macro: ${macro}`);
        return;
    }
    this.callEvent("effectChange", {
      effect: "chorus",
      parameter: "macro",
      value: macro
    });
  }
  setDelayMacro(macro) {
    if (this.systemParameters.delayLock) return;
    const dly = this.delayProcessor;
    dly.level = 64;
    dly.preLowpass = 0;
    dly.sendLevelToReverb = 0;
    dly.levelRight = dly.levelLeft = 0;
    dly.levelCenter = 127;
    switch (macro) {
      /**
      * DELAY MACRO is a macro parameter that allows global setting of delay parameters. When you select the delay type with DELAY MACRO, each delay parameter will be set to their most
      * suitable value.
      *
      * Delay1, Delay2, Delay3
      * These are conventional delays. 1, 2 and 3 have progressively longer delay times.
      * Delay4
      * This is a delay with a rather short delay time.
      * Pan Delay1. Pan Delay2. Pan Delay3
      * The delay sound moves between left and right. This is effective when listening in
      * stereo. 1, 2 and 3 have progressively longer delay times.
      * Pan Delay4
      * This is a rather short delay with the delayed sound moving between left and
      * right.
      * It is effective when listening in stereo.
      * Dly To Rev
      * Reverb is added to the delay sound, which moves between left and right.
      * It is effective when listening in stereo.
      * PanRepeat
      * The delay sound moves between left and right,
      * but the pan positioning is different from the effects listed above.
      * It is effective when listening in stereo.
      */
      case 0:
        dly.timeCenter = 97;
        dly.timeRatioRight = dly.timeRatioLeft = 1;
        dly.feedback = 80;
        break;
      case 1:
        dly.timeCenter = 106;
        dly.timeRatioRight = dly.timeRatioLeft = 1;
        dly.feedback = 80;
        break;
      case 2:
        dly.timeCenter = 115;
        dly.timeRatioRight = dly.timeRatioLeft = 1;
        dly.feedback = 72;
        break;
      case 3:
        dly.timeCenter = 83;
        dly.timeRatioRight = dly.timeRatioLeft = 1;
        dly.feedback = 72;
        break;
      case 4:
        dly.timeCenter = 105;
        dly.timeRatioLeft = 12;
        dly.timeRatioRight = 24;
        dly.levelCenter = 0;
        dly.levelLeft = 125;
        dly.levelRight = 60;
        dly.feedback = 74;
        break;
      case 5:
        dly.timeCenter = 109;
        dly.timeRatioLeft = 12;
        dly.timeRatioRight = 24;
        dly.levelCenter = 0;
        dly.levelLeft = 125;
        dly.levelRight = 60;
        dly.feedback = 71;
        break;
      case 6:
        dly.timeCenter = 115;
        dly.timeRatioLeft = 12;
        dly.timeRatioRight = 24;
        dly.levelCenter = 0;
        dly.levelLeft = 120;
        dly.levelRight = 64;
        dly.feedback = 73;
        break;
      case 7:
        dly.timeCenter = 93;
        dly.timeRatioLeft = 12;
        dly.timeRatioRight = 24;
        dly.levelCenter = 0;
        dly.levelLeft = 120;
        dly.levelRight = 64;
        dly.feedback = 72;
        break;
      case 8:
        dly.timeCenter = 109;
        dly.timeRatioLeft = 12;
        dly.timeRatioRight = 24;
        dly.levelCenter = 0;
        dly.levelLeft = 114;
        dly.levelRight = 60;
        dly.feedback = 61;
        dly.sendLevelToReverb = 36;
        break;
      case 9:
        dly.timeCenter = 110;
        dly.timeRatioLeft = 21;
        dly.timeRatioRight = 32;
        dly.levelCenter = 97;
        dly.levelLeft = 127;
        dly.levelRight = 67;
        dly.feedback = 40;
        break;
      default:
        SpessaLog.warn(`Invalid delay macro: ${macro}`);
        return;
    }
    this.callEvent("effectChange", {
      effect: "delay",
      parameter: "macro",
      value: macro
    });
  }
  getCachedVoice(patch, midiNote, velocity) {
    return this.cachedVoices.get(this.getCachedVoiceIndex(patch, midiNote, velocity));
  }
  setCachedVoice(patch, midiNote, velocity, voices) {
    this.cachedVoices.set(this.getCachedVoiceIndex(patch, midiNote, velocity), voices);
  }
  /**
  * Allocates new voices.
  * @param count
  * @protected
  */
  allocateNewVoices(count) {
    for (let i = 0; i < count; i++) this.voices.push(new Voice(this.sampleRate, this.maxBufferSize));
  }
  registerInsertionProcessor(proc) {
    const p = new proc(this.sampleRate, this.maxBufferSize);
    this.insertionEffects.set(p.type, p);
  }
  processMessageInternal(message, channelOffset) {
    const byte = message[0];
    let status;
    let channel = 0;
    if (byte >= 128 && byte < 240) {
      status = byte & 240;
      channel = byte & 15;
    } else status = byte;
    channel += channelOffset;
    switch (status) {
      case MIDIMessageTypes.noteOn: {
        const velocity = message[2];
        if (velocity > 0) this.noteOn(channel, message[1], velocity);
        else this.noteOff(channel, message[1]);
        break;
      }
      case MIDIMessageTypes.noteOff:
        this.noteOff(channel, message[1]);
        break;
      case MIDIMessageTypes.pitchWheel:
        this.pitchWheel(channel, message[2] << 7 | message[1]);
        break;
      case MIDIMessageTypes.controllerChange:
        this.controllerChange(channel, message[1], message[2]);
        break;
      case MIDIMessageTypes.programChange:
        this.programChange(channel, message[1]);
        break;
      case MIDIMessageTypes.polyPressure:
        this.polyPressure(channel, message[1], message[2]);
        break;
      case MIDIMessageTypes.channelPressure:
        this.channelPressure(channel, message[1]);
        break;
      case MIDIMessageTypes.systemExclusive:
        this.systemExclusive(new IndexedByteArray(message.slice(1)), channelOffset);
        break;
      case MIDIMessageTypes.reset:
        this.stopAllChannels(false);
        this.reset();
        break;
      default:
        break;
    }
  }
  /**
  * Assigns priorities to the voices.
  * Gets the priority of a voice based on its channel and state.
  * Higher priority means the voice is more important and should be kept longer.
  */
  assignVoicePriorities() {
    if (this.lastPriorityAssignmentTime === this.currentTime) return;
    SpessaLog.info("%cPolyphony exceeded, stealing voices", ConsoleColors.warn);
    this.lastPriorityAssignmentTime = this.currentTime;
    const cap = this.systemParameters.voiceCap;
    for (let i = 0; i < cap; i++) {
      const voice = this.voices[i];
      voice.priority = 0;
      if (this.midiChannels[voice.channel].drumChannel) voice.priority += 5;
      if (voice.isInRelease) voice.priority -= 5;
      voice.priority += voice.velocity / 25;
      voice.priority -= voice.volEnv.state;
      if (voice.isInRelease) voice.priority -= 5;
      voice.priority -= voice.volEnv.attenuationCb / 200;
    }
  }
  updatePresetList() {
    const mainFont = this.soundBankManager.presetList;
    this.clearCache();
    this.callEvent("presetListChange", mainFont);
    this.getDefaultPresets();
    for (const c of this.midiChannels) {
      const lock = c.systemParameters.presetLock;
      c.setSystemParameter("presetLock", false);
      c.programChange(c.patch.program);
      c.setSystemParameter("presetLock", lock);
    }
    this.reset();
  }
  getDefaultPresets() {
    this.defaultPreset = this.soundBankManager.getPreset({
      bankLSB: 0,
      bankMSB: 0,
      program: 0,
      isGMGSDrum: false
    }, "xg");
    this.drumPreset = this.soundBankManager.getPreset({
      bankLSB: 0,
      bankMSB: 0,
      program: 0,
      isGMGSDrum: true
    }, "gs");
  }
  getCachedVoiceIndex(patch, midiNote, velocity) {
    let bankMSB = patch.bankMSB;
    let bankLSB = patch.bankLSB;
    const { isGMGSDrum, program } = patch;
    if (isGMGSDrum) {
      bankMSB = 128;
      bankLSB = 0;
    }
    return bankMSB + bankLSB * 128 + program * 16384 + 2097152 * midiNote + 268435456 * velocity;
  }
};
var SpessaSynthProcessor = class {
  /**
  * Controls if the processor is fully initialized.
  */
  processorInitialized = BasicSoundBank.isSF3DecoderReady;
  /**
  * Sample rate in Hertz.
  */
  sampleRate;
  /**
  * Calls when an event occurs.
  * @param event The event that occurred.
  */
  onEventCall;
  /**
  * Renders float32 audio data to stereo outputs; buffer size must be equal or smaller than `maxBufferSize`.
  * All float arrays must have the same length.
  * @param left the left output channel.
  * @param right the right output channel.
  * @param startIndex start offset of the passed arrays, rendering starts at this index, defaults to 0.
  * @param sampleCount the length of the rendered buffer, defaults to float32array length - startOffset.
  */
  process;
  /**
  * Renders float32 audio data to stereo outputs; buffer size must be equal or smaller than `maxBufferSize`.
  * All float arrays must have the same length.
  * @param outputs any number stereo pairs (L, R) to render channels separately into.
  * @param effectsLeft the left stereo effect output buffer.
  * @param effectsRight the left stereo effect output buffer.
  * @param startIndex start offset of the passed arrays, rendering starts at this index, defaults to 0.
  * @param sampleCount the length of the rendered buffer, defaults to float32array length - startOffset.
  */
  processSplit;
  /**
  * Executes a system exclusive message for the synthesizer.
  * @param syx The system exclusive message as an array of bytes.
  * @param channelOffset The channel offset to apply (default is 0).
  */
  systemExclusive;
  /**
  * Executes a MIDI controller change message on the specified channel.
  * @param channel The MIDI channel to change the controller on.
  * @param controller The MIDI controller number (0-127).
  * @param value The value of the controller (0-127).
  */
  controllerChange;
  /**
  * Executes a MIDI Note On message on the specified channel.
  * Starts playing a note.
  * @param channel The MIDI channel to send the note on.
  * @param midiNote The MIDI note number to play.
  * @param velocity The velocity of the note, from 0 to 127.
  * @remarks
  * If the velocity is 0, it will be treated as a Note Off message.
  */
  noteOn;
  /**
  * Executes a MIDI Note Off message on the specified channel.
  * Stops playing a note.
  * @param channel The MIDI channel to send the note off.
  * @param midiNote The MIDI note number to stop playing.
  */
  noteOff;
  /**
  * Executes a MIDI Poly Pressure (Aftertouch) message on the specified channel.
  * This differs from the Channel Pressure in that it's per-note and not for the whole channel.
  * @param channel The MIDI channel to send the poly pressure on.
  * @param midiNote The MIDI note number to apply the pressure to.
  * @param pressure The pressure value, from 0 to 127.
  */
  polyPressure;
  /**
  * Executes a MIDI Channel Pressure (Aftertouch) message on the specified channel.
  * @param channel The MIDI channel to send the channel pressure on.
  * @param pressure The pressure value, from 0 to 127.
  */
  channelPressure;
  /**
  * Executes a MIDI Pitch Wheel message on the specified channel.
  * @param channel The MIDI channel to send the pitch wheel on.
  * @param pitch The new pitch value: 0-16383
  * @param midiNote The MIDI note number (optional), pass -1 for the regular pitch wheel.
  */
  pitchWheel;
  /**
  * Executes a MIDI Program Change message on the specified channel.
  * @param channel The MIDI channel to send the program change on.
  * @param programNumber The program number to change to, from 0 to 127.
  */
  programChange;
  /**
  * Processes a raw MIDI message and allows scheduling it at a specific time.
  * @param message The MIDI message to process.
  * @param channelOffset The channel offset for the message. It will be added to message's channel number if applicable.
  * @param options Additional options for scheduling the message.
  */
  processMessage;
  /**
  * Processes multiple MIDI messages and allows scheduling them at a specific time.
  * @param message The MIDI messages to process.
  * @param channelOffset The channel offset for the messages. It will be added to messages' channel number if applicable.
  * @param options Additional options for scheduling the message.
  */
  processMessages;
  /**
  * Core synthesis engine.
  */
  synthCore;
  /**
  * For applying the snapshot after an override sound bank too.
  */
  savedSnapshot;
  /**
  * Creates a new synthesizer engine.
  * @param sampleRate sample rate, in Hertz.
  * @param opts the processor's options.
  */
  constructor(sampleRate, opts = {}) {
    const options = fillWithDefaults(opts, DEFAULT_SYNTH_OPTIONS);
    this.sampleRate = sampleRate;
    if (!Number.isFinite(options.initialTime) || !Number.isFinite(sampleRate)) throw new TypeError(`Initial time or sample rate is invalid! initial time: ${options.initialTime}, sample rate: ${sampleRate}`);
    this.synthCore = new SynthesizerCore(this.callEvent.bind(this), this.missingPreset.bind(this), this.sampleRate, options);
    const c = this.synthCore;
    this.process = c.process.bind(c);
    this.processSplit = c.processSplit.bind(c);
    this.systemExclusive = c.systemExclusive.bind(c);
    this.controllerChange = c.controllerChange.bind(c);
    this.noteOn = c.noteOn.bind(c);
    this.noteOff = c.noteOff.bind(c);
    this.polyPressure = c.polyPressure.bind(c);
    this.channelPressure = c.channelPressure.bind(c);
    this.pitchWheel = c.pitchWheel.bind(c);
    this.programChange = c.programChange.bind(c);
    this.processMessage = c.processMessage.bind(c);
    this.processMessages = c.processMessages.bind(c);
    for (let i = 0; i < 16; i++) this.synthCore.createMIDIChannel(false);
    this.processorInitialized.then(() => {
      SpessaLog.info("%cSpessaSynth is ready!", ConsoleColors.recognized);
    });
  }
  /**
  * All MIDI channels of the synthesizer.
  * @readonly
  */
  get midiChannels() {
    return this.synthCore.midiChannels;
  }
  /**
  * The global MIDI parameters of the synthesizer.
  * These are only editable via MIDI messages.
  */
  get midiParameters() {
    return this.synthCore.midiParameters;
  }
  /**
  * The global system parameters of the synthesizer.
  * These are only editable via the API.
  */
  get systemParameters() {
    return this.synthCore.systemParameters;
  }
  /**
  * Current total amount of voices that are currently playing.
  */
  get voiceCount() {
    return this.synthCore.voiceCount;
  }
  /**
  * The current time of the synthesizer, in seconds. You probably should not modify this directly.
  */
  get currentTime() {
    return this.synthCore.currentTime;
  }
  /**
  * Synthesizer's reverb processor.
  */
  get reverbProcessor() {
    return this.synthCore.reverbProcessor;
  }
  /**
  * Synthesizer's chorus processor.
  */
  get chorusProcessor() {
    return this.synthCore.chorusProcessor;
  }
  /**
  * Synthesizer's delay processor.
  */
  get delayProcessor() {
    return this.synthCore.delayProcessor;
  }
  /**
  * The sound bank manager, which manages all sound banks and presets.
  */
  get soundBankManager() {
    return this.synthCore.soundBankManager;
  }
  /**
  * Handles the custom key overrides: velocity and preset
  */
  get keyModifierManager() {
    return this.synthCore.keyModifierManager;
  }
  /**
  * A handler for missing presets during program change. By default, it warns to console.
  * @param patch The MIDI patch that was requested.
  * @param system The MIDI System for the request.
  * @returns If a BasicPreset instance is returned, it will be used by the channel.
  */
  onMissingPreset = (patch, system) => {
    SpessaLog.warn(`No preset found for ${MIDIPatchTools.toMIDIString(patch)}! Did you forget to add a sound bank?`);
  };
  /**
  * Locks or unlocks a given Global MIDI Parameter.
  * This prevents any changes to it until it's unlocked.
  * @param parameter The Global MIDI Parameter to lock.
  * @param isLocked If the parameter should be locked.
  */
  lockMIDIParameter(parameter, isLocked) {
    this.synthCore.lockMIDIParameter(parameter, isLocked);
  }
  /**
  * Sets a system parameter of the synthesizer.
  * @param parameter The type of the system parameter to set.
  * @param value The value to set for the system parameter.
  */
  setSystemParameter(parameter, value) {
    this.synthCore.setSystemParameter(parameter, value);
  }
  /**
  * Executes a full synthesizer reset.
  * This will reset all controllers to their default values,
  * except for the locked controllers.
  */
  reset() {
    this.synthCore.reset();
  }
  /**
  * Applies the snapshot to this `SpessaSynthProcessor` instance.
  * @param snapshot The snapshot to apply.
  */
  applySnapshot(snapshot) {
    this.savedSnapshot = snapshot;
    applySnapshot$1.call(this.synthCore, snapshot);
  }
  /**
  * Gets a synthesizer snapshot from this processor instance.
  */
  getSnapshot() {
    return getSynthesizerSnapshot.call(this.synthCore);
  }
  /**
  * Sets the embedded sound bank.
  * @param bank The sound bank file to set.
  * @param offset The bank offset of the embedded sound bank.
  * @internal
  */
  setEmbeddedSoundBank(bank, offset) {
    const loadedFont = SoundBankLoader.fromArrayBuffer(bank);
    this.synthCore.soundBankManager.addSoundBank(loadedFont, EMBEDDED_SOUND_BANK_ID, offset);
    const order = this.synthCore.soundBankManager.priorityOrder;
    order.pop();
    order.unshift(EMBEDDED_SOUND_BANK_ID);
    this.synthCore.soundBankManager.priorityOrder = order;
    if (this.savedSnapshot !== void 0) this.applySnapshot(this.savedSnapshot);
    SpessaLog.info(`%cEmbedded sound bank set at offset %c${offset}`, ConsoleColors.recognized, ConsoleColors.value);
  }
  /**
  * Removes the embedded sound bank from the synthesizer.
  * @internal
  */
  clearEmbeddedSoundBank() {
    if (this.synthCore.soundBankManager.soundBankList.some((s) => s.id === EMBEDDED_SOUND_BANK_ID)) this.synthCore.soundBankManager.deleteSoundBank(EMBEDDED_SOUND_BANK_ID);
  }
  /**
  * Creates a new MIDI channel and adds it to the synthesizer.
  */
  createMIDIChannel() {
    this.synthCore.createMIDIChannel(true);
  }
  /**
  * Stops all notes on all channels.
  * @param force If true, all notes are stopped immediately, otherwise they are stopped gracefully.
  */
  stopAllChannels(force = false) {
    this.synthCore.stopAllChannels(force);
  }
  /**
  *  Destroy the synthesizer processor, clearing all channels and voices.
  *  This is irreversible, so use with caution.
  */
  destroySynthProcessor() {
    this.synthCore.destroySynthProcessor();
  }
  /**
  * Clears the synthesizer's voice cache.
  */
  clearCache() {
    this.synthCore.clearCache();
  }
  /**
  * Gets voices for a preset.
  * @param preset The preset to get voices for.
  * @param midiNote The MIDI note to use.
  * @param velocity The velocity to use.
  * @returns Output is an array of voices.
  * @remarks
  * This is a public method, but it is only intended to be used by the sequencer.
  * @internal
  */
  getVoicesForPreset(preset, midiNote, velocity) {
    return this.synthCore.getVoicesForPreset(preset, midiNote, velocity);
  }
  /**
  * Calls synth event
  * @param eventName the event name
  * @param eventData the event data
  */
  callEvent(eventName, eventData) {
    this.onEventCall?.({
      type: eventName,
      data: eventData
    });
  }
  missingPreset(patch, system) {
    return this.onMissingPreset(patch, system);
  }
};

// src/lib/audio/sampler.js
var GM_PROGRAMS = [
  "acoustic_grand_piano",
  "bright_acoustic_piano",
  "electric_grand_piano",
  "honky_tonk_piano",
  "electric_piano_1",
  "electric_piano_2",
  "harpsichord",
  "clavinet",
  "celesta",
  "glockenspiel",
  "music_box",
  "vibraphone",
  "marimba",
  "xylophone",
  "tubular_bells",
  "dulcimer",
  "drawbar_organ",
  "percussive_organ",
  "rock_organ",
  "church_organ",
  "reed_organ",
  "accordion",
  "harmonica",
  "tango_accordion",
  "nylon_guitar",
  "steel_guitar",
  "jazz_guitar",
  "clean_electric_guitar",
  "muted_electric_guitar",
  "overdriven_guitar",
  "distortion_guitar",
  "guitar_harmonics",
  "acoustic_bass",
  "fingered_bass",
  "picked_bass",
  "fretless_bass",
  "slap_bass_1",
  "slap_bass_2",
  "synth_bass_1",
  "synth_bass_2",
  "violin",
  "viola",
  "cello",
  "contrabass",
  "tremolo_strings",
  "pizzicato_strings",
  "orchestral_harp",
  "timpani",
  "string_ensemble_1",
  "string_ensemble_2",
  "synth_strings_1",
  "synth_strings_2",
  "choir_aahs",
  "voice_oohs",
  "synth_voice",
  "orchestra_hit",
  "trumpet",
  "trombone",
  "tuba",
  "muted_trumpet",
  "french_horn",
  "brass_section",
  "synth_brass_1",
  "synth_brass_2",
  "soprano_sax",
  "alto_sax",
  "tenor_sax",
  "baritone_sax",
  "oboe",
  "english_horn",
  "bassoon",
  "clarinet",
  "piccolo",
  "flute",
  "recorder",
  "pan_flute",
  "blown_bottle",
  "shakuhachi",
  "whistle",
  "ocarina",
  "square_lead",
  "sawtooth_lead",
  "calliope_lead",
  "chiff_lead",
  "charang_lead",
  "voice_lead",
  "fifths_lead",
  "bass_and_lead",
  "new_age_pad",
  "warm_pad",
  "polysynth_pad",
  "choir_pad",
  "bowed_pad",
  "metallic_pad",
  "halo_pad",
  "sweep_pad",
  "rain_fx",
  "soundtrack_fx",
  "crystal_fx",
  "atmosphere_fx",
  "brightness_fx",
  "goblins_fx",
  "echoes_fx",
  "sci_fi_fx",
  "sitar",
  "banjo",
  "shamisen",
  "koto",
  "kalimba",
  "bagpipe",
  "fiddle",
  "shanai",
  "tinkle_bell",
  "agogo",
  "steel_drums",
  "woodblock",
  "taiko_drum",
  "melodic_tom",
  "synth_drum",
  "reverse_cymbal",
  "guitar_fret_noise",
  "breath_noise",
  "seashore",
  "bird_tweet",
  "telephone_ring",
  "helicopter",
  "applause",
  "gunshot"
];
var GM_KITS = { drum_kit: 0, standard_kit: 0, room_kit: 8, power_kit: 16, electronic_kit: 24, tr808_kit: 25, jazz_kit: 32, brush_kit: 40, orchestra_kit: 48 };
var GM_DRUM_KEYS = {
  kick: 36,
  kick2: 35,
  rim: 37,
  snare: 38,
  clap: 39,
  snare2: 40,
  tom_low: 45,
  tom: 47,
  tom_mid: 47,
  tom_high: 50,
  hat: 42,
  pedal_hat: 44,
  openhat: 46,
  crash: 49,
  impact: 49,
  ride: 51,
  ride_bell: 53,
  china: 52,
  splash: 55,
  tambourine: 54,
  cowbell: 56,
  vibraslap: 58,
  bongo_high: 60,
  bongo_low: 61,
  conga_high: 62,
  conga_low: 64,
  timbale: 65,
  agogo: 67,
  cabasa: 69,
  shaker: 70,
  maracas: 70,
  whistle: 72,
  guiro: 74,
  claves: 75,
  woodblock: 76,
  triangle: 81,
  triangle_open: 81,
  triangle_mute: 80,
  shaker_long: 82,
  jingle_bell: 83,
  chimes: 84,
  castanets: 85
};
var ALIASES = {
  piano: "acoustic_grand_piano",
  grand_piano: "acoustic_grand_piano",
  acoustic_piano: "acoustic_grand_piano",
  bright_piano: "bright_acoustic_piano",
  honky_tonk: "honky_tonk_piano",
  rhodes: "electric_piano_1",
  electric_piano: "electric_piano_1",
  epiano: "electric_piano_1",
  dx_piano: "electric_piano_2",
  organ: "drawbar_organ",
  guitar: "nylon_guitar",
  classical_guitar: "nylon_guitar",
  acoustic_guitar: "steel_guitar",
  electric_guitar: "clean_electric_guitar",
  double_bass: "contrabass",
  upright_bass: "acoustic_bass",
  electric_bass: "fingered_bass",
  harp: "orchestral_harp",
  pizzicato: "pizzicato_strings",
  string_ensemble: "string_ensemble_1",
  strings_section: "string_ensemble_1",
  slow_strings: "string_ensemble_2",
  horn: "french_horn",
  sax: "alto_sax",
  choir_real: "choir_aahs",
  aahs: "choir_aahs",
  oohs: "voice_oohs",
  bells: "tubular_bells",
  chimes: "tubular_bells",
  steelpan: "steel_drums",
  // Russian
  "\u0444\u043E\u0440\u0442\u0435\u043F\u0438\u0430\u043D\u043E": "acoustic_grand_piano",
  "\u043F\u0438\u0430\u043D\u0438\u043D\u043E": "acoustic_grand_piano",
  "\u0440\u043E\u044F\u043B\u044C": "acoustic_grand_piano",
  "\u044D\u043B\u0435\u043A\u0442\u0440\u043E\u043F\u0438\u0430\u043D\u043E": "electric_piano_1",
  "\u0447\u0435\u043B\u0435\u0441\u0442\u0430": "celesta",
  "\u0448\u043A\u0430\u0442\u0443\u043B\u043A\u0430": "music_box",
  "\u043C\u0443\u0437\u044B\u043A\u0430\u043B\u044C\u043D\u0430\u044F_\u0448\u043A\u0430\u0442\u0443\u043B\u043A\u0430": "music_box",
  "\u0432\u0438\u0431\u0440\u0430\u0444\u043E\u043D": "vibraphone",
  "\u043C\u0430\u0440\u0438\u043C\u0431\u0430": "marimba",
  "\u043A\u0441\u0438\u043B\u043E\u0444\u043E\u043D": "xylophone",
  "\u043A\u043E\u043B\u043E\u043A\u043E\u043B\u0430": "tubular_bells",
  "\u043A\u043E\u043B\u043E\u043A\u043E\u043B\u044C\u0447\u0438\u043A\u0438": "glockenspiel",
  "\u043E\u0440\u0433\u0430\u043D": "church_organ",
  "\u0430\u043A\u043A\u043E\u0440\u0434\u0435\u043E\u043D": "accordion",
  "\u0433\u0443\u0431\u043D\u0430\u044F_\u0433\u0430\u0440\u043C\u043E\u0448\u043A\u0430": "harmonica",
  "\u0433\u0438\u0442\u0430\u0440\u0430": "nylon_guitar",
  "\u0430\u043A\u0443\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F_\u0433\u0438\u0442\u0430\u0440\u0430": "steel_guitar",
  "\u044D\u043B\u0435\u043A\u0442\u0440\u043E\u0433\u0438\u0442\u0430\u0440\u0430": "clean_electric_guitar",
  "\u0431\u0430\u0441": "fingered_bass",
  "\u043A\u043E\u043D\u0442\u0440\u0430\u0431\u0430\u0441": "contrabass",
  "\u0441\u043A\u0440\u0438\u043F\u043A\u0430": "violin",
  "\u0430\u043B\u044C\u0442": "viola",
  "\u0432\u0438\u043E\u043B\u043E\u043D\u0447\u0435\u043B\u044C": "cello",
  "\u0441\u0442\u0440\u0443\u043D\u043D\u044B\u0435": "string_ensemble_1",
  "\u043F\u0438\u0446\u0446\u0438\u043A\u0430\u0442\u043E": "pizzicato_strings",
  "\u0430\u0440\u0444\u0430": "orchestral_harp",
  "\u043B\u0438\u0442\u0430\u0432\u0440\u044B": "timpani",
  "\u0445\u043E\u0440": "choir_aahs",
  "\u0442\u0440\u0443\u0431\u0430": "trumpet",
  "\u0442\u0440\u043E\u043C\u0431\u043E\u043D": "trombone",
  "\u0442\u0443\u0431\u0430": "tuba",
  "\u0432\u0430\u043B\u0442\u043E\u0440\u043D\u0430": "french_horn",
  "\u043C\u0435\u0434\u044C": "brass_section",
  "\u0441\u0430\u043A\u0441\u043E\u0444\u043E\u043D": "alto_sax",
  "\u0433\u043E\u0431\u043E\u0439": "oboe",
  "\u0444\u0430\u0433\u043E\u0442": "bassoon",
  "\u043A\u043B\u0430\u0440\u043D\u0435\u0442": "clarinet",
  "\u0444\u043B\u0435\u0439\u0442\u0430": "flute",
  "\u043F\u0438\u043A\u043A\u043E\u043B\u043E": "piccolo",
  "\u0431\u043B\u043E\u043A\u0444\u043B\u0435\u0439\u0442\u0430": "recorder",
  "\u043F\u0430\u043D_\u0444\u043B\u0435\u0439\u0442\u0430": "pan_flute",
  "\u043E\u043A\u0430\u0440\u0438\u043D\u0430": "ocarina",
  "\u0441\u0438\u0442\u0430\u0440": "sitar",
  "\u0431\u0430\u043D\u0434\u0436\u043E": "banjo",
  "\u043A\u043E\u0442\u043E": "koto",
  "\u043A\u0430\u043B\u0438\u043C\u0431\u0430": "kalimba",
  "\u0432\u043E\u043B\u044B\u043D\u043A\u0430": "bagpipe",
  "\u0441\u0442\u0438\u043B\u0434\u0440\u0430\u043C": "steel_drums",
  "\u0442\u0430\u0439\u043A\u043E": "taiko_drum",
  "\u0443\u0434\u0430\u0440\u043D\u044B\u0435": "drum_kit",
  "\u0431\u0430\u0440\u0430\u0431\u0430\u043D\u044B": "drum_kit"
};
function resolveSampled(name) {
  if (typeof name !== "string") return null;
  const raw = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw.startsWith("synth:")) return null;
  const key = raw.startsWith("gm:") ? raw.slice(3) : raw;
  if (/^\d+$/.test(key) && Number(key) < 128) return { kind: "melodic", program: Number(key), name: GM_PROGRAMS[Number(key)] };
  const n = ALIASES[key] || key;
  if (n in GM_KITS) return { kind: "kit", program: GM_KITS[n], name: n };
  const program = GM_PROGRAMS.indexOf(n);
  return program >= 0 ? { kind: "melodic", program, name: n } : null;
}
function instrumentCatalogue() {
  const families = ["piano", "chromatic_percussion", "organ", "guitar", "bass", "strings", "ensemble", "brass", "reed", "pipe", "synth_lead", "synth_pad", "synth_effects", "ethnic", "percussive", "sound_effects"];
  return {
    melodic: families.map((family, f) => ({ family, instruments: GM_PROGRAMS.slice(f * 8, f * 8 + 8) })),
    drum_kits: Object.keys(GM_KITS),
    drum_names: Object.keys(GM_DRUM_KEYS),
    aliases: ALIASES
  };
}
var bankCache = /* @__PURE__ */ new Map();
function loadBank(file) {
  if (!fs2.existsSync(file)) {
    throw new StudioError("E_SOUNDFONT", `No sound bank at ${file}. Real instruments need a General MIDI SoundFont: run audio_soundfont_install (downloads ${DEFAULT_SOUNDFONT.name}, ${(DEFAULT_SOUNDFONT.bytes / 1048576).toFixed(0)} MB, once per computer) or set "soundfont" in the score / MINECRAFT_STUDIO_SOUNDFONT to your own .sf2/.sf3.`);
  }
  const key = `${file}:${fs2.statSync(file).mtimeMs}`;
  if (!bankCache.has(key)) {
    const buf = fs2.readFileSync(file);
    bankCache.set(key, SoundBankLoader.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return bankCache.get(key);
}
var BLOCK = 64;
var SAMPLED_MAKEUP_DB = 12;
function renderSampledStem(patch, notes, { length, sampleRate, soundfont, transpose = 0, pedal = false }) {
  const bank = loadBank(soundfont);
  const synth = new SpessaSynthProcessor(sampleRate, { effectsEnabled: false, eventsEnabled: false });
  synth.soundBankManager.addSoundBank(bank, "studio");
  const ch = patch.kind === "kit" ? 9 : 0;
  synth.programChange(ch, patch.program);
  synth.controllerChange(ch, 7, 127);
  synth.controllerChange(ch, 11, 127);
  synth.controllerChange(ch, 91, 0);
  synth.controllerChange(ch, 93, 0);
  const whole = Math.trunc(transpose);
  const frac = transpose - whole;
  if (frac) synth.pitchWheel(ch, Math.max(0, Math.min(16383, Math.round(8192 + frac / 2 * 8192))));
  if (pedal) synth.controllerChange(ch, 64, 127);
  const events = [];
  for (const n of notes) {
    const key = patch.kind === "kit" ? n.key : n.midi + whole;
    if (key < 0 || key > 127) continue;
    const at = Math.max(0, Math.round(n.start_s * sampleRate));
    events.push({ at, on: true, key, vel: Math.max(1, Math.min(127, Math.round(n.vel * 127))) });
    if (patch.kind !== "kit") events.push({ at: Math.max(at + 1, Math.round((n.start_s + n.dur_s) * sampleRate)), on: false, key });
  }
  events.sort((a, b) => a.at - b.at || (a.on === b.on ? 0 : a.on ? 1 : -1));
  const left = new Float32Array(length), right = new Float32Array(length);
  let e = 0;
  for (let s = 0; s < length; s += BLOCK) {
    const end = Math.min(length, s + BLOCK);
    while (e < events.length && events[e].at < end) {
      const ev = events[e++];
      if (ev.on) synth.noteOn(ch, ev.key, ev.vel);
      else synth.noteOff(ch, ev.key);
    }
    synth.process(left, right, s, end - s);
  }
  const makeup = 10 ** (SAMPLED_MAKEUP_DB / 20);
  for (let i = 0; i < length; i++) {
    left[i] *= makeup;
    right[i] *= makeup;
  }
  return { left, right };
}

// src/lib/audio/music.js
var INSTRUMENTS = ["pad", "strings", "bass", "pluck", "bell", "choir", "lead", "drone", "brass", "drums", "pulse", "sub"];
var synthName = (name) => typeof name === "string" && name.startsWith("synth:") ? name.slice(6) : name;
function stemEngine(stem) {
  const patch = resolveSampled(stem.instrument);
  if (patch && !INSTRUMENTS.includes(stem.instrument)) return { engine: "sampled", patch };
  const s = synthName(stem.instrument);
  return INSTRUMENTS.includes(s) ? { engine: "synth", instrument: s } : null;
}
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
      const bands = vowel.map((f, k2) => {
        const b = new Biquad("bandpass", sr);
        b.set(f, k2 === 0 ? 6 : 9);
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
    const k2 = i + offset;
    if (k2 >= 0 && k2 < dst.length) dst[k2] += src[i] * gain;
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
    const eng = stemEngine(st);
    if (!eng) problems.push(`stem ${st.name}: unknown instrument ${st.instrument} (use a General MIDI name like acoustic_grand_piano, cello, flute, drum_kit \u2014 see audio_instruments \u2014 or a synth voice: ${INSTRUMENTS.join(", ")})`);
    if (eng?.engine === "sampled" && eng.patch.kind === "kit") {
      for (const part of Object.values(st.parts || {})) {
        if (typeof part !== "object") {
          problems.push(`stem ${st.name}: drum kit parts are objects of step patterns`);
          continue;
        }
        for (const d of Object.keys(part.pattern || part)) if (!(d in GM_DRUM_KEYS) && !/^\d+$/.test(d)) problems.push(`stem ${st.name}: unknown drum ${d} (use ${Object.keys(GM_DRUM_KEYS).join(", ")} or a GM key number)`);
      }
    }
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
var partText = (part) => typeof part === "string" ? part : part.notes;
var partVel = (part) => typeof part === "object" && part.velocity != null ? part.velocity : 1;
var partShift = (part) => typeof part === "object" && part.transpose ? part.transpose : 0;
function partNotes(stem, part, sectionBeats, beatSec, offsetS = 0) {
  const { events, beats } = parseSequence(partText(part));
  const repeat = stem.repeat !== false && beats > 0 && beats < sectionBeats;
  const vel = (stem.velocity ?? 1) * partVel(part);
  const shift = partShift(part);
  const notes = [];
  for (let rep = 0; rep * beats < sectionBeats && (rep === 0 || repeat); rep++) {
    for (const ev of events) {
      const b = ev.beat + rep * beats;
      if (b >= sectionBeats) continue;
      notes.push({ beat: b, start_s: offsetS + b * beatSec, dur_s: Math.min(ev.beats, sectionBeats - b) * beatSec * (stem.legato ?? 0.98), midi: ev.midi + shift, vel: Math.min(1, ev.vel * vel), rep });
    }
  }
  return notes;
}
function patternHits(part, sectionBeats, beatSec, offsetS = 0) {
  const steps = 4;
  const pats = part.pattern || part;
  const pv = part.pattern ? part.velocity ?? 1 : 1;
  const hits = [];
  for (const [drum, pattern] of Object.entries(pats)) {
    const p = pattern.replace(/\s|\|/g, "");
    const total = Math.round(sectionBeats * steps);
    for (let k2 = 0; k2 < total; k2++) {
      const ch = p[k2 % p.length];
      if (ch === "." || ch === "-") continue;
      hits.push({ drum, k: k2, start_s: offsetS + k2 / steps * beatSec, vel: (ch === "X" ? 1 : ch === "o" ? 0.45 : 0.75) * pv });
    }
  }
  return hits;
}
function renderStem(stem, si, placements, tm, { length, sampleRate, soundfont }) {
  const g = dbToGain(stem.gain ?? -10);
  const pan = stem.pan || 0;
  const gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  const used = placements.filter((p) => stem.parts?.[p.sec.name]);
  if (!used.length) return null;
  const eng = stemEngine(stem);
  const L2 = new Float32Array(length), R = new Float32Array(length);
  if (eng?.engine === "sampled") {
    const notes = [];
    for (const { sec, offset_s } of used) {
      const part = stem.parts[sec.name];
      const sectionBeats = sec.bars * tm.barBeats;
      if (eng.patch.kind === "kit") {
        for (const h2 of patternHits(part, sectionBeats, tm.beatSec, offset_s)) notes.push({ start_s: h2.start_s, key: GM_DRUM_KEYS[h2.drum] ?? Number(h2.drum), vel: Math.min(1, h2.vel * (stem.velocity ?? 1)) });
      } else notes.push(...partNotes(stem, part, sectionBeats, tm.beatSec, offset_s));
    }
    const { left, right } = renderSampledStem(eng.patch, notes, { length, sampleRate, soundfont, transpose: stem.transpose || 0, pedal: !!stem.pedal });
    const l = applyEffects(left, sampleRate, stem.effects || []);
    const r = applyEffects(right, sampleRate, stem.effects || []);
    for (let i = 0; i < length && i < l.length; i++) {
      L2[i] = l[i] * g * gl;
      R[i] = r[i] * g * gr;
    }
    return { L: L2, R };
  }
  const mono = new Float32Array(length);
  for (const { sec, offset_s } of used) {
    const part = stem.parts[sec.name];
    const sectionBeats = sec.bars * tm.barBeats;
    const off = Math.round(offset_s * sampleRate);
    if (synthName(stem.instrument) === "drums") {
      for (const h2 of patternHits(part, sectionBeats, tm.beatSec)) addAt(mono, renderDrum(h2.drum, sampleRate, h2.vel, si * 977 + h2.k), off + Math.round(h2.start_s * sampleRate), 1);
    } else {
      for (const n of partNotes(stem, part, sectionBeats, tm.beatSec)) {
        const note = renderNote(synthName(stem.instrument), midiToFreq(n.midi + (stem.transpose || 0)), n.dur_s, n.vel, sampleRate, { vowel: stem.vowel }, n.midi * 31 + n.rep);
        addAt(mono, note, off + Math.round(n.start_s * sampleRate), 1);
      }
    }
  }
  const processed = applyEffects(mono, sampleRate, stem.effects || []);
  for (let i = 0; i < length && i < processed.length; i++) {
    L2[i] = processed[i] * g * gl;
    R[i] = processed[i] * g * gr;
  }
  return { L: L2, R };
}
function renderSection(score, sectionName, { stems = null, sampleRate = 48e3, soundfont = null } = {}) {
  const tm = timing(score);
  const sec = tm.sections.find((s) => s.name === sectionName);
  if (!sec) throw new StudioError("E_SCORE", `Unknown section ${sectionName}`);
  const tail = 3;
  const len = Math.round(sec.duration_s * sampleRate);
  const buf = makeAudio(sampleRate, sec.duration_s + tail, 2);
  const length = buf.channels[0].length;
  score.stems.filter((s) => !stems || stems.includes(s.name)).forEach((stem, si) => {
    const out = renderStem(stem, si, [{ sec, offset_s: 0 }], tm, { length, sampleRate, soundfont });
    if (!out) return;
    for (let i = 0; i < length; i++) {
      buf.channels[0][i] += out.L[i];
      buf.channels[1][i] += out.R[i];
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
function renderArrangement(score, { sampleRate = 48e3, soundfont = null, loopRepeats = 1 } = {}) {
  const tm = timing(score);
  const placements = [];
  let t = 0;
  for (const sec of tm.sections) {
    const n = sec.loop ? Math.max(1, loopRepeats) : 1;
    for (let k2 = 0; k2 < n; k2++) {
      placements.push({ sec, offset_s: t });
      t += sec.duration_s;
    }
  }
  const buf = makeAudio(sampleRate, t + 6, 2);
  const length = buf.channels[0].length;
  score.stems.forEach((stem, si) => {
    const out = renderStem(stem, si, placements, tm, { length, sampleRate, soundfont });
    if (!out) return;
    for (let i = 0; i < length; i++) {
      buf.channels[0][i] += out.L[i];
      buf.channels[1][i] += out.R[i];
    }
  });
  const f = Math.round(1.5 * sampleRate);
  for (const ch of buf.channels) for (let i = 0; i < f; i++) ch[ch.length - 1 - i] *= i / f;
  return { audio: buf, duration_s: t, placements: placements.map((p) => ({ section: p.sec.name, start_s: Number(p.offset_s.toFixed(4)) })) };
}
function renderScore(score, { sampleRate = 48e3, lufs = -20, soundfont = null, fullMix = null, loopRepeats = null } = {}) {
  const problems = validateScore(score);
  if (problems.length) throw new StudioError("E_SCORE", `Invalid score: ${problems.join("; ")}`);
  const tm = timing(score);
  const outputs = [];
  for (const sec of tm.sections) {
    const { audio } = renderSection(score, sec.name, { sampleRate, soundfont });
    outputs.push({ kind: "section", section: sec.name, audio });
  }
  const loopSec = tm.sections.find((s) => s.loop);
  const wantFull = fullMix ?? score.full_mix ?? !loopSec;
  let arrangement = null;
  if (wantFull) {
    arrangement = renderArrangement(score, { sampleRate, soundfont, loopRepeats: loopRepeats ?? score.loop_repeats ?? 1 });
    outputs.push({ kind: "full", section: "full", audio: arrangement.audio });
  }
  if (!loopSec && arrangement && score.stems.length > 1) {
    const tmp = { ...score };
    for (const stem of score.stems) {
      const single = renderArrangement({ ...tmp, stems: [stem] }, { sampleRate, soundfont, loopRepeats: 1 });
      outputs.push({ kind: "stem", section: "full", stem: stem.name, audio: single.audio });
    }
  }
  if (loopSec && score.stems.length > 1) {
    for (const stem of score.stems) {
      if (!stem.parts?.[loopSec.name]) continue;
      const { audio } = renderSection(score, loopSec.name, { stems: [stem.name], sampleRate, soundfont });
      outputs.push({ kind: "stem", section: loopSec.name, stem: stem.name, audio });
    }
  }
  const on = score.normalize_on || (arrangement && !loopSec ? "full" : loopSec?.name || tm.sections[0].name);
  const ref = on === "full" && outputs.find((o) => o.kind === "full") || outputs.find((o) => o.kind === "section" && o.section === (on === "loop" ? loopSec?.name : on)) || outputs.find((o) => o.kind === "section");
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
    loop: loopSec ? { section: loopSec.name, bars: loopSec.bars, duration_s: loopSec.duration_s, samples: Math.round(loopSec.duration_s * sampleRate), ticks: Math.round(loopSec.duration_s * 20), ticks_exact: Number((loopSec.duration_s * 20).toFixed(4)) } : null,
    transition_points_s: loopSec ? Array.from({ length: Math.floor(loopSec.bars / every) + 1 }, (_, k2) => Number((k2 * every * tm.barSec).toFixed(4))) : [],
    transition_every_bars: every,
    ...arrangement ? { full_mix: { duration_s: Number(arrangement.duration_s.toFixed(4)), sections: arrangement.placements } } : {},
    normalized_on: on,
    stems: score.stems.map((s) => {
      const eng = stemEngine(s);
      return { name: s.name, instrument: s.instrument, engine: eng?.engine, ...eng?.engine === "sampled" ? { gm: eng.patch.name, gm_program: eng.patch.program, kit: eng.patch.kind === "kit" } : {}, gain: s.gain ?? -10 };
    })
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
      fs3.rmSync(tmp, { force: true });
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
  fs3.rmSync(wav, { force: true });
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
  description: `Render a score (bpm, meter, key, sections intro/loop/outro/stinger, stems) into section mixes, per-stem loops and metadata (BPM, bars, loop boundaries, transition points). Writes music/source, music/stems, music/rendered, music/metadata under out_dir; optional Ogg export into the pack. Stem instruments: real sampled instruments by General MIDI name (acoustic_grand_piano, electric_piano_1, celesta, music_box, vibraphone, marimba, nylon_guitar, violin, cello, string_ensemble_1, pizzicato_strings, orchestral_harp, choir_aahs, flute, clarinet, french_horn, kalimba, ... full list: audio_instruments; aliases like piano/rhodes/guitar; drum kits drum_kit/jazz_kit/brush_kit/orchestra_kit with step patterns) or synth voices ${INSTRUMENTS.join(", ")} (synth:<name>). Sampled stems support pan, transpose (fractional = detune), legato, pedal (sustain) and effects. Real instruments need the sound bank (audio_soundfont_install, once per computer).`,
  input: {
    score: external_exports.record(external_exports.string(), external_exports.any()).optional(),
    score_path: external_exports.string().optional(),
    out_dir: external_exports.string().describe("Project-relative directory, e.g. audio/music"),
    ogg_dir: external_exports.string().optional().describe("Resource-pack sounds directory for Ogg exports, e.g. resourcepack/assets/ns/sounds/music"),
    lufs: external_exports.number().optional(),
    asset: assetInput,
    full_mix: external_exports.boolean().optional().describe("Also render the whole arrangement as one continuous track <title>_full (default: true for songs without a loop section). Tails ring across section borders."),
    loop_repeats: external_exports.number().int().min(1).max(8).optional().describe("How many times the loop section plays inside the full mix (default 1)."),
    ogg_stems: external_exports.boolean().optional().describe("Also export per-stem loops as Ogg into ogg_dir (default true). Set false when the game will not layer stems, to keep the pack small.")
  }
}, async (a, { studio }) => {
  requireOneOf(a, ["score", "score_path"]);
  const score = a.score || readJson(studio.abs(a.score_path));
  const problems = validateScore(score);
  if (problems.length) throw new StudioError("E_SCORE", problems.join("; "));
  const title = slugify(score.title || "cue");
  const sampled = score.stems.some((s) => stemEngine(s)?.engine === "sampled");
  const sf = sampled ? resolveSoundfont({ scorePath: score.soundfont, configPath: studio.isInitialized() ? studio.config().audio?.soundfont : null, root: studio.root }) : null;
  const { outputs, metadata } = renderScore(score, { lufs: a.lufs ?? -20, soundfont: sf?.path, fullMix: a.full_mix ?? null, loopRepeats: a.loop_repeats ?? null });
  if (sf) metadata.soundfont = { file: path.basename(sf.path), source: sf.source, ...sf.source === "default" ? { name: DEFAULT_SOUNDFONT.name, sha256: DEFAULT_SOUNDFONT.sha256 } : {} };
  const base = a.out_dir.replace(/\/$/, "");
  const sourceFile = `${base}/source/${title}.score.json`;
  writeJson(studio.abs(sourceFile), score);
  const files = [{ path: sourceFile, role: "source" }];
  metadata.files = { source: sourceFile, sections: {}, stems: {}, ogg: {} };
  const stemSuffix = (o) => o.section === "full" ? "full" : o.section;
  for (const o of outputs) {
    const name = o.kind === "section" ? `${title}_${o.section}` : o.kind === "full" ? `${title}_full` : `${title}_${stemSuffix(o)}_${slugify(o.stem)}`;
    const wav = o.kind === "stem" ? `${base}/stems/${name}.${masterExt(studio)}` : `${base}/rendered/${name}.${masterExt(studio)}`;
    writeMaster(studio.abs(wav), o.audio);
    files.push({ path: wav, role: o.kind });
    if (o.kind === "section") metadata.files.sections[o.section] = wav;
    else if (o.kind === "full") metadata.files.full = wav;
    else metadata.files.stems[o.stem] = wav;
    if (a.ogg_dir && (o.kind !== "stem" || a.ogg_stems !== false)) {
      const ogg = `${a.ogg_dir.replace(/\/$/, "")}/${name}.ogg`;
      encodeOgg(o.audio, studio.abs(ogg));
      files.push({ path: ogg, role: "minecraft" });
      metadata.files.ogg[name] = ogg;
    }
  }
  const metaFile = `${base}/metadata/${title}.json`;
  writeJson(studio.abs(metaFile), metadata);
  files.push({ path: metaFile, role: "metadata" });
  const loopWav = metadata.loop ? metadata.files.sections[metadata.loop.section] : metadata.files.full || metadata.files.sections[score.sections[0].name];
  const loopAudit = auditAudioFile(studio.abs(loopWav), { role: "music", loop: !!metadata.loop, positional: false, targetLufs: a.lufs ?? -20 });
  const reg = registerOutput(studio, a.asset, { type: "music", files, source: { provider: sampled ? "local-composer+soundfont" : "local-composer", format: "minecraft-studio-score/1", source_files: [sourceFile], ...metadata.soundfont ? { soundfont: metadata.soundfont } : {} }, metadata: { bpm: metadata.bpm, key: metadata.key, meter: metadata.meter, state: metadata.state, loop: metadata.loop, transition_points_s: metadata.transition_points_s, stems: metadata.stems, sections: metadata.sections, waveform: loopAudit.waveform, metadata_file: metaFile } });
  return { metadata_file: metaFile, files: files.map((f) => f.path), ...metadata.full_mix ? { full_mix: { file: metadata.files.full, ...metadata.full_mix } } : {}, loop: metadata.loop, transition_points_s: metadata.transition_points_s, loop_audit: { verdict: loopAudit.verdict, checks: loopAudit.checks }, asset: reg };
});
tool(server, "audio_instruments", {
  title: "List music instruments",
  capability: "read",
  description: "Real sampled instruments (128 General MIDI programs by family, drum kits, drum names, aliases incl. Russian) and synth voices usable in audio_music_render scores, plus whether the sound bank is installed."
}, async (_a, { studio }) => {
  const sf = resolveSoundfont({ configPath: studio.isInitialized() ? studio.config().audio?.soundfont : null, root: studio.root });
  return {
    soundfont: { path: sf.path, source: sf.source, installed: sf.exists, ...sf.source === "default" ? { name: DEFAULT_SOUNDFONT.name, size_mb: Math.round(DEFAULT_SOUNDFONT.bytes / 1048576), install_with: "audio_soundfont_install" } : {} },
    sampled: instrumentCatalogue(),
    synth_voices: INSTRUMENTS.map((n) => `synth:${n}`),
    usage: 'stem.instrument = General MIDI name or alias; drum kits take step-pattern objects {kick: "x...", snare: "....x...", hat: "x.x.x.x."}'
  };
});
tool(server, "audio_soundfont_install", {
  title: "Install the instrument sound bank",
  capability: "publish",
  description: `Download the default General MIDI sound bank (${DEFAULT_SOUNDFONT.name}, ${Math.round(DEFAULT_SOUNDFONT.bytes / 1048576)} MB, free for commercial music) once per computer into the user cache, verifying its sha256. Needed for real instruments in audio_music_render. Tell the user about the download before calling.`,
  input: { force: external_exports.boolean().optional() }
}, async (a) => installDefaultSoundfont({ force: !!a.force }));
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
  fs3.rmSync(wav, { force: true });
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
    fs3.rmSync(tmp, { force: true });
  }
  audio.channels = audio.channels.map((c) => applyEffects(c, audio.sampleRate, chain));
  normalizeAudio(audio, { lufs: profile.loudness_lufs ?? -18 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  if (masterExt(studio) === "flac") {
    const rawFlac = raw.replace(/\.wav$/, ".flac");
    convertFile(raw, rawFlac);
    fs3.rmSync(raw, { force: true });
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
