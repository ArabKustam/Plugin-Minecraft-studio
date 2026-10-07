# Creating tools and agents

## When to create a tool

Only for a **reusable** operation that the existing tools don't cover and that you have done (or will do) repeatedly: e.g. `validate-gui-layout`, `compare-particle-sprites`, `check-sound-subtitles`, `export-modelengine-blueprint`. Not for a one-off script — run that with Bash and move on.

## Standard

`studio_tool_scaffold {name, description, input_schema, output_description, justification}` creates `.minecraft-studio/tools/<name>/`:

- `tool.json` — manifest (purpose, input schema, output description, version)
- `index.mjs` — `export async function run(input, ctx)`; reads JSON from stdin, prints one JSON object
- `test.mjs` — assertions; must pass (`studio_tool_test`)
- `README.md` — purpose, input, output, examples

Requirements: concrete purpose; validated input (reject bad paths, keep every path inside `ctx.projectRoot`); structured output; clear error messages; no network unless essential; no secrets; tests; usage examples. Run with `studio_tool_run {name, input}`.

After creating a tool, add a one-line usage note to the relevant reference (or the project memory, category `convention`) so future sessions use it.

## Promote to the plugin

If a project tool proves generally useful, propose contributing it to Minecraft Studio itself (runtime/src + MCP registration + tests + docs) — see CONTRIBUTING.md.

## Agents

See `orchestration.md#agent-factory`. Same bar: recurring or serious specialisation, minimal tools, explicit contracts and QA criteria.
