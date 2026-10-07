// MinecraftPlatformAdapter implementations.
//
// Every adapter exposes the same contract so the studio never assumes that
// "Minecraft plugin" means one particular API:
//   id, name, kind
//   detect(root, files)      -> { confidence 0..1, evidence[], minecraft_version?, details }
//   build(root)              -> command spec or null
//   test(root)               -> command spec or null
//   artifacts(root)          -> built artifact paths (relative)
//   run                      -> 'paper-test-server' | null (runtime runner id)
//   parseLog(text)           -> { errors[], warnings[], loaded, done }
//   version(root)            -> detected Minecraft version or null
import fs from 'node:fs';
import path from 'node:path';
import { readJson, exists } from '../core/fsutil.js';

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const firstExisting = (root, rels) => rels.find((r) => exists(path.join(root, r))) || null;

function gradleCmd(root, task) {
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  if (exists(path.join(root, wrapper))) return { tool: 'gradle-wrapper', command: wrapper, args: [task, '--console=plain'] };
  if (exists(path.join(root, 'build.gradle')) || exists(path.join(root, 'build.gradle.kts'))) return { tool: 'gradle', command: 'gradle', args: [task, '--console=plain'] };
  return null;
}
function mavenCmd(root, phase) {
  if (exists(path.join(root, 'pom.xml'))) return { tool: 'maven', command: 'mvn', args: ['-B', '-q', phase] };
  return null;
}
function jvmBuild(root, gradleTask, mavenPhase) {
  return gradleCmd(root, gradleTask) || mavenCmd(root, mavenPhase);
}
function jvmArtifacts(root) {
  const out = [];
  for (const dir of ['build/libs', 'target']) {
    const abs = path.join(root, dir);
    if (!exists(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith('.jar') && !/-(sources|javadoc|dev|plain)\.jar$/.test(f) && !f.startsWith('original-')) out.push(`${dir}/${f}`);
    }
  }
  return out;
}

function buildScripts(root) {
  return ['build.gradle', 'build.gradle.kts', 'pom.xml', 'gradle.properties', 'gradle/libs.versions.toml'].map((f) => read(root, f) || '').join('\n');
}

function versionFromBuild(root) {
  const text = buildScripts(root);
  const patterns = [
    /paper-api:([0-9]+\.[0-9]+(?:\.[0-9]+)?)\.build\./, // Paper 26.x+ build versions, e.g. 26.2.build.132-stable
    /paper-api:([0-9][0-9.]*[0-9])-R0\.1/, /spigot-api:([0-9][0-9.]*[0-9])-R0\.1/, /paperweight[^\n]*?\(\s*"([0-9][0-9.]*)-R0\.1/,
    /minecraft_version\s*=\s*([0-9][0-9.]*)/, /minecraft\s*=\s*"([0-9][0-9.]*)"/, /<version>([0-9][0-9.]*)-R0\.1-SNAPSHOT<\/version>/,
    /mcVersion\s*=\s*["']?([0-9][0-9.]*)/,
  ];
  for (const re of patterns) { const m = text.match(re); if (m) return m[1]; }
  return null;
}

export function parseServerLog(text) {
  const lines = String(text).split(/\r?\n/);
  const errors = [];
  const warnings = [];
  lines.forEach((line, i) => {
    if (/\b(ERROR|SEVERE)\]|Exception in|Caused by:|Could not load '|Error occurred while enabling|NoClassDefFoundError|ClassNotFoundException/.test(line)) errors.push({ line: i + 1, text: line.trim().slice(0, 400) });
    else if (/\bWARN(ING)?\]/.test(line)) warnings.push({ line: i + 1, text: line.trim().slice(0, 400) });
  });
  return {
    errors, warnings,
    done: lines.some((l) => /Done \([0-9.,]+s\)! For help, type "help"/.test(l)),
    loaded_plugins: lines.map((l) => l.match(/Enabling ([\w-]+) v?([^\s]+)/)).filter(Boolean).map((m) => ({ name: m[1], version: m[2] })),
  };
}

function parseModLog(text) {
  const base = parseServerLog(text);
  base.done = /Done \([0-9.,]+s\)!|Loading Minecraft .* with Fabric Loader|Sound engine started/.test(text);
  return base;
}

export const ADAPTERS = [
  {
    id: 'paper', name: 'Paper / Bukkit server plugin', kind: 'server-plugin',
    detect(root, files) {
      const evidence = [];
      let c = 0;
      const descriptor = files.find((f) => /(^|\/)src\/main\/resources\/(paper-plugin|plugin)\.yml$/.test(f));
      if (descriptor) { evidence.push(descriptor); c += 0.5; }
      const b = buildScripts(root);
      if (/io\.papermc\.paper|paper-api|paperweight/.test(b)) { evidence.push('paper-api dependency'); c += 0.45; }
      else if (/spigot-api|org\.spigotmc|bukkit/i.test(b)) { evidence.push('spigot/bukkit dependency'); c += 0.35; }
      return { confidence: Math.min(1, c), evidence, minecraft_version: versionFromBuild(root), details: { descriptor } };
    },
    build: (root) => jvmBuild(root, 'build', 'package'),
    test: (root) => jvmBuild(root, 'test', 'test'),
    artifacts: jvmArtifacts,
    run: 'paper-test-server',
    parseLog: parseServerLog,
  },
  {
    id: 'velocity', name: 'Velocity / BungeeCord proxy plugin', kind: 'proxy-plugin',
    detect(root, files) {
      const b = buildScripts(root);
      const evidence = [];
      let c = 0;
      if (/com\.velocitypowered/.test(b)) { evidence.push('velocity-api dependency'); c += 0.8; }
      if (/net\.md-5:bungeecord|bungeecord-api/.test(b)) { evidence.push('bungeecord-api dependency'); c += 0.8; }
      if (files.some((f) => f.endsWith('velocity-plugin.json') || f.endsWith('bungee.yml'))) { evidence.push('proxy descriptor'); c += 0.2; }
      return { confidence: Math.min(1, c), evidence, minecraft_version: null, details: {} };
    },
    build: (root) => jvmBuild(root, 'build', 'package'),
    test: (root) => jvmBuild(root, 'test', 'test'),
    artifacts: jvmArtifacts,
    run: null,
    parseLog: parseServerLog,
  },
  {
    id: 'fabric', name: 'Fabric mod', kind: 'mod',
    detect(root, files) {
      const desc = files.find((f) => /src\/(main|client)\/resources\/fabric\.mod\.json$/.test(f) || f === 'fabric.mod.json');
      const b = buildScripts(root);
      let c = 0; const evidence = [];
      if (desc) { c += 0.6; evidence.push(desc); }
      if (/fabric-loom|net\.fabricmc/.test(b)) { c += 0.4; evidence.push('fabric-loom'); }
      let mc = versionFromBuild(root);
      if (desc && !mc) { try { mc = readJson(path.join(root, desc)).depends?.minecraft || null; } catch { /* ignore */ } }
      return { confidence: Math.min(1, c), evidence, minecraft_version: mc, details: { descriptor: desc } };
    },
    build: (root) => gradleCmd(root, 'build'),
    test: (root) => gradleCmd(root, 'test'),
    artifacts: jvmArtifacts,
    run: null,
    parseLog: parseModLog,
  },
  {
    id: 'neoforge', name: 'NeoForge / Forge mod', kind: 'mod',
    detect(root, files) {
      const desc = files.find((f) => /META-INF\/(neoforge\.)?mods\.toml$/.test(f));
      const b = buildScripts(root);
      let c = 0; const evidence = [];
      if (desc) { c += 0.6; evidence.push(desc); }
      if (/net\.neoforged|minecraftforge|ForgeGradle|moddevgradle/i.test(b)) { c += 0.4; evidence.push('forge/neoforge gradle plugin'); }
      return { confidence: Math.min(1, c), evidence, minecraft_version: versionFromBuild(root), details: { descriptor: desc } };
    },
    build: (root) => gradleCmd(root, 'build'),
    test: (root) => gradleCmd(root, 'test'),
    artifacts: jvmArtifacts,
    run: null,
    parseLog: parseModLog,
  },
  {
    id: 'datapack', name: 'Data pack', kind: 'datapack',
    detect(root, files) {
      const metas = files.filter((f) => f.endsWith('pack.mcmeta') && files.some((g) => g.startsWith(f.replace('pack.mcmeta', 'data/'))));
      return { confidence: metas.length ? 0.9 : 0, evidence: metas, minecraft_version: null, details: { packs: metas.map((m) => path.posix.dirname(m)) } };
    },
    build: () => null, test: () => null, artifacts: () => [], run: null, parseLog: parseServerLog,
  },
  {
    id: 'resourcepack', name: 'Java resource pack', kind: 'resourcepack',
    detect(root, files) {
      const metas = files.filter((f) => f.endsWith('pack.mcmeta') && files.some((g) => g.startsWith(f.replace('pack.mcmeta', 'assets/'))));
      return { confidence: metas.length ? 0.9 : 0, evidence: metas, minecraft_version: null, details: { packs: metas.map((m) => path.posix.dirname(m)) } };
    },
    build: () => null, test: () => null, artifacts: () => [], run: null, parseLog: parseServerLog,
  },
  {
    id: 'bedrock', name: 'Bedrock add-on', kind: 'bedrock-addon',
    detect(root, files) {
      const manifests = files.filter((f) => f.endsWith('manifest.json')).filter((f) => {
        try { const m = readJson(path.join(root, f)); return m.format_version && m.header?.uuid && Array.isArray(m.modules); } catch { return false; }
      });
      return { confidence: manifests.length ? 0.9 : 0, evidence: manifests, minecraft_version: null, details: { manifests } };
    },
    build: () => null, test: () => null, artifacts: () => [], run: null, parseLog: parseServerLog,
  },
];

export function getAdapter(id) {
  const a = ADAPTERS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown platform adapter ${id}. Known: ${ADAPTERS.map((x) => x.id).join(', ')}`);
  return a;
}

/** Detect every platform present; a project can be hybrid (plugin + resource pack). */
export function detectPlatforms(root, files) {
  return ADAPTERS.map((a) => ({ adapter: a.id, name: a.name, kind: a.kind, ...a.detect(root, files) }))
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

export { firstExisting };
