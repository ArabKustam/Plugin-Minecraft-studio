// Pure-JS DSP building blocks: oscillators, envelopes, biquad filters, reverb,
// dynamics. Used by the local SFX synthesizer and music renderer so that the
// studio can create and process audio without any paid service.
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** "C#4" | "Eb3" | 60 → MIDI number */
export function noteToMidi(n) {
  if (typeof n === 'number') return n;
  const m = String(n).trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/);
  if (!m) throw new Error(`Invalid note ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Parameter that can be constant, a sweep {from,to,curve} or an LFO {center,depth,rate,shape}. */
export function paramFn(p, dur) {
  if (typeof p === 'number') return () => p;
  if (p && typeof p === 'object' && 'from' in p) {
    const { from, to, curve = 'linear', start = 0, end = dur } = p;
    return (t) => {
      const u = Math.max(0, Math.min(1, (t - start) / Math.max(1e-6, end - start)));
      return curve === 'exp' && from > 0 && to > 0 ? from * (to / from) ** u : curve === 'ease' ? from + (to - from) * (u * u * (3 - 2 * u)) : from + (to - from) * u;
    };
  }
  if (p && typeof p === 'object' && 'center' in p) {
    const { center, depth = 0, rate = 1, shape = 'sine' } = p;
    return (t) => center + depth * (shape === 'triangle' ? 1 - 4 * Math.abs(((t * rate) % 1) - 0.5) : shape === 'square' ? (Math.sin(2 * Math.PI * rate * t) >= 0 ? 1 : -1) : Math.sin(2 * Math.PI * rate * t));
  }
  throw new Error(`Invalid parameter ${JSON.stringify(p)}`);
}

export function envelopeFn({ attack = 0.005, decay = 0.05, sustain = 1, release = 0.05, curve = 'exp' } = {}, dur) {
  return (t) => {
    let v;
    if (t < attack) v = t / Math.max(attack, 1e-6);
    else if (t < attack + decay) v = 1 - (1 - sustain) * ((t - attack) / Math.max(decay, 1e-6));
    else v = sustain;
    const relStart = dur - release;
    if (t > relStart) v *= Math.max(0, 1 - (t - relStart) / Math.max(release, 1e-6));
    return curve === 'exp' ? v * v : v;
  };
}

export function oscillator(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p);
    case 'square': return p < 0.5 ? 1 : -1;
    case 'saw': return 2 * p - 1;
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5);
    case 'pulse25': return p < 0.25 ? 1 : -1;
    default: throw new Error(`Unknown waveform ${wave}`);
  }
}

export function rng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

export function noiseGen(color = 'white', seed = 1) {
  const r = rng(seed);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  return () => {
    const w = r();
    if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.25; }
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; return last * 3.5; }
    return w;
  };
}

/** RBJ biquad with per-call coefficient updates (for sweeps). */
export class Biquad {
  constructor(type, sr) { this.type = type; this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(1000, 0.707, 0); }
  set(freq, q = 0.707, gainDb = 0) {
    const f = Math.max(10, Math.min(this.sr * 0.49, freq));
    const w0 = (2 * Math.PI * f) / this.sr, cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * q), A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'lowpass': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'peak': b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cos + s); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - s); a0 = (A + 1) + (A - 1) * cos + s; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cos + s); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - s); a0 = (A + 1) - (A - 1) * cos + s; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - s; break; }
      default: throw new Error(`Unknown filter ${this.type}`);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export function filterBuffer(buf, sr, { type, freq, q = 0.707, gain = 0 }) {
  const f = new Biquad(type, sr);
  const fn = paramFn(freq, buf.length / sr);
  const dynamic = typeof freq !== 'number';
  f.set(fn(0), q, gain);
  for (let i = 0; i < buf.length; i++) {
    if (dynamic && i % 32 === 0) f.set(fn(i / sr), q, gain);
    buf[i] = f.process(buf[i]);
  }
  return buf;
}

/** Freeverb-style reverb (mono in → mono out). room 0..1, damp 0..1, mix 0..1 */
export function reverb(buf, sr, { room = 0.5, damp = 0.4, mix = 0.25, predelay = 0.01 } = {}) {
  const scale = sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ b: new Float32Array(Math.round(n * scale)), i: 0, f: 0 }));
  const aps = [556, 441, 341, 225].map((n) => ({ b: new Float32Array(Math.round(n * scale)), i: 0 }));
  const fb = 0.7 + 0.28 * room;
  const pd = new Float32Array(Math.max(1, Math.round(predelay * sr)));
  let pdi = 0;
  const out = new Float32Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    const inp = pd[pdi]; pd[pdi] = buf[n]; pdi = (pdi + 1) % pd.length;
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

export function compress(buf, sr, { threshold = -18, ratio = 4, attack = 0.005, release = 0.12, makeup = 0 } = {}) {
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

/** Look-ahead brickwall limiter. */
export function limit(buf, sr, { ceiling = -1, release = 0.05, lookahead = 0.003 } = {}) {
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

export function distort(buf, { amount = 0.3, mode = 'tanh' } = {}) {
  const k = 1 + amount * 20;
  const norm = Math.tanh(k);
  for (let i = 0; i < buf.length; i++) buf[i] = mode === 'hard' ? Math.max(-1, Math.min(1, buf[i] * k)) : Math.tanh(buf[i] * k) / norm;
  return buf;
}

export function bitcrush(buf, sr, { bits = 8, downsample = 4 } = {}) {
  const levels = 2 ** bits;
  let hold = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i % downsample === 0) hold = Math.round(buf[i] * levels) / levels;
    buf[i] = hold;
  }
  return buf;
}

export function tremolo(buf, sr, { rate = 6, depth = 0.5 } = {}) {
  for (let i = 0; i < buf.length; i++) buf[i] *= 1 - depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * rate * i) / sr));
  return buf;
}

export function fade(buf, sr, { fadeIn = 0, fadeOut = 0 } = {}) {
  const fi = Math.round(fadeIn * sr), fo = Math.round(fadeOut * sr);
  for (let i = 0; i < fi && i < buf.length; i++) buf[i] *= i / fi;
  for (let i = 0; i < fo && i < buf.length; i++) buf[buf.length - 1 - i] *= i / fo;
  return buf;
}

/** Make a buffer loop seamlessly: crossfade the tail into the head and trim. */
export function makeLoopable(buf, sr, { crossfade = 0.25 } = {}) {
  const n = Math.min(Math.round(crossfade * sr), Math.floor(buf.length / 3));
  const out = buf.slice(0, buf.length - n);
  for (let i = 0; i < n; i++) {
    const a = i / n; // equal-power crossfade
    out[i] = buf[i] * Math.sin((a * Math.PI) / 2) + buf[buf.length - n + i] * Math.cos((a * Math.PI) / 2);
  }
  return out;
}

/** Trim leading/trailing silence below thresholdDb, keeping a short pad. */
export function trimSilence(buf, sr, { thresholdDb = -45, pad = 0.03 } = {}) {
  const thr = dbToGain(thresholdDb);
  let s = 0; while (s < buf.length && Math.abs(buf[s]) < thr) s++;
  let e = buf.length - 1; while (e > s && Math.abs(buf[e]) < thr) e--;
  const p = Math.round(pad * sr);
  return buf.slice(Math.max(0, s - p), Math.min(buf.length, e + p + 1));
}

/** Apply a named effect chain (shared by SFX recipes, music stems and voice processing). */
export function applyEffects(buf, sr, effects = []) {
  let out = buf;
  for (const fx of effects) {
    switch (fx.type) {
      case 'lowpass': case 'highpass': case 'bandpass': case 'notch': filterBuffer(out, sr, { type: fx.type, freq: fx.freq, q: fx.q }); break;
      case 'eq': for (const band of fx.bands || []) filterBuffer(out, sr, { type: band.type || 'peak', freq: band.freq, q: band.q || 1, gain: band.gain || 0 }); break;
      case 'reverb': reverb(out, sr, fx); break;
      case 'compress': compress(out, sr, fx); break;
      case 'limit': limit(out, sr, fx); break;
      case 'distortion': distort(out, fx); break;
      case 'bitcrush': bitcrush(out, sr, fx); break;
      case 'tremolo': tremolo(out, sr, fx); break;
      case 'gain': for (let i = 0; i < out.length; i++) out[i] *= dbToGain(fx.db || 0); break;
      case 'fade': fade(out, sr, fx); break;
      case 'radio':
        filterBuffer(out, sr, { type: 'highpass', freq: 400, q: 0.7 }); filterBuffer(out, sr, { type: 'lowpass', freq: 3200, q: 0.7 });
        distort(out, { amount: fx.drive ?? 0.15 }); compress(out, sr, { threshold: -20, ratio: 6 });
        break;
      case 'pa_speaker':
        filterBuffer(out, sr, { type: 'highpass', freq: 280, q: 0.7 }); filterBuffer(out, sr, { type: 'lowpass', freq: 4500, q: 0.7 });
        filterBuffer(out, sr, { type: 'peak', freq: 1900, q: 1.2, gain: 5 });
        distort(out, { amount: fx.drive ?? 0.08 }); compress(out, sr, { threshold: -22, ratio: 4 });
        reverb(out, sr, { room: fx.room ?? 0.75, damp: 0.5, mix: fx.mix ?? 0.22, predelay: 0.03 });
        break;
      case 'delay': {
        const d = Math.round((fx.time || 0.25) * sr), fbk = fx.feedback ?? 0.35, mix = fx.mix ?? 0.3;
        const o = new Float32Array(out.length);
        for (let i = 0; i < out.length; i++) o[i] = out[i] + (i >= d ? o[i - d] * fbk : 0);
        for (let i = 0; i < out.length; i++) out[i] = out[i] * (1 - mix) + o[i] * mix;
        break;
      }
      case 'loop': out = makeLoopable(out, sr, fx); break;
      case 'trim_silence': out = trimSilence(out, sr, fx); break;
      default: throw new Error(`Unknown effect ${fx.type}. Supported: lowpass, highpass, bandpass, notch, eq, reverb, compress, limit, distortion, bitcrush, tremolo, gain, fade, radio, pa_speaker, delay, loop, trim_silence`);
    }
  }
  return out;
}
