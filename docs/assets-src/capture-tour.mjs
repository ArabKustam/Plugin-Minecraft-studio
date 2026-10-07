// Record the README hero GIF: a tour through the real Studio Dashboard running on the
// Industrial Reactor demo. Needs Chrome/Chromium and FFmpeg.
//   node docs/assets-src/capture-tour.mjs [--chrome PATH]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const chrome = arg('--chrome', process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const OUT = path.join(ROOT, 'docs/images/readme/dashboard-tour.gif');
const W = 1280, H = 760, FPS = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 4795;
const dash = spawn(process.execPath, [path.join(ROOT, 'runtime/dist/dashboard.mjs'), '--project', path.join(ROOT, 'examples/industrial-reactor'), '--port', String(port)], { stdio: 'ignore' });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-tour-'));
const cdpPort = 9800 + Math.floor(Math.random() * 100);
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-tour-frames-'));
let n = 0;
async function grab(count = 1, every = 1000 / FPS) {
  for (let i = 0; i < count; i++) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(r.result.data, 'base64'));
    if (i < count - 1) await sleep(every);
  }
}
async function hold(seconds) { // duplicate the current frame (static views)
  const r = await send('Page.captureScreenshot', { format: 'png' });
  for (let i = 0; i < seconds * FPS; i++) fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(r.result.data, 'base64'));
}
const go = async (route, wait = 2500) => { await send('Page.navigate', { url: `http://127.0.0.1:${port}/?live=0#/${route}` }); await sleep(wait); };
const js = (expression) => send('Runtime.evaluate', { expression });

await go('overview', 3500); await hold(2.2);
await go('tasks'); await hold(2);
await go('asset/reactor.core_side_active.texture'); await hold(2);
await go('asset/reactor.rig.model', 3500);
await js("[...document.querySelectorAll('label, button')].find(e => /Auto-rotate/.test(e.textContent))?.click()");
await sleep(300); await grab(Math.round(3 * FPS));
await go('asset/reactor.animations', 3000); await grab(Math.round(3 * FPS));
await go('asset/reactor.music.alarm', 9000); await hold(2.5);

ws.close(); browser.kill(); dash.kill();
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
  '-vf', 'scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=80:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', OUT], { encoding: 'utf8' });
fs.rmSync(dir, { recursive: true, force: true });
if (r.status !== 0) throw new Error(r.stderr);
console.log(`${path.relative(ROOT, OUT)} ${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB, ${n} frames`);
