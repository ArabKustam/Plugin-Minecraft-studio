// Build the installable .plugin artifact (a zip of the plugin root, as used by
// Claude Cowork / the create-cowork-plugin workflow) plus SHA-256 checksums.
//   node scripts/package-plugin.mjs [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../runtime/src/lib/minecraft/resourcepack.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));

// Everything the installed plugin needs at runtime, and nothing else.
const INCLUDE = ['.claude-plugin', '.mcp.json', 'agents', 'skills', 'hooks', 'runtime/dist', 'runtime/package.json', 'studio/web-dashboard', 'schemas', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CHANGELOG.md', '.env.example'];
const EXCLUDE = /(^|\/)(\.DS_Store|Thumbs\.db|node_modules|\.git)(\/|$)/;

function collect(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel} — run the build first (cd runtime && npm run build)`);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((f) => collect(`${rel}/${f}`));
}

const files = INCLUDE.flatMap(collect).filter((f) => !EXCLUDE.test(f));
fs.mkdirSync(outDir, { recursive: true });
const pluginFile = path.join(outDir, `${manifest.name}.plugin`);
const r = writeZip(pluginFile, files.map((f) => ({ name: f, data: fs.readFileSync(path.join(ROOT, f)) })));
const versioned = path.join(outDir, `${manifest.name}-${manifest.version}.plugin`);
fs.copyFileSync(pluginFile, versioned);
const sums = [pluginFile, versioned].map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${path.basename(f)}`).join('\n');
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), `${sums}\n`);
console.log(`${path.relative(ROOT, pluginFile)}  ${(r.bytes / 1024).toFixed(0)} KiB, ${files.length} files\n${sums}`);
