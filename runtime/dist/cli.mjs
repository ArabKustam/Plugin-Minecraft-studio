import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  analyzeProject,
  formatDoctor,
  initProject,
  runDoctor,
  summarizeAnalysis
} from "./chunks/chunk-YNED5BIQ.mjs";
import "./chunks/chunk-J5ZW7ISX.mjs";
import {
  packageResourcePack,
  validateResourcePack
} from "./chunks/chunk-RU4HYO7E.mjs";
import "./chunks/chunk-3P6ZCJ33.mjs";
import {
  createDashboard
} from "./chunks/chunk-Y3IDW2VB.mjs";
import {
  isRepo,
  scanRepository
} from "./chunks/chunk-R6KWYNWG.mjs";
import "./chunks/chunk-WWXJ6DHF.mjs";
import {
  Studio,
  scanFiles,
  scanText
} from "./chunks/chunk-5XAWRH4I.mjs";

// src/cli/studio.js
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
var argv = process.argv.slice(2);
var flag = (k) => argv.includes(k);
var opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
var project = path.resolve(opt("--project", process.env.CLAUDE_PROJECT_DIR || process.cwd()));
var out = (v) => process.stdout.write(typeof v === "string" ? `${v}
` : `${JSON.stringify(v, null, 2)}
`);
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
async function hook(kind) {
  const raw = await readStdin();
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
  }
  const cwd = input.cwd || project;
  if (kind === "session-start") {
    const studio = new Studio(cwd);
    if (!studio.isInitialized()) {
      const looksMinecraft = fs.existsSync(path.join(cwd, "pack.mcmeta")) || ["src/main/resources/plugin.yml", "src/main/resources/paper-plugin.yml", "src/main/resources/fabric.mod.json"].some((f) => fs.existsSync(path.join(cwd, f)));
      if (looksMinecraft) out({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "Minecraft Studio: this looks like a Minecraft project that is not initialised yet. Suggest /minecraft-studio:init before larger production work." } });
      return;
    }
    const p = studio.project();
    const assets = studio.listAssets();
    const review = assets.filter((a) => ["review", "changes-requested"].includes(a.status)).length;
    const tasks = studio.listTasks().filter((t) => ["in-progress", "ready", "pending", "blocked"].includes(t.status));
    const mem = studio.recall({}).slice(-8).map((m) => `- [${m.category}] ${m.title}`).join("\n");
    out({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `Minecraft Studio project "${p.name}" (${p.platform || "?"}, Minecraft ${p.minecraft_version || "?"}, namespace ${p.default_namespace}). ${assets.length} registered assets, ${review} awaiting review/changes, ${tasks.length} open tasks${tasks.length ? ` (${tasks.slice(0, 5).map((t) => `${t.id}:${t.status}`).join(", ")})` : ""}. Recent project memory:
${mem || "- none"}
Use the minecraft-studio skill and studio_* tools; recall memory before decisions.` } });
    return;
  }
  if (kind === "pre-write") {
    const ti = input.tool_input || {};
    const text = [ti.content, ti.new_string, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join("\n");
    const file = ti.file_path || "";
    if (/(^|[\\/])\.env(\.local|\.production)?$/.test(file)) return;
    const findings = scanText(text, file);
    if (findings.length) {
      out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Minecraft Studio blocked writing what looks like a secret (${[...new Set(findings.map((f) => f.kind))].join(", ")}) into ${path.basename(file)}. Keep API keys in environment variables or an untracked .env file.` } });
    }
    return;
  }
  if (kind === "pre-bash") {
    const cmd = input.tool_input?.command || "";
    if (!/\bgit\s+push\b|\bgh\s+(release\s+create|repo\s+create)\b/.test(cmd)) return;
    if (!isRepo(cwd)) return;
    const upstream = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "@{upstream}..HEAD"], { cwd, encoding: "utf8", windowsHide: true });
    const files = upstream.status === 0 ? upstream.stdout.split(/\r?\n/).filter(Boolean) : null;
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", windowsHide: true }).stdout.trim();
    const findings = files ? scanFiles(top, files) : scanRepository(top).findings;
    if (findings.length) {
      out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Minecraft Studio secret scan blocked publishing: ${findings.slice(0, 8).map((f) => `${f.file}:${f.line} (${f.kind})`).join(", ")}. Remove the secrets (and rewrite history if they were committed), then retry.` } });
    }
  }
}
async function main() {
  const [cmd, a1, a2] = argv.filter((x, i) => !x.startsWith("--") && !(i > 0 && argv[i - 1]?.startsWith("--") && ["--project", "--port", "--mc"].includes(argv[i - 1])));
  switch (cmd) {
    case "doctor": {
      const r = await runDoctor({ projectRoot: project, live: !flag("--offline"), pluginRoot: process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..") });
      out(flag("--json") ? r : formatDoctor(r));
      process.exitCode = r.overall === "error" ? 1 : 0;
      break;
    }
    case "init":
      out(initProject(project, {}));
      break;
    case "analyze":
      out(summarizeAnalysis(analyzeProject(project)));
      break;
    case "status": {
      const s = new Studio(project);
      s.requireInit();
      out({ project: s.project().name, assets: s.listAssets().length, tasks: s.graph().counts, integrity: s.checkIntegrity() });
      break;
    }
    case "integrity": {
      const s = new Studio(project);
      s.requireInit();
      const r = s.checkIntegrity();
      out(r);
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case "dashboard": {
      const d = createDashboard({ project, port: Number(opt("--port", 4777)) });
      out(`Minecraft Studio Dashboard: ${await d.listen()}  (Ctrl+C to stop)`);
      break;
    }
    case "validate-pack": {
      if (!a1) throw new Error("usage: studio validate-pack <dir> [--mc VERSION]");
      const r = validateResourcePack(path.resolve(project, a1), { minecraftVersion: opt("--mc", null) });
      out(r);
      process.exitCode = r.verdict === "fail" ? 1 : 0;
      break;
    }
    case "package-pack": {
      if (!a1 || !a2) throw new Error("usage: studio package-pack <dir> <out.zip>");
      out(packageResourcePack(path.resolve(project, a1), path.resolve(project, a2)));
      break;
    }
    case "scan-secrets": {
      const r = scanRepository(project);
      out(r);
      process.exitCode = r.clean ? 0 : 1;
      break;
    }
    case "hook":
      await hook(a1);
      break;
    default:
      out("Minecraft Studio CLI\n\n  studio doctor [--offline] [--json]\n  studio init | analyze | status | integrity\n  studio dashboard [--port 4777]\n  studio validate-pack <dir> [--mc VERSION]\n  studio package-pack <dir> <out.zip>\n  studio scan-secrets\n  studio hook <session-start|pre-write|pre-bash>   (used by plugin hooks)\n\nOptions: --project DIR (default: $CLAUDE_PROJECT_DIR or cwd)");
  }
}
main().catch((e) => {
  if (argv[0] === "hook") {
    process.stderr.write(`minecraft-studio hook warning: ${e.message}
`);
    process.exit(0);
  }
  process.stderr.write(`${e.code ? `${e.code}: ` : ""}${e.message}
`);
  process.exit(1);
});
