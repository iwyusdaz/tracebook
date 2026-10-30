#!/usr/bin/env node
// TraceBook unified CLI: node src/cli.mjs <extract|verify|report|rot-check> [args...]
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];
const commands = ["extract", "verify", "report", "rot-check"];

if (!commands.includes(command)) {
  console.error(`Usage: tracebook <${commands.join("|")}> [args...]`);
  process.exit(command ? 2 : 0);
}

const result = spawnSync(process.execPath, [join(here, `${command}.mjs`), ...process.argv.slice(3)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
