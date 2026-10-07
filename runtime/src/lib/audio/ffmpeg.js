// FFmpeg adapter. FFmpeg is the mature, recommended path for format conversion
// (Minecraft needs Ogg Vorbis) and heavy processing, but the studio degrades
// gracefully: synthesis, analysis of WAV and JS effects work without it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StudioError, ensureDir } from '../core/fsutil.js';
import { readWav, writeWav } from './wav.js';

let cached;
export function findFfmpeg() {
  if (cached !== undefined) return cached;
  const candidates = [process.env.MINECRAFT_STUDIO_FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const version = (r.stdout.match(/ffmpeg version (\S+)/) || [])[1] || 'unknown';
      const enc = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true }).stdout || '';
      cached = { path: c, version, vorbis: /libvorbis/.test(enc), opus: /libopus/.test(enc) };
      return cached;
    }
  }
  cached = null;
  return null;
}

function run(args, { timeout = 120000 } = {}) {
  const ff = findFfmpeg();
  if (!ff) throw new StudioError('E_FFMPEG', 'FFmpeg is not installed or not on PATH. Install FFmpeg (https://ffmpeg.org/download.html) or set MINECRAFT_STUDIO_FFMPEG. Needed for Ogg Vorbis export and format conversion.');
  const r = spawnSync(ff.path, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new StudioError('E_FFMPEG', `ffmpeg failed: ${(r.stderr || r.error?.message || '').trim().slice(0, 800)}`);
  return r;
}

const tmpFile = (ext) => path.join(ensureDir(path.join(os.tmpdir(), 'minecraft-studio')), `${crypto.randomBytes(6).toString('hex')}.${ext}`);

/** Decode any audio file to an Audio object (WAV is read natively). */
export function decodeAny(file, { sampleRate = null } = {}) {
  if (/\.wav$/i.test(file) && !sampleRate) return readWav(file);
  const tmp = tmpFile('wav');
  try {
    run(['-i', file, ...(sampleRate ? ['-ar', String(sampleRate)] : []), '-c:a', 'pcm_f32le', tmp]);
    return readWav(tmp);
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Encode Audio → Ogg Vorbis (Minecraft format). quality 0..10 (≈ 4 → ~128 kbps). */
export function encodeOgg(audio, outFile, { quality = 4 } = {}) {
  const ff = findFfmpeg();
  if (ff && !ff.vorbis) throw new StudioError('E_FFMPEG', 'This FFmpeg build has no libvorbis encoder; Minecraft requires Ogg Vorbis.');
  const tmp = tmpFile('wav');
  try {
    writeWav(tmp, audio, { bits: 16 });
    ensureDir(path.dirname(outFile));
    run(['-i', tmp, '-c:a', 'libvorbis', '-q:a', String(quality), outFile]);
    return outFile;
  } finally { fs.rmSync(tmp, { force: true }); }
}

export function convertFile(input, output, extra = []) {
  ensureDir(path.dirname(output));
  const codec = /\.ogg$/i.test(output) ? ['-c:a', 'libvorbis', '-q:a', '4'] : /\.wav$/i.test(output) ? ['-c:a', 'pcm_s16le'] : [];
  run(['-i', input, ...extra, ...codec, output]);
  return output;
}

/** Named ffmpeg processing presets → filter strings. */
export function presetFilter(step) {
  const n = (v, d) => (v === undefined ? d : Number(v));
  switch (step.type) {
    case 'loudnorm': return `loudnorm=I=${n(step.lufs, -16)}:TP=${n(step.true_peak, -1.5)}:LRA=11`;
    case 'highpass': return `highpass=f=${n(step.freq, 80)}`;
    case 'lowpass': return `lowpass=f=${n(step.freq, 8000)}`;
    case 'eq': return (step.bands || []).map((b) => `equalizer=f=${b.freq}:t=q:w=${b.q || 1}:g=${b.gain || 0}`).join(',') || 'anull';
    case 'compress': return `acompressor=threshold=${n(step.threshold, -18)}dB:ratio=${n(step.ratio, 4)}:attack=${n(step.attack_ms, 5)}:release=${n(step.release_ms, 120)}`;
    case 'limit': return `alimiter=limit=${Math.min(1, 10 ** (n(step.ceiling, -1) / 20)).toFixed(3)}:level=disabled`;
    case 'reverb': return `aecho=0.8:${n(step.decay, 0.6)}:${n(step.delay_ms, 45)}|${Math.round(n(step.delay_ms, 45) * 1.7)}:${n(step.mix, 0.3)}|${(n(step.mix, 0.3) * 0.6).toFixed(2)}`;
    case 'distortion': return `asoftclip=type=atan:param=${n(step.amount, 1)}`;
    case 'radio': return 'highpass=f=400,lowpass=f=3200,asoftclip=type=atan,acompressor=threshold=-20dB:ratio=6';
    case 'pa_speaker': return 'highpass=f=280,lowpass=f=4500,equalizer=f=1900:t=q:w=1.2:g=5,asoftclip=type=atan:param=0.8,acompressor=threshold=-22dB:ratio=4,aecho=0.7:0.5:60|110:0.25|0.15';
    case 'pitch': { const f = 2 ** (n(step.semitones, 0) / 12); return `asetrate=${n(step.sample_rate, 48000)}*${f.toFixed(5)},aresample=${n(step.sample_rate, 48000)},atempo=${(1 / f).toFixed(5)}`; }
    case 'tempo': return `atempo=${Math.max(0.5, Math.min(2, n(step.factor, 1)))}`;
    case 'trim': return `atrim=start=${n(step.start, 0)}${step.end !== undefined ? `:end=${step.end}` : ''},asetpts=PTS-STARTPTS`;
    case 'fade': return [step.in ? `afade=t=in:d=${step.in}` : null, step.out ? `areverse,afade=t=in:d=${step.out},areverse` : null].filter(Boolean).join(',') || 'anull';
    case 'mono': return 'pan=mono|c0=0.5*c0+0.5*c1';
    case 'silence_trim': return 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
    case 'resample': return `aresample=${n(step.sample_rate, 48000)}`;
    default: throw new StudioError('E_FFMPEG', `Unknown ffmpeg preset ${step.type}`);
  }
}

export function processFile(input, output, steps) {
  const chain = steps.map(presetFilter).filter((f) => f !== 'anull').join(',');
  ensureDir(path.dirname(output));
  const codec = /\.ogg$/i.test(output) ? ['-c:a', 'libvorbis', '-q:a', '4'] : /\.wav$/i.test(output) ? ['-c:a', 'pcm_s16le'] : [];
  const monoFlag = steps.some((s) => s.type === 'mono') ? ['-ac', '1'] : [];
  run(['-i', input, ...(chain ? ['-af', chain] : []), ...monoFlag, ...codec, output]);
  return { output, filter: chain };
}

/** Probe container metadata (codec, channels, rate, duration). */
export function probe(file) {
  const ff = findFfmpeg();
  if (!ff) return null;
  const r = spawnSync(ff.path, ['-hide_banner', '-i', file], { encoding: 'utf8', windowsHide: true });
  const txt = r.stderr || '';
  const dur = txt.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const stream = txt.match(/Audio: (\w+)[^,]*, (\d+) Hz, ([^,]+)/);
  return {
    codec: stream?.[1] || null, sample_rate: stream ? Number(stream[2]) : null, channel_layout: stream?.[3]?.trim() || null,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
  };
}
