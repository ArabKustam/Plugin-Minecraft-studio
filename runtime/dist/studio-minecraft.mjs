import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  createServer,
  external_exports,
  start,
  tool
} from "./chunks/chunk-RWJTKMSS.mjs";
import {
  ADAPTERS,
  detectPlatforms,
  getAdapter,
  javaVersion,
  parseServerLog,
  requiredJava,
  runPaperTestServer,
  runProjectCommand
} from "./chunks/chunk-J5ZW7ISX.mjs";
import {
  PACK_FORMATS,
  packageResourcePack,
  upsertSoundEvent,
  validateResourcePack,
  writeItemDefinition
} from "./chunks/chunk-HYFTE7OH.mjs";
import "./chunks/chunk-3P6ZCJ33.mjs";
import {
  StudioError,
  walk
} from "./chunks/chunk-5XAWRH4I.mjs";

// src/mcp/studio-minecraft.js
import fs from "node:fs";
var server = createServer("studio-minecraft", "Minecraft Studio platform layer. Detect the platform before changing code; build and test through the adapter; validate the resource pack for broken references after every asset change; run the local Paper test server only after the user accepted the Minecraft EULA.");
tool(
  server,
  "mc_adapters",
  { title: "List platform adapters", capability: "read", description: "Supported MinecraftPlatformAdapters (Paper/Bukkit, Velocity/Bungee proxy, Fabric, NeoForge/Forge, datapack, resource pack, Bedrock add-on) and what each supports." },
  async (_a, { root }) => ADAPTERS.map((ad) => ({ id: ad.id, name: ad.name, kind: ad.kind, build: !!ad.build(root), test: !!ad.test(root), run: ad.run }))
);
tool(
  server,
  "mc_detect",
  { title: "Detect platforms", capability: "read", description: "Detect every platform present in the project with confidence and evidence (hybrid projects are common)." },
  async (_a, { root }) => detectPlatforms(root, walk(root))
);
tool(server, "mc_build", {
  title: "Build project",
  capability: "execute",
  description: "Build via the platform adapter (Gradle wrapper \u2192 Gradle \u2192 Maven). Returns errors, warnings, output tail and built artifacts. Logs the result.",
  input: { adapter: external_exports.string().optional().describe("Adapter id; defaults to the profile platform"), dir: external_exports.string().optional().describe("Sub-directory containing the build (project-relative)") }
}, async (a, { studio, root }) => {
  const id = a.adapter || studio.project()?.platform;
  if (!id) throw new StudioError("E_INPUT", "No adapter given and no platform in the project profile");
  const dir = a.dir ? studio.abs(a.dir) : root;
  const r = runProjectCommand(dir, id, "build");
  if (studio.isInitialized()) {
    studio.log({ agent: "minecraft-developer", event: "build", severity: r.ok ? "success" : "error", message: `${r.skipped ? "Build skipped" : r.ok ? "Build passed" : "Build FAILED"} (${id}${r.duration_s ? `, ${r.duration_s}s` : ""})` });
    studio.saveTestRun({ suite: "build", passed: !!r.ok, summary: r.skipped ? r.reason : `${r.errors?.length || 0} errors, ${r.warnings?.length || 0} warnings`, details: { command: r.command, errors: r.errors, artifacts: r.artifacts }, agent: "minecraft-developer" });
  }
  return r;
});
tool(server, "mc_test", {
  title: "Run unit tests",
  capability: "execute",
  description: "Run the project test task through the adapter (gradle test / mvn test).",
  input: { adapter: external_exports.string().optional(), dir: external_exports.string().optional() }
}, async (a, { studio, root }) => {
  const id = a.adapter || studio.project()?.platform;
  const r = runProjectCommand(a.dir ? studio.abs(a.dir) : root, id, "test");
  if (studio.isInitialized()) studio.saveTestRun({ suite: "unit-tests", passed: !!r.ok, summary: r.skipped ? r.reason : `${r.errors?.length || 0} error lines`, details: { command: r.command, errors: r.errors }, agent: "integration-qa" });
  return r;
});
tool(server, "mc_test_server", {
  title: "Run Paper test server",
  capability: "execute",
  needsInit: true,
  description: "Download (checksum-verified) and start a disposable local Paper server, install plugin jars, wait for startup, run smoke-test console commands, stop, and analyse logs (plugin loaded, errors, warnings). Requires minecraft.accept_eula=true set after explicit user consent.",
  input: { version: external_exports.string().describe("Minecraft/Paper version, e.g. 1.21.11"), plugin_jars: external_exports.array(external_exports.string()).describe("Project-relative jar paths"), commands: external_exports.array(external_exports.string()).optional().describe("Console commands for smoke tests"), timeout_s: external_exports.number().int().optional(), resource_pack_zip: external_exports.string().optional() }
}, async (a, { studio }) => {
  const r = await runPaperTestServer(studio, { version: a.version, pluginJars: a.plugin_jars, commands: a.commands || [], timeoutS: a.timeout_s, resourcePackZip: a.resource_pack_zip });
  studio.saveTestRun({ suite: "runtime-smoke", passed: r.ok, summary: `${r.ready ? `started in ${r.startup_s}s` : "did not start"}; ${r.errors.length} errors; plugins: ${r.loaded_plugins.map((p) => p.name).join(", ")}`, details: r, agent: "integration-qa" });
  return r;
});
tool(server, "mc_parse_log", {
  title: "Parse server/client log",
  capability: "read",
  description: "Extract errors, warnings, loaded plugins and startup completion from a log file.",
  input: { path: external_exports.string(), adapter: external_exports.string().optional() }
}, async (a, { studio }) => {
  const text = fs.readFileSync(studio.abs(a.path), "utf8");
  return a.adapter ? getAdapter(a.adapter).parseLog(text) : parseServerLog(text);
});
tool(
  server,
  "mc_java_check",
  { title: "Java compatibility", capability: "read", description: "Installed Java vs the Java required by a Minecraft version (1.20.5\u20131.21.11 \u2192 21, 26.x \u2192 25).", input: { minecraft_version: external_exports.string() } },
  async (a) => {
    const j = javaVersion();
    const need = requiredJava(a.minecraft_version);
    return { installed: j?.major ?? null, required: need, ok: !!j && j.major >= need };
  }
);
tool(server, "mc_resourcepack_validate", {
  title: "Validate resource pack",
  capability: "read",
  description: "Validate pack.mcmeta (format for the target version), naming, models \u2192 textures/parents, item definitions \u2192 models, blockstates \u2192 models, sounds.json \u2192 .ogg, animation strips, orphans. Use after every asset change to catch broken references.",
  input: { pack_dir: external_exports.string(), minecraft_version: external_exports.string().optional() }
}, async (a, { studio }) => {
  const r = validateResourcePack(studio.abs(a.pack_dir), { minecraftVersion: a.minecraft_version || studio.project()?.minecraft_version });
  if (studio.isInitialized()) studio.saveTestRun({ suite: "resource-pack", passed: r.verdict !== "fail", summary: `${r.errors} errors, ${r.warnings} warnings, ${r.files} files`, details: { issues: r.issues.filter((i) => i.severity !== "info").slice(0, 50) }, agent: "integration-qa" });
  return r;
});
tool(server, "mc_resourcepack_package", {
  title: "Package resource pack",
  capability: "write",
  description: "Zip the pack deterministically and return the SHA-1 for server.properties (resource-pack-sha1).",
  input: { pack_dir: external_exports.string(), output: external_exports.string() }
}, async (a, { studio }) => {
  const r = packageResourcePack(studio.abs(a.pack_dir), studio.abs(a.output));
  return { ...r, file: a.output };
});
tool(server, "mc_sound_event", {
  title: "Define sound event",
  capability: "write",
  description: "Add/replace an event in assets/<ns>/sounds.json referencing existing .ogg files.",
  input: { pack_dir: external_exports.string(), namespace: external_exports.string(), event: external_exports.string(), sounds: external_exports.array(external_exports.union([external_exports.string(), external_exports.record(external_exports.string(), external_exports.any())])), subtitle: external_exports.string().optional(), replace: external_exports.boolean().optional() }
}, async (a, { studio }) => {
  const r = upsertSoundEvent(studio.abs(a.pack_dir), a.namespace, a.event, { sounds: a.sounds, subtitle: a.subtitle, replace: a.replace });
  return { event: r.event, file: studio.rel(r.file) };
});
tool(server, "mc_item_definition", {
  title: "Create item model definition",
  capability: "write",
  description: "Write assets/<ns>/items/<id>.json (1.21.4+) pointing at a model, so code can use ItemMeta#setItemModel(ns:id).",
  input: { pack_dir: external_exports.string(), namespace: external_exports.string(), id: external_exports.string(), model: external_exports.string().describe("Model resource location, e.g. ns:item/reactor_core") }
}, async (a, { studio }) => ({ file: studio.rel(writeItemDefinition(studio.abs(a.pack_dir), a.namespace, a.id, a.model)), item_model: `${a.namespace}:${a.id}` }));
tool(
  server,
  "mc_pack_formats",
  { title: "Resource pack formats", capability: "read", description: "Known Minecraft version \u2192 resource pack format numbers." },
  async () => PACK_FORMATS
);
await start(server);
