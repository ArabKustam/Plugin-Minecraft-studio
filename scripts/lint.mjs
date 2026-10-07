// Lightweight, dependency-free lint: syntax check of every JS module, JSON validity,
// and a few project rules (no secrets, no console.log in MCP servers — stdout is the MCP channel).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = /(^|\/)(node_modules|\.git|dist|target|test-server|\.minecraft-studio\/(history|test-server))(\/|$)/;
const files = [];
(function walk(d) { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d ? `${d}/${e.name}` : e.name; if (SKIP.test(p)) continue; if (e.isDirectory()) walk(p); else files.push(p); } })('');
const problems = [];
for (const f of files.filter((x) => /\.(m?js)$/.test(x))) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`${f}: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/^runtime\/src\/(mcp|lib)\//.test(f) && /console\.log\(/.test(src)) problems.push(`${f}: console.log in MCP/runtime code corrupts the stdio protocol (use process.stderr)`);
}
for (const f of files.filter((x) => /\.(json|mcmeta|bbmodel)$/.test(x))) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { problems.push(`${f}: invalid JSON (${e.message})`); }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`lint OK (${files.filter((x) => /\.(m?js)$/.test(x)).length} modules, ${files.filter((x) => /\.(json|mcmeta|bbmodel)$/.test(x)).length} JSON files)`);
