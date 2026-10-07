# Agents

| Agent | Role | Tool access (least privilege) |
|---|---|---|
| `project-director` | Producer / technical director. Plans the dependency graph, delegates, routes work to QA, integrates, documents, commits and reports | all tools (it orchestrates) |
| `researcher` | Official documentation, API changes, format specifications, license and maintenance checks; writes `docs/research/` | read and web tools, plus memory |
| `minecraft-developer` | Plugin and mod code: state machines, persistence, GUI, timelines, music logic | file edits, Bash, `studio-minecraft`, registry |
| `style-analyst` | Builds the style profile and brief from an existing pack | `studio-texture`, memory |
| `texture-artist` | Pixel-art textures and state variants | `studio-texture`, registry |
| `modeler` | Models, rigs, UV, exports | `studio-model`, item definitions, registry |
| `animator` | Animations and timeline beats | `studio-model`, timelines |
| `sfx-designer` | Layered SFX, processing, Minecraft export | SFX and processing tools in `studio-audio` |
| `composer` | Adaptive music with stems and transitions | music tools, sound events |
| `voice-director` | Voice profiles, pronunciation, voice lines | voice tools, providers |
| `visual-qa` | Reviews textures, models and animations | read-only visual tools, `studio_qa_record` |
| `audio-qa` | Reviews SFX, music and voice | audits and analysis, `studio_qa_record` |
| `code-reviewer` | Reviews architecture, threading, tick cost, persistence and permissions | read and Bash, build and test, `studio_qa_record` |
| `integration-qa` | Checks code ↔ model ↔ animation ↔ audio ↔ texture links, builds, runtime smoke test | `studio-minecraft`, integrity, timelines, test records |
| `documentation-writer` | Player and admin guides | file edits, registry |

All agents use `model: inherit`. Their descriptions start with "Use this agent when…" and give worked scenarios under **When to invoke**. Producer agents end with a fixed report: Created / Changed / Validated / Failed / Needs review. QA agents are independent of producers: they record verdicts and don't fix the work themselves.

## Delegation contract

The director sends each task as a block like this, created with `studio_task_plan`:

```
TASK / AGENT / GOAL / INPUTS / OUTPUTS / ALLOWED / DEPENDS ON / CONSTRAINTS / QUALITY / VALIDATION / DESTINATION
```

Subagents write only inside DESTINATION.

## Agent Factory

When a specialisation keeps recurring or is serious enough (for example a particle artist), the director calls `studio_agent_define`. It validates the definition and writes it to the **project's** `.claude/agents/<name>.md`, recording it in `.minecraft-studio/agents.json`. The definition must include:

- a name, a "Use this agent when…" description and a narrow specialisation
- the minimum tools
- input and output contracts
- QA criteria
- a justification

Claude Code loads project agents when a session starts, so the new agent is available after a reload. The current task carries on with the closest existing agent.
