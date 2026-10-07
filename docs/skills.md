# Skills

| Skill | Invoked as | Purpose |
|---|---|---|
| `minecraft-studio` | automatically, or `/minecraft-studio:minecraft-studio` | The core skill that runs the studio: how to start, plan, delegate, enforce QA, ask before risky actions, and finish |
| `init` | `/minecraft-studio:init` | Analyses the project, then creates the profile, registry, memory and style profile, and starts the dashboard |
| `doctor` | `/minecraft-studio:doctor` | Diagnoses the environment and integrations and lists the fixes |
| `dashboard` | `/minecraft-studio:dashboard` | Opens the Studio Dashboard |
| `texture-artist` | auto | Texture workflow: concept → spec → render → match → variants |
| `modeler` | auto | Modelling workflow: blockout → forms → UV → review → export |
| `animation-director` | auto | Animation workflow: beat sheet → keyframes → validate → contact sheets → timeline |
| `audio-designer` | auto | SFX workflow: layered recipes, processing and Minecraft export |
| `music-composer` | auto | Adaptive music: scores, stems and transition metadata |
| `voice-director` | auto | Voice profiles, pronunciation and lines |
| `minecraft-developer` | auto | Implement, build and test gameplay code |
| `qa` | auto | Single-asset QA and the "check the whole plugin" sweep |

## Progressive disclosure

`skills/minecraft-studio/SKILL.md` stays short, about 120 lines: the rules that always apply. Domain knowledge lives in 16 reference files that are loaded only when needed:

`project-analysis` · `orchestration` · `texture-production` · `minecraft-pixel-art` · `style-matching` · `modeling` · `uv` · `animation` · `minecraft-code` · `audio` · `adaptive-music` · `voice` · `timeline` · `testing` · `asset-registry` · `git-workflow` · `tool-development`

Specialist skills point at these references through `${CLAUDE_PLUGIN_ROOT}/skills/minecraft-studio/references/…`, so the knowledge exists in one place only.

## Writing or changing a skill

- The `description` decides when the skill triggers. Write it in the user's terms and include example phrasings.
- Name only tools that exist. `scripts/validate-plugin.mjs` checks every `` `tool_name` `` mentioned in skills against the live servers.
- When you add a tool, update the reference that covers its domain.
