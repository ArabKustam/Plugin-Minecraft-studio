# Installation

## Requirements

| Component | Required? | Why |
|---|---|---|
| Claude Code (CLI or desktop) | **yes** | Hosts the plugin. Claude Cowork can install the `.plugin` file too (see [compatibility](compatibility.md)). |
| Node.js ≥ 20 | **yes** | Runs the bundled MCP servers. Nothing to `npm install`. |
| Git | recommended | Checkpoints and history |
| FFmpeg with libvorbis | recommended | Converts sounds to Ogg Vorbis, the only audio format Minecraft accepts |
| Java 21 (MC ≤ 1.21.11) / Java 25 (MC 26.x) + Maven or Gradle | for plugin/mod work | Builds and the local test server |
| Windows SAPI voices / eSpeak NG / macOS `say` | optional | Free draft voice lines |
| ElevenLabs API key | optional | Production voices, AI sound effects and music |
| Blockbench + a Blockbench MCP plugin | optional | Live model editing (built-in exporters work without it) |

## 1. Install the plugin

From GitHub (marketplace):

```
/plugin marketplace add ArabKustam/Plugin-Minecraft-studio
/plugin install minecraft-studio@minecraft-studio
```

From a release file (once a version is published on the Releases page; until then build it with `node scripts/package-plugin.mjs`, which writes `dist/minecraft-studio.plugin`): download `minecraft-studio.plugin` and install it in Claude Cowork, or unzip it and point Claude Code at the folder:

```bash
claude --plugin-dir /path/to/minecraft-studio
```

Restart Claude Code (or run `/reload-plugins`) after installing.

## 2. Configure optional providers

- **ElevenLabs.** Put `ELEVENLABS_API_KEY=…` in your environment or in your Minecraft project's `.env`. `/minecraft-studio:init` git-ignores that file. The plugin option *ElevenLabs API key* (secure storage) is also read, but only on Claude Code versions that pass plugin options to MCP servers as `CLAUDE_PLUGIN_OPTION_ELEVENLABS_API_KEY`; run `/minecraft-studio:doctor` to check which source is active.
- **GitHub.** Use Claude's GitHub connector, the official GitHub MCP server, or the `gh` CLI. See [integrations](integrations.md).
- **Blockbench.** See [modeling](modeling.md#blockbench).

## 3. Open your Minecraft project and initialise

```
cd my-minecraft-project
claude
> /minecraft-studio:init
```

Init analyses the project, asks about the platform and version if they are unclear, indexes the existing assets, profiles your texture style and starts the dashboard.

## 4. Check everything

```
> /minecraft-studio:doctor
```

The doctor shows what works, what's missing and the exact fix for each problem. If an optional integration is missing, the studio still runs with less (see the [README](../README.md#graceful-degradation)).

## 5. Start creating

```
> Make an industrial control panel block in the style of my resource pack, with an animated screen and a button click sound.
```

## Uninstall

`/plugin uninstall minecraft-studio`. Your project's `.minecraft-studio/` directory stays in place, because it is project history. Delete it yourself if you don't want it.
