import { ALERT_METRIC_LABELS, ALERT_METRIC_UNITS } from "@beacon/shared";
import type { AlertMetric } from "@beacon/shared";

export function formatBytes(bytes: number, base: 1000 | 1024 = 1024): string {
  const units = base === 1024 ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] : ["B", "kB", "MB", "GB", "TB", "PB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= base && unit < units.length - 1) {
    value /= base;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${bytes < 0 ? "-" : ""}${rounded} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatMetricValue(metric: AlertMetric, value: number): string {
  switch (ALERT_METRIC_UNITS[metric]) {
    case "percent":
      return `${Math.round(value * 10) / 10}%`;
    case "bytesPerSec":
      return `${formatBytes(value)}/s`;
    case "celsius":
      return `${Math.round(value)}°C`;
    case "seconds":
      return formatDuration(value);
    default:
      return String(Math.round(value * 100) / 100);
  }
}

export function metricLabel(metric: AlertMetric): string {
  return ALERT_METRIC_LABELS[metric];
}
