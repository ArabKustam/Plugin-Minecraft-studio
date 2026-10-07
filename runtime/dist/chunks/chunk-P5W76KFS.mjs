import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  StudioError,
  ensureDir,
  exists,
  readJson,
  redact,
  sha256
} from "./chunk-RRZML6EW.mjs";

// src/lib/adapters/minecraft.js
import fs from "node:fs";
import path from "node:path";
var read = (root, rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
};
function gradleCmd(root, task) {
  const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  if (exists(path.join(root, wrapper))) return { tool: "gradle-wrapper", command: wrapper, args: [task, "--console=plain"] };
  if (exists(path.join(root, "build.gradle")) || exists(path.join(root, "build.gradle.kts"))) return { tool: "gradle", command: "gradle", args: [task, "--console=plain"] };
  return null;
}
function mavenCmd(root, phase) {
  if (exists(path.join(root, "pom.xml"))) return { tool: "maven", command: "mvn", args: ["-B", "-q", phase] };
  return null;
}
function jvmBuild(root, gradleTask, mavenPhase) {
  return gradleCmd(root, gradleTask) || mavenCmd(root, mavenPhase);
}
function jvmArtifacts(root) {
  const out = [];
  for (const dir of ["build/libs", "target"]) {
    const abs = path.join(root, dir);
    if (!exists(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".jar") && !/-(sources|javadoc|dev|plain)\.jar$/.test(f) && !f.startsWith("original-")) out.push(`${dir}/${f}`);
    }
  }
  return out;
}
function buildScripts(root) {
  return ["build.gradle", "build.gradle.kts", "pom.xml", "gradle.properties", "gradle/libs.versions.toml"].map((f) => read(root, f) || "").join("\n");
}
function versionFromBuild(root) {
  const text = buildScripts(root);
  const patterns = [
    /paper-api:([0-9]+\.[0-9]+(?:\.[0-9]+)?)\.build\./,
    // Paper 26.x+ build versions, e.g. 26.2.build.132-stable
    /paper-api:([0-9][0-9.]*[0-9])-R0\.1/,
    /spigot-api:([0-9][0-9.]*[0-9])-R0\.1/,
    /paperweight[^\n]*?\(\s*"([0-9][0-9.]*)-R0\.1/,
    /minecraft_version\s*=\s*([0-9][0-9.]*)/,
    /minecraft\s*=\s*"([0-9][0-9.]*)"/,
    /<version>([0-9][0-9.]*)-R0\.1-SNAPSHOT<\/version>/,
    /mcVersion\s*=\s*["']?([0-9][0-9.]*)/
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}
function parseServerLog(text) {
  const lines = String(text).split(/\r?\n/);
  const errors = [];
  const warnings = [];
  lines.forEach((line, i) => {
    if (/\b(ERROR|SEVERE)\]|Exception in|Caused by:|Could not load '|Error occurred while enabling|NoClassDefFoundError|ClassNotFoundException/.test(line)) errors.push({ line: i + 1, text: line.trim().slice(0, 400) });
    else if (/\bWARN(ING)?\]/.test(line)) warnings.push({ line: i + 1, text: line.trim().slice(0, 400) });
  });
  return {
    errors,
    warnings,
    done: lines.some((l) => /Done \([0-9.,]+s\)! For help, type "help"/.test(l)),
    loaded_plugins: lines.map((l) => l.match(/Enabling ([\w-]+) v?([^\s]+)/)).filter(Boolean).map((m) => ({ name: m[1], version: m[2] }))
  };
}
function parseModLog(text) {
  const base = parseServerLog(text);
  base.done = /Done \([0-9.,]+s\)!|Loading Minecraft .* with Fabric Loader|Sound engine started/.test(text);
  return base;
}
var ADAPTERS = [
  {
    id: "paper",
    name: "Paper / Bukkit server plugin",
    kind: "server-plugin",
    detect(root, files) {
      const evidence = [];
      let c = 0;
      const descriptor = files.find((f) => /(^|\/)src\/main\/resources\/(paper-plugin|plugin)\.yml$/.test(f));
      if (descriptor) {
        evidence.push(descriptor);
        c += 0.5;
      }
      const b = buildScripts(root);
      if (/io\.papermc\.paper|paper-api|paperweight/.test(b)) {
        evidence.push("paper-api dependency");
        c += 0.45;
      } else if (/spigot-api|org\.spigotmc|bukkit/i.test(b)) {
        evidence.push("spigot/bukkit dependency");
        c += 0.35;
      }
      return { confidence: Math.min(1, c), evidence, minecraft_version: versionFromBuild(root), details: { descriptor } };
    },
    build: (root) => jvmBuild(root, "build", "package"),
    test: (root) => jvmBuild(root, "test", "test"),
    artifacts: jvmArtifacts,
    run: "paper-test-server",
    parseLog: parseServerLog
  },
  {
    id: "velocity",
    name: "Velocity / BungeeCord proxy plugin",
    kind: "proxy-plugin",
    detect(root, files) {
      const b = buildScripts(root);
      const evidence = [];
      let c = 0;
      if (/com\.velocitypowered/.test(b)) {
        evidence.push("velocity-api dependency");
        c += 0.8;
      }
      if (/net\.md-5:bungeecord|bungeecord-api/.test(b)) {
        evidence.push("bungeecord-api dependency");
        c += 0.8;
      }
      if (files.some((f) => f.endsWith("velocity-plugin.json") || f.endsWith("bungee.yml"))) {
        evidence.push("proxy descriptor");
        c += 0.2;
      }
      return { confidence: Math.min(1, c), evidence, minecraft_version: null, details: {} };
    },
    build: (root) => jvmBuild(root, "build", "package"),
    test: (root) => jvmBuild(root, "test", "test"),
    artifacts: jvmArtifacts,
    run: null,
    parseLog: parseServerLog
  },
  {
    id: "fabric",
    name: "Fabric mod",
    kind: "mod",
    detect(root, files) {
      const desc = files.find((f) => /src\/(main|client)\/resources\/fabric\.mod\.json$/.test(f) || f === "fabric.mod.json");
      const b = buildScripts(root);
      let c = 0;
      const evidence = [];
      if (desc) {
        c += 0.6;
        evidence.push(desc);
      }
      if (/fabric-loom|net\.fabricmc/.test(b)) {
        c += 0.4;
        evidence.push("fabric-loom");
      }
      let mc = versionFromBuild(root);
      if (desc && !mc) {
        try {
          mc = readJson(path.join(root, desc)).depends?.minecraft || null;
        } catch {
        }
      }
      return { confidence: Math.min(1, c), evidence, minecraft_version: mc, details: { descriptor: desc } };
    },
    build: (root) => gradleCmd(root, "build"),
    test: (root) => gradleCmd(root, "test"),
    artifacts: jvmArtifacts,
    run: null,
    parseLog: parseModLog
  },
  {
    id: "neoforge",
    name: "NeoForge / Forge mod",
    kind: "mod",
    detect(root, files) {
      const desc = files.find((f) => /META-INF\/(neoforge\.)?mods\.toml$/.test(f));
      const b = buildScripts(root);
      let c = 0;
      const evidence = [];
      if (desc) {
        c += 0.6;
        evidence.push(desc);
      }
      if (/net\.neoforged|minecraftforge|ForgeGradle|moddevgradle/i.test(b)) {
        c += 0.4;
        evidence.push("forge/neoforge gradle plugin");
      }
      return { confidence: Math.min(1, c), evidence, minecraft_version: versionFromBuild(root), details: { descriptor: desc } };
    },
    build: (root) => gradleCmd(root, "build"),
    test: (root) => gradleCmd(root, "test"),
    artifacts: jvmArtifacts,
    run: null,
    parseLog: parseModLog
  },
  {
    id: "datapack",
    name: "Data pack",
    kind: "datapack",
    detect(root, files) {
      const metas = files.filter((f) => f.endsWith("pack.mcmeta") && files.some((g) => g.startsWith(f.replace("pack.mcmeta", "data/"))));
      return { confidence: metas.length ? 0.9 : 0, evidence: metas, minecraft_version: null, details: { packs: metas.map((m) => path.posix.dirname(m)) } };
    },
    build: () => null,
    test: () => null,
    artifacts: () => [],
    run: null,
    parseLog: parseServerLog
  },
  {
    id: "resourcepack",
    name: "Java resource pack",
    kind: "resourcepack",
    detect(root, files) {
      const metas = files.filter((f) => f.endsWith("pack.mcmeta") && files.some((g) => g.startsWith(f.replace("pack.mcmeta", "assets/"))));
      return { confidence: metas.length ? 0.9 : 0, evidence: metas, minecraft_version: null, details: { packs: metas.map((m) => path.posix.dirname(m)) } };
    },
    build: () => null,
    test: () => null,
    artifacts: () => [],
    run: null,
    parseLog: parseServerLog
  },
  {
    id: "bedrock",
    name: "Bedrock add-on",
    kind: "bedrock-addon",
    detect(root, files) {
      const manifests = files.filter((f) => f.endsWith("manifest.json")).filter((f) => {
        try {
          const m = readJson(path.join(root, f));
          return m.format_version && m.header?.uuid && Array.isArray(m.modules);
        } catch {
          return false;
        }
      });
      return { confidence: manifests.length ? 0.9 : 0, evidence: manifests, minecraft_version: null, details: { manifests } };
    },
    build: () => null,
    test: () => null,
    artifacts: () => [],
    run: null,
    parseLog: parseServerLog
  }
];
function getAdapter(id) {
  const a = ADAPTERS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown platform adapter ${id}. Known: ${ADAPTERS.map((x) => x.id).join(", ")}`);
  return a;
}
function detectPlatforms(root, files) {
  return ADAPTERS.map((a) => ({ adapter: a.id, name: a.name, kind: a.kind, ...a.detect(root, files) })).filter((r) => r.confidence > 0).sort((a, b) => b.confidence - a.confidence);
}

// src/lib/minecraft/runner.js
import fs2 from "node:fs";
import path2 from "node:path";
import { spawn, spawnSync } from "node:child_process";
var ALLOWED = /* @__PURE__ */ new Set(["gradlew", "gradlew.bat", "gradle", "mvn"]);
function execCommand(spec, cwd, { timeoutMs = 15 * 60 * 1e3 } = {}) {
  if (!ALLOWED.has(spec.command)) throw new StudioError("E_EXEC", `Command ${spec.command} is not allowed`);
  const isWin = process.platform === "win32";
  let cmd = spec.command, args = spec.args;
  if (spec.command === "gradlew" || spec.command === "gradlew.bat") cmd = path2.join(cwd, spec.command);
  if (isWin) {
    args = ["/d", "/s", "/c", [quoteWin(cmd), ...args.map(quoteWin)].join(" ")];
    cmd = process.env.ComSpec || "cmd.exe";
  }
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 128 * 1024 * 1024, windowsVerbatimArguments: isWin, env: { ...process.env, TERM: "dumb" } });
  const output = redact(`${r.stdout || ""}
${r.stderr || ""}`);
  return { ok: r.status === 0, exit_code: r.status, signal: r.signal, duration_s: Number(((Date.now() - started) / 1e3).toFixed(1)), output };
}
var quoteWin = (s) => /[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
function summarizeBuildOutput(output) {
  const lines = output.split(/\r?\n/);
  const errors = lines.filter((l) => /error:|FAILURE:|BUILD FAILED|\[ERROR\]|e: file:|Exception/.test(l)).slice(0, 40);
  const warnings = lines.filter((l) => /warning:|\[WARNING\]|w: file:/.test(l)).slice(0, 40);
  return { errors, warnings, tail: lines.slice(-60).join("\n") };
}
function runProjectCommand(root, adapterId, kind = "build") {
  const adapter = getAdapter(adapterId);
  const spec = kind === "test" ? adapter.test(root) : adapter.build(root);
  if (!spec) return { ok: true, skipped: true, reason: `${adapter.name} has no ${kind} step` };
  const r = execCommand(spec, root);
  const summary = summarizeBuildOutput(r.output);
  return { ok: r.ok, adapter: adapterId, command: `${spec.command} ${spec.args.join(" ")}`, exit_code: r.exit_code, duration_s: r.duration_s, errors: summary.errors, warnings: summary.warnings, output_tail: summary.tail, artifacts: r.ok ? adapter.artifacts(root) : [] };
}
function javaVersion() {
  const r = spawnSync("java", ["-version"], { encoding: "utf8", windowsHide: true });
  const txt = `${r.stdout}${r.stderr}`;
  const m = txt.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]);
  return { major, raw: txt.split(/\r?\n/)[0] };
}
function requiredJava(mcVersion) {
  const major = Number(String(mcVersion).split(".")[0]);
  if (major >= 26) return 25;
  const minor = Number(String(mcVersion).split(".")[1] || 0);
  const patch = Number(String(mcVersion).split(".")[2] || 0);
  if (minor > 20 || minor === 20 && patch >= 5) return 21;
  return 17;
}
async function downloadPaper(version, dir) {
  const meta = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds/latest`, { headers: { "user-agent": "minecraft-studio (https://github.com/ArabKustam/Plugin-Minecraft-studio)" } });
  if (!meta.ok) throw new StudioError("E_PAPER", `Paper ${version} not found on fill.papermc.io (HTTP ${meta.status})`);
  const build = await meta.json();
  const dl = build.downloads?.["server:default"];
  if (!dl?.url) throw new StudioError("E_PAPER", "Paper build has no server:default download");
  const jar = path2.join(dir, `paper-${version}-${build.id}.jar`);
  if (!exists(jar)) {
    const res = await fetch(dl.url);
    if (!res.ok) throw new StudioError("E_PAPER", `Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (dl.checksums?.sha256 && sha256(buf) !== dl.checksums.sha256) throw new StudioError("E_PAPER", "Paper jar checksum mismatch \u2014 refusing to run it");
    fs2.writeFileSync(jar, buf);
  }
  return { jar, build: build.id, channel: build.channel };
}
async function runPaperTestServer(studio, { version, pluginJars = [], commands = [], timeoutS = null, waitAfterCommandsS = 5, port = 25599, resourcePackZip = null } = {}) {
  const cfg = studio.config();
  if (cfg.minecraft.accept_eula !== true) {
    throw new StudioError("E_EULA", 'Running a Minecraft server requires accepting the Minecraft EULA (https://aka.ms/MinecraftEULA). Ask the user; if they agree, set "minecraft": {"accept_eula": true} via studio_config_set.');
  }
  const java = javaVersion();
  const need = requiredJava(version);
  if (!java) throw new StudioError("E_JAVA", "Java not found on PATH");
  if (java.major < need) throw new StudioError("E_JAVA", `Minecraft ${version} needs Java ${need}+, found Java ${java.major}`);
  const dir = ensureDir(studio.abs(cfg.minecraft.test_server_dir));
  const { jar, build, channel } = await downloadPaper(version, dir);
  fs2.writeFileSync(path2.join(dir, "eula.txt"), "# accepted by the user via minecraft-studio config (minecraft.accept_eula)\neula=true\n");
  fs2.writeFileSync(path2.join(dir, "server.properties"), [
    "online-mode=false",
    `server-port=${port}`,
    "level-type=minecraft\\:flat",
    "generate-structures=false",
    "spawn-protection=0",
    "max-players=4",
    "motd=Minecraft Studio test server",
    "view-distance=4",
    "simulation-distance=4",
    "enable-command-block=true",
    "server-ip=127.0.0.1"
  ].join("\n") + "\n");
  const pluginsDir = ensureDir(path2.join(dir, "plugins"));
  for (const f of fs2.readdirSync(pluginsDir)) if (f.endsWith(".jar") && f.startsWith("studio-")) fs2.rmSync(path2.join(pluginsDir, f));
  for (const p of pluginJars) fs2.copyFileSync(studio.abs(p), path2.join(pluginsDir, `studio-${path2.basename(p)}`));
  if (resourcePackZip) fs2.copyFileSync(studio.abs(resourcePackZip), path2.join(dir, "resourcepack.zip"));
  const logFile = path2.join(dir, `studio-run-${Date.now()}.log`);
  const out = fs2.createWriteStream(logFile);
  const startTimeout = (timeoutS || cfg.minecraft.startup_timeout_s) * 1e3;
  const started = Date.now();
  const child = spawn("java", ["-Xms512M", "-Xmx2G", "-Dpaper.playerconnection.keepalive=120", "-jar", path2.basename(jar), "--nogui"], { cwd: dir, windowsHide: true });
  let text = "";
  const onData = (d) => {
    const s = d.toString();
    text += s;
    out.write(s);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const exited = new Promise((resolve) => child.on("exit", (code2) => resolve(code2)));
  const waitFor = async (pred, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred()) return true;
      if (child.exitCode !== null) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  const ready = await waitFor(() => /Done \([0-9.,]+s\)!/.test(text), startTimeout);
  const commandResults = [];
  if (ready) {
    for (const c of commands) {
      const mark = text.length;
      child.stdin.write(`${c}
`);
      await new Promise((r) => setTimeout(r, Math.max(1e3, waitAfterCommandsS * 1e3 / Math.max(1, commands.length))));
      commandResults.push({ command: c, output: text.slice(mark).split(/\r?\n/).filter(Boolean).slice(0, 30) });
    }
    child.stdin.write("stop\n");
  }
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 6e4))]);
  if (code === "timeout" || child.exitCode === null) child.kill("SIGKILL");
  out.end();
  const parsed = parseServerLog(text);
  const pluginErrors = parsed.errors.filter((e) => !/Mojang|authlib|keepalive|Failed to fetch|session/i.test(e.text));
  const result = {
    ok: ready && pluginErrors.length === 0,
    ready,
    startup_s: Number(((Date.now() - started) / 1e3).toFixed(1)),
    paper: { version, build, channel },
    java: java.major,
    loaded_plugins: parsed.loaded_plugins,
    errors: pluginErrors.slice(0, 30),
    warnings: parsed.warnings.slice(0, 30),
    commands: commandResults,
    log_file: studio.rel(logFile)
  };
  return result;
}

export {
  parseServerLog,
  ADAPTERS,
  getAdapter,
  detectPlatforms,
  runProjectCommand,
  javaVersion,
  requiredJava,
  runPaperTestServer
};
