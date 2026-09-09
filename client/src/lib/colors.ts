/**
 * The dashboard chrome is monochrome: single-series charts draw in neutral ink,
 * and the status colours are reserved for state. Hues from the documented
 * data-viz palette appear only where a chart carries more than one series and
 * identity cannot rest on brightness alone.
 */
export const SERIES = {
  /** Every single-series chart, so the page stays black and white. */
  ink: "hsl(var(--series-ink))",
  /** Two-series charts (download/upload, read/write) use slots 1 and 2. */
  in: "var(--series-1)",
  out: "var(--series-2)",
  /** Three-series charts (CPU / memory / disk together) use slots 1–3. */
  cpu: "var(--series-1)",
  memory: "var(--series-2)",
  disk: "var(--series-3)",
} as const;

export type SeverityLevel = "ok" | "warning" | "critical";

export function levelOf(percent: number | null | undefined): SeverityLevel {
  if (percent === null || percent === undefined) return "ok";
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "ok";
}

/** Meter fills carry severity; the track is the same tone dimmed into the surface. */
export const LEVEL_FILL: Record<SeverityLevel, string> = {
  ok: "hsl(var(--series-ink))",
  warning: "hsl(var(--warning))",
  critical: "hsl(var(--danger))",
};

/** Optional per-device accent, used only as a small identifying dot. */
export const DEVICE_COLORS = [
  { id: "slate", label: "Slate", value: "0 0% 62%" },
  { id: "blue", label: "Blue", value: "212 92% 60%" },
  { id: "aqua", label: "Aqua", value: "163 72% 42%" },
  { id: "amber", label: "Amber", value: "38 95% 58%" },
  { id: "rose", label: "Rose", value: "340 70% 58%" },
  { id: "violet", label: "Violet", value: "262 84% 66%" },
] as const;

export function deviceColor(id: string): string {
  const found = DEVICE_COLORS.find((color) => color.id === id);
  return `hsl(${found ? found.value : DEVICE_COLORS[0].value})`;
}
