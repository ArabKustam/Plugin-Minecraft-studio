// Structural validation of the Claude plugin beyond the official validator:
// manifest, skills & agents frontmatter, hooks/MCP command targets, and that
// every MCP tool referenced by an agent or a skill really exists in the servers.
//   node scripts/validate-plugin.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { McpClient } from '../tests/helpers/mcp-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warn = [];
const err = (m) => errors.push(m);

function frontmatter(file) {
  const t = fs.readFileSync(file, 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) { err(`${file}: missing YAML frontmatter`); return { fm: {}, body: '' }; }
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2];
    if (v.startsWith('"') || v.startsWith('[')) { try { v = JSON.parse(v); } catch { err(`${file}: invalid JSON value for ${kv[1]}`); } }
    fm[kv[1]] = v;
  }
  return { fm, body: m[2] };
}

// manifest
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(manifest.name)) err('plugin name must be kebab-case');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) err('plugin version must be semver');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime/package.json'), 'utf8'));
if (pkg.version !== manifest.version) err(`runtime/package.json version ${pkg.version} != plugin ${manifest.version}`);

// skills
const skillsDir = path.join(ROOT, 'skills');
const skills = fs.readdirSync(skillsDir);
for (const s of skills) {
  const f = path.join(skillsDir, s, 'SKILL.md');
  if (!fs.existsSync(f)) { err(`skills/${s}: missing SKILL.md`); continue; }
  const { fm, body } = frontmatter(f);
  if (fm.name !== s) err(`skills/${s}: name "${fm.name}" must equal directory`);
  if (!fm.description || fm.description.length < 80) err(`skills/${s}: description too short for reliable triggering`);
  if (fm.description?.length > 1024) err(`skills/${s}: description > 1024 chars`);
  if (body.split('\n').length > 500) warn.push(`skills/${s}: SKILL.md > 500 lines; move detail into references/`);
  for (const ref of body.matchAll(/references\/([a-z0-9-]+\.md)/g)) {
    if (!fs.existsSync(path.join(skillsDir, 'minecraft-studio', 'references', ref[1]))) err(`skills/${s}: broken reference ${ref[1]}`);
  }
}

// agents
const agentNames = [];
const agentTools = [];
for (const f of fs.readdirSync(path.join(ROOT, 'agents'))) {
  const { fm, body } = frontmatter(path.join(ROOT, 'agents', f));
  agentNames.push(fm.name);
  if (`${fm.name}.md` !== f) err(`agents/${f}: name must match file name`);
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(fm.name || '')) err(`agents/${f}: invalid name`);
  if (!/^Use this agent when/.test(fm.description || '')) err(`agents/${f}: description must start with "Use this agent when"`);
  if (!['inherit', 'sonnet', 'opus', 'haiku'].includes(fm.model)) err(`agents/${f}: invalid model`);
  if (!['blue', 'cyan', 'green', 'yellow', 'magenta', 'red'].includes(fm.color)) err(`agents/${f}: invalid color`);
  if (!/## When to invoke/.test(body)) err(`agents/${f}: missing "When to invoke" section`);
  if (body.length > 10000) err(`agents/${f}: system prompt > 10k chars`);
  if (Array.isArray(fm.tools)) for (const t of fm.tools) agentTools.push({ agent: fm.name, tool: t });
}

// hooks & MCP commands point at existing files
const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8')).mcpServers;
for (const [name, s] of Object.entries(mcp)) {
  for (const a of s.args || []) {
    const p = a.replace('${CLAUDE_PLUGIN_ROOT}', ROOT);
    if (a.includes('${CLAUDE_PLUGIN_ROOT}') && !fs.existsSync(p)) err(`.mcp.json ${name}: ${a} does not exist (build runtime first)`);
  }
}
const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
for (const list of Object.values(hooks.hooks)) for (const h of list.flatMap((x) => x.hooks)) {
  const m = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}([^"\s]+)/);
  if (m && !fs.existsSync(path.join(ROOT, m[1]))) err(`hooks: ${m[1]} does not exist`);
}

// every MCP tool referenced by agents/skills must exist
const serverTools = {};
for (const name of Object.keys(mcp)) {
  const c = new McpClient(name, { env: { CLAUDE_PROJECT_DIR: ROOT, MINECRAFT_STUDIO_CAPABILITIES: mcp[name].env?.MINECRAFT_STUDIO_CAPABILITIES || 'read,write,execute,publish' } });
  await c.init();
  serverTools[name] = new Set((await c.tools()).map((t) => t.name));
  c.close();
}
const allTools = new Set(Object.values(serverTools).flatMap((s) => [...s]));
for (const { agent, tool } of agentTools) {
  const m = tool.match(/^mcp__plugin_([a-z0-9-]+)_([a-z0-9-]+)__(.+)$/);
  if (!m) continue;
  if (m[1] !== manifest.name) err(`agent ${agent}: tool ${tool} references plugin ${m[1]}`);
  if (!serverTools[m[2]]) { err(`agent ${agent}: unknown server ${m[2]}`); continue; }
  if (m[3] !== '*' && !serverTools[m[2]].has(m[3])) err(`agent ${agent}: ${m[2]} has no tool ${m[3]} (capability-gated or renamed?)`);
}
const mentioned = new Set();
for (const s of skills) for (const f of [path.join(skillsDir, s, 'SKILL.md'), ...(fs.existsSync(path.join(skillsDir, s, 'references')) ? fs.readdirSync(path.join(skillsDir, s, 'references')).map((r) => path.join(skillsDir, s, 'references', r)) : [])]) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/`((?:studio|texture|model|animation|audio|mc)_[a-z_]+)/g)) mentioned.add(m[1]);
}
const FIELDS = new Set(['texture_size', 'texture_refs', 'model_path', 'audio_path']);
for (const t of mentioned) if (!allTools.has(t) && !FIELDS.has(t) && !/_\*$|_$/.test(t)) err(`skills mention unknown tool ${t}`);

// official validator when available
const manifestPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
let cv = spawnSync('claude', ['plugin', 'validate', manifestPath], { encoding: 'utf8' });
if (cv.error?.code === 'ENOENT' && process.platform === 'win32') cv = spawnSync(`claude plugin validate "${manifestPath}"`, { encoding: 'utf8', shell: true });
if (cv.status === 0) console.log('official validator: passed');
else if (cv.error || /not recognized|not found/.test(cv.stderr || '')) warn.push('claude CLI not available: official validator skipped');
else err(`official validator failed:\n${cv.stdout}${cv.stderr}`);

console.log(`skills: ${skills.length}, agents: ${agentNames.length}, MCP servers: ${Object.keys(mcp).length}, tools: ${allTools.size}, tools referenced by skills: ${mentioned.size}`);
for (const w of warn) console.log(`warning: ${w}`);
if (errors.length) { for (const e of errors) console.error(`error: ${e}`); process.exit(1); }
console.log('plugin structure: OK');
