import type { MetricSummary } from "@beacon/shared";
import { CoreHeatmap, CoreHeatmapScale } from "@/components/charts/CoreHeatmap";
import type { ChartSeries } from "@/components/charts/TimeChart";
import { ChartPanel, DetailChart, type ChartPanelProps } from "@/components/device/ChartPanel";
import { useSeries } from "@/hooks/useSeries";

interface SummaryChartProps {
  deviceId: string;
  rangeSeconds: number;
  title: string;
  value?: string;
  /** Each series key is a summary field, which is what gets fetched. */
  series: (ChartSeries & { key: keyof MetricSummary })[];
  format: (value: number, axisMax?: number) => string;
  clampMax?: number;
  note?: string;
}

/**
 * An extra chart drawn from the summary fields. It fetches its own history, and
 * since the panel only renders it once opened, a closed panel costs nothing.
 */
export function SummaryChart({ deviceId, rangeSeconds, series, ...rest }: SummaryChartProps) {
  const history = useSeries(
    deviceId,
    rangeSeconds,
    series.map((item) => item.key)
  );
  return <DetailChart {...rest} series={series} points={history.points} from={history.from} to={history.to} />;
}

interface CoreChartProps {
  deviceId: string;
  rangeSeconds: number;
  cores: number;
}

export function CoreChart({ deviceId, rangeSeconds, cores }: CoreChartProps) {
  const history = useSeries(deviceId, rangeSeconds, [], { cores: true });
  return (
    <div className="px-2 pb-2 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3 px-2">
        <h4 className="text-xs font-medium text-foreground">Per core</h4>
        <CoreHeatmapScale />
      </div>
      <div className="pt-2">
        <CoreHeatmap points={history.points} cores={cores} from={history.from} to={history.to} />
      </div>
    </div>
  );
}

type SummaryPanelProps = Omit<ChartPanelProps, "points" | "from" | "to" | "series"> & {
  deviceId: string;
  rangeSeconds: number;
  series: (ChartSeries & { key: keyof MetricSummary })[];
};

/** A whole panel drawn from summary fields, for panels only some devices show. */
export function SummaryPanel({ deviceId, rangeSeconds, series, ...rest }: SummaryPanelProps) {
  const history = useSeries(
    deviceId,
    rangeSeconds,
    series.map((item) => item.key)
  );
  return <ChartPanel {...rest} series={series} points={history.points} from={history.from} to={history.to} />;
}
