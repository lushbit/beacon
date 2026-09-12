import { createHmac } from "node:crypto";
import type { AlertDto, AlertSeverity } from "@beacon/shared";
import { getServerSettings } from "../settings.js";
import { logger } from "../utils/log.js";
import { metricReading } from "./messages.js";
import { channelConfig, listChannels, markChannelResult, type ChannelRow } from "./repo.js";

const log = logger("notify");

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 1, warning: 2, critical: 3 };
const TIMEOUT_MS = 8000;

/**
 * Link straight to the device that raised the alert. The hub only knows the
 * address someone reaches the dashboard at once it has been set in Settings,
 * and until then notifications simply carry no link.
 */
function deviceUrl(alert: AlertDto): string | null {
  if (!alert.deviceId) return null;
  const base = getServerSettings().dashboardUrl.trim().replace(/\/+$/, "");
  return base ? `${base}/devices/${alert.deviceId}` : null;
}

function title(alert: AlertDto): string {
  const verb = alert.state === "firing" ? "Alert" : "Resolved";
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
  const link = deviceUrl(alert);
  const reading = metricReading(alert.metric, alert.value, alert.threshold);
  const payload = {
    username: "Beacon",
    embeds: [
      {
        title: title(alert),
        url: link ?? undefined,
        description: alert.message,
        color: DISCORD_COLORS[alert.state === "resolved" ? "resolved" : alert.severity] ?? 0x8b5cf6,
        timestamp: new Date(alert.state === "firing" ? alert.startedAt : alert.resolvedAt ?? Date.now()).toISOString(),
        fields: [
          { name: "Device", value: link ? `[${alert.deviceName}](${link})` : alert.deviceName, inline: true },
          { name: "Severity", value: alert.severity, inline: true },
          // An offline device has no reading worth printing, which is what used
          // to show up as "Value 0".
          ...(reading ? [{ name: reading.label, value: reading.text, inline: true }] : []),
        ],
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

export async function testChannel(row: ChannelRow): Promise<{ ok: boolean; error?: string }> {
  const sample: AlertDto = {
    id: "test",
    ruleId: null,
    ruleName: "Test notification",
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
