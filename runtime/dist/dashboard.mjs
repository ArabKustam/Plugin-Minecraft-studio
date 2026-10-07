import { createRequire as __msCreateRequire } from 'node:module'; const require = __msCreateRequire(import.meta.url);
import {
  createDashboard,
  parseArgs
} from "./chunks/chunk-Y3IDW2VB.mjs";
import "./chunks/chunk-R6KWYNWG.mjs";
import "./chunks/chunk-WWXJ6DHF.mjs";
import "./chunks/chunk-5XAWRH4I.mjs";

// src/dashboard/main.js
var d = createDashboard(parseArgs());
d.listen().then((url) => process.stdout.write(`Minecraft Studio Dashboard: ${url}
`));
process.on("SIGTERM", () => {
  d.close();
  process.exit(0);
});
