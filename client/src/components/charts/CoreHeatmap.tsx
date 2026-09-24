import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { aggregate, bucketFor, linearScale, nearestIndex, timeAxisTicks, type Point } from "./chartUtils";
import { useChartSize } from "./useChartSize";

interface CoreHeatmapProps {
  /** One point per timestamp, a key per core: `c0`, `c1` and so on. */
  points: Point[];
  cores: number;
  from: number;
  to: number;
  className?: string;
}

const MARGIN = { top: 4, right: 18, bottom: 22, left: 48 };

/**
 * Every core over time, a row each, shaded by how busy it was.
 *
 * Eight or more lines on one chart tangle into a band nobody can follow, and a
 * server has far more than eight. A row per core stays readable at any count:
 * a core pinned at full load is a bright stripe, and work moving between cores
 * shows as the stripe changing rows.
 */
export function CoreHeatmap({ points, cores, from, to, className }: CoreHeatmapProps) {
  const [ref, width] = useChartSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ index: number; core: number } | null>(null);

  const rowHeight = Math.max(3, Math.min(14, Math.floor(200 / Math.max(1, cores))));
  const innerHeight = rowHeight * cores;
  const height = innerHeight + MARGIN.top + MARGIN.bottom;
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);

  const keys = useMemo(() => Array.from({ length: cores }, (_, core) => `c${core}`), [cores]);
  // Cells about six pixels wide, on the same clock-aligned buckets as the line
  // charts so the columns do not shuffle when a sample arrives.
  const bucketMs = useMemo(
    () => bucketFor(to - from, Math.max(24, Math.min(200, Math.round(innerWidth / 6)))),
    [to, from, innerWidth]
  );
  const drawn = useMemo(() => aggregate(points, keys, bucketMs), [points, keys, bucketMs]);
  const x = useMemo(() => linearScale([from, to], [0, innerWidth]), [from, to, innerWidth]);
  const xTicks = useMemo(() => timeAxisTicks(from, to, innerWidth), [from, to, innerWidth]);
  const cellWidth = Math.max(1, x(from + bucketMs) - x(from) - 1);

  // Label every core when the rows have room for it, otherwise only some.
  const labelEvery = Math.max(1, Math.ceil(12 / rowHeight));

  const hovered = hover ? drawn[hover.index] : undefined;
  const hoveredValue = hovered && hover ? hovered[`c${hover.core}`] : undefined;

  const handleMove = (event: React.MouseEvent<SVGRectElement>) => {
    if (drawn.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ts = from + ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * (to - from);
    const core = Math.min(cores - 1, Math.max(0, Math.floor((event.clientY - bounds.top) / rowHeight)));
    setHover({ index: nearestIndex(drawn, ts), core });
  };

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Load per core over time">
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {keys.map((key, core) =>
              core % labelEvery === 0 || core === cores - 1 ? (
                <text
                  key={key}
                  x={-10}
                  y={core * rowHeight + rowHeight / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px] tabular"
                >
                  {core + 1}
                </text>
              ) : null
            )}

            {drawn.map((point) =>
              keys.map((key, core) => {
                const value = point[key];
                if (typeof value !== "number" || !Number.isFinite(value)) return null;
                const load = Math.max(0, Math.min(100, value));
                return (
                  <rect
                    key={`${point.ts}-${key}`}
                    x={x(point.ts) - cellWidth / 2}
                    y={core * rowHeight}
                    width={cellWidth}
                    height={Math.max(1, rowHeight - 1)}
                    rx={rowHeight >= 8 ? 1.5 : 0}
                    fill="hsl(var(--series-ink))"
                    // A floor keeps an idle core visible as a row rather than a gap.
                    fillOpacity={0.06 + (load / 100) * 0.94}
                  />
                );
              })
            )}

            {hovered && hover ? (
              <rect
                x={x(hovered.ts) - cellWidth / 2 - 1}
                y={hover.core * rowHeight - 1}
                width={cellWidth + 2}
                height={rowHeight + 1}
                fill="none"
                stroke="hsl(var(--foreground))"
                strokeWidth={1}
              />
            ) : null}

            {xTicks.map((tick) => (
              <text
                key={tick.ts}
                x={x(tick.ts)}
                y={innerHeight + 15}
                textAnchor={x(tick.ts) < 18 ? "start" : x(tick.ts) > innerWidth - 18 ? "end" : "middle"}
                className="fill-muted-foreground text-[10px] tabular"
              >
                {tick.label}
              </text>
            ))}

            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        </svg>
      ) : null}

      {hovered && hover ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[8rem] rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur"
          style={{
            left: Math.min(Math.max(MARGIN.left + x(hovered.ts) - 64, 4), Math.max(4, width - 140)),
            top: Math.min(MARGIN.top + (hover.core + 1) * rowHeight + 6, Math.max(0, height - 56)),
          }}
        >
          <p className="mb-1 text-2xs text-muted-foreground tabular">
            {new Date(hovered.ts).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: to - from <= 3600_000 ? "2-digit" : undefined,
            })}
          </p>
          <p className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Core {hover.core + 1}</span>
            <span className="font-medium text-foreground tabular">
              {typeof hoveredValue === "number" && Number.isFinite(hoveredValue) ? `${hoveredValue.toFixed(0)}%` : "—"}
            </span>
          </p>
        </div>
      ) : null}

      {drawn.length === 0 && width > 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          No data for this range yet.
        </div>
      ) : null}
    </div>
  );
}

/** The key to the shading, drawn beside the chart's title. */
export function CoreHeatmapScale({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-2xs text-muted-foreground", className)}>
      <span>0%</span>
      <span
        className="h-2 w-16 rounded-full"
        style={{
          background:
            "linear-gradient(to right, hsl(var(--series-ink) / 0.06), hsl(var(--series-ink) / 1))",
        }}
        aria-hidden
      />
      <span>100%</span>
    </div>
  );
}
