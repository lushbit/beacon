#!/usr/bin/env node
/**
 * Fails when the update command in the dashboard and the one in the README
 * disagree.
 *
 * They already did once, and worse, the dashboard's version could not work:
 * it said `docker compose pull`, while the compose file builds the image from
 * the checkout, so there was nothing published to pull and the command exited
 * having done nothing. Nobody notices that from a diff, so it is checked here.
 *
 *   node scripts/check-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const source = fs.readFileSync(path.join(root, "client/src/lib/updateCommand.ts"), "utf8");
const match = /HUB_UPDATE_COMMAND\s*=\s*"([^"]+)"/.exec(source);
if (!match) {
  console.error("could not find HUB_UPDATE_COMMAND in client/src/lib/updateCommand.ts");
  process.exit(1);
}

const command = match[1].replace(/\\n/g, "\n");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

if (!readme.includes(command)) {
  console.error("the update command shown in the dashboard is not in the README:\n");
  console.error(command);
  console.error("\nUpdate README.md so both tell people the same thing.");
  process.exit(1);
}

console.log("docs ok (the dashboard and the README give the same update command)");
