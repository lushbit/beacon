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
 * On Windows the service manager is Task Scheduler, which never starts a task
 * again after its program exits. A self-update there left the device offline
 * until the next reboot. So on Windows this file supervises instead: it stays
 * running, starts the agent as a child process, and starts it again whenever it
 * exits, which is what picks up a freshly staged version.
 *
 * It also owns rollback. A freshly installed version is marked pending until it
 * connects to the hub and confirms itself. If it instead crashes on startup,
 * this counts the failures and reverts to the previous version, so a bad build
 * cannot take a machine off the dashboard permanently.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const launcherPath = fileURLToPath(import.meta.url);
const installDir = path.dirname(launcherPath);
const statePath = path.join(installDir, "current.json");
const logPath = path.join(installDir, "agent.log");

const FAILURES_BEFORE_ROLLBACK = 2;

/**
 * Set on the agent process a supervising launcher starts. Keep the name as it
 * is: after an update the running launcher starts whichever launcher.mjs is on
 * disk, so the two ends can come from different versions.
 */
const CHILD_ENV = "BEACON_LAUNCHER_CHILD";
const isChild = process.env[CHILD_ENV] === "1";
// BEACON_LAUNCHER_SUPERVISE lets the tests run the Windows mode anywhere.
const supervising = !isChild && (process.platform === "win32" || process.env.BEACON_LAUNCHER_SUPERVISE === "1");

/** An agent that ran at least this long exited normally rather than crashing on startup. */
const STEADY_RUN_MS = 30_000;
const MAX_RESTART_DELAY_MS = 60_000;

let logStream = null;

/**
 * Opens the log for appending, starting a fresh one once it passes 1 MB. Only
 * the process that starts the agent rotates, so the two processes of a
 * supervised install never pull the file out from under each other.
 */
function openLog(rotate) {
  try {
    if (rotate && fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      fs.rmSync(logPath, { force: true });
    }
  } catch {
    /* keep appending to the old file */
  }
  try {
    const next = fs.createWriteStream(logPath, { flags: "a" });
    next.on("error", () => {
      /* logging must never take the agent down */
    });
    logStream?.end();
    logStream = next;
  } catch {
    /* an unwritable install directory must not stop the agent */
  }
}

/**
 * A Windows service has nowhere to send stdout, so mirror both streams to a
 * file next to the install. Without this, a crash during startup is completely
 * invisible: the process exits, nothing appears in the dashboard, and there is
 * nothing anywhere to say why.
 */
function teeOutputToLog() {
  for (const name of ["stdout", "stderr"]) {
    const stream = process[name];
    const original = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
      try {
        logStream?.write(chunk);
      } catch {
        /* logging must never take the agent down */
      }
      return original(chunk, encoding, callback);
    };
  }
}

openLog(!isChild);
teeOutputToLog();

/**
 * Windows PowerShell writes JSON with a UTF-8 BOM, and `JSON.parse` rejects it.
 * Stripping it here is what keeps an agent installed by such a script from
 * dying on startup with an unreadable state file.
 */
function parseJson(text) {
  return JSON.parse(text.replace(/^﻿/, ""));
}

function readState() {
  try {
    return parseJson(fs.readFileSync(statePath, "utf8"));
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

/**
 * Keeps the agent running as a child process and starts it again whenever it
 * exits. An agent that keeps dying straight away is retried with a growing
 * pause, so a broken install does not spin.
 */
function supervise() {
  let child = null;
  let stopping = false;
  let quickExits = 0;

  const start = () => {
    const startedAt = Date.now();
    let gone = false;
    const current = spawn(process.execPath, [launcherPath, ...process.argv.slice(2)], {
      env: { ...process.env, [CHILD_ENV]: "1" },
      // The IPC channel is how the agent notices this process has gone.
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    child = current;

    const restart = (reason) => {
      if (gone) return;
      gone = true;
      child = null;
      if (stopping) process.exit(0);
      quickExits = Date.now() - startedAt < STEADY_RUN_MS ? quickExits + 1 : 0;
      const delay = Math.min(1000 * 2 ** quickExits, MAX_RESTART_DELAY_MS);
      log(`agent ${reason}, starting it again in ${Math.round(delay / 1000)}s`);
      setTimeout(() => {
        openLog(true);
        start();
      }, delay);
    };

    current.on("error", (error) => restart(`could not start (${error.message})`));
    current.on("exit", (code, signal) => restart(signal ? `was stopped by ${signal}` : `exited with code ${code}`));
  };

  const stop = () => {
    stopping = true;
    if (!child) process.exit(0);
    child.kill();
    // An agent that ignores the request must not keep this process alive.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  const signals = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
  for (const signal of signals) process.on(signal, stop);

  start();
}

/** Loads the version named in current.json into this process. */
async function runAgent() {
  if (isChild) {
    // The supervising launcher is gone, which means the task was stopped. The
    // channel must not keep the agent alive by itself, only report that.
    process.channel?.unref();
    process.on("disconnect", () => process.exit(0));
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
}

if (supervising) supervise();
else await runAgent();
