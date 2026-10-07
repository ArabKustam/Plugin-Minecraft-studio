# Plugin development

## Working on the plugin

```bash
cd runtime && npm ci && npm run build && cd ..
claude --plugin-dir .            # load this checkout for one session
node --test "tests/**/*.test.mjs"
node scripts/validate-plugin.mjs
```

Edit `runtime/src`, then rebuild. The MCP servers start fresh in every Claude session. In a running session, use `/reload-plugins` or restart.

## Adding an MCP tool

1. Implement the logic in `runtime/src/lib/...`. Keep MCP wrappers thin.
2. Register the tool in the right server (`runtime/src/mcp/studio-*.js`) with `tool(server, name, { title, description, capability, input, needsInit }, handler)`.
   - Choose the **capability** carefully: `read`, `write`, `execute` or `publish`.
   - Return JSON. Add `_images: [absPng]` to return previews as images.
   - Accept an `asset` block if the tool produces assets, and call `registerOutput`.
3. Add tests (unit, plus an integration test through `McpClient` if it touches the protocol).
4. Document the tool in the relevant skill reference. The validator rejects mentions of tools that don't exist and agent tool lists that reference missing tools.
5. Grant the tool to the agents that need it, and only those.
6. Run `npm run build` and commit `runtime/dist`.

## Hooks

`hooks/hooks.json` calls `runtime/dist/cli.mjs hook <kind>`:

| Hook | Behaviour |
|---|---|
| `session-start` | Adds context: project, asset and task counts, recent memory, or suggests init for uninitialised Minecraft projects |
| `pre-write` | Denies `Write`/`Edit` content that contains secret patterns |
| `pre-bash` | Secret-scans outgoing files before `git push` / `gh release create` / `gh repo create` |

Hooks **fail open**: an internal error never blocks your session; a warning goes to stderr.

## Packaging

`node scripts/package-plugin.mjs` writes these to `dist/`:

- `minecraft-studio.plugin` and `minecraft-studio-<version>.plugin`: a zip of the runtime-relevant files (no tests, examples or sources outside `runtime/dist`)
- `SHA256SUMS.txt`

Install the `.plugin` file in Cowork, or unzip it and use `--plugin-dir`.
