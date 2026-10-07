import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  DEFAULT_SOUNDFONT,
  resolveSoundfont
} from "./chunk-HC4HRIBW.mjs";
import {
  detectPlatforms,
  javaVersion
} from "./chunk-P5W76KFS.mjs";
import {
  readPng
} from "./chunk-X2ZWGV6D.mjs";
import {
  gitStatus
} from "./chunk-KHXEIHTL.mjs";
import {
  VOICE_PROVIDERS,
  findFfmpeg
} from "./chunk-HMLAGON2.mjs";
import {
  Studio,
  exists,
  getSecret,
  readJson,
  slugify,
  walk
} from "./chunk-RRZML6EW.mjs";

// src/lib/core/project.js
import fs from "node:fs";
import path from "node:path";
var LANGS = { ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin script", ".groovy": "Groovy", ".js": "JavaScript", ".ts": "TypeScript", ".mcfunction": "mcfunction", ".py": "Python", ".scala": "Scala" };
function readYamlScalar(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*:\\s*['"]?([^'"\\n#]+)`, "m"));
  return m ? m[1].trim() : null;
}
function analyzeProject(root) {
  const files = walk(root, { skip: [".git", "node_modules", "build", ".gradle", "target", "out", "run", "dist", ".minecraft-studio", ".idea", ".vscode"] });
  const platforms = detectPlatforms(root, files);
  const languages = {};
  for (const f of files) {
    const l = LANGS[path.extname(f)];
    if (l) languages[l] = (languages[l] || 0) + 1;
  }
  const build = exists(path.join(root, "build.gradle.kts")) ? "gradle (kotlin dsl)" : exists(path.join(root, "build.gradle")) ? "gradle (groovy)" : exists(path.join(root, "pom.xml")) ? "maven" : null;
  let descriptor = null;
  const desc = files.find((f) => /src\/main\/resources\/(paper-plugin|plugin)\.yml$/.test(f));
  if (desc) {
    const y = fs.readFileSync(path.join(root, desc), "utf8");
    descriptor = { file: desc, name: readYamlScalar(y, "name"), main: readYamlScalar(y, "main"), version: readYamlScalar(y, "version"), api_version: readYamlScalar(y, "api-version") };
  }
  const packs = files.filter((f) => f.endsWith("pack.mcmeta")).map((mf) => {
    const dir = path.posix.dirname(mf) === "." ? "" : path.posix.dirname(mf);
    const prefix = dir ? `${dir}/` : "";
    let meta = {};
    try {
      meta = readJson(path.join(root, mf)).pack || {};
    } catch {
    }
    const inPack = files.filter((f) => f.startsWith(prefix));
    const assets = inPack.filter((f) => f.startsWith(`${prefix}assets/`));
    const data = inPack.filter((f) => f.startsWith(`${prefix}data/`));
    const namespaces = [...new Set(assets.map((f) => f.slice(prefix.length).split("/")[1]))];
    const textures = assets.filter((f) => /\/textures\/.+\.png$/.test(f));
    const resHist = {};
    for (const t of textures.slice(0, 400)) {
      try {
        const img = readPng(path.join(root, t));
        const k = `${img.width}x${Math.min(img.height, img.width)}`;
        resHist[k] = (resHist[k] || 0) + 1;
      } catch {
      }
    }
    const soundsJson = assets.filter((f) => /\/sounds\.json$/.test(f));
    let soundEvents = 0;
    for (const s of soundsJson) {
      try {
        soundEvents += Object.keys(readJson(path.join(root, s))).length;
      } catch {
      }
    }
    return {
      dir: dir || ".",
      kind: assets.length ? data.length ? "resource+data" : "resourcepack" : "datapack",
      pack_format: meta.pack_format ?? null,
      min_format: meta.min_format ?? null,
      max_format: meta.max_format ?? null,
      description: typeof meta.description === "string" ? meta.description : meta.description ? JSON.stringify(meta.description) : null,
      namespaces,
      counts: {
        textures: textures.length,
        models: assets.filter((f) => /\/models\/.+\.json$/.test(f)).length,
        item_definitions: assets.filter((f) => /\/items\/.+\.json$/.test(f)).length,
        blockstates: assets.filter((f) => /\/blockstates\/.+\.json$/.test(f)).length,
        sounds: assets.filter((f) => /\/sounds\/.+\.ogg$/.test(f)).length,
        sound_events: soundEvents,
        particles: assets.filter((f) => /\/particles\/.+\.json$/.test(f)).length,
        animated_textures: assets.filter((f) => f.endsWith(".png.mcmeta")).length,
        functions: data.filter((f) => f.endsWith(".mcfunction")).length
      },
      texture_resolutions: resHist
    };
  });
  const blockbench = files.filter((f) => f.endsWith(".bbmodel"));
  const bedrockAnims = files.filter((f) => /\.animation\.json$|animations\/.+\.json$/.test(f));
  const tests = files.filter((f) => /src\/test\//.test(f) || /(^|\/)tests?\//.test(f)).length;
  const ci = files.filter((f) => f.startsWith(".github/workflows/"));
  const configs = files.filter((f) => /src\/main\/resources\/.+\.(yml|yaml|json|toml|properties)$/.test(f) && !/plugin\.yml$|paper-plugin\.yml$/.test(f));
  const buildText = ["build.gradle", "build.gradle.kts", "pom.xml"].map((f) => {
    try {
      return fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      return "";
    }
  }).join("\n");
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
    analyzed_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function assetIdFor(rel, type, used) {
  let base = `${type}.${slugify(rel.replace(/^.*?assets\//, "").replace(/\.(png|json|ogg|bbmodel)$/, "").replace(/\//g, "."))}`.replace(/_+/g, "_").slice(0, 90);
  base = base.replace(/[^a-z0-9_.-]/g, "_");
  let id = base, i = 2;
  while (used.has(id)) id = `${base}-${i++}`;
  used.add(id);
  return id;
}
function initProject(root, { name = null, platform = null, minecraftVersion = null, index = true, maxIndexed = 1500, by = "project-director" } = {}) {
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
    default_namespace: prev.default_namespace || analysis.namespaces.find((n) => n !== "minecraft") || slugify(name || analysis.name).replace(/_/g, ""),
    packs: analysis.packs,
    plugin_descriptor: analysis.plugin_descriptor,
    conventions: prev.conventions || {},
    created_at: prev.created_at || (/* @__PURE__ */ new Date()).toISOString()
  };
  studio.saveProject(profile);
  let indexed = 0, skipped = 0;
  if (index) {
    const used = new Set(studio.listAssets().map((a) => a.id));
    const knownFiles = new Set(studio.listAssets().flatMap((a) => a.files.map((f) => f.path)));
    for (const pack of analysis.packs) {
      const prefix = pack.dir === "." ? "" : `${pack.dir}/`;
      const files = walk(path.join(root, pack.dir)).map((f) => `${prefix}${f}`);
      for (const f of files) {
        if (indexed >= maxIndexed) {
          skipped++;
          continue;
        }
        if (knownFiles.has(f)) continue;
        let type = null;
        if (/\/textures\/.+\.png$/.test(f)) type = "texture";
        else if (/\/models\/.+\.json$/.test(f)) type = "model";
        else if (/\/sounds\/.+\.ogg$/.test(f)) type = /music|ambient|bgm/.test(f) ? "music" : "sfx";
        else if (/\/particles\/.+\.json$/.test(f)) type = "particle";
        if (!type) continue;
        const id = assetIdFor(f, type, used);
        const ns = f.slice(prefix.length).split("/")[1];
        const loc = `${ns}:${f.slice(prefix.length).split("/").slice(3).join("/").replace(/\.(png|json|ogg)$/, "")}`;
        studio.createAsset({ id, type, name: path.basename(f), description: "Existing project asset (indexed by init)", files: [f], created_by: "import", minecraft_ids: [loc], tags: ["existing"], imported: true });
        indexed++;
      }
    }
    for (const bb of analysis.blockbench_models) {
      if (indexed >= maxIndexed || knownFiles.has(bb)) continue;
      studio.createAsset({ id: assetIdFor(bb, "model", used), type: "model", name: path.basename(bb), description: "Existing Blockbench project", files: [bb], created_by: "import", tags: ["existing", "blockbench"], imported: true });
      indexed++;
    }
  }
  if (firstRun) {
    if (profile.platform) studio.remember({ category: "platform", title: `Primary platform: ${profile.platform}`, content: `Detected ${analysis.platforms.map((p) => `${p.adapter} (${Math.round(p.confidence * 100)}%: ${p.evidence.join(", ")})`).join("; ") || "nothing"}. Minecraft version: ${profile.minecraft_version || "unknown \u2014 ask the user"}.`, by });
    if (profile.default_namespace) studio.remember({ category: "naming", title: `Default namespace "${profile.default_namespace}"`, content: "New resource locations, sound events and item models use this namespace unless the user says otherwise.", by });
    const res = analysis.packs.flatMap((p) => Object.entries(p.texture_resolutions)).sort((a, b) => b[1] - a[1])[0];
    if (res) studio.remember({ category: "visual-style", title: `Texture resolution ${res[0]}`, content: `Most existing textures are ${res[0]}. New textures must match unless the user asks for a different resolution.`, by });
  }
  ensureGitignore(root);
  studio.log({ agent: by, event: "project.init", severity: "success", message: `${firstRun ? "Initialised" : "Re-analysed"} Minecraft Studio for ${profile.name} (${profile.platform || "unknown platform"}, MC ${profile.minecraft_version || "?"}) \u2014 indexed ${indexed} existing assets` });
  return { first_run: firstRun, profile, indexed, skipped_due_to_limit: skipped, analysis_summary: summarizeAnalysis(analysis) };
}
function ensureGitignore(root) {
  const gi = path.join(root, ".gitignore");
  const want = [".env", ".env.local", ".minecraft-studio/test-server/", ".minecraft-studio/cache/"];
  let text = exists(gi) ? fs.readFileSync(gi, "utf8") : "";
  const missing = want.filter((w) => !text.split(/\r?\n/).includes(w));
  if (missing.length) {
    text += `${text && !text.endsWith("\n") ? "\n" : ""}
# Minecraft Studio (secrets & transient state)
${missing.join("\n")}
`;
    fs.writeFileSync(gi, text);
  }
}
function summarizeAnalysis(a) {
  return {
    name: a.name,
    minecraft_version: a.minecraft_version,
    platform: a.platform,
    hybrid: a.hybrid,
    platforms: a.platforms.map((p) => `${p.adapter} ${Math.round(p.confidence * 100)}%`),
    build_system: a.build_system,
    languages: a.languages,
    packs: a.packs.map((p) => ({ dir: p.dir, kind: p.kind, namespaces: p.namespaces, counts: p.counts, resolutions: p.texture_resolutions })),
    plugin: a.plugin_descriptor,
    tests: a.tests.files,
    ci: a.ci.workflows.length,
    git: a.git.repo ? { branch: a.git.branch, clean: a.git.clean, changes: a.git.change_count } : "not a git repository"
  };
}

// src/lib/core/doctor.js
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { spawnSync } from "node:child_process";
var which = (cmd, args = ["--version"]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && !cmd.includes("/"), timeout: 2e4 });
  return r.status === 0 ? `${r.stdout || ""}${r.stderr || ""}`.trim().split(/\r?\n/)[0] : null;
};
async function probe(url, ms = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return { reachable: true, status: r.status };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(t);
  }
}
function blockbenchInstall() {
  const candidates = process.platform === "win32" ? [path2.join(process.env.LOCALAPPDATA || "", "Programs", "Blockbench", "Blockbench.exe"), "C:/Program Files/Blockbench/Blockbench.exe"] : process.platform === "darwin" ? ["/Applications/Blockbench.app"] : ["/usr/bin/blockbench", "/snap/bin/blockbench", path2.join(os.homedir(), "Applications", "Blockbench.AppImage")];
  return candidates.find((c) => c && fs2.existsSync(c)) || null;
}
async function runDoctor({ projectRoot, pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || null, live = true, dashboardPort = 4777 } = {}) {
  const checks = [];
  const add = (component, status, detail, fix = null) => checks.push({ component, status, detail, ...fix ? { fix } : {} });
  if (pluginRoot && exists(path2.join(pluginRoot, ".claude-plugin", "plugin.json"))) {
    const m = readJson(path2.join(pluginRoot, ".claude-plugin", "plugin.json"));
    add("Claude plugin", "ok", `${m.name} v${m.version} at ${pluginRoot}`);
    const dist = ["studio-core", "studio-texture", "studio-model", "studio-audio", "studio-minecraft"].filter((s) => !exists(path2.join(pluginRoot, "runtime", "dist", `${s}.mjs`)));
    add("MCP servers (bundled)", dist.length ? "error" : "ok", dist.length ? `missing bundles: ${dist.join(", ")}` : "5 servers: studio-core, studio-texture, studio-model, studio-audio, studio-minecraft", dist.length ? "Reinstall the plugin or run `npm run build` in runtime/" : null);
  } else add("Claude plugin", "warn", "CLAUDE_PLUGIN_ROOT not set (running outside Claude Code?)");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("Node.js", nodeMajor >= 20 ? "ok" : "error", `v${process.versions.node}`, nodeMajor >= 20 ? null : "Install Node.js 20 or newer (MCP servers run on Node)");
  const gitV = which("git");
  add("Git", gitV ? "ok" : "error", gitV || "not found", gitV ? null : "Install Git");
  if (projectRoot) {
    const gs = gitStatus(projectRoot);
    add("Project repository", gs.repo ? "ok" : "warn", gs.repo ? `branch ${gs.branch}, ${gs.clean ? "clean" : `${gs.change_count} uncommitted changes`}${gs.remote ? `, remote ${gs.remote}` : ", no remote"}` : "project is not a git repository", gs.repo ? null : "Run `git init` (Minecraft Studio uses commits as checkpoints)");
  }
  const gh = which("gh");
  const ghToken = getSecret("GITHUB_TOKEN") || getSecret("GITHUB_PERSONAL_ACCESS_TOKEN");
  add("GitHub", gh || ghToken ? "ok" : "warn", [gh ? `gh CLI ${gh.replace(/^gh version /, "")}` : null, ghToken ? "token in environment" : null].filter(Boolean).join(", ") || "no gh CLI and no token \u2014 local Git still works", gh || ghToken ? null : "Optional: install gh (https://cli.github.com) or connect the official GitHub MCP server (docs/integrations.md)");
  const jv = javaVersion();
  add("Java", jv ? jv.major >= 21 ? "ok" : "warn" : "error", jv ? `Java ${jv.major} (${jv.raw})` : "not found", jv ? jv.major >= 25 ? null : "Minecraft 1.20.5\u20131.21.11 needs Java 21; Minecraft 26.x needs Java 25" : "Install a JDK (Temurin 21 or 25)");
  const mvn = which("mvn", ["-v"]);
  const gradle = which("gradle", ["--version"]);
  add("Build tools", "ok", [gradle ? "gradle" : null, mvn ? "maven" : null].filter(Boolean).join(", ") || "none globally (Gradle wrapper in projects is enough)");
  const ff = findFfmpeg();
  add("FFmpeg", ff ? ff.vorbis ? "ok" : "warn" : "warn", ff ? `${ff.version}${ff.vorbis ? ", libvorbis \u2713" : ", NO libvorbis"}` : "not found \u2014 synthesis works, but Ogg Vorbis export for Minecraft is unavailable", ff ? null : "Install FFmpeg with libvorbis (winget install Gyan.FFmpeg / brew install ffmpeg / apt install ffmpeg)");
  const sf = resolveSoundfont({ root: projectRoot });
  add("Instrument sound bank", sf.exists ? "ok" : "warn", sf.exists ? `${sf.source === "default" ? DEFAULT_SOUNDFONT.name : "custom bank"} (${sf.path})` : "not installed \u2014 music can use only synth voices; real instruments (piano, strings, choir, ...) need a General MIDI SoundFont", sf.exists ? null : `Run audio_soundfont_install (downloads ${DEFAULT_SOUNDFONT.name}, ${Math.round(DEFAULT_SOUNDFONT.bytes / 1048576)} MB, once per computer) or set MINECRAFT_STUDIO_SOUNDFONT to your own .sf2/.sf3`);
  const sys = VOICE_PROVIDERS.system.available();
  add("System TTS (draft voices)", sys.ok ? "ok" : "warn", sys.ok ? `engine ${sys.engine}` : sys.reason);
  const elKey = getSecret("ELEVENLABS_API_KEY");
  const elConfigured = elKey && !elKey.startsWith("${");
  if (!elConfigured) add("ElevenLabs", "warn", "not configured \u2014 voice falls back to system TTS; SFX/music use local providers", 'Set ELEVENLABS_API_KEY in your environment or the project .env (never commit it), or fill the plugin option "elevenlabs_api_key"');
  else if (live) {
    try {
      const s = await VOICE_PROVIDERS.elevenlabs.check();
      add("ElevenLabs", "ok", `key valid, tier ${s.tier}, ${s.character_count}/${s.character_limit} characters used`);
    } catch (e) {
      add("ElevenLabs", "error", `key present but check failed: ${e.message.slice(0, 160)}`, "Verify the key and that it has user_read permission");
    }
  } else add("ElevenLabs", "ok", "key present (not verified: offline mode)");
  const bb = blockbenchInstall();
  let bridge = "not probed";
  if (live) {
    const a = await probe("http://127.0.0.1:8787/ping");
    const b = await probe("http://localhost:3000/bb-mcp");
    bridge = a.reachable ? "sosadly/blockbench-mcp bridge on :8787" : b.reachable ? "jasonjgardner blockbench-mcp-plugin on :3000/bb-mcp" : "no Blockbench MCP bridge running";
  }
  add("Blockbench", bb ? "ok" : "warn", `${bb ? `installed (${bb})` : "not found"}; ${bridge}. Built-in studio-model exporters + renderer work without it.`, bb ? bridge.startsWith("no") ? "Optional: start Blockbench with an MCP plugin for live editing (docs/modeling.md)" : null : "Optional: install Blockbench from https://www.blockbench.net");
  if (projectRoot) {
    const studio = new Studio(projectRoot);
    if (studio.isInitialized()) {
      const integ = studio.checkIntegrity();
      const p = studio.project();
      add("Studio project", integ.ok ? "ok" : "warn", `${p.name}: ${p.platform || "?"} / MC ${p.minecraft_version || "?"}, ${integ.assets} assets${integ.ok ? "" : `, ${integ.issues.length} integrity issues`}`, integ.ok ? null : "Run studio_registry_integrity and fix broken references");
      const eula = studio.config().minecraft.accept_eula;
      add("Test server", eula ? "ok" : "warn", eula ? "EULA accepted by user; local Paper test server enabled" : "disabled until the user accepts the Minecraft EULA", eula ? null : "Ask the user; then set minecraft.accept_eula=true with studio_config_set");
    } else add("Studio project", "warn", "not initialised in this directory", "Run /minecraft-studio:init");
  }
  const dash = live ? await probe(`http://127.0.0.1:${dashboardPort}/api/health`) : { reachable: false };
  add("Studio Dashboard", dash.reachable ? "ok" : "warn", dash.reachable ? `running at http://127.0.0.1:${dashboardPort}` : "not running", dash.reachable ? null : "Start with studio_dashboard_start (or /minecraft-studio:dashboard)");
  const worst = checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { overall: worst, checks, platform: `${process.platform} ${os.release()}`, generated_at: (/* @__PURE__ */ new Date()).toISOString() };
}
function formatDoctor(report) {
  const icon = { ok: "\u2714", warn: "\u26A0", error: "\u2716" };
  const lines = [`Minecraft Studio doctor \u2014 ${report.overall.toUpperCase()} (${report.platform})`, ""];
  for (const c of report.checks) {
    lines.push(`${icon[c.status] || "\u2022"} ${c.component.padEnd(26)} ${c.detail}`);
    if (c.fix) lines.push(`  ${"".padEnd(26)} \u2192 ${c.fix}`);
  }
  return lines.join("\n");
}

export {
  analyzeProject,
  initProject,
  summarizeAnalysis,
  runDoctor,
  formatDoctor
};
