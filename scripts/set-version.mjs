#!/usr/bin/env node
// Sets the release version in the one place that defines it, and in every
// package.json that has to agree with it.
//
//   node scripts/set-version.mjs 1.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: node scripts/set-version.mjs <major.minor.patch[-prerelease]>");
  process.exit(1);
}

const versionFile = join(root, "shared/src/version.ts");
const source = readFileSync(versionFile, "utf8");
if (!/BEACON_VERSION\s*=\s*"[^"]+"/.test(source)) {
  console.error("BEACON_VERSION not found in shared/src/version.ts");
  process.exit(1);
}
writeFileSync(versionFile, source.replace(/BEACON_VERSION\s*=\s*"[^"]+"/, `BEACON_VERSION = "${version}"`));

for (const manifest of ["package.json", "shared/package.json", "server/package.json", "client/package.json", "agent/package.json"]) {
  const file = join(root, manifest);
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${version}"`));
}

console.log(`version set to ${version}`);
console.log("next: commit, tag v" + version + ", then write the notes on the GitHub release");
