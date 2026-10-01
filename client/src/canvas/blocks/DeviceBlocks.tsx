import { Box, Cpu, HardDrive, Info, Radio } from "lucide-react";
import type { CanvasBlockOf, CanvasDeviceSnapshot, CanvasInfoField } from "@beacon/shared";
import { CANVAS_INFO_LABELS } from "@beacon/shared";
import { CoreBars } from "@/components/charts/CoreBars";
import { CoreHeatmap, CoreHeatmapScale } from "@/components/charts/CoreHeatmap";
import { Meter } from "@/components/charts/Meter";
import { RelativeTime } from "@/components/RelativeTime";
import { StatusDot } from "@/components/ui/misc";
import { formatBytes, formatDateTime, formatDuration, formatPercent, platformName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBlockDevices, useBlockRange, useBlockSeries, useCanvasData } from "../data";
import { pickerColor } from "../format";
import { useBoxSize } from "../useBoxSize";
import { BlockFrame, BlockNote } from "./BlockFrame";

function useNoDevice(ids: string[]): string | null {
  const { mode } = useCanvasData();
  if (ids.length > 0) return null;
  return mode === "editor" ? "Pick a device in the block settings." : "No device to show.";
}

function statusText(device: CanvasDeviceSnapshot) {
  if (device.status === "online") return "Online";
  if (device.status === "never") return "Never connected";
  return (
    <>
      Offline · <RelativeTime value={device.lastSeenAt} />
    </>
  );
}

/* ------------------------------------------------------------------ status */

export function StatusBlock({ block }: { block: CanvasBlockOf<"status"> }) {
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useNoDevice(ids);
  const online = snapshots.filter((device) => device.status === "online").length;

  if (missing) {
    return (
      <BlockFrame block={block}>
        <BlockNote icon={Radio} text={missing} />
      </BlockFrame>
    );
  }

  if (snapshots.length === 1) {
    const device = snapshots[0];
    const up = device.status === "online";
    return (
      <BlockFrame block={block} bodyClassName="flex flex-col justify-center">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              up ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
            )}
          >
            <StatusDot online={up} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-tight text-foreground">{up ? "Online" : "Offline"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {device.name}
              {!up && device.lastSeenAt ? (
                <>
                  {" · last seen "}
                  <RelativeTime value={device.lastSeenAt} />
                </>
              ) : null}
            </p>
          </div>
        </div>
      </BlockFrame>
    );
  }

  return (
    <BlockFrame
      block={block}
      aside={
        <span className={cn("text-xs tabular", online === snapshots.length ? "text-success" : online === 0 ? "text-danger" : "text-warning")}>
          {online} of {snapshots.length} online
        </span>
      }
      bodyClassName="overflow-y-auto scroll-slim"
    >
      <ul className="space-y-2">
        {snapshots.map((device) => (
          <li key={device.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <StatusDot online={device.status === "online"} />
              <span className="truncate text-foreground">{device.name}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{statusText(device)}</span>
          </li>
        ))}
      </ul>
    </BlockFrame>
  );
}

/* -------------------------------------------------------------------- info */

function infoValue(field: CanvasInfoField, device: CanvasDeviceSnapshot) {
  const info = device.info ?? {};
  switch (field) {
    case "os":
      return info.os || null;
    case "platform":
      return info.platform ? platformName(info.platform) : null;
    case "kernel":
      return info.kernel || null;
    case "arch":
      return info.arch || null;
    case "cpu":
      return info.cpu || null;
    case "cores":
      if (info.cores == null) return null;
      return info.physicalCores && info.physicalCores !== info.cores
        ? `${info.cores} threads, ${info.physicalCores} cores`
        : `${info.cores}`;
    case "memory":
      return info.memoryBytes != null ? formatBytes(info.memoryBytes) : null;
    case "uptime":
      return device.status === "online" && device.summary.uptimeSec != null ? formatDuration(device.summary.uptimeSec) : null;
    case "bootedAt":
      return info.bootedAt ? formatDateTime(info.bootedAt) : null;
    case "model":
      return info.model || null;
    case "virtual":
      return info.virtual == null ? null : info.virtual ? "Yes" : "No";
    case "agent":
      return info.agent || null;
    case "lastSeen":
      return device.status === "online" ? "Now" : <RelativeTime value={device.lastSeenAt} />;
  }
}

export function InfoBlock({ block }: { block: CanvasBlockOf<"info"> }) {
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useNoDevice(ids);
  const device = snapshots[0];
  const [ref, size] = useBoxSize<HTMLDivElement>();
  // Too narrow for a label and a value side by side, each fact takes two lines
  // instead of cutting the value short.
  const stacked = size.width > 0 && size.width < 300;
  return (
    <BlockFrame block={block} bodyClassName="overflow-y-auto scroll-slim">
      <div ref={ref} className="h-full">
        {missing || !device ? (
          <BlockNote icon={Info} text={missing ?? "No device to show."} />
        ) : stacked ? (
          <dl className="space-y-2 text-sm">
            {block.config.fields.map((field) => (
              <div key={field} className="min-w-0">
                <dt className="truncate text-2xs text-muted-foreground">{CANVAS_INFO_LABELS[field]}</dt>
                <dd className="break-words text-foreground tabular">{infoValue(field, device) ?? "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {block.config.fields.map((field) => (
              <div key={field} className="contents">
                <dt className="truncate text-muted-foreground">{CANVAS_INFO_LABELS[field]}</dt>
                <dd className="truncate text-right text-foreground tabular" title={typeof infoValue(field, device) === "string" ? (infoValue(field, device) as string) : undefined}>
                  {infoValue(field, device) ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </BlockFrame>
  );
}

/* ----------------------------------------------------------------- volumes */

export function VolumesBlock({ block }: { block: CanvasBlockOf<"volumes"> }) {
  const { options } = useCanvasData();
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useNoDevice(ids);
  const volumes = snapshots[0]?.volumes ?? [];
  return (
    <BlockFrame block={block} bodyClassName="overflow-y-auto scroll-slim">
      {missing ? (
        <BlockNote icon={HardDrive} text={missing} />
      ) : volumes.length === 0 ? (
        <BlockNote icon={HardDrive} text="No volumes reported yet." />
      ) : (
        <ul className="space-y-3">
          {volumes.map((volume) => (
            <li key={volume.mount}>
              <Meter
                label={volume.mount}
                value={volume.usePct}
                valueLabel={formatPercent(volume.usePct)}
                color={pickerColor(block.config.color) || undefined}
                sublabel={`${formatBytes(volume.usedBytes, options.unitBase)} of ${formatBytes(volume.sizeBytes, options.unitBase)}${volume.type ? ` · ${volume.type}` : ""}`}
              />
            </li>
          ))}
        </ul>
      )}
    </BlockFrame>
  );
}

/* -------------------------------------------------------------- containers */

export function ContainersBlock({ block }: { block: CanvasBlockOf<"containers"> }) {
  const { options } = useCanvasData();
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useNoDevice(ids);
  const all = snapshots[0]?.containers ?? [];
  const running = all.filter((container) => container.state === "running");
  const shown = (block.config.runningOnly ? running : all).slice().sort((a, b) => {
    if ((a.state === "running") !== (b.state === "running")) return a.state === "running" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return (
    <BlockFrame
      block={block}
      aside={!missing && all.length > 0 ? <span className="text-xs text-muted-foreground tabular">{running.length} of {all.length} running</span> : undefined}
      bodyClassName="overflow-y-auto scroll-slim"
    >
      {missing ? (
        <BlockNote icon={Box} text={missing} />
      ) : shown.length === 0 ? (
        <BlockNote icon={Box} text="No containers on this device." />
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-1.5 font-medium">Container</th>
              <th className="w-16 pb-1.5 text-right font-medium">CPU</th>
              <th className="w-20 pb-1.5 text-right font-medium">Memory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {shown.map((container) => (
              <tr key={container.name}>
                <td className="py-1.5 pr-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", container.state === "running" ? "bg-success" : "bg-muted-foreground/50")}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{container.name}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{container.image}</span>
                    </span>
                  </span>
                </td>
                <td className="py-1.5 text-right text-foreground tabular">
                  {container.state === "running" ? formatPercent(container.cpuPct, 1) : "—"}
                </td>
                <td className="py-1.5 text-right text-foreground tabular">
                  {container.state === "running" ? formatBytes(container.memUsedBytes, options.unitBase) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </BlockFrame>
  );
}

/* ------------------------------------------------------------------- cores */

export function CoresBlock({ block }: { block: CanvasBlockOf<"cores"> }) {
  const { ids, snapshots } = useBlockDevices(block);
  const missing = useNoDevice(ids);
  const range = useBlockRange(block.config.range);
  const heatmap = block.config.style === "heatmap";
  const { series } = useBlockSeries(block, range, heatmap && missing === null);
  const perCore = snapshots[0]?.perCore ?? [];
  const cores = Math.max(perCore.length, series?.keys.length ?? 0);
  const color = pickerColor(block.config.color) || undefined;

  return (
    <BlockFrame
      block={block}
      aside={heatmap && !missing ? <CoreHeatmapScale color={color} /> : undefined}
      bodyClassName={cn("overflow-y-auto scroll-slim", heatmap && block.frame && "px-1")}
    >
      {missing ? (
        <BlockNote icon={Cpu} text={missing} />
      ) : cores === 0 ? (
        <BlockNote icon={Cpu} text="No per-core readings yet." />
      ) : heatmap ? (
        <CoreHeatmap points={series?.points ?? []} cores={cores} color={color} from={series?.from ?? Date.now() - range * 1000} to={series?.to ?? Date.now()} />
      ) : (
        <div className="flex h-full items-end">
          <CoreBars cores={perCore} color={color} className="w-full" />
        </div>
      )}
    </BlockFrame>
  );
}
