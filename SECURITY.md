# Security policy

Minecraft Studio runs code on your machine. Its MCP servers read and write project files, run builds and local test servers, and can call paid APIs. This document covers what the plugin does to keep that safe and how to report problems.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub's *Security → Report a vulnerability* on the repository. Include reproduction steps, impact and the affected version. We aim to acknowledge reports within 7 days.

## Security model

| Area | Measure |
|---|---|
| **Least privilege** | Each MCP tool declares a capability: `read`, `write`, `execute` or `publish`. `MINECRAFT_STUDIO_CAPABILITIES` controls which tools a server registers at all. By default `studio-texture` and `studio-model` get read/write only. Only `studio-core` and `studio-minecraft` can execute, and only `studio-audio` can publish (paid APIs). Agents list only the tools they need. |
| **No arbitrary commands** | The build runner only executes the Gradle wrapper, Gradle or Maven from platform adapters. Java runs only for the Paper test server. FFmpeg and TTS are called with argument arrays, never shell strings. Project tools (`studio_tool_run`) are Node scripts inside the project's `.minecraft-studio/tools/`. |
| **Path safety** | Every path argument is resolved with `safeJoin` and refused if it escapes the project root (`..`, absolute paths, NUL bytes). The dashboard serves only whitelisted file types and never `.env*`. |
| **Secrets** | Secrets come only from environment variables, an untracked project `.env` or the plugin's sensitive `userConfig` (secure storage). They are never written to registry or config files, logs, dashboard payloads or tool output, and everything passes through `redact()`. `studio_config_set` rejects secret-looking values. |
| **Secret scanning** | A `PreToolUse` hook blocks writes containing API keys or tokens. `studio_git_checkpoint` scans staged files and refuses to commit if it finds any. A `PreToolUse` hook on `git push` and `gh release/repo create` scans outgoing files. `studio_git_secret_scan` scans the whole repository before publishing. |
| **Dashboard** | Binds to `127.0.0.1` only. It is read-only: GET requests only. It rejects foreign `Host` headers (DNS-rebinding guard) and sends `nosniff`/`no-referrer` headers. It never shows secret values, only configured/missing. |
| **Downloads** | Paper server jars come from `fill.papermc.io` and are verified against the published SHA-256 before running. No other code is downloaded or executed. |
| **Minecraft EULA** | The test server stays disabled until the user explicitly accepts the EULA (`minecraft.accept_eula`). Claude must ask first and never accepts it on its own. |
| **Paid providers** | Paid generation requires `confirm_cost=true`, which Claude passes only after the user agrees. It is also capped per asset (`costs.max_generations_per_asset`), and usage is logged. |
| **Telemetry** | None. No project data is sent anywhere except to the providers you configure and call. |
| **Supply chain** | Runtime dependencies are pinned exactly (`@modelcontextprotocol/sdk`, `zod`, `pngjs`) and bundled with esbuild, so installing the plugin never runs `npm install`. `scripts/third-party.mjs` fails CI on non-permissive licenses. Dependabot keeps dependencies current. |

## Things to keep in mind

- Agents can edit your project. Use Git (the studio checkpoints often) and review diffs.
- Generated plugin code runs on your Minecraft server. Review it like any third-party code, especially before production.
- Treat third-party Blockbench MCP plugins like any software you install. Their script-execution tools are powerful, and Minecraft Studio does not use them unless you ask.
