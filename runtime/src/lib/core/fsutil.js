// Filesystem helpers shared by every Minecraft Studio component.
// All writes are atomic (write temp file + rename) so a crash never leaves
// half-written registry JSON behind.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class StudioError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** Resolve the Minecraft project root a tool should operate on. */
export function resolveProjectRoot(explicit) {
  const candidate = explicit || process.env.MINECRAFT_STUDIO_PROJECT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new StudioError('E_PROJECT', `Project directory does not exist: ${resolved}`);
  }
  return resolved;
}

/**
 * Join a user/agent supplied relative path onto a root and refuse anything that
 * escapes the root (path traversal, absolute paths to elsewhere, drive changes).
 */
export function safeJoin(root, rel) {
  if (typeof rel !== 'string' || rel.length === 0) throw new StudioError('E_PATH', 'Empty path');
  if (rel.includes('\0')) throw new StudioError('E_PATH', 'Path contains NUL byte');
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const relative = path.relative(base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new StudioError('E_PATH', `Path escapes project root: ${rel}`);
  }
  return target;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function relPosix(root, abs) {
  return toPosix(path.relative(root, abs));
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (err.code === 'ENOENT') throw new StudioError('E_NOT_FOUND', `File not found: ${file}`);
    throw new StudioError('E_JSON', `Invalid JSON in ${file}: ${err.message}`);
  }
}

export function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJson(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

export function sha256(bufOrFile) {
  const buf = Buffer.isBuffer(bufOrFile) ? bufOrFile : fs.readFileSync(bufOrFile);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,95}$/;
export function assertId(id, what = 'id') {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new StudioError('E_ID', `Invalid ${what} "${id}". Use lowercase letters, digits, "_", "-", "." (max 96 chars).`);
  }
  return id;
}

export function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'item';
}

/** Recursively list files under dir (relative posix paths), skipping heavy/vendor dirs. */
export function walk(dir, { skip = ['.git', 'node_modules', 'build', '.gradle', 'target', 'out', 'run', 'dist'], maxFiles = 20000 } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < maxFiles) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skip.includes(e.name)) stack.push(path.join(cur, e.name));
      } else if (e.isFile()) {
        out.push(toPosix(path.relative(dir, path.join(cur, e.name))));
      }
    }
  }
  return out.sort();
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
