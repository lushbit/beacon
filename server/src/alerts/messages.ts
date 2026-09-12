/**
 * What an alert says, in words that suit the metric it watches.
 *
 * One generic sentence wrapped around a bare number produced lines such as
 * "Device offline on PC recovered (0s)", where the number was the seconds the
 * device had been gone and so was always zero by the time it came back. Each
 * case now reads as a sentence someone would say, and the same wording is used
 * on the dashboard and in every notification.
 */
import type { AlertMetric } from "@beacon/shared";
import { formatMetricValue, metricLabel } from "../utils/format.js";

/**
 * Shorter than the labels used in the rule editor, which name a metric
 * precisely enough to pick it from a list.
 */
const MESSAGE_LABELS: Partial<Record<AlertMetric, string>> = {
  diskMaxPct: "Disk usage",
  load1: "Load average",
};

function label(metric: AlertMetric): string {
  return MESSAGE_LABELS[metric] ?? metricLabel(metric);
}

export function firingMessage(
  metric: AlertMetric,
  deviceName: string,
  operator: string,
  value: number | null,
  threshold: number
): string {
  const limit = formatMetricValue(metric, threshold);
  const reading = value === null ? null : formatMetricValue(metric, value);
  if (metric === "offline") return `${deviceName} has been offline for ${reading ?? limit}.`;
  const comparison = operator === "lt" ? "below" : "above";
  return `${label(metric)} on ${deviceName} is ${reading ?? "unknown"}, ${comparison} the ${limit} limit.`;
}

/**
 * What a rule's Test button sends. The reading is the rule's own threshold
 * rather than a number invented just past it, so a test shows exactly the
 * figures set on the rule.
 */
export function testMessage(metric: AlertMetric, deviceName: string, operator: string, threshold: number): string {
  const limit = formatMetricValue(metric, threshold);
  if (metric === "offline") return `${deviceName} has been offline for ${limit}.`;
  return `${label(metric)} on ${deviceName} ${operator === "lt" ? "dropped to" : "reached"} its ${limit} limit.`;
}

export function resolvedMessage(metric: AlertMetric, deviceName: string, value: number | null): string {
  if (metric === "offline") return `${deviceName} is back online.`;
  if (value === null) return `${label(metric)} on ${deviceName} is back to normal.`;
  return `${label(metric)} on ${deviceName} is back to ${formatMetricValue(metric, value)}.`;
}
