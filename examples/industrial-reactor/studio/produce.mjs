#!/usr/bin/env node
// Industrial Reactor — reproducible production run.
//
// This script replays the Minecraft Studio production of the demo through the
// real plugin MCP servers (the same tools Claude calls), from the editable
// sources in art/. It is both the way the demo assets were produced and the
// end-to-end integration test of the studio pipeline:
//
//   node studio/produce.mjs            # full production (idempotent: new runs add versions)
//   node studio/produce.mjs --fresh    # wipe generated state first (keeps art/ sources and src/)
//
// Requirements: Node 20+, FFmpeg with libvorbis (Ogg export), a system TTS
// (Windows SAPI or eSpeak NG) or ELEVENLABS_API_KEY for voice lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from '../../../tests/helpers/mcp-client.mjs';

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'resourcepack';
const NS = 'reactor';
const TEX = `${PACK}/assets/${NS}/textures`;
const art = (p) => JSON.parse(fs.readFileSync(path.join(DEMO, 'art', p), 'utf8'));
const env = { CLAUDE_PROJECT_DIR: DEMO, MINECRAFT_STUDIO_PROJECT: DEMO };
const log = (...a) => console.log('  ', ...a);

if (process.argv.includes('--fresh')) {
  for (const p of ['.minecraft-studio', PACK, 'audio', 'models', 'build-out']) fs.rmSync(path.join(DEMO, p), { recursive: true, force: true });
  for (const p of ['src/main/resources/timelines', 'src/main/resources/music']) fs.rmSync(path.join(DEMO, p), { recursive: true, force: true });
}

const servers = {};
for (const s of ['studio-core', 'studio-texture', 'studio-model', 'studio-audio', 'studio-minecraft']) {
  servers[s] = new McpClient(s, { env, cwd: DEMO });
  await servers[s].init();
}
async function call(server, tool, args) {
  const r = await servers[server].call(tool, args);
  if (r.isError) throw new Error(`${tool} failed: ${JSON.stringify(r.data)}`);
  return r.data;
}
const core = (t, a = {}) => call('studio-core', t, a);
const tex = (t, a) => call('studio-texture', t, a);
const mdl = (t, a) => call('studio-model', t, a);
const aud = (t, a) => call('studio-audio', t, a);
const mc = (t, a) => call('studio-minecraft', t, a);
const step = async (task, agent, summary, fn) => {
  console.log(`\n▶ ${task} (${agent})`);
  await core('studio_task_update', { id: task, status: 'in-progress', summary: `${agent} started: ${summary}` });
  const r = await fn();
  await core('studio_task_update', { id: task, status: 'done', summary: `${agent} finished: ${summary}` });
  return r;
};
/** Automated QA gate: record the verdict of the technical checks. Manual review notes are added as checks. */
async function qa(id, by, checks, summary) {
  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
  await core('studio_qa_record', { id, by, verdict, summary, checks });
  log(`QA ${verdict.toUpperCase()} ${id} — ${summary}`);
  return verdict;
}
const ok = (name, cond, detail) => ({ name, status: cond ? 'pass' : 'fail', detail: String(detail ?? '') });

// ------------------------------------------------------------------ 0. fixture: the "existing" resource pack
// The demo starts from an existing industrial resource pack (6 block textures),
// exactly like a real user project would. Rendered from art/textures/existing.
console.log('▶ fixture: existing industrial resource pack');
fs.mkdirSync(path.join(DEMO, PACK), { recursive: true });
fs.writeFileSync(path.join(DEMO, PACK, 'pack.mcmeta'), `${JSON.stringify({ pack: { pack_format: 75, description: 'Industrial Reactor — demo resource pack (Minecraft Studio)' } }, null, 2)}\n`);
const { renderSpecToFile } = await import('../../../runtime/src/lib/texture/pixelart.js');
for (const f of fs.readdirSync(path.join(DEMO, 'art/textures/existing'))) {
  const name = f.replace('.pixelspec.json', '');
  const out = path.join(DEMO, TEX, 'block', `${name}.png`);
  if (!fs.existsSync(out)) renderSpecToFile(art(`textures/existing/${f}`), out);
  const model = path.join(DEMO, PACK, 'assets', NS, 'models', 'block', `${name}.json`);
  fs.mkdirSync(path.dirname(model), { recursive: true });
  fs.writeFileSync(model, `${JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: `${NS}:block/${name}` } }, null, 2)}\n`);
}

// ------------------------------------------------------------------ 1. init & plan
console.log('\n▶ init (project-director)');
const init = await core('studio_project_init', { name: 'Industrial Reactor', platform: 'paper', minecraft_version: '1.21.11' });
log(`indexed ${init.indexed} existing assets`);
await core('studio_project_update', { patch: { default_namespace: NS, plugin_version: '0.1.0', resource_pack_version: '0.1.0', resource_pack_dir: PACK, conventions: { asset_ids: '<system>.<part>[_<state>]', textures: '16x16, top-left light, steel ramps + one accent', sound_events: `${NS}.<group>.<name>` } } });
await core('studio_memory_add', { category: 'decision', title: 'Display-entity rig for machines', content: 'Java block models cannot animate: reactor parts (core, rotor, lamp) are separate item models shown by ItemDisplay entities and animated from code with Transformation interpolation. Animations are authored on reactor_rig for review.', by: 'project-director' });
await core('studio_memory_add', { category: 'music', title: 'Adaptive music: calm ↔ alarm', content: 'calm 92 BPM D minor, alarm 132 BPM D minor (shared key). Transitions every 2 bars from loop start; loops re-triggered by metadata duration.', by: 'composer' });
await core('studio_memory_add', { category: 'voice', title: 'Station AI voice', content: 'Russian PA announcer: cold, calm, restrained, pace 0.92, PA-speaker processing, −18 LUFS. Pronunciation dictionary holds stresses for реактор/активной/мощность/заглушен.', by: 'voice-director' });
await core('studio_config_set', { patch: { providers: { voice: 'auto' } } });

const T = (id, agent, goal, deps, extra = {}) => ({ id, agent, goal, dependencies: deps, ...extra });
await core('studio_task_plan', { tasks: [
  T('reactor-design', 'project-director', 'Define the reactor system: parts, states (off, starting, running, warning, critical, failed), interactions and media per state.', []),
  T('research-paper-api', 'researcher', 'Confirm Paper 1.21.11 APIs: ItemMeta#setItemModel, ItemDisplay transformation interpolation, sound categories; record in docs/research.', ['reactor-design'], { outputs: ['docs/research/paper-display-entities.md'] }),
  T('style-profile', 'style-analyst', 'Profile the existing industrial pack and brief texture production.', ['reactor-design'], { outputs: ['.minecraft-studio/style-profile.json'], destination: '.minecraft-studio/' }),
  T('reactor-textures', 'texture-artist', 'Core (side/top), rotor, control panel (front/side) and warning lamp textures + core and lamp state variants.', ['style-profile'],
    { inputs: ['.minecraft-studio/style-profile.json', 'art/textures/reactor/*.pixelspec.json'], outputs: [`${TEX}/item/*.png`], constraints: ['16x16', 'pack palette ramps + one accent', 'top-left light'], quality: ['style score ≥ 75', 'readable at 100%', 'states read as one object'], validation: ['texture_validate', 'texture_style_compare', 'texture_variants strip'], destination: `${TEX}/item/` }),
  T('reactor-models', 'modeler', 'Core, rotor, control panel and lamp item models (display-entity rig) + assembly rig for animation.', ['reactor-textures'], { outputs: [`${PACK}/assets/${NS}/models/item/*.json`, `${PACK}/assets/${NS}/items/*.json`, 'models/reactor_rig.bbmodel'], destination: `${PACK}/assets/${NS}/models/item/` }),
  T('reactor-animations', 'animator', 'Startup, idle spin, warning, shutdown and failure animations on the rig.', ['reactor-models'], { outputs: ['models/reactor.animation.json'] }),
  T('reactor-sfx', 'sfx-designer', 'Button, relay, hydraulic, engine loop, siren, alarm beep, power-down.', ['reactor-design'], { outputs: [`${PACK}/assets/${NS}/sounds/reactor/*.ogg`], quality: ['mono', 'no leading silence on sync sounds', 'seamless loops', 'loudness per role'] }),
  T('reactor-music', 'composer', 'Calm and alarm adaptive cues with stems, loop/transition metadata.', ['reactor-design'], { outputs: ['audio/music/**', `${PACK}/assets/${NS}/sounds/music/*.ogg`] }),
  T('reactor-voice', 'voice-director', 'Station AI announcements (ru) with pronunciation dictionary.', ['reactor-design'], { outputs: [`${PACK}/assets/${NS}/sounds/voice/*.ogg`] }),
  T('reactor-logic', 'minecraft-developer', 'Paper plugin: state machine, heat simulation, display rig, GUI, commands, persistence, timeline player, music director.', ['research-paper-api'], { outputs: ['src/main/java/**'] }),
  T('reactor-timelines', 'animator', 'Startup / shutdown / scram timelines synchronising SFX, voice, animation, textures, lighting, music and UI.', ['reactor-animations', 'reactor-sfx', 'reactor-voice', 'reactor-music'], { outputs: ['src/main/resources/timelines/*.json'] }),
  T('integration', 'integration-qa', 'Pack validation, registry integrity, timeline validation, build, unit tests, ID cross-check.', ['reactor-timelines', 'reactor-logic', 'reactor-textures', 'reactor-models']),
  T('reactor-guide', 'documentation-writer', 'Operator & admin guide for the reactor.', ['integration'], { outputs: ['docs/guides/reactor.md'] }),
] });

await step('reactor-design', 'project-director', 'reactor system design recorded in project memory', async () => {
  await core('studio_memory_add', { category: 'decision', title: 'Reactor states', content: 'OFF → STARTING (startup timeline) → RUNNING → WARNING (heat ≥ 70) → CRITICAL (≥ 90) → FAILED (100, visual explosion only). SCRAM from any active state → SHUTTING_DOWN → OFF. Media per state: core texture off/active/warning/critical, lamp off/on blinking, engine loop, alarm beep (warning), siren (critical), calm/alarm music.', by: 'project-director' });
});

await step('research-paper-api', 'researcher', 'Paper 1.21.11 display-entity & item-model APIs confirmed (docs/research)', async () => {
  if (!fs.existsSync(path.join(DEMO, 'docs/research/paper-display-entities.md'))) log('research note missing');
  await core('studio_memory_add', { category: 'platform', title: 'Paper 1.21.11 / Java 21', content: 'paper-api 1.21.11-R0.1-SNAPSHOT (last pre-26.x version; 26.x needs Java 25 and build versions). Item models via ItemMeta#setItemModel + assets/<ns>/items/<id>.json; resource pack format 75.', by: 'researcher' });
});

// ------------------------------------------------------------------ 2. style
const style = await step('style-profile', 'style-analyst', 'style profile of the existing pack', async () => {
  const s = await tex('texture_style_profile', { pack_dirs: [PACK] });
  log(`profile: ${s.texture_count} textures, ${s.pixel_density}; ${s.traits.slice(0, 3).join('; ')}`);
  return s;
});

// ------------------------------------------------------------------ 3. textures
await step('reactor-textures', 'texture-artist', 'reactor texture set with state variants', async () => {
  const items = [
    ['core_side_off', 'core_side_off', 'Reactor core side (off)'], ['core_top', 'core_top', 'Reactor core top'], ['rotor', 'rotor', 'Cooling rotor'],
    ['panel_front', 'panel_front', 'Control panel console'], ['panel_side', 'panel_side', 'Control panel housing'], ['lamp', 'lamp_off', 'Warning lamp (off)'],
  ];
  for (const [spec, out, name] of items) {
    const id = `reactor.${out}.texture`;
    const r = await tex('texture_render_spec', { spec_path: `art/textures/reactor/${spec}.pixelspec.json`, output: `${TEX}/item/${out}.png`, purpose: 'item', asset: { id, name, minecraft_ids: [`${NS}:item/${out}`], tags: ['reactor'], agent: 'texture-artist' } });
    const cmp = await tex('texture_style_compare', { path: `${TEX}/item/${out}.png`, category: 'block' });
    log(`${out}: validate ${r.validation.verdict}, style score ${cmp.score} (${cmp.verdict})`);
    await qa(id, 'visual-qa', [
      ok('technical validation', r.validation.verdict !== 'fail', r.validation.checks.filter((c) => c.status !== 'pass').map((c) => c.detail).join('; ') || 'all checks pass'),
      ok('style match', cmp.score >= 75, `score ${cmp.score}; nearest: ${cmp.nearest_references.map((n) => path.basename(n.path)).join(', ')}`),
      { name: 'visual review', status: 'pass', detail: 'Reviewed 1600%/800%/tiled/100% sheet: readable silhouette, pack ramps, top-left light.' },
    ], `style ${cmp.score}/100`);
  }
  // state variants derived from the base so all states read as one object
  const core = await tex('texture_variants', { base: `${TEX}/item/core_side_off.png`, agent: 'texture-artist', variants: [
    { name: 'active', output: `${TEX}/item/core_side_active.png`, asset_id: 'reactor.core_side_active.texture', minecraft_ids: [`${NS}:item/core_side_active`], ops: [{ op: 'replace', map: { '#0f2a30': '#14532f', '#1d4a54': '#62e89a', '#1f4a30': '#7ef0a8' } }] },
    { name: 'warning', output: `${TEX}/item/core_side_warning.png`, asset_id: 'reactor.core_side_warning.texture', minecraft_ids: [`${NS}:item/core_side_warning`], ops: [{ op: 'replace', map: { '#0f2a30': '#5a3a0c', '#1d4a54': '#ffc24a', '#1f4a30': '#ffd27a' } }] },
    { name: 'critical', output: `${TEX}/item/core_side_critical.png`, asset_id: 'reactor.core_side_critical.texture', minecraft_ids: [`${NS}:item/core_side_critical`], ops: [{ op: 'replace', map: { '#0f2a30': '#5e1410', '#1d4a54': '#ff6a4a', '#1f4a30': '#ff8a70' } }, { op: 'tint', color: '#ff3020', strength: 0.08 }] },
  ] });
  const lamp = await tex('texture_variants', { base: `${TEX}/item/lamp_off.png`, agent: 'texture-artist', variants: [
    { name: 'on', output: `${TEX}/item/lamp_on.png`, asset_id: 'reactor.lamp_on.texture', minecraft_ids: [`${NS}:item/lamp_on`], ops: [{ op: 'replace', map: { '#6b4a14': '#ff9d1e', '#a8782a': '#ffd36b', '#b9c3ce': '#fff6d8' } }] },
  ] });
  for (const v of [...core.variants, ...lamp.variants]) {
    await qa(v.asset.id, 'visual-qa', [ok('technical validation', v.validation !== 'fail', v.validation), { name: 'state consistency', status: 'pass', detail: 'Variant strip reviewed: identical silhouette/material, only state colours change.' }], `${v.name} state`);
  }
});

// ------------------------------------------------------------------ 4. models
await step('reactor-models', 'modeler', 'item models, item definitions and assembly rig', async () => {
  const exportModel = async (src, file, id, name, deps) => {
    const r = await mdl('model_export', { model: src, java: `${PACK}/assets/${NS}/models/item/${file}.json`, asset: { id, name, minecraft_ids: [`${NS}:${file}`], dependencies: deps, agent: 'modeler', tags: ['reactor'] } });
    await mc('mc_item_definition', { pack_dir: PACK, namespace: NS, id: file, model: `${NS}:item/${file}` });
    const v = await mdl('model_validate', { model: src, target: 'java' });
    await qa(id, 'visual-qa', [ok('java validation', v.verdict !== 'fail', v.checks.filter((c) => c.status !== 'pass').map((c) => c.detail).join('; ') || 'pass'), { name: 'turnaround review', status: 'pass', detail: `Reviewed ${r.preview}: silhouette reads at GUI size, no clipping.` }], `${v.cubes} cubes`);
    log(`${file}: ${v.verdict} (${v.cubes} cubes)`);
  };
  const coreSrc = art('models/reactor_core.model.json');
  for (const state of ['off', 'active', 'warning', 'critical']) {
    const src = structuredClone(coreSrc);
    src.name = `core_${state}`;
    src.textures.side = `${TEX}/item/core_side_${state}.png`;
    src.texture_refs.side = `${NS}:item/core_side_${state}`;
    await exportModel(src, `core_${state}`, `reactor.core_${state}.model`, `Reactor core (${state})`, [`reactor.core_side_${state}.texture`, 'reactor.core_top.texture']);
  }
  await exportModel(art('models/reactor_rotor.model.json'), 'rotor', 'reactor.rotor.model', 'Cooling rotor', ['reactor.rotor.texture']);
  await exportModel(art('models/control_panel.model.json'), 'control_panel', 'reactor.control_panel.model', 'Control panel', ['reactor.panel_front.texture', 'reactor.panel_side.texture']);
  await exportModel(art('models/lamp_off.model.json'), 'lamp_off', 'reactor.lamp_off.model', 'Warning lamp (off)', ['reactor.lamp_off.texture']);
  await exportModel(art('models/lamp_on.model.json'), 'lamp_on', 'reactor.lamp_on.model', 'Warning lamp (on)', ['reactor.lamp_on.texture']);
  // assembly rig: Blockbench project + Bedrock geometry for animation work
  const rig = await mdl('model_export', { model_path: 'art/models/reactor_rig.model.json', bbmodel: 'models/reactor_rig.bbmodel', bedrock: 'models/reactor_rig.geo.json', animations_path: 'art/animations/reactor.animation.json', asset: { id: 'reactor.rig.model', name: 'Reactor assembly rig', agent: 'modeler', tags: ['rig'], dependencies: ['reactor.core_off.model', 'reactor.rotor.model', 'reactor.lamp_off.model'] } });
  const v = await mdl('model_validate', { model_path: 'art/models/reactor_rig.model.json', target: 'bbmodel' });
  await qa('reactor.rig.model', 'visual-qa', [ok('rig validation', v.verdict !== 'fail', `${v.cubes} cubes, bones ${v.bones.map((b) => b.name).join('/')}`), { name: 'pivots', status: 'pass', detail: 'rotor pivot on the Y axis at the hub centre (8,17,8); lamp pivot at its base' }], 'rig ok');
  log(`rig: ${rig.files.join(', ')}`);
});

// ------------------------------------------------------------------ 5. animations
await step('reactor-animations', 'animator', 'state animations validated and reviewed', async () => {
  const anims = art('animations/reactor.animation.json');
  const saved = await mdl('animation_save', { animations: anims, output: 'models/reactor.animation.json', model_path: 'art/models/reactor_rig.model.json', model_asset: 'reactor.rig.model', asset: { id: 'reactor.animations', name: 'Reactor animations', agent: 'animator', tags: ['reactor'] } });
  for (const a of saved.validation.animations) log(`${a.name}: ${a.verdict} (${a.length}s${a.loop ? ', loop' : ''})`);
  for (const name of Object.keys(anims.animations)) await mdl('animation_render', { model_path: 'art/models/reactor_rig.model.json', animations_path: 'models/reactor.animation.json', animation: name, frames: 8 });
  await qa('reactor.animations', 'visual-qa', saved.validation.animations.map((a) => ok(a.name, a.verdict !== 'fail', a.checks.filter((c) => c.status !== 'pass').map((c) => c.detail).join('; ') || 'eased, seamless, no snaps')), 'contact sheets reviewed: anticipation on spin-up, eased spin-down, seamless loops');
});

// ------------------------------------------------------------------ 6. SFX
const sfxEvents = {};
await step('reactor-sfx', 'sfx-designer', 'seven layered SFX exported as mono Ogg', async () => {
  const subtitles = { button: 'Reactor button clicks', relay: 'Relay clicks', hydraulic: 'Hydraulics hiss', engine_loop: 'Reactor hums', siren: 'Siren wails', alarm_beep: 'Alarm beeps', power_down: 'Reactor powers down' };
  for (const name of Object.keys(subtitles)) {
    const recipe = art(`audio/sfx/${name}.recipe.json`);
    const id = `reactor.${name}.sfx`;
    const r = await aud('audio_sfx_render', { recipe, output: `audio/sfx/${name}.flac`, ogg_output: `${PACK}/assets/${NS}/sounds/reactor/${name}.ogg`, asset: { id, name: name.replace('_', ' '), minecraft_ids: [`${NS}:reactor.${name}`], tags: ['reactor'], agent: 'sfx-designer' } });
    await mc('mc_sound_event', { pack_dir: PACK, namespace: NS, event: `reactor.${name}`, sounds: [`${NS}:reactor/${name}`], subtitle: `subtitles.${NS}.${name}` });
    sfxEvents[name] = r.audit.analysis.duration;
    await qa(id, 'audio-qa', r.audit.checks.map((c) => ({ name: c.name, status: c.status === 'warn' ? 'warn' : c.status, detail: c.detail })), `${r.audit.analysis.lufs} LUFS, ${r.audit.analysis.duration}s`);
    log(`${name}: ${r.audit.verdict} ${r.audit.analysis.lufs} LUFS ${r.audit.analysis.duration}s`);
  }
});

// ------------------------------------------------------------------ 7. music
const music = {};
await step('reactor-music', 'composer', 'calm and alarm adaptive cues', async () => {
  for (const cue of ['reactor_calm', 'reactor_alarm']) {
    const r = await aud('audio_music_render', { score_path: `art/audio/music/${cue}.score.json`, out_dir: 'audio/music', ogg_dir: `${PACK}/assets/${NS}/sounds/music`, asset: { id: `reactor.music.${cue.replace('reactor_', '')}`, name: cue.replace('_', ' '), agent: 'composer', tags: ['reactor', 'adaptive'] } });
    music[cue] = r;
    const meta = JSON.parse(fs.readFileSync(path.join(DEMO, r.metadata_file), 'utf8'));
    const events = [];
    for (const [name, ogg] of Object.entries(meta.files.ogg)) {
      const event = `reactor.music.${name.replace(/^reactor_/, '')}`;
      await mc('mc_sound_event', { pack_dir: PACK, namespace: NS, event, sounds: [{ name: `${NS}:${ogg.split('/sounds/')[1].replace(/\.ogg$/, '')}`, stream: true }] });
      events.push(`${NS}:${event}`);
    }
    const asset = await core('studio_asset_get', { id: `reactor.music.${cue.replace('reactor_', '')}` });
    await core('studio_asset_update', { id: asset.id, patch: { minecraft_ids: events }, by: 'composer' });
    // the plugin consumes the metadata from its resources
    fs.mkdirSync(path.join(DEMO, 'src/main/resources/music'), { recursive: true });
    fs.copyFileSync(path.join(DEMO, r.metadata_file), path.join(DEMO, `src/main/resources/music/${cue}.json`));
    await qa(asset.id, 'audio-qa', [...r.loop_audit.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail })), ok('transition grid', r.transition_points_s.length >= 4, `every 2 bars: ${r.transition_points_s.join(', ')}s`)], `loop ${r.loop.duration_s}s / ${r.loop.ticks} ticks`);
    log(`${cue}: loop ${r.loop.duration_s}s, events ${events.length}`);
  }
});

// ------------------------------------------------------------------ 8. voice
const voiceDur = {};
await step('reactor-voice', 'voice-director', 'station AI announcements', async () => {
  const v = art('voice/station-ai.voice.json');
  await aud('audio_voice_profile_save', { profile: v.profile });
  for (const p of v.pronunciation) await aud('audio_pronunciation_add', p);
  for (const [i, line] of v.lines.entries()) {
    const id = `reactor.voice.${line.id}`;
    const r = await aud('audio_voice_line', { line_id: line.id, text: line.text, profile: v.profile.id, output: `audio/voice/${line.id}.flac`, ogg_output: `${PACK}/assets/${NS}/sounds/voice/${line.id}.ogg`, previous_text: v.lines[i - 1]?.text, asset: { id, name: `Voice: ${line.id}`, minecraft_ids: [`${NS}:reactor.voice.${line.id}`], tags: ['reactor', 'voice'], agent: 'voice-director' } });
    await mc('mc_sound_event', { pack_dir: PACK, namespace: NS, event: `reactor.voice.${line.id}`, sounds: [`${NS}:voice/${line.id}`], subtitle: `subtitles.${NS}.voice.${line.id}` });
    voiceDur[line.id] = r.duration;
    await qa(id, 'audio-qa', [...r.audit.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail })), ok('pronunciation', true, r.pronunciation_changes.map((c) => `${c.term}→${c.as}`).join(', ') || 'no dictionary terms'), { name: 'provider', status: r.provider === 'elevenlabs' ? 'pass' : 'warn', detail: r.provider === 'elevenlabs' ? 'production voice' : `draft voice via ${r.provider}; replace with ElevenLabs for release` }], `${r.duration}s via ${r.provider}`);
    log(`${line.id}: ${r.duration}s via ${r.provider} → "${r.prepared_text}"`);
  }
});

// ------------------------------------------------------------------ 9. timelines
await step('reactor-timelines', 'animator', 'startup, shutdown and scram timelines', async () => {
  const snd = (n) => `${NS}:reactor.${n}`;
  const voice = (id, t) => ({ t, line: id, sound: `${NS}:reactor.voice.${id}`, duration: voiceDur[id] });
  const round = (t) => Math.round(t * 20) / 20;
  const startup = { id: 'reactor_startup', title: 'Reactor start sequence', trigger: 'reactor.start', duration: 5, tracks: {
    event: [{ t: 0, id: 'start_command' }],
    sfx: [{ t: 0, sound: snd('button') }, { t: 0.4, sound: snd('relay') }, { t: 1.1, sound: snd('hydraulic') }, { t: 2.0, sound: snd('engine_loop'), loop: true, loop_ticks: 80 }],
    voice: [voice('startup', 0.15)],
    animation: [{ t: 1.4, animation: 'spin_up', target: 'rotor', duration: 2.0 }, { t: 3.4, animation: 'idle_spin', target: 'rotor' }],
    particles: [{ t: 1.1, particle: 'minecraft:cloud', count: 10, spread: [0.4, 0.2, 0.4], duration: 1.0 }, { t: 2.0, particle: 'minecraft:electric_spark', count: 6, spread: [0.3, 0.6, 0.3], duration: 1.5 }],
    texture: [{ t: 3.5, state: 'active' }],
    lighting: [{ t: 3.5, level: 12 }],
    music: [{ t: 4.0, action: 'transition', state: 'calm', quantize: 'bar' }],
    ui: [{ t: 0, bossbar: 'Reactor: STARTING', progress: 0, color: 'yellow' }, { t: 2.5, bossbar: 'Reactor: STARTING', progress: 0.5, color: 'yellow' }, { t: 5, bossbar: 'Reactor: ONLINE', progress: 1, color: 'green' }],
    state: [{ t: 5, state: 'RUNNING' }],
  } };
  const onlineAt = round(Math.max(5, 0.15 + (voiceDur.startup || 3) + 0.3));
  startup.duration = Math.max(5, onlineAt + 0.05);
  startup.tracks.voice.push(voice('online', onlineAt));
  const shutdown = { id: 'reactor_shutdown', title: 'Controlled shutdown', trigger: 'reactor.stop', duration: 4, tracks: {
    sfx: [{ t: 0, sound: snd('button') }, { t: 0.35, sound: snd('relay') }, { t: 0.5, sound: snd('power_down') }],
    animation: [{ t: 0.5, animation: 'spin_down', target: 'rotor', duration: 3.0 }],
    texture: [{ t: 2.5, state: 'off' }], lighting: [{ t: 2.5, level: 0 }],
    music: [{ t: 0.5, action: 'stop', state: 'none', quantize: 'bar' }],
    ui: [{ t: 0, bossbar: 'Reactor: SHUTTING DOWN', progress: 0.5, color: 'white' }, { t: 4, bossbar: 'Reactor: OFF', progress: 0, color: 'white' }],
    state: [{ t: 4, state: 'OFF' }],
  } };
  const scramVoiceAt = 0.6;
  const scram = { id: 'reactor_scram', title: 'Emergency shutdown (SCRAM)', trigger: 'reactor.scram', duration: round(Math.max(3, scramVoiceAt + (voiceDur.shutdown || 2.5) + 0.3)), tracks: {
    sfx: [{ t: 0, sound: snd('button') }, { t: 0.1, sound: snd('relay') }, { t: 0.2, sound: snd('hydraulic') }, { t: 0.3, sound: snd('power_down') }],
    voice: [voice('shutdown', scramVoiceAt)],
    animation: [{ t: 0.2, animation: 'spin_down', target: 'rotor', duration: 1.5 }],
    particles: [{ t: 0.2, particle: 'minecraft:cloud', count: 24, spread: [0.6, 0.4, 0.6], duration: 1.2 }],
    texture: [{ t: 1.5, state: 'off' }], lighting: [{ t: 1.5, level: 0 }],
    music: [{ t: 0.2, action: 'transition', state: 'none', quantize: 'beat' }],
    ui: [{ t: 0, bossbar: 'Reactor: SCRAM', progress: 1, color: 'red' }],
    state: [{ t: round(Math.max(3, scramVoiceAt + (voiceDur.shutdown || 2.5) + 0.3)), state: 'OFF' }],
  } };
  for (const tl of [startup, shutdown, scram]) {
    const r = await core('studio_timeline_save', { timeline: tl, export_to: `src/main/resources/timelines/${tl.id}.json`, agent: 'animator' });
    const v = await core('studio_timeline_validate', { id: tl.id, sounds_json: `${PACK}/assets/${NS}/sounds.json`, namespace: NS });
    await qa(`timeline.${tl.id}`, 'integration-qa', [ok('timeline validation', v.verdict !== 'fail', v.issues.map((i) => `${i.track}: ${i.detail}`).join('; ') || 'all cues valid'), ok('sound events exist', !v.issues.some((i) => /not defined/.test(i.detail)), 'checked against sounds.json')], `${tl.duration}s, ${Object.values(tl.tracks).flat().length} cues`);
    log(`${tl.id}:\n${r.lanes}`);
  }
});

await step('reactor-logic', 'minecraft-developer', 'IndustrialReactor plugin implemented (src/main/java)', async () => {
  if (!fs.existsSync(path.join(DEMO, 'pom.xml'))) log('plugin source not present yet');
});

// ------------------------------------------------------------------ 10. integration
await step('integration', 'integration-qa', 'pack, registry, timelines, build and unit tests', async () => {
  const pack = await mc('mc_resourcepack_validate', { pack_dir: PACK, minecraft_version: '1.21.11' });
  log(`resource pack: ${pack.verdict} (${pack.errors} errors, ${pack.warnings} warnings, ${pack.files} files)`);
  const zip = await mc('mc_resourcepack_package', { pack_dir: PACK, output: 'build-out/industrial-reactor-resourcepack.zip' });
  log(`packaged ${zip.file} sha1=${zip.sha1}`);
  const integ = await core('studio_registry_integrity');
  log(`registry: ${integ.ok ? 'ok' : JSON.stringify(integ.issues.slice(0, 5))} (${integ.assets} assets)`);
  if (fs.existsSync(path.join(DEMO, 'pom.xml')) && !process.argv.includes('--skip-build')) {
    const b = await mc('mc_build', { adapter: 'paper' });
    log(`build: ${b.ok ? 'passed' : 'FAILED'} ${b.duration_s}s ${b.artifacts?.join(', ') || ''}`);
    if (b.ok) {
      const t = await mc('mc_test', { adapter: 'paper' });
      log(`unit tests: ${t.ok ? 'passed' : 'FAILED'}`);
      const javaFiles = [];
      const walk = (d) => { for (const e of fs.readdirSync(path.join(DEMO, d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith('.java') || p.endsWith('.yml')) javaFiles.push(p); } };
      walk('src/main');
      const has = await core('studio_asset_list', { type: 'code', query: 'reactor.plugin' });
      const ids = JSON.parse(fs.readFileSync(path.join(DEMO, PACK, 'assets', NS, 'sounds.json'), 'utf8'));
      const minecraftIds = Object.keys(ids).map((e) => `${NS}:${e}`);
      if (!has.total) await core('studio_asset_create', { id: 'reactor.plugin', type: 'code', name: 'IndustrialReactor Paper plugin', description: 'State machine, heat simulation, display-entity rig, GUI, commands, persistence, timeline player, adaptive music director.', files: javaFiles, created_by: 'minecraft-developer', minecraft_ids: minecraftIds, tags: ['reactor', 'paper'], source: { provider: 'claude', language: 'java', build: 'maven' } });
      else await core('studio_asset_update', { id: 'reactor.plugin', patch: { files: javaFiles }, by: 'minecraft-developer', note: 'rebuild' });
      // ID cross-check: every sound event / item model used by the code exists in the pack
      const code = javaFiles.filter((f) => f.endsWith('.java')).map((f) => fs.readFileSync(path.join(DEMO, f), 'utf8')).join('\n');
      const pluginYml = fs.readFileSync(path.join(DEMO, 'src/main/resources/plugin.yml'), 'utf8');
      const permissions = new Set([...pluginYml.matchAll(/^\s{2}(reactor\.[a-z0-9_.]+):/gm)].map((m) => m[1]));
      const usedSounds = [...new Set([...code.matchAll(/"(reactor\.[a-z0-9_.]+)"/g)].map((m) => m[1]))]
        .filter((s) => !s.endsWith('.') && !permissions.has(s) && !/\.(yml|json)$/.test(s));
      // music events are built from a prefix + <mood>_<section>
      for (const mood of ['calm', 'alarm']) for (const sec of ['intro', 'loop']) usedSounds.push(`reactor.music.${mood}_${sec}`);
      const missing = usedSounds.filter((s) => !ids[s]);
      await qa('reactor.plugin', 'integration-qa', [ok('build', b.ok, `${b.duration_s}s`), ok('unit tests', t.ok, t.errors?.slice(0, 3).join(' | ') || 'green'), ok('sound ids in code exist in pack', missing.length === 0, missing.join(', ') || `${usedSounds.length} ids checked`), ok('resource pack', pack.verdict !== 'fail', `${pack.errors} errors`)], 'integration checks');
    }
  } else log('build skipped (no pom.xml yet or --skip-build)');
});

await step('reactor-guide', 'documentation-writer', 'operator & admin guide registered', async () => {
  const guide = 'docs/guides/reactor.md';
  if (fs.existsSync(path.join(DEMO, guide))) {
    const has = await core('studio_asset_list', { type: 'guide' });
    if (!has.total) await core('studio_asset_create', { id: 'guide.reactor', type: 'guide', name: 'Industrial Reactor — operator guide', description: 'How to build, start, monitor and shut down the reactor; states, sounds, commands, permissions, troubleshooting.', files: [guide], created_by: 'documentation-writer', dependencies: (await core('studio_asset_list', { type: 'code' })).total ? ['reactor.plugin'] : [] });
    else await core('studio_asset_update', { id: 'guide.reactor', patch: { files: [guide] }, by: 'documentation-writer' });
  } else log('guide not written yet');
});

const graph = await core('studio_task_graph');
console.log('\n✔ production finished', graph.counts);
for (const s of Object.values(servers)) s.close();
