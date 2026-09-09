#!/usr/bin/env node
// Fails if the release version is declared inconsistently.
//
// BEACON_VERSION in shared/src/version.ts is the source of truth; every
// package.json must agree with it so a build cannot ship mixed versions.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const source = readFileSync(join(root, "shared/src/version.ts"), "utf8");
const match = source.match(/BEACON_VERSION\s*=\s*"([^"]+)"/);
if (!match) {
  console.error("BEACON_VERSION not found in shared/src/version.ts");
  process.exit(1);
}

const version = match[1];
const manifests = ["package.json", "shared/package.json", "server/package.json", "client/package.json", "agent/package.json"];

let failed = false;
for (const manifest of manifests) {
  const declared = JSON.parse(readFileSync(join(root, manifest), "utf8")).version;
  if (declared !== version) {
    console.error(`${manifest}: version ${declared} does not match BEACON_VERSION ${version}`);
    failed = true;
  }
}

// On a tag build, the tag is part of the contract too. The CI system passes it
// in as RELEASE_TAG so this script stays independent of which one is used.
const tag = process.env.RELEASE_TAG;
if (tag && tag.replace(/^v/i, "") !== version) {
  console.error(`tag ${tag} does not match BEACON_VERSION ${version}`);
  failed = true;
}

if (failed) process.exit(1);
console.log(`version ${version}`);
