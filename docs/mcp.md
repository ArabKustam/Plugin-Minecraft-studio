# MCP servers

Five stdio servers are declared in `.mcp.json`. They are bundled ES modules started with `node`. Tools appear in Claude Code as `mcp__plugin_minecraft-studio_<server>__<tool>`.

| Server | Default capabilities | Tools |
|---|---|---|
| `studio-core` | read, write, execute | 38: project analyse/init/profile/update, config, asset create/update/get/list/set_status/revert, QA record, registry integrity, task plan/update/list/graph, memory add/recall, log/activity, timeline save/validate/list, git status/checkpoint/secret scan, agent define, tool scaffold/list/run/test, providers, usage, test record, doctor, dashboard start |
| `studio-texture` | read, write | 13: render spec, from PNG, analyze, style profile, style compare, validate, tiling, palette pass, variants, concept reduce, preview, UV paint (creature/entity/equipment atlases), item shader |
| `studio-model` | read, write | 7: validate, render, export, import Java, animation validate/render/save |
| `studio-audio` | read, write, publish | 16: SFX presets/render/AI generate, analyze, audit, process, music render (real GM instruments + synth)/AI generate, instrument list, sound bank install, voice profile save/get, pronunciation add/preview, voice line, Minecraft export |
| `studio-minecraft` | read, write, execute | 14: adapters, detect, build, test, test server, parse log, Java check, pack validate/package, sound event, item definition, pack formats, Bedrock add-on validate/package |

## Capabilities and security

Every tool declares exactly one capability. It appears in the tool description (`[capability: write]`) and in the MCP annotations (`readOnlyHint`, `openWorldHint`):

| Capability | Meaning | Examples |
|---|---|---|
| `read` | no side effects | analyse, validate, render previews (previews go to `.minecraft-studio/previews`) |
| `write` | changes project files or studio state | render textures, export models, register assets, commit |
| `execute` | runs processes | builds, test server, project tools, dashboard |
| `publish` | sends data to external paid services | ElevenLabs SFX and music |

`MINECRAFT_STUDIO_CAPABILITIES` (in each server's `env` in `.mcp.json`) controls which tools are **registered**. A tool outside the list doesn't exist for that server, so an agent can't call it. For example, a review-only setup:

```json
"env": { "MINECRAFT_STUDIO_CAPABILITIES": "read" }
```

Agents also restrict tools in their frontmatter (`tools:`), so a QA agent only gets read tools plus `studio_qa_record`.

## Conventions

- Every tool accepts optional `project_dir`. It defaults to `$CLAUDE_PROJECT_DIR`.
- Results are JSON text. Preview PNGs (≤ 1.5 MB) are returned as MCP **image content**, so Claude sees them in the same call.
- Errors come back as `isError` with `{error: CODE, message}`, e.g. `E_PATH`, `E_QA`, `E_COST`, `E_EULA`, `E_NOT_INIT`.
- Generation tools accept an `asset` block (`id`, `name`, `minecraft_ids`, `tags`, `dependencies`, `agent`, `note`). With it, they register a new asset or add a new version.
- Servers write only MCP messages to stdout. Diagnostics go to stderr.

## External MCP servers (optional)

| Integration | Recommended server | Notes |
|---|---|---|
| GitHub | [github/github-mcp-server](https://github.com/github/github-mcp-server) | Remote `https://api.githubcopilot.com/mcp/` with a PAT, or Claude's GitHub connector. Use `X-MCP-Readonly: true` for read-only. |
| Blockbench | [sosadly/blockbench-mcp](https://github.com/sosadly/blockbench-mcp) (MIT) or [jasonjgardner/blockbench-mcp-plugin](https://github.com/jasonjgardner/blockbench-mcp-plugin) (GPL-3.0) | User-installed and run as a separate process. See [modeling.md](modeling.md#blockbench). |

These are not auto-enabled by the plugin, because they need user credentials or a running app. [integrations.md](integrations.md) has copy-paste configs.
