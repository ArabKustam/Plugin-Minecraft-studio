import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  createDashboard,
  parseArgs
} from "./chunks/chunk-JAFVAEXP.mjs";
import "./chunks/chunk-KHXEIHTL.mjs";
import "./chunks/chunk-HMLAGON2.mjs";
import "./chunks/chunk-RRZML6EW.mjs";

// src/dashboard/main.js
var d = createDashboard(parseArgs());
d.listen().then((url) => process.stdout.write(`Minecraft Studio Dashboard: ${url}
`));
process.on("SIGTERM", () => {
  d.close();
  process.exit(0);
});
