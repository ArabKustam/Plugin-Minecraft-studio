# Providers

Business logic asks for a **capability**: voice, SFX, music, image or modelling. It never asks for a vendor. The provider registry (`runtime/src/lib/providers/index.js`) resolves the configured provider. Every provider reports:

| Field | Meaning |
|---|---|
| `capabilities` | what it can do (`tts`, `loops`, `stems`, `text-to-sfx`, …) |
| `available()` | `{ ok, reason }`, e.g. a missing key or engine |
| `formats` | the output formats |
| `paid` | whether calls cost money |
| `estimateCost(request)` | units, unit name and USD when known |

| Kind | Providers | Default (`auto`) |
|---|---|---|
| voice | `elevenlabs` (paid), `system` (SAPI / say / eSpeak NG), `mock` | elevenlabs → system → mock |
| sfx | `local-synth`, `elevenlabs` (paid) | local-synth |
| music | `local-composer`, `elevenlabs` (paid) | local-composer |
| image | `none` (pixel specs authored by the Texture Artist) | none |
| modeling | `studio-model` (built-in exporters + renderer), `blockbench` (live, via an external MCP) | studio-model |

To select providers, set them in `.minecraft-studio/config.json` (`studio_config_set {providers: {voice: "system"}}`) or pass `provider` to the tool.

## Why no image generator by default?

Readable 16×16 pixel art comes from deliberate pixel placement; downscaling a generated image doesn't produce it ([ADR 0003](adr/0003-provider-abstraction.md)). So the default texture path is *pixel spec authored by Claude → render → style compare → review*. To use an image model for high-resolution **concepts**, add an `image` provider. Run its output through `texture_concept_reduce`, then clean up the result by hand.

## Adding a provider

1. Implement the contract in `lib/providers/index.js`, or in a new module registered there.
2. Keep the API surface minimal: only the endpoints the studio needs.
3. Read credentials only with `getSecret()`. Never log them, and never return them from a tool.
4. If the provider is paid, gate it with `confirm_cost` and record usage with `studio.recordUsage`.
5. Add a mock-mode test, document the provider here and in [integrations.md](integrations.md), and update the compatibility matrix.
