#!/usr/bin/env node
/**
 * Fails if a compose file would not parse.
 *
 * The trap this exists for: an unquoted value containing a colon and a space.
 *
 *   SESSION_SECRET: ${SESSION_SECRET:?generate one with: openssl rand -hex 48}
 *
 * YAML reads "with: openssl" as a nested mapping and the whole file is
 * rejected, so the quick start in the README could not be run at all. Nothing
 * else in the pipeline reads these files — the images are built directly — so
 * the mistake survived until someone tried to install the hub.
 *
 *   node scripts/check-compose.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["docker/compose.yaml", "docker/agent/compose.yaml"];

let failed = false;

for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    console.error(`${relative}: missing`);
    failed = true;
    continue;
  }

  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = /^\s*[\w.-]+:\s+(\S.*?)\s*$/.exec(line);
    if (!match) return;
    const value = match[1];
    if (value.startsWith("#")) return;

    const quoted = /^(".*"|'.*')$/.test(value);
    if (quoted) return;

    // A plain scalar ends at ": ", and "${VAR:?...}" hides one often enough
    // that every interpolated value is required to be quoted.
    if (value.includes(": ")) {
      console.error(`${relative}:${index + 1}: unquoted value contains ": ", which YAML reads as a mapping`);
      console.error(`  ${line.trim()}`);
      failed = true;
    } else if (value.includes("${")) {
      console.error(`${relative}:${index + 1}: interpolated values must be quoted`);
      console.error(`  ${line.trim()}`);
      failed = true;
    }
  });
}

if (failed) {
  console.error("\ncompose files rejected");
  process.exit(1);
}

console.log(`compose files ok (${files.join(", ")})`);
