// Bundle every runtime entry point into a self-contained ESM file under
// runtime/dist so the installed plugin needs no `npm install`.
import { build } from 'esbuild';
import fs from 'node:fs';

const entries = {
  'studio-core': 'src/mcp/studio-core.js',
  'studio-texture': 'src/mcp/studio-texture.js',
  'studio-model': 'src/mcp/studio-model.js',
  'studio-audio': 'src/mcp/studio-audio.js',
  'studio-minecraft': 'src/mcp/studio-minecraft.js',
  dashboard: 'src/dashboard/main.js',
  cli: 'src/cli/studio.js',
};

fs.rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: entries,
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: false,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'eof',
  banner: { js: "import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
const sizes = fs.readdirSync('dist').filter((f) => f.endsWith('.mjs')).map((f) => `${f} ${(fs.statSync(`dist/${f}`).size / 1024).toFixed(0)} KiB`);
console.log(sizes.join('\n'));
