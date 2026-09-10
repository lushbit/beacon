import { cn } from "@/lib/utils";

/**
 * A thin determinate bar. The chrome stays neutral ink like the rest of the
 * dashboard; colour is only used when the value carries meaning, which here is
 * a finished or failed update.
 */
export function Progress({
  value,
  tone = "neutral",
  className,
  label,
}: {
  /** 0 to 100. */
  value: number;
  tone?: "neutral" | "success" | "danger";
  className?: string;
  /** Describes the bar for screen readers. */
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          tone === "success" && "bg-success",
          tone === "danger" && "bg-danger",
          tone === "neutral" && "bg-foreground/70"
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
