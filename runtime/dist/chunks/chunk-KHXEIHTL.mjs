import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  StudioError,
  ensureDir,
  exists,
  nowIso,
  readJson,
  scanFiles,
  writeJson
} from "./chunk-RRZML6EW.mjs";

// src/lib/core/git.js
import { spawnSync } from "node:child_process";
function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.error?.code === "ENOENT") throw new StudioError("E_GIT", "git is not installed");
  if (r.status !== 0 && !allowFail) throw new StudioError("E_GIT", `git ${args[0]} failed: ${(r.stderr || "").trim().slice(0, 500)}`);
  return { ok: r.status === 0, out: (r.stdout || "").trimEnd(), err: (r.stderr || "").trim() };
}
function isRepo(root) {
  try {
    return git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }).out === "true";
  } catch {
    return false;
  }
}
function gitStatus(root) {
  if (!isRepo(root)) return { repo: false };
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).out || null;
  const top = git(root, ["rev-parse", "--show-toplevel"]).out;
  const porcelain = git(root, ["status", "--porcelain=v1", "--", "."], { allowFail: true }).out;
  const changes = porcelain ? porcelain.split("\n").map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) })) : [];
  const last = git(root, ["log", "-1", "--format=%H%x1f%s%x1f%an%x1f%aI"], { allowFail: true }).out;
  const [hash, subject, author, date] = last ? last.split("") : [];
  const remote = git(root, ["remote", "get-url", "origin"], { allowFail: true }).out || null;
  const ab = remote ? git(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], { allowFail: true }).out : "";
  const [behind, ahead] = ab ? ab.split(/\s+/).map(Number) : [null, null];
  return { repo: true, toplevel: top, branch, clean: changes.length === 0, changes: changes.slice(0, 200), change_count: changes.length, last_commit: hash ? { hash, subject, author, date } : null, remote: remote ? remote.replace(/\/\/[^@/]+@/, "//") : null, ahead, behind };
}
function gitLog(root, limit = 30) {
  if (!isRepo(root)) return [];
  const out = git(root, ["log", `-${limit}`, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", "--", "."], { allowFail: true }).out;
  return out ? out.split("\n").map((l) => {
    const [hash, short, subject, author, date] = l.split("");
    return { hash, short, subject, author, date };
  }) : [];
}
var CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|assets?)(\([a-z0-9._/-]+\))?!?: .{3,}/;
function checkpoint(root, { message, paths, allowEmpty = false, trailer = null }) {
  if (!isRepo(root)) throw new StudioError("E_GIT", "Not a git repository. Initialise one first (git init) \u2014 ask the user if this is their project root.");
  if (!CONVENTIONAL.test(message.split("\n")[0])) throw new StudioError("E_GIT", `Commit message must follow Conventional Commits, e.g. "feat(textures): add reactor active states". Got: ${message.split("\n")[0]}`);
  if (!Array.isArray(paths) || !paths.length) throw new StudioError("E_GIT", "paths to commit are required (the studio never stages the whole repository blindly)");
  for (const p of paths) if (p.includes("..") || /^[/\\]|^[a-z]:/i.test(p)) throw new StudioError("E_PATH", `Invalid path ${p}`);
  git(root, ["add", "--", ...paths]);
  const staged = git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { allowFail: true }).out.split("\0").filter(Boolean);
  const top = git(root, ["rev-parse", "--show-toplevel"]).out;
  const findings = scanFiles(top, staged);
  if (findings.length) {
    git(root, ["reset", "-q", "--", ...paths], { allowFail: true });
    throw new StudioError("E_SECRET", `Refusing to commit: possible secrets found \u2192 ${findings.slice(0, 10).map((f) => `${f.file}:${f.line} (${f.kind})`).join(", ")}. Values were not printed. Remove them, use environment variables, and retry.`);
  }
  if (!staged.length && !allowEmpty) return { committed: false, reason: "nothing to commit for the given paths" };
  const full = trailer ? `${message}

${trailer}` : message;
  git(root, ["commit", "-q", ...allowEmpty ? ["--allow-empty"] : [], "-m", full]);
  const hash = git(root, ["rev-parse", "HEAD"]).out;
  return { committed: true, hash, files: staged.length, message: message.split("\n")[0] };
}
function scanRepository(root) {
  if (!isRepo(root)) throw new StudioError("E_GIT", "Not a git repository");
  const tracked = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { allowFail: true }).out.split("\0").filter(Boolean);
  const findings = scanFiles(root, tracked);
  return { scanned: tracked.length, clean: findings.length === 0, findings };
}

// src/lib/core/timeline.js
var TRACKS = ["event", "sfx", "animation", "texture", "particles", "music", "voice", "ui", "lighting", "state"];
var REQUIRED = { sfx: ["sound"], animation: ["animation"], texture: ["state"], particles: ["particle"], music: ["action"], voice: ["line"], ui: [], lighting: ["level"], state: ["state"], event: ["id"] };
function validateTimeline(tl, { soundEvents = null, animations = null, music = null } = {}) {
  const issues = [];
  const add = (severity, track, detail) => issues.push({ severity, track, detail });
  if (!tl?.id) add("error", "-", "timeline needs an id");
  if (!(tl?.duration > 0)) add("error", "-", "duration must be > 0 seconds");
  for (const [track, cues] of Object.entries(tl?.tracks || {})) {
    if (!TRACKS.includes(track)) {
      add("error", track, `unknown track (allowed: ${TRACKS.join(", ")})`);
      continue;
    }
    if (!Array.isArray(cues)) {
      add("error", track, "track must be an array");
      continue;
    }
    let prev = -Infinity;
    for (const c of cues) {
      if (typeof c.t !== "number" || c.t < 0) add("error", track, `cue without valid time: ${JSON.stringify(c)}`);
      if (c.t > tl.duration + 1e-9) add("warning", track, `cue at ${c.t}s is after the timeline end (${tl.duration}s)`);
      if (c.t < prev) add("warning", track, `cues are not sorted (${c.t}s after ${prev}s)`);
      prev = c.t;
      for (const k of REQUIRED[track] || []) if (c[k] === void 0) add("error", track, `cue at ${c.t}s missing "${k}"`);
      if (track === "sfx" && soundEvents && c.sound && !soundEvents.includes(c.sound)) add("error", track, `sound event ${c.sound} not defined in sounds.json`);
      if (track === "voice" && soundEvents && c.sound && !soundEvents.includes(c.sound)) add("error", track, `voice sound ${c.sound} not defined in sounds.json`);
      if (track === "animation" && animations && !animations.includes(c.animation)) add("error", track, `animation ${c.animation} not found`);
      if (Math.abs(c.t * 20 - Math.round(c.t * 20)) > 1e-6) add("info", track, `cue at ${c.t}s is not on a game tick (rounds to ${Math.round(c.t * 20) / 20}s)`);
    }
  }
  const voice = [...tl?.tracks?.voice || []].sort((a, b) => a.t - b.t);
  for (let i = 1; i < voice.length; i++) if (voice[i - 1].duration && voice[i - 1].t + voice[i - 1].duration > voice[i].t) add("warning", "voice", `voice line ${voice[i].line} starts before ${voice[i - 1].line} ends`);
  if (music?.bar_seconds) {
    for (const c of tl?.tracks?.music || []) if (c.quantize !== "bar" && c.quantize !== "beat") add("info", "music", `music cue at ${c.t}s has no quantize; the game will switch immediately (may cut a phrase)`);
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  return { verdict: errors ? "fail" : issues.some((i) => i.severity === "warning") ? "warn" : "pass", issues };
}
function compileTimeline(tl) {
  const v = validateTimeline(tl);
  if (v.verdict === "fail") throw new StudioError("E_TIMELINE", `Timeline invalid: ${v.issues.filter((i) => i.severity === "error").map((i) => `${i.track}: ${i.detail}`).join("; ")}`);
  const cues = [];
  for (const [track, list2] of Object.entries(tl.tracks || {})) for (const c of list2) cues.push({ tick: Math.round(c.t * 20), t: c.t, track, ...c });
  cues.sort((a, b) => a.tick - b.tick || TRACKS.indexOf(a.track) - TRACKS.indexOf(b.track));
  return { id: tl.id, title: tl.title || tl.id, trigger: tl.trigger || null, duration_ticks: Math.round(tl.duration * 20), duration: tl.duration, cues };
}
function renderTimelineText(tl, width = 60) {
  const lines = [];
  const scale = (t) => Math.min(width - 1, Math.round(t / tl.duration * (width - 1)));
  lines.push(`${"time".padEnd(10)}|${"0s".padEnd(width - 6)}${`${tl.duration}s`.padStart(6)}`);
  for (const [track, cues] of Object.entries(tl.tracks || {})) {
    const row = Array(width).fill("\xB7");
    for (const c of cues) row[scale(c.t)] = "\u25C6";
    lines.push(`${track.padEnd(10)}|${row.join("")}`);
  }
  return lines.join("\n");
}

// src/lib/core/factory.js
import fs from "node:fs";
import path from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
var AGENT_NAME = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
var COLORS = ["blue", "cyan", "green", "yellow", "magenta", "red"];
var BASE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch", "Agent"];
function validateAgentSpec(spec, existingNames = []) {
  const problems = [];
  if (!AGENT_NAME.test(spec.name || "")) problems.push("name must be 3-50 chars, lowercase letters, digits and hyphens, starting/ending alphanumeric");
  if (existingNames.includes(spec.name)) problems.push(`an agent named ${spec.name} already exists`);
  if (!spec.description || spec.description.length < 60) problems.push('description must explain when to use the agent (\u2265 60 chars, start with "Use this agent when\u2026")');
  if (spec.description && !/^Use this agent when/i.test(spec.description)) problems.push('description should start with "Use this agent when"');
  if (!spec.specialization) problems.push("specialization is required (one narrow responsibility)");
  for (const k of ["input_contract", "output_contract", "qa_criteria"]) if (!spec[k] || Array.isArray(spec[k]) && !spec[k].length) problems.push(`${k} is required`);
  for (const t of spec.tools || []) if (!BASE_TOOLS.includes(t) && !/^mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_*-]+)?$/.test(t)) problems.push(`unknown tool ${t}`);
  if (spec.tools && spec.tools.length > 12) problems.push("too many tools: keep the minimum needed");
  if (spec.color && !COLORS.includes(spec.color)) problems.push(`color must be one of ${COLORS.join(", ")}`);
  if ((spec.instructions || "").length > 9e3) problems.push("instructions too long (keep < 9000 chars; move details into skill references)");
  if (!spec.justification) problems.push("justification required: why a persistent agent instead of a one-off delegated task?");
  return problems;
}
var list = (v) => Array.isArray(v) ? v.map((x) => `- ${x}`).join("\n") : String(v);
function renderAgentMarkdown(spec) {
  const fm = [
    "---",
    `name: ${spec.name}`,
    `description: ${JSON.stringify(spec.description)}`,
    `model: ${spec.model || "inherit"}`,
    `color: ${spec.color || "cyan"}`,
    ...spec.tools?.length ? [`tools: ${JSON.stringify(spec.tools)}`] : [],
    "---",
    ""
  ].join("\n");
  return `${fm}You are the **${spec.title || spec.name}** of a Minecraft Studio production team. Your single specialisation: ${spec.specialization}.

## When to invoke
${list(spec.when || [spec.description])}

## Input contract
${list(spec.input_contract)}

## Output contract
${list(spec.output_contract)}

## Process
${spec.instructions || "1. Read the task contract and the project memory (studio_memory_recall).\n2. Produce the outputs inside the declared destination only.\n3. Validate with the relevant studio tools.\n4. Register outputs in the Asset Registry and report."}

## Quality criteria (QA will check these)
${list(spec.qa_criteria)}

## Rules
- Only change files listed in your task's outputs/destination; never modify unrelated parts of the project.
- Register every produced asset (studio_asset_create / studio_asset_update) with its reproducible source.
- Never mark your own work as approved: QA agents decide.
- Report: Created / Changed / Validated / Failed / Needs review.
`;
}
function createAgent(studio, spec) {
  const agentsDir = path.join(studio.root, ".claude", "agents");
  const registryFile = studio.p("agents.json");
  const registry = readJson(registryFile, { agents: [] });
  const existing = [...registry.agents.map((a) => a.name), ...exists(agentsDir) ? fs.readdirSync(agentsDir).map((f) => f.replace(/\.md$/, "")) : []];
  const problems = validateAgentSpec(spec, existing);
  if (problems.length) throw new StudioError("E_AGENT", `Agent definition rejected: ${problems.join("; ")}`);
  const file = path.join(ensureDir(agentsDir), `${spec.name}.md`);
  fs.writeFileSync(file, renderAgentMarkdown(spec));
  registry.agents.push({ name: spec.name, file: studio.rel(file), specialization: spec.specialization, justification: spec.justification, created_at: nowIso(), created_by: spec.created_by || "project-director" });
  writeJson(registryFile, registry);
  studio.log({ agent: spec.created_by || "project-director", event: "agent.defined", message: `Defined new agent ${spec.name} (${spec.specialization})` });
  return { file: studio.rel(file), active_after: "Claude Code loads project agents at session start: available after /reload-plugins or a new session. Continue the current task with the closest existing agent." };
}
var TOOL_NAME = /^[a-z][a-z0-9-]{2,40}$/;
function scaffoldTool(studio, { name, description, input_schema = { type: "object", properties: {} }, output_description = "", justification }) {
  if (!TOOL_NAME.test(name || "")) throw new StudioError("E_TOOL", "Tool name must be kebab-case (3-41 chars)");
  if (!description || description.length < 20) throw new StudioError("E_TOOL", "Describe the tool purpose (\u2265 20 chars)");
  if (!justification) throw new StudioError("E_TOOL", "justification required: tools are only created for reusable, repeated operations");
  const dir = studio.p("tools", name);
  if (exists(dir)) throw new StudioError("E_TOOL", `Tool ${name} already exists`);
  ensureDir(dir);
  writeJson(path.join(dir, "tool.json"), { name, description, input_schema, output_description, entry: "index.mjs", test: "test.mjs", version: 1, justification, created_at: nowIso() });
  fs.writeFileSync(path.join(dir, "index.mjs"), `// ${name}: ${description}
// Contract: read JSON input from stdin, write ONE JSON object to stdout.
// Exit code 0 = success. Throwing prints {"error": "..."} and exits 1.
import fs from 'node:fs';

export async function run(input, ctx) {
  // ctx.projectRoot: absolute project path. Validate every path you read/write stays inside it.
  return { ok: true, input };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\\\/]/).pop())) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  run(input, { projectRoot: process.env.MS_PROJECT_ROOT || process.cwd() })
    .then((r) => process.stdout.write(JSON.stringify(r)))
    .catch((e) => { process.stdout.write(JSON.stringify({ error: e.message })); process.exit(1); });
}
`);
  fs.writeFileSync(path.join(dir, "test.mjs"), `import assert from 'node:assert/strict';
import { run } from './index.mjs';

const r = await run({}, { projectRoot: process.cwd() });
assert.equal(r.ok, true);
process.stdout.write('ok
');
`);
  fs.writeFileSync(path.join(dir, "README.md"), `# ${name}

${description}

## Why

${justification}

## Input

\`\`\`json
${JSON.stringify(input_schema, null, 2)}
\`\`\`

## Output

${output_description || "JSON object."}

## Usage

\`studio_tool_run\` with \`{"name": "${name}", "input": {...}}\`
`);
  studio.log({ agent: "project-director", event: "tool.created", message: `Scaffolded project tool ${name}` });
  return { dir: studio.rel(dir), files: ["tool.json", "index.mjs", "test.mjs", "README.md"].map((f) => studio.rel(path.join(dir, f))), next: "Implement run() in index.mjs, extend test.mjs, then studio_tool_test. Update the relevant skill reference with a usage note." };
}
function listTools(studio) {
  const dir = studio.p("tools");
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((d) => exists(path.join(dir, d, "tool.json"))).map((d) => readJson(path.join(dir, d, "tool.json")));
}
function nodeExec(studio, file, input, timeout) {
  const r = spawnSync2(process.execPath, [file], { cwd: studio.root, input: JSON.stringify(input ?? {}), encoding: "utf8", timeout, windowsHide: true, env: { ...process.env, MS_PROJECT_ROOT: studio.root } });
  return r;
}
function runTool(studio, name, input, { timeoutMs = 6e4 } = {}) {
  if (!TOOL_NAME.test(name)) throw new StudioError("E_TOOL", "invalid tool name");
  const manifest = readJson(studio.p("tools", name, "tool.json"));
  const r = nodeExec(studio, studio.p("tools", name, manifest.entry), input, timeoutMs);
  let out;
  try {
    out = JSON.parse(r.stdout || "null");
  } catch {
    out = { raw: (r.stdout || "").slice(0, 2e3) };
  }
  if (r.status !== 0) throw new StudioError("E_TOOL", `Tool ${name} failed (exit ${r.status}): ${out?.error || r.stderr?.slice(0, 800) || "no output"}`);
  return out;
}
function testTool(studio, name) {
  if (!TOOL_NAME.test(name)) throw new StudioError("E_TOOL", "invalid tool name");
  const manifest = readJson(studio.p("tools", name, "tool.json"));
  const r = nodeExec(studio, studio.p("tools", name, manifest.test), {}, 12e4);
  return { passed: r.status === 0, output: `${r.stdout || ""}${r.stderr || ""}`.slice(-3e3) };
}

export {
  isRepo,
  gitStatus,
  gitLog,
  checkpoint,
  scanRepository,
  validateTimeline,
  compileTimeline,
  renderTimelineText,
  createAgent,
  scaffoldTool,
  listTools,
  runTool,
  testTool
};
