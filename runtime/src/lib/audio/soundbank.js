// Sound bank location and installation (no synthesis code here, so the doctor
// and other servers can check the bank without bundling the sampler).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { StudioError } from '../core/fsutil.js';

export const DEFAULT_SOUNDFONT = {
  name: 'GeneralUser GS v2.0.3',
  file: 'GeneralUser-GS.sf2',
  url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2',
  sha256: '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe',
  bytes: 32319396,
  license: 'GeneralUser GS License v2.0 — free for private and commercial music (https://github.com/mrbumpy409/GeneralUser-GS)',
};

export function soundfontCacheDir() {
  if (process.env.MINECRAFT_STUDIO_CACHE) return path.join(process.env.MINECRAFT_STUDIO_CACHE, 'soundfonts');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'minecraft-studio', 'soundfonts');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'minecraft-studio', 'soundfonts');
}

/** Which sound bank a render would use: explicit path > env > config > default cache file. */
export function resolveSoundfont({ scorePath, configPath, root } = {}) {
  const pick = scorePath || process.env.MINECRAFT_STUDIO_SOUNDFONT || configPath;
  if (pick) {
    const p = path.isAbsolute(pick) ? pick : path.resolve(root || process.cwd(), pick);
    return { path: p, source: scorePath ? 'score' : process.env.MINECRAFT_STUDIO_SOUNDFONT ? 'env' : 'config', exists: fs.existsSync(p) };
  }
  const p = path.join(soundfontCacheDir(), DEFAULT_SOUNDFONT.file);
  return { path: p, source: 'default', exists: fs.existsSync(p), default: DEFAULT_SOUNDFONT };
}

/** Download the default bank into the cache, verifying its sha256. */
export async function installDefaultSoundfont({ force = false } = {}) {
  const dir = soundfontCacheDir();
  const target = path.join(dir, DEFAULT_SOUNDFONT.file);
  if (!force && fs.existsSync(target) && sha256File(target) === DEFAULT_SOUNDFONT.sha256) {
    return { installed: true, already: true, path: target, ...pick(DEFAULT_SOUNDFONT) };
  }
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(DEFAULT_SOUNDFONT.url, { redirect: 'follow' });
  if (!res.ok) throw new StudioError('E_DOWNLOAD', `Sound bank download failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  if (hash !== DEFAULT_SOUNDFONT.sha256) throw new StudioError('E_DOWNLOAD', `Sound bank checksum mismatch (got ${hash}); nothing was saved`);
  const tmp = `${target}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
  return { installed: true, already: false, path: target, ...pick(DEFAULT_SOUNDFONT) };
}

const pick = (d) => ({ name: d.name, bytes: d.bytes, sha256: d.sha256, license: d.license });
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

