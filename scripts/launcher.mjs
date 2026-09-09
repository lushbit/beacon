#!/usr/bin/env node
/**
 * Stable entry point for an installed Beacon agent.
 *
 * The service manager always runs this file. It reads `current.json` and loads
 * that version from `versions/<version>/`, which is what makes a self-update
 * possible: the agent unpacks a new version, points `current.json` at it and
 * exits, and the service manager restarts into the new code without the service
 * definition ever changing.
 *
 * It also owns rollback. A freshly installed version is marked pending until it
 * connects to the hub and confirms itself. If it instead crashes on startup,
 * this counts the failures and reverts to the previous version, so a bad build
 * cannot take a machine off the dashboard permanently.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const installDir = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(installDir, "current.json");

const FAILURES_BEFORE_ROLLBACK = 2;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  const temp = `${statePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, statePath);
}

function log(message) {
  process.stdout.write(`${new Date().toISOString()} [launcher] ${message}\n`);
}

let state = readState();
if (!state?.version) {
  process.stderr.write(`No usable current.json in ${installDir}. Reinstall the agent.\n`);
  process.exit(1);
}

if (state.pendingSince) {
  const failures = (state.failures ?? 0) + 1;
  if (failures > FAILURES_BEFORE_ROLLBACK && state.previous) {
    log(`version ${state.version} failed to start ${failures - 1} times — reverting to ${state.previous}`);
    state = { version: state.previous, previous: null, pendingSince: null, failures: 0 };
  } else {
    state = { ...state, failures };
  }
  writeState(state);
}

const entry = path.join(installDir, "versions", state.version, "agent", "dist", "index.js");
if (!fs.existsSync(entry)) {
  if (state.previous) {
    log(`version ${state.version} is missing on disk — reverting to ${state.previous}`);
    writeState({ version: state.previous, previous: null, pendingSince: null, failures: 0 });
    process.exit(1); // the service manager restarts us into the previous version
  }
  process.stderr.write(`Agent build ${state.version} is missing. Reinstall the agent.\n`);
  process.exit(1);
}

// The agent uses these to find its own installation when self-updating.
process.env.BEACON_INSTALL_DIR = installDir;
process.env.BEACON_RUNNING_VERSION = state.version;

await import(pathToFileURL(entry).href);
