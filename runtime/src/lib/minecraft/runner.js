// Build / test / run for Minecraft projects. Only adapter-provided commands
// (Gradle wrapper, Gradle, Maven, Java for the test server) are executed —
// never arbitrary shell strings.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { StudioError, ensureDir, sha256, exists } from '../core/fsutil.js';
import { redact } from '../core/secrets.js';
import { getAdapter, parseServerLog } from '../adapters/minecraft.js';

const ALLOWED = new Set(['gradlew', 'gradlew.bat', 'gradle', 'mvn']);

function execCommand(spec, cwd, { timeoutMs = 15 * 60 * 1000 } = {}) {
  if (!ALLOWED.has(spec.command)) throw new StudioError('E_EXEC', `Command ${spec.command} is not allowed`);
  const isWin = process.platform === 'win32';
  let cmd = spec.command, args = spec.args;
  if (spec.command === 'gradlew' || spec.command === 'gradlew.bat') cmd = path.join(cwd, spec.command);
  if (isWin) { args = ['/d', '/s', '/c', [quoteWin(cmd), ...args.map(quoteWin)].join(' ')]; cmd = process.env.ComSpec || 'cmd.exe'; }
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 128 * 1024 * 1024, windowsVerbatimArguments: isWin, env: { ...process.env, TERM: 'dumb' } });
  const output = redact(`${r.stdout || ''}\n${r.stderr || ''}`);
  return { ok: r.status === 0, exit_code: r.status, signal: r.signal, duration_s: Number(((Date.now() - started) / 1000).toFixed(1)), output };
}
const quoteWin = (s) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function summarizeBuildOutput(output) {
  const lines = output.split(/\r?\n/);
  const errors = lines.filter((l) => /error:|FAILURE:|BUILD FAILED|\[ERROR\]|e: file:|Exception/.test(l)).slice(0, 40);
  const warnings = lines.filter((l) => /warning:|\[WARNING\]|w: file:/.test(l)).slice(0, 40);
  return { errors, warnings, tail: lines.slice(-60).join('\n') };
}

export function runProjectCommand(root, adapterId, kind = 'build') {
  const adapter = getAdapter(adapterId);
  const spec = kind === 'test' ? adapter.test(root) : adapter.build(root);
  if (!spec) return { ok: true, skipped: true, reason: `${adapter.name} has no ${kind} step` };
  const r = execCommand(spec, root);
  const summary = summarizeBuildOutput(r.output);
  return { ok: r.ok, adapter: adapterId, command: `${spec.command} ${spec.args.join(' ')}`, exit_code: r.exit_code, duration_s: r.duration_s, errors: summary.errors, warnings: summary.warnings, output_tail: summary.tail, artifacts: r.ok ? adapter.artifacts(root) : [] };
}

export function javaVersion() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8', windowsHide: true });
  const txt = `${r.stdout}${r.stderr}`;
  const m = txt.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]);
  return { major, raw: txt.split(/\r?\n/)[0] };
}

/** Java required by Paper for a Minecraft version. */
export function requiredJava(mcVersion) {
  const major = Number(String(mcVersion).split('.')[0]);
  if (major >= 26) return 25;
  const minor = Number(String(mcVersion).split('.')[1] || 0);
  const patch = Number(String(mcVersion).split('.')[2] || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  return 17;
}

async function downloadPaper(version, dir) {
  const meta = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds/latest`, { headers: { 'user-agent': 'minecraft-studio (https://github.com/ArabKustam/Plugin-Minecraft-studio)' } });
  if (!meta.ok) throw new StudioError('E_PAPER', `Paper ${version} not found on fill.papermc.io (HTTP ${meta.status})`);
  const build = await meta.json();
  const dl = build.downloads?.['server:default'];
  if (!dl?.url) throw new StudioError('E_PAPER', 'Paper build has no server:default download');
  const jar = path.join(dir, `paper-${version}-${build.id}.jar`);
  if (!exists(jar)) {
    const res = await fetch(dl.url);
    if (!res.ok) throw new StudioError('E_PAPER', `Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (dl.checksums?.sha256 && sha256(buf) !== dl.checksums.sha256) throw new StudioError('E_PAPER', 'Paper jar checksum mismatch — refusing to run it');
    fs.writeFileSync(jar, buf);
  }
  return { jar, build: build.id, channel: build.channel };
}

/**
 * Run a disposable local Paper test server: install plugin jars, wait for
 * startup, run smoke-test console commands, stop, and analyse the log.
 * Requires minecraft.accept_eula=true in .minecraft-studio/config.json, set by
 * the user after reading https://aka.ms/MinecraftEULA (the studio never accepts it on its own).
 */
export async function runPaperTestServer(studio, { version, pluginJars = [], commands = [], timeoutS = null, waitAfterCommandsS = 5, port = 25599, resourcePackZip = null } = {}) {
  const cfg = studio.config();
  if (cfg.minecraft.accept_eula !== true) {
    throw new StudioError('E_EULA', 'Running a Minecraft server requires accepting the Minecraft EULA (https://aka.ms/MinecraftEULA). Ask the user; if they agree, set "minecraft": {"accept_eula": true} via studio_config_set.');
  }
  const java = javaVersion();
  const need = requiredJava(version);
  if (!java) throw new StudioError('E_JAVA', 'Java not found on PATH');
  if (java.major < need) throw new StudioError('E_JAVA', `Minecraft ${version} needs Java ${need}+, found Java ${java.major}`);
  const dir = ensureDir(studio.abs(cfg.minecraft.test_server_dir));
  const { jar, build, channel } = await downloadPaper(version, dir);
  fs.writeFileSync(path.join(dir, 'eula.txt'), '# accepted by the user via minecraft-studio config (minecraft.accept_eula)\neula=true\n');
  fs.writeFileSync(path.join(dir, 'server.properties'), [
    'online-mode=false', `server-port=${port}`, 'level-type=minecraft\\:flat', 'generate-structures=false', 'spawn-protection=0', 'max-players=4',
    'motd=Minecraft Studio test server', 'view-distance=4', 'simulation-distance=4', 'enable-command-block=true', 'server-ip=127.0.0.1',
  ].join('\n') + '\n');
  const pluginsDir = ensureDir(path.join(dir, 'plugins'));
  for (const f of fs.readdirSync(pluginsDir)) if (f.endsWith('.jar') && f.startsWith('studio-')) fs.rmSync(path.join(pluginsDir, f));
  for (const p of pluginJars) fs.copyFileSync(studio.abs(p), path.join(pluginsDir, `studio-${path.basename(p)}`));
  if (resourcePackZip) fs.copyFileSync(studio.abs(resourcePackZip), path.join(dir, 'resourcepack.zip'));
  const logFile = path.join(dir, `studio-run-${Date.now()}.log`);
  const out = fs.createWriteStream(logFile);
  const startTimeout = (timeoutS || cfg.minecraft.startup_timeout_s) * 1000;
  const started = Date.now();
  const child = spawn('java', ['-Xms512M', '-Xmx2G', '-Dpaper.playerconnection.keepalive=120', '-jar', path.basename(jar), '--nogui'], { cwd: dir, windowsHide: true });
  let text = '';
  const onData = (d) => { const s = d.toString(); text += s; out.write(s); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; if (child.exitCode !== null) return false; await new Promise((r) => setTimeout(r, 250)); } return false; };
  const ready = await waitFor(() => /Done \([0-9.,]+s\)!/.test(text), startTimeout);
  const commandResults = [];
  if (ready) {
    for (const c of commands) {
      const mark = text.length;
      child.stdin.write(`${c}\n`);
      await new Promise((r) => setTimeout(r, Math.max(1000, waitAfterCommandsS * 1000 / Math.max(1, commands.length))));
      commandResults.push({ command: c, output: text.slice(mark).split(/\r?\n/).filter(Boolean).slice(0, 30) });
    }
    child.stdin.write('stop\n');
  }
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 60000))]);
  if (code === 'timeout' || child.exitCode === null) child.kill('SIGKILL');
  out.end();
  const parsed = parseServerLog(text);
  const pluginErrors = parsed.errors.filter((e) => !/Mojang|authlib|keepalive|Failed to fetch|session/i.test(e.text));
  const result = {
    ok: ready && pluginErrors.length === 0, ready, startup_s: Number(((Date.now() - started) / 1000).toFixed(1)),
    paper: { version, build, channel }, java: java.major, loaded_plugins: parsed.loaded_plugins,
    errors: pluginErrors.slice(0, 30), warnings: parsed.warnings.slice(0, 30), commands: commandResults, log_file: studio.rel(logFile),
  };
  return result;
}

export { parseServerLog };
