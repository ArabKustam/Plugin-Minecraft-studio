// studio-audio MCP server: layered SFX design, processing, analysis/QA,
// adaptive music with stems & transition metadata, voice direction with
// pronunciation control, and Minecraft export (Ogg Vorbis + sounds.json).
import fs from 'node:fs';
import path from 'node:path';
import { createServer, tool, start, z, assetInput, registerOutput, requireOneOf } from './common.js';
import { renderRecipe, RECIPE_PRESETS, validateRecipe, normalizeAudio } from '../lib/audio/synth.js';
import { renderScore, validateScore, INSTRUMENTS, stemEngine } from '../lib/audio/music.js';
import { instrumentCatalogue, resolveSoundfont, installDefaultSoundfont, DEFAULT_SOUNDFONT } from '../lib/audio/sampler.js';
import { writeWav, toMono } from '../lib/audio/wav.js';
import { analyzeAudio, auditAudioFile } from '../lib/audio/analyze.js';
import { decodeAny, encodeOgg, processFile, findFfmpeg, convertFile } from '../lib/audio/ffmpeg.js';
import { applyEffects } from '../lib/audio/dsp.js';
import { saveVoiceProfile, loadVoiceProfile, addPronunciation, prepareText, loadPronunciation } from '../lib/audio/voice.js';
import { resolveProvider, SFX_PROVIDERS, MUSIC_PROVIDERS } from '../lib/providers/index.js';
import { upsertSoundEvent } from '../lib/minecraft/resourcepack.js';
import { readJson, writeJson, slugify, StudioError, ensureDir } from '../lib/core/fsutil.js';

const server = createServer('studio-audio', 'Minecraft Studio audio. Design SFX as layered recipes (reproducible), music as scores with intro/loop/outro sections, stems, BPM/key/bar metadata and transition points, voice lines from persistent voice profiles with a pronunciation dictionary. Always audit (audio_audit) before QA approval; positional sounds must be mono Ogg Vorbis. Paid providers (ElevenLabs) require confirm_cost=true after the user agreed to spend credits.');

/** Lossless master format: FLAC when FFmpeg is available (≈6× smaller than WAV), else WAV. */
function masterExt(studio) {
  const want = studio.isInitialized() ? studio.config().audio.master_format : 'flac';
  return want === 'flac' && findFfmpeg() ? 'flac' : 'wav';
}
function masterTarget(studio, output) {
  return /\.(wav|flac)$/i.test(output) ? output.replace(/\.(wav|flac)$/i, `.${masterExt(studio)}`) : `${output.replace(/\.(ogg|mp3)$/i, '')}.${masterExt(studio)}`;
}
/** Write an Audio object to .wav or .flac. */
function writeMaster(abs, audio) {
  if (/\.flac$/i.test(abs)) {
    const tmp = `${abs}.${process.pid}.tmp.wav`;
    writeWav(tmp, audio);
    try { convertFile(tmp, abs); } finally { fs.rmSync(tmp, { force: true }); }
  } else writeWav(abs, audio);
  return abs;
}

/** Write audio as a lossless master and optionally OGG for Minecraft. */
function writeOutputs(studio, audio, output, { ogg = null, mono = false } = {}) {
  const files = [];
  const master = masterTarget(studio, output);
  const a = mono ? toMono(audio) : audio;
  writeMaster(studio.abs(master), a);
  files.push(master);
  if (ogg) { encodeOgg(a, studio.abs(ogg)); files.push(ogg); }
  return files;
}

function costGate(studio, provider, a, estimate) {
  if (!a.confirm_cost) {
    throw new StudioError('E_COST', `${provider} is a paid provider (${estimate.note || 'uses credits'}). Ask the user to confirm, then call again with confirm_cost=true. Prefer local providers or editing existing assets when possible.`);
  }
  const used = studio.isInitialized() ? studio.usage().entries.filter((e) => e.asset === a.asset?.id).length : 0;
  const max = studio.isInitialized() ? studio.config().costs.max_generations_per_asset : 6;
  if (used >= max) throw new StudioError('E_COST', `Generation limit for asset ${a.asset?.id} reached (${used}/${max}). Improve the existing result locally (audio_process) or raise costs.max_generations_per_asset with the user's consent.`);
}

// ------------------------------------------------------------------ SFX
tool(server, 'audio_sfx_presets', { title: 'SFX recipe presets', capability: 'read', description: 'Starting recipes (button, relay, hydraulic, engine_loop, siren, alarm_beep, power_up, power_down, explosion, ui_confirm, ambience_hum, growl) and the recipe format reference.' },
  async () => ({
    presets: RECIPE_PRESETS,
    format: { layer_types: ['osc (wave sine|square|saw|triangle|pulse25, freq const|{from,to,curve}|{center,depth,rate,shape}, harmonics[], voices, detune)', 'noise (color white|pink|brown)', 'fm (carrier, ratio, index)', 'chirp', 'click (freq, decay)', 'impact (freq, drop, decay, noise)', 'sample (file, rate)'], layer_fields: ['start', 'duration', 'gain (dB)', 'envelope {attack,decay,sustain,release}', 'filter {type,freq,q}', 'filters[]', 'effects[]', 'pan'], effects: ['lowpass', 'highpass', 'bandpass', 'notch', 'eq{bands}', 'reverb{room,damp,mix,predelay}', 'compress', 'limit', 'distortion{amount}', 'bitcrush', 'tremolo', 'gain', 'fade', 'radio', 'pa_speaker', 'delay', 'loop'], top_level: ['duration', 'sample_rate', 'channels', 'layers', 'effects', 'normalize {lufs|peak}', 'loop', 'loop_crossfade', 'tail'] },
  }));

tool(server, 'audio_sfx_render', {
  title: 'Render SFX recipe', capability: 'write',
  description: 'Render a layered SFX recipe (or a preset name with overrides) locally to WAV (+ Ogg Vorbis when ogg_output is given). Saves the recipe as reproducible source, audits the result and optionally registers the asset.',
  input: {
    recipe: z.record(z.string(), z.any()).optional(), preset: z.string().optional(), overrides: z.record(z.string(), z.any()).optional(),
    output: z.string().describe('Project-relative WAV master path, e.g. audio/sfx/reactor_button.wav'),
    ogg_output: z.string().optional().describe('Project-relative Ogg path in the resource pack, e.g. resourcepack/assets/ns/sounds/reactor/button.ogg'),
    asset: assetInput,
  },
}, async (a, { studio }) => {
  requireOneOf(a, ['recipe', 'preset']);
  let recipe = a.recipe;
  if (!recipe) { if (!RECIPE_PRESETS[a.preset]) throw new StudioError('E_INPUT', `Unknown preset ${a.preset}`); recipe = { ...structuredClone(RECIPE_PRESETS[a.preset]), ...(a.overrides || {}) }; }
  const audio = renderRecipe(recipe, { baseDir: studio.root });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output, mono: (recipe.channels || 1) === 1 });
  const audit = auditAudioFile(studio.abs(a.ogg_output || files[0]), { role: recipe.loop && /ambi|hum/.test(a.output) ? 'ambience' : 'sfx', loop: !!recipe.loop, targetLufs: recipe.normalize?.lufs });
  let src = null;
  if (a.asset) { const sf = studio.p('sources', a.asset.id, 'recipe.json'); writeJson(sf, recipe); src = studio.rel(sf); }
  const reg = registerOutput(studio, a.asset, { type: 'sfx', files, source: { provider: 'local-synth', preset: a.preset || null, source_files: src ? [src] : [] }, metadata: { duration: audit.analysis.duration, lufs: audit.analysis.lufs, loop: !!recipe.loop, waveform: audit.waveform } });
  return { files, audit: { verdict: audit.verdict, checks: audit.checks, analysis: audit.analysis }, asset: reg };
});

tool(server, 'audio_sfx_generate_ai', {
  title: 'Generate SFX with ElevenLabs', capability: 'publish',
  description: 'Text-to-sound-effect via ElevenLabs (paid). Requires confirm_cost=true after user consent. Output is converted to WAV (+ optional Ogg), audited, usage recorded.',
  input: { prompt: z.string().describe('English description of the sound'), duration_seconds: z.number().min(0.5).max(30).optional(), loop: z.boolean().optional(), prompt_influence: z.number().min(0).max(1).optional(), output: z.string(), ogg_output: z.string().optional(), mono: z.boolean().optional(), confirm_cost: z.boolean().optional(), asset: assetInput },
}, async (a, { studio }) => {
  const p = resolveProvider('sfx', 'elevenlabs');
  costGate(studio, 'ElevenLabs SFX', a, p.estimateCost(a));
  const wav = studio.abs(`${a.output.replace(/\.(wav|flac|ogg|mp3)$/i, '')}.provider.wav`);
  const meta = await SFX_PROVIDERS.elevenlabs.generate({ prompt: a.prompt, duration_seconds: a.duration_seconds, loop: a.loop, prompt_influence: a.prompt_influence, outWav: wav });
  if (studio.isInitialized()) studio.recordUsage({ provider: 'elevenlabs', operation: 'sound-generation', units: 1, unit: 'generation', asset: a.asset?.id || null, agent: a.asset?.agent || 'sfx-designer' });
  let audio = decodeAny(wav);
  fs.rmSync(wav, { force: true });
  if (a.mono !== false) audio = toMono(audio);
  normalizeAudio(audio, { lufs: -16 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  const audit = auditAudioFile(studio.abs(a.ogg_output || files[0]), { role: 'sfx', loop: !!a.loop });
  const reg = registerOutput(studio, a.asset, { type: 'sfx', files, source: { provider: 'elevenlabs', prompt: a.prompt, parameters: { duration_seconds: a.duration_seconds, loop: a.loop, prompt_influence: a.prompt_influence }, ...meta } });
  return { files, audit: { verdict: audit.verdict, checks: audit.checks }, asset: reg };
});

// ------------------------------------------------------------------ analysis & processing
tool(server, 'audio_analyze', {
  title: 'Analyze audio', capability: 'read',
  description: 'Duration, sample rate, channels, peak, RMS, integrated LUFS, clipping, leading/trailing silence, stereo width, waveform envelope and optional loop-seam check.',
  input: { path: z.string(), loop: z.boolean().optional(), waveform_points: z.number().int().optional() },
}, async (a, { studio }) => analyzeAudio(decodeAny(studio.abs(a.path)), { loopCheck: !!a.loop, waveformPoints: a.waveform_points || 120 }));

tool(server, 'audio_audit', {
  title: 'Audio QA audit', capability: 'read',
  description: 'Minecraft-oriented QA: Ogg Vorbis codec, mono for positional sounds, clipping, headroom, loudness vs role target (sfx -16, music -20, voice -18, ambience -24 LUFS), leading silence, loop seam, file size.',
  input: { path: z.string(), role: z.enum(['sfx', 'music', 'voice', 'ambience']).optional(), loop: z.boolean().optional(), positional: z.boolean().optional(), target_lufs: z.number().optional() },
}, async (a, { studio }) => { const r = auditAudioFile(studio.abs(a.path), { role: a.role || 'sfx', loop: !!a.loop, positional: a.positional !== false, targetLufs: a.target_lufs }); delete r.waveform; return r; });

tool(server, 'audio_process', {
  title: 'Process audio', capability: 'write',
  description: 'Apply a processing chain. engine "ffmpeg": loudnorm, highpass, lowpass, eq, compress, limit, reverb, distortion, radio, pa_speaker, pitch{semitones}, tempo{factor}, trim{start,end}, fade{in,out}, mono, silence_trim, resample. engine "js": the studio DSP effects (reverb, compress, limit, eq, radio, pa_speaker, loop, …).',
  input: { input: z.string(), output: z.string(), engine: z.enum(['ffmpeg', 'js']).optional(), steps: z.array(z.record(z.string(), z.any())), asset: assetInput },
}, async (a, { studio }) => {
  const engine = a.engine || (findFfmpeg() ? 'ffmpeg' : 'js');
  let info;
  if (engine === 'ffmpeg') info = processFile(studio.abs(a.input), studio.abs(a.output), a.steps);
  else {
    const audio = decodeAny(studio.abs(a.input));
    audio.channels = audio.channels.map((c) => applyEffects(c, audio.sampleRate, a.steps));
    if (a.output.endsWith('.ogg')) encodeOgg(audio, studio.abs(a.output)); else writeMaster(studio.abs(a.output), audio);
    info = { output: a.output };
  }
  const reg = registerOutput(studio, a.asset, { type: 'sfx', files: [a.output], source: { provider: `process-${engine}`, source_files: [a.input], parameters: { steps: a.steps } } });
  return { output: a.output, engine, filter: info.filter, analysis: (({ waveform, ...rest }) => rest)(analyzeAudio(decodeAny(studio.abs(a.output)))), asset: reg };
});

// ------------------------------------------------------------------ music
tool(server, 'audio_music_render', {
  title: 'Render adaptive music cue', capability: 'write',
  description: `Render a score (bpm, meter, key, sections intro/loop/outro/stinger, stems) into section mixes, per-stem loops and metadata (BPM, bars, loop boundaries, transition points). Writes music/source, music/stems, music/rendered, music/metadata under out_dir; optional Ogg export into the pack. Stem instruments: real sampled instruments by General MIDI name (acoustic_grand_piano, electric_piano_1, celesta, music_box, vibraphone, marimba, nylon_guitar, violin, cello, string_ensemble_1, pizzicato_strings, orchestral_harp, choir_aahs, flute, clarinet, french_horn, kalimba, ... full list: audio_instruments; aliases like piano/rhodes/guitar; drum kits drum_kit/jazz_kit/brush_kit/orchestra_kit with step patterns) or synth voices ${INSTRUMENTS.join(', ')} (synth:<name>). Sampled stems support pan, transpose (fractional = detune), legato, pedal (sustain) and effects. Real instruments need the sound bank (audio_soundfont_install, once per computer).`,
  input: {
    score: z.record(z.string(), z.any()).optional(), score_path: z.string().optional(),
    out_dir: z.string().describe('Project-relative directory, e.g. audio/music'),
    ogg_dir: z.string().optional().describe('Resource-pack sounds directory for Ogg exports, e.g. resourcepack/assets/ns/sounds/music'),
    lufs: z.number().optional(), asset: assetInput,
    full_mix: z.boolean().optional().describe('Also render the whole arrangement as one continuous track <title>_full (default: true for songs without a loop section). Tails ring across section borders.'),
    loop_repeats: z.number().int().min(1).max(8).optional().describe('How many times the loop section plays inside the full mix (default 1).'),
    ogg_stems: z.boolean().optional().describe('Also export per-stem loops as Ogg into ogg_dir (default true). Set false when the game will not layer stems, to keep the pack small.'),
  },
}, async (a, { studio }) => {
  requireOneOf(a, ['score', 'score_path']);
  const score = a.score || readJson(studio.abs(a.score_path));
  const problems = validateScore(score);
  if (problems.length) throw new StudioError('E_SCORE', problems.join('; '));
  const title = slugify(score.title || 'cue');
  const sampled = score.stems.some((s) => stemEngine(s)?.engine === 'sampled');
  const sf = sampled ? resolveSoundfont({ scorePath: score.soundfont, configPath: studio.isInitialized() ? studio.config().audio?.soundfont : null, root: studio.root }) : null;
  const { outputs, metadata } = renderScore(score, { lufs: a.lufs ?? -20, soundfont: sf?.path, fullMix: a.full_mix ?? null, loopRepeats: a.loop_repeats ?? null });
  if (sf) metadata.soundfont = { file: path.basename(sf.path), source: sf.source, ...(sf.source === 'default' ? { name: DEFAULT_SOUNDFONT.name, sha256: DEFAULT_SOUNDFONT.sha256 } : {}) };
  const base = a.out_dir.replace(/\/$/, '');
  const sourceFile = `${base}/source/${title}.score.json`;
  writeJson(studio.abs(sourceFile), score);
  const files = [{ path: sourceFile, role: 'source' }];
  metadata.files = { source: sourceFile, sections: {}, stems: {}, ogg: {} };
  const stemSuffix = (o) => (o.section === 'full' ? 'full' : o.section);
  for (const o of outputs) {
    const name = o.kind === 'section' ? `${title}_${o.section}` : o.kind === 'full' ? `${title}_full` : `${title}_${stemSuffix(o)}_${slugify(o.stem)}`;
    const wav = o.kind === 'stem' ? `${base}/stems/${name}.${masterExt(studio)}` : `${base}/rendered/${name}.${masterExt(studio)}`;
    writeMaster(studio.abs(wav), o.audio);
    files.push({ path: wav, role: o.kind });
    if (o.kind === 'section') metadata.files.sections[o.section] = wav; else if (o.kind === 'full') metadata.files.full = wav; else metadata.files.stems[o.stem] = wav;
    if (a.ogg_dir && (o.kind !== 'stem' || a.ogg_stems !== false)) {
      const ogg = `${a.ogg_dir.replace(/\/$/, '')}/${name}.ogg`;
      encodeOgg(o.audio, studio.abs(ogg));
      files.push({ path: ogg, role: 'minecraft' });
      metadata.files.ogg[name] = ogg;
    }
  }
  const metaFile = `${base}/metadata/${title}.json`;
  writeJson(studio.abs(metaFile), metadata);
  files.push({ path: metaFile, role: 'metadata' });
  const loopWav = metadata.loop ? metadata.files.sections[metadata.loop.section] : (metadata.files.full || metadata.files.sections[score.sections[0].name]);
  const loopAudit = auditAudioFile(studio.abs(loopWav), { role: 'music', loop: !!metadata.loop, positional: false, targetLufs: a.lufs ?? -20 });
  const reg = registerOutput(studio, a.asset, { type: 'music', files, source: { provider: sampled ? 'local-composer+soundfont' : 'local-composer', format: 'minecraft-studio-score/1', source_files: [sourceFile], ...(metadata.soundfont ? { soundfont: metadata.soundfont } : {}) }, metadata: { bpm: metadata.bpm, key: metadata.key, meter: metadata.meter, state: metadata.state, loop: metadata.loop, transition_points_s: metadata.transition_points_s, stems: metadata.stems, sections: metadata.sections, waveform: loopAudit.waveform, metadata_file: metaFile } });
  return { metadata_file: metaFile, files: files.map((f) => f.path), ...(metadata.full_mix ? { full_mix: { file: metadata.files.full, ...metadata.full_mix } } : {}), loop: metadata.loop, transition_points_s: metadata.transition_points_s, loop_audit: { verdict: loopAudit.verdict, checks: loopAudit.checks }, asset: reg };
});

tool(server, 'audio_instruments', {
  title: 'List music instruments', capability: 'read',
  description: 'Real sampled instruments (128 General MIDI programs by family, drum kits, drum names, aliases incl. Russian) and synth voices usable in audio_music_render scores, plus whether the sound bank is installed.',
}, async (_a, { studio }) => {
  const sf = resolveSoundfont({ configPath: studio.isInitialized() ? studio.config().audio?.soundfont : null, root: studio.root });
  return {
    soundfont: { path: sf.path, source: sf.source, installed: sf.exists, ...(sf.source === 'default' ? { name: DEFAULT_SOUNDFONT.name, size_mb: Math.round(DEFAULT_SOUNDFONT.bytes / 1048576), install_with: 'audio_soundfont_install' } : {}) },
    sampled: instrumentCatalogue(),
    synth_voices: INSTRUMENTS.map((n) => `synth:${n}`),
    usage: 'stem.instrument = General MIDI name or alias; drum kits take step-pattern objects {kick: "x...", snare: "....x...", hat: "x.x.x.x."}',
  };
});

tool(server, 'audio_soundfont_install', {
  title: 'Install the instrument sound bank', capability: 'publish',
  description: `Download the default General MIDI sound bank (${DEFAULT_SOUNDFONT.name}, ${Math.round(DEFAULT_SOUNDFONT.bytes / 1048576)} MB, free for commercial music) once per computer into the user cache, verifying its sha256. Needed for real instruments in audio_music_render. Tell the user about the download before calling.`,
  input: { force: z.boolean().optional() },
}, async (a) => installDefaultSoundfont({ force: !!a.force }));

tool(server, 'audio_music_generate_ai', {
  title: 'Generate music with ElevenLabs', capability: 'publish',
  description: 'Prompt-based music generation via ElevenLabs (paid; plan-dependent). Requires confirm_cost=true. Use for reference/inspiration or one-off cues; adaptive cues should be scored with audio_music_render.',
  input: { prompt: z.string(), music_length_ms: z.number().int().min(3000).max(600000).optional(), force_instrumental: z.boolean().optional(), output: z.string(), ogg_output: z.string().optional(), confirm_cost: z.boolean().optional(), asset: assetInput },
}, async (a, { studio }) => {
  const p = resolveProvider('music', 'elevenlabs');
  costGate(studio, 'ElevenLabs music', a, p.estimateCost(a));
  const wav = studio.abs(`${a.output.replace(/\.(wav|flac|ogg|mp3)$/i, '')}.provider.wav`);
  const meta = await MUSIC_PROVIDERS.elevenlabs.generate({ prompt: a.prompt, music_length_ms: a.music_length_ms, force_instrumental: a.force_instrumental !== false, outWav: wav });
  if (studio.isInitialized()) studio.recordUsage({ provider: 'elevenlabs', operation: 'music', units: a.music_length_ms || 30000, unit: 'ms', asset: a.asset?.id || null, agent: 'composer' });
  const audio = decodeAny(wav);
  fs.rmSync(wav, { force: true });
  normalizeAudio(audio, { lufs: -20 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  const reg = registerOutput(studio, a.asset, { type: 'music', files, source: { provider: 'elevenlabs', prompt: a.prompt, ...meta } });
  return { files, asset: reg };
});

// ------------------------------------------------------------------ voice
tool(server, 'audio_voice_profile_save', {
  title: 'Save voice profile', capability: 'write', needsInit: true,
  description: 'Create/update a persistent voice persona: language, character traits, pace, pitch, direction notes, provider settings (elevenlabs {voice_id, model_id, voice_settings, seed}; system {espeak_voice}), processing chain (e.g. pa_speaker, compress) and loudness.',
  input: { profile: z.record(z.string(), z.any()) },
}, async (a, { studio }) => saveVoiceProfile(studio, a.profile));

tool(server, 'audio_voice_profile_get', { title: 'Get voice profile', capability: 'read', needsInit: true, description: 'Read a voice profile.', input: { id: z.string() } },
  async (a, { studio }) => loadVoiceProfile(studio, a.id));

tool(server, 'audio_pronunciation_add', {
  title: 'Add pronunciation rule', capability: 'write', needsInit: true,
  description: 'Project pronunciation dictionary entry: {term, say?: replacement text, stress?: word with stressed vowel UPPER-CASE (e.g. "реАктор"), language?, note?}. Applied to every voice line.',
  input: { term: z.string(), say: z.string().optional(), stress: z.string().optional(), language: z.string().optional(), note: z.string().optional() },
}, async (a, { studio }) => addPronunciation(studio, a));

tool(server, 'audio_pronunciation_preview', {
  title: 'Preview prepared voice text', capability: 'read', needsInit: true,
  description: 'Show exactly what text a provider will receive after dictionary, stress and number expansion.',
  input: { text: z.string(), language: z.string().optional(), provider: z.string().optional() },
}, async (a, { studio }) => ({ ...prepareText(studio, a.text, { language: a.language || 'en', provider: a.provider || 'elevenlabs' }), dictionary_size: loadPronunciation(studio).entries.length }));

tool(server, 'audio_voice_line', {
  title: 'Synthesize voice line', capability: 'write', needsInit: true,
  description: 'Synthesize a line with a voice profile (provider auto: ElevenLabs if configured — paid, needs confirm_cost=true —, else system TTS, else mock), apply the profile processing chain and loudness, export WAV/Ogg and register a voice asset with the original and prepared text.',
  input: {
    line_id: z.string(), text: z.string(), profile: z.string(), output: z.string().describe('WAV master path'), ogg_output: z.string().optional(),
    provider: z.enum(['auto', 'elevenlabs', 'system', 'mock']).optional(), previous_text: z.string().optional(), next_text: z.string().optional(),
    confirm_cost: z.boolean().optional(), asset: assetInput,
  },
}, async (a, { studio }) => {
  const profile = loadVoiceProfile(studio, a.profile);
  const preferred = a.provider || studio.config().providers.voice || 'auto';
  const p = resolveProvider('voice', preferred);
  if (p.paid) costGate(studio, `ElevenLabs TTS (${[...a.text].length} chars)`, a, p.estimateCost(a));
  const prepared = prepareText(studio, a.text, { language: profile.language, provider: p.id });
  const raw = path.join(ensureDir(studio.p('sources', `voice_${slugify(a.line_id)}`)), 'raw.wav');
  const meta = await p.synthesize({ text: prepared.text, profile, outWav: raw, previousText: a.previous_text, nextText: a.next_text });
  if (p.paid) studio.recordUsage({ provider: p.id, operation: 'tts', units: [...prepared.text].length, unit: 'characters', asset: a.asset?.id || null, agent: 'voice-director' });
  let audio = toMono(decodeAny(raw, { sampleRate: 48000 }));
  const chain = [{ type: 'trim_silence', thresholdDb: -45, pad: 0.04 }, ...(profile.processing || [])];
  if (profile.pitch_semitones && findFfmpeg()) {
    const tmp = `${raw}.pitched.wav`;
    processFile(raw, tmp, [{ type: 'pitch', semitones: profile.pitch_semitones, sample_rate: audio.sampleRate }]);
    audio = toMono(decodeAny(tmp)); fs.rmSync(tmp, { force: true });
  }
  audio.channels = audio.channels.map((c) => applyEffects(c, audio.sampleRate, chain));
  normalizeAudio(audio, { lufs: profile.loudness_lufs ?? -18 });
  const files = writeOutputs(studio, audio, a.output, { ogg: a.ogg_output });
  if (masterExt(studio) === 'flac') { const rawFlac = raw.replace(/\.wav$/, '.flac'); convertFile(raw, rawFlac); fs.rmSync(raw, { force: true }); }
  const audit = auditAudioFile(studio.abs(a.ogg_output || files[0]), { role: 'voice', targetLufs: profile.loudness_lufs ?? -18 });
  studio.log({ agent: 'voice-director', event: 'voice.line', asset: a.asset?.id || null, message: `Voiced "${a.line_id}" with ${profile.id} via ${p.id}` });
  const reg = registerOutput(studio, a.asset || { id: `voice.${slugify(a.line_id)}`, agent: 'voice-director' }, { type: 'voice', files, source: { provider: p.id, text: a.text, prepared_text: prepared.text, pronunciation_changes: prepared.changes, profile: profile.id, ...meta }, metadata: { duration: audit.analysis.duration, lufs: audit.analysis.lufs, waveform: audit.waveform, profile: profile.id, text: a.text, language: profile.language } });
  return { files, provider: p.id, prepared_text: prepared.text, pronunciation_changes: prepared.changes, duration: audit.analysis.duration, audit: { verdict: audit.verdict, checks: audit.checks }, asset: reg, note: p.id !== 'elevenlabs' ? `Draft voice from ${p.id}; configure ElevenLabs for production quality.` : undefined };
});

// ------------------------------------------------------------------ minecraft export
tool(server, 'audio_export_minecraft', {
  title: 'Export sound to Minecraft', capability: 'write',
  description: 'Convert to Ogg Vorbis (mono by default for positional sounds) into <pack>/assets/<ns>/sounds/<path>.ogg and add/replace the event in sounds.json (with subtitle, stream for long music). Optionally link the registry asset.',
  input: {
    input: z.string(), pack_dir: z.string(), namespace: z.string(), sound_path: z.string().describe('Path under sounds/ without extension, e.g. reactor/startup'),
    event: z.string().describe('Sound event name, e.g. reactor.startup'), subtitle: z.string().optional(), stream: z.boolean().optional(), mono: z.boolean().optional(),
    volume: z.number().optional(), pitch: z.number().optional(), attenuation_distance: z.number().int().optional(), asset_id: z.string().optional(),
  },
}, async (a, { studio }) => {
  let audio = decodeAny(studio.abs(a.input));
  if (a.mono !== false) audio = toMono(audio);
  const ogg = `${a.pack_dir.replace(/\/$/, '')}/assets/${a.namespace}/sounds/${a.sound_path}.ogg`;
  encodeOgg(audio, studio.abs(ogg));
  const entry = { name: `${a.namespace}:${a.sound_path}`, ...(a.stream ? { stream: true } : {}), ...(a.volume !== undefined ? { volume: a.volume } : {}), ...(a.pitch !== undefined ? { pitch: a.pitch } : {}), ...(a.attenuation_distance ? { attenuation_distance: a.attenuation_distance } : {}) };
  const ev = upsertSoundEvent(studio.abs(a.pack_dir), a.namespace, a.event, { sounds: [entry], subtitle: a.subtitle });
  if (a.asset_id && studio.isInitialized() && studio.hasAsset(a.asset_id)) {
    const asset = studio.getAsset(a.asset_id);
    const files = [...asset.files.map((f) => ({ path: f.path, role: f.role })).filter((f) => f.path !== ogg), { path: ogg, role: 'minecraft' }];
    studio.updateAsset(a.asset_id, { files, minecraft_ids: [...new Set([...(asset.minecraft_ids || []), ev.event])] }, { by: 'sfx-designer', note: 'exported to Minecraft' });
  }
  return { ogg, event: ev.event, sounds_json: studio.rel(ev.file), mono: a.mono !== false };
});

await start(server);
