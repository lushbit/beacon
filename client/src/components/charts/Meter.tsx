import { levelOf, LEVEL_FILL } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface MeterProps {
  value: number | null;
  /** Shown to the right of the label; the meter itself is never the only cue. */
  valueLabel?: string;
  label?: string;
  sublabel?: string;
  /** "md" is the roomier variant used where a meter is the main thing on show. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Fill carries severity; the track is the same hue dimmed into the surface, so
 * state reads across the whole bar rather than only where it is filled.
 */
export function Meter({ value, valueLabel, label, sublabel, size = "sm", className }: MeterProps) {
  const level = levelOf(value);
  const fill = LEVEL_FILL[level];
  const percent = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className={cn(size === "md" ? "space-y-2" : "space-y-1.5", className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate text-muted-foreground", size === "md" ? "text-sm" : "text-xs")}>{label}</span>
          <span className={cn("shrink-0 font-medium text-foreground tabular", size === "md" ? "text-sm" : "text-xs")}>
            {valueLabel}
          </span>
        </div>
      ) : null}
      <div
        className={cn("w-full overflow-hidden rounded-full", size === "md" ? "h-2.5" : "h-2")}
        style={{ background: `color-mix(in srgb, ${fill} 22%, hsl(var(--surface-2)))` }}
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "usage"}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%`, background: fill }}
        />
      </div>
      {sublabel ? <p className="text-2xs text-muted-foreground">{sublabel}</p> : null}
    </div>
  );
}
