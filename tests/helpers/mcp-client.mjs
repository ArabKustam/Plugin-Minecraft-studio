// Minimal MCP stdio client (newline-delimited JSON-RPC 2.0) used by the
// integration tests to talk to the bundled servers exactly like Claude Code.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class McpClient {
  constructor(server, { env = {}, cwd = process.cwd() } = {}) {
    this.proc = spawn(process.execPath, [path.join(PLUGIN_ROOT, 'runtime', 'dist', `${server}.mjs`)], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    let buf = '';
    this.proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        }
      }
    });
    this.proc.stderr.on('data', (d) => { this.stderr += d.toString(); });
  }

  request(method, params = {}, timeoutMs = 120000) {
    const id = this.nextId++;
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${method}\n${this.stderr}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async init() {
    const r = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'minecraft-studio-tests', version: '1.0.0' } });
    this.notify('notifications/initialized');
    return r;
  }

  async tools() { return (await this.request('tools/list')).tools; }

  /** Call a tool; returns {data, images, isError}. */
  async call(name, args = {}) {
    const r = await this.request('tools/call', { name, arguments: args });
    const text = r.content.find((c) => c.type === 'text')?.text;
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { data, images: r.content.filter((c) => c.type === 'image'), isError: !!r.isError };
  }

  close() { this.proc.kill(); }
}
