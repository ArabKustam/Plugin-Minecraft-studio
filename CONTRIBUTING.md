# Contributing to Minecraft Studio

Thanks for helping. Studio quality, real-world usefulness and honest docs matter more here than feature count.

## Setup

```bash
git clone https://github.com/ArabKustam/minecraft-studio
cd minecraft-studio/runtime
npm ci
npm run build          # bundles runtime/src → runtime/dist (committed, so installs need no npm)
cd ..
node --test "tests/**/*.test.mjs"
node scripts/validate-plugin.mjs
```

Optional for the full demo: Java 21, Maven, FFmpeg with libvorbis, and a system TTS (Windows SAPI or eSpeak NG). Run it with `node examples/industrial-reactor/studio/produce.mjs --fresh`.

To try your working copy in Claude Code without installing:

```bash
claude --plugin-dir /path/to/minecraft-studio
```

## Layout

| Path | What lives there |
|---|---|
| `.claude-plugin/` | Plugin manifest and single-plugin marketplace |
| `skills/` | Skills. `minecraft-studio/` is the core skill with progressive-disclosure `references/` |
| `agents/` | Specialist subagents |
| `hooks/` | Session context and secret guards |
| `.mcp.json` | The five MCP servers |
| `runtime/src/lib` | Core library: registry, adapters, texture/model/audio pipelines, providers |
| `runtime/src/mcp` | MCP servers (thin wrappers over `lib`) |
| `runtime/src/dashboard`, `studio/web-dashboard` | Dashboard backend and UI |
| `schemas/` | JSON Schemas for studio file formats |
| `examples/` | Industrial Reactor demo and the style-match test |
| `docs/` | User and developer documentation, ADRs, research notes |

## Rules

- **Adapters, not lock-in.** External services and tools go behind a provider or adapter interface (`docs/providers.md`, `docs/minecraft-platforms.md`).
- **New tools** need a concrete purpose, structured output, validated input, a capability tag, tests, and an update to the relevant skill reference.
- **MCP servers must never write to stdout** except through the protocol. `scripts/lint.mjs` enforces this.
- **Dependencies.** Avoid adding them. If one is unavoidable, pin it exactly, keep it permissive, and regenerate `THIRD_PARTY_NOTICES.md` with `node scripts/third-party.mjs`.
- **Third-party code.** Check the license first. Never copy GPL code into this MIT project. Document reference implementations in `docs/research/`.
- **Commits.** Use Conventional Commits (`feat(audio): …`, `fix(dashboard): …`). Keep PRs small, with tests.
- **Rebuild.** Run `npm run build` after changing `runtime/src`. CI checks that `runtime/dist` is up to date.
- **Compatibility.** Don't claim compatibility you haven't tested. Update `docs/compatibility.md` with evidence.

## Releasing

See [docs/releasing.md](docs/releasing.md).
