---
name: doctor
description: "Diagnose the Minecraft Studio installation and integrations — plugin, MCP servers, Node, Git, GitHub, Java, Minecraft toolchain, FFmpeg, TTS, ElevenLabs credentials, Blockbench, studio state and dashboard — with clear fixes. Use when the user runs /minecraft-studio:doctor or something in the studio pipeline fails unexpectedly."
---

# Minecraft Studio doctor

1. Call `studio_doctor` (use `offline: true` only if the user is offline).
2. Show the `text` field verbatim in a code block.
3. Below it, list only the actionable items (errors first, then warnings that block what the user is trying to do), each with the exact fix. Mention what keeps working without each missing optional integration (graceful degradation):
   - no ElevenLabs → system TTS drafts, local SFX/music
   - no Blockbench MCP → built-in model exporters + renderer
   - no GitHub → local Git checkpoints
   - no FFmpeg → synthesis/analysis work, but no Ogg export for Minecraft
   - EULA not accepted → no local test server (builds and static checks still run)
4. If the studio MCP tools are missing entirely, the bundled servers failed to start: check `node --version` (≥ 20) and reinstall the plugin; the CLI fallback is `node "${CLAUDE_PLUGIN_ROOT}/runtime/dist/cli.mjs" doctor`.

Never print secret values — only configured/missing.
