import { useMemo, useState } from "react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { aggregate, bucketFor, linePaths, linearScale, nearestIndex, peakOf, timeAxisTicks, valueTicks, type Point } from "./chartUtils";
import { useChartSize } from "./useChartSize";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

interface TimeChartProps {
  points: Point[];
  series: ChartSeries[];
  from: number;
  to: number;
  /** Upper bound the axis may never pass — 100 for a percentage. */
  clampMax?: number;
  format: (value: number) => string;
  height?: number;
  className?: string;
  emptyLabel?: string;
}

const MARGIN = { top: 12, right: 18, bottom: 22, left: 48 };

export function TimeChart({
  points,
  series,
  from,
  to,
  clampMax,
  format,
  height = 200,
  className,
  emptyLabel = "No data for this range yet.",
}: TimeChartProps) {
  const [ref, width] = useChartSize<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const keys = useMemo(() => series.map((item) => item.key), [series]);

  // Averaged down to what the width can actually show, at roughly one vertex
  // per eight pixels. Everything else — the axis, the hover, the line — reads
  // from this, so the number at the top of the axis is the peak of the curve
  // that is drawn rather than of a sample too brief to see.
  const bucketMs = useMemo(
    () => bucketFor(to - from, Math.max(24, Math.min(240, Math.round(innerWidth / 8)))),
    [to, from, innerWidth]
  );
  const drawn = useMemo(() => aggregate(points, keys, bucketMs), [points, keys, bucketMs]);

  // The tallest point sets the top of the axis, so the shape of the data is
  // visible whatever range is on screen.
  const maxValue = useMemo(() => peakOf(drawn, keys, { clamp: clampMax }), [drawn, keys, clampMax]);

  const x = useMemo(() => linearScale([from, to], [0, innerWidth]), [from, to, innerWidth]);
  const y = useMemo(() => linearScale([0, maxValue], [innerHeight, 0]), [maxValue, innerHeight]);

  const paths = useMemo(
    () => series.map((item) => ({ item, segments: linePaths(drawn, item.key, x, y) })),
    [series, drawn, x, y]
  );

  const yTicks = useMemo(() => valueTicks(maxValue, 4), [maxValue]);
  const xTicks = useMemo(() => timeAxisTicks(from, to, innerWidth), [from, to, innerWidth]);

  // Only say "average" when samples were actually merged; a series that is
  // already coarser than the bucket is passed through as it arrived.
  const bucketSec = drawn.length < points.length ? Math.round(bucketMs / 1000) : 0;

  const hovered = hoverIndex !== null ? drawn[hoverIndex] : undefined;
  const hasData = drawn.length > 0 && width > 0;

  const handleMove = (event: React.MouseEvent<SVGRectElement>) => {
    if (drawn.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - bounds.left;
    const ts = from + (offset / Math.max(1, bounds.width)) * (to - from);
    setHoverIndex(nearestIndex(drawn, ts));
  };

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={series.map((item) => item.label).join(", ")}
          className="overflow-visible"
        >
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {yTicks.map((tick, index) => (
              <g key={index}>
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="hsl(var(--chart-grid))"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {index === 0 || format(tick) !== format(yTicks[index - 1]) ? (
                  <text
                    x={-10}
                    y={y(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={cn("text-[10px] tabular", index === yTicks.length - 1 ? "fill-foreground/70" : "fill-muted-foreground")}
                  >
                    {format(tick)}
                  </text>
                ) : null}
              </g>
            ))}

            {xTicks.map((tick) => (
              <text
                key={tick.ts}
                x={x(tick.ts)}
                y={innerHeight + 15}
                // Edge labels are anchored inwards so they cannot spill out of
                // the chart and collide with whatever sits beside it.
                textAnchor={x(tick.ts) < 18 ? "start" : x(tick.ts) > innerWidth - 18 ? "end" : "middle"}
                className="fill-muted-foreground text-[10px] tabular"
              >
                {tick.label}
              </text>
            ))}

            {paths.map(({ item, segments }) => (
              <g key={item.key}>
                {segments.map((segment, index) => (
                  <path key={`area-${index}`} d={segment.area} fill={item.color} fillOpacity={0.1} stroke="none" />
                ))}
                {segments.map((segment, index) => (
                  <path
                    key={`line-${index}`}
                    d={segment.line}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            ))}

            {hovered ? (
              <g>
                <line
                  x1={x(hovered.ts)}
                  x2={x(hovered.ts)}
                  y1={0}
                  y2={innerHeight}
                  stroke="hsl(var(--foreground) / 0.25)"
                  strokeWidth={1}
                />
                {series.map((item) => {
                  const value = hovered[item.key];
                  if (typeof value !== "number" || !Number.isFinite(value)) return null;
                  return (
                    <circle
                      key={item.key}
                      cx={x(hovered.ts)}
                      cy={y(value)}
                      r={4}
                      fill={item.color}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            ) : null}

            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverIndex(null)}
            />
          </g>
        </svg>
      ) : null}

      {hovered ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[9rem] rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur"
          style={{
            left: Math.min(Math.max(MARGIN.left + x(hovered.ts) - 70, 4), Math.max(4, width - 150)),
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
            {bucketSec > 0 ? ` · ${formatDuration(bucketSec)} average` : ""}
          </p>
          {series.map((item) => {
            const value = hovered[item.key];
            return (
              <p key={item.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden />
                  {item.label}
                </span>
                <span className="font-medium text-foreground tabular">
                  {typeof value === "number" && Number.isFinite(value) ? format(value) : "—"}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}

      {!hasData ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : null}
    </div>
  );
}

/** Identity never rests on colour alone — every multi-series chart gets this. */
export function ChartLegend({ series, className }: { series: ChartSeries[]; className?: string }) {
  if (series.length < 2) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {series.map((item) => (
        <span key={item.key} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}
