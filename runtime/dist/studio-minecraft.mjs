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
  writeItemDefinition,
  writeZip
} from "./chunks/chunk-RU4HYO7E.mjs";
import "./chunks/chunk-3P6ZCJ33.mjs";
import {
  StudioError,
  exists,
  readJson,
  walk
} from "./chunks/chunk-5XAWRH4I.mjs";

// src/mcp/studio-minecraft.js
import fs2 from "node:fs";

// src/lib/minecraft/bedrock.js
import fs from "node:fs";
import path from "node:path";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var tryJson = (file, _issues, add) => {
  try {
    return readJson(file);
  } catch (e) {
    add("error", "json", file, e.message);
    return null;
  }
};
function checkManifest(dir, kind, add) {
  const f = path.join(dir, "manifest.json");
  if (!exists(f)) {
    add("error", "manifest", `${kind}/manifest.json`, "missing manifest.json");
    return null;
  }
  const m = tryJson(f, null, add);
  if (!m) return null;
  if (m.format_version !== 2 && m.format_version !== 3) add("warning", "manifest", `${kind}/manifest.json`, `format_version ${m.format_version} (expected 2)`);
  if (!UUID.test(m.header?.uuid || "")) add("error", "manifest", `${kind}/manifest.json`, "header.uuid is not a valid UUID");
  if (!Array.isArray(m.header?.version) && typeof m.header?.version !== "string") add("error", "manifest", `${kind}/manifest.json`, "header.version missing");
  const want = kind === "RP" ? "resources" : "data";
  if (!(m.modules || []).some((mod) => mod.type === want)) add("error", "manifest", `${kind}/manifest.json`, `needs a "${want}" module`);
  for (const mod of m.modules || []) if (!UUID.test(mod.uuid || "")) add("error", "manifest", `${kind}/manifest.json`, `module uuid invalid (${mod.type})`);
  return m;
}
function validateBedrockAddon(rpDir, bpDir = null) {
  const issues = [];
  const add = (severity, kind, file, detail) => issues.push({ severity, kind, file: String(file).replace(/\\/g, "/"), detail });
  const rel = (base, f) => path.relative(base, f).replace(/\\/g, "/");
  const rp = checkManifest(rpDir, "RP", add);
  const bp = bpDir ? checkManifest(bpDir, "BP", add) : null;
  if (rp && bp) {
    const uuids = [rp.header.uuid, bp.header.uuid, ...rp.modules.map((m) => m.uuid), ...bp.modules.map((m) => m.uuid)];
    if (new Set(uuids).size !== uuids.length) add("error", "manifest", "manifests", "UUIDs must be unique across packs and modules");
    if (!(bp.dependencies || []).some((d) => d.uuid === rp.header.uuid)) add("warning", "manifest", "BP/manifest.json", "behavior pack does not depend on the resource pack (players may load one without the other)");
  }
  const rpFiles = walk(rpDir);
  const geometries = /* @__PURE__ */ new Set();
  for (const f of rpFiles.filter((x) => /^models\/.+\.json$/.test(x))) {
    const j = tryJson(path.join(rpDir, f), issues, add);
    for (const g of j?.["minecraft:geometry"] || []) geometries.add(g.description?.identifier);
  }
  const animations = /* @__PURE__ */ new Set();
  for (const f of rpFiles.filter((x) => /^animations\/.+\.json$/.test(x))) {
    const j = tryJson(path.join(rpDir, f), issues, add);
    for (const [name, a] of Object.entries(j?.animations || {})) {
      animations.add(name);
      for (const v of Object.values(a.timeline || {})) if (typeof v === "string" && !/[;=/]|^(query|q|variable|v)\./.test(v)) add("warning", "animation-timeline", f, `${name}: timeline entry "${v}" is not Molang or a command`);
    }
  }
  const controllers = /* @__PURE__ */ new Set(["controller.render.default"]);
  for (const f of rpFiles.filter((x) => /^render_controllers\/.+\.json$/.test(x))) Object.keys(tryJson(path.join(rpDir, f), issues, add)?.render_controllers || {}).forEach((k) => controllers.add(k));
  const clientIds = /* @__PURE__ */ new Set();
  for (const f of rpFiles.filter((x) => /^entity\/.+\.json$/.test(x))) {
    const j = tryJson(path.join(rpDir, f), issues, add);
    const d = j?.["minecraft:client_entity"]?.description;
    if (!d) {
      add("error", "client-entity", f, "missing minecraft:client_entity.description");
      continue;
    }
    clientIds.add(d.identifier);
    for (const [k, g] of Object.entries(d.geometry || {})) if (!geometries.has(g)) add("error", "missing-geometry", f, `geometry.${k} \u2192 ${g} not found in models/`);
    for (const [k, t] of Object.entries(d.textures || {})) if (!rpFiles.includes(`${t}.png`) && !rpFiles.includes(`${t}.tga`)) add("error", "missing-texture", f, `textures.${k} \u2192 ${t}(.png|.tga) not found`);
    for (const [k, a] of Object.entries(d.animations || {})) if (!a.startsWith("controller.") && !animations.has(a)) add("error", "missing-animation", f, `animations.${k} \u2192 ${a} not found`);
    for (const rc of d.render_controllers || []) {
      const id = typeof rc === "string" ? rc : Object.keys(rc)[0];
      if (!controllers.has(id)) add("error", "missing-render-controller", f, id);
    }
    for (const step of d.scripts?.animate || []) {
      const key = typeof step === "string" ? step : Object.keys(step)[0];
      if (!(key in (d.animations || {}))) add("error", "script", f, `scripts.animate references unknown animation key ${key}`);
    }
  }
  const sdFile = path.join(rpDir, "sounds", "sound_definitions.json");
  const soundDefs = exists(sdFile) ? tryJson(sdFile, issues, add)?.sound_definitions || {} : {};
  for (const [name, def] of Object.entries(soundDefs)) {
    for (const s of def.sounds || []) {
      const p = typeof s === "string" ? s : s.name;
      if (![".ogg", ".fsb", ".wav"].some((ext) => rpFiles.includes(`${p}${ext}`))) add("error", "missing-sound", "sounds/sound_definitions.json", `${name} \u2192 ${p}(.ogg) not found`);
    }
  }
  const sj = exists(path.join(rpDir, "sounds.json")) ? tryJson(path.join(rpDir, "sounds.json"), issues, add) : null;
  for (const [ent, cfg] of Object.entries(sj?.entity_sounds?.entities || {})) for (const [ev, snd] of Object.entries(cfg.events || {})) {
    const s = typeof snd === "string" ? snd : snd.sound;
    if (s && !soundDefs[s]) add("error", "missing-sound-event", "sounds.json", `${ent} ${ev} \u2192 ${s} not in sound_definitions`);
  }
  const bpIds = [];
  if (bpDir) {
    for (const f of walk(bpDir).filter((x) => /^entities\/.+\.json$/.test(x))) {
      const j = tryJson(path.join(bpDir, f), issues, add);
      const d = j?.["minecraft:entity"]?.description;
      if (!d?.identifier) {
        add("error", "entity", f, "missing minecraft:entity.description.identifier");
        continue;
      }
      bpIds.push(d.identifier);
      if (!clientIds.has(d.identifier)) add("warning", "entity", f, `${d.identifier} has no client entity in the resource pack (renders as nothing)`);
      if (!j["minecraft:entity"].components?.["minecraft:collision_box"]) add("info", "entity", f, `${d.identifier} has no collision_box`);
    }
    for (const id of clientIds) if (!bpIds.includes(id)) add("warning", "entity", "entity/", `${id} has a client entity but no behavior entity`);
  }
  const lang = rpFiles.filter((x) => /^texts\/.+\.lang$/.test(x));
  for (const id of clientIds) for (const l of lang) if (!fs.readFileSync(path.join(rpDir, l), "utf8").includes(`entity.${id}.name=`)) add("info", "lang", l, `no display name for ${id}`);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return {
    verdict: errors ? "fail" : warnings ? "warn" : "pass",
    errors,
    warnings,
    counts: { geometries: geometries.size, animations: animations.size, client_entities: clientIds.size, behavior_entities: bpIds.length, sound_definitions: Object.keys(soundDefs).length, files: rpFiles.length },
    rp_uuid: rp?.header?.uuid || null,
    bp_uuid: bp?.header?.uuid || null,
    issues
  };
}
function packageBedrockAddon(rpDir, bpDir, outBase) {
  if (!exists(path.join(rpDir, "manifest.json"))) throw new StudioError("E_PACK", "resource pack manifest.json missing");
  const zipDir = (dir, prefix = "") => walk(dir).map((f) => ({ name: `${prefix}${f}`, data: fs.readFileSync(path.join(dir, f)) }));
  const out = {};
  out.rp = writeZip(`${outBase}_RP.mcpack`, zipDir(rpDir));
  if (bpDir) out.bp = writeZip(`${outBase}_BP.mcpack`, zipDir(bpDir));
  out.addon = writeZip(`${outBase}.mcaddon`, [...zipDir(rpDir, `${path.basename(rpDir)}/`), ...bpDir ? zipDir(bpDir, `${path.basename(bpDir)}/`) : []]);
  return out;
}

// src/mcp/studio-minecraft.js
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
  const text = fs2.readFileSync(studio.abs(a.path), "utf8");
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
tool(server, "mc_bedrock_validate", {
  title: "Validate Bedrock add-on",
  capability: "read",
  description: "Validate a Bedrock resource pack (+ behavior pack): manifests and UUIDs, client entities \u2192 geometry/textures/animations/render controllers, animate scripts, sound_definitions \u2192 .ogg files, sounds.json events, behavior entities \u2194 client entities, language names.",
  input: { rp_dir: external_exports.string(), bp_dir: external_exports.string().optional() }
}, async (a, { studio }) => {
  const r = validateBedrockAddon(studio.abs(a.rp_dir), a.bp_dir ? studio.abs(a.bp_dir) : null);
  if (studio.isInitialized()) studio.saveTestRun({ suite: "bedrock-addon", passed: r.verdict !== "fail", summary: `${r.errors} errors, ${r.warnings} warnings; ${r.counts.client_entities} entities, ${r.counts.geometries} geometries, ${r.counts.animations} animations`, details: { issues: r.issues.filter((i) => i.severity !== "info").slice(0, 50), counts: r.counts }, agent: "integration-qa" });
  return r;
});
tool(server, "mc_bedrock_package", {
  title: "Package Bedrock add-on",
  capability: "write",
  description: "Zip the resource/behavior packs into .mcpack files and one .mcaddon (double-click to import in Minecraft Bedrock).",
  input: { rp_dir: external_exports.string(), bp_dir: external_exports.string().optional(), output_base: external_exports.string().describe("Project-relative path without extension, e.g. build-out/creatures") }
}, async (a, { studio }) => {
  const r = packageBedrockAddon(studio.abs(a.rp_dir), a.bp_dir ? studio.abs(a.bp_dir) : null, studio.abs(a.output_base));
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { file: studio.rel(v.file), bytes: v.bytes, sha1: v.sha1 }]));
});
await start(server);
