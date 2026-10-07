// Local layered SFX synthesizer ("local-synth" provider).
//
// A recipe is the reproducible source of a sound effect. Each layer is a
// building block (tone, noise, FM, click, impact, sample) with its own
// envelope, filter and timing; layers are summed and the master effect chain
// is applied. Example — a siren:
// {
//   "duration": 4, "sample_rate": 48000,
//   "layers": [
//     { "name": "fundamental", "type": "osc", "wave": "saw", "freq": { "center": 700, "depth": 250, "rate": 0.5, "shape": "triangle" },
//       "harmonics": [1, 0.4, 0.2], "gain": -8, "filter": { "type": "lowpass", "freq": 3000 } },
//     { "name": "motor", "type": "noise", "color": "brown", "gain": -22, "filter": { "type": "bandpass", "freq": 180, "q": 2 } }
//   ],
//   "effects": [ { "type": "distortion", "amount": 0.15 }, { "type": "pa_speaker" } ],
//   "normalize": { "lufs": -16 }, "loop": false
// }
import fs from 'node:fs';
import { StudioError } from '../core/fsutil.js';
import { paramFn, envelopeFn, oscillator, noiseGen, filterBuffer, applyEffects, dbToGain, makeLoopable, limit } from './dsp.js';
import { makeAudio } from './wav.js';
import { integratedLoudness } from './analyze.js';
import { decodeAny } from './ffmpeg.js';
import { renderVoice, renderModal, renderScrape, MATERIALS, VOWELS } from './sfxmodels.js';
import { rng } from './dsp.js';

const LAYER_TYPES = ['osc', 'noise', 'fm', 'click', 'impact', 'sample', 'chirp', 'voice', 'modal', 'scrape'];
export { MATERIALS, VOWELS };

function renderLayer(layer, sr, totalDur, index, baseDir) {
  const start = layer.start || 0;
  const dur = Math.max(0.001, layer.duration ?? totalDur - start);
  const n = Math.round(dur * sr);
  const buf = new Float32Array(n);
  const env = envelopeFn(layer.envelope || {}, dur);
  const seed = layer.seed ?? index + 1;
  switch (layer.type) {
    case 'osc': {
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
            phases[k] += (fv * (h + 1)) / sr;
            s += amp * oscillator(layer.wave || 'sine', phases[k]);
          });
        }
        buf[i] = (s / voices) * env(t);
      }
      break;
    }
    case 'chirp': // fast pitch sweep, good for UI blips and lasers
    case 'fm': {
      const carrier = paramFn(layer.carrier ?? layer.freq ?? 220, dur);
      const ratio = layer.ratio ?? 2;
      const index_ = paramFn(layer.index ?? (layer.type === 'chirp' ? 0 : 3), dur);
      let pc = 0, pm = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const fc = carrier(t);
        pm += (fc * ratio) / sr;
        const mod = Math.sin(2 * Math.PI * pm) * index_(t);
        pc += fc / sr;
        buf[i] = Math.sin(2 * Math.PI * pc + mod) * env(t);
      }
      break;
    }
    case 'noise': {
      const gen = noiseGen(layer.color || 'white', seed);
      for (let i = 0; i < n; i++) buf[i] = gen() * env(i / sr);
      break;
    }
    case 'click': {
      // short transient: damped sine + noise burst (buttons, relays, switches)
      const freq = layer.freq ?? 2500, decay = layer.decay ?? 0.006;
      const gen = noiseGen('white', seed);
      for (let i = 0; i < n; i++) { const t = i / sr; const e = Math.exp(-t / decay); buf[i] = (Math.sin(2 * Math.PI * freq * t) * 0.6 + gen() * 0.4) * e; }
      break;
    }
    case 'impact': {
      // pitch-dropping body + noise crack (doors, metal hits, explosions)
      const f0 = layer.freq ?? 120, drop = layer.drop ?? 0.5, decay = layer.decay ?? 0.25;
      const gen = noiseGen(layer.color || 'brown', seed);
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
    case 'sample': {
      if (!layer.file) throw new StudioError('E_SFX', 'sample layer needs file');
      const a = decodeAny(baseDir ? `${baseDir}/${layer.file}` : layer.file, { sampleRate: sr });
      const src = a.channels[0];
      const rate = layer.rate ?? 1;
      for (let i = 0; i < n; i++) { const p = i * rate; const k = Math.floor(p); buf[i] = (k + 1 < src.length ? src[k] + (src[k + 1] - src[k]) * (p - k) : 0) * env(i / sr); }
      break;
    }
    case 'voice': buf.set(renderVoice(layer, n, sr, env, seed)); break;
    case 'modal': buf.set(renderModal(layer, n, sr, env, seed)); break;
    case 'scrape': buf.set(renderScrape(layer, n, sr, env, seed)); break;
    default: throw new StudioError('E_SFX', `Unknown layer type ${layer.type}. Supported: ${LAYER_TYPES.join(', ')}`);
  }
  if (layer.filter) filterBuffer(buf, sr, layer.filter);
  if (layer.filters) for (const f of layer.filters) filterBuffer(buf, sr, f);
  if (layer.effects) applyEffects(buf, sr, layer.effects);
  // normalise the layer to peak 1 before its gain so gains are predictable
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(buf[i]));
  const g = (layer.normalize_layer === false ? dbToGain(layer.gain ?? -6) : dbToGain(layer.gain ?? -6) / (pk || 1)) * (layer._vel ?? 1);
  for (let i = 0; i < n; i++) buf[i] *= g;
  return { buf, offset: Math.round(start * sr), pan: layer.pan || 0 };
}

export function validateRecipe(recipe) {
  const problems = [];
  if (!recipe || typeof recipe !== 'object') return ['recipe must be an object'];
  if (!(recipe.duration > 0 && recipe.duration <= 120)) problems.push('duration must be between 0 and 120 seconds');
  if (!Array.isArray(recipe.layers) || !recipe.layers.length) problems.push('at least one layer is required');
  (recipe.layers || []).forEach((l, i) => { if (!LAYER_TYPES.includes(l.type)) problems.push(`layer ${i}: unknown type ${l.type}`); });
  if (recipe.channels && ![1, 2].includes(recipe.channels)) problems.push('channels must be 1 or 2');
  return problems;
}

/**
 * Expand `repeat` on layers into copies: { times: [...] } or { count, interval, jitter (s),
 * gain_jitter (dB), pitch_jitter (semitones), accel (interval multiplier per step) }.
 * Each copy gets its own seed, so noise and modal hits differ (footsteps, claw taps, shards).
 */
export function expandRepeats(layers) {
  const out = [];
  layers.forEach((layer, li) => {
    const rp = layer.repeat;
    if (!rp) { out.push(layer); return; }
    const r = rng((layer.seed ?? li + 1) * 7919);
    let times = rp.times;
    if (!times) {
      times = [];
      let t = layer.start || 0, iv = rp.interval ?? 0.5;
      for (let k = 0; k < (rp.count ?? 4); k++) { times.push(t + (rp.jitter ?? 0) * r()); t += iv; iv *= rp.accel ?? 1; }
    }
    times.forEach((t, k) => {
      const shift = 2 ** (((rp.pitch_jitter ?? 0) * r()) / 12);
      const copy = { ...layer, repeat: undefined, start: Math.max(0, t), seed: (layer.seed ?? li + 1) * 131 + k, _vel: 10 ** (((rp.gain_jitter ?? 0) * r() - (rp.fade_db ?? 0) * (k / Math.max(1, times.length - 1))) / 20) };
      for (const key of ['freq', 'pitch', 'carrier']) if (typeof copy[key] === 'number') copy[key] *= shift;
      out.push(copy);
    });
  });
  return out;
}

/** Render a recipe to an Audio object. */
export function renderRecipe(recipe, { baseDir = null } = {}) {
  const problems = validateRecipe(recipe);
  if (problems.length) throw new StudioError('E_SFX', `Invalid SFX recipe: ${problems.join('; ')}`);
  const sr = recipe.sample_rate || 48000;
  const nch = recipe.channels || 1;
  const layers = expandRepeats(recipe.layers);
  const tail = recipe.loop ? 0 : recipe.tail ?? 0;
  const out = makeAudio(sr, recipe.duration + tail + (recipe.loop ? (recipe.loop_crossfade ?? 0.25) : 0), nch);
  layers.forEach((layer, i) => {
    const { buf, offset, pan } = renderLayer(layer, sr, recipe.duration + (recipe.loop ? (recipe.loop_crossfade ?? 0.25) : 0), i, baseDir);
    for (let c = 0; c < nch; c++) {
      const g = nch === 1 ? 1 : c === 0 ? Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2 : Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
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

/** Normalise to a loudness or peak target, then safety-limit at `ceiling` dBFS (default -1). */
export function normalizeAudio(audio, { lufs = null, peak = null, ceiling = -1 } = {}) {
  let gain = 1;
  if (lufs != null) {
    const cur = integratedLoudness(audio);
    if (Number.isFinite(cur)) gain = dbToGain(lufs - cur);
  } else if (peak != null) {
    let pk = 0; for (const c of audio.channels) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
    if (pk > 0) gain = dbToGain(peak) / pk;
  }
  for (const c of audio.channels) for (let i = 0; i < c.length; i++) c[i] *= gain;
  // ceiling: lower it (e.g. -3) for sharp transients that lossy Ogg encoding overshoots
  for (const c of audio.channels) limit(c, audio.sampleRate, { ceiling });
  return audio;
}

export function readRecipe(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Ready-made starting recipes; agents copy and adapt them rather than starting from nothing. */
export const RECIPE_PRESETS = {
  button: { duration: 0.18, layers: [{ type: 'click', freq: 3200, decay: 0.004, gain: -6 }, { type: 'click', start: 0.06, freq: 1800, decay: 0.008, gain: -10 }], effects: [{ type: 'reverb', room: 0.2, mix: 0.08 }], normalize: { lufs: -18 } },
  relay: { duration: 0.25, layers: [{ type: 'click', freq: 1400, decay: 0.01, gain: -4 }, { type: 'impact', freq: 300, decay: 0.05, noise: 0.8, gain: -12 }, { type: 'osc', wave: 'square', freq: 50, start: 0.01, duration: 0.12, gain: -24, envelope: { attack: 0.002, release: 0.05 } }], effects: [{ type: 'reverb', room: 0.3, mix: 0.12 }], normalize: { lufs: -17 } },
  hydraulic: { duration: 1.6, layers: [{ type: 'noise', color: 'white', gain: -6, envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.6 }, filter: { type: 'bandpass', freq: { from: 5000, to: 1800, curve: 'exp' }, q: 0.8 } }, { type: 'noise', color: 'brown', gain: -14, envelope: { attack: 0.1, release: 0.5 }, filter: { type: 'lowpass', freq: 300 } }], effects: [{ type: 'reverb', room: 0.5, mix: 0.2 }], normalize: { lufs: -17 } },
  engine_loop: { duration: 4, loop: true, layers: [{ type: 'osc', wave: 'saw', freq: { center: 55, depth: 1.5, rate: 0.3 }, harmonics: [1, 0.5, 0.33, 0.25], gain: -6, filter: { type: 'lowpass', freq: 600 } }, { type: 'noise', color: 'brown', gain: -16, filter: { type: 'bandpass', freq: 120, q: 1.5 } }, { type: 'osc', wave: 'sine', freq: 220, gain: -26, effects: [{ type: 'tremolo', rate: 13.75, depth: 0.6 }] }], effects: [{ type: 'compress', threshold: -16, ratio: 3 }], normalize: { lufs: -20 } },
  siren: { duration: 4, loop: true, layers: [{ name: 'fundamental', type: 'osc', wave: 'saw', freq: { center: 720, depth: 260, rate: 0.5, shape: 'triangle' }, harmonics: [1, 0.45, 0.2], gain: -6, filter: { type: 'lowpass', freq: 3500 } }, { name: 'motor', type: 'noise', color: 'brown', gain: -20, filter: { type: 'bandpass', freq: 160, q: 2 } }], effects: [{ type: 'distortion', amount: 0.12 }, { type: 'pa_speaker', mix: 0.18 }], normalize: { lufs: -15 } },
  alarm_beep: { duration: 1.0, loop: true, layers: [{ type: 'osc', wave: 'square', freq: 1046, duration: 0.25, gain: -8, envelope: { attack: 0.003, release: 0.02 }, filter: { type: 'lowpass', freq: 4000 } }, { type: 'osc', wave: 'square', freq: 784, start: 0.5, duration: 0.25, gain: -8, envelope: { attack: 0.003, release: 0.02 }, filter: { type: 'lowpass', freq: 4000 } }], effects: [{ type: 'reverb', room: 0.6, mix: 0.2 }], normalize: { lufs: -16 } },
  power_up: { duration: 2.4, layers: [{ type: 'osc', wave: 'saw', freq: { from: 40, to: 180, curve: 'exp' }, harmonics: [1, 0.5, 0.3], gain: -6, envelope: { attack: 0.3, release: 0.4 }, filter: { type: 'lowpass', freq: { from: 200, to: 2400, curve: 'exp' } } }, { type: 'noise', color: 'pink', gain: -18, envelope: { attack: 1.5, release: 0.5 }, filter: { type: 'highpass', freq: 3000 } }], effects: [{ type: 'reverb', room: 0.6, mix: 0.2 }], normalize: { lufs: -16 } },
  power_down: { duration: 2.6, layers: [{ type: 'osc', wave: 'saw', freq: { from: 180, to: 30, curve: 'exp' }, harmonics: [1, 0.5, 0.3], gain: -6, envelope: { attack: 0.01, release: 1.2 }, filter: { type: 'lowpass', freq: { from: 2400, to: 150, curve: 'exp' } } }], effects: [{ type: 'reverb', room: 0.6, mix: 0.25 }], normalize: { lufs: -17 } },
  explosion: { duration: 3, layers: [{ type: 'impact', freq: 60, drop: 0.4, decay: 0.9, noise: 1, gain: -3 }, { type: 'noise', color: 'brown', gain: -8, envelope: { attack: 0.005, decay: 1.5, sustain: 0, release: 1 }, filter: { type: 'lowpass', freq: { from: 4000, to: 200, curve: 'exp' } } }], effects: [{ type: 'distortion', amount: 0.25 }, { type: 'reverb', room: 0.85, mix: 0.3 }], normalize: { lufs: -12 } },
  ui_confirm: { duration: 0.35, layers: [{ type: 'osc', wave: 'triangle', freq: 880, duration: 0.12, gain: -6, envelope: { attack: 0.002, release: 0.08 } }, { type: 'osc', wave: 'triangle', freq: 1320, start: 0.09, duration: 0.2, gain: -6, envelope: { attack: 0.002, release: 0.15 } }], effects: [{ type: 'reverb', room: 0.3, mix: 0.15 }], normalize: { lufs: -18 } },
  ambience_hum: { duration: 8, loop: true, layers: [{ type: 'osc', wave: 'sine', freq: 50, harmonics: [1, 0.3, 0.15, 0.1], gain: -8 }, { type: 'noise', color: 'pink', gain: -26, filter: { type: 'lowpass', freq: { center: 900, depth: 300, rate: 0.07 } } }], normalize: { lufs: -26 } },
  growl: { duration: 1.8, layers: [{ type: 'osc', wave: 'saw', freq: { from: 95, to: 70 }, harmonics: [1, 0.6, 0.4, 0.3], gain: -6, envelope: { attack: 0.15, release: 0.5 }, filter: { type: 'bandpass', freq: { center: 600, depth: 250, rate: 7 }, q: 1.5 }, effects: [{ type: 'tremolo', rate: 23, depth: 0.5 }] }, { type: 'noise', color: 'pink', gain: -16, envelope: { attack: 0.2, release: 0.6 }, filter: { type: 'bandpass', freq: 900, q: 1 } }], effects: [{ type: 'distortion', amount: 0.3 }, { type: 'reverb', room: 0.4, mix: 0.15 }], normalize: { lufs: -15 } },
};
