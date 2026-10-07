// Sampled (SoundFont) instruments in the music renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSampled, GM_PROGRAMS, instrumentCatalogue, resolveSoundfont } from '../../runtime/src/lib/audio/sampler.js';
import { validateScore, stemEngine, renderScore } from '../../runtime/src/lib/audio/music.js';

test('General MIDI names, aliases and kits resolve to programs', () => {
  assert.equal(GM_PROGRAMS.length, 128);
  assert.deepEqual(resolveSampled('acoustic_grand_piano'), { kind: 'melodic', program: 0, name: 'acoustic_grand_piano' });
  assert.equal(resolveSampled('piano').program, 0);
  assert.equal(resolveSampled('Electric Piano 1').program, 4);
  assert.equal(resolveSampled('celesta').program, 8);
  assert.equal(resolveSampled('cello').program, 42);
  assert.equal(resolveSampled('choir_aahs').program, 52);
  assert.equal(resolveSampled('рояль').program, 0);
  assert.equal(resolveSampled('скрипка').program, 40);
  assert.equal(resolveSampled('gm:73').name, 'flute');
  assert.deepEqual(resolveSampled('jazz_kit'), { kind: 'kit', program: 32, name: 'jazz_kit' });
  assert.equal(resolveSampled('synth:pad'), null);
  assert.equal(resolveSampled('nonsense'), null);
  assert.equal(instrumentCatalogue().melodic.flatMap((f) => f.instruments).length, 128);
});

test('synth voices keep their names; real instruments are sampled', () => {
  assert.equal(stemEngine({ instrument: 'pad' }).engine, 'synth');
  assert.equal(stemEngine({ instrument: 'strings' }).engine, 'synth');
  assert.equal(stemEngine({ instrument: 'synth:pluck' }).instrument, 'pluck');
  assert.equal(stemEngine({ instrument: 'string_ensemble_1' }).engine, 'sampled');
  assert.equal(stemEngine({ instrument: 'nope' }), null);
  const base = { bpm: 90, sections: [{ name: 'loop', bars: 1, loop: true }] };
  assert.deepEqual(validateScore({ ...base, stems: [{ name: 'p', instrument: 'piano', parts: { loop: 'C4:4' } }] }), []);
  assert.match(validateScore({ ...base, stems: [{ name: 'p', instrument: 'pianno', parts: { loop: 'C4:4' } }] })[0], /unknown instrument pianno/);
  assert.match(validateScore({ ...base, stems: [{ name: 'd', instrument: 'drum_kit', parts: { loop: { kik: 'x...' } } }] })[0], /unknown drum kik/);
});

test('synth-only scores render without a sound bank', () => {
  const { outputs, metadata } = renderScore({ bpm: 120, sections: [{ name: 'loop', bars: 1, loop: true }], stems: [{ name: 'p', instrument: 'pad', parts: { loop: '[C4 E4 G4]:4' } }] }, { sampleRate: 22050 });
  assert.equal(outputs[0].audio.channels[0].length, 44100);
  assert.equal(metadata.stems[0].engine, 'synth');
  assert.equal(metadata.loop.ticks_exact, 40);
});

test('a sampled piano renders real stereo audio (needs the sound bank)', (t) => {
  const sf = resolveSoundfont({});
  if (!sf.exists) return t.skip('sound bank not installed (audio_soundfont_install)');
  const score = {
    bpm: 120, sections: [{ name: 'loop', bars: 1, loop: true }],
    stems: [
      { name: 'piano', instrument: 'acoustic_grand_piano', pan: -0.3, parts: { loop: '[C4 E4 G4]:2 [F4 A4 C5]:2' } },
      { name: 'kit', instrument: 'drum_kit', parts: { loop: { kick: 'x...x...', hat: '..x...x.' } } },
    ],
  };
  const { outputs, metadata } = renderScore(score, { sampleRate: 22050, soundfont: sf.path });
  const [l, r] = outputs[0].audio.channels;
  let peak = 0, diff = 0;
  for (let i = 0; i < l.length; i++) { peak = Math.max(peak, Math.abs(l[i])); diff += Math.abs(l[i] - r[i]); }
  assert.ok(peak > 0.05, `audible (peak ${peak})`);
  assert.ok(diff / l.length > 1e-4, 'stereo image');
  assert.equal(metadata.stems[0].gm, 'acoustic_grand_piano');
  assert.equal(metadata.stems[1].kit, true);
});
