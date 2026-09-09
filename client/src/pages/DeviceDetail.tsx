import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpCircle, Bell, Container, Cpu, ListTree, Monitor, Settings2 } from "lucide-react";
import type { DeviceDto } from "@beacon/shared";
import { PageHeader } from "@/components/DashboardLayout";
import { DeviceSettingsTab } from "@/components/device/DeviceSettingsTab";
import { AgentVersionPanel } from "@/components/device/AgentVersionPanel";
import { ContainersTab } from "@/components/device/ContainersTab";
import { OverviewTab } from "@/components/device/OverviewTab";
import { ProcessesTab } from "@/components/device/ProcessesTab";
import { RangePicker } from "@/components/device/RangePicker";
import { ScreenTab } from "@/components/device/ScreenTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton, StatusDot } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, useIsAdmin } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useVersion } from "@/context/VersionContext";
import { api } from "@/lib/api";
import { formatRelative, platformName } from "@/lib/format";

export function DeviceDetailPage() {
  const { id = "" } = useParams();
  const { preferences } = useAuth();
  const isAdmin = useIsAdmin();
  const { samples, statuses } = useLive();
  const { isAgentOutdated } = useVersion();

  const [device, setDevice] = useState<DeviceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeSeconds, setRangeSeconds] = useState(preferences.defaultRange);

  const load = useCallback(async () => {
    try {
      setDevice(await api.device(id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this device.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = samples[id] ?? null;
  const online = useMemo(() => {
    const status = statuses[id]?.status;
    return status ? status === "online" : device?.status === "online";
  }, [statuses, id, device?.status]);

  if (error) {
    return (
      <EmptyState
        icon={Cpu}
        title="Device unavailable"
        description={error}
        action={
          <Button variant="secondary" asChild>
            <Link to="/">Back to overview</Link>
          </Button>
        }
      />
    );
  }

  if (!device) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const sample = live ?? device.latest;
  const staticInfo = device.staticInfo;

  return (
    <>
      <PageHeader
        title={device.name}
        description={[
          platformName(device.platform),
          device.os,
          staticInfo?.cpuBrand,
          online ? "online" : `last seen ${formatRelative(device.lastSeenAt)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Button variant="ghost" size="icon" asChild aria-label="Back to overview">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <StatusDot online={online} />
            {device.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
            {isAgentOutdated(staticInfo?.agentVersion) ? (
              <Badge tone="info">
                <ArrowUpCircle className="h-3 w-3" />
                agent v{staticInfo?.agentVersion} — update available
              </Badge>
            ) : null}
            {device.activeAlerts > 0 ? (
              <Badge tone="danger">
                <Bell className="h-3 w-3" />
                {device.activeAlerts} active
              </Badge>
            ) : null}
            <RangePicker value={rangeSeconds} onChange={setRangeSeconds} />
          </>
        }
      />

      <div className="p-4 sm:p-6">
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="overview">
              <Cpu className="mr-1.5 inline h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="processes">
              <ListTree className="mr-1.5 inline h-3.5 w-3.5" />
              Processes
            </TabsTrigger>
            {device.capabilities.docker ? (
              <TabsTrigger value="containers">
                <Container className="mr-1.5 inline h-3.5 w-3.5" />
                Containers
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="screen">
              <Monitor className="mr-1.5 inline h-3.5 w-3.5" />
              Screen
            </TabsTrigger>
            {isAdmin ? (
              <TabsTrigger value="settings">
                <Settings2 className="mr-1.5 inline h-3.5 w-3.5" />
                Settings
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="overview" className="focus-visible:outline-none">
            <OverviewTab
              device={device}
              sample={sample}
              rangeSeconds={rangeSeconds}
              unitBase={preferences.unitBase}
              temperatureUnit={preferences.temperatureUnit}
            />
          </TabsContent>

          <TabsContent value="processes" className="focus-visible:outline-none">
            <ProcessesTab device={device} online={online} unitBase={preferences.unitBase} />
          </TabsContent>

          {device.capabilities.docker ? (
            <TabsContent value="containers" className="focus-visible:outline-none">
              <ContainersTab device={device} sample={sample} unitBase={preferences.unitBase} />
            </TabsContent>
          ) : null}

          <TabsContent value="screen" className="focus-visible:outline-none">
            <ScreenTab device={device} online={online} />
          </TabsContent>

          {isAdmin ? (
            <TabsContent value="settings" className="focus-visible:outline-none">
              <DeviceSettingsTab device={device} onSaved={setDevice} />
            </TabsContent>
          ) : null}
        </Tabs>

        <div className="mt-4">
          <AgentVersionPanel device={device} online={online} onChanged={() => void load()} />
        </div>

        {staticInfo ? (
          <section className="mt-4 rounded-lg border border-border/70 bg-card p-4">
            <h3 className="mb-3 text-sm font-medium text-foreground">System</h3>
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Hostname", staticInfo.hostname],
                ["Operating system", [staticInfo.distro, staticInfo.release].filter(Boolean).join(" ")],
                ["Kernel", staticInfo.kernel],
                ["Architecture", staticInfo.arch],
                ["CPU", `${staticInfo.cpuBrand} (${staticInfo.cpuPhysicalCores}C / ${staticInfo.cpuCores}T)`],
                ["Machine", [staticInfo.manufacturer, staticInfo.model].filter(Boolean).join(" ") || "—"],
                ["Virtual", staticInfo.isVirtual ? "Yes" : "No"],
                ["Agent", `v${staticInfo.agentVersion} on Node ${staticInfo.nodeVersion}`],
                ["Booted", staticInfo.bootedAt ? formatRelative(staticInfo.bootedAt) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-border/40 pb-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate text-right text-foreground">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>
    </>
  );
}
