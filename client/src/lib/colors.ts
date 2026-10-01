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
  /** The third line where a chart has three, such as the load averages. */
  third: "var(--series-3)",
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

/**
 * Optional per-device accent, used only as a stripe down the left edge of the
 * device's row. Stored as `#rrggbb`, or as an empty string for no accent. The
 * named ids are what devices were given before any colour could be picked, so
 * they still resolve to the same colour they always had.
 */
export const DEVICE_COLORS = [
  { id: "slate", label: "Slate", hex: "#9e9e9e" },
  { id: "blue", label: "Blue", hex: "#3b93f7" },
  { id: "aqua", label: "Aqua", hex: "#1eb88d" },
  { id: "amber", label: "Amber", hex: "#faaf2e" },
  { id: "rose", label: "Rose", hex: "#df497b" },
  { id: "violet", label: "Violet", hex: "#955ff1" },
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** The stored accent as `#rrggbb`, or null when the device has none. */
export function deviceColorHex(value: string): string | null {
  if (!value) return null;
  if (HEX.test(value)) return value.toLowerCase();
  const preset = DEVICE_COLORS.find((color) => color.id === value);
  return preset ? preset.hex : DEVICE_COLORS[0].hex;
}

/** Accepts `3b82f6`, `#3B82F6` or `#38f` and returns `#3b82f6`, or null. */
export function parseHexColor(input: string): string | null {
  let text = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(text)) text = [...text].map((digit) => digit + digit).join("");
  return /^[0-9a-f]{6}$/.test(text) ? `#${text}` : null;
}
