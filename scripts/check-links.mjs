// Verify relative links and anchors-free file references in Markdown docs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = /(^|\/)(node_modules|\.git|dist|target|\.minecraft-studio)(\/|$)/;
const md = [];
(function walk(d) { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d ? `${d}/${e.name}` : e.name; if (SKIP.test(p)) continue; if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) md.push(p); } })('');
const broken = [];
for (const f of md) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^(https?:|mailto:|#)/.test(m[1])) continue;
    if (!fs.existsSync(path.resolve(ROOT, path.dirname(f), decodeURIComponent(target)))) broken.push(`${f} → ${m[1]}`);
  }
}
if (broken.length) { console.error(`Broken links:\n${broken.join('\n')}`); process.exit(1); }
console.log(`links OK (${md.length} markdown files)`);
