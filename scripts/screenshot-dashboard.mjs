// Capture README/docs screenshots of the Studio Dashboard via the Chrome DevTools Protocol.
//   node scripts/screenshot-dashboard.mjs --url http://127.0.0.1:4791 [--chrome PATH] [--out docs/images]
// Waits in real time per view (audio decoding, canvas renders), unlike --virtual-time-budget.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('--url', 'http://127.0.0.1:4777');
const out = path.resolve(ROOT, arg('--out', 'docs/images'));
const chrome = arg('--chrome', process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const VIEWS = [
  ['dashboard-overview', 'overview', 3000],
  ['dashboard-tasks', 'tasks', 3000],
  ['dashboard-textures', 'asset/reactor.core_side_active.texture', 3000],
  ['dashboard-3d', 'asset/reactor.control_panel.model', 4000],
  ['dashboard-animations', 'asset/reactor.animations', 4000],
  ['dashboard-music', 'asset/reactor.music.alarm', 9000],
  ['dashboard-voice', 'voice', 4000],
];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-shot-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
}
if (!target) { proc.kill(); throw new Error('Chrome did not start'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(out, { recursive: true });
for (const [name, route, wait] of VIEWS) {
  await send('Page.navigate', { url: `${base}/?live=0#/${route}` });
  await sleep(wait);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log(`${name}.png`);
}
ws.close();
proc.kill();
