import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  StudioError
} from "./chunk-RRZML6EW.mjs";

// src/lib/audio/soundbank.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
var DEFAULT_SOUNDFONT = {
  name: "GeneralUser GS v2.0.3",
  file: "GeneralUser-GS.sf2",
  url: "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2",
  sha256: "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe",
  bytes: 32319396,
  license: "GeneralUser GS License v2.0 \u2014 free for private and commercial music (https://github.com/mrbumpy409/GeneralUser-GS)"
};
function soundfontCacheDir() {
  if (process.env.MINECRAFT_STUDIO_CACHE) return path.join(process.env.MINECRAFT_STUDIO_CACHE, "soundfonts");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "minecraft-studio", "soundfonts");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "minecraft-studio", "soundfonts");
}
function resolveSoundfont({ scorePath, configPath, root } = {}) {
  const pick2 = scorePath || process.env.MINECRAFT_STUDIO_SOUNDFONT || configPath;
  if (pick2) {
    const p2 = path.isAbsolute(pick2) ? pick2 : path.resolve(root || process.cwd(), pick2);
    return { path: p2, source: scorePath ? "score" : process.env.MINECRAFT_STUDIO_SOUNDFONT ? "env" : "config", exists: fs.existsSync(p2) };
  }
  const p = path.join(soundfontCacheDir(), DEFAULT_SOUNDFONT.file);
  return { path: p, source: "default", exists: fs.existsSync(p), default: DEFAULT_SOUNDFONT };
}
async function installDefaultSoundfont({ force = false } = {}) {
  const dir = soundfontCacheDir();
  const target = path.join(dir, DEFAULT_SOUNDFONT.file);
  if (!force && fs.existsSync(target) && sha256File(target) === DEFAULT_SOUNDFONT.sha256) {
    return { installed: true, already: true, path: target, ...pick(DEFAULT_SOUNDFONT) };
  }
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(DEFAULT_SOUNDFONT.url, { redirect: "follow" });
  if (!res.ok) throw new StudioError("E_DOWNLOAD", `Sound bank download failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  if (hash !== DEFAULT_SOUNDFONT.sha256) throw new StudioError("E_DOWNLOAD", `Sound bank checksum mismatch (got ${hash}); nothing was saved`);
  const tmp = `${target}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
  return { installed: true, already: false, path: target, ...pick(DEFAULT_SOUNDFONT) };
}
var pick = (d) => ({ name: d.name, bytes: d.bytes, sha256: d.sha256, license: d.license });
var sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

export {
  DEFAULT_SOUNDFONT,
  resolveSoundfont,
  installDefaultSoundfont
};
