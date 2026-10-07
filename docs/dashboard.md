# Studio Dashboard

A local web interface for the studio state. Start it with `/minecraft-studio:dashboard` or the `studio_dashboard_start` tool. From a shell, run `node runtime/dist/cli.mjs dashboard --project <dir>`.

- Binds to `http://127.0.0.1:4777`; set `dashboard.port` in the config to change the port.
- Read-only.
- Live updates over Server-Sent Events, falling back to polling every 5 s.
- Works offline: no CDNs, no external fonts.

| View | Shows |
|---|---|
| Overview | Project, Minecraft version, platforms, plugin and pack versions, build and QA status, Git, active agents, current tasks, recent assets, asset status chart, activity |
| Tasks | Dependency graph: layered columns with edges, plus task contracts and results |
| Agents | Agent Inspector: status, tasks, timing, inputs/outputs, tools. User-facing summaries only, never hidden reasoning |
| Code | Code assets, files, Minecraft ids, QA |
| Textures | Pixel-perfect zoom (1×–32×), grid overlay, palette, animated frames, style traits, Minecraft paths, related models and states, version and QA history |
| 3D | Interactive textured model viewer (orbit and zoom), bone tree with visibility toggles, metadata |
| Animations | Playback on the model, scrubber with keyframe ticks per bone, loop, speed |
| SFX / Voice | Player, waveform, duration, format, loudness, loop, events, provider metadata; voice profiles and pronunciation dictionary |
| Music | Player with section and transition markers, BPM/key/meter, stem mixer with sample-synchronous mute/solo |
| Particles | Particle assets |
| Resource Pack | Packs, namespaces, counts, resolutions, latest validation issues |
| Guides | Rendered player and admin guides |
| Tests | Build, unit, pack and runtime runs with details |
| Logs | Structured activity log with severity and agent filters |
| Git | Branch, changes, remote, ahead/behind, commit log |
| Tools | Project tools and providers (capabilities, availability, paid) |
| References | Research notes and ADRs |
| Settings | Config, secret status (configured/missing only), provider spend |

## Architecture

The UI (`studio/web-dashboard`, vanilla ES modules) only calls the backend API (`runtime/src/dashboard/server.js`). The backend reads the Asset Registry, Task Registry, project state, QA results, Git state and logs; it never calls providers. If you replace an image or audio provider, the dashboard does not change.

## Security

- Accepts GET requests only.
- Rejects `Host` headers other than localhost, which guards against DNS rebinding.
- Serves only allow-listed file types inside the project, never `.env`.
- Shows only whether secrets are configured, never their values.
