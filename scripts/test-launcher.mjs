#!/usr/bin/env node
/**
 * Tests the agent launcher's version selection and rollback, which is the
 * safety net that stops a bad agent build from taking a machine off the
 * dashboard permanently.
 */
import { execFileSync, spawn } from "node:child_process";
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

/* ------------------------------------------------------------- supervising */

// On Windows the launcher stays running and starts the agent as a child, since
// Task Scheduler never restarts a program that exits. BEACON_LAUNCHER_SUPERVISE
// turns that mode on here.

/** Writes a fake agent version that records its pid in runs.log, then runs `rest`. */
function writeVersion(dir, version, rest) {
  const distDir = join(dir, "versions", version, "agent", "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(distDir, "index.js"),
    [
      `const fs = require("node:fs");`,
      `const path = require("node:path");`,
      `const installDir = process.env.BEACON_INSTALL_DIR;`,
      `const setState = (state) => fs.writeFileSync(path.join(installDir, "current.json"), JSON.stringify(state));`,
      `fs.appendFileSync(path.join(installDir, "runs.log"), "${version} " + process.pid + "\\n");`,
      rest,
    ].join("\n")
  );
}

const STAY_UP = "setInterval(() => {}, 1000);";

function runs(dir) {
  try {
    return readFileSync(join(dir, "runs.log"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [version, pid] = line.split(" ");
        return { version, pid: Number(pid) };
      });
  } catch {
    return [];
  }
}

function startSupervisor(dir) {
  return spawn(process.execPath, [join(dir, "launcher.mjs")], {
    env: { ...process.env, BEACON_LAUNCHER_SUPERVISE: "1" },
    stdio: "ignore",
  });
}

/**
 * Whether a process is still running. An exited orphan can linger as a zombie
 * in a container whose first process never reaps it, and that counts as gone.
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}

async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

/** Stops a supervisor and whatever it started, so a failed check leaves nothing running. */
function cleanUp(supervisor, dir) {
  supervisor.kill("SIGKILL");
  for (const run of runs(dir)) {
    if (!alive(run.pid)) continue;
    try {
      process.kill(run.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

// 5. An agent that exits after staging an update is started again on the new version.
{
  const dir = makeInstall([], { version: "1.0.0", previous: null, pendingSince: null, failures: 0 });
  writeVersion(
    dir,
    "1.0.0",
    `setState({ version: "1.1.0", previous: "1.0.0", pendingSince: Date.now(), failures: 0 });\nprocess.exit(0);`
  );
  writeVersion(
    dir,
    "1.1.0",
    `setState({ version: "1.1.0", previous: "1.0.0", pendingSince: null, failures: 0 });\n${STAY_UP}`
  );
  const supervisor = startSupervisor(dir);
  check(
    await waitFor(() => runs(dir).some((run) => run.version === "1.1.0"), 15_000),
    "restarts into the staged version when the agent exits after an update"
  );
  const agent = runs(dir).find((run) => run.version === "1.1.0");
  supervisor.kill("SIGTERM");
  check(Boolean(agent) && (await waitFor(() => !alive(agent.pid), 5_000)), "stopping the launcher stops the agent");
  cleanUp(supervisor, dir);
}

// 6. Killing the launcher outright, as ending the scheduled task does, takes the agent with it.
{
  const dir = makeInstall([], { version: "1.0.0", previous: null, pendingSince: null, failures: 0 });
  writeVersion(dir, "1.0.0", STAY_UP);
  const supervisor = startSupervisor(dir);
  await waitFor(() => runs(dir).length > 0, 15_000);
  const agent = runs(dir)[0];
  supervisor.kill("SIGKILL");
  check(Boolean(agent) && (await waitFor(() => !alive(agent.pid), 5_000)), "the agent stops when the launcher is killed");
  cleanUp(supervisor, dir);
}

// 7. Rollback still works when the launcher is the one restarting a crashing version.
{
  const dir = makeInstall([], { version: "1.1.0", previous: "1.0.0", pendingSince: Date.now(), failures: 0 });
  writeVersion(dir, "1.0.0", STAY_UP);
  writeVersion(dir, "1.1.0", "process.exit(1);");
  const supervisor = startSupervisor(dir);
  const rolledBack = await waitFor(() => runs(dir).some((run) => run.version === "1.0.0"), 30_000);
  check(rolledBack && readState(dir).version === "1.0.0", "rolls back a version that keeps crashing while supervised");
  check(runs(dir).filter((run) => run.version === "1.1.0").length === 2, "gives the crashing version two tries first");
  cleanUp(supervisor, dir);
}

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("launcher ok");
