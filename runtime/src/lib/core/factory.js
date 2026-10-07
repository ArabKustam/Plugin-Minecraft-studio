// Agent Factory & Tool Factory.
//
// Agents: when a recurring or serious specialisation is missing (e.g. a
// Particle Artist), the Project Director writes a validated agent definition
// into the project's .claude/agents/ directory. Claude Code loads project
// agents at session start, so a new agent is usable after a reload; until
// then the current task continues with the closest existing agent.
//
// Tools: reusable operations become project tools under
// .minecraft-studio/tools/<name>/ with a manifest, implementation, test and
// README, runnable through studio_tool_run.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { StudioError, ensureDir, readJson, writeJson, exists, nowIso } from './fsutil.js';

const AGENT_NAME = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const COLORS = ['blue', 'cyan', 'green', 'yellow', 'magenta', 'red'];
const BASE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'Agent'];

export function validateAgentSpec(spec, existingNames = []) {
  const problems = [];
  if (!AGENT_NAME.test(spec.name || '')) problems.push('name must be 3-50 chars, lowercase letters, digits and hyphens, starting/ending alphanumeric');
  if (existingNames.includes(spec.name)) problems.push(`an agent named ${spec.name} already exists`);
  if (!spec.description || spec.description.length < 60) problems.push('description must explain when to use the agent (≥ 60 chars, start with "Use this agent when…")');
  if (spec.description && !/^Use this agent when/i.test(spec.description)) problems.push('description should start with "Use this agent when"');
  if (!spec.specialization) problems.push('specialization is required (one narrow responsibility)');
  for (const k of ['input_contract', 'output_contract', 'qa_criteria']) if (!spec[k] || (Array.isArray(spec[k]) && !spec[k].length)) problems.push(`${k} is required`);
  for (const t of spec.tools || []) if (!BASE_TOOLS.includes(t) && !/^mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_*-]+)?$/.test(t)) problems.push(`unknown tool ${t}`);
  if (spec.tools && spec.tools.length > 12) problems.push('too many tools: keep the minimum needed');
  if (spec.color && !COLORS.includes(spec.color)) problems.push(`color must be one of ${COLORS.join(', ')}`);
  if ((spec.instructions || '').length > 9000) problems.push('instructions too long (keep < 9000 chars; move details into skill references)');
  if (!spec.justification) problems.push('justification required: why a persistent agent instead of a one-off delegated task?');
  return problems;
}

const list = (v) => (Array.isArray(v) ? v.map((x) => `- ${x}`).join('\n') : String(v));

export function renderAgentMarkdown(spec) {
  const fm = [
    '---', `name: ${spec.name}`, `description: ${JSON.stringify(spec.description)}`, `model: ${spec.model || 'inherit'}`, `color: ${spec.color || 'cyan'}`,
    ...(spec.tools?.length ? [`tools: ${JSON.stringify(spec.tools)}`] : []), '---', '',
  ].join('\n');
  return `${fm}You are the **${spec.title || spec.name}** of a Minecraft Studio production team. Your single specialisation: ${spec.specialization}.

## When to invoke
${list(spec.when || [spec.description])}

## Input contract
${list(spec.input_contract)}

## Output contract
${list(spec.output_contract)}

## Process
${spec.instructions || '1. Read the task contract and the project memory (studio_memory_recall).\n2. Produce the outputs inside the declared destination only.\n3. Validate with the relevant studio tools.\n4. Register outputs in the Asset Registry and report.'}

## Quality criteria (QA will check these)
${list(spec.qa_criteria)}

## Rules
- Only change files listed in your task's outputs/destination; never modify unrelated parts of the project.
- Register every produced asset (studio_asset_create / studio_asset_update) with its reproducible source.
- Never mark your own work as approved: QA agents decide.
- Report: Created / Changed / Validated / Failed / Needs review.
`;
}

export function createAgent(studio, spec) {
  const agentsDir = path.join(studio.root, '.claude', 'agents');
  const registryFile = studio.p('agents.json');
  const registry = readJson(registryFile, { agents: [] });
  const existing = [...registry.agents.map((a) => a.name), ...(exists(agentsDir) ? fs.readdirSync(agentsDir).map((f) => f.replace(/\.md$/, '')) : [])];
  const problems = validateAgentSpec(spec, existing);
  if (problems.length) throw new StudioError('E_AGENT', `Agent definition rejected: ${problems.join('; ')}`);
  const file = path.join(ensureDir(agentsDir), `${spec.name}.md`);
  fs.writeFileSync(file, renderAgentMarkdown(spec));
  registry.agents.push({ name: spec.name, file: studio.rel(file), specialization: spec.specialization, justification: spec.justification, created_at: nowIso(), created_by: spec.created_by || 'project-director' });
  writeJson(registryFile, registry);
  studio.log({ agent: spec.created_by || 'project-director', event: 'agent.defined', message: `Defined new agent ${spec.name} (${spec.specialization})` });
  return { file: studio.rel(file), active_after: 'Claude Code loads project agents at session start: available after /reload-plugins or a new session. Continue the current task with the closest existing agent.' };
}

// ---------------------------------------------------------------- tools
const TOOL_NAME = /^[a-z][a-z0-9-]{2,40}$/;

export function scaffoldTool(studio, { name, description, input_schema = { type: 'object', properties: {} }, output_description = '', justification }) {
  if (!TOOL_NAME.test(name || '')) throw new StudioError('E_TOOL', 'Tool name must be kebab-case (3-41 chars)');
  if (!description || description.length < 20) throw new StudioError('E_TOOL', 'Describe the tool purpose (≥ 20 chars)');
  if (!justification) throw new StudioError('E_TOOL', 'justification required: tools are only created for reusable, repeated operations');
  const dir = studio.p('tools', name);
  if (exists(dir)) throw new StudioError('E_TOOL', `Tool ${name} already exists`);
  ensureDir(dir);
  writeJson(path.join(dir, 'tool.json'), { name, description, input_schema, output_description, entry: 'index.mjs', test: 'test.mjs', version: 1, justification, created_at: nowIso() });
  fs.writeFileSync(path.join(dir, 'index.mjs'), `// ${name}: ${description}
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
  fs.writeFileSync(path.join(dir, 'test.mjs'), `import assert from 'node:assert/strict';
import { run } from './index.mjs';

const r = await run({}, { projectRoot: process.cwd() });
assert.equal(r.ok, true);
process.stdout.write('ok\n');
`);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\n${description}\n\n## Why\n\n${justification}\n\n## Input\n\n\`\`\`json\n${JSON.stringify(input_schema, null, 2)}\n\`\`\`\n\n## Output\n\n${output_description || 'JSON object.'}\n\n## Usage\n\n\`studio_tool_run\` with \`{"name": "${name}", "input": {...}}\`\n`);
  studio.log({ agent: 'project-director', event: 'tool.created', message: `Scaffolded project tool ${name}` });
  return { dir: studio.rel(dir), files: ['tool.json', 'index.mjs', 'test.mjs', 'README.md'].map((f) => studio.rel(path.join(dir, f))), next: 'Implement run() in index.mjs, extend test.mjs, then studio_tool_test. Update the relevant skill reference with a usage note.' };
}

export function listTools(studio) {
  const dir = studio.p('tools');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((d) => exists(path.join(dir, d, 'tool.json'))).map((d) => readJson(path.join(dir, d, 'tool.json')));
}

function nodeExec(studio, file, input, timeout) {
  const r = spawnSync(process.execPath, [file], { cwd: studio.root, input: JSON.stringify(input ?? {}), encoding: 'utf8', timeout, windowsHide: true, env: { ...process.env, MS_PROJECT_ROOT: studio.root } });
  return r;
}

export function runTool(studio, name, input, { timeoutMs = 60000 } = {}) {
  if (!TOOL_NAME.test(name)) throw new StudioError('E_TOOL', 'invalid tool name');
  const manifest = readJson(studio.p('tools', name, 'tool.json'));
  const r = nodeExec(studio, studio.p('tools', name, manifest.entry), input, timeoutMs);
  let out;
  try { out = JSON.parse(r.stdout || 'null'); } catch { out = { raw: (r.stdout || '').slice(0, 2000) }; }
  if (r.status !== 0) throw new StudioError('E_TOOL', `Tool ${name} failed (exit ${r.status}): ${out?.error || r.stderr?.slice(0, 800) || 'no output'}`);
  return out;
}

export function testTool(studio, name) {
  if (!TOOL_NAME.test(name)) throw new StudioError('E_TOOL', 'invalid tool name');
  const manifest = readJson(studio.p('tools', name, 'tool.json'));
  const r = nodeExec(studio, studio.p('tools', name, manifest.test), {}, 120000);
  return { passed: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.slice(-3000) };
}
