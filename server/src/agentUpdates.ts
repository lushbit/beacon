import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentManifestDto, AgentUpdateStateDto, UpdatePolicy } from "@beacon/shared";
import { isNewer } from "@beacon/shared";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { deviceSettings, getDeviceRow, listDeviceRows } from "./devices.js";
import { bus } from "./events.js";
import { agentFor } from "./hub/agents.js";
import { getServerSettings } from "./settings.js";
import { logger } from "./utils/log.js";

const log = logger("agent-updates");

/* --------------------------------------------------------------- manifest */

let cached: { manifest: AgentManifestDto | null; mtimeMs: number } = { manifest: null, mtimeMs: -1 };

/**
 * Describes the agent build this hub can hand out. Produced by the release
 * build; absent when running from a source checkout, in which case remote
 * updates are simply unavailable rather than broken.
 */
export function agentManifest(): AgentManifestDto | null {
  const file = path.join(config.publicDir, "manifest.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cached = { manifest: null, mtimeMs: -1 };
    return null;
  }

  if (cached.manifest && cached.mtimeMs === stat.mtimeMs) return cached.manifest;

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Omit<AgentManifestDto, "url">;
    const manifest: AgentManifestDto = { ...raw, url: `/download/${raw.filename}` };
    cached = { manifest, mtimeMs: stat.mtimeMs };
    return manifest;
  } catch (error) {
    log.warn(`could not read the agent manifest: ${error instanceof Error ? error.message : String(error)}`);
    cached = { manifest: null, mtimeMs: stat.mtimeMs };
    return null;
  }
}

/** Recomputed from disk so a tampered file cannot be served as trusted. */
export function verifyBundle(filename: string): boolean {
  const manifest = agentManifest();
  if (!manifest || manifest.filename !== filename) return false;
  try {
    const bytes = fs.readFileSync(path.join(config.publicDir, filename));
    return createHash("sha256").update(bytes).digest("hex") === manifest.sha256;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ state */

const IDLE: AgentUpdateStateDto = {
  state: "idle",
  targetVersion: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

const states = new Map<string, AgentUpdateStateDto>();

export function updateStateFor(deviceId: string): AgentUpdateStateDto {
  return states.get(deviceId) ?? IDLE;
}

function setState(deviceId: string, patch: Partial<AgentUpdateStateDto>): void {
  const next = { ...updateStateFor(deviceId), ...patch };
  states.set(deviceId, next);
  bus.emit("agent_update", { deviceId, state: next });
}

export function agentNeedsUpdate(agentVersion: string | null | undefined): boolean {
  const manifest = agentManifest();
  if (!manifest || !agentVersion) return false;
  return isNewer(manifest.version, agentVersion);
}

/* ---------------------------------------------------------------- actions */

export class UpdateNotPossible extends Error {}

/**
 * Asks one agent to replace itself. The agent replies before exiting, so a
 * successful call means "accepted", not "finished" — completion is observed
 * when it reconnects reporting the new version.
 */
export async function requestAgentUpdate(deviceId: string, actor: string): Promise<AgentUpdateStateDto> {
  const manifest = agentManifest();
  if (!manifest) throw new UpdateNotPossible("This hub has no agent build to hand out.");

  const row = getDeviceRow(deviceId);
  if (!row) throw new UpdateNotPossible("Unknown device.");

  const connection = agentFor(deviceId);
  if (!connection) throw new UpdateNotPossible("Device is offline.");

  const current = updateStateFor(deviceId);
  if (current.state === "requested" || current.state === "downloading" || current.state === "restarting") {
    return current;
  }

  setState(deviceId, {
    state: "requested",
    targetVersion: manifest.version,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
  });

  try {
    setState(deviceId, { state: "downloading" });
    // The agent downloads and verifies before answering, so this waits far
    // longer than a normal call.
    await connection.call(
      "agent_update",
      { version: manifest.version, path: manifest.url, sha256: manifest.sha256 },
      10 * 60_000
    );
    setState(deviceId, { state: "restarting" });
    audit({ actor, action: "agent.update.requested", target: deviceId, detail: manifest.version });
    log.info(`update to ${manifest.version} accepted by ${row.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState(deviceId, { state: "failed", finishedAt: Date.now(), error: message });
    audit({ actor, action: "agent.update.failed", target: deviceId, detail: message });
    log.warn(`update of ${row.name} failed: ${message}`);
    throw new UpdateNotPossible(message);
  }

  return updateStateFor(deviceId);
}

/** Called when an agent completes a handshake, so we can close the loop. */
export function noteAgentConnected(deviceId: string, agentVersion: string): void {
  const state = updateStateFor(deviceId);

  if (state.state === "restarting" || state.state === "requested" || state.state === "downloading") {
    if (state.targetVersion && !isNewer(state.targetVersion, agentVersion)) {
      setState(deviceId, { state: "confirmed", finishedAt: Date.now(), error: null });
      audit({ actor: "hub", action: "agent.update.confirmed", target: deviceId, detail: agentVersion });
      log.info(`device ${deviceId} confirmed on ${agentVersion}`);
    } else {
      setState(deviceId, {
        state: "failed",
        finishedAt: Date.now(),
        error: `Reconnected still running ${agentVersion}.`,
      });
    }
    return;
  }

  if (policyFor(deviceId) === "connect" && agentNeedsUpdate(agentVersion)) {
    // Fire and forget: the device is already talking to us, and a failure here
    // must not interfere with the connection it just made.
    void requestAgentUpdate(deviceId, "schedule:connect").catch(() => undefined);
  }
}

export function policyFor(deviceId: string): UpdatePolicy {
  const row = getDeviceRow(deviceId);
  const server = getServerSettings();
  if (!row) return server.defaultUpdatePolicy;
  return deviceSettings(row).updatePolicy ?? server.defaultUpdatePolicy;
}

/** Local hour on the device, so a nightly window means night where it is. */
function deviceHour(timezone: string | null): number {
  if (!timezone) return new Date().getHours();
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: timezone }).format(
      new Date()
    );
    return Number.parseInt(formatted, 10);
  } catch {
    return new Date().getHours();
  }
}

function inWindow(hour: number, start: number, end: number): boolean {
  // A window may wrap past midnight (22 -> 04).
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

const MAX_CONCURRENT = 3;

/** Runs on a timer; updates devices whose window is open, a few at a time. */
export function sweepScheduledUpdates(): void {
  const manifest = agentManifest();
  if (!manifest) return;

  const server = getServerSettings();
  const inFlight = [...states.values()].filter(
    (state) => state.state === "requested" || state.state === "downloading" || state.state === "restarting"
  ).length;
  let budget = MAX_CONCURRENT - inFlight;
  if (budget <= 0) return;

  for (const row of listDeviceRows()) {
    if (budget <= 0) return;
    if (policyFor(row.id) !== "window") continue;
    if (!agentFor(row.id)) continue;

    const info = row.static_info ? (JSON.parse(row.static_info) as { agentVersion?: string; timezone?: string }) : null;
    const version = info?.agentVersion ?? null;
    if (!agentNeedsUpdate(version)) continue;

    const state = updateStateFor(row.id);
    // Do not retry a failed update in a loop; a person should look at it.
    if (state.state === "failed" && state.targetVersion === manifest.version) continue;
    if (state.state !== "idle" && state.state !== "confirmed") continue;
    if (state.state === "confirmed" && state.targetVersion === manifest.version) continue;

    if (!inWindow(deviceHour(info?.timezone ?? null), server.updateWindowStartHour, server.updateWindowEndHour)) {
      continue;
    }

    budget -= 1;
    void requestAgentUpdate(row.id, "schedule:window").catch(() => undefined);
  }
}
