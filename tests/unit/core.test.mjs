import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Studio } from '../../runtime/src/lib/core/studio.js';
import { safeJoin } from '../../runtime/src/lib/core/fsutil.js';
import { scanText, redact } from '../../runtime/src/lib/core/secrets.js';
import { validateTimeline, compileTimeline } from '../../runtime/src/lib/core/timeline.js';
import { validateAgentSpec } from '../../runtime/src/lib/core/factory.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ms-test-'));

function studioWithFile() {
  const dir = tmp();
  const s = new Studio(dir);
  s.ensureLayout();
  s.saveProject({ name: 't' });
  fs.writeFileSync(path.join(dir, 'a.png'), 'v1');
  return { dir, s };
}

test('safeJoin blocks traversal and absolute escapes', () => {
  const root = tmp();
  assert.equal(safeJoin(root, 'a/b.txt'), path.join(root, 'a', 'b.txt'));
  assert.throws(() => safeJoin(root, '../x'), /escapes/);
  assert.throws(() => safeJoin(root, path.resolve(root, '..', 'y')), /escapes/);
  assert.throws(() => safeJoin(root, 'a\0b'), /NUL/);
});

test('asset lifecycle: approval requires passing QA on the current version', () => {
  const { dir, s } = studioWithFile();
  s.createAsset({ id: 'tex.a', type: 'texture', files: ['a.png'], created_by: 'texture-artist' });
  assert.throws(() => s.setAssetStatus('tex.a', 'approved'), /Illegal transition|QA/);
  s.setAssetStatus('tex.a', 'review');
  assert.throws(() => s.setAssetStatus('tex.a', 'approved'), /passing QA/);
  let a = s.recordQa('tex.a', { by: 'visual-qa', verdict: 'fail', summary: 'too bright' });
  assert.equal(a.status, 'changes-requested');
  fs.writeFileSync(path.join(dir, 'a.png'), 'v2');
  a = s.updateAsset('tex.a', { files: ['a.png'] }, { by: 'texture-artist', note: 'darker' });
  assert.equal(a.version, 2);
  assert.equal(a.status, 'draft');
  a = s.recordQa('tex.a', { by: 'visual-qa', verdict: 'pass', summary: 'ok' });
  assert.equal(a.status, 'approved');
  a = s.revertAsset('tex.a', 1);
  assert.equal(a.version, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'a.png'), 'utf8'), 'v1');
  assert.equal(a.status, 'draft');
});

test('integrity detects files modified outside the studio', () => {
  const { dir, s } = studioWithFile();
  s.createAsset({ id: 'tex.b', type: 'texture', files: ['a.png'] });
  assert.equal(s.checkIntegrity().ok, true);
  fs.writeFileSync(path.join(dir, 'a.png'), 'changed');
  assert.equal(s.checkIntegrity().issues[0].kind, 'modified-outside-studio');
});

test('task graph: layers, readiness, cycle rejection, blocked start', () => {
  const { s } = studioWithFile();
  s.upsertTask({ id: 'design', goal: 'g' });
  s.upsertTask({ id: 'tex', goal: 'g', dependencies: ['design'] });
  s.upsertTask({ id: 'sfx', goal: 'g', dependencies: ['design'] });
  s.upsertTask({ id: 'qa', goal: 'g', dependencies: ['tex', 'sfx'] });
  const g = s.graph();
  assert.deepEqual(g.layers.map((l) => l.sort()), [['design'], ['sfx', 'tex'], ['qa']]);
  assert.deepEqual(g.ready, ['design']);
  assert.throws(() => s.upsertTask({ id: 'design', goal: 'g', dependencies: ['qa'] }), /cycle/);
  assert.throws(() => s.setTaskStatus('qa', 'in-progress'), /blocked/);
  s.setTaskStatus('design', 'done');
  assert.deepEqual(s.graph().ready.sort(), ['sfx', 'tex']);
});

test('memory supersedes entries and log redacts secrets', () => {
  const { s } = studioWithFile();
  const a = s.remember({ category: 'decision', title: 'A', content: 'x' });
  s.remember({ category: 'decision', title: 'B', content: 'y', supersedes: a.id });
  assert.deepEqual(s.recall({ category: 'decision' }).map((e) => e.title), ['B']);
  process.env.ELEVENLABS_API_KEY = 'sk_' + 'a'.repeat(48);
  const e = s.log({ event: 'x', message: `key ${process.env.ELEVENLABS_API_KEY}` });
  assert.ok(!e.message.includes('aaaa'));
  delete process.env.ELEVENLABS_API_KEY;
});

test('secret scanning finds tokens without returning values', () => {
  const f = scanText('const k = "ghp_' + 'A'.repeat(36) + '";', 'x.js');
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'GitHub token');
  assert.ok(!JSON.stringify(f).includes('AAAA'));
  assert.equal(redact('token github_pat_' + 'B'.repeat(50)), 'token [REDACTED]');
});

test('timeline validation and compilation to ticks', () => {
  const tl = { id: 'x', duration: 2, tracks: { sfx: [{ t: 0.1, sound: 'a:b' }], state: [{ t: 2, state: 'ON' }], voice: [{ t: 0, line: 'a', duration: 1.5 }, { t: 1, line: 'b' }] } };
  const v = validateTimeline(tl, { soundEvents: ['a:b'] });
  assert.equal(v.verdict, 'warn'); // overlapping voice lines
  const c = compileTimeline(tl);
  assert.equal(c.duration_ticks, 40);
  assert.deepEqual(c.cues.map((q) => q.tick), [0, 2, 20, 40]);
  assert.equal(validateTimeline({ id: 'y', duration: 1, tracks: { sfx: [{ t: 0.5, sound: 'z:missing' }] } }, { soundEvents: [] }).verdict, 'fail');
});

test('agent factory validation enforces contracts', () => {
  const problems = validateAgentSpec({ name: 'x', description: 'short' });
  assert.ok(problems.length >= 4);
  assert.deepEqual(validateAgentSpec({
    name: 'particle-artist', description: 'Use this agent when particle textures and particle JSON definitions are needed for Minecraft effects.',
    specialization: 'particles', input_contract: ['effect brief'], output_contract: ['particle json'], qa_criteria: ['readable'], justification: 'recurring work', tools: ['Read'],
  }), []);
});

test('history archives use short names and revert still works', () => {
  const { dir, s } = studioWithFile();
  fs.mkdirSync(path.join(dir, 'deep/nested/path'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'deep/nested/path/b.png'), 'v1');
  s.createAsset({ id: 'tex.short', type: 'texture', files: ['deep/nested/path/b.png'] });
  fs.writeFileSync(path.join(dir, 'deep/nested/path/b.png'), 'v2');
  const a = s.updateAsset('tex.short', { files: ['deep/nested/path/b.png'] });
  const archived = a.versions.filter((x) => x.archived_dir);
  assert.ok(archived.length > 0);
  for (const v of archived) {
    for (const f of v.files) {
      assert.equal(f.archived, '0-b.png');
      assert.ok(fs.existsSync(path.join(dir, v.archived_dir, f.archived)));
    }
  }
  s.revertAsset('tex.short', archived[0].version);
  assert.equal(fs.readFileSync(path.join(dir, 'deep/nested/path/b.png'), 'utf8'), archived[0].version === 1 ? 'v1' : 'v2');
});

test('plugin option env is accepted as a secret source', async () => {
  const { getSecret } = await import('../../runtime/src/lib/core/secrets.js');
  delete process.env.ELEVENLABS_API_KEY;
  process.env.CLAUDE_PLUGIN_OPTION_ELEVENLABS_API_KEY = 'sk_' + 'b'.repeat(48);
  assert.equal(getSecret('ELEVENLABS_API_KEY'), 'sk_' + 'b'.repeat(48));
  delete process.env.CLAUDE_PLUGIN_OPTION_ELEVENLABS_API_KEY;
  assert.equal(getSecret('ELEVENLABS_API_KEY'), null);
});

test('repository paths stay short enough for Windows plugin installs', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = REPO_ROOT;
  let files;
  try { files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  // ~/.claude/plugins/marketplaces/minecraft-studio/ adds ~60-90 characters; Windows MAX_PATH is 260.
  const long = files.filter((f) => f.length > 140);
  assert.deepEqual(long, []);
});

test('.mcp.json does not reference optional user_config values (an empty one drops the server)', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(REPO_ROOT, '.mcp.json'), 'utf8'), /\$\{user_config\./);
});
