import type { ReactNode } from "react";
import { ChartLegend, TimeChart, type ChartSeries } from "@/components/charts/TimeChart";
import type { Point } from "@/components/charts/chartUtils";
import { cn } from "@/lib/utils";

interface ChartPanelProps {
  title: string;
  value?: string;
  series: ChartSeries[];
  points: Point[];
  from: number;
  to: number;
  format: (value: number) => string;
  clampMax?: number;
  height?: number;
  footer?: ReactNode;
  className?: string;
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
  className,
}: ChartPanelProps) {
  return (
    <section className={cn("rounded-lg border border-border/70 bg-card", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <ChartLegend series={series} className="mt-1.5" />
        </div>
        {value ? <p className="shrink-0 text-lg font-semibold leading-none text-foreground">{value}</p> : null}
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
        />
      </div>
      {footer ? <div className="border-t border-border/60 px-4 py-3">{footer}</div> : null}
    </section>
  );
}
