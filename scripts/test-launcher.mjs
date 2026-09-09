#!/usr/bin/env node
/**
 * Tests the agent launcher's version selection and rollback, which is the
 * safety net that stops a bad agent build from taking a machine off the
 * dashboard permanently.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(condition, description) {
  console.log(`  ${condition ? "ok  " : "FAIL"}  ${description}`);
  if (!condition) failures.push(description);
}

/** Builds a throwaway installation with the given versions available. */
function makeInstall(versions, state) {
  const dir = mkdtempSync(join(tmpdir(), "beacon-launcher-"));
  copyFileSync(join(root, "scripts/launcher.mjs"), join(dir, "launcher.mjs"));
  for (const version of versions) {
    const distDir = join(dir, "versions", version, "agent", "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "index.js"), `process.stdout.write("started ${version}");\n`);
  }
  writeFileSync(join(dir, "current.json"), JSON.stringify(state, null, 2));
  return dir;
}

function runLauncher(dir) {
  try {
    return { out: execFileSync(process.execPath, [join(dir, "launcher.mjs")], { encoding: "utf8" }), ok: true };
  } catch (error) {
    return { out: `${error.stdout ?? ""}${error.stderr ?? ""}`, ok: false };
  }
}

const readState = (dir) => JSON.parse(readFileSync(join(dir, "current.json"), "utf8"));

console.log("Launcher");

// 1. Normal start.
{
  const dir = makeInstall(["1.0.0"], { version: "1.0.0", previous: null, pendingSince: null, failures: 0 });
  const result = runLauncher(dir);
  check(result.out.includes("started 1.0.0"), "starts the version named in current.json");
  rmSync(dir, { recursive: true, force: true });
}

// 2. A staged version that is not on disk must fall back.
{
  const dir = makeInstall(["1.0.0"], { version: "9.9.9", previous: "1.0.0", pendingSince: Date.now(), failures: 0 });
  runLauncher(dir);
  check(readState(dir).version === "1.0.0", "reverts when the staged version is missing");
  check(readState(dir).pendingSince === null, "clears the pending marker after reverting");
  rmSync(dir, { recursive: true, force: true });
}

// 3. A version that starts but never confirms is rolled back after repeated tries.
{
  const dir = makeInstall(["1.0.0", "1.1.0"], {
    version: "1.1.0",
    previous: "1.0.0",
    pendingSince: Date.now(),
    failures: 0,
  });

  runLauncher(dir);
  check(readState(dir).version === "1.1.0", "keeps a pending version on the first restart");

  runLauncher(dir);
  check(readState(dir).version === "1.1.0", "still keeps it on the second restart");

  runLauncher(dir);
  const state = readState(dir);
  check(state.version === "1.0.0", "rolls back once a pending version keeps failing");
  check(state.previous === null && state.failures === 0, "resets the state after rollback");
  rmSync(dir, { recursive: true, force: true });
}

// 4. A confirmed version is never rolled back, however many restarts happen.
{
  const dir = makeInstall(["1.0.0", "1.1.0"], { version: "1.1.0", previous: "1.0.0", pendingSince: null, failures: 0 });
  for (let i = 0; i < 5; i += 1) runLauncher(dir);
  check(readState(dir).version === "1.1.0", "a confirmed version survives repeated restarts");
  rmSync(dir, { recursive: true, force: true });
}

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("launcher ok");
