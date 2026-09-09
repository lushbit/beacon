import type {
  AlertDto,
  AlertMetric,
  AlertOperator,
  AlertRuleDto,
  AlertSeverity,
  ChannelDto,
  ChannelType,
} from "@beacon/shared";
import { db, parseJson } from "../db/index.js";
import { newId } from "../utils/ids.js";

export interface AlertRuleRow {
  id: string;
  name: string;
  device_id: string | null;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  duration_sec: number;
  severity: AlertSeverity;
  cooldown_sec: number;
  enabled: number;
  created_at: number;
}

export interface AlertRow {
  id: string;
  rule_id: string | null;
  rule_name: string;
  device_id: string;
  metric: AlertMetric;
  severity: AlertSeverity;
  state: "firing" | "resolved";
  value: number | null;
  threshold: number | null;
  message: string;
  started_at: number;
  resolved_at: number | null;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
}

export interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  enabled: number;
  min_severity: AlertSeverity;
  config: string;
  created_at: number;
  last_error: string | null;
  last_sent_at: number | null;
}

export function toRuleDto(row: AlertRuleRow): AlertRuleDto {
  return {
    id: row.id,
    name: row.name,
    deviceId: row.device_id,
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    durationSec: row.duration_sec,
    severity: row.severity,
    cooldownSec: row.cooldown_sec,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export function listRules(): AlertRuleRow[] {
  return db.prepare("SELECT * FROM alert_rules ORDER BY created_at ASC").all() as AlertRuleRow[];
}

export function rulesForDevice(deviceId: string): AlertRuleRow[] {
  return db
    .prepare("SELECT * FROM alert_rules WHERE enabled = 1 AND (device_id IS NULL OR device_id = ?)")
    .all(deviceId) as AlertRuleRow[];
}

export function getRule(id: string): AlertRuleRow | undefined {
  return db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRuleRow | undefined;
}

export function createRule(input: Omit<AlertRuleDto, "id" | "createdAt">): AlertRuleRow {
  const id = newId();
  db.prepare(
    `INSERT INTO alert_rules (id, name, device_id, metric, operator, threshold, duration_sec, severity, cooldown_sec, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.deviceId,
    input.metric,
    input.operator,
    input.threshold,
    input.durationSec,
    input.severity,
    input.cooldownSec,
    input.enabled ? 1 : 0,
    Date.now()
  );
  return getRule(id)!;
}

export function updateRule(id: string, patch: Partial<Omit<AlertRuleDto, "id" | "createdAt">>): AlertRuleRow | undefined {
  const row = getRule(id);
  if (!row) return undefined;
  db.prepare(
    `UPDATE alert_rules
        SET name = ?, device_id = ?, metric = ?, operator = ?, threshold = ?,
            duration_sec = ?, severity = ?, cooldown_sec = ?, enabled = ?
      WHERE id = ?`
  ).run(
    patch.name ?? row.name,
    patch.deviceId !== undefined ? patch.deviceId : row.device_id,
    patch.metric ?? row.metric,
    patch.operator ?? row.operator,
    patch.threshold ?? row.threshold,
    patch.durationSec ?? row.duration_sec,
    patch.severity ?? row.severity,
    patch.cooldownSec ?? row.cooldown_sec,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled,
    id
  );
  return getRule(id);
}

export function deleteRule(id: string): void {
  db.prepare("DELETE FROM rule_runtime WHERE rule_id = ?").run(id);
  db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
}

/* --------------------------------------------------------------------- alerts */

export function toAlertDto(row: AlertRow, deviceName: string): AlertDto {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    deviceId: row.device_id,
    deviceName,
    metric: row.metric,
    severity: row.severity,
    state: row.state,
    value: row.value,
    threshold: row.threshold,
    message: row.message,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
  };
}

export function listAlerts(options: { state?: "firing" | "resolved"; deviceId?: string; limit?: number }): AlertRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.state) {
    clauses.push("state = ?");
    params.push(options.state);
  }
  if (options.deviceId) {
    clauses.push("device_id = ?");
    params.push(options.deviceId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(options.limit ?? 200);
  return db
    .prepare(`SELECT * FROM alerts ${where} ORDER BY started_at DESC LIMIT ?`)
    .all(...params) as AlertRow[];
}

export function getAlert(id: string): AlertRow | undefined {
  return db.prepare("SELECT * FROM alerts WHERE id = ?").get(id) as AlertRow | undefined;
}

export function activeAlertCounts(): Map<string, number> {
  const rows = db
    .prepare("SELECT device_id, COUNT(*) AS n FROM alerts WHERE state = 'firing' GROUP BY device_id")
    .all() as { device_id: string; n: number }[];
  return new Map(rows.map((row) => [row.device_id, row.n]));
}

export function acknowledgeAlert(id: string, by: string): void {
  db.prepare("UPDATE alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?").run(Date.now(), by, id);
}

/* ------------------------------------------------------------------- channels */

const SECRET_KEYS = new Set(["token", "password", "authorization", "secret"]);

export function toChannelDto(row: ChannelRow, redact = true): ChannelDto {
  const config = parseJson<Record<string, string>>(row.config, {});
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    const isSecret = SECRET_KEYS.has(key.toLowerCase()) || key.toLowerCase().endsWith("url");
    safe[key] = redact && isSecret && value ? maskValue(key, value) : value;
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled === 1,
    minSeverity: row.min_severity,
    config: safe,
    createdAt: row.created_at,
    lastError: row.last_error,
    lastSentAt: row.last_sent_at,
  };
}

/** Webhook URLs often carry the secret in the path, so only the host survives. */
function maskValue(key: string, value: string): string {
  if (key.toLowerCase().endsWith("url")) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}/…`;
    } catch {
      return "••••";
    }
  }
  return "••••";
}

export function listChannels(): ChannelRow[] {
  return db.prepare("SELECT * FROM channels ORDER BY created_at ASC").all() as ChannelRow[];
}

export function getChannel(id: string): ChannelRow | undefined {
  return db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
}

export function createChannel(input: {
  name: string;
  type: ChannelType;
  enabled: boolean;
  minSeverity: AlertSeverity;
  config: Record<string, string>;
}): ChannelRow {
  const id = newId();
  db.prepare(
    "INSERT INTO channels (id, name, type, enabled, min_severity, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, input.name, input.type, input.enabled ? 1 : 0, input.minSeverity, JSON.stringify(input.config), Date.now());
  return getChannel(id)!;
}

export function updateChannel(
  id: string,
  patch: { name?: string; enabled?: boolean; minSeverity?: AlertSeverity; config?: Record<string, string> }
): ChannelRow | undefined {
  const row = getChannel(id);
  if (!row) return undefined;
  // A config patch replaces only the keys it names, so untouched secrets stay put.
  const config = patch.config
    ? { ...parseJson<Record<string, string>>(row.config, {}), ...patch.config }
    : parseJson<Record<string, string>>(row.config, {});
  db.prepare("UPDATE channels SET name = ?, enabled = ?, min_severity = ?, config = ? WHERE id = ?").run(
    patch.name ?? row.name,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled,
    patch.minSeverity ?? row.min_severity,
    JSON.stringify(config),
    id
  );
  return getChannel(id);
}

export function deleteChannel(id: string): void {
  db.prepare("DELETE FROM channels WHERE id = ?").run(id);
}

export function markChannelResult(id: string, error: string | null): void {
  if (error) {
    db.prepare("UPDATE channels SET last_error = ? WHERE id = ?").run(error, id);
  } else {
    db.prepare("UPDATE channels SET last_error = NULL, last_sent_at = ? WHERE id = ?").run(Date.now(), id);
  }
}

export function channelConfig(row: ChannelRow): Record<string, string> {
  return parseJson<Record<string, string>>(row.config, {});
}
