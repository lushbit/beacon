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

/** The colour a single-series chart is drawn in. */
export const CANVAS_COLOR_VALUES: Record<CanvasColor, string> = {
  ink: SERIES.ink,
  blue: "var(--series-1)",
  orange: "var(--series-2)",
  aqua: "var(--series-3)",
  yellow: "var(--series-4)",
  magenta: "var(--series-5)",
};

export const CANVAS_COLOR_LABELS: Record<CanvasColor, string> = {
  ink: "White",
  blue: "Blue",
  orange: "Orange",
  aqua: "Aqua",
  yellow: "Yellow",
  magenta: "Magenta",
};

/** Colours for charts with more than one line, in the documented palette order. */
export const MULTI_SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

export const LEVEL_TEXT = {
  ok: "hsl(var(--foreground))",
  warning: "hsl(var(--warning))",
  critical: "hsl(var(--danger))",
} as const;
