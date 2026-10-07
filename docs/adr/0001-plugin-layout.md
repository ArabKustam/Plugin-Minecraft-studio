# ADR 0001 — Native Claude plugin layout with bundled stdio MCP servers

- **Status:** accepted (2026-10-07)

## Context

The product has to be a real, installable Claude plugin. It should work in Claude Code and be packageable for Cowork. Users should not have to run `npm install`, and the plugin has to control external apps and services with least privilege.

## Decision

- **Layout.** Use the standard plugin layout:
  - `.claude-plugin/plugin.json`
  - `skills/<name>/SKILL.md`, with progressive-disclosure `references/`
  - `agents/*.md`
  - `hooks/hooks.json`
  - `.mcp.json`

  All paths go through `${CLAUDE_PLUGIN_ROOT}`. A single-plugin `marketplace.json` lets the repository itself be added as a marketplace.
- **MCP servers.** Ship five **small** stdio servers, split by concern (core state, texture, model, audio, Minecraft platform), instead of one large server.
- **Runtime.** Plain ESM JavaScript for Node ≥ 20, bundled with esbuild into `runtime/dist` (shared chunks, about 1.8 MB). The bundle is committed, so installing needs no `npm install`. The servers use the official `@modelcontextprotocol/sdk` (`McpServer.registerTool` with zod schemas).
- **Commands.** Workflows are skills (`/minecraft-studio:init`, `:doctor`, `:dashboard`), not legacy commands.
- **Secrets.** The ElevenLabs key is a sensitive `userConfig` value (`elevenlabs_api_key`), passed only to `studio-audio`.

## Consequences

- The host needs Node. The doctor checks for it.
- `runtime/dist` has to be rebuilt whenever `runtime/src` changes. CI enforces this.
- The manifest has no `displayName`, because the validator in Claude Code 2.1.104 rejects it.
