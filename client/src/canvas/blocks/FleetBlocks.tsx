import { useState } from "react";
import { BellRing, CheckCircle2, LayoutGrid, History } from "lucide-react";
import type { CanvasBlockOf, CanvasDeviceSnapshot, CanvasUptimeDto } from "@beacon/shared";
import { Meter } from "@/components/charts/Meter";
import { Duration } from "@/components/RelativeTime";
import { StatusDot } from "@/components/ui/misc";
import { formatDuration, formatPercent, formatRate, formatTemperature } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBlockDevices, useBlockPoll, useCanvasData } from "../data";
import { pickerColor } from "../format";
import { BlockFrame, BlockNote } from "./BlockFrame";

function useEmptyFleet(ids: string[], block: { config: { select: { mode: string } } }): string | null {
  const { mode } = useCanvasData();
  if (ids.length > 0) return null;
  if (block.config.select.mode === "tag") return "No device has this tag.";
  return mode === "editor" ? "Pick devices in the block settings." : "No devices to show.";
}

/* ------------------------------------------------------------ device cards */

function DeviceCard({
  device,
  metrics,
  color,
}: {
  device: CanvasDeviceSnapshot;
  metrics: CanvasBlockOf<"devices">["config"]["metrics"];
  color?: string;
}) {
  const { options } = useCanvasData();
  const up = device.status === "online";
  const summary = device.summary;
  return (
    <div className={cn("rounded-md border border-border/70 bg-surface/60 p-3", !up && "opacity-70")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot online={up} />
          <span className="truncate text-sm font-medium text-foreground">{device.name}</span>
        </span>
        {!up ? <span className="shrink-0 text-2xs text-danger">Offline</span> : null}
      </div>
      <div className="mt-2.5 space-y-2">
        {metrics.includes("cpu") ? (
          <Meter label="CPU" color={color} value={up ? (summary.cpuPct ?? null) : null} valueLabel={up ? formatPercent(summary.cpuPct) : "—"} />
        ) : null}
        {metrics.includes("memory") ? (
          <Meter label="Memory" color={color} value={up ? (summary.memPct ?? null) : null} valueLabel={up ? formatPercent(summary.memPct) : "—"} />
        ) : null}
        {metrics.includes("disk") ? (
          <Meter label="Disk" color={color} value={summary.diskMaxPct ?? null} valueLabel={formatPercent(summary.diskMaxPct)} />
        ) : null}
        {metrics.includes("network") ? (
          <p className="flex justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Network</span>
            <span className="truncate text-foreground tabular">
              {up ? `↓ ${formatRate(summary.netRxBps ?? null, options.unitBase)} · ↑ ${formatRate(summary.netTxBps ?? null, options.unitBase)}` : "—"}
            </span>
          </p>
        ) : null}
        {metrics.includes("temperature") ? (
          <p className="flex justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Temperature</span>
            <span className="text-foreground tabular">{up ? formatTemperature(summary.cpuTempC ?? null, options.temperatureUnit) : "—"}</span>
          </p>
        ) : null}
        {metrics.includes("uptime") ? (
          <p className="flex justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Uptime</span>
            <span className="text-foreground tabular">{up ? formatDuration(summary.uptimeSec ?? null) : "—"}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DevicesBlock({ block }: { block: CanvasBlockOf<"devices"> }) {
  const { ids, snapshots } = useBlockDevices(block);
  const empty = useEmptyFleet(ids, block);
  return (
    <BlockFrame block={block} bodyClassName="overflow-y-auto scroll-slim">
      {empty ? (
        <BlockNote icon={LayoutGrid} text={empty} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          {snapshots.map((device) => (
            <DeviceCard key={device.id} device={device} metrics={block.config.metrics} color={pickerColor(block.config.color) || undefined} />
          ))}
        </div>
      )}
    </BlockFrame>
  );
}

/* ------------------------------------------------------------------ uptime */

function uptimeColor(value: number | null): string {
  if (value === null) return "hsl(var(--surface-3))";
  if (value >= 99.5) return "hsl(var(--success))";
  if (value >= 95) return "hsl(var(--warning))";
  return "hsl(var(--danger))";
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function UptimeRow({ device, days }: { device: CanvasUptimeDto["devices"][number]; days: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover === null ? null : { day: days[hover], value: device.values[hover] };
  return (
    <li>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate text-foreground">{device.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular">
          {hovered
            ? `${dayLabel(hovered.day)}: ${hovered.value === null ? "no data" : `${hovered.value.toFixed(hovered.value >= 99.95 || hovered.value === 0 ? 0 : 2)}%`}`
            : device.overall === null
              ? "no data"
              : `${device.overall.toFixed(2)}% uptime`}
        </span>
      </div>
      <div className="flex h-7 gap-[2px]" onPointerLeave={() => setHover(null)}>
        {device.values.map((value, index) => (
          <span
            key={days[index]}
            className={cn("min-w-0 flex-1 rounded-[2px] transition-opacity", hover !== null && hover !== index && "opacity-60")}
            style={{ background: uptimeColor(value) }}
            onPointerEnter={() => setHover(index)}
            aria-label={`${dayLabel(days[index])}: ${value === null ? "no data" : `${value}%`}`}
          />
        ))}
      </div>
    </li>
  );
}

export function UptimeBlock({ block }: { block: CanvasBlockOf<"uptime"> }) {
  const { fetchUptime } = useCanvasData();
  const { ids } = useBlockDevices(block);
  const empty = useEmptyFleet(ids, block);
  const { value, failed } = useBlockPoll(block, fetchUptime, 5 * 60_000);
  return (
    <BlockFrame block={block} bodyClassName="overflow-y-auto scroll-slim">
      {empty ? (
        <BlockNote icon={History} text={empty} />
      ) : !value ? (
        <BlockNote icon={History} text={failed ? "Could not load the history." : "Loading…"} />
      ) : (
        <div className="space-y-4">
          <ul className="space-y-4">
            {value.devices.map((device) => (
              <UptimeRow key={device.id} device={device} days={value.days} />
            ))}
          </ul>
          <div className="flex justify-between text-2xs text-muted-foreground">
            <span>{value.days.length} days ago</span>
            <span>Today</span>
          </div>
        </div>
      )}
    </BlockFrame>
  );
}

/* ------------------------------------------------------------------ alerts */

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

export function AlertsBlock({ block }: { block: CanvasBlockOf<"alerts"> }) {
  const { fetchAlerts } = useCanvasData();
  const { ids } = useBlockDevices(block);
  const empty = useEmptyFleet(ids, block);
  const { value, failed } = useBlockPoll(block, fetchAlerts, 30_000);
  const alerts = value?.alerts ?? [];
  return (
    <BlockFrame
      block={block}
      aside={alerts.length > 0 ? <span className="text-xs text-danger tabular">{alerts.length} active</span> : undefined}
      bodyClassName="overflow-y-auto scroll-slim"
    >
      {empty ? (
        <BlockNote icon={BellRing} text={empty} />
      ) : !value ? (
        <BlockNote icon={BellRing} text={failed ? "Could not load alerts." : "Loading…"} />
      ) : alerts.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <CheckCircle2 className="h-6 w-6 text-success" />
          <p className="text-sm font-medium text-foreground">All systems normal</p>
          <p className="text-2xs text-muted-foreground">No alerts are firing right now.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {alerts.map((alert) => (
            <li key={alert.id} className="flex items-start gap-2.5 text-sm">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[alert.severity] ?? "bg-muted-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{alert.ruleName}</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {alert.deviceName} · for <Duration from={alert.startedAt} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </BlockFrame>
  );
}
