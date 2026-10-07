import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  createServer,
  external_exports,
  start,
  tool
} from "./chunks/chunk-XQJ3QCTZ.mjs";
import {
  analyzeProject,
  formatDoctor,
  initProject,
  runDoctor,
  summarizeAnalysis
} from "./chunks/chunk-ZTNQR47A.mjs";
import "./chunks/chunk-HC4HRIBW.mjs";
import "./chunks/chunk-P5W76KFS.mjs";
import "./chunks/chunk-X2ZWGV6D.mjs";
import {
  checkpoint,
  compileTimeline,
  createAgent,
  gitLog,
  gitStatus,
  listTools,
  renderTimelineText,
  runTool,
  scaffoldTool,
  scanRepository,
  testTool,
  validateTimeline
} from "./chunks/chunk-KHXEIHTL.mjs";
import {
  listProviders
} from "./chunks/chunk-HMLAGON2.mjs";
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  MEMORY_CATEGORIES,
  SEVERITIES,
  StudioError,
  TASK_STATUSES,
  assertId,
  exists,
  readJson,
  secretStatus,
  writeJson
} from "./chunks/chunk-RRZML6EW.mjs";

// src/mcp/studio-core.js
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
var server = createServer("studio-core", "Minecraft Studio core: project profile, Asset Registry, task dependency graph, project memory, activity log, timelines, QA records, Git checkpoints, agent & tool factories, providers, doctor and dashboard. Start every project with studio_project_init; register every produced asset; record QA before approval.");
var taskSpec = external_exports.object({
  id: external_exports.string().describe('Task id, e.g. "reactor-main-texture"'),
  goal: external_exports.string(),
  agent: external_exports.string().optional().describe('Agent responsible, e.g. "texture-artist"'),
  inputs: external_exports.array(external_exports.string()).optional(),
  outputs: external_exports.array(external_exports.string()).optional().describe("Required outputs (files or asset ids)"),
  allowed_tools: external_exports.array(external_exports.string()).optional(),
  dependencies: external_exports.array(external_exports.string()).optional().describe("Task ids that must be done first"),
  constraints: external_exports.array(external_exports.string()).optional(),
  quality: external_exports.array(external_exports.string()).optional(),
  validation: external_exports.array(external_exports.string()).optional(),
  destination: external_exports.string().optional().describe("Directory/files the agent may write"),
  assets: external_exports.array(external_exports.string()).optional()
});
tool(
  server,
  "studio_project_analyze",
  { title: "Analyze Minecraft project", capability: "read", description: "Inspect the project without changing anything: platforms (Paper, Fabric, NeoForge, datapack, resource pack, Bedrock, proxy), Minecraft version, build system, languages, packs, namespaces, texture resolutions, sounds, models, tests, CI and Git state." },
  async (_a, { root }) => summarizeAnalysis(analyzeProject(root))
);
tool(server, "studio_project_init", {
  title: "Initialise Minecraft Studio",
  capability: "write",
  description: "Create/refresh .minecraft-studio/: project profile, config, registry index of existing pack assets (imported as integrated), initial memory, .gitignore entries for secrets. Safe to re-run.",
  input: { name: external_exports.string().optional(), platform: external_exports.string().optional().describe("Override detected platform adapter id"), minecraft_version: external_exports.string().optional(), index: external_exports.boolean().optional().describe("Index existing assets (default true)") }
}, async (a, { root }) => initProject(root, { name: a.name, platform: a.platform, minecraftVersion: a.minecraft_version, index: a.index !== false }));
tool(
  server,
  "studio_project_profile",
  { title: "Get project profile", capability: "read", needsInit: true, description: "Return .minecraft-studio/project.json (platform, version, namespaces, conventions, packs)." },
  async (_a, { studio }) => studio.project()
);
tool(server, "studio_project_update", {
  title: "Update project profile",
  capability: "write",
  needsInit: true,
  description: "Update profile fields such as minecraft_version, platform, default_namespace, resource_pack_dir, plugin_version or conventions (merged).",
  input: { patch: external_exports.record(external_exports.string(), external_exports.any()).describe("Fields to set") }
}, async (a, { studio }) => {
  const p = studio.project();
  const next = { ...p, ...a.patch, conventions: { ...p.conventions || {}, ...a.patch.conventions || {} } };
  studio.saveProject(next);
  studio.log({ agent: "project-director", event: "project.updated", message: `Updated project profile: ${Object.keys(a.patch).join(", ")}` });
  return studio.project();
});
tool(
  server,
  "studio_config_get",
  { title: "Get studio config", capability: "read", needsInit: true, description: "Provider selection and studio settings (never contains secrets) plus which secrets are configured (names only)." },
  async (_a, { studio }) => ({ config: studio.config(), secrets: secretStatus() })
);
tool(server, "studio_config_set", {
  title: "Update studio config",
  capability: "write",
  needsInit: true,
  description: 'Merge settings into .minecraft-studio/config.json, e.g. {"providers":{"voice":"elevenlabs"}} or {"minecraft":{"accept_eula":true}} (ONLY after the user explicitly accepted the Minecraft EULA). Secrets are rejected.',
  input: { patch: external_exports.record(external_exports.string(), external_exports.any()) }
}, async (a, { studio }) => {
  if (JSON.stringify(a.patch).match(/sk_[a-f0-9]{20,}|ghp_|github_pat_|api[_-]?key"\s*:\s*"[^"]{12,}/i)) throw new StudioError("E_SECRET", "Secrets must be provided via environment variables / .env, never config.json");
  const cfg = studio.updateConfig(a.patch);
  studio.log({ agent: "project-director", event: "config.updated", message: `Updated studio config: ${Object.keys(a.patch).join(", ")}` });
  return cfg;
});
tool(server, "studio_asset_create", {
  title: "Register asset",
  capability: "write",
  needsInit: true,
  description: `Register a new asset (files must already exist). Types: ${ASSET_TYPES.join(", ")}. Starts as draft (or idea); approval only through QA.`,
  input: {
    id: external_exports.string(),
    type: external_exports.enum(ASSET_TYPES),
    name: external_exports.string().optional(),
    description: external_exports.string().optional(),
    status: external_exports.enum(["idea", "draft"]).optional(),
    files: external_exports.array(external_exports.union([external_exports.string(), external_exports.object({ path: external_exports.string(), role: external_exports.string().optional() })])).optional(),
    source: external_exports.record(external_exports.string(), external_exports.any()).optional().describe("Reproducible source: provider, prompt, parameters, source_files, references"),
    created_by: external_exports.string().optional(),
    dependencies: external_exports.array(external_exports.string()).optional(),
    minecraft_ids: external_exports.array(external_exports.string()).optional(),
    preview: external_exports.string().optional(),
    tags: external_exports.array(external_exports.string()).optional(),
    metadata: external_exports.record(external_exports.string(), external_exports.any()).optional()
  }
}, async (a, { studio }) => studio.createAsset(a));
tool(server, "studio_asset_update", {
  title: "Update asset / add version",
  capability: "write",
  needsInit: true,
  description: "Patch metadata; passing changed files creates a new archived version and resets status to draft (QA must re-approve).",
  input: { id: external_exports.string(), patch: external_exports.record(external_exports.string(), external_exports.any()), by: external_exports.string().optional(), note: external_exports.string().optional() }
}, async (a, { studio }) => studio.updateAsset(a.id, a.patch, { by: a.by, note: a.note }));
tool(
  server,
  "studio_asset_get",
  { title: "Get asset", capability: "read", needsInit: true, description: "Full asset record incl. versions and QA history.", input: { id: external_exports.string() } },
  async (a, { studio }) => studio.getAsset(a.id)
);
tool(server, "studio_asset_list", {
  title: "List assets",
  capability: "read",
  needsInit: true,
  description: "Filter assets by type, status, tag or text query.",
  input: { type: external_exports.enum(ASSET_TYPES).optional(), status: external_exports.enum(ASSET_STATUSES).optional(), tag: external_exports.string().optional(), query: external_exports.string().optional(), limit: external_exports.number().int().optional() }
}, async (a, { studio }) => {
  const rows = studio.listAssets(a);
  return { total: rows.length, assets: rows.slice(0, a.limit || 100).map((x) => ({ id: x.id, type: x.type, name: x.name, status: x.status, version: x.version, qa_status: x.qa_status, files: x.files.map((f) => f.path), minecraft_ids: x.minecraft_ids, modified_at: x.modified_at })) };
});
tool(server, "studio_asset_set_status", {
  title: "Change asset status",
  capability: "write",
  needsInit: true,
  description: `Lifecycle transition (${ASSET_STATUSES.join(" \u2192 ")}). "approved" requires a passing QA record for the current version; "integrated" requires approved.`,
  input: { id: external_exports.string(), status: external_exports.enum(ASSET_STATUSES), by: external_exports.string().optional(), reason: external_exports.string().optional() }
}, async (a, { studio }) => studio.setAssetStatus(a.id, a.status, { by: a.by, reason: a.reason }));
tool(server, "studio_asset_revert", {
  title: "Revert asset to version",
  capability: "write",
  needsInit: true,
  description: "Restore an archived version as a new version (non-destructive).",
  input: { id: external_exports.string(), version: external_exports.number().int(), by: external_exports.string().optional() }
}, async (a, { studio }) => studio.revertAsset(a.id, a.version, { by: a.by }));
tool(server, "studio_qa_record", {
  title: "Record QA verdict",
  capability: "write",
  needsInit: true,
  description: "Record a QA verdict for the current asset version. pass \u2192 approved, fail \u2192 changes-requested (automatic). Include concrete checks.",
  input: {
    id: external_exports.string(),
    by: external_exports.string().describe("QA agent, e.g. visual-qa"),
    verdict: external_exports.enum(["pass", "fail", "warn"]),
    summary: external_exports.string(),
    checks: external_exports.array(external_exports.object({ name: external_exports.string(), status: external_exports.enum(["pass", "fail", "warn", "info"]), detail: external_exports.string().optional() })).optional()
  }
}, async (a, { studio }) => studio.recordQa(a.id, { by: a.by, verdict: a.verdict, summary: a.summary, checks: a.checks || [] }));
tool(
  server,
  "studio_registry_integrity",
  { title: "Check registry integrity", capability: "read", needsInit: true, description: "Detect missing files, files changed outside the studio, and broken asset dependencies." },
  async (_a, { studio }) => studio.checkIntegrity()
);
tool(server, "studio_task_plan", {
  title: "Plan tasks (dependency graph)",
  capability: "write",
  needsInit: true,
  description: "Create/update production tasks with the delegation contract (goal, inputs, outputs, allowed tools, dependencies, constraints, quality, validation, destination). Tasks are applied in order, so list dependencies first. Cycles are rejected. Returns parallelisable layers.",
  input: { tasks: external_exports.array(taskSpec), by: external_exports.string().optional() }
}, async (a, { studio }) => {
  for (const t of a.tasks) studio.upsertTask(t, { by: a.by || "project-director" });
  return studio.graph();
});
tool(server, "studio_task_update", {
  title: "Update task status",
  capability: "write",
  needsInit: true,
  description: `Set status (${TASK_STATUSES.join(", ")}). "in-progress" is refused while dependencies are unfinished. Logs agent start/finish for the dashboard.`,
  input: { id: external_exports.string(), status: external_exports.enum(TASK_STATUSES), summary: external_exports.string().optional().describe("User-facing activity summary (no hidden reasoning)"), result: external_exports.any().optional() }
}, async (a, { studio }) => studio.setTaskStatus(a.id, a.status, { summary: a.summary, result: a.result }));
tool(
  server,
  "studio_task_list",
  { title: "List tasks", capability: "read", needsInit: true, description: "Tasks with status and agent.", input: { status: external_exports.enum(TASK_STATUSES).optional(), agent: external_exports.string().optional() } },
  async (a, { studio }) => studio.listTasks(a)
);
tool(
  server,
  "studio_task_graph",
  { title: "Task dependency graph", capability: "read", needsInit: true, description: "Topological layers (parallel batches), tasks ready to start, edges and a Mermaid diagram." },
  async (_a, { studio }) => studio.graph()
);
tool(server, "studio_memory_add", {
  title: "Add project memory",
  capability: "write",
  needsInit: true,
  description: `Persist a decision/convention/limitation so future sessions do not rely on chat history. Categories: ${MEMORY_CATEGORIES.join(", ")}.`,
  input: { category: external_exports.enum(MEMORY_CATEGORIES), title: external_exports.string(), content: external_exports.string(), by: external_exports.string().optional(), supersedes: external_exports.string().optional(), tags: external_exports.array(external_exports.string()).optional() }
}, async (a, { studio }) => studio.remember(a));
tool(server, "studio_memory_recall", {
  title: "Recall project memory",
  capability: "read",
  needsInit: true,
  description: "Read active memory entries (filter by category or text).",
  input: { category: external_exports.enum(MEMORY_CATEGORIES).optional(), query: external_exports.string().optional(), include_superseded: external_exports.boolean().optional() }
}, async (a, { studio }) => studio.recall(a));
tool(server, "studio_log", {
  title: "Log activity",
  capability: "write",
  needsInit: true,
  description: "Append a user-facing activity entry (timestamp, agent, task, event, asset, severity, message). Never log hidden reasoning or secrets.",
  input: { agent: external_exports.string(), event: external_exports.string(), message: external_exports.string(), task: external_exports.string().optional(), asset: external_exports.string().optional(), severity: external_exports.enum(SEVERITIES).optional() }
}, async (a, { studio }) => studio.log(a));
tool(server, "studio_activity", {
  title: "Read activity timeline",
  capability: "read",
  needsInit: true,
  description: "Recent activity entries, filterable.",
  input: { limit: external_exports.number().int().optional(), agent: external_exports.string().optional(), task: external_exports.string().optional(), asset: external_exports.string().optional(), severity: external_exports.enum(SEVERITIES).optional() }
}, async (a, { studio }) => studio.activity(a));
tool(server, "studio_timeline_save", {
  title: "Save timeline",
  capability: "write",
  needsInit: true,
  description: "Save a synchronised event timeline (tracks: event, sfx, animation, texture, particles, music, voice, ui, lighting, state) to .minecraft-studio/timelines and register it as an asset. Optionally export the compiled tick cues into the game project (e.g. src/main/resources/timelines/<id>.json).",
  input: { timeline: external_exports.record(external_exports.string(), external_exports.any()), export_to: external_exports.string().optional(), agent: external_exports.string().optional() }
}, async (a, { studio }) => {
  const tl = a.timeline;
  assertId(tl.id, "timeline id");
  const v = validateTimeline(tl);
  if (v.verdict === "fail") return { saved: false, validation: v };
  const file = studio.p("timelines", `${tl.id}.json`);
  writeJson(file, tl);
  const files = [studio.rel(file)];
  if (a.export_to) {
    writeJson(studio.abs(a.export_to), compileTimeline(tl));
    files.push(a.export_to);
  }
  const id = `timeline.${tl.id}`;
  const by = a.agent || "project-director";
  if (studio.hasAsset(id)) studio.updateAsset(id, { files, source: { format: "minecraft-studio-timeline/1" } }, { by });
  else studio.createAsset({ id, type: "timeline", name: tl.title || tl.id, description: `Synchronised timeline (${Object.keys(tl.tracks || {}).join(", ")})`, files, source: { format: "minecraft-studio-timeline/1" }, created_by: by, tags: ["timeline"] });
  return { saved: true, files, validation: v, lanes: renderTimelineText(tl) };
});
tool(server, "studio_timeline_validate", {
  title: "Validate timeline",
  capability: "read",
  needsInit: true,
  description: "Validate a timeline (by id or object): ordering, required fields, tick alignment, overlapping voice, unknown sound events (checked against a sounds.json if given).",
  input: { id: external_exports.string().optional(), timeline: external_exports.record(external_exports.string(), external_exports.any()).optional(), sounds_json: external_exports.string().optional().describe("Project-relative sounds.json to verify sound events"), namespace: external_exports.string().optional() }
}, async (a, { studio }) => {
  const tl = a.timeline || readJson(studio.p("timelines", `${assertId(a.id, "timeline id")}.json`));
  let soundEvents = null;
  if (a.sounds_json) {
    const ns = a.namespace || a.sounds_json.split("/").at(-2);
    soundEvents = Object.keys(readJson(studio.abs(a.sounds_json))).map((e) => `${ns}:${e}`);
  }
  return { ...validateTimeline(tl, { soundEvents }), lanes: renderTimelineText(tl) };
});
tool(
  server,
  "studio_timeline_list",
  { title: "List timelines", capability: "read", needsInit: true, description: "All saved timelines with compiled cue counts." },
  async (_a, { studio }) => {
    const dir = studio.p("timelines");
    if (!exists(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
      const tl = readJson(path.join(dir, f));
      return { id: tl.id, title: tl.title, duration: tl.duration, trigger: tl.trigger, tracks: Object.fromEntries(Object.entries(tl.tracks || {}).map(([k, v]) => [k, v.length])) };
    });
  }
);
tool(
  server,
  "studio_git_status",
  { title: "Git status", capability: "read", description: "Branch, uncommitted changes, last commit, remote, ahead/behind, recent log.", input: { log: external_exports.number().int().optional() } },
  async (a, { root }) => ({ ...gitStatus(root), log: gitLog(root, a.log || 10) })
);
tool(server, "studio_git_checkpoint", {
  title: "Git checkpoint commit",
  capability: "write",
  description: 'Commit a logical production step. Stages ONLY the given paths, scans them for secrets (refuses on findings), requires a Conventional Commit message, e.g. "feat(audio): add reactor startup sequence".',
  input: { message: external_exports.string(), paths: external_exports.array(external_exports.string()).min(1), trailer: external_exports.string().optional().describe("e.g. Co-Authored-By line") }
}, async (a, { studio, root }) => {
  const r = checkpoint(root, { message: a.message, paths: a.paths, trailer: a.trailer });
  if (r.committed && studio.isInitialized()) studio.log({ agent: "project-director", event: "git.commit", severity: "success", message: `Committed ${r.hash.slice(0, 7)} ${r.message}` });
  return r;
});
tool(
  server,
  "studio_git_secret_scan",
  { title: "Scan repository for secrets", capability: "read", description: "Scan all tracked + untracked (non-ignored) files for API keys/tokens before publishing. Reports file:line and kind, never the value." },
  async (_a, { root }) => scanRepository(root)
);
tool(server, "studio_agent_define", {
  title: "Agent Factory: define agent",
  capability: "write",
  needsInit: true,
  description: "Persist a new specialised agent in <project>/.claude/agents/ after validation. Only for recurring or serious specialisations (justification required). Becomes available after a plugin reload / new session; continue the current task with an existing agent.",
  input: {
    name: external_exports.string(),
    title: external_exports.string().optional(),
    description: external_exports.string().describe('Starts with "Use this agent when\u2026"'),
    specialization: external_exports.string(),
    tools: external_exports.array(external_exports.string()).optional(),
    model: external_exports.enum(["inherit", "sonnet", "opus", "haiku"]).optional(),
    color: external_exports.enum(["blue", "cyan", "green", "yellow", "magenta", "red"]).optional(),
    when: external_exports.array(external_exports.string()).optional(),
    input_contract: external_exports.array(external_exports.string()),
    output_contract: external_exports.array(external_exports.string()),
    qa_criteria: external_exports.array(external_exports.string()),
    instructions: external_exports.string().optional(),
    justification: external_exports.string(),
    created_by: external_exports.string().optional()
  }
}, async (a, { studio }) => createAgent(studio, a));
tool(server, "studio_tool_scaffold", {
  title: "Tool Factory: scaffold tool",
  capability: "write",
  needsInit: true,
  description: "Create a reusable project tool (manifest, implementation stub, test, README) under .minecraft-studio/tools/<name>/. Only for repeated operations (justification required).",
  input: { name: external_exports.string(), description: external_exports.string(), input_schema: external_exports.record(external_exports.string(), external_exports.any()).optional(), output_description: external_exports.string().optional(), justification: external_exports.string() }
}, async (a, { studio }) => scaffoldTool(studio, a));
tool(
  server,
  "studio_tool_list",
  { title: "List project tools", capability: "read", needsInit: true, description: "Project-specific tools created by the studio." },
  async (_a, { studio }) => listTools(studio)
);
tool(server, "studio_tool_run", {
  title: "Run project tool",
  capability: "execute",
  needsInit: true,
  description: "Run a project tool with JSON input (60 s timeout); returns its JSON output.",
  input: { name: external_exports.string(), input: external_exports.record(external_exports.string(), external_exports.any()).optional() }
}, async (a, { studio }) => {
  const out = runTool(studio, a.name, a.input || {});
  studio.log({ agent: "studio", event: "tool.run", message: `Ran project tool ${a.name}` });
  return out;
});
tool(
  server,
  "studio_tool_test",
  { title: "Test project tool", capability: "execute", needsInit: true, description: "Run the tool's test.mjs.", input: { name: external_exports.string() } },
  async (a, { studio }) => testTool(studio, a.name)
);
tool(
  server,
  "studio_providers",
  { title: "List providers", capability: "read", description: "All generation/processing providers with capabilities, availability, formats and whether they are paid." },
  async () => listProviders()
);
tool(
  server,
  "studio_usage",
  { title: "Provider usage & cost", capability: "read", needsInit: true, description: "Usage log of external providers (characters, generations, estimated cost)." },
  async (_a, { studio }) => studio.usage()
);
tool(server, "studio_test_record", {
  title: "Record test run",
  capability: "write",
  needsInit: true,
  description: "Store a test/QA run result (suite, passed, summary, details) for the dashboard Tests view.",
  input: { suite: external_exports.string(), passed: external_exports.boolean(), summary: external_exports.string(), details: external_exports.any().optional(), agent: external_exports.string().optional() }
}, async (a, { studio }) => studio.saveTestRun({ suite: a.suite, passed: a.passed, summary: a.summary, details: a.details, agent: a.agent }));
tool(server, "studio_doctor", {
  title: "Diagnose environment",
  capability: "read",
  description: "Check plugin, MCP bundles, Node, Git, GitHub, Java, build tools, FFmpeg, TTS, ElevenLabs credentials (presence/quota, never the value), Blockbench (install + MCP bridge), studio state and dashboard.",
  input: { offline: external_exports.boolean().optional() }
}, async (a, { root }) => {
  const report = await runDoctor({ projectRoot: root, live: !a.offline });
  return { ...report, text: formatDoctor(report) };
});
var here = path.dirname(fileURLToPath(import.meta.url));
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true))).listen(port, "127.0.0.1");
  });
}
tool(server, "studio_dashboard_start", {
  title: "Start Studio Dashboard",
  capability: "execute",
  needsInit: true,
  description: "Start (or reuse) the local Studio Dashboard web server bound to 127.0.0.1 and return its URL.",
  input: { port: external_exports.number().int().optional() }
}, async (a, { studio, root }) => {
  const port = a.port || studio.config().dashboard.port || 4777;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (r.ok) {
      const j = await r.json();
      if (path.resolve(j.project) === path.resolve(root)) return { url: `http://127.0.0.1:${port}`, already_running: true };
    }
  } catch {
  }
  if (!await portFree(port)) throw new StudioError("E_PORT", `Port ${port} is in use by another process/project; pass a different port`);
  const bundled = path.join(here, "dashboard.mjs");
  const entry = exists(bundled) ? bundled : path.join(here, "..", "dashboard", "server.js");
  const child = spawn(process.execPath, [entry, "--project", root, "--port", String(port)], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {
    }
  }
  studio.log({ agent: "studio", event: "dashboard.started", message: `Studio Dashboard at http://127.0.0.1:${port}` });
  return { url: `http://127.0.0.1:${port}`, pid: child.pid };
});
await start(server);
