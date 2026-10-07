// Secret handling: environment loading, redaction and repository scanning.
// Secrets are only ever read from the process environment or an untracked
// `.env` file in the project root. They are never written to registry files,
// logs, dashboard payloads or tool output.
import fs from 'node:fs';
import path from 'node:path';

export const SECRET_ENV_KEYS = ['ELEVENLABS_API_KEY', 'GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'OPENAI_API_KEY', 'MINECRAFT_STUDIO_IMAGE_API_KEY'];

let loadedFor = null;

/** Load KEY=VALUE pairs from <project>/.env without overriding real env vars. */
export function loadDotEnv(projectRoot) {
  if (loadedFor === projectRoot) return;
  loadedFor = projectRoot;
  const file = path.join(projectRoot, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function getSecret(name) {
  // Plugin options (userConfig) arrive as CLAUDE_PLUGIN_OPTION_<KEY> in Claude Code versions that
  // export them to MCP servers. They are not referenced as ${user_config.*} in .mcp.json: an empty
  // optional value there makes Claude Code skip the whole server.
  const v = process.env[name] || process.env[`CLAUDE_PLUGIN_OPTION_${name}`];
  return v && v.trim() ? v.trim() : null;
}

/** Report which secrets are configured, never their values. */
export function secretStatus() {
  return Object.fromEntries(SECRET_ENV_KEYS.map((k) => [k, getSecret(k) ? 'configured' : 'missing']));
}

/** Replace any configured secret value (and common token shapes) in text. */
export function redact(text) {
  if (text == null) return text;
  let s = String(text);
  for (const k of SECRET_ENV_KEYS) {
    const v = getSecret(k);
    if (v && v.length >= 6) s = s.split(v).join(`[REDACTED:${k}]`);
  }
  for (const { re } of SECRET_PATTERNS) s = s.replace(re, '[REDACTED]');
  return s;
}

export const SECRET_PATTERNS = [
  { name: 'ElevenLabs key', re: /\bsk_[a-f0-9]{40,64}\b/g },
  { name: 'GitHub token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'OpenAI key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'Generic assignment', re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/gi },
];

const TEXT_EXT = /\.(js|mjs|cjs|ts|json|md|txt|yml|yaml|toml|properties|java|kt|kts|gradle|py|sh|ps1|env|cfg|ini|xml|html|css)$/i;

/** Scan text content; returns findings with line numbers but never the matched value. */
export function scanText(text, file = '<input>') {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        if (/\.example$|example|placeholder|your[_-]?key|xxxx/i.test(line) && name === 'Generic assignment') continue;
        findings.push({ file, line: i + 1, kind: name });
      }
    }
  });
  return findings;
}

/** Scan a list of files (relative to root). Binary/large files are skipped. */
export function scanFiles(root, files) {
  const findings = [];
  for (const rel of files) {
    const base = path.basename(rel);
    if (base === '.env' || /^\.env\.(local|production|development)$/.test(base)) {
      findings.push({ file: rel, line: 0, kind: 'Environment file must not be committed' });
      continue;
    }
    if (!TEXT_EXT.test(rel) && base !== '.env.example') continue;
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > 2_000_000) continue;
    findings.push(...scanText(fs.readFileSync(abs, 'utf8'), rel));
  }
  return findings;
}
