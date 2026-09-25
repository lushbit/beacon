import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleSlash,
  Download,
  FileDown,
  Info,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  OS_UPDATE_MANAGER_LABELS,
  parseLogLine,
  type DeviceDto,
  type OsUpdateItem,
  type OsUpdateJobDto,
  type OsUpdatesDto,
} from "@beacon/shared";
import { Duration, RelativeTime } from "@/components/RelativeTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useIsAdmin } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { formatBytes, type UnitBase } from "@/lib/format";
import { cn } from "@/lib/utils";

interface OsUpdatesTabProps {
  device: DeviceDto;
  online: boolean;
  unitBase: UnitBase;
}

const MAX_LOG = 5000;

/* ------------------------------------------------------------------ helpers */

function jobTitle(job: OsUpdateJobDto): string {
  if (job.kind === "check") return "Check for updates";
  if (job.kind === "reboot") return "Restart";
  if (job.requested === null) return "Install all updates";
  return `Install ${job.requested.length} update${job.requested.length === 1 ? "" : "s"}`;
}

function runningTitle(job: OsUpdateJobDto): string {
  if (job.kind === "check") return "Checking for updates";
  if (job.kind === "reboot" || job.phase === "rebooting") return "Restarting";
  if (job.requested === null) return "Installing all updates";
  return `Installing ${job.requested.length} update${job.requested.length === 1 ? "" : "s"}`;
}

const OUTCOME: Record<OsUpdateJobDto["state"], { label: string; tone: "success" | "danger" | "neutral" | "warning" | "info" }> = {
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  interrupted: { label: "Interrupted", tone: "warning" },
};

function resultSummary(job: OsUpdateJobDto): string | null {
  if (job.results.length === 0) return null;
  const ok = job.results.filter((result) => result.ok).length;
  const failed = job.results.length - ok;
  return failed > 0 ? `${ok} installed, ${failed} not installed` : `${ok} installed`;
}

/**
 * Who started it, in words. The hub records a person as their name followed by
 * their account id, which is for the audit log rather than for reading.
 */
function actorLabel(actor: string): string {
  if (actor === "device") return "the device";
  return actor.replace(/\s*\([0-9a-f-]{36}\)$/i, "");
}

/** Updates the last install left behind, by name, with the reason it gave. */
function leftBehind(history: OsUpdateJobDto[]): Map<string, string> {
  const last = history.find((job) => job.kind === "install" && job.state !== "running");
  const out = new Map<string, string>();
  for (const result of last?.results ?? []) {
    if (!result.ok) out.set(result.name, result.message ?? "Not installed");
  }
  return out;
}

/** Dismissed result cards are remembered per job, so each finished run is shown once. */
function dismissed(jobId: string): boolean {
  try {
    return window.localStorage.getItem(`beacon:os-result:${jobId}`) === "1";
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- the tab */

export function OsUpdatesTab({ device, online, unitBase }: OsUpdatesTabProps) {
  const isAdmin = useIsAdmin();
  const { onOsUpdate, mode } = useLive();
  const { notify } = useToast();

  const [data, setData] = useState<OsUpdatesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [resultHidden, setResultHidden] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "install"; ids: string[] | null } | { kind: "reboot" } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.osUpdates(device.id);
      setData(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load updates.");
      return null;
    }
  }, [device.id]);

  const loadLog = useCallback(
    async (jobId: string) => {
      try {
        const job = await api.osUpdateJob(device.id, jobId);
        setLogs((current) => ({ ...current, [jobId]: job.log }));
      } catch {
        /* the log is a nicety, and the next event brings more */
      }
    },
    [device.id]
  );

  useEffect(() => {
    void load().then((next) => {
      if (next?.active) void loadLog(next.active.id);
    });
  }, [load, loadLog]);

  // Live: every event updates the job and adds its new log lines.
  const logsRef = useRef(logs);
  logsRef.current = logs;
  useEffect(
    () =>
      onOsUpdate((message) => {
        if (message.deviceId !== device.id) return;
        const job = message.job;
        setData((current) => {
          if (!current) return current;
          const next: OsUpdatesDto = { ...current };
          if (message.inventory !== undefined) next.inventory = message.inventory;
          if (job) {
            if (job.state === "running") next.active = job;
            else if (current.active?.id === job.id) next.active = null;
            const others = current.history.filter((entry) => entry.id !== job.id);
            next.history = [job, ...others].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
          }
          return next;
        });
        if (!job) return;
        const have = logsRef.current[job.id]?.length ?? 0;
        if (job.logLines > have + message.log.length + 5) {
          // The hub rebuilt this log from the device, so the lines here are
          // behind. Fetching it whole is simpler than working out the gap.
          void loadLog(job.id);
        } else if (message.log.length > 0) {
          setLogs((current) => ({
            ...current,
            [job.id]: [...(current[job.id] ?? []), ...message.log].slice(-MAX_LOG),
          }));
        }
      }),
    [onOsUpdate, device.id, loadLog]
  );

  // Without the live socket, a running job is followed by asking every few seconds.
  const activeId = data?.active?.id ?? null;
  useEffect(() => {
    if (mode === "live" || !activeId) return;
    const timer = window.setInterval(() => {
      void load();
      void loadLog(activeId);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [mode, activeId, load, loadLog]);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      if (done) notify(done, "success");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "That did not work.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <EmptyState icon={AlertTriangle} title="Updates could not be loaded" description={error} />;
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data.agentSupports) {
    return (
      <EmptyState
        icon={ArrowDownToLine}
        title="This agent is too old for OS updates"
        description="Update the Beacon agent on this device to 1.3.0 or later from the Overview tab. Its updates will show up here a few minutes after it reconnects."
      />
    );
  }

  const inventory = data.inventory;
  if (inventory && !inventory.supported) {
    return (
      <EmptyState
        icon={CircleSlash}
        title="Updates cannot be managed on this device"
        description={inventory.reason ?? "The agent cannot update this system."}
      />
    );
  }

  const active = data.active;
  const lastInstall =
    data.history.find((job) => job.kind === "install" && job.state !== "running" && job.id !== resultHidden) ?? null;
  const notInstalled = leftBehind(data.history);
  const canAct = isAdmin && data.allowed && online && !active && !busy;
  const whyNot = !isAdmin
    ? "Only administrators can install updates."
    : !data.allowed
      ? "Installing updates is turned off in this device's settings."
      : !online
        ? "The device is offline. Updates can start once it is back."
        : null;

  return (
    <div className="space-y-4">
      <StatusCard
        data={data}
        activeTitle={active ? runningTitle(active) : null}
        online={online}
        canAct={canAct}
        canCheck={isAdmin && online && !active && !busy}
        whyNot={whyNot}
        unitBase={unitBase}
        onCheck={() => void run(() => api.checkOsUpdates(device.id))}
        onInstallAll={() => setConfirm({ kind: "install", ids: null })}
        onRestart={() => setConfirm({ kind: "reboot" })}
      />

      {!active && lastInstall && !dismissed(lastInstall.id) && Date.now() - (lastInstall.finishedAt ?? 0) < 86_400_000 ? (
        <InstallResult
          job={lastInstall}
          inventory={inventory}
          canRestart={canAct}
          onRestart={() => setConfirm({ kind: "reboot" })}
          onDismiss={() => {
            try {
              window.localStorage.setItem(`beacon:os-result:${lastInstall.id}`, "1");
            } catch {
              /* private browsing */
            }
            setResultHidden(lastInstall.id);
          }}
        />
      ) : null}

      {active ? (
        <ActiveJob
          job={active}
          online={online}
          log={logs[active.id] ?? []}
          canCancel={isAdmin && online && active.cancellable}
          deviceName={device.name}
          onCancel={() => void run(() => api.cancelOsUpdate(device.id, active.id))}
        />
      ) : null}

      {inventory ? (
        <UpdateList
          inventory={inventory}
          notInstalled={notInstalled}
          canAct={canAct}
          unitBase={unitBase}
          onInstall={(ids) => setConfirm({ kind: "install", ids })}
        />
      ) : null}

      <History
        jobs={data.history.filter((job) => job.state !== "running")}
        logs={logs}
        onOpen={(jobId) => {
          if (!logs[jobId]) void loadLog(jobId);
        }}
      />

      <ConfirmDialog
        confirm={confirm}
        deviceName={device.name}
        items={inventory?.items ?? []}
        recommended={(inventory?.items ?? []).filter((entry) => !entry.optional)}
        platform={device.platform}
        onClose={() => setConfirm(null)}
        onInstall={(ids, rebootAfter) =>
          void run(async () => {
            setConfirm(null);
            await api.installOsUpdates(device.id, { ids, rebootAfter });
          })
        }
        onRestart={() =>
          void run(async () => {
            setConfirm(null);
            await api.rebootDevice(device.id);
          })
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------- the summary */

function StatusCard({
  data,
  activeTitle,
  online,
  canAct,
  canCheck,
  whyNot,
  unitBase,
  onCheck,
  onInstallAll,
  onRestart,
}: {
  data: OsUpdatesDto;
  activeTitle: string | null;
  online: boolean;
  canAct: boolean;
  canCheck: boolean;
  whyNot: string | null;
  unitBase: UnitBase;
  onCheck: () => void;
  onInstallAll: () => void;
  onRestart: () => void;
}) {
  const inventory = data.inventory;
  const items = (inventory?.items ?? []).filter((entry) => !entry.optional);
  const optional = (inventory?.items.length ?? 0) - items.length;
  const security = items.filter((entry) => entry.security).length;
  const size = items.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0);
  const running = data.active !== null;

  let icon = ShieldCheck;
  let tone = "text-success";
  let headline = "Up to date";
  if (!inventory) {
    icon = Search;
    tone = "text-muted-foreground";
    headline = "Not checked yet";
  } else if (items.length > 0) {
    icon = security > 0 ? ShieldAlert : Download;
    tone = security > 0 ? "text-warning" : "text-foreground";
    headline = `${items.length} update${items.length === 1 ? "" : "s"} available`;
  } else if (inventory.rebootRequired) {
    icon = RotateCcw;
    tone = "text-warning";
    headline = "Restart needed";
  }
  if (running) {
    icon = Loader2;
    tone = "text-foreground";
    if (!inventory || activeTitle === "Checking for updates") headline = `${activeTitle}…`;
  }
  const Icon = icon;

  const details = [
    security > 0 ? `${security} security` : null,
    optional > 0 ? `${optional} optional` : null,
    size > 0 ? formatBytes(size, unitBase) : null,
    inventory?.manager ? `via ${OS_UPDATE_MANAGER_LABELS[inventory.manager]}` : null,
  ].filter(Boolean);

  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
            <Icon className={cn("h-5 w-5", tone, running && "animate-spin")} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{headline}</h3>
            <p className="text-xs text-muted-foreground">
              {details.join(" · ")}
              {details.length > 0 ? " · " : ""}
              {inventory?.checkedAt ? (
                <>
                  checked <RelativeTime value={inventory.checkedAt} />
                </>
              ) : online ? (
                "The device checks on its own a few minutes after it connects."
              ) : (
                "Waiting for the device to connect."
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!canCheck} onClick={onCheck}>
            <RefreshCw className="h-3.5 w-3.5" />
            Check now
          </Button>
          <Button
            variant={inventory?.rebootRequired ? "secondary" : "outline"}
            size="sm"
            disabled={!canAct}
            onClick={onRestart}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart
          </Button>
          {items.length > 0 ? (
            <Button variant="primary" size="sm" disabled={!canAct} onClick={onInstallAll}>
              <Download className="h-3.5 w-3.5" />
              Install all
            </Button>
          ) : null}
        </div>
      </div>

      {inventory?.rebootRequired && !running ? (
        <div className="flex items-center gap-2 border-t border-border/60 bg-warning/5 px-4 py-2.5 text-xs text-warning">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          A restart is needed to finish installing updates.
        </div>
      ) : null}
      {inventory?.reason ? (
        <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {inventory.reason}
        </div>
      ) : null}
      {whyNot ? (
        <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          {whyNot}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ the live job */

type StepName = "Prepare" | "Check" | "Download" | "Install" | "Restart" | "Done";

function stepsFor(job: OsUpdateJobDto): StepName[] {
  if (job.kind === "check") return ["Check", "Done"];
  if (job.kind === "reboot") return ["Restart", "Done"];
  return job.rebootAfter ? ["Download", "Install", "Restart", "Done"] : ["Download", "Install", "Done"];
}

function stepIndex(job: OsUpdateJobDto, steps: StepName[]): number {
  const name: StepName =
    job.phase === "done"
      ? "Done"
      : job.phase === "rebooting"
        ? "Restart"
        : job.phase === "installing"
          ? "Install"
          : job.phase === "downloading"
            ? "Download"
            : job.kind === "check"
              ? "Check"
              : "Download";
  return Math.max(0, steps.indexOf(name));
}

function ActiveJob({
  job,
  online,
  log,
  canCancel,
  deviceName,
  onCancel,
}: {
  job: OsUpdateJobDto;
  online: boolean;
  log: string[];
  canCancel: boolean;
  deviceName: string;
  onCancel: () => void;
}) {
  const steps = stepsFor(job);
  // Checking what was installed comes after the install, and must not look
  // like the job went back to the start.
  const reached = useRef<{ id: string; index: number }>({ id: job.id, index: 0 });
  if (reached.current.id !== job.id) reached.current = { id: job.id, index: 0 };
  const index = Math.max(reached.current.index, stepIndex(job, steps));
  reached.current.index = index;

  const rebooting = job.phase === "rebooting";
  const waiting = !online && !rebooting;
  const step = job.stepTotal ? `${Math.min(job.stepDone ?? 0, job.stepTotal)} of ${job.stepTotal}` : null;

  return (
    <section className="rounded-lg border border-foreground/20 bg-card shadow-[0_0_0_1px_hsl(var(--foreground)/0.04)]">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            {runningTitle(job)}
          </h3>
          <p className="mt-1 text-2xs text-muted-foreground">
            Started by {actorLabel(job.actor)} · running for <Duration from={job.startedAt} />
          </p>
        </div>
        {canCancel ? (
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
        ) : null}
      </header>

      <ol className="flex items-center gap-2 px-4 pt-4" aria-label="Progress">
        {steps.map((name, position) => {
          const done = position < index;
          const current = position === index;
          return (
            <li key={name} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                  done && "border-foreground/60 bg-foreground/80 text-background",
                  current && "border-foreground text-foreground",
                  !done && !current && "border-border text-muted-foreground"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : position + 1}
              </span>
              <span
                className={cn(
                  "truncate text-xs",
                  current ? "font-medium text-foreground" : done ? "text-foreground/80" : "text-muted-foreground"
                )}
              >
                {name}
              </span>
              {position < steps.length - 1 ? (
                <span className={cn("h-px min-w-3 flex-1", done ? "bg-foreground/50" : "bg-border")} />
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-2 px-4 py-4">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-muted-foreground">
            {waiting
              ? "Lost contact with the device. Waiting for it to come back."
              : rebooting
                ? online
                  ? `Asking ${deviceName} to restart`
                  : `${deviceName} is restarting. Waiting for it to come back online.`
                : (job.current ?? (job.kind === "check" ? "Looking for updates" : "Getting ready"))}
          </span>
          <span className="shrink-0 font-medium text-foreground tabular">
            {step ? `${step} · ` : ""}
            {job.progress !== null && !rebooting ? `${Math.round(job.progress)}%` : ""}
          </span>
        </div>
        <ProgressBar value={rebooting || waiting ? null : job.progress} />
      </div>

      <LogView lines={log} live storageKey="active" fileName={`${deviceName}-${job.kind}.log`} />
    </section>
  );
}

function ProgressBar({ value }: { value: number | null }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value)}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      {value === null ? (
        <div className="absolute inset-y-0 w-1/3 animate-indeterminate rounded-full bg-foreground/60" />
      ) : (
        <div
          className="h-full rounded-full bg-foreground/80 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- the log */

function LogView({
  lines,
  live = false,
  storageKey,
  fileName,
  defaultOpen = false,
}: {
  lines: string[];
  live?: boolean;
  storageKey?: string;
  fileName: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      return window.localStorage.getItem(`beacon:os-log:${storageKey}`) === "1";
    } catch {
      return defaultOpen;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => lines.map(parseLogLine), [lines]);
  // Follows new lines only while the reader is at the bottom, so scrolling up
  // to read something is not undone by the next line arriving.
  const pinned = useRef(true);

  useEffect(() => {
    const element = box.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lines, open]);

  const toggle = () => {
    setOpen(!open);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(`beacon:os-log:${storageKey}`, open ? "0" : "1");
    } catch {
      /* private browsing */
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.replace(/[^\w.-]+/g, "-");
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="border-t border-border/60">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Hide" : "Show"} {live ? "live " : ""}log
          <span className="tabular">({lines.length} line{lines.length === 1 ? "" : "s"})</span>
        </button>
        {open && lines.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={download}>
            <FileDown className="h-3.5 w-3.5" />
            Download
          </Button>
        ) : null}
      </div>
      {open ? (
        <div
          ref={box}
          role="log"
          onScroll={(event) => {
            const element = event.currentTarget;
            pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
          className="scroll-slim mx-4 mb-4 max-h-80 overflow-auto rounded-md border border-border/60 bg-surface-2/60 py-2 font-mono text-[11px] leading-5"
        >
          {parsed.length === 0 ? (
            <p className="px-3 text-muted-foreground">Nothing logged yet.</p>
          ) : (
            parsed.map((entry, index) => (
              <div
                key={index}
                className={cn(
                  "grid grid-cols-[4.75rem_3.25rem_1fr] gap-x-2 px-3 hover:bg-white/[0.03]",
                  entry.level === null && "grid-cols-1"
                )}
              >
                {entry.level !== null ? (
                  <>
                    <span className="text-muted-foreground/70 tabular">
                      {entry.at !== null
                        ? new Date(entry.at).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                          })
                        : ""}
                    </span>
                    <span
                      className={cn(
                        "font-medium",
                        entry.level === "ERROR" && "text-danger",
                        entry.level === "WARN" && "text-warning",
                        entry.level === "INFO" && "text-foreground/70",
                        (entry.level === "CMD" || entry.level === "OUT") && "text-muted-foreground/70"
                      )}
                    >
                      {entry.level}
                    </span>
                  </>
                ) : null}
                <span
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    entry.level === "ERROR" && "text-danger",
                    entry.level === "WARN" && "text-warning",
                    entry.level === "CMD" && "text-foreground",
                    entry.level === "OUT" && "text-muted-foreground",
                    (entry.level === "INFO" || entry.level === null) && "text-foreground/85"
                  )}
                >
                  {entry.level === "CMD" ? `$ ${entry.text}` : entry.text}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- available list */

function UpdateList({
  inventory,
  notInstalled,
  canAct,
  unitBase,
  onInstall,
}: {
  inventory: NonNullable<OsUpdatesDto["inventory"]>;
  notInstalled: Map<string, string>;
  canAct: boolean;
  unitBase: UnitBase;
  onInstall: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState<"all" | "security">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = inventory.items;
  const [showOptional, setShowOptional] = useState(false);
  // A selection outlives a refresh only for updates that are still there.
  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => items.some((entry) => entry.id === id))));
  }, [items]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((entry) => filter === "all" || entry.security)
      .filter(
        (entry) =>
          !needle || entry.name.toLowerCase().includes(needle) || (entry.title ?? "").toLowerCase().includes(needle)
      )
      .sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name));
  }, [items, filter, query]);

  const security = items.filter((entry) => entry.security).length;
  const selectable = canAct && inventory.canSelect;
  // Select all covers what is on screen, so a closed optional section is left alone.
  const visible = shown.filter((entry) => showOptional || !entry.optional);
  const allShownSelected = visible.length > 0 && visible.every((entry) => selected.has(entry.id));
  const selectedSize = items
    .filter((entry) => selected.has(entry.id))
    .reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Available updates</h3>
          <span className="text-xs text-muted-foreground tabular">
            {items.filter((entry) => !entry.optional).length}
          </span>
        </div>
        {items.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {security > 0 ? (
              <div className="flex rounded-md border border-border p-0.5 text-xs">
                {(["all", "security"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={cn(
                      "rounded px-2.5 py-1 transition-colors",
                      filter === value ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {value === "all" ? "All" : `Security (${security})`}
                  </button>
                ))}
              </div>
            ) : null}
            {items.length > 8 ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  className="h-8 w-44 pl-8 text-xs"
                  aria-label="Search updates"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {items.filter((entry) => !entry.optional).length === 0 && !query && filter === "all" ? (
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-4 text-sm text-muted-foreground">
          <ShieldCheck className="h-5 w-5 text-success" />
          Everything is up to date.
        </div>
      ) : null}
      {items.length > 0 ? (
        <>
          {selectable ? (
            <label className="flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2 text-2xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-foreground"
                checked={allShownSelected}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const entry of visible) {
                      if (allShownSelected) next.delete(entry.id);
                      else next.add(entry.id);
                    }
                    return next;
                  })
                }
              />
              Select {filter === "security" ? "all security updates" : query ? "all matches" : "all"}
            </label>
          ) : null}
          <ul className="scroll-slim max-h-[28rem] divide-y divide-border/40 overflow-y-auto">
            {shown.filter((entry) => !entry.optional).map((entry) => (
              <UpdateRow
                key={entry.id}
                entry={entry}
                leftBehind={notInstalled.get(entry.name) ?? null}
                selectable={selectable}
                selected={selected.has(entry.id)}
                unitBase={unitBase}
                onToggle={() => toggle(entry.id)}
              />
            ))}
            {shown.length === 0 ? (
              <li className="px-4 py-4 text-xs text-muted-foreground">Nothing matches.</li>
            ) : null}
          </ul>
          {shown.some((entry) => entry.optional) ? (
            <div className="border-t border-border/60">
              <button
                type="button"
                onClick={() => setShowOptional(!showOptional)}
                aria-expanded={showOptional}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
              >
                <span className="text-sm text-foreground">
                  Optional updates ({shown.filter((entry) => entry.optional).length})
                </span>
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", showOptional && "rotate-180")}
                />
              </button>
              {showOptional ? (
                <ul className="scroll-slim max-h-[28rem] divide-y divide-border/40 overflow-y-auto border-t border-border/40">
                  {shown
                    .filter((entry) => entry.optional)
                    .map((entry) => (
                      <UpdateRow
                        key={entry.id}
                        entry={entry}
                        leftBehind={notInstalled.get(entry.name) ?? null}
                        selectable={selectable}
                        selected={selected.has(entry.id)}
                        unitBase={unitBase}
                        onToggle={() => toggle(entry.id)}
                      />
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {selectable && selected.size > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-surface-2/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {selected.size} selected{selectedSize > 0 ? ` · ${formatBytes(selectedSize, unitBase)}` : ""}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button variant="primary" size="sm" onClick={() => onInstall([...selected])}>
                  <Download className="h-3.5 w-3.5" />
                  Install selected
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {inventory.notes.length > 0 ? (
        <ul className="space-y-1 border-t border-border/60 px-4 py-3">
          {inventory.notes.map((note) => (
            <li key={note} className="flex gap-2 text-2xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function UpdateRow({
  entry,
  leftBehind: reason,
  selectable,
  selected,
  unitBase,
  onToggle,
}: {
  entry: OsUpdateItem;
  /** Why the last install did not get to this one, if it tried. */
  leftBehind: string | null;
  selectable: boolean;
  selected: boolean;
  unitBase: UnitBase;
  onToggle: () => void;
}) {
  const content = (
    <>
      {selectable ? (
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-foreground"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${entry.name}`}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{entry.name}</p>
        <p className="truncate text-2xs text-muted-foreground tabular">
          {[
            entry.title,
            entry.currentVersion && entry.newVersion
              ? `${entry.currentVersion} → ${entry.newVersion}`
              : entry.newVersion
                ? `version ${entry.newVersion}`
                : null,
          ]
            .filter(Boolean)
            .join(" · ") || " "}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {reason ? (
          <Badge tone="danger" title={reason}>
            <X className="h-3 w-3" />
            Not installed last time
          </Badge>
        ) : null}
        {entry.security ? (
          <Badge tone="warning">
            <ShieldAlert className="h-3 w-3" />
            Security
          </Badge>
        ) : null}
        {entry.restart ? (
          <Badge>
            <RotateCcw className="h-3 w-3" />
            Restart
          </Badge>
        ) : null}
        {entry.kind === "driver" ? <Badge>Driver</Badge> : null}
        {entry.sizeBytes ? (
          <span className="w-16 text-right text-2xs text-muted-foreground tabular">
            {formatBytes(entry.sizeBytes, unitBase)}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <li>
      {selectable ? (
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.02]",
            selected && "bg-white/[0.03]"
          )}
        >
          {content}
        </label>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2.5">{content}</div>
      )}
    </li>
  );
}

/* ----------------------------------------------------------------- history */

function History({
  jobs,
  logs,
  onOpen,
}: {
  jobs: OsUpdateJobDto[];
  logs: Record<string, string[]>;
  onOpen: (jobId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <header className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">History</h3>
      </header>
      {jobs.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">Nothing has run from the dashboard yet.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {jobs.map((job) => {
            const outcome = OUTCOME[job.state];
            const expanded = open === job.id;
            const summary = resultSummary(job);
            const failures = job.results.filter((result) => !result.ok);
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(expanded ? null : job.id);
                    if (!expanded) onOpen(job.id);
                  }}
                  aria-expanded={expanded}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <Badge tone={outcome.tone} className="w-[5.5rem] justify-center">
                    {outcome.label}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{jobTitle(job)}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {[summary, job.error, job.rebootRequired && job.state === "succeeded" ? "restart needed" : null]
                        .filter(Boolean)
                        .join(" · ") || `by ${actorLabel(job.actor)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-2xs text-muted-foreground tabular">
                    <RelativeTime value={job.startedAt} />
                    {job.finishedAt ? (
                      <>
                        {" · took "}
                        <Duration from={job.startedAt} to={job.finishedAt} />
                      </>
                    ) : null}
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                  />
                </button>
                {expanded ? (
                  <div className="bg-surface/40">
                    <p className="px-4 pt-3 text-2xs text-muted-foreground">
                      Started by {actorLabel(job.actor)} on {new Date(job.startedAt).toLocaleString()}
                    </p>
                    {job.results.length > 0 ? <ResultList results={job.results} failures={failures} /> : null}
                    <div className="pt-2">
                      <LogView
                        lines={logs[job.id] ?? []}
                        fileName={`${job.kind}-${new Date(job.startedAt).toISOString()}.log`}
                        defaultOpen
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Everything a run touched: what did not go in first, the rest folded away. */
function ResultList({
  results,
  failures,
}: {
  results: OsUpdateJobDto["results"];
  failures: OsUpdateJobDto["results"];
}) {
  const [showInstalled, setShowInstalled] = useState(failures.length === 0 && results.length <= 8);
  const installed = results.filter((result) => result.ok);
  return (
    <div className="space-y-2 px-4 pt-3">
      {failures.length > 0 ? (
        <ul className="space-y-1">
          {failures.map((result) => (
            <li key={result.name} className="flex gap-2 text-xs">
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span className="min-w-0">
                <span className="text-foreground">{result.name}</span>
                {result.message ? <span className="text-muted-foreground"> · {result.message}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {installed.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowInstalled(!showInstalled)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showInstalled && "rotate-180")} />
            {installed.length} installed
          </button>
          {showInstalled ? (
            <ul className="scroll-slim mt-1.5 max-h-60 space-y-1 overflow-y-auto">
              {installed.map((result) => (
                <li key={result.name} className="flex gap-2 text-xs">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span className="min-w-0">
                    <span className="text-foreground">{result.name}</span>
                    {result.message ? <span className="text-muted-foreground"> · {result.message}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the outcome */

/**
 * What the last install did, said plainly, until someone closes it. It names
 * what did not go in, and offers the restart right there when one is needed.
 */
function InstallResult({
  job,
  inventory,
  canRestart,
  onRestart,
  onDismiss,
}: {
  job: OsUpdateJobDto;
  inventory: OsUpdatesDto["inventory"];
  canRestart: boolean;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  const failures = job.results.filter((result) => !result.ok);
  const installed = job.results.length - failures.length;
  const restartNeeded = inventory?.rebootRequired === true || (job.rebootRequired && job.phase !== "rebooting");
  const restarted = job.rebootAfter && job.state === "succeeded" && !inventory?.rebootRequired && job.rebootRequired;

  let tone: "success" | "warning" | "danger" = "success";
  let Icon = ShieldCheck;
  let headline: string;
  let detail: string | null = null;

  if (job.state === "cancelled") {
    tone = "warning";
    Icon = CircleSlash;
    headline = "The install was cancelled before anything changed.";
  } else if (job.state === "interrupted") {
    tone = "warning";
    Icon = AlertTriangle;
    headline = "The install was interrupted.";
    detail = "Contact with the device was lost part way through. Check for updates to see where it got to.";
  } else if (job.state === "failed" && installed === 0) {
    tone = "danger";
    Icon = AlertTriangle;
    headline = "The install failed. Nothing was installed.";
    detail = job.error;
  } else if (failures.length > 0) {
    tone = "warning";
    Icon = AlertTriangle;
    headline = `${installed} of ${job.results.length} updates were installed.`;
    detail = `${failures.length} could not be installed and ${failures.length === 1 ? "is" : "are"} still listed below, marked "Not installed last time".`;
  } else if (job.results.length > 0) {
    headline = `All ${job.results.length} update${job.results.length === 1 ? " was" : "s were"} installed successfully.`;
  } else {
    headline = "The install finished.";
  }

  return (
    <section
      className={cn(
        "rounded-lg border bg-card",
        tone === "success" && "border-success/30",
        tone === "warning" && "border-warning/30",
        tone === "danger" && "border-danger/30"
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger"
          )}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{headline}</p>
          {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
          <p className="text-2xs text-muted-foreground">
            Finished <RelativeTime value={job.finishedAt} />
            {job.finishedAt ? (
              <>
                {" · took "}
                <Duration from={job.startedAt} to={job.finishedAt} />
              </>
            ) : null}
            {restarted ? " · restarted to finish" : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {failures.length > 0 ? (
        <ul className="space-y-1 border-t border-border/60 px-4 py-3">
          {failures.slice(0, 10).map((result) => (
            <li key={result.name} className="flex gap-2 text-xs">
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span className="min-w-0">
                <span className="text-foreground">{result.name}</span>
                {result.message ? <span className="text-muted-foreground"> · {result.message}</span> : null}
              </span>
            </li>
          ))}
          {failures.length > 10 ? (
            <li className="text-2xs text-muted-foreground">and {failures.length - 10} more in the history below</li>
          ) : null}
        </ul>
      ) : null}
      {restartNeeded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-warning/5 px-4 py-3">
          <p className="flex items-center gap-2 text-xs text-warning">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            A restart is needed to finish installing.
          </p>
          <Button variant="primary" size="sm" disabled={!canRestart} onClick={onRestart}>
            <RotateCcw className="h-3.5 w-3.5" />
            Restart now
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------- confirming */

function ConfirmDialog({
  confirm,
  deviceName,
  items,
  recommended,
  platform,
  onClose,
  onInstall,
  onRestart,
}: {
  confirm: { kind: "install"; ids: string[] | null } | { kind: "reboot" } | null;
  deviceName: string;
  items: OsUpdateItem[];
  /** What "install all" means: everything that is not optional. */
  recommended: OsUpdateItem[];
  platform: string;
  onClose: () => void;
  onInstall: (ids: string[] | null, rebootAfter: boolean) => void;
  onRestart: () => void;
}) {
  const chosen =
    confirm?.kind === "install"
      ? confirm.ids
        ? items.filter((entry) => confirm.ids!.includes(entry.id))
        : recommended
      : [];
  const needsRestart = chosen.some((entry) => entry.restart);
  const [rebootAfter, setRebootAfter] = useState(false);
  useEffect(() => setRebootAfter(false), [confirm]);

  return (
    <Dialog open={confirm !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        {confirm?.kind === "reboot" ? (
          <>
            <DialogHeader
              title={`Restart ${deviceName}?`}
              description="It will be offline for a minute or two, and anyone using it will be interrupted. This page shows when it is back."
            />
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Keep running
              </Button>
              <Button variant="primary" onClick={onRestart}>
                <RotateCcw className="h-4 w-4" />
                Restart now
              </Button>
            </DialogFooter>
          </>
        ) : confirm?.kind === "install" ? (
          <>
            <DialogHeader
              title={
                confirm.ids === null
                  ? `Install all ${recommended.length} updates?`
                  : `Install ${chosen.length} update${chosen.length === 1 ? "" : "s"}?`
              }
              description={`On ${deviceName}. You can follow every step here while it runs.`}
            />
            <ul className="scroll-slim mb-4 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-surface-2/50 p-3 text-xs">
              {chosen.slice(0, 50).map((entry) => (
                <li key={entry.id} className="truncate text-foreground">
                  {entry.name}
                  {entry.newVersion ? <span className="text-muted-foreground"> · {entry.newVersion}</span> : null}
                </li>
              ))}
              {chosen.length > 50 ? <li className="text-muted-foreground">and {chosen.length - 50} more</li> : null}
            </ul>
            <label className="mb-2 flex cursor-pointer items-start gap-3 rounded-md border border-border/60 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-foreground"
                checked={rebootAfter}
                onChange={(event) => setRebootAfter(event.target.checked)}
              />
              <span>
                <span className="block text-sm text-foreground">Restart automatically if needed</span>
                <span className="block text-2xs text-muted-foreground">
                  {needsRestart
                    ? "Some of these need a restart to finish."
                    : "Only restarts when the updates ask for it."}{" "}
                  {platform === "win32" ? "Windows gives a few seconds of warning first." : ""}
                </span>
              </span>
            </label>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Not now
              </Button>
              <Button variant="primary" onClick={() => onInstall(confirm.ids, rebootAfter)}>
                <Download className="h-4 w-4" />
                Install
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
