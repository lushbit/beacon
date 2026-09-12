import { createHmac } from "node:crypto";
import type { AlertDto, AlertSeverity } from "@beacon/shared";
import { dashboardOrigin } from "../dashboardOrigin.js";
import { logger } from "../utils/log.js";
import { channelConfig, listChannels, markChannelResult, type ChannelRow } from "./repo.js";

const log = logger("notify");

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 1, warning: 2, critical: 3 };
const TIMEOUT_MS = 8000;

/**
 * Link straight to the device that raised the alert. Until somebody has opened
 * the dashboard once, the hub does not know its own address and the
 * notification simply carries no link.
 */
function deviceUrl(alert: AlertDto): string | null {
  if (!alert.deviceId) return null;
  const base = dashboardOrigin();
  return base ? `${base}/devices/${alert.deviceId}` : null;
}

function title(alert: AlertDto): string {
  const verb = alert.test ? "Test" : alert.state === "firing" ? "Alert" : "Resolved";
  return `${verb}: ${alert.ruleName} on ${alert.deviceName}`;
}

async function post(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }
}

/**
 * HTTP header values can only hold Latin-1, and fetch rejects anything else,
 * such as the em dash in every alert title or an emoji in a device name. ntfy
 * decodes RFC 2047, so a title that is not plain ASCII is sent base64 encoded.
 */
function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function sendNtfy(row: ChannelRow, alert: AlertDto): Promise<void> {
  const cfg = channelConfig(row);
  const base = (cfg.url ?? "").replace(/\/+$/, "");
  const topic = cfg.topic ?? "";
  if (!base) throw new Error("ntfy channel has no server URL");
  const target = topic ? `${base}/${topic}` : base;

  const headers: Record<string, string> = {
    Title: headerText(title(alert)),
    Priority: alert.state === "resolved" ? "low" : alert.severity === "critical" ? "urgent" : "default",
    Tags: alert.state === "resolved" ? "white_check_mark" : alert.severity === "critical" ? "rotating_light" : "warning",
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  // Tapping the notification opens the device it is about.
  const link = deviceUrl(alert);
  if (link) headers.Click = link;

  await post(target, { method: "POST", headers, body: alert.message });
}

async function sendWebhook(row: ChannelRow, alert: AlertDto): Promise<void> {
  const cfg = channelConfig(row);
  if (!cfg.url) throw new Error("webhook channel has no URL");
  const body = JSON.stringify({ event: `alert.${alert.state}`, alert, deviceUrl: deviceUrl(alert) });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.secret) {
    // Lets the receiver prove the payload came from this hub.
    headers["X-Beacon-Signature"] = `sha256=${createHmac("sha256", cfg.secret).update(body).digest("hex")}`;
  }
  await post(cfg.url, { method: "POST", headers, body });
}

const DISCORD_COLORS: Record<string, number> = {
  resolved: 0x2fbf71,
  info: 0x4aa3f0,
  warning: 0xf5a623,
  critical: 0xe0525f,
};

async function sendDiscord(row: ChannelRow, alert: AlertDto): Promise<void> {
  const cfg = channelConfig(row);
  if (!cfg.url) throw new Error("discord channel has no webhook URL");
  // A title and the sentence under it, the same as every other channel shows.
  // The fields this used to carry repeated what the message already says, and
  // on an offline device the reading was a meaningless "Value 0". Severity is
  // the colour down the side.
  const payload = {
    username: "Beacon",
    embeds: [
      {
        title: title(alert),
        url: deviceUrl(alert) ?? undefined,
        description: alert.message,
        color: DISCORD_COLORS[alert.state === "resolved" ? "resolved" : alert.severity] ?? 0x8b5cf6,
        timestamp: new Date(alert.state === "firing" ? alert.startedAt : alert.resolvedAt ?? Date.now()).toISOString(),
      },
    ],
  };
  await post(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function deliver(row: ChannelRow, alert: AlertDto): Promise<void> {
  switch (row.type) {
    case "ntfy":
      return sendNtfy(row, alert);
    case "webhook":
      return sendWebhook(row, alert);
    case "discord":
      return sendDiscord(row, alert);
    default:
      throw new Error(`unknown channel type: ${row.type as string}`);
  }
}

/** Fire-and-forget: a broken channel must never stall metric ingestion. */
export function dispatchAlert(alert: AlertDto): void {
  for (const row of listChannels()) {
    if (row.enabled !== 1) continue;
    if (SEVERITY_RANK[alert.severity] < SEVERITY_RANK[row.min_severity]) continue;
    deliver(row, alert)
      .then(() => markChannelResult(row.id, null))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        markChannelResult(row.id, message);
        log.warn(`channel "${row.name}" failed: ${message}`);
      });
  }
}

export interface TestDispatch {
  sent: number;
  /** Enabled channels whose severity floor is above this alert. */
  skipped: number;
  failures: { channel: string; error: string }[];
}

/**
 * Sends one made-up alert to every channel that would carry the real thing, and
 * waits for each, so the dashboard can say what actually happened. Real alerts
 * go out through `dispatchAlert`, which never waits.
 */
export async function sendTestAlert(alert: AlertDto): Promise<TestDispatch> {
  const result: TestDispatch = { sent: 0, skipped: 0, failures: [] };
  for (const row of listChannels()) {
    if (row.enabled !== 1) continue;
    if (SEVERITY_RANK[alert.severity] < SEVERITY_RANK[row.min_severity]) {
      result.skipped += 1;
      continue;
    }
    try {
      await deliver(row, alert);
      markChannelResult(row.id, null);
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markChannelResult(row.id, message);
      log.warn(`channel "${row.name}" failed a test: ${message}`);
      result.failures.push({ channel: row.name, error: message });
    }
  }
  return result;
}

export async function testChannel(row: ChannelRow): Promise<{ ok: boolean; error?: string }> {
  const sample: AlertDto = {
    id: "test",
    ruleId: null,
    ruleName: "Notification check",
    // No real device, so the notification carries no device link.
    deviceId: "",
    deviceName: "Beacon",
    metric: "cpuPct",
    severity: "info",
    state: "firing",
    value: 42,
    threshold: 40,
    message: "This is a test notification from Beacon.",
    startedAt: Date.now(),
    resolvedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    test: true,
  };
  try {
    await deliver(row, sample);
    markChannelResult(row.id, null);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markChannelResult(row.id, message);
    return { ok: false, error: message };
  }
}
