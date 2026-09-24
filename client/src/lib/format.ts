import { serverNow } from "@/lib/clock";

export type UnitBase = 1000 | 1024;

const UNITS: Record<UnitBase, string[]> = {
  1024: ["B", "KiB", "MiB", "GiB", "TiB", "PiB"],
  1000: ["B", "kB", "MB", "GB", "TB", "PB"],
};

/**
 * `scaleFrom` is the value the unit is chosen for, which is not always the
 * value being printed.
 *
 * A chart axis passes the top of its scale, so every label on it reads in the
 * same unit. Left to pick a unit each, the ticks below a kilobyte all come out
 * in plain bytes, where binary and decimal agree to the digit, and switching
 * the size unit setting looks like it does nothing at all.
 */
export function formatBytes(bytes: number | null | undefined, base: UnitBase = 1024, scaleFrom?: number): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = UNITS[base] ?? UNITS[1024];

  let unit = 0;
  let scale = Math.abs(scaleFrom ?? bytes);
  while (scale >= base && unit < units.length - 1) {
    scale /= base;
    unit += 1;
  }

  const value = Math.abs(bytes) / base ** unit;
  // Whole bytes are never fractional. An axis needs a second decimal low down
  // its scale to keep its labels apart, while a figure in running text reads
  // better with one.
  const digits = unit === 0 || value >= 100 ? 0 : scaleFrom !== undefined && value < 10 ? 2 : 1;
  return `${bytes < 0 ? "-" : ""}${Number(value.toFixed(digits))} ${units[unit]}`;
}

export function formatRate(
  bytesPerSec: number | null | undefined,
  base: UnitBase = 1024,
  scaleFrom?: number
): string {
  if (bytesPerSec === null || bytesPerSec === undefined) return "—";
  return `${formatBytes(bytesPerSec, base, scaleFrom)}/s`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** A clock speed given in MHz, shown in GHz once it reaches one. */
export function formatClock(mhz: number | null | undefined): string {
  if (mhz === null || mhz === undefined || !Number.isFinite(mhz)) return "—";
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

export function formatLoad(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function formatTemperature(celsius: number | null | undefined, unit: "c" | "f" = "c"): string {
  if (celsius === null || celsius === undefined) return "—";
  return unit === "f" ? `${Math.round(celsius * 1.8 + 32)}°F` : `${Math.round(celsius)}°C`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Measured against the hub's clock, since the hub wrote the timestamp. */
export function formatRelative(timestamp: number | null | undefined, now = serverNow()): string {
  if (!timestamp) return "never";
  const delta = now - timestamp;
  if (delta < 5000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PLATFORM_NAMES: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  sunos: "SunOS",
  aix: "AIX",
};

export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}
