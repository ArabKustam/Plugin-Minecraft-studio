// Studio Dashboard backend. A small local HTTP server (127.0.0.1 only) that
// exposes read-only views over the studio state. The UI never talks to
// providers directly: it only consumes Asset Registry, Task Registry,
// project state, QA results, Git state and logs through this API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Studio } from '../lib/core/studio.js';
import { gitStatus, gitLog } from '../lib/core/git.js';
import { listProviders } from '../lib/providers/index.js';
import { listTools } from '../lib/core/factory.js';
import { secretStatus, redact } from '../lib/core/secrets.js';
import { readJson, exists, safeJoin, walk } from '../lib/core/fsutil.js';
import { compileTimeline } from '../lib/core/timeline.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.bbmodel': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mcmeta': 'application/json; charset=utf-8' };
const SERVABLE = /\.(png|ogg|wav|flac|mp3|json|md|bbmodel|mcmeta|txt)$/i;

export function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { project: path.resolve(get('--project', process.env.MINECRAFT_STUDIO_PROJECT || process.cwd())), port: Number(get('--port', 4777)), host: '127.0.0.1' };
}

function staticRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [path.join(here, '..', 'studio', 'web-dashboard'), path.join(here, '..', '..', 'studio', 'web-dashboard'), path.join(here, '..', '..', '..', 'studio', 'web-dashboard')]) {
    if (exists(path.join(c, 'index.html'))) return c;
  }
  throw new Error('Dashboard static files not found (studio/web-dashboard)');
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : redact(JSON.stringify(body)));
};

function agentsFromActivity(studio) {
  const tasks = studio.listTasks();
  const byAgent = new Map();
  for (const t of tasks) {
    if (!t.agent) continue;
    const a = byAgent.get(t.agent) || { agent: t.agent, tasks: [] };
    a.tasks.push({ id: t.id, goal: t.goal, status: t.status, started: t.started_at, finished: t.finished_at, inputs: t.inputs, outputs: t.outputs, tools: t.allowed_tools, result: t.result });
    byAgent.set(t.agent, a);
  }
  for (const e of studio.activity({ limit: 5000 })) {
    if (!e.agent || e.agent === 'import') continue;
    const a = byAgent.get(e.agent) || { agent: e.agent, tasks: [] };
    a.last_activity = e.ts;
    a.events = (a.events || 0) + 1;
    byAgent.set(e.agent, a);
  }
  return [...byAgent.values()].map((a) => ({ ...a, status: a.tasks.some((t) => t.status === 'in-progress') ? 'working' : a.tasks.some((t) => ['pending', 'ready'].includes(t.status)) ? 'queued' : 'idle' }))
    .sort((x, y) => (y.last_activity || '').localeCompare(x.last_activity || ''));
}

function guides(studio) {
  const assets = studio.listAssets({ type: 'guide' });
  return assets.map((g) => ({ id: g.id, name: g.name, description: g.description, status: g.status, file: g.files[0]?.path, modified_at: g.modified_at }));
}

function references(studio) {
  const out = [];
  for (const dir of ['docs/research', 'docs/adr']) {
    const abs = path.join(studio.root, dir);
    if (exists(abs)) for (const f of walk(abs).filter((x) => x.endsWith('.md'))) out.push({ kind: dir.split('/')[1], file: `${dir}/${f}`, title: (fs.readFileSync(path.join(abs, f), 'utf8').match(/^#\s+(.+)$/m) || [])[1] || f });
  }
  for (const a of studio.listAssets({ type: 'reference' })) out.push({ kind: 'asset', file: a.files[0]?.path, title: a.name, id: a.id });
  return out;
}

function overview(studio) {
  const p = studio.project() || {};
  const assets = studio.listAssets();
  const tasks = studio.listTasks();
  const runs = studio.listTestRuns(50);
  const lastBy = (suite) => runs.find((r) => r.suite === suite);
  const build = lastBy('build');
  const qaCounts = assets.reduce((acc, a) => { acc[a.qa_status] = (acc[a.qa_status] || 0) + 1; return acc; }, {});
  const statusCounts = assets.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});
  const typeCounts = assets.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {});
  const git = gitStatus(studio.root);
  return {
    project: { name: p.name, minecraft_version: p.minecraft_version, platform: p.platform, platforms: p.platforms, plugin_version: p.plugin_version || p.plugin_descriptor?.version || null, resource_pack_version: p.resource_pack_version || null, default_namespace: p.default_namespace },
    build: build ? { passed: build.passed, at: build.at, summary: build.summary } : null,
    qa: { counts: qaCounts, last_runs: runs.slice(0, 6).map((r) => ({ suite: r.suite, passed: r.passed, at: r.at, summary: r.summary })) },
    git: git.repo ? { branch: git.branch, clean: git.clean, changes: git.change_count, last_commit: git.last_commit, remote: git.remote } : null,
    agents: agentsFromActivity(studio).filter((a) => a.status === 'working').map((a) => a.agent),
    tasks: { counts: tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}), current: tasks.filter((t) => t.status === 'in-progress').map((t) => ({ id: t.id, agent: t.agent, goal: t.goal })) },
    assets: { total: assets.length, by_status: statusCounts, by_type: typeCounts, recent: assets.filter((a) => !a.tags?.includes('existing')).slice(0, 12).map((a) => ({ id: a.id, type: a.type, name: a.name, status: a.status, version: a.version, preview: a.preview, modified_at: a.modified_at })) },
    usage: studio.usage().total_usd,
  };
}

export function createDashboard({ project, port = 4777, host = '127.0.0.1' }) {
  const studio = new Studio(project);
  const root = staticRoot();
  const clients = new Set();
  let watcher = null;
  // .minecraft-studio may not exist yet (project not initialised): retry on later requests.
  const ensureWatcher = () => {
    if (watcher || !exists(studio.dir)) return;
    try {
      watcher = fs.watch(studio.dir, { recursive: true }, (_e, f) => { for (const c of clients) c.write(`event: change\ndata: ${JSON.stringify({ file: String(f || '').replace(/\\/g, '/') })}\n\n`); });
      watcher.on('error', () => { watcher?.close(); watcher = null; });
    } catch { /* recursive watch unsupported: UI falls back to polling */ }
  };
  ensureWatcher();

  const routes = {
    '/api/health': () => ({ ok: true, project: studio.root, initialized: studio.isInitialized() }),
    '/api/overview': () => overview(studio),
    '/api/project': () => ({ profile: studio.project(), config: studio.config(), secrets: secretStatus() }),
    '/api/assets': (q) => studio.listAssets({ type: q.get('type') || undefined, status: q.get('status') || undefined, tag: q.get('tag') || undefined, query: q.get('q') || undefined })
      .filter((a) => q.get('existing') === '1' || !a.tags?.includes('existing') || q.get('type'))
      .map((a) => ({ ...a, versions: a.versions.length, qa_history: a.qa_history.length, metadata: { ...a.metadata, waveform: undefined } })),
    '/api/asset': (q) => studio.getAsset(q.get('id')),
    '/api/tasks': () => ({ tasks: studio.listTasks(), graph: studio.graph() }),
    '/api/agents': () => agentsFromActivity(studio),
    '/api/activity': (q) => studio.activity({ limit: Number(q.get('limit') || 300), agent: q.get('agent') || undefined, severity: q.get('severity') || undefined }).reverse(),
    '/api/tests': () => studio.listTestRuns(100),
    '/api/git': () => ({ status: gitStatus(studio.root), log: gitLog(studio.root, 50) }),
    '/api/memory': () => studio.memory(),
    '/api/timelines': () => {
      const dir = studio.p('timelines');
      return exists(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { const tl = readJson(path.join(dir, f)); let compiled = null; try { compiled = compileTimeline(tl); } catch { /* invalid */ } return { ...tl, compiled_cues: compiled?.cues.length ?? null }; }) : [];
    },
    '/api/voices': () => {
      const dir = studio.p('voices');
      return exists(dir) ? { profiles: fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'pronunciation.json').map((f) => readJson(path.join(dir, f))).map((v) => ({ ...v, providers: Object.fromEntries(Object.entries(v.providers || {}).map(([k, val]) => [k, { ...val }])) })), pronunciation: readJson(path.join(dir, 'pronunciation.json'), { entries: [] }) } : { profiles: [], pronunciation: { entries: [] } };
    },
    '/api/guides': () => guides(studio),
    '/api/references': () => references(studio),
    '/api/tools': () => ({ project_tools: listTools(studio), providers: listProviders() }),
    '/api/style': () => readJson(studio.p('style-profile.json'), null),
    '/api/logs': (q) => studio.activity({ limit: Number(q.get('limit') || 500), severity: q.get('severity') || undefined }).reverse(),
    '/api/usage': () => studio.usage(),
    '/api/settings': () => ({ config: studio.config(), secrets: secretStatus(), providers: listProviders() }),
  };

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${host}`);
      if (req.method !== 'GET') return send(res, 405, { error: 'read-only dashboard' });
      let hostHeader = '';
      try { hostHeader = new URL(`http://${req.headers.host || ''}`).hostname; } catch { /* invalid host */ }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostHeader)) return send(res, 403, { error: 'forbidden host' }); // DNS-rebinding guard
      ensureWatcher();
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('event: hello\ndata: {}\n\n');
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (url.pathname === '/api/file') {
        const rel = url.searchParams.get('path') || '';
        if (!SERVABLE.test(rel)) return send(res, 415, { error: 'file type not served' });
        if (/(^|\/)\.env/.test(rel)) return send(res, 403, { error: 'forbidden' });
        const abs = safeJoin(studio.root, rel);
        if (!exists(abs)) return send(res, 404, { error: 'not found' });
        const st = fs.statSync(abs);
        const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
        const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
        if (range && /audio/.test(type)) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Number(range[2]) : st.size - 1;
          res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
          return fs.createReadStream(abs, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
        return fs.createReadStream(abs).pipe(res);
      }
      const handler = routes[url.pathname];
      if (handler) {
        if (!studio.isInitialized() && url.pathname !== '/api/health') return send(res, 409, { error: 'not-initialized', message: 'Run /minecraft-studio:init in this project first.' });
        return send(res, 200, handler(url.searchParams));
      }
      // static UI
      let rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      let abs;
      try { abs = safeJoin(root, rel); } catch { return send(res, 400, { error: 'bad path' }); }
      if (!exists(abs) || fs.statSync(abs).isDirectory()) { rel = 'index.html'; abs = path.join(root, rel); }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(abs).pipe(res);
    } catch (err) {
      return send(res, err.code === 'E_NOT_FOUND' ? 404 : err.code === 'E_PATH' ? 400 : 500, { error: err.code || 'E_INTERNAL', message: redact(err.message) });
    }
  });
  return { server, listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(`http://${host}:${port}`))), close: () => { watcher?.close(); for (const c of clients) c.end(); server.close(); } };
}
