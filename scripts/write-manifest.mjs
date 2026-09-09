#!/usr/bin/env node
// Writes release/public/manifest.json describing the agent bundle this hub
// serves. The checksum here is what an agent verifies after downloading, and
// the hub delivers it over the authenticated socket rather than over HTTP.
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "release", "public");

const { BEACON_VERSION } = await import(join(root, "shared/dist/version.js"));
const { PROTOCOL_VERSION, MIN_PROTOCOL_VERSION } = await import(join(root, "shared/dist/protocol.js"));

const versioned = `agent-${BEACON_VERSION}.tar.gz`;
const source = join(publicDir, "agent-bundle.tar.gz");
const target = join(publicDir, versioned);

copyFileSync(source, target);

const bytes = readFileSync(target);
const manifest = {
  version: BEACON_VERSION,
  protocol: PROTOCOL_VERSION,
  minProtocol: MIN_PROTOCOL_VERSION,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  sizeBytes: statSync(target).size,
  filename: versioned,
};

writeFileSync(join(publicDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${manifest.version} (${manifest.sha256.slice(0, 12)}…, ${manifest.sizeBytes} bytes)`);
