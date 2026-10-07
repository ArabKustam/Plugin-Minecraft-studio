// §71 Demo texture test: a new block must match the existing pack's style; an off-style control must not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpClient, PLUGIN_ROOT } from '../helpers/mcp-client.mjs';

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-style-'));
const tex = new McpClient('studio-texture', { env: { CLAUDE_PROJECT_DIR: project }, cwd: project });
after(() => tex.close());

test('new block matches the pack style; off-style control is rejected', async () => {
  await tex.init();
  const existing = path.join(PLUGIN_ROOT, 'examples/industrial-reactor/art/textures/existing');
  for (const f of fs.readdirSync(existing)) {
    const spec = JSON.parse(fs.readFileSync(path.join(existing, f), 'utf8'));
    const r = await tex.call('texture_render_spec', { spec, output: `pack/assets/demo/textures/block/${f.replace('.pixelspec.json', '.png')}` });
    assert.equal(r.isError, false, JSON.stringify(r.data));
  }
  const profile = await tex.call('texture_style_profile', { pack_dirs: ['pack'] });
  assert.equal(profile.data.texture_count, 6);
  const dir = path.join(PLUGIN_ROOT, 'examples/style-match');
  const score = async (name) => {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, `${name}.pixelspec.json`), 'utf8'));
    await tex.call('texture_render_spec', { spec, output: `new/${name}.png` });
    return (await tex.call('texture_style_compare', { path: `new/${name}.png`, category: 'block' })).data;
  };
  const hatch = await score('reinforced_hatch');
  const control = await score('off_style_control');
  assert.ok(hatch.score >= 75, `hatch ${hatch.score}: ${JSON.stringify(hatch.findings.filter((f) => f.status !== 'ok'))}`);
  assert.ok(control.score < 55, `control ${control.score}`);
  assert.equal(hatch.nearest_references.length > 0, true);
});
