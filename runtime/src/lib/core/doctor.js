// /minecraft-studio:doctor — environment & integration diagnostics.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFfmpeg } from '../audio/ffmpeg.js';
import { resolveSoundfont, DEFAULT_SOUNDFONT } from '../audio/soundbank.js';
import { javaVersion } from '../minecraft/runner.js';
import { VOICE_PROVIDERS } from '../providers/index.js';
import { getSecret } from './secrets.js';
import { gitStatus } from './git.js';
import { Studio } from './studio.js';
import { exists, readJson } from './fsutil.js';

const which = (cmd, args = ['--version']) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && !cmd.includes('/'), timeout: 20000 });
  return r.status === 0 ? `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/)[0] : null;
};

async function probe(url, ms = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { signal: ctrl.signal }); return { reachable: true, status: r.status }; } catch { return { reachable: false }; } finally { clearTimeout(t); }
}

function blockbenchInstall() {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Blockbench', 'Blockbench.exe'), 'C:/Program Files/Blockbench/Blockbench.exe']
    : process.platform === 'darwin' ? ['/Applications/Blockbench.app'] : ['/usr/bin/blockbench', '/snap/bin/blockbench', path.join(os.homedir(), 'Applications', 'Blockbench.AppImage')];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

/** Run all checks. live=true performs network checks (ElevenLabs quota, Blockbench bridge). */
export async function runDoctor({ projectRoot, pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || null, live = true, dashboardPort = 4777 } = {}) {
  const checks = [];
  const add = (component, status, detail, fix = null) => checks.push({ component, status, detail, ...(fix ? { fix } : {}) });

  // plugin
  if (pluginRoot && exists(path.join(pluginRoot, '.claude-plugin', 'plugin.json'))) {
    const m = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
    add('Claude plugin', 'ok', `${m.name} v${m.version} at ${pluginRoot}`);
    const dist = ['studio-core', 'studio-texture', 'studio-model', 'studio-audio', 'studio-minecraft'].filter((s) => !exists(path.join(pluginRoot, 'runtime', 'dist', `${s}.mjs`)));
    add('MCP servers (bundled)', dist.length ? 'error' : 'ok', dist.length ? `missing bundles: ${dist.join(', ')}` : '5 servers: studio-core, studio-texture, studio-model, studio-audio, studio-minecraft', dist.length ? 'Reinstall the plugin or run `npm run build` in runtime/' : null);
  } else add('Claude plugin', 'warn', 'CLAUDE_PLUGIN_ROOT not set (running outside Claude Code?)');

  // runtime
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('Node.js', nodeMajor >= 20 ? 'ok' : 'error', `v${process.versions.node}`, nodeMajor >= 20 ? null : 'Install Node.js 20 or newer (MCP servers run on Node)');
  const gitV = which('git');
  add('Git', gitV ? 'ok' : 'error', gitV || 'not found', gitV ? null : 'Install Git');
  if (projectRoot) {
    const gs = gitStatus(projectRoot);
    add('Project repository', gs.repo ? 'ok' : 'warn', gs.repo ? `branch ${gs.branch}, ${gs.clean ? 'clean' : `${gs.change_count} uncommitted changes`}${gs.remote ? `, remote ${gs.remote}` : ', no remote'}` : 'project is not a git repository', gs.repo ? null : 'Run `git init` (Minecraft Studio uses commits as checkpoints)');
  }
  const gh = which('gh');
  const ghToken = getSecret('GITHUB_TOKEN') || getSecret('GITHUB_PERSONAL_ACCESS_TOKEN');
  add('GitHub', gh || ghToken ? 'ok' : 'warn', [gh ? `gh CLI ${gh.replace(/^gh version /, '')}` : null, ghToken ? 'token in environment' : null].filter(Boolean).join(', ') || 'no gh CLI and no token — local Git still works', gh || ghToken ? null : 'Optional: install gh (https://cli.github.com) or connect the official GitHub MCP server (docs/integrations.md)');

  // minecraft toolchain
  const jv = javaVersion();
  add('Java', jv ? (jv.major >= 21 ? 'ok' : 'warn') : 'error', jv ? `Java ${jv.major} (${jv.raw})` : 'not found', jv ? (jv.major >= 25 ? null : 'Minecraft 1.20.5–1.21.11 needs Java 21; Minecraft 26.x needs Java 25') : 'Install a JDK (Temurin 21 or 25)');
  const mvn = which('mvn', ['-v']);
  const gradle = which('gradle', ['--version']);
  add('Build tools', 'ok', [gradle ? 'gradle' : null, mvn ? 'maven' : null].filter(Boolean).join(', ') || 'none globally (Gradle wrapper in projects is enough)');

  // media
  const ff = findFfmpeg();
  add('FFmpeg', ff ? (ff.vorbis ? 'ok' : 'warn') : 'warn', ff ? `${ff.version}${ff.vorbis ? ', libvorbis ✓' : ', NO libvorbis'}` : 'not found — synthesis works, but Ogg Vorbis export for Minecraft is unavailable', ff ? null : 'Install FFmpeg with libvorbis (winget install Gyan.FFmpeg / brew install ffmpeg / apt install ffmpeg)');
  const sf = resolveSoundfont({ root: projectRoot });
  add('Instrument sound bank', sf.exists ? 'ok' : 'warn', sf.exists ? `${sf.source === 'default' ? DEFAULT_SOUNDFONT.name : 'custom bank'} (${sf.path})` : 'not installed — music can use only synth voices; real instruments (piano, strings, choir, ...) need a General MIDI SoundFont', sf.exists ? null : `Run audio_soundfont_install (downloads ${DEFAULT_SOUNDFONT.name}, ${Math.round(DEFAULT_SOUNDFONT.bytes / 1048576)} MB, once per computer) or set MINECRAFT_STUDIO_SOUNDFONT to your own .sf2/.sf3`);
  const sys = VOICE_PROVIDERS.system.available();
  add('System TTS (draft voices)', sys.ok ? 'ok' : 'warn', sys.ok ? `engine ${sys.engine}` : sys.reason);
  const elKey = getSecret('ELEVENLABS_API_KEY');
  const elConfigured = elKey && !elKey.startsWith('${');
  if (!elConfigured) add('ElevenLabs', 'warn', 'not configured — voice falls back to system TTS; SFX/music use local providers', 'Set ELEVENLABS_API_KEY in your environment or the project .env (never commit it), or fill the plugin option "elevenlabs_api_key"');
  else if (live) {
    try { const s = await VOICE_PROVIDERS.elevenlabs.check(); add('ElevenLabs', 'ok', `key valid, tier ${s.tier}, ${s.character_count}/${s.character_limit} characters used`); }
    catch (e) { add('ElevenLabs', 'error', `key present but check failed: ${e.message.slice(0, 160)}`, 'Verify the key and that it has user_read permission'); }
  } else add('ElevenLabs', 'ok', 'key present (not verified: offline mode)');

  // blockbench
  const bb = blockbenchInstall();
  let bridge = 'not probed';
  if (live) {
    const a = await probe('http://127.0.0.1:8787/ping');
    const b = await probe('http://localhost:3000/bb-mcp');
    bridge = a.reachable ? 'sosadly/blockbench-mcp bridge on :8787' : b.reachable ? 'jasonjgardner blockbench-mcp-plugin on :3000/bb-mcp' : 'no Blockbench MCP bridge running';
  }
  add('Blockbench', bb ? 'ok' : 'warn', `${bb ? `installed (${bb})` : 'not found'}; ${bridge}. Built-in studio-model exporters + renderer work without it.`, bb ? (bridge.startsWith('no') ? 'Optional: start Blockbench with an MCP plugin for live editing (docs/modeling.md)' : null) : 'Optional: install Blockbench from https://www.blockbench.net');

  // studio state
  if (projectRoot) {
    const studio = new Studio(projectRoot);
    if (studio.isInitialized()) {
      const integ = studio.checkIntegrity();
      const p = studio.project();
      add('Studio project', integ.ok ? 'ok' : 'warn', `${p.name}: ${p.platform || '?'} / MC ${p.minecraft_version || '?'}, ${integ.assets} assets${integ.ok ? '' : `, ${integ.issues.length} integrity issues`}`, integ.ok ? null : 'Run studio_registry_integrity and fix broken references');
      const eula = studio.config().minecraft.accept_eula;
      add('Test server', eula ? 'ok' : 'warn', eula ? 'EULA accepted by user; local Paper test server enabled' : 'disabled until the user accepts the Minecraft EULA', eula ? null : 'Ask the user; then set minecraft.accept_eula=true with studio_config_set');
    } else add('Studio project', 'warn', 'not initialised in this directory', 'Run /minecraft-studio:init');
  }
  const dash = live ? await probe(`http://127.0.0.1:${dashboardPort}/api/health`) : { reachable: false };
  add('Studio Dashboard', dash.reachable ? 'ok' : 'warn', dash.reachable ? `running at http://127.0.0.1:${dashboardPort}` : 'not running', dash.reachable ? null : 'Start with studio_dashboard_start (or /minecraft-studio:dashboard)');

  const worst = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  return { overall: worst, checks, platform: `${process.platform} ${os.release()}`, generated_at: new Date().toISOString() };
}

export function formatDoctor(report) {
  const icon = { ok: '✔', warn: '⚠', error: '✖' };
  const lines = [`Minecraft Studio doctor — ${report.overall.toUpperCase()} (${report.platform})`, ''];
  for (const c of report.checks) {
    lines.push(`${icon[c.status] || '•'} ${c.component.padEnd(26)} ${c.detail}`);
    if (c.fix) lines.push(`  ${''.padEnd(26)} → ${c.fix}`);
  }
  return lines.join('\n');
}
