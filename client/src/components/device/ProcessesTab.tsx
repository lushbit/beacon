import { useCallback, useEffect, useState } from "react";
import { ListTree, Pause, Play, RefreshCw, Square } from "lucide-react";
import type { DeviceDto, ProcessSummary } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useIsAdmin } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { formatBytes, type UnitBase } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortBy = "cpu" | "mem";

export function ProcessesTab({
  device,
  online,
  unitBase,
}: {
  device: DeviceDto;
  online: boolean;
  unitBase: UnitBase;
}) {
  const isAdmin = useIsAdmin();
  const { attempt } = useToast();
  const [processes, setProcesses] = useState<ProcessSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("cpu");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pending, setPending] = useState<ProcessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!online) {
      setProcesses(null);
      return;
    }
    try {
      const result = await api.processes(device.id, { limit: 60, sortBy });
      setProcesses(result.processes);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the process list.");
    }
  }, [device.id, sortBy, online]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !online) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load, online]);

  const kill = async (signal: "term" | "kill") => {
    if (!pending) return;
    const done = await attempt(
      () => api.killProcess(device.id, { pid: pending.pid, signal }),
      `Sent ${signal === "kill" ? "SIGKILL" : "SIGTERM"} to ${pending.name}.`
    );
    setPending(null);
    if (done) window.setTimeout(() => void load(), 800);
  };

  if (!online) {
    return <EmptyState icon={ListTree} title="Device is offline." description="Processes can only be read live." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md bg-surface-2 p-1">
          {(["cpu", "mem"] as SortBy[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              aria-pressed={sortBy === key}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                sortBy === key ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {key === "cpu" ? "By CPU" : "By memory"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-2xs text-muted-foreground tabular">{total} running</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoRefresh((current) => !current)}
            aria-pressed={autoRefresh}
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
        {processes === null ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-6" />
            ))}
          </div>
        ) : processes.length === 0 ? (
          <EmptyState icon={ListTree} title="No processes reported." />
        ) : (
          <>
            {/* Phones get stacked rows; a 6-column table only works with a mouse. */}
            <ul className="divide-y divide-border/40 sm:hidden">
              {processes.map((process) => (
                <li key={`${process.pid}-${process.name}`} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground" title={process.command}>
                      {process.name}
                    </p>
                    <p className="truncate text-2xs text-muted-foreground">
                      {process.user || "—"} · pid {process.pid}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm text-foreground tabular">{process.cpuPct.toFixed(1)}%</p>
                    <p className="text-2xs text-muted-foreground tabular">
                      {formatBytes(process.memBytes, unitBase)}
                    </p>
                  </div>
                  {isAdmin && device.settings.allowProcessKill ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`End ${process.name}`}
                      onClick={() => setPending(process)}
                      className="shrink-0"
                    >
                      <Square className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="scroll-slim hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Process</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 text-right font-medium">CPU</th>
                    <th className="px-3 py-2 text-right font-medium">Memory</th>
                    <th className="px-3 py-2 text-right font-medium">PID</th>
                    {isAdmin && device.settings.allowProcessKill ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {processes.map((process) => (
                    <tr key={`${process.pid}-${process.name}`} className="hover:bg-white/[0.02]">
                      <td className="max-w-[16rem] truncate px-4 py-2 text-foreground" title={process.command}>
                        {process.name}
                      </td>
                      <td className="max-w-[8rem] truncate px-3 py-2 text-muted-foreground">{process.user}</td>
                      <td className="px-3 py-2 text-right text-foreground tabular">{process.cpuPct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right text-muted-foreground tabular">
                        {formatBytes(process.memBytes, unitBase)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground tabular">{process.pid}</td>
                      {isAdmin && device.settings.allowProcessKill ? (
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`End ${process.name}`}
                            onClick={() => setPending(process)}
                          >
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {isAdmin && !device.settings.allowProcessKill ? (
        <p className="text-2xs text-muted-foreground">
          Ending processes is turned off for this device. Enable it under Settings if you need it.
        </p>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader
            title={`End ${pending?.name ?? "process"}?`}
            description={`PID ${pending?.pid ?? ""} on ${device.name}. Unsaved work in this process will be lost.`}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => void kill("term")}>
              Ask it to close
            </Button>
            <Button variant="danger" onClick={() => void kill("kill")}>
              Force end
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
