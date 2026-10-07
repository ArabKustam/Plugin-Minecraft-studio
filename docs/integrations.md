# Integrations

All integrations are optional. `/minecraft-studio:doctor` shows the status of each.

## ElevenLabs (voice, SFX, music)

1. Create an API key in ElevenLabs. A restricted key with *Text to Speech*, *Sound Effects*, *Music* and *User → read* is enough.
2. Set it in one of these places:
   - the plugin option **elevenlabs_api_key** (stored in Claude's secure storage and passed only to `studio-audio`)
   - `ELEVENLABS_API_KEY` in your shell
   - the Minecraft project's `.env` (git-ignored by init)
3. Put a voice id into your voice profile (`providers.elevenlabs.voice_id`).

What the studio uses:

| Endpoint | Purpose |
|---|---|
| `POST /v1/text-to-speech/{voice_id}` | voice lines (`eleven_multilingual_v2` by default; Russian supported) |
| `POST /v1/sound-generation` | AI sound effects |
| `POST /v1/music` | AI music |
| `GET /v1/user/subscription` | key check in the doctor |

Every paid call needs `confirm_cost=true`, which Claude passes only after you agree. Usage is logged to `.minecraft-studio/logs/usage.jsonl`.

## GitHub

Pick one:

- **Claude's GitHub connector**, if your Claude account has it.
- **Official GitHub MCP server, remote.** Add it to your user or project MCP config:

  ```json
  {
    "mcpServers": {
      "github": {
        "type": "http",
        "url": "https://api.githubcopilot.com/mcp/",
        "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }
      }
    }
  }
  ```

  Add `"X-MCP-Readonly": "true"` to the headers for read-only access, or `"X-MCP-Toolsets": "repos,issues,pull_requests,actions"` to limit the toolsets.
- **`gh` CLI**, authenticated with `gh auth login`.

Local Git works without any of these. Before publishing, the studio always runs a secret scan, and the plugin's pre-push hook blocks pushes that contain secrets.

## Blockbench

See [modeling.md](modeling.md#blockbench).

## FFmpeg

- Windows: `winget install Gyan.FFmpeg`
- macOS: `brew install ffmpeg`
- Linux: `apt install ffmpeg`

To use a specific binary, set `MINECRAFT_STUDIO_FFMPEG=/path/to/ffmpeg`.

## Local TTS

- **Windows:** SAPI voices. Install extra languages under *Settings → Time & Language → Speech*.
- **macOS:** the built-in `say` command (output converted with FFmpeg).
- **Linux/Windows:** eSpeak NG (`apt install espeak-ng`).

Use local voices for drafts only. Production lines should use ElevenLabs.
