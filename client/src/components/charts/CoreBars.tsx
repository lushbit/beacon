import { levelOf, LEVEL_FILL } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** Per-core load: thin columns, rounded caps, a 2px surface gap between them. */
export function CoreBars({ cores, className }: { cores: number[]; className?: string }) {
  if (cores.length === 0) return null;
  return (
    <div className={cn("flex items-end gap-[2px]", className)} style={{ height: 56 }}>
      {cores.map((load, index) => {
        const fill = LEVEL_FILL[levelOf(load)];
        const height = Math.max(2, Math.min(100, load));
        return (
          <div
            key={index}
            className="group relative flex h-full flex-1 items-end"
            style={{ maxWidth: 24 }}
            title={`Core ${index + 1}: ${load.toFixed(0)}%`}
          >
            <div
              className="w-full rounded-t-[4px] transition-[height] duration-500 ease-out"
              style={{ height: `${height}%`, background: fill }}
            />
          </div>
        );
      })}
    </div>
  );
}
