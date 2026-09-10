import { ArrowUpCircle, CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import type { DeviceDto } from "@beacon/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { useVersion } from "@/context/VersionContext";
import { api } from "@/lib/api";
import { RelativeTime } from "@/components/RelativeTime";

const BUSY_STATES = new Set(["requested", "downloading", "restarting"]);

/** Version, compatibility and the one button that updates this agent. */
export function AgentVersionPanel({ device, online, onChanged }: { device: DeviceDto; online: boolean; onChanged: () => void }) {
  const isAdmin = useIsAdmin();
  const { attempt } = useToast();
  const { info } = useVersion();
  const { updates } = useLive();

  const live = updates[device.id];
  const state = live?.state ?? device.updateState.state;
  const target = live?.targetVersion ?? device.updateState.targetVersion;
  const error = live?.error ?? device.updateState.error;
  const busy = BUSY_STATES.has(state);

  const canUpdate =
    isAdmin && online && device.capabilities.selfUpdate && device.compatibility === "outdated" && !busy;

  return (
    <section className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">Agent</h3>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Version {device.agentVersion ?? "unknown"}
            {device.protocolVersion ? ` · protocol v${device.protocolVersion}` : ""}
            {info ? ` · hub serves ${info.current}` : ""}
          </p>
        </div>

        {device.compatibility === "current" ? (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" />
            up to date
          </Badge>
        ) : device.compatibility === "outdated" ? (
          <Badge tone="info">
            <ArrowUpCircle className="h-3 w-3" />
            update available
          </Badge>
        ) : device.compatibility === "incompatible" ? (
          <Badge tone="danger">
            <TriangleAlert className="h-3 w-3" />
            incompatible
          </Badge>
        ) : null}
      </div>

      {state !== "idle" ? (
        <p className="mt-3 text-2xs text-muted-foreground">
          {state === "confirmed" ? (
            <>
              Updated to {target ?? device.agentVersion}
              {device.updateState.finishedAt ? (
                <>
                  {" "}
                  <RelativeTime value={device.updateState.finishedAt} />
                </>
              ) : null}
            </>
          ) : state === "failed"
              ? `Last update failed: ${error ?? "unknown error"}`
              : `Updating to ${target ?? ""}…`}
        </p>
      ) : null}

      {device.compatibility === "incompatible" ? (
        <p className="mt-3 text-2xs text-warning">
          This agent is too old for the hub to talk to. Re-run the install command on the device.
        </p>
      ) : null}

      {isAdmin && device.compatibility === "outdated" && !device.capabilities.selfUpdate ? (
        <p className="mt-3 text-2xs text-muted-foreground">
          This agent was not installed by the installer, so it cannot update itself. Re-run the install command on the
          device.
        </p>
      ) : null}

      {canUpdate || busy ? (
        <Button
          variant="primary"
          size="sm"
          className="mt-3"
          disabled={!canUpdate}
          onClick={async () => {
            await attempt(() => api.updateAgent(device.id), "Update started.");
            onChanged();
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Updating…" : `Update to ${info?.current ?? "latest"}`}
        </Button>
      ) : null}
    </section>
  );
}
