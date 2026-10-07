# ADR 0003 — Capability-based providers; pixel specs instead of image generation for textures

- **Status:** accepted (2026-10-07)

## Context

Generation services change fast and cost money, so tying the studio to one SDK would make it fragile. Also, diffusion images downscaled to 16×16 do not make good Minecraft pixel art.

## Decision

- **Providers are adapters.** Each one implements a small contract: `capabilities`, `available`, `formats`, `paid`, `estimateCost`, plus a kind-specific generate or synthesize call. The registry resolves `auto` to the best provider that is available.
- **Local, free and reproducible by default:**
  - textures are pixel specs written by the Texture Artist and checked against a style profile;
  - SFX use a layered synth (`local-synth`);
  - music uses a structured score composer (`local-composer`) with stems and transition metadata;
  - draft voices use system TTS.
- **ElevenLabs is optional.**
  - It is implemented with plain `fetch` against the four endpoints we need: TTS, sound-generation, music and the subscription check. We don't wrap the whole SDK.
  - Paid calls require `confirm_cost`, are capped per asset, and are logged.

## Consequences

- The studio works with no API keys at all.
- Without ElevenLabs, voices are draft quality, and QA flags them as `warn`.
- Adding an image or audio vendor means adding one provider; business logic does not change.
