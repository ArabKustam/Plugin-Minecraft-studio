// The demo's editable sources and generated registry must conform to the published JSON Schemas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PLUGIN_ROOT } from '../helpers/mcp-client.mjs';

const require = createRequire(path.join(PLUGIN_ROOT, 'runtime', 'package.json'));
const Ajv = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const compiled = new Map();
const schema = (n) => { if (!compiled.has(n)) compiled.set(n, ajv.compile(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'schemas', `${n}.schema.json`), 'utf8')))); return compiled.get(n); };
const DEMO = path.join(PLUGIN_ROOT, 'examples', 'industrial-reactor');
const files = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => re.test(f)).map((f) => path.join(dir, f)) : []);
const check = (validate, file, data = JSON.parse(fs.readFileSync(file, 'utf8'))) => assert.ok(validate(data), `${path.relative(PLUGIN_ROOT, file)}: ${ajv.errorsText(validate.errors)}`);

test('pixel specs, models, recipes, scores, voice profile conform', () => {
  const art = path.join(DEMO, 'art');
  const map = [['pixel-spec', /\.pixelspec\.json$/], ['model', /\.model\.json$/], ['sfx-recipe', /\.recipe\.json$/], ['music-score', /\.score\.json$/]];
  let n = 0;
  for (const [s, re] of map) { const v = schema(s); for (const f of files(art, re)) { check(v, f); n++; } }
  check(schema('voice-profile'), path.join(art, 'voice/station-ai.voice.json'), JSON.parse(fs.readFileSync(path.join(art, 'voice/station-ai.voice.json'), 'utf8')).profile);
  assert.ok(n >= 25, `checked ${n} sources`);
});

test('generated registry state conforms (when the demo has been produced)', (t) => {
  const st = path.join(DEMO, '.minecraft-studio');
  if (!fs.existsSync(st)) return t.skip('run examples/industrial-reactor/studio/produce.mjs first');
  const asset = schema('asset');
  for (const f of files(path.join(st, 'assets'), /\.json$/)) check(asset, f);
  const task = schema('task'); const tl = schema('timeline');
  for (const f of files(path.join(st, 'tasks'), /\.json$/)) check(task, f);
  for (const f of files(path.join(st, 'timelines'), /\.json$/)) check(tl, f);
  const act = schema('activity');
  for (const line of fs.readFileSync(path.join(st, 'logs/activity.jsonl'), 'utf8').split('\n').filter(Boolean).slice(0, 500)) assert.ok(act(JSON.parse(line)), ajv.errorsText(act.errors));
});
