import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentUpdateParams } from "@beacon/shared";
import { parseJsonFile } from "./config.js";

const run = promisify(execFile);

export interface InstallLayout {
  installDir: string;
  statePath: string;
  version: string;
}

interface CurrentState {
  version: string;
  previous?: string | null;
  pendingSince?: number | null;
  failures?: number;
}

/**
 * Self-update only works for a managed installation — one laid out by the
 * installer, with a launcher and a `versions/` directory. A source checkout or
 * a hand-copied agent has nothing to swap, and says so rather than half-trying.
 */
export function detectLayout(): InstallLayout | null {
  const installDir = process.env.BEACON_INSTALL_DIR;
  const version = process.env.BEACON_RUNNING_VERSION;
  if (!installDir || !version) return null;

  const statePath = path.join(installDir, "current.json");
  if (!fs.existsSync(statePath)) return null;
  return { installDir, statePath, version };
}

function readState(layout: InstallLayout): CurrentState {
  // The installer's state file can carry a UTF-8 BOM on Windows.
  return parseJsonFile<CurrentState>(fs.readFileSync(layout.statePath, "utf8"));
}

function writeState(layout: InstallLayout, state: CurrentState): void {
  const temp = `${layout.statePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, layout.statePath);
}

/**
 * Called once the agent is talking to the hub again. Clearing the pending flag
 * is what stops the launcher from rolling this version back.
 */
export function confirmRunningVersion(): void {
  const layout = detectLayout();
  if (!layout) return;
  try {
    const state = readState(layout);
    if (!state.pendingSince && !state.failures) return;
    writeState(layout, { version: state.version, previous: state.previous ?? null, pendingSince: null, failures: 0 });
  } catch {
    /* a broken state file is the launcher's problem, not ours */
  }
}

/**
 * Downloads over http/https directly rather than through `fetch`, because
 * `fetch` offers no per-request certificate switch. A hub with a self-signed
 * certificate is reachable over the agent's websocket but used to fail here at
 * certificate validation, which left those installs unable to update at all.
 */
function download(url: string, target: string, insecureTls: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = (current: string, redirectsLeft: number): void => {
      const parsed = new URL(current);
      const client = parsed.protocol === "https:" ? https : http;
      const request = client.get(
        current,
        {
          // Only meaningful over https, ignored otherwise.
          rejectUnauthorized: !insecureTls,
          headers: { "User-Agent": "beacon-agent" },
          timeout: 180_000,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location && redirectsLeft > 0) {
            response.resume();
            get(new URL(response.headers.location, current).toString(), redirectsLeft - 1);
            return;
          }
          if (status !== 200) {
            response.resume();
            reject(new Error(`download failed with HTTP ${status}`));
            return;
          }
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () => {
            const bytes = Buffer.concat(chunks);
            if (bytes.length === 0) {
              reject(new Error("the downloaded bundle was empty"));
              return;
            }
            try {
              fs.writeFileSync(target, bytes);
              resolve();
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        }
      );
      request.on("error", reject);
      request.on("timeout", () => request.destroy(new Error("the download timed out")));
    };

    get(url, 3);
  });
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export interface ApplyUpdateOptions extends AgentUpdateParams {
  /** The hub URL from the agent's own configuration. */
  hubUrl: string;
  insecureTls: boolean;
}

/**
 * Downloads, verifies and stages a new version, then points the launcher at it.
 * The caller exits afterwards; the service manager starts the new version.
 */
export async function applyUpdate(options: ApplyUpdateOptions): Promise<void> {
  const layout = detectLayout();
  if (!layout) {
    throw new Error(
      "This agent was not installed by the Beacon installer, so it cannot update itself. Re-run the install command."
    );
  }
  if (options.version === layout.version) throw new Error(`Already running ${options.version}.`);

  const target = path.join(layout.installDir, "versions", options.version);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-update-"));
  const archive = path.join(staging, "agent.tar.gz");

  try {
    const url = new URL(options.path, options.hubUrl).toString();
    await download(url, archive, options.insecureTls);

    const actual = sha256(archive);
    if (actual !== options.sha256) {
      // The expected hash arrived over the authenticated hub socket, so this
      // catches a tampered or truncated download even without trusted TLS.
      throw new Error(`checksum mismatch: expected ${options.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…`);
    }

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    // Windows cannot create symlinks without an elevated process, and tar gives
    // up on the archive at the first one. Current bundles contain none; these
    // are where older ones kept theirs, and the agent needs neither.
    const excludes =
      process.platform === "win32"
        ? ["--exclude", "node_modules/.bin/*", "--exclude", "node_modules/@beacon/agent"]
        : [];
    await run("tar", ["-xzf", archive, "-C", target, ...excludes]);

    const entry = path.join(target, "agent", "dist", "index.js");
    if (!fs.existsSync(entry)) throw new Error("the downloaded bundle is missing the agent");

    // Keep the launcher current; it is designed to stay compatible both ways.
    const launcher = path.join(target, "launcher.mjs");
    if (fs.existsSync(launcher)) fs.copyFileSync(launcher, path.join(layout.installDir, "launcher.mjs"));

    writeState(layout, {
      version: options.version,
      previous: layout.version,
      pendingSince: Date.now(),
      failures: 0,
    });

    pruneOldVersions(layout, options.version);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Keeps the running version and the one before it, so rollback stays possible. */
function pruneOldVersions(layout: InstallLayout, keepVersion: string): void {
  const dir = path.join(layout.installDir, "versions");
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === keepVersion || entry === layout.version) continue;
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  } catch {
    /* leaving an old version behind is harmless */
  }
}
