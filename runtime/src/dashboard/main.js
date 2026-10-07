// Entry point for the standalone dashboard process (started by studio_dashboard_start or `studio dashboard`).
import { createDashboard, parseArgs } from './server.js';

const d = createDashboard(parseArgs());
d.listen().then((url) => process.stdout.write(`Minecraft Studio Dashboard: ${url}\n`));
process.on('SIGTERM', () => { d.close(); process.exit(0); });
