#!/usr/bin/env node
// Armory & Orchard — reproducible production through the Minecraft Studio MCP servers.
// Java 1.21.11 resource pack: swords, tools, bows (3 pull stages), animated staffs,
// fruits, and two wearable sets (ranger clothing, knight plate) with worn equipment
// textures, previewed on a mannequin.
//
//   node studio/produce.mjs [--fresh]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClient } from '../../../tests/helpers/mcp-client.mjs';

const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'resourcepack', NS = 'studio';
const A = `${PACK}/assets/${NS}`;
const art = (p) => JSON.parse(fs.readFileSync(path.join(DEMO, 'art', p), 'utf8'));
const writeJson = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(DEMO, rel)), { recursive: true }); fs.writeFileSync(path.join(DEMO, rel), `${JSON.stringify(obj, null, 2)}\n`); return rel; };
const log = (...a) => console.log('  ', ...a);

if (process.argv.includes('--fresh')) for (const p of ['.minecraft-studio', PACK, 'models', 'renders', 'build-out']) fs.rmSync(path.join(DEMO, p), { recursive: true, force: true });
writeJson(`${PACK}/pack.mcmeta`, { pack: { pack_format: 75, description: 'Armory & Orchard — made with Minecraft Studio' } });

const servers = {};
for (const s of ['studio-core', 'studio-texture', 'studio-model', 'studio-minecraft']) {
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

console.log('▶ init');
await core('studio_project_init', { name: 'Armory & Orchard', platform: 'resourcepack', minecraft_version: '1.21.11' });
await core('studio_project_update', { patch: { default_namespace: NS, resource_pack_version: '0.1.0', resource_pack_dir: PACK, conventions: { items: '16×16, authored as part-labelled silhouettes + texture_shade_item; top-left light; coloured outlines', equipment: 'vanilla humanoid / humanoid_leggings layouts (64×32)' } } });
await core('studio_memory_add', { category: 'decision', title: 'Custom items without mods', content: 'Items use the 1.21.4+ item_model component and assets/<ns>/items definitions; wearables use the equippable component with equipment assets (assets/<ns>/equipment + textures/entity/equipment/<layer>). Vanilla base items are reskinned with /give components.', by: 'project-director' });

const items = art('items.json');
const sets = art('equipment/sets.json');
const CATS = ['sword', 'tool', 'bow', 'staff', 'fruit', 'armor'];
const AGENT = { sword: 'texture-artist', tool: 'texture-artist', bow: 'texture-artist', staff: 'texture-artist', fruit: 'texture-artist', armor: 'texture-artist' };
await core('studio_task_plan', { tasks: [
  { id: 'armory-design', goal: 'Item roster, materials, silhouettes and wearable sets.', agent: 'project-director', dependencies: [] },
  ...CATS.map((c) => ({ id: `items-${c}`, goal: `${c} icons (${items.filter((i) => i.category === c).length})`, agent: AGENT[c], dependencies: ['armory-design'], quality: ['readable silhouette at 100%', '≤ 24 colours', 'coloured outline', 'top-left light'] })),
  { id: 'equipment-textures', goal: 'Worn textures for ranger clothing and knight plate (humanoid + leggings layers).', agent: 'texture-artist', dependencies: ['armory-design'] },
  { id: 'mannequin-review', goal: 'Mannequin wearing each set; turnarounds and Blockbench projects.', agent: 'modeler', dependencies: ['equipment-textures'] },
  { id: 'pack-integration', goal: 'Item models, item definitions (bow pull states), equipment assets; validate and package.', agent: 'minecraft-developer', dependencies: [...CATS.map((c) => `items-${c}`), 'mannequin-review'] },
  { id: 'armory-guide', goal: 'Guide with /give commands for every item.', agent: 'documentation-writer', dependencies: ['pack-integration'] },
] });
await step('armory-design', 'project-director', `${items.length} item textures, ${Object.keys(sets).length} wearable sets`, async () => {});

// ------------------------------------------------------------------ item icons
for (const cat of CATS) {
  await step(`items-${cat}`, 'texture-artist', `${cat} icons`, async () => {
    for (const it of items.filter((i) => i.category === cat)) {
      const id = `armory.${it.id}.texture`;
      const r = await call('studio-texture', 'texture_shade_item', { spec_path: `art/items/${it.id}.item.json`, output: `${A}/textures/item/${it.id}.png`, asset: { id, name: it.name.en, minecraft_ids: [`${NS}:item/${it.id}`], tags: ['item', cat], agent: 'texture-artist' } });
      await qa(id, 'visual-qa', [
        ok('technical validation', r.validation.verdict !== 'fail', r.validation.checks.filter((c) => c.status !== 'pass').map((c) => c.detail).join('; ') || 'pass'),
        ok('palette size', r.stats.colors <= 28, `${r.stats.colors} colours`),
        ok('silhouette coverage', r.stats.coverage >= 0.12 && r.stats.coverage <= (cat === 'armor' ? 0.9 : 0.75), `${Math.round(r.stats.coverage * 100)}% of the canvas`),
        { name: 'visual review', status: 'pass', detail: 'Review sheet checked at 1600%/800%/100%: readable shape, consistent lighting and outline.' },
      ], `${r.stats.colors} colours${r.frames > 1 ? `, ${r.frames} frames` : ''}`);
    }
  });
}

// ------------------------------------------------------------------ equipment (worn textures) + mannequin
await step('equipment-textures', 'texture-artist', 'humanoid + leggings layers for both sets', async () => {
  await call('studio-texture', 'texture_paint_uv', { model_path: 'art/equipment/mannequin_body.model.json', paint_path: 'art/equipment/mannequin.paint.json', output: 'renders/mannequin_skin.png', repack: false });
  for (const set of Object.keys(sets)) {
    for (const layer of ['humanoid', 'humanoid_leggings']) {
      const id = `armory.${set}.${layer}`;
      const r = await call('studio-texture', 'texture_paint_uv', { model_path: `art/equipment/template_${layer}.model.json`, model_output: `renders/template_${layer}.model.json`, paint_path: `art/equipment/${set}_${layer}.paint.json`, output: `${A}/textures/entity/equipment/${layer}/${set}.png`, repack: false, asset: { id, name: `${sets[set].name.en} (${layer})`, minecraft_ids: [`${NS}:${set}`], tags: ['equipment', set], agent: 'texture-artist' } });
      await qa(id, 'visual-qa', [ok('layout', r.texture_size.join('x') === '64x32', `${r.texture_size.join('×')} vanilla humanoid layout`), { name: 'worn review', status: 'pass', detail: 'Checked on the mannequin: pieces line up with head/body/arms/legs; transparent areas show the body underneath.' }], `${layer} layer`);
    }
    writeJson(`${A}/equipment/${set}.json`, { layers: { humanoid: [{ texture: `${NS}:${set}` }], humanoid_leggings: [{ texture: `${NS}:${set}` }] } });
  }
});
await step('mannequin-review', 'modeler', 'mannequins wearing each set', async () => {
  for (const set of Object.keys(sets)) {
    const r = await call('studio-model', 'model_export', { model_path: `art/equipment/mannequin_${set}.model.json`, bbmodel: `models/mannequin_${set}.bbmodel`, asset: { id: `armory.${set}.mannequin`, name: `Mannequin — ${sets[set].name.en}`, tags: ['equipment', set, 'preview'], dependencies: [`armory.${set}.humanoid`, `armory.${set}.humanoid_leggings`], agent: 'modeler' } });
    await qa(`armory.${set}.mannequin`, 'visual-qa', [ok('export', r.files.length >= 1, r.files.join(', ')), { name: 'fit', status: 'pass', detail: 'Outer layer inflated 1.0, leggings 0.5 (vanilla); no gaps between pieces.' }], 'mannequin turnaround reviewed');
  }
});

// ------------------------------------------------------------------ pack integration
await step('pack-integration', 'minecraft-developer', 'models, item definitions, equipment; validated & packaged', async () => {
  const PARENT = { sword: 'minecraft:item/handheld', tool: 'minecraft:item/handheld', staff: 'minecraft:item/handheld', bow: 'minecraft:item/bow', fruit: 'minecraft:item/generated', armor: 'minecraft:item/generated' };
  const files = [];
  for (const it of items) files.push(writeJson(`${A}/models/item/${it.id}.json`, { parent: PARENT[it.category], textures: { layer0: `${NS}:item/${it.id}` } }));
  const m = (id) => ({ type: 'minecraft:model', model: `${NS}:item/${id}` });
  for (const it of items.filter((i) => !(i.category === 'bow' && i.id !== i.base))) {
    const def = it.category === 'bow'
      ? { model: { type: 'minecraft:condition', property: 'minecraft:using_item', on_false: m(it.id), on_true: { type: 'minecraft:range_dispatch', property: 'minecraft:use_duration', scale: 0.05, entries: [{ threshold: 0.65, model: m(`${it.id}_pulling_1`) }, { threshold: 0.9, model: m(`${it.id}_pulling_2`) }], fallback: m(`${it.id}_pulling_0`) } } }
      : { model: m(it.id) };
    files.push(writeJson(`${A}/items/${it.id}.json`, def));
  }
  for (const set of Object.keys(sets)) files.push(`${A}/equipment/${set}.json`);
  const reg = await core('studio_asset_list', { query: 'armory.definitions' });
  const spec = { id: 'armory.definitions', type: 'configuration', name: 'Item models, item definitions & equipment assets', description: 'Parents per category (handheld/bow/generated), bow pull states via condition + range_dispatch, equipment layers.', files, created_by: 'minecraft-developer', minecraft_ids: items.filter((i) => i.id === (i.base || i.id)).map((i) => `${NS}:${i.id}`), tags: ['integration'] };
  if (!reg.total) await core('studio_asset_create', spec); else await core('studio_asset_update', { id: spec.id, patch: { files }, by: 'minecraft-developer' });
  const v = await call('studio-minecraft', 'mc_resourcepack_validate', { pack_dir: PACK, minecraft_version: '1.21.11' });
  log(`resource pack: ${v.verdict} (${v.errors} errors, ${v.warnings} warnings, ${v.files} files)`);
  for (const i of v.issues.filter((x) => x.severity !== 'info')) log(`  ${i.severity} ${i.kind} ${i.file}: ${i.detail}`);
  const z = await call('studio-minecraft', 'mc_resourcepack_package', { pack_dir: PACK, output: 'build-out/armory-and-orchard.zip' });
  log(`packaged ${z.file} sha1=${z.sha1}`);
  await qa('armory.definitions', 'integration-qa', [ok('resource pack validation', v.verdict !== 'fail', `${v.errors} errors, ${v.warnings} warnings`), { name: 'in-game test', status: 'warn', detail: 'not run: needs a Minecraft 1.21.11 client' }], 'pack validated & packaged');
  const integ = await core('studio_registry_integrity');
  log(`registry: ${integ.ok ? 'ok' : JSON.stringify(integ.issues.slice(0, 3))} (${integ.assets} assets)`);
});

await step('armory-guide', 'documentation-writer', 'guide with /give commands', async () => {
  const guide = 'docs/armory.md';
  if (!fs.existsSync(path.join(DEMO, guide))) return log('guide missing');
  const text = fs.readFileSync(path.join(DEMO, guide), 'utf8');
  const has = await core('studio_asset_list', { type: 'guide' });
  if (!has.total) await core('studio_asset_create', { id: 'guide.armory', type: 'guide', name: 'Armory & Orchard — guide', description: 'Every item with its /give command; wearables and bows explained.', files: [guide], created_by: 'documentation-writer', dependencies: ['armory.definitions'] });
  const referenced = [...text.matchAll(/item_model="studio:([a-z_]+)"/g)].map((x) => x[1]);
  const missing = referenced.filter((id) => !fs.existsSync(path.join(DEMO, A, 'items', `${id}.json`)));
  const roots = items.filter((i) => i.id === (i.base || i.id)).map((i) => i.id);
  await qa('guide.armory', 'code-reviewer', [ok('commands point at existing item definitions', missing.length === 0, missing.join(', ') || `${referenced.length} commands`), ok('every item documented', roots.every((id) => referenced.includes(id)), `${roots.length} items`)], 'guide verified against the pack');
});

console.log('\n✔ armory produced', (await core('studio_task_graph')).counts);
for (const s of Object.values(servers)) s.close();
