import type { CanvasColor, CanvasOptions, CanvasUnit } from "@beacon/shared";
import { SERIES } from "@/lib/colors";
import {
  formatBytes,
  formatClock,
  formatDuration,
  formatMs,
  formatOps,
  formatPercent,
  formatRate,
  formatTemperature,
  formatWatts,
} from "@/lib/format";

type Units = Pick<CanvasOptions, "unitBase" | "temperatureUnit">;

/**
 * A formatter for a unit, shaped like the device page's: the second argument
 * is the top of the axis, so every label on one axis shares a unit.
 */
export function unitFormatter(unit: CanvasUnit, options: Units): (value: number, axisMax?: number) => string {
  switch (unit) {
    case "percent":
      return (value) => (value === 0 ? "0%" : formatPercent(value, value < 10 ? 1 : 0));
    case "bytes":
      return (value, max) => formatBytes(value, options.unitBase, max);
    case "rate":
      return (value, max) => formatRate(value, options.unitBase, max);
    case "temperature":
      return (value) => formatTemperature(value, options.temperatureUnit);
    case "clock":
      return formatClock;
    case "watts":
      return formatWatts;
    case "ms":
      return formatMs;
    case "ops":
      return formatOps;
    case "load":
      return (value) => value.toFixed(value < 10 ? 2 : 1);
    case "count":
      return (value) => String(Math.round(value));
    case "duration":
      return formatDuration;
  }
}

export function formatValue(value: number | null | undefined, unit: CanvasUnit, options: Units): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return unitFormatter(unit, options)(value);
}

/** The named colours older pages saved, as the hex value the colour picker shows. */
const NAMED_HEX: Record<CanvasColor, string> = {
  ink: "",
  blue: "#3987e5",
  orange: "#d95926",
  aqua: "#199e70",
  yellow: "#c98500",
  magenta: "#d55181",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A block's colour for the colour picker: `#rrggbb`, or empty for the default. */
export function pickerColor(value: string | undefined): string {
  if (!value) return "";
  if (HEX.test(value)) return value.toLowerCase();
  return NAMED_HEX[value as CanvasColor] ?? "";
}

/** The colour to draw with. Empty, or anything unknown, is the default white. */
export function drawColor(value: string | undefined): string {
  const hex = pickerColor(value);
  return hex || SERIES.ink;
}

/** Colours for charts with more than one line, in the documented palette order. */
export const MULTI_SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

export const LEVEL_TEXT = {
  ok: "hsl(var(--foreground))",
  warning: "hsl(var(--warning))",
  critical: "hsl(var(--danger))",
} as const;
