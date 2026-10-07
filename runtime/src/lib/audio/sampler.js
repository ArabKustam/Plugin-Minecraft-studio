// Sampled instruments: real recorded instruments from a General MIDI SoundFont
// (SF2/SF3), rendered offline with spessasynth_core.
//
// Scores name instruments by their General MIDI names in snake_case
// ("acoustic_grand_piano", "nylon_guitar", "cello", "choir_aahs", ...) or a
// short alias ("piano", "rhodes", "guitar", "рояль"). Drum stems use a GM drum
// kit ("drum_kit", "jazz_kit", "brush_kit", ...). The legacy synthesizer
// instruments (pad, strings, bass, pluck, bell, choir, lead, drone, brass,
// drums, pulse, sub) keep their names; "synth:<name>" is an explicit alias.
//
// The default sound bank is GeneralUser GS v2.0 (S. Christian Collins), which
// is downloaded once into the user cache with audio_soundfont_install (sha256
// pinned). A custom bank can be set per score ("soundfont"), with
// MINECRAFT_STUDIO_SOUNDFONT or with the project config audio.soundfont.
import fs from 'node:fs';
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { StudioError } from '../core/fsutil.js';
import { DEFAULT_SOUNDFONT } from './soundbank.js';

export { DEFAULT_SOUNDFONT, soundfontCacheDir, resolveSoundfont, installDefaultSoundfont } from './soundbank.js';

/** General MIDI Level 1 melodic programs (index = program number). */
export const GM_PROGRAMS = [
  'acoustic_grand_piano', 'bright_acoustic_piano', 'electric_grand_piano', 'honky_tonk_piano', 'electric_piano_1', 'electric_piano_2', 'harpsichord', 'clavinet',
  'celesta', 'glockenspiel', 'music_box', 'vibraphone', 'marimba', 'xylophone', 'tubular_bells', 'dulcimer',
  'drawbar_organ', 'percussive_organ', 'rock_organ', 'church_organ', 'reed_organ', 'accordion', 'harmonica', 'tango_accordion',
  'nylon_guitar', 'steel_guitar', 'jazz_guitar', 'clean_electric_guitar', 'muted_electric_guitar', 'overdriven_guitar', 'distortion_guitar', 'guitar_harmonics',
  'acoustic_bass', 'fingered_bass', 'picked_bass', 'fretless_bass', 'slap_bass_1', 'slap_bass_2', 'synth_bass_1', 'synth_bass_2',
  'violin', 'viola', 'cello', 'contrabass', 'tremolo_strings', 'pizzicato_strings', 'orchestral_harp', 'timpani',
  'string_ensemble_1', 'string_ensemble_2', 'synth_strings_1', 'synth_strings_2', 'choir_aahs', 'voice_oohs', 'synth_voice', 'orchestra_hit',
  'trumpet', 'trombone', 'tuba', 'muted_trumpet', 'french_horn', 'brass_section', 'synth_brass_1', 'synth_brass_2',
  'soprano_sax', 'alto_sax', 'tenor_sax', 'baritone_sax', 'oboe', 'english_horn', 'bassoon', 'clarinet',
  'piccolo', 'flute', 'recorder', 'pan_flute', 'blown_bottle', 'shakuhachi', 'whistle', 'ocarina',
  'square_lead', 'sawtooth_lead', 'calliope_lead', 'chiff_lead', 'charang_lead', 'voice_lead', 'fifths_lead', 'bass_and_lead',
  'new_age_pad', 'warm_pad', 'polysynth_pad', 'choir_pad', 'bowed_pad', 'metallic_pad', 'halo_pad', 'sweep_pad',
  'rain_fx', 'soundtrack_fx', 'crystal_fx', 'atmosphere_fx', 'brightness_fx', 'goblins_fx', 'echoes_fx', 'sci_fi_fx',
  'sitar', 'banjo', 'shamisen', 'koto', 'kalimba', 'bagpipe', 'fiddle', 'shanai',
  'tinkle_bell', 'agogo', 'steel_drums', 'woodblock', 'taiko_drum', 'melodic_tom', 'synth_drum', 'reverse_cymbal',
  'guitar_fret_noise', 'breath_noise', 'seashore', 'bird_tweet', 'telephone_ring', 'helicopter', 'applause', 'gunshot',
];

/** GM drum kits (bank 128 programs). */
export const GM_KITS = { drum_kit: 0, standard_kit: 0, room_kit: 8, power_kit: 16, electronic_kit: 24, tr808_kit: 25, jazz_kit: 32, brush_kit: 40, orchestra_kit: 48 };

/** Drum names usable in kit patterns → GM percussion keys. */
export const GM_DRUM_KEYS = {
  kick: 36, kick2: 35, rim: 37, snare: 38, clap: 39, snare2: 40, tom_low: 45, tom: 47, tom_mid: 47, tom_high: 50,
  hat: 42, pedal_hat: 44, openhat: 46, crash: 49, impact: 49, ride: 51, ride_bell: 53, china: 52, splash: 55,
  tambourine: 54, cowbell: 56, vibraslap: 58, bongo_high: 60, bongo_low: 61, conga_high: 62, conga_low: 64,
  timbale: 65, agogo: 67, cabasa: 69, shaker: 70, maracas: 70, whistle: 72, guiro: 74, claves: 75, woodblock: 76,
  triangle: 81, triangle_open: 81, triangle_mute: 80, shaker_long: 82, jingle_bell: 83, chimes: 84, castanets: 85,
};

/** Short names and translations → GM program names. */
export const ALIASES = {
  piano: 'acoustic_grand_piano', grand_piano: 'acoustic_grand_piano', acoustic_piano: 'acoustic_grand_piano', bright_piano: 'bright_acoustic_piano',
  honky_tonk: 'honky_tonk_piano', rhodes: 'electric_piano_1', electric_piano: 'electric_piano_1', epiano: 'electric_piano_1', dx_piano: 'electric_piano_2',
  organ: 'drawbar_organ', guitar: 'nylon_guitar', classical_guitar: 'nylon_guitar', acoustic_guitar: 'steel_guitar', electric_guitar: 'clean_electric_guitar',
  double_bass: 'contrabass', upright_bass: 'acoustic_bass', electric_bass: 'fingered_bass', harp: 'orchestral_harp', pizzicato: 'pizzicato_strings',
  string_ensemble: 'string_ensemble_1', strings_section: 'string_ensemble_1', slow_strings: 'string_ensemble_2', horn: 'french_horn', sax: 'alto_sax',
  choir_real: 'choir_aahs', aahs: 'choir_aahs', oohs: 'voice_oohs', bells: 'tubular_bells', chimes: 'tubular_bells', steelpan: 'steel_drums',
  // Russian
  'фортепиано': 'acoustic_grand_piano', 'пианино': 'acoustic_grand_piano', 'рояль': 'acoustic_grand_piano', 'электропиано': 'electric_piano_1',
  'челеста': 'celesta', 'шкатулка': 'music_box', 'музыкальная_шкатулка': 'music_box', 'вибрафон': 'vibraphone', 'маримба': 'marimba', 'ксилофон': 'xylophone',
  'колокола': 'tubular_bells', 'колокольчики': 'glockenspiel', 'орган': 'church_organ', 'аккордеон': 'accordion', 'губная_гармошка': 'harmonica',
  'гитара': 'nylon_guitar', 'акустическая_гитара': 'steel_guitar', 'электрогитара': 'clean_electric_guitar', 'бас': 'fingered_bass', 'контрабас': 'contrabass',
  'скрипка': 'violin', 'альт': 'viola', 'виолончель': 'cello', 'струнные': 'string_ensemble_1', 'пиццикато': 'pizzicato_strings', 'арфа': 'orchestral_harp',
  'литавры': 'timpani', 'хор': 'choir_aahs', 'труба': 'trumpet', 'тромбон': 'trombone', 'туба': 'tuba', 'валторна': 'french_horn', 'медь': 'brass_section',
  'саксофон': 'alto_sax', 'гобой': 'oboe', 'фагот': 'bassoon', 'кларнет': 'clarinet', 'флейта': 'flute', 'пикколо': 'piccolo', 'блокфлейта': 'recorder',
  'пан_флейта': 'pan_flute', 'окарина': 'ocarina', 'ситар': 'sitar', 'банджо': 'banjo', 'кото': 'koto', 'калимба': 'kalimba', 'волынка': 'bagpipe',
  'стилдрам': 'steel_drums', 'тайко': 'taiko_drum', 'ударные': 'drum_kit', 'барабаны': 'drum_kit',
};

/** Resolve a score instrument name to a sampled patch, or null for synth instruments. */
export function resolveSampled(name) {
  if (typeof name !== 'string') return null;
  const raw = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw.startsWith('synth:')) return null;
  const key = raw.startsWith('gm:') ? raw.slice(3) : raw;
  if (/^\d+$/.test(key) && Number(key) < 128) return { kind: 'melodic', program: Number(key), name: GM_PROGRAMS[Number(key)] };
  const n = ALIASES[key] || key;
  if (n in GM_KITS) return { kind: 'kit', program: GM_KITS[n], name: n };
  const program = GM_PROGRAMS.indexOf(n);
  return program >= 0 ? { kind: 'melodic', program, name: n } : null;
}

/** The real-instrument catalogue for tool output and docs. */
export function instrumentCatalogue() {
  const families = ['piano', 'chromatic_percussion', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass', 'reed', 'pipe', 'synth_lead', 'synth_pad', 'synth_effects', 'ethnic', 'percussive', 'sound_effects'];
  return {
    melodic: families.map((family, f) => ({ family, instruments: GM_PROGRAMS.slice(f * 8, f * 8 + 8) })),
    drum_kits: Object.keys(GM_KITS),
    drum_names: Object.keys(GM_DRUM_KEYS),
    aliases: ALIASES,
  };
}

const bankCache = new Map();
function loadBank(file) {
  if (!fs.existsSync(file)) {
    throw new StudioError('E_SOUNDFONT', `No sound bank at ${file}. Real instruments need a General MIDI SoundFont: run audio_soundfont_install (downloads ${DEFAULT_SOUNDFONT.name}, ${(DEFAULT_SOUNDFONT.bytes / 1048576).toFixed(0)} MB, once per computer) or set "soundfont" in the score / MINECRAFT_STUDIO_SOUNDFONT to your own .sf2/.sf3.`);
  }
  const key = `${file}:${fs.statSync(file).mtimeMs}`;
  if (!bankCache.has(key)) {
    const buf = fs.readFileSync(file);
    bankCache.set(key, SoundBankLoader.fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return bankCache.get(key);
}

// ------------------------------------------------------------------ rendering

const BLOCK = 64;
/** SoundFont voices come out ~12 dB below the synth voices; this keeps stem gains on one scale. */
export const SAMPLED_MAKEUP_DB = 12;

/**
 * Render one stem with a sampled instrument.
 * notes: [{ start_s, dur_s, midi, vel }] (melodic) or [{ start_s, key, vel }] (kit)
 * Returns { left, right } of `length` samples (the instrument's own stereo image).
 */
export function renderSampledStem(patch, notes, { length, sampleRate, soundfont, transpose = 0, pedal = false }) {
  const bank = loadBank(soundfont);
  const synth = new SpessaSynthProcessor(sampleRate, { effectsEnabled: false, eventsEnabled: false });
  synth.soundBankManager.addSoundBank(bank, 'studio');
  const ch = patch.kind === 'kit' ? 9 : 0;
  synth.programChange(ch, patch.program);
  synth.controllerChange(ch, 7, 127); // channel volume: levels are set by the stem gain
  synth.controllerChange(ch, 11, 127);
  synth.controllerChange(ch, 91, 0); // no built-in reverb/chorus send: score effects handle space
  synth.controllerChange(ch, 93, 0);
  const whole = Math.trunc(transpose);
  const frac = transpose - whole;
  if (frac) synth.pitchWheel(ch, Math.max(0, Math.min(16383, Math.round(8192 + (frac / 2) * 8192))));
  if (pedal) synth.controllerChange(ch, 64, 127);
  const events = [];
  for (const n of notes) {
    const key = patch.kind === 'kit' ? n.key : n.midi + whole;
    if (key < 0 || key > 127) continue;
    const at = Math.max(0, Math.round(n.start_s * sampleRate));
    events.push({ at, on: true, key, vel: Math.max(1, Math.min(127, Math.round(n.vel * 127))) });
    if (patch.kind !== 'kit') events.push({ at: Math.max(at + 1, Math.round((n.start_s + n.dur_s) * sampleRate)), on: false, key });
  }
  // note-offs first at equal times so repeated notes retrigger cleanly
  events.sort((a, b) => a.at - b.at || (a.on === b.on ? 0 : a.on ? 1 : -1));
  const left = new Float32Array(length), right = new Float32Array(length);
  let e = 0;
  for (let s = 0; s < length; s += BLOCK) {
    const end = Math.min(length, s + BLOCK);
    while (e < events.length && events[e].at < end) {
      const ev = events[e++];
      if (ev.on) synth.noteOn(ch, ev.key, ev.vel); else synth.noteOff(ch, ev.key);
    }
    synth.process(left, right, s, end - s);
  }
  const makeup = 10 ** (SAMPLED_MAKEUP_DB / 20);
  for (let i = 0; i < length; i++) { left[i] *= makeup; right[i] *= makeup; }
  return { left, right };
}
