// The Studio: persistent production state for one Minecraft project.
//
// Layout (all under <project>/.minecraft-studio/):
//   project.json        project profile (platform, versions, namespaces, conventions)
//   config.json         provider selection & studio settings (never secrets)
//   style-profile.json  default visual style profile
//   assets/<id>.json    asset registry records
//   history/<id>/vN/    archived files for every asset version
//   sources/<id>/       reproducible sources (pixel specs, model specs, scores, prompts)
//   previews/<id>/      generated previews used by QA and the dashboard
//   tasks/<id>.json     production tasks (dependency graph nodes)
//   memory/memory.json  project memory (decisions, conventions, limitations, bugs)
//   timelines/<id>.json synchronised event timelines
//   voices/<id>.json    voice profiles;  voices/pronunciation.json dictionary
//   tests/<run>.json    test & QA run results
//   logs/activity.jsonl structured activity log;  logs/usage.jsonl provider cost log
//   tools/<name>/       project-specific reusable tools created by the studio
import fs from 'node:fs';
import path from 'node:path';
import {
  StudioError, ensureDir, readJson, writeJson, nowIso, assertId, sha256, safeJoin, relPosix, exists,
} from './fsutil.js';
import { loadDotEnv, redact } from './secrets.js';

export const STUDIO_DIR = '.minecraft-studio';
export const SCHEMA_VERSION = 1;

export const ASSET_TYPES = ['texture', 'model', 'animation', 'sfx', 'music', 'voice', 'particle', 'code', 'configuration', 'guide', 'reference', 'tool', 'timeline'];
export const ASSET_STATUSES = ['idea', 'draft', 'review', 'changes-requested', 'approved', 'integrated', 'deprecated'];
const TRANSITIONS = {
  idea: ['draft', 'deprecated'],
  draft: ['review', 'deprecated'],
  review: ['changes-requested', 'approved', 'draft', 'deprecated'],
  'changes-requested': ['draft', 'review', 'deprecated'],
  approved: ['integrated', 'changes-requested', 'review', 'deprecated'],
  integrated: ['review', 'changes-requested', 'deprecated'],
  deprecated: ['draft'],
};
export const TASK_STATUSES = ['pending', 'ready', 'in-progress', 'blocked', 'review', 'done', 'failed', 'cancelled'];
export const SEVERITIES = ['debug', 'info', 'success', 'warning', 'error'];
export const MEMORY_CATEGORIES = ['decision', 'convention', 'naming', 'visual-style', 'voice', 'music', 'platform', 'limitation', 'integration', 'bug', 'note'];

export const DEFAULT_CONFIG = {
  schema_version: SCHEMA_VERSION,
  providers: {
    image: 'none',
    sfx: 'local-synth',
    music: 'local-composer',
    voice: 'auto',
    modeling: 'studio-model',
  },
  audio: { master_format: 'flac', sample_rate: 48000, target_lufs_sfx: -16, target_lufs_music: -20, target_lufs_voice: -18 },
  costs: { confirm_above_usd: 1.0, max_generations_per_asset: 6 },
  dashboard: { port: 4777 },
  minecraft: { accept_eula: false, test_server_dir: '.minecraft-studio/test-server', startup_timeout_s: 180 },
  git: { auto_checkpoint: true, scan_secrets_before_commit: true },
  telemetry: false,
};

export class Studio {
  constructor(projectRoot) {
    this.root = path.resolve(projectRoot);
    this.dir = path.join(this.root, STUDIO_DIR);
    loadDotEnv(this.root);
  }

  // ---------- basics ----------
  p(...parts) { return path.join(this.dir, ...parts); }
  isInitialized() { return exists(this.p('project.json')); }
  requireInit() {
    if (!this.isInitialized()) {
      throw new StudioError('E_NOT_INIT', `Minecraft Studio is not initialised in ${this.root}. Run the init workflow (/minecraft-studio:init) or studio_project_init first.`);
    }
  }
  abs(rel) { return safeJoin(this.root, rel); }
  rel(abs) { return relPosix(this.root, abs); }

  ensureLayout() {
    for (const d of ['assets', 'history', 'sources', 'previews', 'tasks', 'memory', 'timelines', 'voices', 'tests', 'logs', 'tools', 'qa']) {
      ensureDir(this.p(d));
    }
    if (!exists(this.p('config.json'))) writeJson(this.p('config.json'), DEFAULT_CONFIG);
    const gi = this.p('.gitignore');
    if (!exists(gi)) {
      fs.writeFileSync(gi, ['# Minecraft Studio: transient state that should not be committed', 'test-server/', 'cache/', 'tmp/', '*.tmp', ''].join('\n'));
    }
  }

  config() {
    const cfg = readJson(this.p('config.json'), {});
    return deepMerge(structuredClone(DEFAULT_CONFIG), cfg);
  }
  updateConfig(patch) {
    const next = deepMerge(this.config(), patch);
    for (const key of Object.keys(next.providers || {})) {
      if (/key|token|secret/i.test(String(next.providers[key]))) throw new StudioError('E_SECRET', 'Secrets must not be stored in config.json; use environment variables or .env');
    }
    writeJson(this.p('config.json'), next);
    return next;
  }

  project() { return readJson(this.p('project.json'), null); }
  saveProject(profile) {
    writeJson(this.p('project.json'), { schema_version: SCHEMA_VERSION, ...profile, updated_at: nowIso() });
  }

  // ---------- activity log ----------
  log({ agent = 'studio', task = null, event, asset = null, severity = 'info', message, data } = {}) {
    if (!event || !message) throw new StudioError('E_LOG', 'log entries need event and message');
    if (!SEVERITIES.includes(severity)) severity = 'info';
    const entry = { ts: nowIso(), agent, task, event, asset, severity, message: redact(message) };
    if (data !== undefined) entry.data = JSON.parse(redact(JSON.stringify(data)));
    ensureDir(this.p('logs'));
    fs.appendFileSync(this.p('logs', 'activity.jsonl'), JSON.stringify(entry) + '\n');
    return entry;
  }
  activity({ limit = 200, agent, task, asset, severity, since } = {}) {
    const file = this.p('logs', 'activity.jsonl');
    if (!exists(file)) return [];
    let rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (agent) rows = rows.filter((r) => r.agent === agent);
    if (task) rows = rows.filter((r) => r.task === task);
    if (asset) rows = rows.filter((r) => r.asset === asset);
    if (severity) rows = rows.filter((r) => r.severity === severity);
    if (since) rows = rows.filter((r) => r.ts >= since);
    return rows.slice(-limit);
  }

  recordUsage({ provider, operation, units, unit, estimated_usd = null, asset = null, agent = null }) {
    const entry = { ts: nowIso(), provider, operation, units, unit, estimated_usd, asset, agent };
    ensureDir(this.p('logs'));
    fs.appendFileSync(this.p('logs', 'usage.jsonl'), JSON.stringify(entry) + '\n');
    return entry;
  }
  usage() {
    const file = this.p('logs', 'usage.jsonl');
    if (!exists(file)) return { entries: [], total_usd: 0 };
    const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { entries, total_usd: Number(entries.reduce((a, e) => a + (e.estimated_usd || 0), 0).toFixed(4)) };
  }

  // ---------- asset registry ----------
  assetPath(id) { return this.p('assets', `${assertId(id, 'asset id')}.json`); }
  hasAsset(id) { return exists(this.assetPath(id)); }
  getAsset(id) {
    const f = this.assetPath(id);
    if (!exists(f)) throw new StudioError('E_NOT_FOUND', `Asset not found: ${id}`);
    return readJson(f);
  }
  listAssets({ type, status, tag, query } = {}) {
    const dir = this.p('assets');
    if (!exists(dir)) return [];
    let rows = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f)));
    if (type) rows = rows.filter((a) => a.type === type);
    if (status) rows = rows.filter((a) => a.status === status);
    if (tag) rows = rows.filter((a) => (a.tags || []).includes(tag));
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((a) => `${a.id} ${a.name} ${a.description} ${(a.tags || []).join(' ')} ${(a.minecraft_ids || []).join(' ')}`.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''));
  }

  describeFiles(files) {
    return (files || []).map((f) => {
      const rel = typeof f === 'string' ? f : f.path;
      const abs = this.abs(rel);
      if (!exists(abs)) throw new StudioError('E_FILE', `Asset file does not exist: ${rel}`);
      const st = fs.statSync(abs);
      return { path: rel.replace(/\\/g, '/'), role: (typeof f === 'object' && f.role) || 'primary', sha256: sha256(abs), bytes: st.size };
    });
  }

  createAsset({ id, type, name, description = '', status = 'draft', files = [], source = {}, created_by = 'studio', dependencies = [], minecraft_ids = [], preview = null, tags = [], metadata = {}, imported = false }) {
    assertId(id, 'asset id');
    if (!ASSET_TYPES.includes(type)) throw new StudioError('E_TYPE', `Unknown asset type ${type}. Allowed: ${ASSET_TYPES.join(', ')}`);
    if (imported) status = 'integrated';
    else if (!['idea', 'draft'].includes(status)) throw new StudioError('E_STATUS', 'New assets start as idea or draft; approval requires QA');
    if (this.hasAsset(id)) throw new StudioError('E_EXISTS', `Asset ${id} already exists; use studio_asset_update to add a version`);
    for (const dep of dependencies) if (!this.hasAsset(dep)) throw new StudioError('E_DEP', `Dependency asset not found: ${dep}`);
    const at = nowIso();
    const described = this.describeFiles(files);
    const asset = {
      id, type, name: name || id, description, status, version: described.length ? 1 : 0,
      files: described, source: sanitizeSource(source), created_at: at, modified_at: at, created_by,
      dependencies, minecraft_ids, preview, tags, qa_status: imported ? 'n/a' : 'pending', qa_history: [],
      versions: [], metadata,
    };
    if (imported) {
      asset.versions.push({ version: 1, at, by: created_by, note: 'imported existing project file', files: described.map((f) => ({ path: f.path, sha256: f.sha256 })), archived_dir: null, source: asset.source });
      writeJson(this.assetPath(id), asset);
      return asset;
    }
    if (described.length) asset.versions.push(this.archiveVersion(asset, 1, created_by, 'initial version'));
    writeJson(this.assetPath(id), asset);
    this.log({ agent: created_by, event: 'asset.created', asset: id, severity: 'success', message: `${created_by} created ${type} ${id}${asset.version ? ` v${asset.version}` : ''}` });
    return asset;
  }

  archiveVersion(asset, version, by, note) {
    const vdir = this.p('history', asset.id, `v${version}`);
    ensureDir(vdir);
    for (const f of asset.files) {
      const target = path.join(vdir, f.path.replace(/[\\/:]/g, '__'));
      fs.copyFileSync(this.abs(f.path), target);
    }
    return { version, at: nowIso(), by, note, files: asset.files.map((f) => ({ path: f.path, sha256: f.sha256 })), archived_dir: this.rel(vdir), source: asset.source };
  }

  updateAsset(id, patch = {}, { by = 'studio', note = '' } = {}) {
    const asset = this.getAsset(id);
    const allowed = ['name', 'description', 'source', 'dependencies', 'minecraft_ids', 'preview', 'tags', 'metadata', 'files'];
    for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new StudioError('E_FIELD', `Field ${k} cannot be patched directly (status changes go through studio_asset_set_status / QA)`);
    if (patch.dependencies) for (const dep of patch.dependencies) if (!this.hasAsset(dep)) throw new StudioError('E_DEP', `Dependency asset not found: ${dep}`);
    if (patch.dependencies?.includes(id)) throw new StudioError('E_DEP', 'Asset cannot depend on itself');
    let newVersion = false;
    if (patch.files) {
      const described = this.describeFiles(patch.files);
      const changed = JSON.stringify(described.map((f) => [f.path, f.sha256])) !== JSON.stringify(asset.files.map((f) => [f.path, f.sha256]));
      asset.files = described;
      if (changed) newVersion = true;
      delete patch.files;
    }
    if (patch.source) patch.source = sanitizeSource(patch.source);
    Object.assign(asset, patch);
    if (newVersion) {
      asset.version += 1;
      asset.versions.push(this.archiveVersion(asset, asset.version, by, note || 'revision'));
      asset.qa_status = 'pending';
      if (['approved', 'integrated', 'review', 'changes-requested'].includes(asset.status)) asset.status = 'draft';
    }
    asset.modified_at = nowIso();
    writeJson(this.assetPath(id), asset);
    this.log({ agent: by, event: newVersion ? 'asset.version' : 'asset.updated', asset: id, message: newVersion ? `${by} created ${id} v${asset.version}${note ? ` — ${note}` : ''}` : `${by} updated ${id} metadata` });
    return asset;
  }

  setAssetStatus(id, status, { by = 'studio', reason = '' } = {}) {
    const asset = this.getAsset(id);
    if (!ASSET_STATUSES.includes(status)) throw new StudioError('E_STATUS', `Unknown status ${status}`);
    if (asset.status === status) return asset;
    if (!TRANSITIONS[asset.status].includes(status)) {
      throw new StudioError('E_TRANSITION', `Illegal transition ${asset.status} → ${status}. Allowed: ${TRANSITIONS[asset.status].join(', ')}`);
    }
    if (status === 'approved') {
      const last = asset.qa_history.at(-1);
      if (!last || last.version !== asset.version || last.verdict !== 'pass') {
        throw new StudioError('E_QA', `Asset ${id} v${asset.version} cannot be approved without a passing QA record for this version`);
      }
    }
    if (status === 'integrated' && asset.status !== 'approved') throw new StudioError('E_QA', 'Only approved assets can be integrated');
    if (status === 'review' && asset.files.length === 0) throw new StudioError('E_FILE', 'Asset has no files to review');
    const prev = asset.status;
    asset.status = status;
    asset.modified_at = nowIso();
    writeJson(this.assetPath(id), asset);
    this.log({ agent: by, event: 'asset.status', asset: id, severity: status === 'changes-requested' ? 'warning' : status === 'approved' || status === 'integrated' ? 'success' : 'info', message: `${id}: ${prev} → ${status}${reason ? ` (${reason})` : ''}` });
    return asset;
  }

  /** Record a QA verdict. A pass moves review→approved; a fail moves to changes-requested. */
  recordQa(id, { by = 'qa', verdict, checks = [], summary = '', auto_transition = true }) {
    if (!['pass', 'fail', 'warn'].includes(verdict)) throw new StudioError('E_QA', 'verdict must be pass, fail or warn');
    const asset = this.getAsset(id);
    const rec = { at: nowIso(), by, version: asset.version, verdict, summary, checks };
    asset.qa_history.push(rec);
    asset.qa_status = verdict === 'pass' ? 'passed' : verdict === 'fail' ? 'failed' : 'warnings';
    asset.modified_at = nowIso();
    writeJson(this.assetPath(id), asset);
    this.log({ agent: by, event: `qa.${verdict}`, asset: id, severity: verdict === 'pass' ? 'success' : verdict === 'fail' ? 'warning' : 'info', message: `${by} ${verdict === 'pass' ? 'approved' : verdict === 'fail' ? 'rejected' : 'flagged'} ${id} v${asset.version}${summary ? ` — ${summary}` : ''}` });
    if (auto_transition) {
      if (asset.status === 'draft' || (verdict === 'pass' && asset.status === 'changes-requested')) this.setAssetStatus(id, 'review', { by });
      const cur = this.getAsset(id);
      if (verdict === 'pass' && cur.status === 'review') return this.setAssetStatus(id, 'approved', { by, reason: 'QA passed' });
      if (verdict === 'fail' && ['review', 'approved', 'integrated'].includes(cur.status)) return this.setAssetStatus(id, 'changes-requested', { by, reason: summary || 'QA failed' });
    }
    return this.getAsset(id);
  }

  /** Restore an archived version as a new version (non-destructive rollback). */
  revertAsset(id, version, { by = 'studio' } = {}) {
    const asset = this.getAsset(id);
    const v = asset.versions.find((x) => x.version === version);
    if (!v) throw new StudioError('E_NOT_FOUND', `Version ${version} of ${id} not found`);
    if (!v.archived_dir) throw new StudioError('E_NOT_ARCHIVED', `Version ${version} of ${id} was imported, not archived by the studio; restore it from Git history instead`);
    for (const f of v.files) {
      const archived = path.join(this.root, v.archived_dir, f.path.replace(/[\\/:]/g, '__'));
      ensureDir(path.dirname(this.abs(f.path)));
      fs.copyFileSync(archived, this.abs(f.path));
    }
    return this.updateAsset(id, { files: v.files.map((f) => f.path), source: v.source }, { by, note: `revert to v${version}` });
  }

  /** Detect broken references: missing files, changed files outside the studio, missing deps. */
  checkIntegrity() {
    const issues = [];
    const assets = this.listAssets();
    const ids = new Set(assets.map((a) => a.id));
    for (const a of assets) {
      for (const f of a.files) {
        let abs;
        try { abs = this.abs(f.path); } catch { issues.push({ asset: a.id, kind: 'bad-path', detail: f.path }); continue; }
        if (!exists(abs)) issues.push({ asset: a.id, kind: 'missing-file', detail: f.path });
        else if (sha256(abs) !== f.sha256) issues.push({ asset: a.id, kind: 'modified-outside-studio', detail: f.path });
      }
      for (const d of a.dependencies || []) if (!ids.has(d)) issues.push({ asset: a.id, kind: 'missing-dependency', detail: d });
    }
    return { ok: issues.length === 0, assets: assets.length, issues };
  }

  // ---------- tasks & dependency graph ----------
  taskPath(id) { return this.p('tasks', `${assertId(id, 'task id')}.json`); }
  getTask(id) {
    if (!exists(this.taskPath(id))) throw new StudioError('E_NOT_FOUND', `Task not found: ${id}`);
    return readJson(this.taskPath(id));
  }
  listTasks({ status, agent } = {}) {
    const dir = this.p('tasks');
    if (!exists(dir)) return [];
    let rows = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f)));
    if (status) rows = rows.filter((t) => t.status === status);
    if (agent) rows = rows.filter((t) => t.agent === agent);
    return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  upsertTask(spec, { by = 'project-director' } = {}) {
    assertId(spec.id, 'task id');
    const existing = exists(this.taskPath(spec.id)) ? this.getTask(spec.id) : null;
    const at = nowIso();
    const task = {
      id: spec.id,
      goal: spec.goal ?? existing?.goal ?? '',
      agent: spec.agent ?? existing?.agent ?? null,
      inputs: spec.inputs ?? existing?.inputs ?? [],
      outputs: spec.outputs ?? existing?.outputs ?? [],
      allowed_tools: spec.allowed_tools ?? existing?.allowed_tools ?? [],
      dependencies: spec.dependencies ?? existing?.dependencies ?? [],
      constraints: spec.constraints ?? existing?.constraints ?? [],
      quality: spec.quality ?? existing?.quality ?? [],
      validation: spec.validation ?? existing?.validation ?? [],
      destination: spec.destination ?? existing?.destination ?? null,
      assets: spec.assets ?? existing?.assets ?? [],
      status: existing?.status ?? 'pending',
      result: existing?.result ?? null,
      created_at: existing?.created_at ?? at,
      started_at: existing?.started_at ?? null,
      finished_at: existing?.finished_at ?? null,
      updated_at: at,
      plan: spec.plan ?? existing?.plan ?? null,
    };
    for (const dep of task.dependencies) {
      if (dep === task.id) throw new StudioError('E_DEP', 'Task cannot depend on itself');
      if (!exists(this.taskPath(dep))) throw new StudioError('E_DEP', `Dependency task not found: ${dep} (create dependencies first)`);
    }
    writeJson(this.taskPath(task.id), task);
    const cycle = this.findCycle();
    if (cycle) {
      if (existing) writeJson(this.taskPath(task.id), existing); else fs.unlinkSync(this.taskPath(task.id));
      throw new StudioError('E_CYCLE', `Dependency cycle: ${cycle.join(' → ')}`);
    }
    this.log({ agent: by, task: task.id, event: existing ? 'task.updated' : 'task.created', message: `${existing ? 'Updated' : 'Planned'} task ${task.id}${task.agent ? ` → ${task.agent}` : ''}: ${task.goal}` });
    return task;
  }
  setTaskStatus(id, status, { by = 'project-director', result, summary } = {}) {
    if (!TASK_STATUSES.includes(status)) throw new StudioError('E_STATUS', `Unknown task status ${status}`);
    const task = this.getTask(id);
    if (status === 'in-progress') {
      const blockers = task.dependencies.filter((d) => this.getTask(d).status !== 'done');
      if (blockers.length) throw new StudioError('E_BLOCKED', `Task ${id} is blocked by unfinished dependencies: ${blockers.join(', ')}`);
      task.started_at = nowIso();
    }
    if (['done', 'failed', 'cancelled'].includes(status)) task.finished_at = nowIso();
    if (result !== undefined) task.result = result;
    task.status = status;
    task.updated_at = nowIso();
    writeJson(this.taskPath(id), task);
    const agent = task.agent || by;
    const event = status === 'in-progress' ? 'agent.started' : status === 'done' ? 'agent.finished' : status === 'failed' ? 'agent.failed' : `task.${status}`;
    this.log({ agent, task: id, event, severity: status === 'done' ? 'success' : status === 'failed' ? 'error' : 'info', message: summary || `${agent} ${status === 'in-progress' ? 'started' : status} ${id}` });
    return task;
  }
  findCycle() {
    const tasks = new Map(this.listTasks().map((t) => [t.id, t]));
    const state = new Map();
    const stack = [];
    const visit = (id) => {
      if (state.get(id) === 2) return null;
      if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
      state.set(id, 1); stack.push(id);
      for (const d of tasks.get(id)?.dependencies || []) { const c = visit(d); if (c) return c; }
      stack.pop(); state.set(id, 2);
      return null;
    };
    for (const id of tasks.keys()) { const c = visit(id); if (c) return c; }
    return null;
  }
  /** Topological layers: tasks inside one layer can run in parallel. */
  graph() {
    const tasks = this.listTasks();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const depth = new Map();
    const d = (id) => {
      if (depth.has(id)) return depth.get(id);
      const t = byId.get(id);
      const v = !t || t.dependencies.length === 0 ? 0 : 1 + Math.max(...t.dependencies.map(d));
      depth.set(id, v);
      return v;
    };
    tasks.forEach((t) => d(t.id));
    const layers = [];
    for (const t of tasks) (layers[depth.get(t.id)] ||= []).push(t.id);
    const ready = tasks.filter((t) => ['pending', 'ready'].includes(t.status) && t.dependencies.every((x) => byId.get(x)?.status === 'done')).map((t) => t.id);
    const edges = tasks.flatMap((t) => t.dependencies.map((dep) => ({ from: dep, to: t.id })));
    const mermaid = ['graph TD', ...tasks.map((t) => `  ${mid(t.id)}["${t.id}<br/>${t.agent || ''} · ${t.status}"]`), ...edges.map((e) => `  ${mid(e.from)} --> ${mid(e.to)}`)].join('\n');
    return { layers, ready, edges, mermaid, counts: countBy(tasks, 'status') };
  }

  // ---------- project memory ----------
  memory() { return readJson(this.p('memory', 'memory.json'), { entries: [] }); }
  remember({ category, title, content, by = 'studio', supersedes = null, tags = [] }) {
    if (!MEMORY_CATEGORIES.includes(category)) throw new StudioError('E_CATEGORY', `Unknown memory category ${category}. Allowed: ${MEMORY_CATEGORIES.join(', ')}`);
    const mem = this.memory();
    const id = `${category}-${String(mem.entries.length + 1).padStart(4, '0')}`;
    if (supersedes) {
      const old = mem.entries.find((e) => e.id === supersedes);
      if (!old) throw new StudioError('E_NOT_FOUND', `Memory entry ${supersedes} not found`);
      old.superseded_by = id;
    }
    const entry = { id, category, title, content: redact(content), tags, by, at: nowIso(), superseded_by: null };
    mem.entries.push(entry);
    writeJson(this.p('memory', 'memory.json'), mem);
    this.log({ agent: by, event: 'memory.added', message: `Recorded ${category}: ${title}` });
    return entry;
  }
  recall({ category, query, include_superseded = false } = {}) {
    let rows = this.memory().entries;
    if (!include_superseded) rows = rows.filter((e) => !e.superseded_by);
    if (category) rows = rows.filter((e) => e.category === category);
    if (query) { const q = query.toLowerCase(); rows = rows.filter((e) => `${e.title} ${e.content} ${e.tags.join(' ')}`.toLowerCase().includes(q)); }
    return rows;
  }

  // ---------- test results ----------
  saveTestRun(run) {
    const id = run.id || `run-${Date.now()}`;
    const rec = { id, at: nowIso(), ...run };
    writeJson(this.p('tests', `${assertId(id, 'run id')}.json`), rec);
    this.log({ agent: run.agent || 'integration-qa', event: 'tests.run', severity: run.passed ? 'success' : 'error', message: `${run.suite || 'tests'}: ${run.passed ? 'passed' : 'FAILED'} (${run.summary || ''})` });
    return rec;
  }
  listTestRuns(limit = 50) {
    const dir = this.p('tests');
    if (!exists(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}

function sanitizeSource(source) {
  return JSON.parse(redact(JSON.stringify(source || {})));
}

function countBy(rows, key) {
  return rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
}

function mid(id) { return id.replace(/[^a-zA-Z0-9_]/g, '_'); }

export function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

export function openStudio(projectRoot) {
  return new Studio(projectRoot);
}
