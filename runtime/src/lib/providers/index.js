// Provider abstraction. Business logic asks for a capability ("voice",
// "sfx", "music", "image"); the registry picks the configured provider and
// every provider reports capabilities, availability, formats and cost.
//
// Provider contract:
//   id, kind, description, paid (bool)
//   capabilities: string[]
//   formats: string[]
//   available() -> { ok, reason }
//   estimateCost(request) -> { usd|null, unit, units, note }
//   generate(request, ctx) -> { file(s), metadata }   (kind-specific)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { StudioError, ensureDir } from '../core/fsutil.js';
import { getSecret } from '../core/secrets.js';
import { findFfmpeg, convertFile } from '../audio/ffmpeg.js';
import { makeAudio, writeWav } from '../audio/wav.js';

const ELEVEN_BASE = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';

function elevenKey() {
  const k = getSecret('ELEVENLABS_API_KEY');
  // unresolved plugin userConfig placeholders arrive literally when not configured
  return k && !k.startsWith('${') ? k : null;
}

async function elevenFetch(pathname, { method = 'POST', body, query = {}, timeoutMs = 120000 } = {}) {
  const key = elevenKey();
  if (!key) throw new StudioError('E_PROVIDER', 'ElevenLabs is not configured: set ELEVENLABS_API_KEY in the environment or the project .env file (never commit it).');
  const url = new URL(pathname, ELEVEN_BASE);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: '*/*' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new StudioError('E_PROVIDER', `ElevenLabs ${pathname} failed with HTTP ${res.status}: ${text}`);
    }
    return res;
  } finally { clearTimeout(timer); }
}

/** Save an mp3/pcm response and convert to WAV for processing. */
async function saveAudioResponse(res, outWav) {
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(ensureDir(path.join(os.tmpdir(), 'minecraft-studio')), `${crypto.randomBytes(6).toString('hex')}.mp3`);
  fs.writeFileSync(tmp, buf);
  try {
    convertFile(tmp, outWav);
  } finally { fs.rmSync(tmp, { force: true }); }
  return { bytes: buf.length };
}

// ---------------------------------------------------------------- voice
export const VOICE_PROVIDERS = {
  elevenlabs: {
    id: 'elevenlabs', kind: 'voice', paid: true, description: 'ElevenLabs text-to-speech (multilingual incl. Russian)',
    capabilities: ['tts', 'multilingual', 'voice-settings', 'seed'], formats: ['mp3', 'wav (converted)'],
    available() { return elevenKey() ? { ok: true } : { ok: false, reason: 'ELEVENLABS_API_KEY not set' }; },
    estimateCost({ text }) { return { usd: null, unit: 'characters', units: [...(text || '')].length, note: 'Billed in characters against the ElevenLabs plan quota' }; },
    async synthesize({ text, profile, outWav, previousText, nextText }) {
      const p = profile?.providers?.elevenlabs || {};
      if (!p.voice_id) throw new StudioError('E_PROVIDER', `Voice profile ${profile?.id} has no providers.elevenlabs.voice_id`);
      const res = await elevenFetch(`/v1/text-to-speech/${encodeURIComponent(p.voice_id)}`, {
        query: { output_format: 'mp3_44100_128' },
        body: {
          text, model_id: p.model_id || 'eleven_multilingual_v2', ...(profile.language ? { language_code: profile.language } : {}),
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: profile.pace ?? 1, ...(p.voice_settings || {}) },
          ...(p.seed !== undefined ? { seed: p.seed } : {}), ...(previousText ? { previous_text: previousText } : {}), ...(nextText ? { next_text: nextText } : {}),
        },
      });
      const r = await saveAudioResponse(res, outWav);
      return { provider: 'elevenlabs', model: p.model_id || 'eleven_multilingual_v2', voice_id: p.voice_id, characters: [...text].length, bytes: r.bytes };
    },
    async check() {
      const res = await elevenFetch('/v1/user/subscription', { method: 'GET', timeoutMs: 15000 });
      const j = await res.json();
      return { tier: j.tier, character_count: j.character_count, character_limit: j.character_limit, status: j.status };
    },
  },
  system: {
    id: 'system', kind: 'voice', paid: false, description: 'Operating-system TTS (Windows SAPI, macOS say, eSpeak NG) — free, lower quality, good for drafts',
    capabilities: ['tts', 'offline'], formats: ['wav'],
    available() { return systemTts() ? { ok: true, engine: systemTts().engine } : { ok: false, reason: 'no system TTS engine found (install eSpeak NG on Linux/Windows)' }; },
    estimateCost({ text }) { return { usd: 0, unit: 'characters', units: [...(text || '')].length, note: 'free, local' }; },
    async synthesize({ text, profile, outWav }) {
      const eng = systemTts();
      if (!eng) throw new StudioError('E_PROVIDER', 'No system TTS engine available');
      ensureDir(path.dirname(outWav));
      const lang = profile?.language || (/[а-яё]/i.test(text) ? 'ru' : 'en');
      const rate = profile?.pace ?? 1;
      const sys = profile?.providers?.system || {};
      let r;
      if (eng.engine === 'sapi' && (sys.engine === 'sapi' || (!sys.engine && sapiHasLanguage(lang)))) {
        const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
          `$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq '${lang}' } | Select-Object -First 1; ` +
          `if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.Rate = ${Math.round((rate - 1) * 10)}; $s.SetOutputToWaveFile($env:MS_OUT); $s.Speak($env:MS_TEXT); $s.Dispose()`;
        r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, MS_OUT: outWav, MS_TEXT: text }, encoding: 'utf8', timeout: 60000, windowsHide: true });
        if (r.status === 0 && fs.existsSync(outWav)) return { provider: 'system', engine: 'sapi', language: lang };
      }
      if (eng.engine === 'say' && sys.engine !== 'espeak') {
        const aiff = `${outWav}.aiff`;
        r = spawnSync('say', [...(sys.voice ? ['-v', sys.voice] : []), '-r', String(Math.round(175 * rate)), '-o', aiff, text], { encoding: 'utf8', timeout: 60000 });
        if (r.status === 0 && fs.existsSync(aiff)) { convertFile(aiff, outWav); fs.rmSync(aiff, { force: true }); return { provider: 'system', engine: 'say', language: lang }; }
      }
      const espeak = findEspeak();
      if (!espeak) throw new StudioError('E_PROVIDER', `System TTS failed: ${(r?.stderr || 'no engine for language ' + lang).slice(0, 300)}`);
      r = spawnSync(espeak, ['-v', sys.espeak_voice || lang, '-s', String(Math.round(165 * rate)), '-w', outWav, text], { encoding: 'utf8', timeout: 60000, windowsHide: true });
      if (r.status !== 0) throw new StudioError('E_PROVIDER', `espeak-ng failed: ${r.stderr}`);
      return { provider: 'system', engine: 'espeak-ng', language: lang };
    },
  },
  mock: {
    id: 'mock', kind: 'voice', paid: false, description: 'Deterministic placeholder speech-like tones for tests and CI',
    capabilities: ['tts', 'offline', 'deterministic'], formats: ['wav'],
    available() { return { ok: true }; },
    estimateCost({ text }) { return { usd: 0, unit: 'characters', units: [...(text || '')].length, note: 'mock' }; },
    async synthesize({ text, outWav }) {
      const syll = Math.max(1, Math.round([...text].filter((c) => /[aeiouyаеёиоуыэюя]/i.test(c)).length));
      const sr = 48000, per = 0.16;
      const a = makeAudio(sr, syll * per + 0.2);
      const ch = a.channels[0];
      for (let s = 0; s < syll; s++) {
        const f0 = 140 + 30 * Math.sin(s * 1.7);
        for (let i = 0; i < per * sr * 0.8; i++) {
          const t = i / sr;
          const k = Math.round((s * per + 0.05) * sr) + i;
          const e = Math.sin((Math.PI * i) / (per * sr * 0.8));
          ch[k] = e * 0.4 * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * f0 * 2 * t) + 0.25 * Math.sin(2 * Math.PI * (700 + 300 * Math.sin(s)) * t));
        }
      }
      writeWav(outWav, a);
      return { provider: 'mock', syllables: syll };
    },
  },
};

let sapiCache = null;
function sapiHasLanguage(lang) {
  if (process.platform !== 'win32') return false;
  if (!sapiCache) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Culture.TwoLetterISOLanguageName }'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    sapiCache = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  return sapiCache.includes(lang);
}

function findEspeak() {
  for (const c of ['espeak-ng', 'espeak', 'C:/Program Files/eSpeak NG/espeak-ng.exe']) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}

function systemTts() {
  if (process.platform === 'win32') return { engine: 'sapi' };
  if (process.platform === 'darwin') return { engine: 'say' };
  return findEspeak() ? { engine: 'espeak-ng' } : null;
}

// ---------------------------------------------------------------- sfx / music (remote)
export const SFX_PROVIDERS = {
  'local-synth': {
    id: 'local-synth', kind: 'sfx', paid: false, description: 'Built-in layered synthesizer (recipes, presets, effects)',
    capabilities: ['layered-design', 'loops', 'reproducible', 'offline'], formats: ['wav', 'ogg (with ffmpeg)'],
    available() { return { ok: true }; },
    estimateCost() { return { usd: 0, note: 'free, local' }; },
  },
  elevenlabs: {
    id: 'elevenlabs', kind: 'sfx', paid: true, description: 'ElevenLabs text-to-sound-effects (eleven_text_to_sound_v2)',
    capabilities: ['text-to-sfx', 'loops', 'realistic-foley'], formats: ['mp3 → wav'],
    available() { return elevenKey() ? { ok: true } : { ok: false, reason: 'ELEVENLABS_API_KEY not set' }; },
    estimateCost({ duration_seconds }) { return { usd: null, unit: 'generation', units: 1, note: `credits depend on duration (${duration_seconds ?? 'auto'}s) and plan` }; },
    async generate({ prompt, duration_seconds, loop = false, prompt_influence = 0.3, outWav }) {
      const res = await elevenFetch('/v1/sound-generation', { query: { output_format: 'mp3_44100_128' }, body: { text: prompt, model_id: 'eleven_text_to_sound_v2', ...(duration_seconds ? { duration_seconds } : {}), prompt_influence, loop } });
      const r = await saveAudioResponse(res, outWav);
      return { provider: 'elevenlabs', model: 'eleven_text_to_sound_v2', bytes: r.bytes };
    },
  },
};

export const MUSIC_PROVIDERS = {
  'local-composer': {
    id: 'local-composer', kind: 'music', paid: false, description: 'Built-in structured composer: editable scores, stems, loop & transition metadata',
    capabilities: ['scores', 'stems', 'adaptive-metadata', 'choir-formants', 'reproducible', 'offline'], formats: ['wav', 'ogg (with ffmpeg)'],
    available() { return { ok: true }; },
    estimateCost() { return { usd: 0, note: 'free, local' }; },
  },
  elevenlabs: {
    id: 'elevenlabs', kind: 'music', paid: true, description: 'ElevenLabs music generation (prompt or composition plan)',
    capabilities: ['text-to-music', 'composition-plan'], formats: ['mp3 → wav'],
    available() { return elevenKey() ? { ok: true } : { ok: false, reason: 'ELEVENLABS_API_KEY not set' }; },
    estimateCost({ music_length_ms }) { return { usd: null, unit: 'ms', units: music_length_ms, note: 'availability and price depend on the ElevenLabs plan' }; },
    async generate({ prompt, music_length_ms = 30000, force_instrumental = true, outWav }) {
      const res = await elevenFetch('/v1/music', { query: { output_format: 'mp3_44100_128' }, body: { prompt, music_length_ms, force_instrumental }, timeoutMs: 300000 });
      const r = await saveAudioResponse(res, outWav);
      return { provider: 'elevenlabs', bytes: r.bytes, music_length_ms };
    },
  },
};

export const IMAGE_PROVIDERS = {
  none: {
    id: 'none', kind: 'image', paid: false, description: 'No generative image provider: textures are authored as pixel specs by the Texture Artist (recommended for 16×16)',
    capabilities: ['pixel-spec', 'style-analysis', 'variants', 'concept-reduction'], formats: ['png'],
    available() { return { ok: true }; },
    estimateCost() { return { usd: 0 }; },
  },
};

export const MODELING_PROVIDERS = {
  'studio-model': {
    id: 'studio-model', kind: 'modeling', paid: false, description: 'Built-in model source → Java / Bedrock / .bbmodel exporters with software turnaround renderer',
    capabilities: ['java-block-model', 'bedrock-geometry', 'bbmodel', 'animations', 'render-preview'], formats: ['json', 'bbmodel', 'png'],
    available() { return { ok: true }; },
    estimateCost() { return { usd: 0 }; },
  },
  blockbench: {
    id: 'blockbench', kind: 'modeling', paid: false, description: 'Live Blockbench control through a Blockbench MCP server (optional, see docs/modeling.md)',
    capabilities: ['interactive-editing', 'paint', 'rig', 'animate', 'screenshots', 'export'], formats: ['bbmodel', 'java', 'bedrock', 'gltf'],
    available() { return { ok: null, reason: 'checked by studio_doctor (probes the Blockbench MCP bridge ports 8787 / 3000)' }; },
    estimateCost() { return { usd: 0 }; },
  },
};

const ALL = { voice: VOICE_PROVIDERS, sfx: SFX_PROVIDERS, music: MUSIC_PROVIDERS, image: IMAGE_PROVIDERS, modeling: MODELING_PROVIDERS };

export function listProviders() {
  return Object.fromEntries(Object.entries(ALL).map(([kind, map]) => [kind, Object.values(map).map((p) => ({
    id: p.id, description: p.description, paid: p.paid, capabilities: p.capabilities, formats: p.formats, availability: p.available(),
  }))]));
}

export function resolveProvider(kind, preferred = 'auto') {
  const map = ALL[kind];
  if (!map) throw new StudioError('E_PROVIDER', `Unknown provider kind ${kind}`);
  if (preferred && preferred !== 'auto') {
    const p = map[preferred];
    if (!p) throw new StudioError('E_PROVIDER', `Unknown ${kind} provider ${preferred}. Available: ${Object.keys(map).join(', ')}`);
    const av = p.available();
    if (av.ok === false) throw new StudioError('E_PROVIDER_UNAVAILABLE', `${kind} provider ${preferred} unavailable: ${av.reason}`);
    return p;
  }
  // auto: best available, preferring quality (paid) when configured
  const order = { voice: ['elevenlabs', 'system', 'mock'], sfx: ['local-synth'], music: ['local-composer'], image: ['none'], modeling: ['studio-model'] }[kind];
  for (const id of order) if (map[id]?.available().ok) return map[id];
  throw new StudioError('E_PROVIDER_UNAVAILABLE', `No ${kind} provider available`);
}

export { findFfmpeg };
