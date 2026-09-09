import { useMemo } from "react";
import { Activity, Battery, BatteryCharging, Container, Cpu, HardDrive, MemoryStick } from "lucide-react";
import type { DeviceDto, MetricSample } from "@beacon/shared";
import { CoreBars } from "@/components/charts/CoreBars";
import { Meter } from "@/components/charts/Meter";
import { StatTile } from "@/components/StatTile";
import { ChartPanel } from "@/components/device/ChartPanel";
import { EmptyState } from "@/components/ui/misc";
import { useSeries } from "@/hooks/useSeries";
import { SERIES } from "@/lib/colors";
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatRate,
  formatTemperature,
  type UnitBase,
} from "@/lib/format";

interface OverviewTabProps {
  device: DeviceDto;
  sample: MetricSample | null;
  rangeSeconds: number;
  unitBase: UnitBase;
  temperatureUnit: "c" | "f";
}

export function OverviewTab({ device, sample, rangeSeconds, unitBase, temperatureUnit }: OverviewTabProps) {
  const summary = sample?.summary ?? null;
  const detail = sample?.detail ?? null;

  const cpu = useSeries(device.id, rangeSeconds, ["cpuPct"]);
  const memory = useSeries(device.id, rangeSeconds, ["memPct"]);
  const network = useSeries(device.id, rangeSeconds, ["netRxBps", "netTxBps"]);
  const disk = useSeries(device.id, rangeSeconds, ["diskReadBps", "diskWriteBps"]);
  const thermal = useSeries(device.id, rangeSeconds, ["cpuTempC", "gpuPct"]);

  const visibleDisks = useMemo(
    () => (detail?.disks ?? []).filter((entry) => !device.settings.panels.hiddenDisks.includes(entry.mount)),
    [detail, device.settings.panels.hiddenDisks]
  );
  const visibleInterfaces = useMemo(
    () => (detail?.network ?? []).filter((entry) => !device.settings.panels.hiddenInterfaces.includes(entry.iface)),
    [detail, device.settings.panels.hiddenInterfaces]
  );

  // The axis now stops at the tallest sample, so a chart that never leaves
  // single digits needs a decimal to keep its labels apart.
  const percent = (value: number) => formatPercent(value, value < 10 ? 1 : 0);
  const rate = (value: number) => formatRate(value, unitBase);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="CPU" value={formatPercent(summary?.cpuPct)} icon={Cpu} sublabel={
          summary?.load1 !== null && summary?.load1 !== undefined ? `load ${summary.load1.toFixed(2)}` : undefined
        } />
        <StatTile
          label="Memory"
          value={formatPercent(summary?.memPct)}
          icon={MemoryStick}
          sublabel={
            summary
              ? `${formatBytes(summary.memUsedBytes, unitBase)} of ${formatBytes(summary.memTotalBytes, unitBase)}`
              : undefined
          }
        />
        <StatTile
          label="Disk"
          value={formatPercent(summary?.diskMaxPct)}
          icon={HardDrive}
          sublabel={
            summary?.diskUsedBytes != null && summary?.diskTotalBytes != null
              ? `${formatBytes(summary.diskUsedBytes, unitBase)} of ${formatBytes(summary.diskTotalBytes, unitBase)}`
              : undefined
          }
        />
        <StatTile
          label="Uptime"
          value={formatDuration(summary?.uptimeSec ?? null)}
          icon={Activity}
          sublabel={summary?.processCount ? `${summary.processCount} processes` : undefined}
        />
        {device.capabilities.docker && summary?.containersTotal !== null && summary?.containersTotal !== undefined ? (
          <StatTile
            label="Containers"
            value={String(summary.containersRunning ?? 0)}
            icon={Container}
            sublabel={`${summary.containersTotal} total`}
          />
        ) : null}
        {detail?.battery ? (
          <StatTile
            label="Battery"
            value={formatPercent(detail.battery.percent)}
            icon={detail.battery.isCharging ? BatteryCharging : Battery}
            sublabel={
              detail.battery.isCharging
                ? "Charging"
                : detail.battery.minutesRemaining
                  ? `${formatDuration(detail.battery.minutesRemaining * 60)} remaining`
                  : "On battery"
            }
          />
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title="CPU usage"
          value={formatPercent(summary?.cpuPct)}
          series={[{ key: "cpuPct", label: "CPU", color: SERIES.ink }]}
          points={cpu.points}
          from={cpu.from}
          to={cpu.to}
          format={percent}
          clampMax={100}
          footer={
            detail && detail.cpu.perCore.length > 0 ? (
              <div className="space-y-2">
                <p className="text-2xs text-muted-foreground">Per core</p>
                <CoreBars cores={detail.cpu.perCore} />
              </div>
            ) : null
          }
        />

        <ChartPanel
          title="Memory usage"
          value={formatPercent(summary?.memPct)}
          series={[{ key: "memPct", label: "Memory", color: SERIES.ink }]}
          points={memory.points}
          from={memory.from}
          to={memory.to}
          format={percent}
          clampMax={100}
          footer={
            summary?.swapPct != null ? (
              <Meter label="Swap" value={summary.swapPct} valueLabel={formatPercent(summary.swapPct)} />
            ) : null
          }
        />

        <ChartPanel
          title="Network"
          series={[
            { key: "netRxBps", label: "Download", color: SERIES.in },
            { key: "netTxBps", label: "Upload", color: SERIES.out },
          ]}
          points={network.points}
          from={network.from}
          to={network.to}
          format={rate}
          footer={
            visibleInterfaces.length > 0 ? (
              <ul className="space-y-1.5">
                {visibleInterfaces.slice(0, 4).map((entry) => (
                  <li key={entry.iface} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground">{entry.iface}</span>
                    <span className="shrink-0 text-foreground tabular">
                      ↓ {formatRate(entry.rxBytesPerSec, unitBase)} · ↑ {formatRate(entry.txBytesPerSec, unitBase)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null
          }
        />

        {device.capabilities.diskIo ? (
          <ChartPanel
            title="Disk activity"
            series={[
              { key: "diskReadBps", label: "Read", color: SERIES.in },
              { key: "diskWriteBps", label: "Write", color: SERIES.out },
            ]}
            points={disk.points}
            from={disk.from}
            to={disk.to}
            format={rate}
          />
        ) : null}

        {device.capabilities.temperatures ? (
          <ChartPanel
            title="CPU temperature"
            value={formatTemperature(summary?.cpuTempC, temperatureUnit)}
            series={[{ key: "cpuTempC", label: "Temperature", color: SERIES.ink }]}
            points={thermal.points}
            from={thermal.from}
            to={thermal.to}
            format={(value) => formatTemperature(value, temperatureUnit)}
          />
        ) : null}

        {device.capabilities.gpu ? (
          <ChartPanel
            title="GPU usage"
            value={formatPercent(summary?.gpuPct)}
            series={[{ key: "gpuPct", label: "GPU", color: SERIES.ink }]}
            points={thermal.points}
            from={thermal.from}
            to={thermal.to}
            format={percent}
            clampMax={100}
            footer={
              detail && detail.gpus.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {detail.gpus.map((gpu, index) => (
                    <li key={index} className="truncate">
                      {[gpu.vendor, gpu.model].filter(Boolean).join(" ")}
                      {gpu.memoryTotalMb ? ` · ${Math.round(gpu.memoryUsedMb ?? 0)} / ${Math.round(gpu.memoryTotalMb)} MB` : ""}
                    </li>
                  ))}
                </ul>
              ) : null
            }
          />
        ) : null}
      </div>

      <section className="rounded-lg border border-border/70 bg-card">
        <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Volumes</h3>
        </header>
        {visibleDisks.length === 0 ? (
          <EmptyState icon={HardDrive} title="No volumes reported yet." />
        ) : (
          <ul className="divide-y divide-border/60">
            {visibleDisks.map((entry) => (
              <li key={`${entry.fs}-${entry.mount}`} className="px-4 py-3">
                <Meter
                  label={entry.mount || entry.fs}
                  value={entry.usePct}
                  valueLabel={formatPercent(entry.usePct)}
                  sublabel={`${formatBytes(entry.usedBytes, unitBase)} of ${formatBytes(entry.sizeBytes, unitBase)} used · ${entry.type || entry.fs}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
