# Orchestration

## Production as a dependency graph

A TODO list hides which work can run in parallel and what blocks what. Plan with `studio_task_plan`; the response contains `layers` (each layer can run concurrently), `ready` tasks and a Mermaid diagram.

```
reactor-design
   ├── style-profile ──► texture-set ──► reactor-model ──► animation-set ─┐
   ├── startup-sfx ─────────────────────────────────────────────────────────┤
   ├── alarm-music ─────────────────────────────────────────────────────────┤
   ├── voice-lines ─────────────────────────────────────────────────────────┤
   └── game-logic ──────────────────────────────────────────────────────────┴─► timeline ─► integration ─► QA ─► guide
```

Create dependencies first (tasks are applied in order; unknown dependencies and cycles are rejected).

## Delegation contract

Every delegated task carries:

```
TASK:        reactor-main-texture
AGENT:       texture-artist
GOAL:        Base texture set for the reactor core.
INPUTS:      .minecraft-studio/style-profile.json; concept notes in task reactor-design
OUTPUTS:     resourcepack/assets/reactor/textures/item/core_off.png (+ active, warning, critical)
ALLOWED:     studio-texture tools, Read
DEPENDS ON:  style-profile
CONSTRAINTS: 16×16; palette from style profile; top-left lighting
QUALITY:     style score ≥ 75; readable at 100%; states read as one object
VALIDATION:  texture_validate, texture_style_compare, texture_variants strip
DESTINATION: resourcepack/assets/reactor/textures/item/
```

Pass this block verbatim in the subagent prompt plus any relevant memory entries. Subagents must not touch files outside DESTINATION.

## Running the graph

1. Pick `ready` tasks. Launch independent ones in parallel (one message, multiple Agent calls).
2. `studio_task_update {status: "in-progress", summary}` when an agent starts; `done`/`failed` with a one-line, user-facing summary when it returns. Summaries appear in the dashboard Agent Inspector — never include hidden reasoning.
3. Send produced assets to the matching QA agent. On `fail`: create a revision task for the producer with QA's concrete findings; loop until pass or until 3 attempts, then escalate to the user with the best version and the open issues.
4. Re-read the graph; continue with newly ready tasks.

## When not to delegate

Delegate when a task needs focused specialist context or can run in parallel. Do it yourself when it is a two-minute change, when the context transfer would be larger than the work, or when you need the result immediately to decide the next step.

## Agent Factory {#agent-factory}

If a specialisation recurs (e.g. many particle effects → *particle-artist*) or is serious enough to deserve its own rules, define a persistent agent with `studio_agent_define`:

- narrow specialisation, "Use this agent when…" description, minimal tools, input/output contracts, QA criteria, justification.
- It is written to `<project>/.claude/agents/<name>.md` and becomes available after a plugin reload / new session. **Continue the current task with the closest existing agent** — do not stall waiting for the reload.
- Do not create agents for one-off operations; a well-written task contract is enough.

## Parallel safety

- Two agents never write the same file. Split destinations.
- Registry writes are per-asset files, so parallel registration is safe.
- Git checkpoints happen in the director's context after a layer completes, never inside subagents.
