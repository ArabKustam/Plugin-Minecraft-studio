// WAV encode/decode (PCM 8/16/24/32-bit, IEEE float 32) to Float32 channel arrays.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, ensureDir } from '../core/fsutil.js';

/** @typedef {{sampleRate:number, channels:Float32Array[]}} Audio */

export function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new StudioError('E_WAV', 'Not a RIFF/WAVE file');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') data = buf.subarray(body, Math.min(buf.length, body + size));
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new StudioError('E_WAV', 'WAV missing fmt or data chunk');
  let format = fmt.format;
  if (format === 0xfffe) format = fmt.bits === 32 && data.length % 4 === 0 ? 3 : 1; // WAVE_FORMAT_EXTENSIBLE heuristic
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
  return { sampleRate: fmt.sampleRate, channels, bits: fmt.bits, format: format === 3 ? 'float' : 'pcm' };
}

export function readWav(file) {
  return decodeWav(fs.readFileSync(file));
}

export function encodeWav(audio, { bits = 16 } = {}) {
  const nch = audio.channels.length;
  const frames = audio.channels[0].length;
  const bps = bits / 8;
  const buf = Buffer.alloc(44 + frames * nch * bps);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + frames * nch * bps, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(bits === 32 ? 3 : 1, 20); buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(audio.sampleRate, 24); buf.writeUInt32LE(audio.sampleRate * nch * bps, 28); buf.writeUInt16LE(nch * bps, 32); buf.writeUInt16LE(bits, 34);
  buf.write('data', 36); buf.writeUInt32LE(frames * nch * bps, 40);
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

export function writeWav(file, audio, opts) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, encodeWav(audio, opts));
  return file;
}

export function makeAudio(sampleRate, seconds, nch = 1) {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  return { sampleRate, channels: Array.from({ length: nch }, () => new Float32Array(n)) };
}

export function toMono(audio) {
  if (audio.channels.length === 1) return audio;
  const n = audio.channels[0].length;
  const out = new Float32Array(n);
  for (const ch of audio.channels) for (let i = 0; i < n; i++) out[i] += ch[i] / audio.channels.length;
  return { sampleRate: audio.sampleRate, channels: [out] };
}

/** Mix src into dst at a sample offset with linear gain. */
export function mixInto(dst, src, offset = 0, gain = 1) {
  for (let c = 0; c < dst.channels.length; c++) {
    const s = src.channels[Math.min(c, src.channels.length - 1)];
    const d = dst.channels[c];
    for (let i = 0; i < s.length && i + offset < d.length; i++) if (i + offset >= 0) d[i + offset] += s[i] * gain;
  }
  return dst;
}
