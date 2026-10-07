// Physical-ish models for the SFX synthesizer:
//   voice  — formant voice (glottal source, jitter, roughness/growl, breath, vibrato,
//            vowel morphs, syllable pulses) for creatures, screams, laughter, crying
//   modal  — struck resonant objects (metal, glass, wood, pipe, string, ...) as a
//            bank of decaying partials, with any number of hits (shatter, rattles)
//   scrape — stick-slip friction exciting a material's resonances (claws, metal,
//            wood, glass scrapes)
import { paramFn, noiseGen, rng, Biquad } from './dsp.js';

// ------------------------------------------------------------------ voice

/** Formant tables: [F1, F2, F3, F4] in Hz for an adult male; `size` scales them. */
export const VOWELS = {
  a: [800, 1150, 2900, 3900], e: [400, 1700, 2600, 3300], i: [300, 2200, 3000, 3700], o: [450, 800, 2830, 3800],
  u: [325, 700, 2530, 3500], ae: [660, 1700, 2400, 3500], uh: [600, 1200, 2500, 3500], er: [490, 1350, 1690, 3300],
  ah: [750, 1200, 2600, 3500], oo: [350, 750, 2400, 3400], h: [700, 1300, 2500, 3500],
};
const FORMANT_GAINS = [1, 0.62, 0.32, 0.18];
const FORMANT_BW = [90, 110, 170, 250];

function vowelAt(spec, t) {
  if (typeof spec === 'string') return VOWELS[spec] || VOWELS.a;
  if (Array.isArray(spec) && spec.length) {
    // [[time, vowel], ...] — interpolate formants between keyframes
    if (t <= spec[0][0]) return VOWELS[spec[0][1]];
    for (let k = 1; k < spec.length; k++) {
      if (t <= spec[k][0]) {
        const [t0, v0] = spec[k - 1], [t1, v1] = spec[k];
        const u = (t - t0) / Math.max(1e-6, t1 - t0);
        const a = VOWELS[v0] || VOWELS.a, b = VOWELS[v1] || VOWELS.a;
        return a.map((f, i) => f + (b[i] - f) * u);
      }
    }
    return VOWELS[spec[spec.length - 1][1]] || VOWELS.a;
  }
  return VOWELS.a;
}

/**
 * Formant voice. Layer fields:
 *   pitch (Hz param), vowel ('a'…'u' or [[t, vowel]…]), size (formant scale: 1 adult, 0.8 child, 1.5+ monster),
 *   breath 0..1, rough 0..1 (subharmonic growl), jitter 0..1, strain 0..1 (pressed/screamed),
 *   vibrato { rate, depth (semitones) }, pulses { rate (Hz param), duty 0..1, jitter (timing), pitch_jitter (semitones),
 *   accent 0..1 (loudness variation), skip 0..1 } for ha-ha / sobs — every syllable differs.
 */
export function renderVoice(layer, n, sr, env, seed) {
  const out = new Float32Array(n);
  const dur = n / sr;
  const f0 = paramFn(layer.pitch ?? 140, dur);
  const size = layer.size ?? 1;
  const breath = paramFn(layer.breath ?? 0.15, dur);
  const rough = paramFn(layer.rough ?? 0, dur);
  const strain = layer.strain ?? 0;
  const jitter = layer.jitter ?? 0.15;
  const vib = layer.vibrato || null;
  const pulses = layer.pulses || null;
  const pulseRate = pulses ? paramFn(pulses.rate ?? 6, dur) : null;
  const r = rng(seed);
  const noise = noiseGen('white', seed + 7);
  const slow = noiseGen('pink', seed + 13);
  const bands = FORMANT_BW.map(() => new Biquad('bandpass', sr));
  const tilt = new Biquad('lowpass', sr);
  tilt.set(2800 + 2400 * strain, 0.6);
  let ph = 0, sub = 0, pulsePh = 0, pulseOn = 1, nextJit = 0;
  // per-syllable variation: timing, pitch and accent differ for every 'ha' / sob
  let pScale = 1, pPitch = 1, pAmp = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 32 === 0) {
      const fm = vowelAt(layer.vowel ?? 'a', t).map((f) => f / size);
      bands.forEach((b, k) => b.set(fm[k], fm[k] / (FORMANT_BW[k] * (1 + strain * 0.6))));
    }
    // pitch with vibrato and slow jitter
    let f = f0(t) * pPitch;
    if (vib) f *= 2 ** (((vib.depth ?? 0.3) * Math.sin(2 * Math.PI * (vib.rate ?? 5.5) * t)) / 12);
    f *= 1 + jitter * 0.03 * slow();
    ph += f / sr;
    if (ph >= 1) { ph -= 1; sub = 1 - sub; }
    // glottal-ish source: band-limited saw with spectral tilt, subharmonic for growl
    const saw = 1 - 2 * ph;
    const rg = rough(t);
    let src = saw * (1 - rg * 0.5 * sub) + rg * 0.35 * Math.sin(2 * Math.PI * ph * 0.5);
    if (strain > 0) src = Math.tanh(src * (1 + strain * 3));
    src = tilt.process(src);
    const br = breath(t);
    src = src * (1 - br) + noise() * br * 1.4;
    // syllable gating (laughter, sobbing, panting)
    let gate = 1;
    if (pulses) {
      pulsePh += pulseRate(t) / (sr * pScale);
      if (pulsePh >= 1) {
        pulsePh -= 1;
        pulseOn = r() > -1 + 2 * (pulses.skip ?? 0) ? 1 : 0;
        nextJit = r() * (pulses.jitter ?? 0.2);
        pScale = 1 + (pulses.jitter ?? 0.2) * 0.8 * r();
        pPitch = 2 ** (((pulses.pitch_jitter ?? 1.5) * r()) / 12);
        pAmp = 1 - (pulses.accent ?? 0.35) * Math.abs(r());
      }
      const duty = Math.min(0.95, Math.max(0.05, (pulses.duty ?? 0.5) + nextJit * 0.2));
      const p = pulsePh;
      gate = pulseOn * pAmp * (p < duty ? Math.sin((Math.PI * p) / duty) ** 0.7 : 0);
    }
    let y = 0;
    for (let k = 0; k < 4; k++) y += bands[k].process(src) * FORMANT_GAINS[k];
    out[i] = y * gate * env(t);
  }
  return out;
}

// ------------------------------------------------------------------ modal

/** Material partial sets: [ratio, gain, decay multiplier]. */
export const MATERIALS = {
  metal: [[1, 1, 1], [2.76, 0.7, 0.8], [5.4, 0.5, 0.65], [8.93, 0.35, 0.5], [13.34, 0.25, 0.4], [18.64, 0.18, 0.3], [24.9, 0.12, 0.25]],
  metal_plate: [[1, 1, 1], [1.59, 0.8, 0.9], [2.14, 0.7, 0.85], [2.3, 0.6, 0.8], [2.65, 0.55, 0.7], [2.92, 0.5, 0.7], [3.16, 0.45, 0.6], [3.5, 0.4, 0.55], [4.2, 0.35, 0.5], [5.1, 0.3, 0.4]],
  pipe: [[1, 1, 1], [2.01, 0.65, 0.9], [3.03, 0.45, 0.75], [4.06, 0.3, 0.6], [5.1, 0.2, 0.5], [6.15, 0.15, 0.4]],
  glass: [[1, 1, 1], [2.32, 0.8, 0.7], [4.25, 0.6, 0.5], [6.63, 0.45, 0.4], [9.38, 0.3, 0.3], [12.6, 0.2, 0.25]],
  wood: [[1, 1, 1], [2.57, 0.55, 0.5], [4.2, 0.35, 0.35], [5.8, 0.2, 0.25], [7.6, 0.12, 0.2]],
  stone: [[1, 1, 1], [1.8, 0.7, 0.6], [2.9, 0.5, 0.4], [4.4, 0.3, 0.3]],
  string: [[1, 1, 1], [2, 0.6, 0.9], [3, 0.4, 0.8], [4, 0.28, 0.7], [5, 0.2, 0.6], [6, 0.14, 0.5], [7, 0.1, 0.45]],
};

/** Expand hit specs: array of times, or { count, start, end, distribution: 'uniform'|'decay'|'burst', jitter }. */
export function expandHits(hits, dur, seed) {
  if (!hits) return [{ t: 0, vel: 1 }];
  if (Array.isArray(hits)) return hits.map((h) => (typeof h === 'number' ? { t: h, vel: 1 } : { t: h.t ?? h.time ?? 0, vel: h.vel ?? 1, freq: h.freq }));
  const r = rng(seed + 101);
  const { count = 8, start = 0, end = dur, distribution = 'decay', vel_from = 1, vel_to = 0.3 } = hits;
  const out = [];
  for (let k = 0; k < count; k++) {
    const u = (r() + 1) / 2;
    const pos = distribution === 'uniform' ? (k + u * (hits.jitter ?? 0.8)) / count : distribution === 'burst' ? u ** 3 : u ** 2;
    const t = start + (end - start) * Math.min(1, pos);
    const frac = (t - start) / Math.max(1e-6, end - start);
    out.push({ t, vel: (vel_from + (vel_to - vel_from) * frac) * (0.6 + 0.4 * (r() + 1) / 2) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Struck resonant object. Layer fields:
 *   material (MATERIALS key) or partials [[ratio, gain, decayMul]…], freq (Hz), decay (s, of the fundamental),
 *   hits (times or generator), freq_spread (0..1: random size per hit, e.g. shards), brightness 0..1 (strike noise),
 *   damping (0..1 extra high-partial damping), detune (cents random per partial).
 */
export function renderModal(layer, n, sr, env, seed) {
  const out = new Float32Array(n);
  const dur = n / sr;
  const partials = layer.partials || MATERIALS[layer.material || 'metal'] || MATERIALS.metal;
  const baseF = layer.freq ?? 400;
  const decay = layer.decay ?? 1;
  const spread = layer.freq_spread ?? 0;
  const bright = layer.brightness ?? 0.4;
  const damping = layer.damping ?? 0;
  const detune = layer.detune ?? 4;
  const r = rng(seed);
  const hits = expandHits(layer.hits, dur, seed);
  for (const hit of hits) {
    const start = Math.round(hit.t * sr);
    const f0 = (hit.freq ?? baseF) * (spread ? 2 ** (spread * 2 * r()) : 1);
    const nz = noiseGen('white', seed + start);
    const hp = new Biquad('highpass', sr); hp.set(Math.min(sr * 0.45, f0 * 2), 0.7);
    // strike transient
    const tn = Math.round(0.004 * sr * (1 + bright * 3));
    for (let i = 0; i < tn && start + i < n; i++) out[start + i] += hp.process(nz()) * bright * hit.vel * (1 - i / tn) * 1.5;
    partials.forEach(([ratio, gain, dm], k) => {
      const f = f0 * ratio * 2 ** ((detune * r()) / 1200);
      if (f >= sr * 0.48) return;
      const d = decay * dm * (1 - damping * Math.min(1, k / partials.length));
      const len = Math.min(n - start, Math.round(d * 6 * sr));
      const phase = Math.abs(r()) * Math.PI * 2;
      const g = gain * hit.vel;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[start + i] += Math.sin(2 * Math.PI * f * t + phase) * g * Math.exp(-t / d);
      }
    });
  }
  for (let i = 0; i < n; i++) out[i] *= env(i / sr);
  return out;
}

// ------------------------------------------------------------------ scrape

/**
 * Stick-slip friction. Layer fields:
 *   material, freq (resonance base, Hz), speed (slips per second, param), pressure (0..1 param),
 *   grit (0..1 continuous noise), squeal (0..1 high-Q resonance), q (resonance sharpness, default 30).
 */
export function renderScrape(layer, n, sr, env, seed) {
  const out = new Float32Array(n);
  const dur = n / sr;
  const partials = layer.partials || MATERIALS[layer.material || 'metal'] || MATERIALS.metal;
  const baseF = paramFn(layer.freq ?? 900, dur);
  const speed = paramFn(layer.speed ?? 120, dur);
  const pressure = paramFn(layer.pressure ?? 0.7, dur);
  const grit = layer.grit ?? 0.35;
  const squeal = layer.squeal ?? 0.3;
  const q = layer.q ?? 30;
  const r = rng(seed);
  const nz = noiseGen('white', seed + 3);
  const res = partials.slice(0, 6).map(() => new Biquad('bandpass', sr));
  const body = new Biquad('bandpass', sr);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 64 === 0) {
      const f = baseF(t) * (1 + 0.01 * r());
      res.forEach((b, k) => b.set(f * partials[k][0], q * (1 + squeal * 3)));
      body.set(f * 1.5, 0.7);
    }
    acc += speed(t) * (0.6 + 0.8 * Math.abs(r())) / sr;
    let ex = 0;
    if (acc >= 1) { acc -= Math.floor(acc); ex = (0.5 + Math.abs(r())) * (r() > 0 ? 1 : -1); }
    const pr = pressure(t);
    ex = ex * pr + nz() * grit * pr * 0.25;
    let y = body.process(ex) * 0.4;
    for (let k = 0; k < res.length; k++) y += res[k].process(ex) * partials[k][1] * (1 + squeal * (k > 1 ? 1.5 : 0));
    out[i] = y * env(t);
  }
  return out;
}
