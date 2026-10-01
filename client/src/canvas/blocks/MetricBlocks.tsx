import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge as GaugeIcon, LineChart } from "lucide-react";
import type { CanvasBlockOf, CanvasMetric, CanvasSeriesDto } from "@beacon/shared";
import { canvasMetric, canvasRangeLabel, sourceField, sourceValue, thresholdLevel } from "@beacon/shared";
import { ChartLegend, TimeChart, type ChartMarker, type ChartSeries } from "@/components/charts/TimeChart";
import { aggregate, bucketFor, linePaths, linearScale, peakOf } from "@/components/charts/chartUtils";
import { cn } from "@/lib/utils";
import { useBlockDevices, useBlockRange, useBlockSeries, useCanvasData } from "../data";
import { LEVEL_TEXT, MULTI_SERIES, drawColor, formatValue, pickerColor, unitFormatter } from "../format";
import { useBoxSize } from "../useBoxSize";
import { BlockFrame, BlockNote } from "./BlockFrame";

const LEVEL_FILL = {
  ok: "hsl(var(--series-ink))",
  warning: "hsl(var(--warning))",
  critical: "hsl(var(--danger))",
} as const;

const AGG_LABEL = { sum: "Total", avg: "Average", max: "Highest", min: "Lowest" } as const;

/** What sits under a number: the device it is from, or how a fleet was added up. */
function sourceCaption(block: CanvasBlockOf<"value"> | CanvasBlockOf<"gauge">, ids: string[], name: string | undefined): string {
  const target = block.config.source.target;
  if (target.kind === "fleet") return `${AGG_LABEL[target.agg]} of ${ids.length} ${ids.length === 1 ? "device" : "devices"}`;
  return name ?? "";
}

function useMissing(metric: CanvasMetric | undefined, ids: string[]): string | null {
  const { mode } = useCanvasData();
  if (!metric) return "This metric is no longer available.";
  if (ids.length === 0) return mode === "editor" ? "Pick a device in the block settings." : "No device to show.";
  return null;
}

/* ------------------------------------------------------------------- chart */

export function ChartBlock({ block }: { block: CanvasBlockOf<"chart"> }) {
  const data = useCanvasData();
  const source = block.config.source;
  const metric = canvasMetric(source.metric);
  const { ids } = useBlockDevices(block);
  const range = useBlockRange(block.config.range);
  const missing = useMissing(metric, ids);
  const { series, failed } = useBlockSeries(block, range, missing === null);
  const [chartRef, size] = useBoxSize<HTMLDivElement>();

  const keys = series?.keys ?? [];
  const chartSeries: ChartSeries[] = keys.map((entry, index) => ({
    key: entry.key,
    label: entry.label,
    color: keys.length === 1 ? drawColor(block.config.color) : MULTI_SERIES[index % MULTI_SERIES.length],
  }));
  const markers: ChartMarker[] = (series?.markers ?? []).map((marker) => ({
    ts: marker.ts,
    label: marker.label,
    tone: marker.severity === "critical" ? "danger" : marker.severity === "warning" ? "warning" : "info",
  }));

  const split = source.target.kind === "fleet" && source.target.split;
  const current =
    metric && block.config.showValue && !split && keys.length > 0
      ? keys
          .slice(0, 3)
          .map((entry) => formatValue(sourceValue({ ...source, field: entry.key }, ids, data.devices), metric.unit, data.options))
          .join(" · ")
      : null;

  const aside = (
    <>
      {block.config.range !== null ? (
        <span className="shrink-0 rounded border border-border px-1.5 text-2xs text-muted-foreground">{canvasRangeLabel(range)}</span>
      ) : null}
      {current ? <span className="truncate text-sm font-semibold text-foreground tabular">{current}</span> : null}
    </>
  );

  return (
    <BlockFrame block={block} aside={aside} bodyClassName={block.frame ? "px-1 pb-1" : undefined}>
      {missing ? (
        <BlockNote icon={LineChart} text={missing} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {block.config.legend && chartSeries.length > 1 ? (
            <ChartLegend series={chartSeries} className={cn("shrink-0 pb-1", block.frame && "px-3")} />
          ) : null}
          <div ref={chartRef} className="min-h-0 flex-1">
            {size.height > 40 && metric ? (
              <TimeChart
                points={series?.points ?? []}
                series={chartSeries}
                from={series?.from ?? Date.now() - range * 1000}
                to={series?.to ?? Date.now()}
                format={unitFormatter(metric.unit, data.options)}
                clampMax={metric.max}
                height={size.height}
                markers={markers}
                emptyLabel={failed ? "Could not load this chart." : series ? "No data for this range yet." : "Loading…"}
              />
            ) : null}
          </div>
        </div>
      )}
    </BlockFrame>
  );
}

/* --------------------------------------------------------------- sparkline */

function Sparkline({ series, color, clamp }: { series: CanvasSeriesDto; color: string; clamp?: number }) {
  const [ref, size] = useBoxSize<HTMLDivElement>();
  const key = series.keys[0]?.key ?? "";
  const drawn = useMemo(() => {
    if (!key || size.width === 0) return null;
    const bucket = bucketFor(series.to - series.from, Math.max(12, Math.min(80, Math.round(size.width / 6))));
    const points = aggregate(series.points, [key], bucket);
    const top = peakOf(points, [key], { clamp });
    const x = linearScale([series.from, series.to], [0, size.width]);
    const y = linearScale([0, top], [size.height - 1, 1]);
    return linePaths(points, key, x, y);
  }, [series, key, size, clamp]);

  return (
    <div ref={ref} className="h-full w-full">
      {drawn && size.height > 0 ? (
        <svg width={size.width} height={size.height} aria-hidden className="overflow-visible">
          {drawn.map((segment, index) => (
            <g key={index}>
              <path d={segment.area} fill={color} fillOpacity={0.12} />
              <path d={segment.line} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- value */

export function ValueBlock({ block }: { block: CanvasBlockOf<"value"> }) {
  const data = useCanvasData();
  const source = block.config.source;
  const metric = canvasMetric(source.metric);
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useMissing(metric, ids);
  const range = useBlockRange(block.config.range);
  const wantSpark = block.config.sparkline && Boolean(metric?.chart) && missing === null;
  const { series } = useBlockSeries(block, range, wantSpark);

  const value = sourceValue(source, ids, data.devices);
  const level = thresholdLevel(value, block.config.thresholds);
  const label =
    block.title || (metric ? `${metric.label}${metric.fields.length > 1 ? ` ${metric.fields.find((field) => field.key === sourceField(metric, source))?.label.toLowerCase() ?? ""}` : ""}` : "");
  const caption = block.config.caption || sourceCaption(block, ids, snapshots[0]?.name);
  const offline = source.target.kind === "device" && snapshots[0]?.status !== "online";
  // The chosen colour while the reading is fine, the limit's colour past one.
  const accent = pickerColor(block.config.color);
  const numberColor = level === "ok" && accent ? accent : LEVEL_TEXT[level];

  return (
    <BlockFrame block={block} hideTitle bodyClassName="flex flex-col">
      {missing ? (
        <BlockNote icon={Activity} text={missing} />
      ) : (
        <>
          <p className="shrink-0 truncate text-xs text-muted-foreground">{label}</p>
          <div className="min-h-0 flex-1" style={{ containerType: "size" }}>
            <p
              className="flex h-full items-center font-semibold leading-none tracking-tight tabular"
              style={{
                color: offline ? "hsl(var(--muted-foreground))" : numberColor,
                fontSize: "clamp(1rem, min(62cqh, 19cqw), 6rem)",
              }}
            >
              <span className="truncate">{metric ? formatValue(value, metric.unit, data.options) : "—"}</span>
            </p>
          </div>
          {caption || offline ? (
            <p className="shrink-0 truncate text-2xs text-muted-foreground">
              {caption}
              {offline ? `${caption ? " · " : ""}offline` : ""}
            </p>
          ) : null}
          {wantSpark && series && block.h >= 3 ? (
            <div className="mt-2 h-[28%] min-h-[18px] shrink-0">
              <Sparkline series={series} color={level === "ok" ? drawColor(block.config.color) : LEVEL_FILL[level]} clamp={metric?.max} />
            </div>
          ) : null}
        </>
      )}
    </BlockFrame>
  );
}

/* ------------------------------------------------------------------- gauge */

function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function arc(cx: number, cy: number, radius: number, start: number, end: number): string {
  const [sx, sy] = polar(cx, cy, radius, start);
  const [ex, ey] = polar(cx, cy, radius, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`;
}

export function GaugeBlock({ block }: { block: CanvasBlockOf<"gauge"> }) {
  const data = useCanvasData();
  const source = block.config.source;
  const metric = canvasMetric(source.metric);
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useMissing(metric, ids);

  const value = sourceValue(source, ids, data.devices);
  const max = block.config.max ?? metric?.max ?? 100;
  const share = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  // Starts empty and fills up to the reading, then follows it from there.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(frame);
  }, [share]);
  const level = thresholdLevel(value, block.config.thresholds);
  // The chosen colour while the reading is fine. Past a limit the limit's own
  // colour takes over, since that is what it is there to show.
  const fill = level === "ok" ? drawColor(block.config.color) : LEVEL_FILL[level];
  const text = metric ? formatValue(value, metric.unit, data.options) : "—";
  const label = block.title || metric?.label || "";
  const caption = sourceCaption(block, ids, snapshots[0]?.name);

  if (missing) {
    return (
      <BlockFrame block={block} hideTitle>
        <BlockNote icon={GaugeIcon} text={missing} />
      </BlockFrame>
    );
  }

  if (block.config.style === "bar") {
    return (
      <BlockFrame block={block} hideTitle bodyClassName="flex flex-col justify-center gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="shrink-0 text-xl font-semibold tabular" style={{ color: LEVEL_TEXT[level] }}>
            {text}
          </p>
        </div>
        <div
          className="h-3 w-full overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${fill} 22%, hsl(var(--surface-2)))` }}
          role="meter"
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${shown * 100}%`, background: fill }} />
        </div>
        {caption ? <p className="truncate text-2xs text-muted-foreground">{caption}</p> : null}
      </BlockFrame>
    );
  }

  const start = -135;
  const end = 135;
  return (
    <BlockFrame block={block} hideTitle bodyClassName="flex flex-col">
      <p className="shrink-0 truncate text-xs text-muted-foreground">{label}</p>
      <div className="min-h-0 flex-1">
        <svg viewBox="0 0 100 84" className="h-full w-full" role="meter" aria-label={label} aria-valuenow={Math.round(share * 100)}>
          <path d={arc(50, 50, 38, start, end)} fill="none" stroke={`color-mix(in srgb, ${fill} 22%, hsl(var(--surface-2)))`} strokeWidth={9} strokeLinecap="round" />
          {/* The same arc, drawn only as far as the reading. Moving the end of
              the dash fills the dial like a bar charging up, where changing
              the arc itself made it swing round. */}
          <path
            d={arc(50, 50, 38, start, end)}
            fill="none"
            stroke={fill}
            strokeWidth={9}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${shown * 100} 100`}
            opacity={shown > 0 ? 1 : 0}
            style={{ transition: "stroke-dasharray 700ms ease-out, stroke 300ms" }}
          />
          <text x={50} y={55} textAnchor="middle" className="tabular" style={{ fontSize: 15, fontWeight: 600, fill: LEVEL_TEXT[level] }}>
            {text}
          </text>
        </svg>
      </div>
      {/* Under the dial rather than inside it, so a long caption never runs into the ring. */}
      {caption ? <p className="mt-1 shrink-0 truncate text-center text-2xs text-muted-foreground">{caption}</p> : null}
    </BlockFrame>
  );
}
