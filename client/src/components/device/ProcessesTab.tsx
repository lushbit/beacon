import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ListTree, Square } from "lucide-react";
import type { DeviceDto, ProcessSummary } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, Skeleton, StatusDot } from "@/components/ui/misc";
import { useIsAdmin } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { formatBytes, type UnitBase } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "name" | "user" | "cpu" | "mem" | "pid";
type Direction = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "Process", align: "left" },
  { key: "user", label: "User", align: "left" },
  { key: "cpu", label: "CPU", align: "right" },
  { key: "mem", label: "Memory", align: "right" },
  { key: "pid", label: "PID", align: "right" },
];

/** Figures are most useful biggest first, names from A. */
const FIRST_DIRECTION: Record<SortKey, Direction> = { name: "asc", user: "asc", cpu: "desc", mem: "desc", pid: "asc" };

/**
 * The agent only sends the busiest processes, ranked by CPU or memory. Any
 * other order asks for as many as an agent will send and sorts them here, so
 * the list is not just the top few reshuffled.
 */
const TOP_LIMIT = 60;
const ALL_LIMIT = 300;

function compare(a: ProcessSummary, b: ProcessSummary, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "user":
      return (a.user || "").localeCompare(b.user || "", undefined, { sensitivity: "base" });
    case "cpu":
      return a.cpuPct - b.cpuPct;
    case "mem":
      return a.memBytes - b.memBytes;
    case "pid":
      return a.pid - b.pid;
  }
}

/** One sort control, shared by the table headings and the phone's sort row. */
function SortButton({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: { key: SortKey; direction: Direction };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === column.key;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column.key)}
      aria-pressed={active}
      className={cn(
        "group flex w-fit shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-2xs font-medium uppercase tracking-wide transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        column.align === "right" && "sm:ml-auto sm:flex-row-reverse",
        active ? "text-foreground" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
      )}
    >
      <span>{column.label}</span>
      <Icon
        className={cn("h-3 w-3 shrink-0 transition-opacity", active ? "opacity-100" : "opacity-50 group-hover:opacity-100")}
      />
    </button>
  );
}

function SortHeading({
  column,
  sort,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: { key: SortKey; direction: Direction };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === column.key;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("py-1.5 font-normal", column.key === "name" ? "px-2.5" : "px-1.5")}
    >
      <SortButton column={column} sort={sort} onSort={onSort} />
    </th>
  );
}

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
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction }>({ key: "cpu", direction: "desc" });
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState<ProcessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // CPU or memory, busiest first, is exactly what the agent ranks by.
  const ranked = sort.direction === "desc" && (sort.key === "cpu" || sort.key === "mem");
  const sortBy = sort.key === "mem" ? "mem" : "cpu";
  const limit = ranked ? TOP_LIMIT : ALL_LIMIT;

  const load = useCallback(async () => {
    if (!online) {
      setProcesses(null);
      return;
    }
    try {
      const result = await api.processes(device.id, { limit, sortBy });
      setProcesses(result.processes);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the process list.");
    }
  }, [device.id, limit, sortBy, online]);

  // Paused means nothing is fetched at all, not even when the order changes.
  // Sorting then only reorders the rows on screen. Going live again fetches
  // straight away instead of waiting for the next tick.
  useEffect(() => {
    if (paused) return;
    void load();
    if (!online) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [paused, load, online]);

  const rows = useMemo(() => {
    if (!processes) return null;
    const sign = sort.direction === "asc" ? 1 : -1;
    return processes
      .slice()
      .sort((a, b) => sign * compare(a, b, sort.key) || a.pid - b.pid)
      .slice(0, TOP_LIMIT);
  }, [processes, sort]);

  const onSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: FIRST_DIRECTION[key] }
    );

  const kill = async (signal: "term" | "kill") => {
    if (!pending) return;
    const done = await attempt(
      () => api.killProcess(device.id, { pid: pending.pid, signal }),
      `Sent ${signal === "kill" ? "SIGKILL" : "SIGTERM"} to ${pending.name}.`
    );
    const ended = pending.pid;
    setPending(null);
    if (!done) return;
    // A paused list stays frozen, so only the process that was ended leaves it.
    if (paused) setProcesses((current) => current?.filter((process) => process.pid !== ended) ?? current);
    else window.setTimeout(() => void load(), 800);
  };

  if (!online) {
    return <EmptyState icon={ListTree} title="Device is offline." description="Processes can only be read live." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-2xs text-muted-foreground tabular">{total} running</p>
        {/*
         * The list follows the device on its own, so the only control is a
         * pause. It freezes the list completely, which helps when ending a
         * process that keeps moving up and down.
         */}
        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          aria-pressed={paused}
          title={paused ? "Paused. Nothing updates until you click to go live again." : "Updating every 5 seconds. Click to pause."}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
        >
          {paused ? (
            <span className="h-2 w-2 rounded-full bg-muted-foreground/60" aria-hidden />
          ) : (
            <StatusDot online />
          )}
          {paused ? "Paused" : "Live"}
        </button>
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
        ) : rows === null || rows.length === 0 ? (
          <EmptyState icon={ListTree} title="No processes reported." />
        ) : (
          <>
            {/* Phones get stacked rows; a 6-column table only works with a mouse. */}
            <div className="scroll-slim flex items-center gap-x-1 overflow-x-auto border-b border-border/60 bg-surface-2/50 px-2.5 py-1 sm:hidden">
              {COLUMNS.map((column) => (
                <SortButton key={column.key} column={column} sort={sort} onSort={onSort} />
              ))}
            </div>
            <ul className="divide-y divide-border/40 sm:hidden">
              {rows.map((process) => (
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
                  <tr className="border-b border-border/60 bg-surface-2/50 text-left">
                    {COLUMNS.map((column) => (
                      <SortHeading key={column.key} column={column} sort={sort} onSort={onSort} />
                    ))}
                    {isAdmin && device.settings.allowProcessKill ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map((process) => (
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
