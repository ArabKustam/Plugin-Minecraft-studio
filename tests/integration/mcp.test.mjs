// End-to-end tests through the bundled MCP servers (runtime/dist), exactly as Claude Code runs them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpClient } from '../helpers/mcp-client.mjs';
import { findFfmpeg } from '../../runtime/src/lib/audio/ffmpeg.js';

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-int-'));
const env = { CLAUDE_PROJECT_DIR: project, MINECRAFT_STUDIO_PROJECT: project };
const clients = {};
async function client(name, extraEnv = {}) {
  if (!clients[name]) { clients[name] = new McpClient(name, { env: { ...env, ...extraEnv }, cwd: project }); await clients[name].init(); }
  return clients[name];
}
after(() => { for (const c of Object.values(clients)) c.close(); });

test('all servers start and expose namespaced tools with capability annotations', async () => {
  const expected = { 'studio-core': 'studio_project_init', 'studio-texture': 'texture_render_spec', 'studio-model': 'model_export', 'studio-audio': 'audio_sfx_render', 'studio-minecraft': 'mc_build' };
  for (const [srv, toolName] of Object.entries(expected)) {
    const c = await client(srv);
    const tools = await c.tools();
    const t = tools.find((x) => x.name === toolName);
    assert.ok(t, `${srv} exposes ${toolName}`);
    assert.match(t.description, /\[capability: (read|write|execute|publish)\]/);
    assert.ok(t.inputSchema.properties.project_dir, 'project_dir injected');
  }
});

test('capability gating hides execute tools for read-only servers', async () => {
  const c = new McpClient('studio-minecraft', { env: { ...env, MINECRAFT_STUDIO_CAPABILITIES: 'read' }, cwd: project });
  await c.init();
  const names = (await c.tools()).map((t) => t.name);
  c.close();
  assert.ok(names.includes('mc_resourcepack_validate'));
  assert.ok(!names.includes('mc_build'));
  assert.ok(!names.includes('mc_test_server'));
});

test('vertical slice: init → texture → QA → registry → dashboard data', async () => {
  const core = await client('studio-core');
  const tex = await client('studio-texture');
  const init = await core.call('studio_project_init', { name: 'IT' });
  assert.equal(init.isError, false);
  await core.call('studio_task_plan', { tasks: [{ id: 'tex', goal: 'make a plate', agent: 'texture-artist' }] });
  await core.call('studio_task_update', { id: 'tex', status: 'in-progress', summary: 'texture-artist started' });
  const r = await tex.call('texture_render_spec', { spec: { size: [4, 4], palette: { a: '#404040', b: '#808080' }, rows: ['abab', 'baba', 'abab', 'baba'] }, output: 'pack/assets/it/textures/block/plate.png', asset: { id: 'it.plate', agent: 'texture-artist' } });
  assert.equal(r.isError, false, JSON.stringify(r.data));
  assert.equal(r.images.length, 1, 'preview returned as MCP image content');
  assert.equal(r.data.asset.status, 'draft');
  const approve = await core.call('studio_asset_set_status', { id: 'it.plate', status: 'approved' });
  assert.equal(approve.isError, true, 'cannot approve without QA');
  const qa = await core.call('studio_qa_record', { id: 'it.plate', by: 'visual-qa', verdict: 'pass', summary: 'ok' });
  assert.equal(qa.data.status, 'approved');
  await core.call('studio_task_update', { id: 'tex', status: 'done', summary: 'texture-artist finished' });
  const act = await core.call('studio_activity', { limit: 50 });
  assert.ok(act.data.some((e) => e.event === 'agent.finished' && e.agent === 'texture-artist'));
  assert.ok(fs.existsSync(path.join(project, '.minecraft-studio/sources/it.plate/plate.pixelspec.json')), 'source stored');
});

test('path traversal is rejected by tools', async () => {
  const tex = await client('studio-texture');
  const r = await tex.call('texture_analyze', { path: '../../etc/passwd' });
  assert.equal(r.isError, true);
  assert.equal(r.data.error, 'E_PATH');
});

test('paid providers require explicit cost confirmation', async () => {
  const aud = new McpClient('studio-audio', { env: { ...env, ELEVENLABS_API_KEY: 'sk_' + '0'.repeat(48) }, cwd: project });
  await aud.init();
  const r = await aud.call('audio_sfx_generate_ai', { prompt: 'metal door slam', output: 'audio/x.wav' });
  aud.close();
  assert.equal(r.isError, true);
  assert.equal(r.data.error, 'E_COST');
});

test('audio: preset render + audit (+ Ogg when FFmpeg is available)', async () => {
  const aud = await client('studio-audio');
  const ff = findFfmpeg();
  const r = await aud.call('audio_sfx_render', { preset: 'relay', output: 'audio/relay.wav', ...(ff?.vorbis ? { ogg_output: 'pack/assets/it/sounds/relay.ogg' } : {}), asset: { id: 'it.relay', agent: 'sfx-designer' } });
  assert.equal(r.isError, false, JSON.stringify(r.data));
  assert.ok(r.data.files.length >= 1);
  assert.ok(['pass', 'warn'].includes(r.data.audit.verdict), JSON.stringify(r.data.audit.checks));
});

test('timeline save/validate through core', async () => {
  const core = await client('studio-core');
  const r = await core.call('studio_timeline_save', { timeline: { id: 'it_seq', duration: 1, tracks: { sfx: [{ t: 0, sound: 'it:relay' }], state: [{ t: 1, state: 'ON' }] } }, export_to: 'src/main/resources/timelines/it_seq.json' });
  assert.equal(r.data.saved, true);
  const compiled = JSON.parse(fs.readFileSync(path.join(project, 'src/main/resources/timelines/it_seq.json'), 'utf8'));
  assert.equal(compiled.duration_ticks, 20);
});
