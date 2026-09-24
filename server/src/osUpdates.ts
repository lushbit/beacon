import type {
  OsUpdateInventory,
  OsUpdateJobDto,
  OsUpdateJobKind,
  OsUpdateJobSnapshot,
  OsUpdateStatusResult,
  OsUpdateSummaryDto,
  OsUpdatesDto,
} from "@beacon/shared";
import { formatLogLine } from "@beacon/shared";
import { updateStateFor } from "./agentUpdates.js";
import { audit } from "./audit.js";
import { db, parseJson } from "./db/index.js";
import { deviceCapabilities, deviceSettings, getDeviceRow } from "./devices.js";
import { bus } from "./events.js";
import { agentFor, isOnline } from "./hub/agents.js";
import { newId } from "./utils/ids.js";
import { logger } from "./utils/log.js";

const log = logger("os-updates");

/** The hub keeps this many lines of a job's log, which covers the longest run seen. */
const MAX_LOG_LINES = 5000;

interface JobRow {
  id: string;
  device_id: string;
  kind: string;
  state: string;
  phase: string;
  progress: number | null;
  current_item: string | null;
  step_done: number | null;
  step_total: number | null;
  cancellable: number;
  reboot_required: number;
  reboot_after: number;
  requested: string | null;
  results: string;
  error: string | null;
  actor: string;
  started_at: number;
  finished_at: number | null;
  updated_at: number;
  log_lines: number;
}

const JOB_COLUMNS = `id, device_id, kind, state, phase, progress, current_item, step_done, step_total, cancellable,
  reboot_required, reboot_after, requested, results, error, actor, started_at, finished_at, updated_at, log_lines`;

function toDto(row: JobRow): OsUpdateJobDto {
  return {
    id: row.id,
    deviceId: row.device_id,
    kind: row.kind as OsUpdateJobDto["kind"],
    state: row.state as OsUpdateJobDto["state"],
    phase: row.phase as OsUpdateJobDto["phase"],
    progress: row.progress,
    current: row.current_item,
    stepDone: row.step_done,
    stepTotal: row.step_total,
    cancellable: row.cancellable === 1,
    rebootRequired: row.reboot_required === 1,
    rebootAfter: row.reboot_after === 1,
    requested: parseJson<string[] | null>(row.requested, null),
    results: parseJson(row.results, []),
    error: row.error,
    actor: row.actor,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    logLines: row.log_lines,
  };
}

function jobRow(deviceId: string, jobId: string): JobRow | null {
  return (
    (db
      .prepare(`SELECT ${JOB_COLUMNS} FROM os_update_jobs WHERE id = ? AND device_id = ?`)
      .get(jobId, deviceId) as JobRow | undefined) ?? null
  );
}

export function activeJob(deviceId: string): OsUpdateJobDto | null {
  const row = db
    .prepare(
      `SELECT ${JOB_COLUMNS} FROM os_update_jobs WHERE device_id = ? AND state = 'running' ORDER BY started_at DESC LIMIT 1`
    )
    .get(deviceId) as JobRow | undefined;
  return row ? toDto(row) : null;
}

export function jobWithLog(deviceId: string, jobId: string): (OsUpdateJobDto & { log: string[] }) | null {
  const row = jobRow(deviceId, jobId);
  if (!row) return null;
  const text = (db.prepare("SELECT log FROM os_update_jobs WHERE id = ?").get(jobId) as { log: string }).log;
  return { ...toDto(row), log: text ? text.split("\n") : [] };
}

export function inventoryFor(deviceId: string): OsUpdateInventory | null {
  const row = db.prepare("SELECT data FROM os_update_inventory WHERE device_id = ?").get(deviceId) as
    | { data: string }
    | undefined;
  return row ? parseJson<OsUpdateInventory | null>(row.data, null) : null;
}

export function summaryFor(deviceId: string): OsUpdateSummaryDto | null {
  const inventory = inventoryFor(deviceId);
  const running = activeJob(deviceId) !== null;
  if (!inventory?.supported && !running) return null;
  return {
    // Optional updates are not waiting on anyone, the same as in Settings.
    pending: inventory?.items.filter((entry) => !entry.optional).length ?? 0,
    security: inventory?.items.filter((entry) => entry.security && !entry.optional).length ?? 0,
    rebootRequired: inventory?.rebootRequired ?? false,
    checkedAt: inventory?.checkedAt ?? null,
    running,
  };
}

export function osUpdatesFor(deviceId: string): OsUpdatesDto {
  const row = getDeviceRow(deviceId);
  const history = db
    .prepare(`SELECT ${JOB_COLUMNS} FROM os_update_jobs WHERE device_id = ? ORDER BY started_at DESC LIMIT 30`)
    .all(deviceId) as JobRow[];
  return {
    inventory: inventoryFor(deviceId),
    active: activeJob(deviceId),
    history: history.map(toDto),
    agentSupports: row ? deviceCapabilities(row).osUpdates === true : false,
    allowed: row ? deviceSettings(row).allowOsUpdates : false,
  };
}

function storeInventory(deviceId: string, inventory: OsUpdateInventory): void {
  db.prepare(
    `INSERT INTO os_update_inventory (device_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(deviceId, JSON.stringify(inventory), Date.now());
}

/** A new inventory from a check nobody watched. */
export function noteInventory(deviceId: string, inventory: OsUpdateInventory): void {
  storeInventory(deviceId, inventory);
  bus.emit("os_update", { deviceId, job: null, log: [], inventory });
}

function appendLog(jobId: string, lines: string[]): void {
  if (lines.length === 0) return;
  const clean = lines.map((line) => line.replace(/\n/g, " ").slice(0, 2000));
  const row = db.prepare("SELECT log_lines FROM os_update_jobs WHERE id = ?").get(jobId) as
    | { log_lines: number }
    | undefined;
  if (!row) return;
  db.prepare(
    `UPDATE os_update_jobs
        SET log = CASE WHEN log = '' THEN ? ELSE log || char(10) || ? END,
            log_lines = log_lines + ?
      WHERE id = ?`
  ).run(clean.join("\n"), clean.join("\n"), clean.length, jobId);

  // Trimmed in steps rather than on every event, so a long run does not
  // rewrite its whole log a few times a second.
  if (row.log_lines + clean.length > MAX_LOG_LINES + 500) {
    const text = (db.prepare("SELECT log FROM os_update_jobs WHERE id = ?").get(jobId) as { log: string }).log;
    const kept = text.split("\n").slice(-MAX_LOG_LINES);
    db.prepare("UPDATE os_update_jobs SET log = ?, log_lines = ? WHERE id = ?").run(
      [formatLogLine("WARN", "Earlier lines were trimmed"), ...kept].join("\n"),
      kept.length + 1,
      jobId
    );
  }
}

function replaceLog(jobId: string, lines: string[]): void {
  const kept = lines.slice(-MAX_LOG_LINES);
  db.prepare("UPDATE os_update_jobs SET log = ?, log_lines = ? WHERE id = ?").run(kept.join("\n"), kept.length, jobId);
}

function saveSnapshot(jobId: string, job: OsUpdateJobSnapshot): void {
  db.prepare(
    `UPDATE os_update_jobs
        SET state = ?, phase = ?, progress = ?, current_item = ?, step_done = ?, step_total = ?,
            cancellable = ?, reboot_required = ?, results = ?, error = ?, finished_at = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    job.state,
    job.phase,
    job.progress,
    job.current,
    job.stepDone,
    job.stepTotal,
    job.cancellable ? 1 : 0,
    job.rebootRequired ? 1 : 0,
    JSON.stringify(job.results.slice(0, 2000)),
    job.error,
    job.finishedAt,
    Date.now(),
    jobId
  );
}

/** Closes a job from the hub's side, for outcomes the agent cannot report itself. */
function closeJob(
  deviceId: string,
  jobId: string,
  state: OsUpdateJobDto["state"],
  message: string,
  error: string | null
): void {
  const row = jobRow(deviceId, jobId);
  if (!row || row.state !== "running") return;
  const job = toDto(row);
  saveSnapshot(jobId, {
    ...job,
    state,
    phase: "done",
    cancellable: false,
    current: null,
    progress: state === "succeeded" ? 100 : job.progress,
    error,
    finishedAt: Date.now(),
  });
  const line = formatLogLine(state === "succeeded" ? "INFO" : state === "failed" ? "ERROR" : "WARN", message);
  appendLog(jobId, [line]);
  bus.emit("os_update", { deviceId, job: toDto(jobRow(deviceId, jobId)!), log: [line] });
}

/* ------------------------------------------------------------------ actions */

export class OsUpdateNotPossible extends Error {}

const AGENT_METHOD: Record<OsUpdateJobKind, "os_updates_check" | "os_updates_install" | "os_reboot"> = {
  check: "os_updates_check",
  install: "os_updates_install",
  reboot: "os_reboot",
};

export async function startOsJob(
  deviceId: string,
  kind: OsUpdateJobKind,
  actor: string,
  options: { ids?: string[] | null; rebootAfter?: boolean } = {}
): Promise<OsUpdateJobDto> {
  const row = getDeviceRow(deviceId);
  if (!row) throw new OsUpdateNotPossible("Unknown device.");
  const connection = agentFor(deviceId);
  if (!connection) throw new OsUpdateNotPossible("The device is offline.");
  if (deviceCapabilities(row).osUpdates !== true) {
    throw new OsUpdateNotPossible("Update the Beacon agent on this device to 1.3.0 or later to manage its updates.");
  }
  const known = inventoryFor(deviceId);
  if (known && !known.supported) throw new OsUpdateNotPossible(known.reason ?? "Updates are not supported on this device.");
  if (kind !== "check" && !deviceSettings(row).allowOsUpdates) {
    throw new OsUpdateNotPossible("Installing updates and restarting are turned off in this device's settings.");
  }
  if (activeJob(deviceId)) throw new OsUpdateNotPossible("Something is already running on this device.");
  const agentUpdate = updateStateFor(deviceId).state;
  if (agentUpdate === "requested" || agentUpdate === "downloading" || agentUpdate === "restarting") {
    throw new OsUpdateNotPossible("The Beacon agent is updating itself. Try again once it is back.");
  }

  const id = newId();
  const now = Date.now();
  const ids = options.ids && options.ids.length > 0 ? options.ids.slice(0, 2000) : null;
  db.prepare(
    `INSERT INTO os_update_jobs
       (id, device_id, kind, state, phase, cancellable, reboot_after, requested, actor, started_at, updated_at)
     VALUES (?, ?, ?, 'running', 'starting', 0, ?, ?, ?, ?, ?)`
  ).run(id, deviceId, kind, options.rebootAfter ? 1 : 0, ids ? JSON.stringify(ids) : null, actor, now, now);
  bus.emit("os_update", { deviceId, job: toDto(jobRow(deviceId, id)!), log: [] });

  try {
    await connection.call(AGENT_METHOD[kind], {
      jobId: id,
      ...(kind === "install" ? { ids, rebootAfter: options.rebootAfter === true } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    closeJob(deviceId, id, "failed", `The device refused: ${message}`, message);
    throw new OsUpdateNotPossible(message);
  }

  audit({
    actor,
    action: `device.os.${kind}`,
    target: deviceId,
    detail: kind === "install" ? (ids ? `${ids.length} selected` : "all") : null,
  });
  log.info(`${kind} started on ${row.name} by ${actor}`);
  return toDto(jobRow(deviceId, id)!);
}

export async function cancelOsJob(deviceId: string, jobId: string, actor: string): Promise<void> {
  const row = jobRow(deviceId, jobId);
  if (!row || row.state !== "running") throw new OsUpdateNotPossible("That job is not running.");
  const connection = agentFor(deviceId);
  if (!connection) throw new OsUpdateNotPossible("The device is offline.");
  try {
    await connection.call("os_updates_cancel", { jobId });
  } catch (error) {
    throw new OsUpdateNotPossible(error instanceof Error ? error.message : String(error));
  }
  audit({ actor, action: "device.os.cancel", target: deviceId, detail: jobId });
}

/* ------------------------------------------------------------ from the agent */

export function applyAgentEvent(
  deviceId: string,
  snapshot: OsUpdateJobSnapshot,
  lines: string[],
  inventory?: OsUpdateInventory
): void {
  if (!jobRow(deviceId, snapshot.id)) {
    // A job the hub has no row for, such as one started before its database
    // was replaced. It is still this device's work, so it is recorded.
    db.prepare(
      `INSERT INTO os_update_jobs (id, device_id, kind, state, phase, actor, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'device', ?, ?)`
    ).run(snapshot.id, deviceId, snapshot.kind, snapshot.state, snapshot.phase, snapshot.startedAt, Date.now());
  }
  saveSnapshot(snapshot.id, snapshot);
  appendLog(snapshot.id, lines);
  if (inventory) storeInventory(deviceId, inventory);
  bus.emit("os_update", {
    deviceId,
    job: toDto(jobRow(deviceId, snapshot.id)!),
    log: lines,
    ...(inventory ? { inventory } : {}),
  });
}

/**
 * Called on every handshake. A device that was restarting is back, which is
 * the success the restart was waiting for. Anything else that was running is
 * asked about, because the agent knows whether it is still going.
 */
export async function onAgentConnected(deviceId: string): Promise<void> {
  const row = getDeviceRow(deviceId);
  if (!row || deviceCapabilities(row).osUpdates !== true) return;
  const connection = agentFor(deviceId);
  if (!connection) return;

  const active = activeJob(deviceId);
  if (active?.phase === "rebooting") {
    // The last word from the agent was that it was restarting.
    const since = jobRow(deviceId, active.id)?.updated_at ?? active.startedAt;
    const seconds = Math.max(1, Math.round((Date.now() - since) / 1000));
    closeJob(deviceId, active.id, "succeeded", `Device back online ${seconds}s after the restart`, null);
    const inventory = inventoryFor(deviceId);
    if (inventory) noteInventory(deviceId, { ...inventory, rebootRequired: false });
    // A fresh list shows what the restart finished off.
    setTimeout(() => {
      void startOsJob(deviceId, "check", "after restart").catch(() => undefined);
    }, 20_000).unref();
    return;
  }

  let status: OsUpdateStatusResult;
  try {
    status = (await connection.call("os_updates_status")) as OsUpdateStatusResult;
  } catch {
    return;
  }
  if (status.inventory) storeInventory(deviceId, status.inventory);

  if (active) {
    if (status.job && status.job.id === active.id) {
      saveSnapshot(active.id, status.job);
      replaceLog(active.id, status.log);
      bus.emit("os_update", {
        deviceId,
        job: toDto(jobRow(deviceId, active.id)!),
        log: [],
        inventory: status.inventory,
      });
      return;
    }
    closeJob(
      deviceId,
      active.id,
      "interrupted",
      "The agent restarted during the job, so its outcome is unknown",
      "The agent restarted part way through."
    );
  }
  if (status.inventory) bus.emit("os_update", { deviceId, job: null, log: [], inventory: status.inventory });
}

export function onAgentDisconnected(deviceId: string): void {
  const active = activeJob(deviceId);
  if (!active || active.phase === "rebooting") return;
  const line = formatLogLine("WARN", "Lost contact with the device, waiting for it to come back");
  appendLog(active.id, [line]);
  bus.emit("os_update", { deviceId, job: active, log: [line] });
}

/** Gives up on jobs whose device went quiet and stayed away. */
export function sweepOsJobs(): void {
  const stale = db
    .prepare(`SELECT ${JOB_COLUMNS} FROM os_update_jobs WHERE state = 'running' AND updated_at < ?`)
    .all(Date.now() - 30 * 60_000) as JobRow[];
  for (const row of stale) {
    // A long install on a device that is still connected is left alone.
    if (isOnline(row.device_id)) continue;
    closeJob(
      row.device_id,
      row.id,
      "interrupted",
      row.phase === "rebooting"
        ? "The device did not come back within 30 minutes of restarting"
        : "The device has been offline for 30 minutes, so the outcome is unknown",
      row.phase === "rebooting" ? "The device did not come back after restarting." : "Lost contact with the device."
    );
  }
}
