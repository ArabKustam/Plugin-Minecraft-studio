// Local Git integration: status, secret-scanned checkpoints, history.
// Remote operations (repositories, PRs, releases) go through the official
// GitHub MCP server or the gh CLI — see docs/integrations.md.
import { spawnSync } from 'node:child_process';
import { StudioError } from './fsutil.js';
import { scanFiles } from './secrets.js';

function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.error?.code === 'ENOENT') throw new StudioError('E_GIT', 'git is not installed');
  if (r.status !== 0 && !allowFail) throw new StudioError('E_GIT', `git ${args[0]} failed: ${(r.stderr || '').trim().slice(0, 500)}`);
  return { ok: r.status === 0, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trim() };
}

export function isRepo(root) {
  try { return git(root, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).out === 'true'; } catch { return false; }
}

export function gitStatus(root) {
  if (!isRepo(root)) return { repo: false };
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }).out || null;
  const top = git(root, ['rev-parse', '--show-toplevel']).out;
  const porcelain = git(root, ['status', '--porcelain=v1', '--', '.'], { allowFail: true }).out;
  const changes = porcelain ? porcelain.split('\n').map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) })) : [];
  const last = git(root, ['log', '-1', '--format=%H%x1f%s%x1f%an%x1f%aI'], { allowFail: true }).out;
  const [hash, subject, author, date] = last ? last.split('\x1f') : [];
  const remote = git(root, ['remote', 'get-url', 'origin'], { allowFail: true }).out || null;
  const ab = remote ? git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { allowFail: true }).out : '';
  const [behind, ahead] = ab ? ab.split(/\s+/).map(Number) : [null, null];
  return { repo: true, toplevel: top, branch, clean: changes.length === 0, changes: changes.slice(0, 200), change_count: changes.length, last_commit: hash ? { hash, subject, author, date } : null, remote: remote ? remote.replace(/\/\/[^@/]+@/, '//') : null, ahead, behind };
}

export function gitLog(root, limit = 30) {
  if (!isRepo(root)) return [];
  const out = git(root, ['log', `-${limit}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI', '--', '.'], { allowFail: true }).out;
  return out ? out.split('\n').map((l) => { const [hash, short, subject, author, date] = l.split('\x1f'); return { hash, short, subject, author, date }; }) : [];
}

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|assets?)(\([a-z0-9._/-]+\))?!?: .{3,}/;

/**
 * Commit a logical checkpoint. Only the given paths are staged (never `git add -A`
 * of the whole repository), staged files are scanned for secrets first, and the
 * message must follow Conventional Commits.
 */
export function checkpoint(root, { message, paths, allowEmpty = false, trailer = null }) {
  if (!isRepo(root)) throw new StudioError('E_GIT', 'Not a git repository. Initialise one first (git init) — ask the user if this is their project root.');
  if (!CONVENTIONAL.test(message.split('\n')[0])) throw new StudioError('E_GIT', `Commit message must follow Conventional Commits, e.g. "feat(textures): add reactor active states". Got: ${message.split('\n')[0]}`);
  if (!Array.isArray(paths) || !paths.length) throw new StudioError('E_GIT', 'paths to commit are required (the studio never stages the whole repository blindly)');
  for (const p of paths) if (p.includes('..') || /^[/\\]|^[a-z]:/i.test(p)) throw new StudioError('E_PATH', `Invalid path ${p}`);
  git(root, ['add', '--', ...paths]);
  const staged = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { allowFail: true }).out.split('\0').filter(Boolean);
  const top = git(root, ['rev-parse', '--show-toplevel']).out;
  const findings = scanFiles(top, staged);
  if (findings.length) {
    git(root, ['reset', '-q', '--', ...paths], { allowFail: true });
    throw new StudioError('E_SECRET', `Refusing to commit: possible secrets found → ${findings.slice(0, 10).map((f) => `${f.file}:${f.line} (${f.kind})`).join(', ')}. Values were not printed. Remove them, use environment variables, and retry.`);
  }
  if (!staged.length && !allowEmpty) return { committed: false, reason: 'nothing to commit for the given paths' };
  const full = trailer ? `${message}\n\n${trailer}` : message;
  git(root, ['commit', '-q', ...(allowEmpty ? ['--allow-empty'] : []), '-m', full]);
  const hash = git(root, ['rev-parse', 'HEAD']).out;
  return { committed: true, hash, files: staged.length, message: message.split('\n')[0] };
}

/** Scan the whole tracked tree (plus untracked, not ignored) for secrets before publishing. */
export function scanRepository(root) {
  if (!isRepo(root)) throw new StudioError('E_GIT', 'Not a git repository');
  const tracked = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { allowFail: true }).out.split('\0').filter(Boolean);
  const findings = scanFiles(root, tracked);
  return { scanned: tracked.length, clean: findings.length === 0, findings };
}
