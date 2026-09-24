import { useState, type ReactNode } from "react";
import { ChartLine, ChevronDown } from "lucide-react";
import { ChartLegend, TimeChart, type ChartSeries } from "@/components/charts/TimeChart";
import type { Point } from "@/components/charts/chartUtils";
import { cn } from "@/lib/utils";

/**
 * A chart that sits under the main one and only appears once the panel is
 * opened. `render` is called only while it is on screen, so its history is not
 * fetched for a panel nobody opened.
 */
export interface MoreChart {
  id: string;
  title: string;
  render: () => ReactNode;
}

export interface ChartPanelProps {
  title: string;
  value?: string;
  series: ChartSeries[];
  points: Point[];
  from: number;
  to: number;
  /** Passed the top of the axis too, so a unit can be picked for the scale. */
  format: (value: number, axisMax?: number) => string;
  clampMax?: number;
  height?: number;
  footer?: ReactNode;
  /** Sits beside the value, for a control that changes what the chart draws. */
  action?: ReactNode;
  /** Further charts on the same subject, folded away under the main one. */
  more?: MoreChart[];
  /**
   * Remembers whether the extra charts were left open, per kind of panel rather
   * than per device, so opening the CPU details once opens them everywhere.
   */
  moreKey?: string;
  /** Time to shade behind the line, passed straight to the chart. */
  band?: { spans: { from: number; to: number }[]; inside: string; outside: string };
  className?: string;
}

function rememberedOpen(key: string | undefined): boolean {
  if (!key) return false;
  try {
    return window.localStorage.getItem(`beacon:more:${key}`) === "1";
  } catch {
    return false;
  }
}

function rememberOpen(key: string | undefined, open: boolean): void {
  if (!key) return;
  try {
    window.localStorage.setItem(`beacon:more:${key}`, open ? "1" : "0");
  } catch {
    /* no storage in private browsing, and the panel still works without it */
  }
}

export function ChartPanel({
  title,
  value,
  series,
  points,
  from,
  to,
  format,
  clampMax,
  height = 210,
  footer,
  action,
  more = [],
  moreKey,
  band,
  className,
}: ChartPanelProps) {
  const [open, setOpen] = useState(() => rememberedOpen(moreKey));
  const expanded = open && more.length > 0;

  return (
    <section
      className={cn(
        "rounded-lg border border-border/70 bg-card",
        // Two or more extra charts get the full row, so they can sit side by side.
        expanded && more.length > 1 && "xl:col-span-2",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <ChartLegend series={series} band={band?.inside} className="mt-1.5" />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {action}
          {value ? <p className="text-lg font-semibold leading-none text-foreground">{value}</p> : null}
        </div>
      </header>
      <div className="px-2 pb-2 pt-3">
        <TimeChart
          points={points}
          series={series}
          from={from}
          to={to}
          format={format}
          clampMax={clampMax}
          height={height}
          band={band}
        />
      </div>

      {/* The footer reads the main chart's current value, so it stays with it,
          and the extra charts open below everything else. */}
      {footer ? <div className="border-t border-border/60 px-4 py-3">{footer}</div> : null}

      {more.length > 0 ? (
        <>
          <div className="border-t border-border/60 px-4 py-3">
            <button
              type="button"
              onClick={() => {
                setOpen(!open);
                rememberOpen(moreKey, !open);
              }}
              aria-expanded={expanded}
              className="flex w-full items-center gap-3 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-left transition-colors hover:border-foreground/25 hover:bg-surface-2"
            >
              <ChartLine className="h-4 w-4 shrink-0 text-foreground/80" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-foreground">
                  {expanded ? "Hide" : "Show"} {more.length} more {more.length === 1 ? "chart" : "charts"}
                </span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {more.map((chart) => chart.title).join(" · ")}
                </span>
              </span>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
              />
            </button>
          </div>
          {expanded ? (
            <div
              className={cn(
                "grid gap-px border-t border-border/60 bg-border/60",
                more.length > 1 && "lg:grid-cols-2"
              )}
            >
              {more.map((chart, index) => (
                <div
                  key={chart.id}
                  className={cn(
                    "bg-card",
                    // An odd one out takes the whole row rather than leaving a hole.
                    more.length % 2 === 1 && index === more.length - 1 && "lg:col-span-2"
                  )}
                >
                  {chart.render()}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

interface DetailChartProps {
  title: string;
  value?: string;
  series: ChartSeries[];
  points: Point[];
  from: number;
  to: number;
  format: (value: number, axisMax?: number) => string;
  clampMax?: number;
  note?: ReactNode;
}

/** One of the extra charts: the same chart, a little shorter, with its own title. */
export function DetailChart({ title, value, series, points, from, to, format, clampMax, note }: DetailChartProps) {
  return (
    <div className="px-2 pb-2 pt-3">
      <div className="flex items-start justify-between gap-3 px-2">
        <div>
          <h4 className="text-xs font-medium text-foreground">{title}</h4>
          <ChartLegend series={series} className="mt-1" />
        </div>
        {value ? <p className="shrink-0 text-sm font-semibold leading-none text-foreground tabular">{value}</p> : null}
      </div>
      <div className="pt-2">
        <TimeChart
          points={points}
          series={series}
          from={from}
          to={to}
          format={format}
          clampMax={clampMax}
          height={160}
        />
      </div>
      {note ? <div className="px-2 pb-1 text-2xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}
