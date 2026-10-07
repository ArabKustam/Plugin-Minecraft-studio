import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  isPowerOfTwo,
  readPng
} from "./chunk-3P6ZCJ33.mjs";
import {
  StudioError,
  ensureDir,
  exists,
  readJson,
  sha1,
  walk,
  writeJson
} from "./chunk-5XAWRH4I.mjs";

// src/lib/minecraft/resourcepack.js
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
var NS_RE = /^[a-z0-9_.-]+$/;
var PATH_RE = /^[a-z0-9_./-]+$/;
var PACK_FORMATS = { "1.20.4": 22, "1.20.6": 32, "1.21": 34, "1.21.1": 34, "1.21.3": 42, "1.21.4": 46, "1.21.5": 55, "1.21.6": 63, "1.21.7": 64, "1.21.8": 64, "1.21.9": 69, "1.21.10": 69, "1.21.11": 75, "26.1": 84, "26.2": 88 };
function parseLocation(loc, defaultNs = "minecraft") {
  const [ns, p] = loc.includes(":") ? loc.split(":", 2) : [defaultNs, loc];
  return { ns, path: p };
}
function validateResourcePack(packDir, { minecraftVersion = null } = {}) {
  const issues = [];
  const add = (severity, kind, file, detail) => issues.push({ severity, kind, file, detail });
  if (!exists(path.join(packDir, "pack.mcmeta"))) {
    add("error", "pack.mcmeta", "pack.mcmeta", "missing pack.mcmeta");
    return summarize(issues, {});
  }
  let meta;
  try {
    meta = readJson(path.join(packDir, "pack.mcmeta"));
  } catch (e) {
    add("error", "pack.mcmeta", "pack.mcmeta", e.message);
    return summarize(issues, {});
  }
  const pack = meta.pack || {};
  const hasRange = pack.min_format !== void 0 || pack.max_format !== void 0;
  if (pack.pack_format === void 0 && !hasRange) add("error", "pack.mcmeta", "pack.mcmeta", "needs pack_format (\u22641.21.8) or min_format/max_format (1.21.9+)");
  if (minecraftVersion && PACK_FORMATS[minecraftVersion]) {
    const want = PACK_FORMATS[minecraftVersion];
    const major = (v) => Array.isArray(v) ? v[0] : v;
    const ok = pack.pack_format === want || hasRange && major(pack.min_format) <= want && major(pack.max_format) >= want || pack.supported_formats && rangeIncludes(pack.supported_formats, want);
    if (!ok) add("warning", "pack.mcmeta", "pack.mcmeta", `pack format does not cover Minecraft ${minecraftVersion} (format ${want})`);
  }
  if (!pack.description) add("info", "pack.mcmeta", "pack.mcmeta", "no description");
  const files = walk(packDir, { skip: [".git"] }).filter((f) => f.startsWith("assets/"));
  const fileSet = new Set(files);
  const namespaces = [...new Set(files.map((f) => f.split("/")[1]))];
  for (const ns of namespaces) if (!NS_RE.test(ns)) add("error", "naming", `assets/${ns}`, `invalid namespace "${ns}" (lowercase a-z 0-9 _ . - only)`);
  for (const f of files) {
    const rest = f.split("/").slice(2).join("/");
    if (!PATH_RE.test(rest)) add("error", "naming", f, "invalid characters in resource path (lowercase a-z 0-9 _ . - / only)");
  }
  const has = (ns, sub, p, ext) => fileSet.has(`assets/${ns}/${sub}/${p}${ext}`) || ns === "minecraft";
  const used = { textures: /* @__PURE__ */ new Set(), models: /* @__PURE__ */ new Set(), sounds: /* @__PURE__ */ new Set() };
  for (const f of files.filter((x) => /^assets\/[^/]+\/models\/.+\.json$/.test(x))) {
    let model;
    try {
      model = readJson(path.join(packDir, f));
    } catch (e) {
      add("error", "json", f, e.message);
      continue;
    }
    if (model.parent && !model.parent.startsWith("builtin/")) {
      const loc = parseLocation(model.parent, "minecraft");
      if (!has(loc.ns, "models", loc.path, ".json")) add("error", "missing-parent", f, `parent ${model.parent} not found`);
      used.models.add(`${loc.ns}:${loc.path}`);
    }
    for (const [key, val] of Object.entries(model.textures || {})) {
      if (typeof val !== "string" || val.startsWith("#")) continue;
      const loc = parseLocation(val, "minecraft");
      used.textures.add(`${loc.ns}:${loc.path}`);
      if (!has(loc.ns, "textures", loc.path, ".png")) add("error", "missing-texture", f, `texture "${key}" \u2192 ${val} not found`);
    }
    for (const [i, el] of (model.elements || []).entries()) {
      for (const [face, def] of Object.entries(el.faces || {})) {
        if (def.texture && def.texture.startsWith("#") && !(def.texture.slice(1) in (model.textures || {})) && !model.parent) add("error", "unbound-texture-variable", f, `element ${i} face ${face} uses ${def.texture} which is not defined`);
      }
      if ([...el.from || [], ...el.to || []].some((v) => v < -16 || v > 32)) add("error", "model-bounds", f, `element ${i} outside -16..32`);
    }
  }
  for (const f of files.filter((x) => /^assets\/[^/]+\/items\/.+\.json$/.test(x))) {
    let def;
    try {
      def = readJson(path.join(packDir, f));
    } catch (e) {
      add("error", "json", f, e.message);
      continue;
    }
    for (const ref of collectModelRefs(def.model)) {
      const loc = parseLocation(ref, "minecraft");
      used.models.add(`${loc.ns}:${loc.path}`);
      if (!has(loc.ns, "models", loc.path, ".json")) add("error", "missing-model", f, `item definition references missing model ${ref}`);
    }
  }
  for (const f of files.filter((x) => /^assets\/[^/]+\/blockstates\/.+\.json$/.test(x))) {
    let bs;
    try {
      bs = readJson(path.join(packDir, f));
    } catch (e) {
      add("error", "json", f, e.message);
      continue;
    }
    const refs = [];
    for (const v of Object.values(bs.variants || {})) for (const m of [].concat(v)) refs.push(m.model);
    for (const part of bs.multipart || []) for (const m of [].concat(part.apply)) refs.push(m.model);
    for (const ref of refs.filter(Boolean)) {
      const loc = parseLocation(ref, "minecraft");
      used.models.add(`${loc.ns}:${loc.path}`);
      if (!has(loc.ns, "models", loc.path, ".json")) add("error", "missing-model", f, `blockstate references missing model ${ref}`);
    }
  }
  for (const f of files.filter((x) => /^assets\/[^/]+\/sounds\.json$/.test(x))) {
    const ns = f.split("/")[1];
    let sj;
    try {
      sj = readJson(path.join(packDir, f));
    } catch (e) {
      add("error", "json", f, e.message);
      continue;
    }
    for (const [event, def] of Object.entries(sj)) {
      if (!PATH_RE.test(event)) add("error", "naming", f, `invalid sound event name ${event}`);
      for (const s of def.sounds || []) {
        const name = typeof s === "string" ? s : s.name;
        if (typeof s === "object" && s.type === "event") continue;
        const loc = parseLocation(name, ns);
        used.sounds.add(`${loc.ns}:${loc.path}`);
        if (!fileSet.has(`assets/${loc.ns}/sounds/${loc.path}.ogg`) && loc.ns !== "minecraft") add("error", "missing-sound", f, `${event} \u2192 ${name}.ogg not found`);
      }
    }
  }
  for (const f of files.filter((x) => /^assets\/[^/]+\/textures\/.+\.png$/.test(x))) {
    let img;
    try {
      img = readPng(path.join(packDir, f));
    } catch (e) {
      add("error", "png", f, e.message);
      continue;
    }
    const strip = img.height > img.width && img.height % img.width === 0;
    if (strip && !fileSet.has(`${f}.mcmeta`) && !/textures\/(gui|font|colormap|misc|environment|painting|map|trims|effect|mob_effect)\//.test(f)) add("warning", "animation", f, `${img.width}\xD7${img.height} looks like an animation strip but has no .mcmeta`);
    if (!isPowerOfTwo(img.width) && /textures\/(block|item)\//.test(f)) add("warning", "texture-size", f, `width ${img.width} is not a power of two`);
    const ns = f.split("/")[1];
    const loc = `${ns}:${f.split("/").slice(3).join("/").replace(/\.png$/, "")}`;
    if (!used.textures.has(loc) && /textures\/(block|item)\//.test(f)) add("info", "orphan-texture", f, "not referenced by any model in this pack");
  }
  for (const f of files.filter((x) => /^assets\/[^/]+\/sounds\/.+$/.test(x))) {
    if (!f.endsWith(".ogg")) {
      add("error", "sound-format", f, "sound files must be .ogg (Vorbis)");
      continue;
    }
    const ns = f.split("/")[1];
    const loc = `${ns}:${f.split("/").slice(3).join("/").replace(/\.ogg$/, "")}`;
    if (!used.sounds.has(loc)) add("info", "orphan-sound", f, "not referenced by sounds.json");
  }
  return summarize(issues, { namespaces, files: files.length, pack });
}
function rangeIncludes(sf, v) {
  if (Array.isArray(sf)) return sf[0] <= v && v <= sf[1];
  if (typeof sf === "number") return sf === v;
  return sf.min_inclusive <= v && v <= sf.max_inclusive;
}
function collectModelRefs(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type && /(^|:)model$/.test(node.type) && typeof node.model === "string") out.push(node.model);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => collectModelRefs(x, out));
    else if (v && typeof v === "object") collectModelRefs(v, out);
  }
  return out;
}
function summarize(issues, info) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return { verdict: errors ? "fail" : warnings ? "warn" : "pass", errors, warnings, ...info, issues };
}
function upsertSoundEvent(packDir, ns, event, { sounds, subtitle = null, replace = false }) {
  if (!NS_RE.test(ns) || !PATH_RE.test(event)) throw new StudioError("E_NAME", `Invalid namespace/event ${ns}:${event}`);
  const file = path.join(packDir, "assets", ns, "sounds.json");
  const sj = readJson(file, {});
  sj[event] = { ...replace ? { replace: true } : {}, ...subtitle ? { subtitle } : {}, sounds };
  writeJson(file, sj);
  return { file, event: `${ns}:${event}` };
}
function writeItemDefinition(packDir, ns, id, modelRef, extra = {}) {
  const file = path.join(packDir, "assets", ns, "items", `${id}.json`);
  writeJson(file, { model: { type: "minecraft:model", model: modelRef }, ...extra });
  return file;
}
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function writeZip(outFile, entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = 1 << 5 | 1;
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = Buffer.from(e.name.replace(/\\/g, "/"), "utf8");
    const raw = e.data;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(67324752, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(2048, 6);
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(33639248, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(2048, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  ensureDir(path.dirname(outFile));
  const zip = Buffer.concat([...locals, cd, end]);
  fs.writeFileSync(outFile, zip);
  return { file: outFile, bytes: zip.length, sha1: sha1(zip), entries: entries.length };
}
function packageResourcePack(packDir, outFile) {
  const files = walk(packDir, { skip: [".git", "node_modules"] }).filter((f) => !/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(f));
  if (!files.includes("pack.mcmeta")) throw new StudioError("E_PACK", "pack.mcmeta missing; not a resource pack");
  return writeZip(outFile, files.map((f) => ({ name: f, data: fs.readFileSync(path.join(packDir, f)) })));
}

export {
  PACK_FORMATS,
  validateResourcePack,
  upsertSoundEvent,
  writeItemDefinition,
  writeZip,
  packageResourcePack
};
