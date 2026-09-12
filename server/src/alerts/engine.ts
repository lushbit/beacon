import type { AlertDto, AlertMetric, MetricSample, MetricSummary } from "@beacon/shared";
import { db } from "../db/index.js";
import { bus } from "../events.js";
import { deviceSettings, getDeviceRow, listDeviceRows } from "../devices.js";
import { firingMessage, resolvedMessage } from "./messages.js";
import { newId } from "../utils/ids.js";
import { logger } from "../utils/log.js";
import { dispatchAlert } from "./notify.js";
import { getAlert, rulesForDevice, toAlertDto, type AlertRow, type AlertRuleRow } from "./repo.js";

const log = logger("alerts");

interface RuntimeRow {
  rule_id: string;
  device_id: string;
  breach_since: number | null;
  last_fired_at: number | null;
  alert_id: string | null;
}

function runtime(ruleId: string, deviceId: string): RuntimeRow {
  const row = db
    .prepare("SELECT * FROM rule_runtime WHERE rule_id = ? AND device_id = ?")
    .get(ruleId, deviceId) as RuntimeRow | undefined;
  return row ?? { rule_id: ruleId, device_id: deviceId, breach_since: null, last_fired_at: null, alert_id: null };
}

function saveRuntime(row: RuntimeRow): void {
  db.prepare(
    `INSERT INTO rule_runtime (rule_id, device_id, breach_since, last_fired_at, alert_id)
     VALUES (@rule_id, @device_id, @breach_since, @last_fired_at, @alert_id)
     ON CONFLICT(rule_id, device_id) DO UPDATE SET
       breach_since = excluded.breach_since,
       last_fired_at = excluded.last_fired_at,
       alert_id = excluded.alert_id`
  ).run(row);
}

function breached(operator: string, value: number, threshold: number): boolean {
  return operator === "lt" ? value < threshold : value > threshold;
}

function fire(rule: AlertRuleRow, deviceId: string, deviceName: string, value: number | null, at: number): AlertRow {
  const id = newId();
  const message = firingMessage(rule.metric, deviceName, rule.operator, value, rule.threshold);
  db.prepare(
    `INSERT INTO alerts (id, rule_id, rule_name, device_id, metric, severity, state, value, threshold, message, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'firing', ?, ?, ?, ?)`
  ).run(id, rule.id, rule.name, deviceId, rule.metric, rule.severity, value, rule.threshold, message, at);
  const row = getAlert(id)!;
  const dto = toAlertDto(row, deviceName);
  log.info(`firing: ${message}`);
  bus.emit("alert", dto);
  dispatchAlert(dto);
  return row;
}

function resolve(alertId: string, deviceName: string, value: number | null, at: number): void {
  const existing = getAlert(alertId);
  if (!existing || existing.state === "resolved") return;
  const message = resolvedMessage(existing.metric, deviceName, value);
  db.prepare("UPDATE alerts SET state = 'resolved', resolved_at = ?, value = ?, message = ? WHERE id = ?").run(
    at,
    value,
    message,
    alertId
  );
  const row = getAlert(alertId);
  if (!row) return;
  const dto: AlertDto = toAlertDto(row, deviceName);
  log.info(`resolved: ${message}`);
  bus.emit("alert", dto);
  dispatchAlert(dto);
}

function readMetric(summary: MetricSummary, metric: AlertMetric): number | null {
  if (metric === "offline") return null;
  const value = summary[metric as keyof MetricSummary];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Called for every sample the hub ingests. */
export function evaluateSample(deviceId: string, deviceName: string, sample: MetricSample): void {
  for (const rule of rulesForDevice(deviceId)) {
    if (rule.metric === "offline") continue;
    const value = readMetric(sample.summary, rule.metric);
    if (value === null) continue;
    step(rule, deviceId, deviceName, value, sample.ts);
  }
}

function step(rule: AlertRuleRow, deviceId: string, deviceName: string, value: number, at: number): void {
  const state = runtime(rule.id, deviceId);
  const isBreach = breached(rule.operator, value, rule.threshold);

  if (!isBreach) {
    if (state.alert_id) resolve(state.alert_id, deviceName, value, at);
    if (state.breach_since !== null || state.alert_id !== null) {
      saveRuntime({ ...state, breach_since: null, alert_id: null });
    }
    return;
  }

  const since = state.breach_since ?? at;
  const sustained = at - since >= rule.duration_sec * 1000;
  const cooledDown = state.last_fired_at === null || at - state.last_fired_at >= rule.cooldown_sec * 1000;

  if (state.alert_id) {
    // Already firing — keep the newest reading on the alert.
    db.prepare("UPDATE alerts SET value = ? WHERE id = ?").run(value, state.alert_id);
    saveRuntime({ ...state, breach_since: since });
    return;
  }

  if (sustained && cooledDown) {
    const alert = fire(rule, deviceId, deviceName, value, at);
    saveRuntime({ ...state, breach_since: since, last_fired_at: at, alert_id: alert.id });
    return;
  }

  saveRuntime({ ...state, breach_since: since });
}

/**
 * Offline rules cannot be driven by incoming samples — by definition there are
 * none — so they are swept on a timer instead.
 */
export function sweepOfflineRules(onlineDeviceIds: Set<string>): void {
  const now = Date.now();
  for (const device of listDeviceRows()) {
    const rules = rulesForDevice(device.id).filter((rule) => rule.metric === "offline");
    if (rules.length === 0) continue;
    const online = onlineDeviceIds.has(device.id);
    const lastSeen = device.last_seen_at;
    const offlineSec = online || lastSeen === null ? 0 : (now - lastSeen) / 1000;
    for (const rule of rules) {
      if (lastSeen === null) continue; // never enrolled properly; nothing to alert on yet
      step(rule, device.id, device.name, offlineSec, now);
    }
  }
}

/** Default rules seeded for a new device so it is useful out of the box. */
export function seedDefaultRules(deviceId: string, deviceName: string): void {
  const settings = deviceSettings(getDeviceRow(deviceId)!);
  const defaults = [
    { name: "High CPU", metric: "cpuPct" as const, threshold: 90, durationSec: 300, severity: "warning" as const },
    { name: "High memory", metric: "memPct" as const, threshold: 90, durationSec: 300, severity: "warning" as const },
    { name: "Disk almost full", metric: "diskMaxPct" as const, threshold: 90, durationSec: 60, severity: "critical" as const },
    {
      name: "Device offline",
      metric: "offline" as const,
      threshold: Math.max(60, settings.offlineAfterSec * 2),
      durationSec: 0,
      severity: "critical" as const,
    },
  ];
  const stmt = db.prepare(
    `INSERT INTO alert_rules (id, name, device_id, metric, operator, threshold, duration_sec, severity, cooldown_sec, enabled, created_at)
     VALUES (?, ?, ?, ?, 'gt', ?, ?, ?, 900, 1, ?)`
  );
  for (const rule of defaults) {
    // The device shows beside each rule on the Alerts page and in every
    // notification, so the name stays the rule alone.
    stmt.run(newId(), rule.name, deviceId, rule.metric, rule.threshold, rule.durationSec, rule.severity, Date.now());
  }
}
