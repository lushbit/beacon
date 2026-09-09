import { RANGES } from "@/lib/time";
import { cn } from "@/lib/utils";

/** One filter row above the charts, as a segmented control. */
export function RangePicker({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (seconds: number) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className={cn("scroll-slim flex max-w-full items-center gap-1 overflow-x-auto rounded-md bg-surface-2 p-1", className)}
    >
      {RANGES.map((range) => (
        <button
          key={range.id}
          type="button"
          onClick={() => onChange(range.seconds)}
          aria-pressed={value === range.seconds}
          className={cn(
            "shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
            value === range.seconds
              ? "bg-surface-3 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
