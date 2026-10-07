// Shared MCP plumbing for all Minecraft Studio servers.
//
// Security model: every tool declares one capability —
//   read    : inspects files/state, no side effects
//   write   : creates or modifies project files / studio state
//   execute : runs processes (builds, test servers, project tools, dashboard)
//   publish : sends data to external services (paid generation)
// MINECRAFT_STUDIO_CAPABILITIES (default "read,write,execute,publish") limits
// which tools a server registers, so a read-only reviewer setup cannot even
// see destructive tools. MCP annotations mirror the same information.
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Studio } from '../lib/core/studio.js';
import { resolveProjectRoot, StudioError } from '../lib/core/fsutil.js';
import { redact } from '../lib/core/secrets.js';

export { z };
export const VERSION = '0.1.0';

const enabled = new Set((process.env.MINECRAFT_STUDIO_CAPABILITIES || 'read,write,execute,publish').split(',').map((s) => s.trim()).filter(Boolean));

export function createServer(name, instructions) {
  return new McpServer({ name, version: VERSION }, { instructions });
}

const projectDir = z.string().optional().describe('Absolute path of the Minecraft project. Defaults to the Claude Code project directory.');
const MAX_IMAGE_BYTES = 1_500_000;

/**
 * Register a tool. handler(args, ctx) returns a JSON-serialisable result.
 * A result may include `_images: [absPath]` — PNGs returned as MCP image
 * content so Claude can visually review previews in the same call.
 */
export function tool(server, name, { title, description, capability, input = {}, needsInit = false }, handler) {
  if (!['read', 'write', 'execute', 'publish'].includes(capability)) throw new Error(`tool ${name}: invalid capability`);
  if (!enabled.has(capability)) return;
  server.registerTool(name, {
    title,
    description: `${description} [capability: ${capability}]`,
    inputSchema: { ...input, project_dir: projectDir },
    annotations: {
      title,
      readOnlyHint: capability === 'read',
      destructiveHint: capability === 'write' || capability === 'execute' ? false : undefined,
      idempotentHint: capability === 'read',
      openWorldHint: capability === 'publish',
    },
  }, async (args) => {
    try {
      const root = resolveProjectRoot(args.project_dir);
      const studio = new Studio(root);
      if (needsInit) studio.requireInit();
      const result = await handler(args, { studio, root });
      const images = Array.isArray(result?._images) ? result._images : [];
      if (result && typeof result === 'object') delete result._images;
      const content = [{ type: 'text', text: redact(JSON.stringify(result ?? { ok: true }, null, 2)) }];
      for (const img of images) {
        try {
          const buf = fs.readFileSync(img);
          if (buf.length <= MAX_IMAGE_BYTES) content.push({ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' });
        } catch { /* preview missing: text result still returned */ }
      }
      return { content };
    } catch (err) {
      const code = err instanceof StudioError ? err.code : 'E_INTERNAL';
      const msg = redact(err?.message || String(err));
      if (code === 'E_INTERNAL') process.stderr.write(`[${name}] ${redact(err?.stack || msg)}\n`);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code, message: msg }, null, 2) }] };
    }
  });
}

export async function start(server) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** Common optional asset-registration block accepted by generation tools. */
export const assetInput = z.object({
  id: z.string().describe('Asset registry id (lowercase, e.g. "reactor_core_texture")'),
  name: z.string().optional(),
  description: z.string().optional(),
  minecraft_ids: z.array(z.string()).optional().describe('Resource locations / game ids this asset provides'),
  tags: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional().describe('Asset ids this asset depends on'),
  agent: z.string().optional().describe('Agent producing the asset (for the activity log)'),
  note: z.string().optional().describe('Revision note when updating an existing asset'),
}).optional().describe('If given, the output is registered/updated in the Asset Registry (status draft, QA pending).');

/** Create or version an asset after a generation step. */
export function registerOutput(studio, asset, { type, files, source, preview = null, metadata = {} }) {
  if (!asset) return null;
  const by = asset.agent || 'studio';
  if (studio.hasAsset(asset.id)) {
    const patch = { files, source, metadata: { ...studio.getAsset(asset.id).metadata, ...metadata } };
    if (preview) patch.preview = preview;
    for (const k of ['name', 'description', 'minecraft_ids', 'tags', 'dependencies']) if (asset[k] !== undefined) patch[k] = asset[k];
    const a = studio.updateAsset(asset.id, patch, { by, note: asset.note || '' });
    return { id: a.id, version: a.version, status: a.status };
  }
  const a = studio.createAsset({ id: asset.id, type, name: asset.name || asset.id, description: asset.description || '', files, source, created_by: by, minecraft_ids: asset.minecraft_ids || [], tags: asset.tags || [], dependencies: asset.dependencies || [], preview, metadata });
  return { id: a.id, version: a.version, status: a.status };
}

export function requireOneOf(args, keys) {
  if (!keys.some((k) => args[k] !== undefined)) throw new StudioError('E_INPUT', `Provide one of: ${keys.join(', ')}`);
}
