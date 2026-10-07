// Project analysis & initialisation: understand an existing Minecraft project
// before changing it, then create the studio state (profile, registry index,
// memory) without rewriting anything the user already has.
import fs from 'node:fs';
import path from 'node:path';
import { walk, readJson, exists, slugify } from './fsutil.js';
import { detectPlatforms } from '../adapters/minecraft.js';
import { gitStatus } from './git.js';
import { readPng } from '../texture/image.js';
import { Studio } from './studio.js';

const LANGS = { '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin script', '.groovy': 'Groovy', '.js': 'JavaScript', '.ts': 'TypeScript', '.mcfunction': 'mcfunction', '.py': 'Python', '.scala': 'Scala' };

function readYamlScalar(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*:\\s*['"]?([^'"\\n#]+)`, 'm'));
  return m ? m[1].trim() : null;
}

export function analyzeProject(root) {
  const files = walk(root, { skip: ['.git', 'node_modules', 'build', '.gradle', 'target', 'out', 'run', 'dist', '.minecraft-studio', '.idea', '.vscode'] });
  const platforms = detectPlatforms(root, files);
  const languages = {};
  for (const f of files) { const l = LANGS[path.extname(f)]; if (l) languages[l] = (languages[l] || 0) + 1; }
  const build = exists(path.join(root, 'build.gradle.kts')) ? 'gradle (kotlin dsl)' : exists(path.join(root, 'build.gradle')) ? 'gradle (groovy)' : exists(path.join(root, 'pom.xml')) ? 'maven' : null;

  // plugin descriptor
  let descriptor = null;
  const desc = files.find((f) => /src\/main\/resources\/(paper-plugin|plugin)\.yml$/.test(f));
  if (desc) {
    const y = fs.readFileSync(path.join(root, desc), 'utf8');
    descriptor = { file: desc, name: readYamlScalar(y, 'name'), main: readYamlScalar(y, 'main'), version: readYamlScalar(y, 'version'), api_version: readYamlScalar(y, 'api-version') };
  }

  // resource / data packs
  const packs = files.filter((f) => f.endsWith('pack.mcmeta')).map((mf) => {
    const dir = path.posix.dirname(mf) === '.' ? '' : path.posix.dirname(mf);
    const prefix = dir ? `${dir}/` : '';
    let meta = {};
    try { meta = readJson(path.join(root, mf)).pack || {}; } catch { /* invalid */ }
    const inPack = files.filter((f) => f.startsWith(prefix));
    const assets = inPack.filter((f) => f.startsWith(`${prefix}assets/`));
    const data = inPack.filter((f) => f.startsWith(`${prefix}data/`));
    const namespaces = [...new Set(assets.map((f) => f.slice(prefix.length).split('/')[1]))];
    const textures = assets.filter((f) => /\/textures\/.+\.png$/.test(f));
    const resHist = {};
    for (const t of textures.slice(0, 400)) {
      try { const img = readPng(path.join(root, t)); const k = `${img.width}x${Math.min(img.height, img.width)}`; resHist[k] = (resHist[k] || 0) + 1; } catch { /* skip */ }
    }
    const soundsJson = assets.filter((f) => /\/sounds\.json$/.test(f));
    let soundEvents = 0;
    for (const s of soundsJson) { try { soundEvents += Object.keys(readJson(path.join(root, s))).length; } catch { /* skip */ } }
    return {
      dir: dir || '.', kind: assets.length ? (data.length ? 'resource+data' : 'resourcepack') : 'datapack', pack_format: meta.pack_format ?? null, min_format: meta.min_format ?? null, max_format: meta.max_format ?? null,
      description: typeof meta.description === 'string' ? meta.description : meta.description ? JSON.stringify(meta.description) : null,
      namespaces, counts: {
        textures: textures.length, models: assets.filter((f) => /\/models\/.+\.json$/.test(f)).length, item_definitions: assets.filter((f) => /\/items\/.+\.json$/.test(f)).length,
        blockstates: assets.filter((f) => /\/blockstates\/.+\.json$/.test(f)).length, sounds: assets.filter((f) => /\/sounds\/.+\.ogg$/.test(f)).length, sound_events: soundEvents,
        particles: assets.filter((f) => /\/particles\/.+\.json$/.test(f)).length, animated_textures: assets.filter((f) => f.endsWith('.png.mcmeta')).length, functions: data.filter((f) => f.endsWith('.mcfunction')).length,
      },
      texture_resolutions: resHist,
    };
  });

  const blockbench = files.filter((f) => f.endsWith('.bbmodel'));
  const bedrockAnims = files.filter((f) => /\.animation\.json$|animations\/.+\.json$/.test(f));
  const tests = files.filter((f) => /src\/test\//.test(f) || /(^|\/)tests?\//.test(f)).length;
  const ci = files.filter((f) => f.startsWith('.github/workflows/'));
  const configs = files.filter((f) => /src\/main\/resources\/.+\.(yml|yaml|json|toml|properties)$/.test(f) && !/plugin\.yml$|paper-plugin\.yml$/.test(f));
  const buildText = ['build.gradle', 'build.gradle.kts', 'pom.xml'].map((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } }).join('\n');
  const dependencies = [...new Set([...buildText.matchAll(/(?:implementation|compileOnly|api|paperweight\.paperDevBundle|modImplementation|shadow)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]))].slice(0, 40);
  const mcVersion = platforms.find((p) => p.minecraft_version)?.minecraft_version || descriptor?.api_version || null;
  const primary = platforms[0]?.adapter || null;

  return {
    name: descriptor?.name || path.basename(root),
    root,
    minecraft_version: mcVersion,
    platform: primary,
    platforms,
    hybrid: platforms.filter((p) => p.confidence >= 0.5).length > 1,
    languages,
    build_system: build,
    plugin_descriptor: descriptor,
    packs,
    namespaces: [...new Set(packs.flatMap((p) => p.namespaces))],
    blockbench_models: blockbench,
    animation_files: bedrockAnims.slice(0, 50),
    dependencies,
    tests: { files: tests },
    ci: { workflows: ci },
    configuration_files: configs,
    git: gitStatus(root),
    file_count: files.length,
    analyzed_at: new Date().toISOString(),
  };
}

function assetIdFor(rel, type, used) {
  let base = `${type}.${slugify(rel.replace(/^.*?assets\//, '').replace(/\.(png|json|ogg|bbmodel)$/, '').replace(/\//g, '.'))}`.replace(/_+/g, '_').slice(0, 90);
  base = base.replace(/[^a-z0-9_.-]/g, '_');
  let id = base, i = 2;
  while (used.has(id)) id = `${base}-${i++}`;
  used.add(id);
  return id;
}

/** Create .minecraft-studio state for a project. Safe to re-run: existing records are kept. */
export function initProject(root, { name = null, platform = null, minecraftVersion = null, index = true, maxIndexed = 1500, by = 'project-director' } = {}) {
  const studio = new Studio(root);
  const firstRun = !studio.isInitialized();
  studio.ensureLayout();
  const analysis = analyzeProject(root);
  const prev = studio.project() || {};
  const profile = {
    ...prev,
    name: name || prev.name || analysis.name,
    minecraft_version: minecraftVersion || prev.minecraft_version || analysis.minecraft_version,
    platform: platform || prev.platform || analysis.platform,
    platforms: analysis.platforms.map(({ adapter, name: n, kind, confidence, evidence }) => ({ adapter, name: n, kind, confidence, evidence })),
    build_system: analysis.build_system,
    languages: analysis.languages,
    namespaces: analysis.namespaces,
    default_namespace: prev.default_namespace || analysis.namespaces.find((n) => n !== 'minecraft') || slugify(name || analysis.name).replace(/_/g, ''),
    packs: analysis.packs,
    plugin_descriptor: analysis.plugin_descriptor,
    conventions: prev.conventions || {},
    created_at: prev.created_at || new Date().toISOString(),
  };
  studio.saveProject(profile);

  let indexed = 0, skipped = 0;
  if (index) {
    const used = new Set(studio.listAssets().map((a) => a.id));
    const knownFiles = new Set(studio.listAssets().flatMap((a) => a.files.map((f) => f.path)));
    for (const pack of analysis.packs) {
      const prefix = pack.dir === '.' ? '' : `${pack.dir}/`;
      const files = walk(path.join(root, pack.dir)).map((f) => `${prefix}${f}`);
      for (const f of files) {
        if (indexed >= maxIndexed) { skipped++; continue; }
        if (knownFiles.has(f)) continue;
        let type = null;
        if (/\/textures\/.+\.png$/.test(f)) type = 'texture';
        else if (/\/models\/.+\.json$/.test(f)) type = 'model';
        else if (/\/sounds\/.+\.ogg$/.test(f)) type = /music|ambient|bgm/.test(f) ? 'music' : 'sfx';
        else if (/\/particles\/.+\.json$/.test(f)) type = 'particle';
        if (!type) continue;
        const id = assetIdFor(f, type, used);
        const ns = f.slice(prefix.length).split('/')[1];
        const loc = `${ns}:${f.slice(prefix.length).split('/').slice(3).join('/').replace(/\.(png|json|ogg)$/, '')}`;
        studio.createAsset({ id, type, name: path.basename(f), description: 'Existing project asset (indexed by init)', files: [f], created_by: 'import', minecraft_ids: [loc], tags: ['existing'], imported: true });
        indexed++;
      }
    }
    for (const bb of analysis.blockbench_models) {
      if (indexed >= maxIndexed || knownFiles.has(bb)) continue;
      studio.createAsset({ id: assetIdFor(bb, 'model', used), type: 'model', name: path.basename(bb), description: 'Existing Blockbench project', files: [bb], created_by: 'import', tags: ['existing', 'blockbench'], imported: true });
      indexed++;
    }
  }
  if (firstRun) {
    if (profile.platform) studio.remember({ category: 'platform', title: `Primary platform: ${profile.platform}`, content: `Detected ${analysis.platforms.map((p) => `${p.adapter} (${Math.round(p.confidence * 100)}%: ${p.evidence.join(', ')})`).join('; ') || 'nothing'}. Minecraft version: ${profile.minecraft_version || 'unknown — ask the user'}.`, by });
    if (profile.default_namespace) studio.remember({ category: 'naming', title: `Default namespace "${profile.default_namespace}"`, content: 'New resource locations, sound events and item models use this namespace unless the user says otherwise.', by });
    const res = analysis.packs.flatMap((p) => Object.entries(p.texture_resolutions)).sort((a, b) => b[1] - a[1])[0];
    if (res) studio.remember({ category: 'visual-style', title: `Texture resolution ${res[0]}`, content: `Most existing textures are ${res[0]}. New textures must match unless the user asks for a different resolution.`, by });
  }
  ensureGitignore(root);
  studio.log({ agent: by, event: 'project.init', severity: 'success', message: `${firstRun ? 'Initialised' : 'Re-analysed'} Minecraft Studio for ${profile.name} (${profile.platform || 'unknown platform'}, MC ${profile.minecraft_version || '?'}) — indexed ${indexed} existing assets` });
  return { first_run: firstRun, profile, indexed, skipped_due_to_limit: skipped, analysis_summary: summarizeAnalysis(analysis) };
}

function ensureGitignore(root) {
  const gi = path.join(root, '.gitignore');
  const want = ['.env', '.env.local', '.minecraft-studio/test-server/', '.minecraft-studio/cache/'];
  let text = exists(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const missing = want.filter((w) => !text.split(/\r?\n/).includes(w));
  if (missing.length) {
    text += `${text && !text.endsWith('\n') ? '\n' : ''}\n# Minecraft Studio (secrets & transient state)\n${missing.join('\n')}\n`;
    fs.writeFileSync(gi, text);
  }
}

export function summarizeAnalysis(a) {
  return {
    name: a.name, minecraft_version: a.minecraft_version, platform: a.platform, hybrid: a.hybrid,
    platforms: a.platforms.map((p) => `${p.adapter} ${Math.round(p.confidence * 100)}%`),
    build_system: a.build_system, languages: a.languages,
    packs: a.packs.map((p) => ({ dir: p.dir, kind: p.kind, namespaces: p.namespaces, counts: p.counts, resolutions: p.texture_resolutions })),
    plugin: a.plugin_descriptor, tests: a.tests.files, ci: a.ci.workflows.length, git: a.git.repo ? { branch: a.git.branch, clean: a.git.clean, changes: a.git.change_count } : 'not a git repository',
  };
}

