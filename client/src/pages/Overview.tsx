import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, ServerOff } from "lucide-react";
import { type DeviceSort, type DeviceSummaryDto } from "@beacon/shared";
import { DeviceTable } from "@/components/DeviceTable";
import { EnrollDialog } from "@/components/EnrollDialog";
import { PageHeader } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useAuth, useIsAdmin } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";

export function OverviewPage() {
  const { preferences, savePreferences } = useAuth();
  const isAdmin = useIsAdmin();
  const { samples, statuses } = useLive();
  const { notify } = useToast();

  const [devices, setDevices] = useState<DeviceSummaryDto[] | null>(null);
  const [filter, setFilter] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  const sort = preferences.deviceSort;
  const direction = preferences.deviceSortDir;

  const load = useCallback(async () => {
    try {
      setDevices(await api.devices());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load devices.", "error");
      setDevices([]);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Cheap safety net: the socket carries live values, this catches enrolments.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const isOnline = useCallback(
    (device: DeviceSummaryDto) => statuses[device.id]?.status === "online" || (!statuses[device.id] && device.status === "online"),
    [statuses]
  );

  /** Ascending → descending → back to the default order. */
  const cycleSort = useCallback(
    (attribute: DeviceSort) => {
      if (sort !== attribute) return void savePreferences({ deviceSort: attribute, deviceSortDir: "asc" });
      if (direction === "asc") return void savePreferences({ deviceSortDir: "desc" });
      return void savePreferences({ deviceSort: "none", deviceSortDir: "asc" });
    },
    [sort, direction, savePreferences]
  );

  const visible = useMemo(() => {
    if (!devices) return null;
    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? devices.filter((device) =>
          [device.name, device.hostname, device.os, ...device.tags].join(" ").toLowerCase().includes(needle)
        )
      : devices;

    const summaryOf = (device: DeviceSummaryDto) => (samples[device.id] ?? device.latest)?.summary ?? null;

    // Ascending is always "smallest first": online before offline, A before Z,
    // idle before busy, coolest before hottest.
    const keyOf = (device: DeviceSummaryDto): string | number => {
      const summary = summaryOf(device);
      switch (sort) {
        case "status":
          return isOnline(device) ? 0 : 1;
        case "name":
          return device.name.toLowerCase();
        case "cpu":
          return summary?.cpuPct ?? -1;
        case "memory":
          return summary?.memPct ?? -1;
        case "disk":
          return summary?.diskMaxPct ?? -1;
        case "net":
          return summary ? (summary.netRxBps ?? 0) + (summary.netTxBps ?? 0) : -1;
        case "temp":
          return summary?.cpuTempC ?? -1;
        case "uptime":
          return (isOnline(device) ? summary?.uptimeSec : null) ?? -1;
        case "alerts":
          return device.activeAlerts;
        case "agent":
          return device.agentVersion ?? "";
        default:
          return 0;
      }
    };

    const byName = (a: DeviceSummaryDto, b: DeviceSummaryDto) => a.name.localeCompare(b.name);

    return [...matched].sort((a, b) => {
      if (sort === "none") {
        const onlineDiff = Number(isOnline(b)) - Number(isOnline(a));
        return onlineDiff !== 0 ? onlineDiff : byName(a, b);
      }
      const left = keyOf(a);
      const right = keyOf(b);
      const diff =
        typeof left === "string"
          ? left.localeCompare(right as string, undefined, { numeric: true })
          : left - (right as number);
      if (diff !== 0) return direction === "asc" ? diff : -diff;
      return byName(a, b);
    });
  }, [devices, filter, sort, direction, isOnline, samples]);

  const onlineCount = devices?.filter(isOnline).length ?? 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          devices === null
            ? "Loading devices…"
            : `${devices.length} device${devices.length === 1 ? "" : "s"} · ${onlineCount} online`
        }
        actions={
          <>
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter devices"
                aria-label="Filter devices"
                className="h-9 w-full pl-9 sm:w-52"
              />
            </div>
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {isAdmin ? (
              <Button variant="primary" onClick={() => setEnrolling(true)}>
                <Plus className="h-4 w-4" />
                Add device
              </Button>
            ) : null}
          </>
        }
      />

      <div className="p-4 sm:p-6">
        {visible === null ? (
          <div className="space-y-2 rounded-lg border border-border/70 bg-card p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-border/70 bg-card">
            <EmptyState
              icon={devices && devices.length > 0 ? Search : ServerOff}
              title={devices && devices.length > 0 ? "No devices match that filter." : "No devices yet."}
              description={
                devices && devices.length > 0
                  ? "Try a different name, hostname or tag."
                  : "Install the Beacon agent on a device and enroll it with a token to start collecting metrics."
              }
              action={
                isAdmin && (!devices || devices.length === 0) ? (
                  <Button variant="primary" onClick={() => setEnrolling(true)}>
                    <Plus className="h-4 w-4" />
                    Add device
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <DeviceTable
            devices={visible}
            samples={samples}
            isOnline={isOnline}
            unitBase={preferences.unitBase}
            temperatureUnit={preferences.temperatureUnit}
            compact={preferences.compactCards}
            sort={sort}
            direction={direction}
            onSort={cycleSort}
          />
        )}
      </div>

      <EnrollDialog open={enrolling} onOpenChange={setEnrolling} onCreated={() => void load()} />
    </>
  );
}
