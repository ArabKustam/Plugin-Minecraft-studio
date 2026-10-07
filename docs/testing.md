# Testing

## Repository tests

```bash
node --test "tests/**/*.test.mjs"
```

| Suite | Covers |
|---|---|
| `tests/unit/core.test.mjs` | Path-traversal guard, the asset lifecycle and QA gate, versioning and revert, the integrity check, task-graph layers and cycles, memory, secret scanning and redaction, timelines, Agent Factory validation |
| `tests/unit/media.test.mjs` | Pixel specs, animated strips, tiling, validation, style profile ranking, variant ops, model validation and export (Java, Bedrock, `.bbmodel`), rendering, animation checks and sampling, WAV round-trip, SFX loudness and loop, music timing and seamless loops, Russian numbers and stress, resource-pack broken references, deterministic zips, platform detection (Paper 26.x + resource pack) |
| `tests/unit/schemas.test.mjs` | Demo sources and the generated registry conform to `schemas/` |
| `tests/integration/mcp.test.mjs` | All five bundled servers over stdio: capability gating, the init → texture → QA → registry → activity slice, path rejection, the paid-provider cost gate, the audio render and audit, timeline export |
| `tests/unit/creatures.test.mjs` | UV packing & painting, stable UUIDs, Bedrock validator (broken refs), Creature Pack add-on validates |
| `tests/integration/style-match.test.mjs` | §71: a new block matches the pack style; an off-style control fails |

## Plugin validation

```bash
node scripts/validate-plugin.mjs
```

Runs the official `claude plugin validate`, then checks:
- skill and agent frontmatter
- that hook and MCP targets exist
- that **every MCP tool referenced by an agent or a skill exists in the running servers**

## End-to-end demo

```bash
node examples/industrial-reactor/studio/produce.mjs --fresh
```

Replays the whole production through the MCP servers, then runs:
- QA gates
- pack validation and packaging
- registry integrity
- Maven build and the 81 Java unit tests
- an ID cross-check between code and the pack

## Runtime smoke test

`mc_test_server` starts a disposable Paper server, runs `reactor selftest`, and checks the logs. It needs the user's explicit EULA acceptance, so it is not part of CI.

## CI

`.github/workflows/ci.yml` runs on Ubuntu and Windows:
- `runtime/dist` freshness, lint, broken links, licenses
- plugin validation and the official validator
- the test suite
- an ElevenLabs live check, only when the secret is present
- `.plugin` packaging
- the Maven demo build, pack validation, secret scanning and gitleaks
