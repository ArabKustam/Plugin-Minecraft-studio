import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  StudioError,
  ensureDir,
  getSecret
} from "./chunk-RRZML6EW.mjs";

// src/lib/audio/wav.js
import fs from "node:fs";
import path from "node:path";
function decodeWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new StudioError("E_WAV", "Not a RIFF/WAVE file");
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === "data") data = buf.subarray(body, Math.min(buf.length, body + size));
    off = body + size + size % 2;
  }
  if (!fmt || !data) throw new StudioError("E_WAV", "WAV missing fmt or data chunk");
  let format = fmt.format;
  if (format === 65534) format = fmt.bits === 32 && data.length % 4 === 0 ? 3 : 1;
  const bps = fmt.bits / 8;
  const frames = Math.floor(data.length / (bps * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) {
    const p = (i * fmt.channels + c) * bps;
    let v;
    if (format === 3) v = bps === 4 ? data.readFloatLE(p) : data.readDoubleLE(p);
    else if (bps === 1) v = (data[p] - 128) / 128;
    else if (bps === 2) v = data.readInt16LE(p) / 32768;
    else if (bps === 3) v = data.readIntLE(p, 3) / 8388608;
    else v = data.readInt32LE(p) / 2147483648;
    channels[c][i] = v;
  }
  return { sampleRate: fmt.sampleRate, channels, bits: fmt.bits, format: format === 3 ? "float" : "pcm" };
}
function readWav(file) {
  return decodeWav(fs.readFileSync(file));
}
function encodeWav(audio, { bits = 16 } = {}) {
  const nch = audio.channels.length;
  const frames = audio.channels[0].length;
  const bps = bits / 8;
  const buf = Buffer.alloc(44 + frames * nch * bps);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + frames * nch * bps, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(bits === 32 ? 3 : 1, 20);
  buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(audio.sampleRate, 24);
  buf.writeUInt32LE(audio.sampleRate * nch * bps, 28);
  buf.writeUInt16LE(nch * bps, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(frames * nch * bps, 40);
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) {
    const v = Math.max(-1, Math.min(1, audio.channels[c][i] || 0));
    if (bits === 32) buf.writeFloatLE(v, p);
    else if (bits === 24) buf.writeIntLE(Math.round(v * 8388607), p, 3);
    else buf.writeInt16LE(Math.round(v * 32767), p);
    p += bps;
  }
  return buf;
}
function writeWav(file, audio, opts) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, encodeWav(audio, opts));
  return file;
}
function makeAudio(sampleRate, seconds, nch = 1) {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  return { sampleRate, channels: Array.from({ length: nch }, () => new Float32Array(n)) };
}
function toMono(audio) {
  if (audio.channels.length === 1) return audio;
  const n = audio.channels[0].length;
  const out = new Float32Array(n);
  for (const ch of audio.channels) for (let i = 0; i < n; i++) out[i] += ch[i] / audio.channels.length;
  return { sampleRate: audio.sampleRate, channels: [out] };
}

// src/lib/audio/ffmpeg.js
import { spawnSync } from "node:child_process";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import crypto from "node:crypto";
var cached;
function findFfmpeg() {
  if (cached !== void 0) return cached;
  const candidates = [process.env.MINECRAFT_STUDIO_FFMPEG, "ffmpeg"].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["-hide_banner", "-version"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) {
      const version = (r.stdout.match(/ffmpeg version (\S+)/) || [])[1] || "unknown";
      const enc = spawnSync(c, ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true }).stdout || "";
      cached = { path: c, version, vorbis: /libvorbis/.test(enc), opus: /libopus/.test(enc) };
      return cached;
    }
  }
  cached = null;
  return null;
}
function run(args, { timeout = 12e4 } = {}) {
  const ff = findFfmpeg();
  if (!ff) throw new StudioError("E_FFMPEG", "FFmpeg is not installed or not on PATH. Install FFmpeg (https://ffmpeg.org/download.html) or set MINECRAFT_STUDIO_FFMPEG. Needed for Ogg Vorbis export and format conversion.");
  const r = spawnSync(ff.path, ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new StudioError("E_FFMPEG", `ffmpeg failed: ${(r.stderr || r.error?.message || "").trim().slice(0, 800)}`);
  return r;
}
var tmpFile = (ext) => path2.join(ensureDir(path2.join(os.tmpdir(), "minecraft-studio")), `${crypto.randomBytes(6).toString("hex")}.${ext}`);
function decodeAny(file, { sampleRate = null } = {}) {
  if (/\.wav$/i.test(file) && !sampleRate) return readWav(file);
  const tmp = tmpFile("wav");
  try {
    run(["-i", file, ...sampleRate ? ["-ar", String(sampleRate)] : [], "-c:a", "pcm_f32le", tmp]);
    return readWav(tmp);
  } finally {
    fs2.rmSync(tmp, { force: true });
  }
}
function encodeOgg(audio, outFile, { quality = 4 } = {}) {
  const ff = findFfmpeg();
  if (ff && !ff.vorbis) throw new StudioError("E_FFMPEG", "This FFmpeg build has no libvorbis encoder; Minecraft requires Ogg Vorbis.");
  const tmp = tmpFile("wav");
  try {
    writeWav(tmp, audio, { bits: 16 });
    ensureDir(path2.dirname(outFile));
    run(["-i", tmp, "-c:a", "libvorbis", "-q:a", String(quality), outFile]);
    return outFile;
  } finally {
    fs2.rmSync(tmp, { force: true });
  }
}
function convertFile(input, output, extra = []) {
  ensureDir(path2.dirname(output));
  const codec = /\.ogg$/i.test(output) ? ["-c:a", "libvorbis", "-q:a", "4"] : /\.wav$/i.test(output) ? ["-c:a", "pcm_s16le"] : [];
  run(["-i", input, ...extra, ...codec, output]);
  return output;
}
function presetFilter(step) {
  const n = (v, d) => v === void 0 ? d : Number(v);
  switch (step.type) {
    case "loudnorm":
      return `loudnorm=I=${n(step.lufs, -16)}:TP=${n(step.true_peak, -1.5)}:LRA=11`;
    case "highpass":
      return `highpass=f=${n(step.freq, 80)}`;
    case "lowpass":
      return `lowpass=f=${n(step.freq, 8e3)}`;
    case "eq":
      return (step.bands || []).map((b) => `equalizer=f=${b.freq}:t=q:w=${b.q || 1}:g=${b.gain || 0}`).join(",") || "anull";
    case "compress":
      return `acompressor=threshold=${n(step.threshold, -18)}dB:ratio=${n(step.ratio, 4)}:attack=${n(step.attack_ms, 5)}:release=${n(step.release_ms, 120)}`;
    case "limit":
      return `alimiter=limit=${Math.min(1, 10 ** (n(step.ceiling, -1) / 20)).toFixed(3)}:level=disabled`;
    case "reverb":
      return `aecho=0.8:${n(step.decay, 0.6)}:${n(step.delay_ms, 45)}|${Math.round(n(step.delay_ms, 45) * 1.7)}:${n(step.mix, 0.3)}|${(n(step.mix, 0.3) * 0.6).toFixed(2)}`;
    case "distortion":
      return `asoftclip=type=atan:param=${n(step.amount, 1)}`;
    case "radio":
      return "highpass=f=400,lowpass=f=3200,asoftclip=type=atan,acompressor=threshold=-20dB:ratio=6";
    case "pa_speaker":
      return "highpass=f=280,lowpass=f=4500,equalizer=f=1900:t=q:w=1.2:g=5,asoftclip=type=atan:param=0.8,acompressor=threshold=-22dB:ratio=4,aecho=0.7:0.5:60|110:0.25|0.15";
    case "pitch": {
      const f = 2 ** (n(step.semitones, 0) / 12);
      return `asetrate=${n(step.sample_rate, 48e3)}*${f.toFixed(5)},aresample=${n(step.sample_rate, 48e3)},atempo=${(1 / f).toFixed(5)}`;
    }
    case "tempo":
      return `atempo=${Math.max(0.5, Math.min(2, n(step.factor, 1)))}`;
    case "trim":
      return `atrim=start=${n(step.start, 0)}${step.end !== void 0 ? `:end=${step.end}` : ""},asetpts=PTS-STARTPTS`;
    case "fade":
      return [step.in ? `afade=t=in:d=${step.in}` : null, step.out ? `areverse,afade=t=in:d=${step.out},areverse` : null].filter(Boolean).join(",") || "anull";
    case "mono":
      return "pan=mono|c0=0.5*c0+0.5*c1";
    case "silence_trim":
      return "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse";
    case "resample":
      return `aresample=${n(step.sample_rate, 48e3)}`;
    default:
      throw new StudioError("E_FFMPEG", `Unknown ffmpeg preset ${step.type}`);
  }
}
function processFile(input, output, steps) {
  const chain = steps.map(presetFilter).filter((f) => f !== "anull").join(",");
  ensureDir(path2.dirname(output));
  const codec = /\.ogg$/i.test(output) ? ["-c:a", "libvorbis", "-q:a", "4"] : /\.wav$/i.test(output) ? ["-c:a", "pcm_s16le"] : [];
  const monoFlag = steps.some((s) => s.type === "mono") ? ["-ac", "1"] : [];
  run(["-i", input, ...chain ? ["-af", chain] : [], ...monoFlag, ...codec, output]);
  return { output, filter: chain };
}
function probe(file) {
  const ff = findFfmpeg();
  if (!ff) return null;
  const r = spawnSync(ff.path, ["-hide_banner", "-i", file], { encoding: "utf8", windowsHide: true });
  const txt = r.stderr || "";
  const dur = txt.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const stream = txt.match(/Audio: (\w+)[^,]*, (\d+) Hz, ([^,]+)/);
  return {
    codec: stream?.[1] || null,
    sample_rate: stream ? Number(stream[2]) : null,
    channel_layout: stream?.[3]?.trim() || null,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null
  };
}

// src/lib/providers/index.js
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";
import crypto2 from "node:crypto";
import { spawnSync as spawnSync2 } from "node:child_process";
var ELEVEN_BASE = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
function elevenKey() {
  const k = getSecret("ELEVENLABS_API_KEY");
  return k && !k.startsWith("${") ? k : null;
}
async function elevenFetch(pathname, { method = "POST", body, query = {}, timeoutMs = 12e4 } = {}) {
  const key = elevenKey();
  if (!key) throw new StudioError("E_PROVIDER", "ElevenLabs is not configured: set ELEVENLABS_API_KEY in the environment or the project .env file (never commit it).");
  const url = new URL(pathname, ELEVEN_BASE);
  for (const [k, v] of Object.entries(query)) if (v !== void 0 && v !== null) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { "xi-api-key": key, "content-type": "application/json", accept: "*/*" }, body: body ? JSON.stringify(body) : void 0, signal: ctrl.signal });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new StudioError("E_PROVIDER", `ElevenLabs ${pathname} failed with HTTP ${res.status}: ${text}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}
async function saveAudioResponse(res, outWav) {
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path3.join(ensureDir(path3.join(os2.tmpdir(), "minecraft-studio")), `${crypto2.randomBytes(6).toString("hex")}.mp3`);
  fs3.writeFileSync(tmp, buf);
  try {
    convertFile(tmp, outWav);
  } finally {
    fs3.rmSync(tmp, { force: true });
  }
  return { bytes: buf.length };
}
var VOICE_PROVIDERS = {
  elevenlabs: {
    id: "elevenlabs",
    kind: "voice",
    paid: true,
    description: "ElevenLabs text-to-speech (multilingual incl. Russian)",
    capabilities: ["tts", "multilingual", "voice-settings", "seed"],
    formats: ["mp3", "wav (converted)"],
    available() {
      return elevenKey() ? { ok: true } : { ok: false, reason: "ELEVENLABS_API_KEY not set" };
    },
    estimateCost({ text }) {
      return { usd: null, unit: "characters", units: [...text || ""].length, note: "Billed in characters against the ElevenLabs plan quota" };
    },
    async synthesize({ text, profile, outWav, previousText, nextText }) {
      const p = profile?.providers?.elevenlabs || {};
      if (!p.voice_id) throw new StudioError("E_PROVIDER", `Voice profile ${profile?.id} has no providers.elevenlabs.voice_id`);
      const res = await elevenFetch(`/v1/text-to-speech/${encodeURIComponent(p.voice_id)}`, {
        query: { output_format: "mp3_44100_128" },
        body: {
          text,
          model_id: p.model_id || "eleven_multilingual_v2",
          ...profile.language ? { language_code: profile.language } : {},
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: profile.pace ?? 1, ...p.voice_settings || {} },
          ...p.seed !== void 0 ? { seed: p.seed } : {},
          ...previousText ? { previous_text: previousText } : {},
          ...nextText ? { next_text: nextText } : {}
        }
      });
      const r = await saveAudioResponse(res, outWav);
      return { provider: "elevenlabs", model: p.model_id || "eleven_multilingual_v2", voice_id: p.voice_id, characters: [...text].length, bytes: r.bytes };
    },
    async check() {
      const res = await elevenFetch("/v1/user/subscription", { method: "GET", timeoutMs: 15e3 });
      const j = await res.json();
      return { tier: j.tier, character_count: j.character_count, character_limit: j.character_limit, status: j.status };
    }
  },
  system: {
    id: "system",
    kind: "voice",
    paid: false,
    description: "Operating-system TTS (Windows SAPI, macOS say, eSpeak NG) \u2014 free, lower quality, good for drafts",
    capabilities: ["tts", "offline"],
    formats: ["wav"],
    available() {
      return systemTts() ? { ok: true, engine: systemTts().engine } : { ok: false, reason: "no system TTS engine found (install eSpeak NG on Linux/Windows)" };
    },
    estimateCost({ text }) {
      return { usd: 0, unit: "characters", units: [...text || ""].length, note: "free, local" };
    },
    async synthesize({ text, profile, outWav }) {
      const eng = systemTts();
      if (!eng) throw new StudioError("E_PROVIDER", "No system TTS engine available");
      ensureDir(path3.dirname(outWav));
      const lang = profile?.language || (/[а-яё]/i.test(text) ? "ru" : "en");
      const rate = profile?.pace ?? 1;
      const sys = profile?.providers?.system || {};
      let r;
      if (eng.engine === "sapi" && (sys.engine === "sapi" || !sys.engine && sapiHasLanguage(lang))) {
        const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq '${lang}' } | Select-Object -First 1; if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.Rate = ${Math.round((rate - 1) * 10)}; $s.SetOutputToWaveFile($env:MS_OUT); $s.Speak($env:MS_TEXT); $s.Dispose()`;
        r = spawnSync2("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, MS_OUT: outWav, MS_TEXT: text }, encoding: "utf8", timeout: 6e4, windowsHide: true });
        if (r.status === 0 && fs3.existsSync(outWav)) return { provider: "system", engine: "sapi", language: lang };
      }
      if (eng.engine === "say" && sys.engine !== "espeak") {
        const aiff = `${outWav}.aiff`;
        r = spawnSync2("say", [...sys.voice ? ["-v", sys.voice] : [], "-r", String(Math.round(175 * rate)), "-o", aiff, text], { encoding: "utf8", timeout: 6e4 });
        if (r.status === 0 && fs3.existsSync(aiff)) {
          convertFile(aiff, outWav);
          fs3.rmSync(aiff, { force: true });
          return { provider: "system", engine: "say", language: lang };
        }
      }
      const espeak = findEspeak();
      if (!espeak) throw new StudioError("E_PROVIDER", `System TTS failed: ${(r?.stderr || "no engine for language " + lang).slice(0, 300)}`);
      r = spawnSync2(espeak, ["-v", sys.espeak_voice || lang, "-s", String(Math.round(165 * rate)), "-w", outWav, text], { encoding: "utf8", timeout: 6e4, windowsHide: true });
      if (r.status !== 0) throw new StudioError("E_PROVIDER", `espeak-ng failed: ${r.stderr}`);
      return { provider: "system", engine: "espeak-ng", language: lang };
    }
  },
  mock: {
    id: "mock",
    kind: "voice",
    paid: false,
    description: "Deterministic placeholder speech-like tones for tests and CI",
    capabilities: ["tts", "offline", "deterministic"],
    formats: ["wav"],
    available() {
      return { ok: true };
    },
    estimateCost({ text }) {
      return { usd: 0, unit: "characters", units: [...text || ""].length, note: "mock" };
    },
    async synthesize({ text, outWav }) {
      const syll = Math.max(1, Math.round([...text].filter((c) => /[aeiouyаеёиоуыэюя]/i.test(c)).length));
      const sr = 48e3, per = 0.16;
      const a = makeAudio(sr, syll * per + 0.2);
      const ch = a.channels[0];
      for (let s = 0; s < syll; s++) {
        const f0 = 140 + 30 * Math.sin(s * 1.7);
        for (let i = 0; i < per * sr * 0.8; i++) {
          const t = i / sr;
          const k = Math.round((s * per + 0.05) * sr) + i;
          const e = Math.sin(Math.PI * i / (per * sr * 0.8));
          ch[k] = e * 0.4 * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * f0 * 2 * t) + 0.25 * Math.sin(2 * Math.PI * (700 + 300 * Math.sin(s)) * t));
        }
      }
      writeWav(outWav, a);
      return { provider: "mock", syllables: syll };
    }
  }
};
var sapiCache = null;
function sapiHasLanguage(lang) {
  if (process.platform !== "win32") return false;
  if (!sapiCache) {
    const r = spawnSync2("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Culture.TwoLetterISOLanguageName }"], { encoding: "utf8", timeout: 2e4, windowsHide: true });
    sapiCache = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  return sapiCache.includes(lang);
}
function findEspeak() {
  for (const c of ["espeak-ng", "espeak", "C:/Program Files/eSpeak NG/espeak-ng.exe"]) {
    const r = spawnSync2(c, ["--version"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}
function systemTts() {
  if (process.platform === "win32") return { engine: "sapi" };
  if (process.platform === "darwin") return { engine: "say" };
  return findEspeak() ? { engine: "espeak-ng" } : null;
}
var SFX_PROVIDERS = {
  "local-synth": {
    id: "local-synth",
    kind: "sfx",
    paid: false,
    description: "Built-in layered synthesizer (recipes, presets, effects)",
    capabilities: ["layered-design", "loops", "reproducible", "offline"],
    formats: ["wav", "ogg (with ffmpeg)"],
    available() {
      return { ok: true };
    },
    estimateCost() {
      return { usd: 0, note: "free, local" };
    }
  },
  elevenlabs: {
    id: "elevenlabs",
    kind: "sfx",
    paid: true,
    description: "ElevenLabs text-to-sound-effects (eleven_text_to_sound_v2)",
    capabilities: ["text-to-sfx", "loops", "realistic-foley"],
    formats: ["mp3 \u2192 wav"],
    available() {
      return elevenKey() ? { ok: true } : { ok: false, reason: "ELEVENLABS_API_KEY not set" };
    },
    estimateCost({ duration_seconds }) {
      return { usd: null, unit: "generation", units: 1, note: `credits depend on duration (${duration_seconds ?? "auto"}s) and plan` };
    },
    async generate({ prompt, duration_seconds, loop = false, prompt_influence = 0.3, outWav }) {
      const res = await elevenFetch("/v1/sound-generation", { query: { output_format: "mp3_44100_128" }, body: { text: prompt, model_id: "eleven_text_to_sound_v2", ...duration_seconds ? { duration_seconds } : {}, prompt_influence, loop } });
      const r = await saveAudioResponse(res, outWav);
      return { provider: "elevenlabs", model: "eleven_text_to_sound_v2", bytes: r.bytes };
    }
  }
};
var MUSIC_PROVIDERS = {
  "local-composer": {
    id: "local-composer",
    kind: "music",
    paid: false,
    description: "Built-in structured composer: editable scores, stems, loop & transition metadata",
    capabilities: ["scores", "stems", "adaptive-metadata", "choir-formants", "reproducible", "offline"],
    formats: ["wav", "ogg (with ffmpeg)"],
    available() {
      return { ok: true };
    },
    estimateCost() {
      return { usd: 0, note: "free, local" };
    }
  },
  elevenlabs: {
    id: "elevenlabs",
    kind: "music",
    paid: true,
    description: "ElevenLabs music generation (prompt or composition plan)",
    capabilities: ["text-to-music", "composition-plan"],
    formats: ["mp3 \u2192 wav"],
    available() {
      return elevenKey() ? { ok: true } : { ok: false, reason: "ELEVENLABS_API_KEY not set" };
    },
    estimateCost({ music_length_ms }) {
      return { usd: null, unit: "ms", units: music_length_ms, note: "availability and price depend on the ElevenLabs plan" };
    },
    async generate({ prompt, music_length_ms = 3e4, force_instrumental = true, outWav }) {
      const res = await elevenFetch("/v1/music", { query: { output_format: "mp3_44100_128" }, body: { prompt, music_length_ms, force_instrumental }, timeoutMs: 3e5 });
      const r = await saveAudioResponse(res, outWav);
      return { provider: "elevenlabs", bytes: r.bytes, music_length_ms };
    }
  }
};
var IMAGE_PROVIDERS = {
  none: {
    id: "none",
    kind: "image",
    paid: false,
    description: "No generative image provider: textures are authored as pixel specs by the Texture Artist (recommended for 16\xD716)",
    capabilities: ["pixel-spec", "style-analysis", "variants", "concept-reduction"],
    formats: ["png"],
    available() {
      return { ok: true };
    },
    estimateCost() {
      return { usd: 0 };
    }
  }
};
var MODELING_PROVIDERS = {
  "studio-model": {
    id: "studio-model",
    kind: "modeling",
    paid: false,
    description: "Built-in model source \u2192 Java / Bedrock / .bbmodel exporters with software turnaround renderer",
    capabilities: ["java-block-model", "bedrock-geometry", "bbmodel", "animations", "render-preview"],
    formats: ["json", "bbmodel", "png"],
    available() {
      return { ok: true };
    },
    estimateCost() {
      return { usd: 0 };
    }
  },
  blockbench: {
    id: "blockbench",
    kind: "modeling",
    paid: false,
    description: "Live Blockbench control through a Blockbench MCP server (optional, see docs/modeling.md)",
    capabilities: ["interactive-editing", "paint", "rig", "animate", "screenshots", "export"],
    formats: ["bbmodel", "java", "bedrock", "gltf"],
    available() {
      return { ok: null, reason: "checked by studio_doctor (probes the Blockbench MCP bridge ports 8787 / 3000)" };
    },
    estimateCost() {
      return { usd: 0 };
    }
  }
};
var ALL = { voice: VOICE_PROVIDERS, sfx: SFX_PROVIDERS, music: MUSIC_PROVIDERS, image: IMAGE_PROVIDERS, modeling: MODELING_PROVIDERS };
function listProviders() {
  return Object.fromEntries(Object.entries(ALL).map(([kind, map]) => [kind, Object.values(map).map((p) => ({
    id: p.id,
    description: p.description,
    paid: p.paid,
    capabilities: p.capabilities,
    formats: p.formats,
    availability: p.available()
  }))]));
}
function resolveProvider(kind, preferred = "auto") {
  const map = ALL[kind];
  if (!map) throw new StudioError("E_PROVIDER", `Unknown provider kind ${kind}`);
  if (preferred && preferred !== "auto") {
    const p = map[preferred];
    if (!p) throw new StudioError("E_PROVIDER", `Unknown ${kind} provider ${preferred}. Available: ${Object.keys(map).join(", ")}`);
    const av = p.available();
    if (av.ok === false) throw new StudioError("E_PROVIDER_UNAVAILABLE", `${kind} provider ${preferred} unavailable: ${av.reason}`);
    return p;
  }
  const order = { voice: ["elevenlabs", "system", "mock"], sfx: ["local-synth"], music: ["local-composer"], image: ["none"], modeling: ["studio-model"] }[kind];
  for (const id of order) if (map[id]?.available().ok) return map[id];
  throw new StudioError("E_PROVIDER_UNAVAILABLE", `No ${kind} provider available`);
}

export {
  writeWav,
  makeAudio,
  toMono,
  findFfmpeg,
  decodeAny,
  encodeOgg,
  convertFile,
  processFile,
  probe,
  VOICE_PROVIDERS,
  SFX_PROVIDERS,
  MUSIC_PROVIDERS,
  listProviders,
  resolveProvider
};
