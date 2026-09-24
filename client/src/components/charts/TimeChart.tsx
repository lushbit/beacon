import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  /**
   * Axis labels are formatted against the top of the axis, so a formatter with
   * a choice of units picks one for the whole scale rather than a different one
   * per tick. The hover reading is formatted on its own, where the unit that
   * suits the number beats the unit that suits the scale.
   */
  format: (value: number, axisMax?: number) => string;
  height?: number;
  className?: string;
  emptyLabel?: string;
  /**
   * Stretches of time to shade behind the line, such as a battery charging.
   * The hover names the state with `band.inside` or `band.outside`.
   */
  band?: { spans: { from: number; to: number }[]; inside: string; outside: string };
}

const MARGIN = { top: 12, right: 18, bottom: 22, left: 48 };

/** Short enough to keep up with the pointer, long enough to hide the steps. */
const GLIDE = "transform 90ms ease-out";

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
  band,
}: TimeChartProps) {
  const [ref, width] = useChartSize<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // The popup fades out rather than vanishing, so it keeps its last reading
  // on screen while it does.
  const [hovering, setHovering] = useState(false);

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

  // The popup is measured once shown, so it can be placed clear of the line.
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState({ width: 150, height: 64 });
  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!element) return;
    const { offsetWidth, offsetHeight } = element;
    if (offsetWidth !== tipSize.width || offsetHeight !== tipSize.height) {
      setTipSize({ width: offsetWidth, height: offsetHeight });
    }
  });

  /*
   * Above the line where there is room, below it where there is not, and beside
   * the crosshair as a last resort. "The line" is every point the popup would
   * sit over, not only the hovered one, so it does not cover a peak next door.
   */
  // The side the popup was last on. It stays there while it still fits, so the
  // popup does not hop above and below the line as the pointer crosses a peak.
  const lastSide = useRef<"above" | "below" | "beside">("above");

  const tipPosition = useMemo(() => {
    if (!hovered) return null;
    const gap = 12;
    const { width: tipWidth, height: tipHeight } = tipSize;
    const crossX = MARGIN.left + x(hovered.ts);
    const left = Math.min(Math.max(crossX - tipWidth / 2, 4), Math.max(4, width - tipWidth - 4));

    let highest = Infinity;
    let lowest = -Infinity;
    for (const point of drawn) {
      const px = MARGIN.left + x(point.ts);
      if (px < left - 4 || px > left + tipWidth + 4) continue;
      for (const item of series) {
        const value = point[item.key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const py = MARGIN.top + y(value);
        highest = Math.min(highest, py);
        lowest = Math.max(lowest, py);
      }
    }
    if (!Number.isFinite(highest)) return { left, top: MARGIN.top };

    const fitsAbove = highest - gap - tipHeight >= 0;
    const fitsBelow = lowest + gap + tipHeight <= MARGIN.top + innerHeight;
    const side =
      (lastSide.current === "above" && fitsAbove) || (lastSide.current === "below" && fitsBelow)
        ? lastSide.current
        : fitsAbove
          ? "above"
          : fitsBelow
            ? "below"
            : "beside";
    lastSide.current = side;

    if (side === "above") return { left, top: highest - gap - tipHeight };
    if (side === "below") return { left, top: lowest + gap };
    const beside = crossX + gap + tipWidth <= width - 4 ? crossX + gap : Math.max(4, crossX - gap - tipWidth);
    return { left: beside, top: Math.max(0, Math.min(highest - tipHeight / 2, height - tipHeight)) };
  }, [hovered, tipSize, drawn, series, x, y, width, height, innerHeight]);

  // A popup that just appeared goes straight to its spot. Gliding in from
  // wherever the last hover left it would look like it flew across the chart.
  const [glide, setGlide] = useState(false);
  useEffect(() => {
    if (!hovering) {
      setGlide(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(frame);
  }, [hovering]);

  const inBand = hovered && band ? band.spans.some((span) => hovered.ts >= span.from && hovered.ts <= span.to) : false;
  const hasData = drawn.length > 0 && width > 0;

  const handleMove = (event: React.PointerEvent<SVGRectElement>) => {
    setHovering(true);
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
                {index === 0 || format(tick, maxValue) !== format(yTicks[index - 1], maxValue) ? (
                  <text
                    x={-10}
                    y={y(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className={cn("text-[10px] tabular", index === yTicks.length - 1 ? "fill-foreground/70" : "fill-muted-foreground")}
                  >
                    {format(tick, maxValue)}
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

            {band?.spans.map((span) => {
              const left = Math.max(0, x(span.from));
              const right = Math.min(innerWidth, x(span.to));
              if (right <= left) return null;
              return (
                <rect
                  key={span.from}
                  x={left}
                  y={0}
                  width={right - left}
                  height={innerHeight}
                  fill="hsl(var(--foreground) / 0.07)"
                />
              );
            })}

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
              // Moved with transforms so the browser can glide them between
              // points instead of jumping from one to the next.
              <g
                className="pointer-events-none transition-opacity duration-150"
                style={{ opacity: hovering ? 1 : 0 }}
              >
                <line
                  x1={0}
                  x2={0}
                  y1={0}
                  y2={innerHeight}
                  stroke="hsl(var(--foreground) / 0.25)"
                  strokeWidth={1}
                  style={{ transform: `translateX(${x(hovered.ts)}px)`, transition: GLIDE }}
                />
                {series.map((item) => {
                  const value = hovered[item.key];
                  if (typeof value !== "number" || !Number.isFinite(value)) return null;
                  return (
                    <circle
                      key={item.key}
                      cx={0}
                      cy={0}
                      r={4}
                      fill={item.color}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      style={{ transform: `translate(${x(hovered.ts)}px, ${y(value)}px)`, transition: GLIDE }}
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
              onPointerMove={handleMove}
              onPointerDown={handleMove}
              onPointerLeave={() => setHovering(false)}
            />
          </g>
        </svg>
      ) : null}

      {hovered && tipPosition ? (
        <div
          ref={tipRef}
          className="pointer-events-none absolute left-0 top-0 z-10 min-w-[9rem] rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl shadow-black/40 backdrop-blur"
          style={{
            transform: `translate3d(${Math.round(tipPosition.left)}px, ${Math.round(tipPosition.top)}px, 0)`,
            opacity: hovering ? 1 : 0,
            transition: `transform ${glide ? "160ms cubic-bezier(0.2, 0.7, 0.3, 1)" : "0s"}, opacity 150ms ease-out`,
          }}
          onTransitionEnd={(event) => {
            if (event.propertyName === "opacity" && !hovering) setHoverIndex(null);
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
          {band ? (
            <p className="mt-1 flex items-center gap-1.5 border-t border-border/60 pt-1 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-sm border border-border"
                style={{ background: inBand ? "hsl(var(--foreground) / 0.35)" : "transparent" }}
                aria-hidden
              />
              {inBand ? band.inside : band.outside}
            </p>
          ) : null}
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
export function ChartLegend({
  series,
  band,
  className,
}: {
  series: ChartSeries[];
  /** Names the shading, when the chart has any. */
  band?: string;
  className?: string;
}) {
  if (series.length < 2 && !band) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {series.length > 1
        ? series.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden />
              {item.label}
            </span>
          ))
        : null}
      {band ? (
        <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="h-2.5 w-3 rounded-sm" style={{ background: "hsl(var(--foreground) / 0.18)" }} aria-hidden />
          {band}
        </span>
      ) : null}
    </div>
  );
}
