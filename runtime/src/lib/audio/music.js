// Structured music composer ("local-composer" provider).
//
// A score is the editable source of a game music cue. It is rendered into
// section mixes (intro / loop / outro / stinger), per-stem loops for adaptive
// layering, and a metadata file with tempo, meter, key, bar grid, loop
// boundaries and transition points that game logic uses to switch music on
// musical boundaries instead of mid-phrase.
//
// {
//   "title": "reactor_calm", "state": "calm", "bpm": 92, "meter": [4, 4], "key": "D minor",
//   "sections": [ { "name": "intro", "bars": 2 }, { "name": "loop", "bars": 8, "loop": true }, { "name": "outro", "bars": 2 } ],
//   "transition_every_bars": 2,
//   "stems": [
//     { "name": "pad", "instrument": "pad", "gain": -8, "parts": { "loop": "[D3 F3 A3]:8 [Bb2 D3 F3]:8" } },
//     { "name": "drums", "instrument": "drums", "parts": { "loop": { "kick": "x...x...x...x...", "hat": "..x...x...x...x." } } }
//   ]
// }
// Note syntax: NOTE:beats | [CHORD NOTES]:beats | r:beats, optional @velocity (0..1), "|" bar lines ignored.
import { StudioError } from '../core/fsutil.js';
import { noteToMidi, midiToFreq, Biquad, noiseGen, applyEffects, dbToGain, envelopeFn, oscillator, rng, limit } from './dsp.js';
import { makeAudio } from './wav.js';
import { integratedLoudness } from './analyze.js';

export const INSTRUMENTS = ['pad', 'strings', 'bass', 'pluck', 'bell', 'choir', 'lead', 'drone', 'brass', 'drums', 'pulse', 'sub'];

export function parseSequence(text) {
  if (typeof text !== 'string') throw new StudioError('E_SCORE', 'Melodic parts must be strings');
  const tokens = text.match(/\[[^\]]*\](?::[\d./]+)?(?:@[\d.]+)?|[^\s|]+/g) || [];
  let beat = 0;
  const events = [];
  for (const tok of tokens) {
    const m = tok.match(/^(\[[^\]]*\]|[^:@]+)(?::([\d./]+))?(?:@([\d.]+))?$/);
    if (!m) throw new StudioError('E_SCORE', `Cannot parse token "${tok}"`);
    const len = m[2] ? (m[2].includes('/') ? Number(m[2].split('/')[0]) / Number(m[2].split('/')[1]) : Number(m[2])) : 1;
    if (!(len > 0)) throw new StudioError('E_SCORE', `Invalid length in "${tok}"`);
    const vel = m[3] ? Number(m[3]) : 0.8;
    const body = m[1];
    if (body !== 'r') {
      const notes = body.startsWith('[') ? body.slice(1, -1).trim().split(/\s+/) : [body];
      for (const n of notes) events.push({ beat, beats: len, midi: noteToMidi(n), vel });
    }
    beat += len;
  }
  return { events, beats: beat };
}

function renderNote(instrument, freq, dur, vel, sr, opts = {}, seed = 1) {
  const spec = {
    pad: { attack: 0.8, release: 1.6 }, strings: { attack: 0.35, release: 0.8 }, bass: { attack: 0.008, release: 0.12 },
    pluck: { attack: 0.002, release: 0.3 }, bell: { attack: 0.002, release: 2.5 }, choir: { attack: 0.35, release: 0.9 },
    lead: { attack: 0.02, release: 0.25 }, drone: { attack: 1.5, release: 2.5 }, brass: { attack: 0.06, release: 0.3 },
    pulse: { attack: 0.005, release: 0.08 }, sub: { attack: 0.01, release: 0.2 },
  }[instrument];
  if (!spec) throw new StudioError('E_SCORE', `Unknown instrument ${instrument}. Available: ${INSTRUMENTS.join(', ')}`);
  const total = dur + spec.release;
  const n = Math.round(total * sr);
  const out = new Float32Array(n);
  const env = envelopeFn({ attack: spec.attack, decay: 0.2, sustain: instrument === 'pluck' || instrument === 'bell' ? 0 : 0.85, release: spec.release, curve: 'linear' }, total);
  const r = rng(seed);
  switch (instrument) {
    case 'pad': case 'strings': case 'drone': {
      const voices = instrument === 'strings' ? 5 : 3;
      const phases = Array.from({ length: voices }, () => Math.abs(r()));
      const lp = new Biquad('lowpass', sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 64 === 0) lp.set((instrument === 'drone' ? 500 : instrument === 'pad' ? 1100 : 2600) + 300 * Math.sin(2 * Math.PI * 0.15 * t), 0.8);
        let s = 0;
        for (let v = 0; v < voices; v++) {
          const det = 2 ** (((v - (voices - 1) / 2) * (instrument === 'strings' ? 7 : 9)) / 1200);
          phases[v] += (freq * det * (1 + 0.002 * Math.sin(2 * Math.PI * 5 * t))) / sr;
          s += oscillator('saw', phases[v]);
        }
        if (instrument === 'drone') s += 2 * Math.sin(2 * Math.PI * freq * 0.5 * t);
        out[i] = lp.process(s / voices) * env(t);
      }
      break;
    }
    case 'bass': case 'sub': {
      const lp = new Biquad('lowpass', sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 32 === 0) lp.set(instrument === 'sub' ? 180 : 220 + 900 * Math.exp(-t * 8), 1.1);
        ph += freq / sr;
        const s = instrument === 'sub' ? Math.sin(2 * Math.PI * ph) : oscillator('square', ph) * 0.6 + Math.sin(2 * Math.PI * ph * 0.5) * 0.6;
        out[i] = lp.process(s) * env(t);
      }
      break;
    }
    case 'pluck': {
      // Karplus–Strong
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
    case 'bell': {
      let pc = 0, pm = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        pm += (freq * 3.5) / sr; pc += freq / sr;
        out[i] = Math.sin(2 * Math.PI * pc + Math.sin(2 * Math.PI * pm) * 4 * Math.exp(-t * 2.5)) * Math.exp(-t * 1.6);
      }
      break;
    }
    case 'choir': {
      const vowel = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480], i: [270, 2290, 3010] }[opts.vowel || 'a'] || [730, 1090, 2440];
      const bands = vowel.map((f, k) => { const b = new Biquad('bandpass', sr); b.set(f, k === 0 ? 6 : 9); return b; });
      const phases = [0, 0.33, 0.66];
      const gen = noiseGen('white', seed);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const vib = 1 + 0.006 * Math.sin(2 * Math.PI * (5 + (seed % 3) * 0.3) * t) * Math.min(1, t * 2);
        let src = 0;
        phases.forEach((p, v) => { phases[v] += (freq * vib * 2 ** ((v - 1) * 6 / 1200)) / sr; src += oscillator('saw', phases[v]); });
        src = src / 3 + gen() * 0.04; // breath
        out[i] = (bands[0].process(src) * 1.0 + bands[1].process(src) * 0.6 + bands[2].process(src) * 0.3) * 3 * env(t);
      }
      break;
    }
    case 'lead': case 'pulse': case 'brass': {
      const lp = new Biquad('lowpass', sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (i % 32 === 0) lp.set(instrument === 'brass' ? 600 + 2400 * Math.min(1, t / 0.12) * Math.exp(-t * 1.5) + 600 : instrument === 'pulse' ? 2600 : 3200, 0.9);
        ph += (freq * (instrument === 'lead' ? 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3) : 1)) / sr;
        const s = instrument === 'brass' ? oscillator('saw', ph) : oscillator(instrument === 'pulse' ? 'pulse25' : 'square', ph) * 0.7;
        out[i] = lp.process(s) * env(t);
      }
      break;
    }
    default: break;
  }
  for (let i = 0; i < n; i++) out[i] *= vel;
  return out;
}

function renderDrum(kind, sr, vel, seed) {
  const gen = noiseGen('white', seed);
  const dur = { kick: 0.45, snare: 0.3, hat: 0.07, openhat: 0.35, tom: 0.4, clap: 0.25, impact: 1.6 }[kind];
  if (!dur) throw new StudioError('E_SCORE', `Unknown drum ${kind}. Use kick, snare, hat, openhat, tom, clap, impact`);
  const n = Math.round(dur * sr);
  const out = new Float32Array(n);
  const hp = new Biquad('highpass', sr); hp.set(kind === 'hat' || kind === 'openhat' ? 7000 : 1200, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    if (kind === 'kick') { ph += (45 + 110 * Math.exp(-t * 30)) / sr; s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7); }
    else if (kind === 'tom') { ph += (90 + 60 * Math.exp(-t * 15)) / sr; s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 8); }
    else if (kind === 'impact') { ph += (38 + 70 * Math.exp(-t * 6)) / sr; s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2) + gen() * 0.4 * Math.exp(-t * 6); }
    else if (kind === 'snare') { ph += 185 / sr; s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 25) * 0.6 + hp.process(gen()) * Math.exp(-t * 14); }
    else if (kind === 'clap') { s = hp.process(gen()) * (Math.exp(-((t % 0.012) * 300)) * (t < 0.036 ? 1 : 0) + Math.exp(-t * 18) * 0.6); }
    else { s = hp.process(gen()) * Math.exp(-t * (kind === 'hat' ? 60 : 9)); }
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

export function validateScore(score) {
  const problems = [];
  if (!(score.bpm >= 30 && score.bpm <= 300)) problems.push('bpm must be 30..300');
  if (!Array.isArray(score.sections) || !score.sections.length) problems.push('sections are required');
  if (!Array.isArray(score.stems) || !score.stems.length) problems.push('stems are required');
  const names = new Set((score.sections || []).map((s) => s.name));
  if ((score.sections || []).filter((s) => s.loop).length > 1) problems.push('only one loop section per cue (create separate cues per music state)');
  for (const st of score.stems || []) {
    if (!INSTRUMENTS.includes(st.instrument)) problems.push(`stem ${st.name}: unknown instrument ${st.instrument}`);
    for (const sec of Object.keys(st.parts || {})) if (!names.has(sec)) problems.push(`stem ${st.name}: part for unknown section ${sec}`);
  }
  return problems;
}

export function timing(score) {
  const meter = score.meter || [4, 4];
  const beatSec = 60 / score.bpm; // the beat = quarter note
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

/**
 * Render one section (all or selected stems). Notes ringing past the end of a
 * loop section are wrapped onto its start so the loop is seamless.
 */
export function renderSection(score, sectionName, { stems = null, sampleRate = 48000 } = {}) {
  const tm = timing(score);
  const sec = tm.sections.find((s) => s.name === sectionName);
  if (!sec) throw new StudioError('E_SCORE', `Unknown section ${sectionName}`);
  const tail = 3;
  const len = Math.round(sec.duration_s * sampleRate);
  const buf = makeAudio(sampleRate, sec.duration_s + tail, 2);
  const chosen = score.stems.filter((s) => !stems || stems.includes(s.name));
  chosen.forEach((stem, si) => {
    const part = stem.parts?.[sectionName];
    if (!part) return;
    const mono = new Float32Array(buf.channels[0].length);
    const sectionBeats = sec.bars * tm.barBeats;
    if (stem.instrument === 'drums') {
      const steps = 4; // 16th notes per beat
      for (const [drum, pattern] of Object.entries(part)) {
        const p = pattern.replace(/\s|\|/g, '');
        const total = Math.round(sectionBeats * steps);
        for (let k = 0; k < total; k++) {
          const ch = p[k % p.length];
          if (ch === '.' || ch === '-') continue;
          const vel = ch === 'X' ? 1 : ch === 'o' ? 0.45 : 0.75;
          addAt(mono, renderDrum(drum, sampleRate, vel, si * 977 + k), Math.round(((k / steps) * tm.beatSec) * sampleRate), 1);
        }
      }
    } else {
      const { events, beats } = parseSequence(typeof part === 'string' ? part : part.notes);
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
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let i = 0; i < processed.length && i < buf.channels[0].length; i++) { buf.channels[0][i] += processed[i] * g * gl; buf.channels[1][i] += processed[i] * g * gr; }
  });
  // wrap tail for loops, otherwise keep a short natural tail for one-shots
  for (let c = 0; c < 2; c++) {
    const ch = buf.channels[c];
    if (sec.loop) {
      for (let i = len; i < ch.length; i++) ch[i - len] += ch[i];
      buf.channels[c] = ch.slice(0, len);
    } else {
      const keep = sectionName === 'outro' || sectionName.startsWith('stinger') ? ch.length : len + Math.round(0.5 * sampleRate);
      const out = ch.slice(0, keep);
      const f = Math.round(0.4 * sampleRate);
      for (let i = 0; i < f && i < out.length; i++) out[out.length - 1 - i] *= i / f;
      buf.channels[c] = out;
    }
  }
  return { audio: buf, section: sec };
}

/** Render every section mix and every stem loop; returns audio + metadata (files written by caller). */
export function renderScore(score, { sampleRate = 48000, lufs = -20 } = {}) {
  const problems = validateScore(score);
  if (problems.length) throw new StudioError('E_SCORE', `Invalid score: ${problems.join('; ')}`);
  const tm = timing(score);
  const outputs = [];
  for (const sec of tm.sections) {
    const { audio } = renderSection(score, sec.name, { sampleRate });
    outputs.push({ kind: 'section', section: sec.name, audio });
  }
  const loopSec = tm.sections.find((s) => s.loop);
  if (loopSec && score.stems.length > 1) {
    for (const stem of score.stems) {
      if (!stem.parts?.[loopSec.name]) continue;
      const { audio } = renderSection(score, loopSec.name, { stems: [stem.name], sampleRate });
      outputs.push({ kind: 'stem', section: loopSec.name, stem: stem.name, audio });
    }
  }
  // one shared gain (measured on the loop mix) keeps sections and stems level-consistent
  const ref = outputs.find((o) => o.kind === 'section' && o.section === (loopSec?.name || tm.sections[0].name));
  const measured = integratedLoudness(ref.audio);
  const gain = Number.isFinite(measured) ? dbToGain(lufs - measured) : 1;
  for (const o of outputs) {
    for (const c of o.audio.channels) { for (let i = 0; i < c.length; i++) c[i] *= gain; limit(c, sampleRate, { ceiling: -1 }); }
  }
  const every = score.transition_every_bars || 1;
  const metadata = {
    title: score.title, state: score.state || null, bpm: score.bpm, meter: tm.meter, key: score.key || null,
    sample_rate: sampleRate, beat_seconds: Number(tm.beatSec.toFixed(6)), bar_seconds: Number(tm.barSec.toFixed(6)),
    sections: tm.sections,
    loop: loopSec ? { section: loopSec.name, bars: loopSec.bars, duration_s: loopSec.duration_s, samples: Math.round(loopSec.duration_s * sampleRate), ticks: Math.round(loopSec.duration_s * 20) } : null,
    transition_points_s: loopSec ? Array.from({ length: Math.floor(loopSec.bars / every) + 1 }, (_, k) => Number((k * every * tm.barSec).toFixed(4))) : [],
    transition_every_bars: every,
    stems: score.stems.map((s) => ({ name: s.name, instrument: s.instrument, gain: s.gain ?? -10 })),
  };
  return { outputs, metadata };
}
