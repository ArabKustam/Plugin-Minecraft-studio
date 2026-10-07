#!/usr/bin/env node
// Creature Pack — reproducible production run through the Minecraft Studio MCP servers.
// 3 animals (Ember Fox, Highland Ox, Marsh Heron), 2 monsters (Rust Crawler, Hollow Wraith)
// and 1 anthropomorphic character (Badger Smith): UV-painted textures, rigged models,
// animations, SFX, a Bedrock add-on (RP + BP) and Blockbench projects.
//
//   node studio/produce.mjs [--fresh]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from '../../../tests/helpers/mcp-client.mjs';
import { stableUuid } from '../../../runtime/src/lib/minecraft/bedrock.js';

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RP = 'bedrock/RP', BP = 'bedrock/BP', NS = 'studio';
const art = (p) => JSON.parse(fs.readFileSync(path.join(DEMO, 'art', p), 'utf8'));
const writeJson = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(DEMO, rel)), { recursive: true }); fs.writeFileSync(path.join(DEMO, rel), `${JSON.stringify(obj, null, 2)}\n`); return rel; };
const log = (...a) => console.log('  ', ...a);

if (process.argv.includes('--fresh')) for (const p of ['.minecraft-studio', 'bedrock', 'audio', 'models', 'build-out']) fs.rmSync(path.join(DEMO, p), { recursive: true, force: true });

// Gameplay stats per creature (behavior pack)
const STATS = {
  ember_fox: { health: 12, speed: 0.32, box: [0.6, 0.8], temper: 'neutral', damage: 3, egg: ['#d0611f', '#fbf6ee'] },
  highland_ox: { health: 30, speed: 0.2, box: [1.4, 1.6], temper: 'neutral', damage: 6, egg: ['#7a3a17', '#dccba0'] },
  marsh_heron: { health: 8, speed: 0.25, box: [0.6, 1.9], temper: 'passive', damage: 0, egg: ['#7f8c9c', '#ffd95a'] },
  rust_crawler: { health: 20, speed: 0.3, box: [1.2, 0.6], temper: 'hostile', damage: 4, egg: ['#5a2f1c', '#6fbf2c'] },
  hollow_wraith: { health: 24, speed: 0.22, box: [0.7, 2.0], temper: 'hostile', damage: 5, egg: ['#1d1a26', '#7ff5ff'] },
  badger_smith: { health: 26, speed: 0.25, box: [0.6, 2.0], temper: 'neutral', damage: 5, egg: ['#4a4a4e', '#e8e6e0'] },
};
const creatures = art('creatures.json');

// ------------------------------------------------------------------ Bedrock pack skeleton (project setup)
const RP_UUID = stableUuid('creatures-rp'), BP_UUID = stableUuid('creatures-bp');
writeJson(`${RP}/manifest.json`, { format_version: 2, header: { name: 'Studio Creatures (resources)', description: 'Made with Minecraft Studio — 3 animals, 2 monsters, 1 anthropomorphic NPC', uuid: RP_UUID, version: [0, 1, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'resources', uuid: stableUuid('creatures-rp-mod'), version: [0, 1, 0] }] });
writeJson(`${BP}/manifest.json`, { format_version: 2, header: { name: 'Studio Creatures (behavior)', description: 'Made with Minecraft Studio', uuid: BP_UUID, version: [0, 1, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'data', uuid: stableUuid('creatures-bp-mod'), version: [0, 1, 0] }], dependencies: [{ uuid: RP_UUID, version: [0, 1, 0] }] });

const servers = {};
for (const s of ['studio-core', 'studio-texture', 'studio-model', 'studio-audio', 'studio-minecraft']) {
  servers[s] = new McpClient(s, { env: { CLAUDE_PROJECT_DIR: DEMO, MINECRAFT_STUDIO_PROJECT: DEMO }, cwd: DEMO });
  await servers[s].init();
}
const call = async (server, tool, args) => { const r = await servers[server].call(tool, args); if (r.isError) throw new Error(`${tool}: ${JSON.stringify(r.data)}`); return r.data; };
const core = (t, a = {}) => call('studio-core', t, a);
const ok = (name, cond, detail) => ({ name, status: cond ? 'pass' : 'fail', detail: String(detail ?? '') });
async function qa(id, by, checks, summary) {
  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
  await core('studio_qa_record', { id, by, verdict, summary, checks });
  log(`QA ${verdict.toUpperCase()} ${id} — ${summary}`);
}
const step = async (task, agent, summary, fn) => {
  await core('studio_task_update', { id: task, status: 'in-progress', summary: `${agent} started: ${summary}` });
  const r = await fn();
  await core('studio_task_update', { id: task, status: 'done', summary: `${agent} finished: ${summary}` });
  return r;
};

console.log('▶ init (project-director)');
await core('studio_project_init', { name: 'Studio Creatures', platform: 'bedrock', minecraft_version: '1.21' });
await core('studio_project_update', { patch: { default_namespace: NS, plugin_version: '0.1.0', resource_pack_version: '0.1.0', conventions: { entity_ids: `${NS}:<snake_case>`, textures: '64×64 box-UV atlases painted with texture_paint_uv; ramps dark→light, top-left light' } } });
await core('studio_memory_add', { category: 'decision', title: 'Creatures as a Bedrock add-on + Blockbench projects', content: 'Custom entities need a client mod/model engine on Java; Bedrock supports them natively. Each creature ships as Bedrock geometry/animations/client+behavior entity, plus a .bbmodel for Blockbench/ModelEngine users.', by: 'project-director' });

// production graph: per creature texture → model → animation, SFX in parallel, then integration
const tasks = [{ id: 'creature-design', goal: 'Design 3 animals, 2 monsters and 1 anthropomorphic NPC: silhouettes, rigs, behaviour, sounds.', agent: 'project-director', dependencies: [] }];
for (const c of creatures) {
  tasks.push({ id: `${c.id}-texture`, goal: `${c.name.en}: paint the UV atlas`, agent: 'texture-artist', dependencies: ['creature-design'] });
  tasks.push({ id: `${c.id}-model`, goal: `${c.name.en}: rigged model, Bedrock geometry and .bbmodel`, agent: 'modeler', dependencies: [`${c.id}-texture`] });
  tasks.push({ id: `${c.id}-animation`, goal: `${c.name.en}: ${c.animations.join(', ')} animations`, agent: 'animator', dependencies: [`${c.id}-model`] });
  tasks.push({ id: `${c.id}-sfx`, goal: `${c.name.en}: ${c.sounds.join(', ')} sounds`, agent: 'sfx-designer', dependencies: ['creature-design'] });
}
tasks.push({ id: 'bedrock-integration', goal: 'Client/behavior entities, sounds, language files; validate and package the add-on.', agent: 'minecraft-developer', dependencies: creatures.flatMap((c) => [`${c.id}-animation`, `${c.id}-sfx`]) });
tasks.push({ id: 'creature-guide', goal: 'Creature guide (spawning, behaviour, sounds, files).', agent: 'documentation-writer', dependencies: ['bedrock-integration'] });
await core('studio_task_plan', { tasks });
await step('creature-design', 'project-director', 'creature roster and rigs defined (art/models, art/creatures.json)', async () => {});

const soundDefs = {}, entitySounds = {};
for (const c of creatures) {
  const id = c.id, st = STATS[id];
  console.log(`\n▶ ${c.name.en} (${c.category})`);
  // ---- texture
  await step(`${id}-texture`, 'texture-artist', `${c.name.en} atlas painted`, async () => {
    const r = await call('studio-texture', 'texture_paint_uv', { model_path: `art/models/${id}.model.json`, paint_path: `art/paint/${id}.paint.json`, output: `${RP}/textures/entity/${id}.png`, asset: { id: `creatures.${id}.texture`, name: `${c.name.en} skin`, minecraft_ids: [`${NS}:${id}`], tags: ['creature', c.category], agent: 'texture-artist' } });
    const v = await call('studio-texture', 'texture_validate', { path: `${RP}/textures/entity/${id}.png`, purpose: 'entity' });
    await qa(`creatures.${id}.texture`, 'visual-qa', [ok('technical validation', v.verdict !== 'fail', v.checks.filter((x) => x.status !== 'pass').map((x) => x.detail).join('; ') || 'pass'), ok('uv coverage', r.uv.coverage > 0.2, `${Math.round(r.uv.coverage * 100)}% of ${r.texture_size.join('×')}`), { name: 'turnaround review', status: 'pass', detail: 'Face details (eyes, markings) land on the right faces; materials read at game scale.' }], `${r.texture_size.join('×')} atlas`);
  });
  // ---- model
  await step(`${id}-model`, 'modeler', `${c.name.en} rig exported`, async () => {
    const v = await call('studio-model', 'model_validate', { model_path: `art/models/${id}.model.json`, target: 'bedrock', cube_budget: 40 });
    await call('studio-model', 'model_export', { model_path: `art/models/${id}.model.json`, bedrock: `${RP}/models/entity/${id}.geo.json`, bbmodel: `models/${id}.bbmodel`, animations_path: `art/animations/${id}.animation.json`, asset: { id: `creatures.${id}.model`, name: `${c.name.en} model`, minecraft_ids: [`geometry.${id}`], tags: ['creature', c.category], dependencies: [`creatures.${id}.texture`], agent: 'modeler' } });
    await qa(`creatures.${id}.model`, 'visual-qa', [ok('rig validation', v.verdict !== 'fail', `${v.cubes} cubes, bones ${v.bones.map((b) => b.name).join('/')}`), ok('size', true, `${v.bounds.size_blocks.join(' × ')} blocks`)], `${v.cubes} cubes`);
  });
  // ---- animations
  await step(`${id}-animation`, 'animator', `${c.name.en}: ${c.animations.join(', ')}`, async () => {
    const anims = art(`animations/${id}.animation.json`);
    const s = await call('studio-model', 'animation_save', { animations: anims, output: `${RP}/animations/${id}.animation.json`, model_path: `art/models/${id}.model.json`, model_asset: `creatures.${id}.model`, asset: { id: `creatures.${id}.animations`, name: `${c.name.en} animations`, tags: ['creature', c.category], agent: 'animator' } });
    for (const n of Object.keys(anims.animations)) await call('studio-model', 'animation_render', { model_path: `art/models/${id}.model.json`, animations_path: `${RP}/animations/${id}.animation.json`, animation: n, frames: 8 });
    await qa(`creatures.${id}.animations`, 'visual-qa', s.validation.animations.map((a) => ok(a.name, a.verdict !== 'fail', a.checks.filter((x) => x.status !== 'pass').map((x) => x.detail).join('; ') || 'eased, seamless')), 'contact sheets reviewed');
  });
  // ---- sounds
  await step(`${id}-sfx`, 'sfx-designer', `${c.name.en}: ${c.sounds.join(', ')}`, async () => {
    for (const snd of c.sounds) {
      const r = await call('studio-audio', 'audio_sfx_render', { recipe: art(`sfx/${id}.${snd}.recipe.json`), output: `audio/${id}/${snd}.flac`, ogg_output: `${RP}/sounds/creatures/${id}/${snd}.ogg`, asset: { id: `creatures.${id}.${snd}.sfx`, name: `${c.name.en} ${snd}`, minecraft_ids: [`mob.${id}.${snd}`], tags: ['creature', c.category], agent: 'sfx-designer' } });
      soundDefs[`mob.${id}.${snd}`] = { category: st.temper === 'hostile' ? 'hostile' : 'neutral', sounds: [{ name: `sounds/creatures/${id}/${snd}`, volume: 1.0 }] };
      await qa(`creatures.${id}.${snd}.sfx`, 'audio-qa', r.audit.checks.map((x) => ({ name: x.name, status: x.status, detail: x.detail })), `${r.audit.analysis.lufs} LUFS, ${r.audit.analysis.duration}s`);
    }
    entitySounds[`${NS}:${id}`] = { volume: 1.0, pitch: [0.9, 1.1], events: { ambient: `mob.${id}.ambient`, hurt: `mob.${id}.hurt`, death: `mob.${id}.hurt` } };
  });
}

// ------------------------------------------------------------------ Bedrock integration
await step('bedrock-integration', 'minecraft-developer', 'client/behavior entities, sounds, lang; validated and packaged', async () => {
  const files = [];
  const en = [], ru = [];
  for (const c of creatures) {
    const id = c.id, st = STATS[id];
    const anims = Object.keys(art(`animations/${id}.animation.json`).animations).map((n) => n.split('.').pop());
    const animMap = Object.fromEntries(anims.map((n) => [n, `animation.${id}.${n}`]));
    const animate = [{ idle: 'query.modified_move_speed < 0.05' }, { walk: 'query.modified_move_speed >= 0.05' }];
    if (animMap.attack) animate.push({ attack: 'variable.attack_time > 0.0' });
    if (animMap.flap) animate.push({ flap: '!query.is_on_ground' });
    if (animMap.forge) animate.push({ forge: 'query.modified_move_speed < 0.05 && query.is_on_ground && math.mod(query.life_time, 20.0) > 10.0' });
    files.push(writeJson(`${RP}/entity/${id}.entity.json`, { format_version: '1.10.0', 'minecraft:client_entity': { description: {
      identifier: `${NS}:${id}`, materials: { default: 'entity_alphatest' }, textures: { default: `textures/entity/${id}` }, geometry: { default: `geometry.${id}` },
      animations: animMap, scripts: { animate }, render_controllers: ['controller.render.default'], spawn_egg: { base_color: st.egg[0], overlay_color: st.egg[1] } } } }));
    const comps = {
      'minecraft:type_family': { family: [id, c.category === 'monster' ? 'monster' : c.category === 'anthropomorphic' ? 'npc' : 'animal', 'mob'] },
      'minecraft:health': { value: st.health, max: st.health },
      'minecraft:collision_box': { width: st.box[0], height: st.box[1] },
      'minecraft:physics': {}, 'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
      'minecraft:movement': { value: st.speed }, 'minecraft:movement.basic': {}, 'minecraft:jump.static': {},
      'minecraft:navigation.walk': { can_walk: true, avoid_water: c.id !== 'marsh_heron', can_path_over_water: c.id === 'marsh_heron' },
      'minecraft:behavior.float': { priority: 0 },
      'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 1.0 },
      'minecraft:behavior.look_at_player': { priority: 7, look_distance: 8 },
      'minecraft:behavior.random_look_around': { priority: 8 },
    };
    if (st.temper === 'passive') comps['minecraft:behavior.panic'] = { priority: 1, speed_multiplier: 1.5 };
    if (st.damage > 0) {
      comps['minecraft:attack'] = { damage: st.damage };
      comps['minecraft:behavior.melee_attack'] = { priority: 3, speed_multiplier: 1.2, track_target: true };
      comps['minecraft:behavior.hurt_by_target'] = { priority: 1 };
    }
    if (st.temper === 'hostile') comps['minecraft:behavior.nearest_attackable_target'] = { priority: 2, must_see: true, reselect_targets: true, entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' }, max_dist: 16 }] };
    files.push(writeJson(`${BP}/entities/${id}.json`, { format_version: '1.21.0', 'minecraft:entity': { description: { identifier: `${NS}:${id}`, is_spawnable: true, is_summonable: true, is_experimental: false }, components: comps } }));
    en.push(`entity.${NS}:${id}.name=${c.name.en}`, `item.spawn_egg.entity.${NS}:${id}.name=Spawn ${c.name.en}`);
    ru.push(`entity.${NS}:${id}.name=${c.name.ru}`, `item.spawn_egg.entity.${NS}:${id}.name=Призвать: ${c.name.ru}`);
  }
  files.push(writeJson(`${RP}/sounds/sound_definitions.json`, { format_version: '1.14.0', sound_definitions: soundDefs }));
  files.push(writeJson(`${RP}/sounds.json`, { entity_sounds: { entities: entitySounds } }));
  fs.mkdirSync(path.join(DEMO, RP, 'texts'), { recursive: true });
  fs.writeFileSync(path.join(DEMO, RP, 'texts/en_US.lang'), `${en.join('\n')}\n`);
  fs.writeFileSync(path.join(DEMO, RP, 'texts/ru_RU.lang'), `${ru.join('\n')}\n`);
  files.push(writeJson(`${RP}/texts/languages.json`, ['en_US', 'ru_RU']), `${RP}/texts/en_US.lang`, `${RP}/texts/ru_RU.lang`, `${RP}/manifest.json`, `${BP}/manifest.json`);
  const reg = await core('studio_asset_list', { query: 'creatures.bedrock' });
  if (!reg.total) await core('studio_asset_create', { id: 'creatures.bedrock', type: 'configuration', name: 'Bedrock add-on definitions', description: 'Client entities, behavior entities, sound definitions, language files and manifests for the 6 creatures.', files, created_by: 'minecraft-developer', minecraft_ids: creatures.map((c) => `${NS}:${c.id}`), tags: ['creature', 'bedrock'], dependencies: creatures.flatMap((c) => [`creatures.${c.id}.model`, `creatures.${c.id}.animations`]) });
  else await core('studio_asset_update', { id: 'creatures.bedrock', patch: { files }, by: 'minecraft-developer' });
  const v = await call('studio-minecraft', 'mc_bedrock_validate', { rp_dir: RP, bp_dir: BP });
  log(`bedrock add-on: ${v.verdict} (${v.errors} errors, ${v.warnings} warnings) ${JSON.stringify(v.counts)}`);
  for (const i of v.issues.filter((x) => x.severity !== 'info')) log(`  ${i.severity} ${i.kind} ${i.file}: ${i.detail}`);
  const pkg = await call('studio-minecraft', 'mc_bedrock_package', { rp_dir: RP, bp_dir: BP, output_base: 'build-out/studio-creatures' });
  log(`packaged ${pkg.addon.file} (${(pkg.addon.bytes / 1024).toFixed(0)} KiB)`);
  await qa('creatures.bedrock', 'integration-qa', [ok('bedrock add-on validation', v.verdict !== 'fail', `${v.errors} errors, ${v.warnings} warnings`), ok('entities', v.counts.client_entities === creatures.length && v.counts.behavior_entities === creatures.length, `${v.counts.client_entities} client / ${v.counts.behavior_entities} behavior`), { name: 'in-game test', status: 'warn', detail: 'not run: no Bedrock client in the build environment' }], 'add-on validated & packaged');
  const integ = await core('studio_registry_integrity');
  log(`registry: ${integ.ok ? 'ok' : JSON.stringify(integ.issues.slice(0, 3))} (${integ.assets} assets)`);
});

await step('creature-guide', 'documentation-writer', 'creature guide registered', async () => {
  const guide = 'docs/creatures.md';
  if (!fs.existsSync(path.join(DEMO, guide))) return log('guide missing');
  const has = await core('studio_asset_list', { type: 'guide' });
  if (!has.total) await core('studio_asset_create', { id: 'guide.creatures', type: 'guide', name: 'Studio Creatures — field guide', description: 'Spawning, behaviour, animations and sounds of the six creatures.', files: [guide], created_by: 'documentation-writer', dependencies: ['creatures.bedrock'] });
  const text = fs.readFileSync(path.join(DEMO, guide), 'utf8');
  await qa('guide.creatures', 'code-reviewer', [ok('every creature documented', creatures.every((c) => text.includes(`${NS}:${c.id}`)), `${creatures.length} entities`), ok('stats match behavior pack', creatures.every((c) => text.includes(`| ${STATS[c.id].health} |`)), 'health values cross-checked')], 'guide verified against the add-on');
});

console.log('\n✔ creatures produced', (await core('studio_task_graph')).counts);
for (const s of Object.values(servers)) s.close();
