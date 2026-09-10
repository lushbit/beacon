import { Container } from "lucide-react";
import type { DeviceDto, MetricSample } from "@beacon/shared";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { RelativeTime } from "@/components/RelativeTime";
import { formatBytes, formatPercent, type UnitBase } from "@/lib/format";

function stateTone(state: string): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "running":
      return "success";
    case "restarting":
    case "paused":
      return "warning";
    case "exited":
    case "dead":
      return "danger";
    default:
      return "neutral";
  }
}

export function ContainersTab({
  device,
  sample,
  unitBase,
}: {
  device: DeviceDto;
  sample: MetricSample | null;
  unitBase: UnitBase;
}) {
  const containers = sample?.detail.containers ?? [];

  if (!device.capabilities.docker) {
    return (
      <EmptyState
        icon={Container}
        title="No Docker daemon on this device."
        description="The agent looks for a Docker socket when it starts. If Docker was installed afterwards, restart the agent to pick it up."
      />
    );
  }

  if (containers.length === 0) {
    return <EmptyState icon={Container} title="No containers on this device yet." />;
  }

  const running = containers.filter((entry) => entry.state === "running").length;

  return (
    <div className="space-y-3">
      <p className="text-2xs text-muted-foreground">
        {running} running of {containers.length}
      </p>

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
        {/* Stacked rows on phones; the table needs more width than one has. */}
        <ul className="divide-y divide-border/40 sm:hidden">
          {containers.map((entry) => (
            <li key={entry.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{entry.name}</p>
                  <p className="truncate text-2xs text-muted-foreground" title={entry.image}>
                    {entry.image}
                  </p>
                </div>
                <Badge tone={stateTone(entry.state)}>{entry.state || "unknown"}</Badge>
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                <div className="flex gap-1">
                  <dt>CPU</dt>
                  <dd className="text-foreground tabular">{formatPercent(entry.cpuPct, 1)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Memory</dt>
                  <dd className="text-foreground tabular">
                    {entry.memUsedBytes === null ? "—" : formatBytes(entry.memUsedBytes, unitBase)}
                  </dd>
                </div>
                {entry.createdAt ? (
                  <div className="flex gap-1">
                    <dt>Created</dt>
                    <dd className="tabular">
                      <RelativeTime value={entry.createdAt} />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>

        <div className="scroll-slim hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Container</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 text-right font-medium">CPU</th>
                <th className="px-3 py-2 text-right font-medium">Memory</th>
                <th className="px-3 py-2 text-right font-medium">Network</th>
                <th className="px-3 py-2 text-right font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {containers.map((entry) => (
                <tr key={entry.id} className="hover:bg-white/[0.02]">
                  <td className="max-w-[18rem] px-4 py-2">
                    <p className="truncate text-foreground">{entry.name}</p>
                    <p className="truncate text-2xs text-muted-foreground" title={entry.image}>
                      {entry.image}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={stateTone(entry.state)}>{entry.state || "unknown"}</Badge>
                    {entry.restartCount ? (
                      <span className="ml-2 text-2xs text-muted-foreground">{entry.restartCount} restarts</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground tabular">{formatPercent(entry.cpuPct, 1)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular">
                    {entry.memUsedBytes === null
                      ? "—"
                      : `${formatBytes(entry.memUsedBytes, unitBase)}${
                          entry.memLimitBytes ? ` / ${formatBytes(entry.memLimitBytes, unitBase)}` : ""
                        }`}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular">
                    {entry.netRxBytes === null && entry.netTxBytes === null
                      ? "—"
                      : `↓ ${formatBytes(entry.netRxBytes ?? 0, unitBase)} · ↑ ${formatBytes(entry.netTxBytes ?? 0, unitBase)}`}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular">
                    {entry.createdAt ? <RelativeTime value={entry.createdAt} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-2xs text-muted-foreground">
        Network totals are counted since each container started, not per second.
      </p>
    </div>
  );
}
