// Physical SFX models: voice, modal, scrape, breakpoints, repeats, ceiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRecipe, expandRepeats, validateRecipe } from '../../runtime/src/lib/audio/synth.js';
import { paramFn } from '../../runtime/src/lib/audio/dsp.js';
import { expandHits } from '../../runtime/src/lib/audio/sfxmodels.js';

const sr = 22050;
const peakDb = (a) => { let p = 0; for (const c of a.channels) for (const x of c) p = Math.max(p, Math.abs(x)); return 20 * Math.log10(p); };
const finite = (a) => a.channels.every((c) => c.every(Number.isFinite));

test('breakpoint parameters interpolate and hold', () => {
  const f = paramFn({ points: [[0, 100], [1, 200], [2, 150]] }, 3);
  assert.equal(f(-1), 100);
  assert.equal(f(0.5), 150);
  assert.equal(f(1.5), 175);
  assert.equal(f(5), 150);
});

test('voice, modal and scrape layers render finite audio', () => {
  for (const layer of [
    { type: 'voice', pitch: { points: [[0, 180], [0.5, 420]] }, vowel: [[0, 'a'], [1, 'o']], strain: 0.7, rough: 0.4 },
    { type: 'voice', pitch: 220, pulses: { rate: 6, duty: 0.4, jitter: 0.3, pitch_jitter: 2, accent: 0.4 }, breath: 0.4 },
    { type: 'modal', material: 'glass', freq: 2200, decay: 0.3, hits: { count: 20, start: 0, end: 0.6 }, freq_spread: 0.6 },
    { type: 'scrape', material: 'metal', freq: 700, speed: { from: 50, to: 250 }, squeal: 0.6 },
  ]) {
    assert.deepEqual(validateRecipe({ duration: 1, layers: [layer] }), []);
    const a = renderRecipe({ duration: 1, sample_rate: sr, layers: [layer] });
    assert.ok(finite(a), layer.type);
    assert.ok(peakDb(a) > -12, `${layer.type} is audible`);
  }
});

test('the voice pitch contour is followed', () => {
  const a = renderRecipe({ duration: 1, sample_rate: sr, layers: [{ type: 'voice', pitch: { points: [[0, 110], [0.5, 110], [0.5001, 330], [1, 330]] }, vowel: 'a', breath: 0, jitter: 0 }], normalize: { peak: -3 } });
  const c = a.channels[0];
  // fundamental by autocorrelation (formants dominate zero crossings, so they can't be used)
  const f0 = (t0) => {
    const s = Math.round(t0 * sr), w = Math.round(0.08 * sr);
    let best = 0, lag = 0;
    for (let L = Math.round(sr / 500); L <= Math.round(sr / 80); L++) {
      let acc = 0;
      for (let i = 0; i < w; i++) acc += c[s + i] * c[s + i + L];
      if (acc > best) { best = acc; lag = L; }
    }
    return sr / lag;
  };
  const low = f0(0.2), high = f0(0.7);
  assert.ok(Math.abs(low - 110) < 12, `first half ≈ 110 Hz (${low.toFixed(1)})`);
  assert.ok(Math.abs(high - 330) < 30, `second half ≈ 330 Hz (${high.toFixed(1)})`);
});

test('modal hits are placed in time', () => {
  const a = renderRecipe({ duration: 1.2, sample_rate: sr, layers: [{ type: 'modal', material: 'pipe', freq: 400, decay: 0.05, hits: [0, 0.6] }], normalize: { peak: -3 } });
  const c = a.channels[0];
  const energy = (t0, t1) => c.slice(Math.round(t0 * sr), Math.round(t1 * sr)).reduce((s, x) => s + x * x, 0);
  assert.ok(energy(0.6, 0.7) > energy(0.45, 0.55) * 10, 'second hit at 0.6 s');
  const hits = expandHits({ count: 10, start: 0.1, end: 0.5 }, 1, 1);
  assert.equal(hits.length, 10);
  assert.ok(hits.every((h) => h.t >= 0.1 && h.t <= 0.5));
});

test('repeat expands layers with varied seeds, times and pitch', () => {
  const out = expandRepeats([{ type: 'impact', freq: 60, repeat: { count: 4, interval: 0.5, pitch_jitter: 2 } }, { type: 'click' }]);
  assert.equal(out.length, 5);
  assert.deepEqual(out.slice(0, 4).map((l) => l.start), [0, 0.5, 1, 1.5]);
  assert.equal(new Set(out.slice(0, 4).map((l) => l.seed)).size, 4);
  assert.ok(out.slice(0, 4).some((l) => l.freq !== 60), 'pitch varies');
});

test('normalize ceiling leaves headroom for lossy encoding', () => {
  const a = renderRecipe({ duration: 0.5, sample_rate: sr, layers: [{ type: 'impact', freq: 60, decay: 0.2, noise: 1 }], normalize: { lufs: -8, ceiling: -4 } });
  assert.ok(peakDb(a) <= -3.9, `peak ${peakDb(a).toFixed(2)} dBFS`);
});
