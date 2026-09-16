import { useEffect, useMemo, useState } from "react";
import { Activity, Battery, BatteryCharging, Container, Cpu, HardDrive, MemoryStick } from "lucide-react";
import type { DeviceDto, DiskDevice, DiskUsage, MetricSample } from "@beacon/shared";
import { CoreBars } from "@/components/charts/CoreBars";
import { Meter } from "@/components/charts/Meter";
import { StatTile } from "@/components/StatTile";
import type { ChartSeries } from "@/components/charts/TimeChart";
import { ChartPanel } from "@/components/device/ChartPanel";
import { EmptyState } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSeries } from "@/hooks/useSeries";
import { SERIES } from "@/lib/colors";
import { gpuName } from "@/lib/gpu";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatRate,
  formatTemperature,
  type UnitBase,
} from "@/lib/format";

/**
 * A chosen card or drive outlives the page, so coming back to a device shows
 * what was left on screen rather than resetting to whichever one the agent
 * calls main. It is remembered by the name the dropdown shows, which is what
 * survives another one being added beside it.
 */
function remembered(kind: string, deviceId: string): string | null {
  try {
    return window.localStorage.getItem(`beacon:${kind}:${deviceId}`);
  } catch {
    return null;
  }
}

function remember(kind: string, deviceId: string, name: string): void {
  try {
    window.localStorage.setItem(`beacon:${kind}:${deviceId}`, name);
  } catch {
    /* private browsing has no storage, and the choice is not worth failing over */
  }
}

/** A drive's line in the dropdown: what it is, and how big. */
function driveLabel(drive: DiskDevice): string {
  const name = [drive.vendor, drive.name].filter(Boolean).join(" ").trim() || drive.device;
  return name === drive.device ? name : `${name} (${drive.device})`;
}

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
  const thermal = useSeries(device.id, rangeSeconds, ["cpuTempC"]);

  /*
   * Firmware and scratch filesystems are left out until this device's settings
   * ask for them, and a filesystem mounted at more than one path is one row
   * naming both, since a NAS commonly mounts the same volume twice.
   */
  const visibleDisks = useMemo(() => {
    const panels = device.settings.panels;
    const wanted = (detail?.disks ?? []).filter(
      (entry) => !panels.hiddenDisks.includes(entry.mount) && (panels.showSystemVolumes || !entry.system)
    );
    const merged = new Map<string, { disk: DiskUsage; mounts: string[] }>();
    for (const disk of wanted) {
      const key = `${disk.fs}:${disk.sizeBytes}:${disk.usedBytes}`;
      const existing = merged.get(key);
      if (existing) existing.mounts.push(disk.mount);
      else merged.set(key, { disk, mounts: [disk.mount] });
    }
    return [...merged.values()];
  }, [detail, device.settings.panels]);

  /*
   * Volumes under the drive they live on. A drive the agent could not name, and
   * a filesystem it could not place, both fall into a group of their own rather
   * than being dropped.
   */
  const volumeGroups = useMemo(() => {
    const drives = detail?.drives ?? [];
    const groups = new Map<string, { drive: DiskDevice | null; volumes: typeof visibleDisks }>();
    for (const entry of visibleDisks) {
      const key = entry.disk.device || "";
      const group = groups.get(key);
      if (group) group.volumes.push(entry);
      else groups.set(key, { drive: drives.find((drive) => drive.device === key) ?? null, volumes: [entry] });
    }
    // Named drives first, then whatever could not be placed.
    return [...groups.entries()]
      .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
      .map(([key, group]) => ({ key, ...group }));
  }, [visibleDisks, detail]);
  const visibleInterfaces = useMemo(
    () => (detail?.network ?? []).filter((entry) => !device.settings.panels.hiddenInterfaces.includes(entry.iface)),
    [detail, device.settings.panels.hiddenInterfaces]
  );

  /*
   * Every adapter the device reports, minus the ones this device's settings
   * leave out. The position is carried along because that is how the hub stores
   * a GPU's history, while the name is what the dropdown and the settings use.
   */
  const gpus = useMemo(
    () =>
      (detail?.gpus ?? [])
        .map((gpu, index) => ({ gpu, index, name: gpuName(gpu, index) }))
        .filter((entry) => !device.settings.panels.hiddenGpus.includes(entry.name)),
    [detail, device.settings.panels.hiddenGpus]
  );

  // The card with the most memory, which is the one the agent puts in the
  // summary, so the chart and the tile agree before anything is chosen.
  const mainGpu = useMemo(
    () => gpus.slice().sort((a, b) => (b.gpu.memoryTotalMb ?? 0) - (a.gpu.memoryTotalMb ?? 0))[0] ?? null,
    [gpus]
  );

  const [chosenGpu, setChosenGpu] = useState<string | null>(() => remembered("gpu", device.id));
  useEffect(() => setChosenGpu(remembered("gpu", device.id)), [device.id]);

  const selected = gpus.find((entry) => entry.name === chosenGpu) ?? mainGpu;
  const gpu = selected?.gpu ?? null;
  const gpuMemPct =
    gpu && gpu.memoryTotalMb && gpu.memoryUsedMb !== null
      ? Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 1000) / 10
      : null;

  const gpuHistory = useSeries(device.id, rangeSeconds, ["gpuPct", "gpuMemPct"], { gpu: selected?.index });

  /* Throughput is counted per drive, so the chart draws one drive at a time.
   * With a single drive there is nothing to choose and the dropdown stays away. */
  const drives = detail?.drives ?? [];
  const [chosenDrive, setChosenDrive] = useState<string | null>(() => remembered("disk", device.id));
  useEffect(() => setChosenDrive(remembered("disk", device.id)), [device.id]);

  /*
   * Until a drive is chosen, the one the system is installed on is the one
   * worth opening on, since it is the drive whose activity a person is usually
   * looking for. The largest stands in where the system volume cannot be
   * placed, so a machine never opens on a 256 MiB boot device by accident.
   */
  const systemVolume = (detail?.disks ?? []).find((entry) => entry.mount === "/" || /^c:/i.test(entry.mount));
  const defaultDrive =
    drives.find((entry) => entry.device && entry.device === systemVolume?.device) ??
    drives.slice().sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))[0] ??
    null;
  const drive = drives.find((entry) => entry.device === chosenDrive) ?? defaultDrive;
  const driveHistory = useSeries(device.id, rangeSeconds, ["diskReadBps", "diskWriteBps"], {
    disk: drive?.device,
  });

  // A card that reports its memory but not its load, and one that reports the
  // load but not the memory, are both common, so the GPU chart carries whatever
  // the device actually sends and stays monochrome when that is one series.
  const gpuSeries = useMemo(() => {
    const hasUsage = gpu?.utilizationPct != null;
    const hasMemory = gpuMemPct != null;
    const series: ChartSeries[] = [];
    if (hasUsage || !hasMemory) {
      series.push({ key: "gpuPct", label: "Usage", color: hasMemory ? SERIES.in : SERIES.ink });
    }
    if (hasMemory) {
      series.push({ key: "gpuMemPct", label: "Memory", color: hasUsage ? SERIES.out : SERIES.ink });
    }
    return series;
  }, [gpu?.utilizationPct, gpuMemPct]);

  // The axis now stops at the tallest sample, so a chart that never leaves
  // single digits needs a decimal to keep its labels apart.
  const percent = (value: number) => formatPercent(value, value < 10 ? 1 : 0);
  // `max` is the top of the axis: every label on one axis shares the unit that
  // suits it, rather than each tick picking its own.
  const rate = (value: number, max?: number) => formatRate(value, unitBase, max);

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
            value={drive ? formatRate((drive.readBps ?? 0) + (drive.writeBps ?? 0), unitBase) : undefined}
            series={[
              { key: "diskReadBps", label: "Read", color: SERIES.in },
              { key: "diskWriteBps", label: "Write", color: SERIES.out },
            ]}
            points={drive ? driveHistory.points : disk.points}
            from={drive ? driveHistory.from : disk.from}
            to={drive ? driveHistory.to : disk.to}
            format={rate}
            action={
              drives.length > 1 ? (
                <Select
                  value={drive?.device ?? ""}
                  onValueChange={(value) => {
                    setChosenDrive(value);
                    remember("disk", device.id, value);
                  }}
                >
                  <SelectTrigger className="h-8 w-48 text-xs [&>span]:truncate" aria-label="Which drive to chart">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-w-[22rem]">
                    {drives.map((entry) => (
                      <SelectItem key={entry.device} value={entry.device} className="truncate">
                        {driveLabel(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null
            }
            footer={
              drive ? (
                <p className="truncate text-xs text-muted-foreground">
                  {driveLabel(drive)}
                  {drive.sizeBytes ? ` · ${formatBytes(drive.sizeBytes, unitBase)}` : ""}
                  {drive.kind ? ` · ${drive.kind}` : ""}
                  {drive.interfaceType ? ` · ${drive.interfaceType}` : ""}
                  {drive.temperatureC !== null
                    ? ` · ${formatTemperature(drive.temperatureC, temperatureUnit)}`
                    : ""}
                </p>
              ) : null
            }
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

        {device.capabilities.gpu && gpus.length > 0 ? (
          <ChartPanel
            title="GPU usage"
            value={formatPercent(gpu?.utilizationPct ?? gpuMemPct)}
            series={gpuSeries}
            points={gpuHistory.points}
            from={gpuHistory.from}
            to={gpuHistory.to}
            format={percent}
            clampMax={100}
            action={
              gpus.length > 1 ? (
                <Select
                  value={selected?.name ?? ""}
                  onValueChange={(value) => {
                    setChosenGpu(value);
                    remember("gpu", device.id, value);
                  }}
                >
                  <SelectTrigger className="h-8 w-48 text-xs [&>span]:truncate" aria-label="Which GPU to chart">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-w-[22rem]">
                    {gpus.map((entry) => (
                      <SelectItem key={entry.name} value={entry.name} className="truncate">
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null
            }
            footer={
              <ul className="space-y-1 text-xs">
                {gpus.map((entry) => (
                  <li
                    key={entry.name}
                    className={cn(
                      "truncate",
                      entry.name === selected?.name ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {entry.name}
                    {entry.gpu.memoryTotalMb
                      ? ` · ${formatBytes((entry.gpu.memoryUsedMb ?? 0) * 1024 * 1024, unitBase)} of ${formatBytes(
                          entry.gpu.memoryTotalMb * 1024 * 1024,
                          unitBase
                        )}`
                      : ""}
                    {entry.gpu.temperatureC !== null
                      ? ` · ${formatTemperature(entry.gpu.temperatureC, temperatureUnit)}`
                      : ""}
                  </li>
                ))}
              </ul>
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
          <div className="divide-y divide-border/60">
            {volumeGroups.map((group) => (
              <div key={group.key || "unplaced"}>
                {/* A drive with nothing under it is not drawn, so the heading
                    only ever introduces volumes that follow it. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-surface/40 px-4 py-2">
                  <p className="min-w-0 truncate text-xs font-medium text-foreground">
                    {group.drive ? driveLabel(group.drive) : "Other volumes"}
                  </p>
                  <p className="shrink-0 text-2xs text-muted-foreground tabular">
                    {group.drive
                      ? [
                          group.drive.sizeBytes ? formatBytes(group.drive.sizeBytes, unitBase) : "",
                          group.drive.kind,
                          group.drive.interfaceType,
                          group.drive.temperatureC !== null
                            ? formatTemperature(group.drive.temperatureC, temperatureUnit)
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "Not matched to a drive"}
                  </p>
                </div>
                <ul className="divide-y divide-border/40">
                  {group.volumes.map(({ disk: volume, mounts }) => (
                    <li key={`${volume.fs}-${mounts[0]}`} className="px-4 py-3">
                      <Meter
                        label={mounts.filter(Boolean).join(" · ") || volume.fs}
                        value={volume.usePct}
                        valueLabel={formatPercent(volume.usePct)}
                        sublabel={`${formatBytes(volume.usedBytes, unitBase)} of ${formatBytes(volume.sizeBytes, unitBase)} used · ${volume.type || volume.fs}`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
