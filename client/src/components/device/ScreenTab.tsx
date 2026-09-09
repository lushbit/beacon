import { useEffect } from "react";
import { Monitor, MonitorOff, Play, Square } from "lucide-react";
import type { DeviceDto } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { useLive } from "@/context/LiveContext";
import { formatRelative } from "@/lib/format";

/**
 * View-only screen streaming from the agent itself — nothing extra is installed
 * on the device. Where the OS cannot be captured the agent says why, and this
 * tab shows that instead of pretending the feature exists.
 */
export function ScreenTab({ device, online }: { device: DeviceDto; online: boolean }) {
  const { frames, screenStates, startScreen, stopScreen } = useLive();
  const frame = frames[device.id];
  const state = screenStates[device.id]?.state ?? "stopped";
  const message = screenStates[device.id]?.message;
  const streaming = state === "starting" || state === "streaming";

  // Never leave a capture running on the device after leaving the tab.
  useEffect(() => {
    return () => stopScreen(device.id);
  }, [device.id, stopScreen]);

  if (!device.capabilities.screen) {
    return (
      <EmptyState
        icon={MonitorOff}
        title="Screen viewing is not available on this device."
        description={
          device.capabilities.screenReason ??
          "The agent reported that it cannot capture this device's display."
        }
      />
    );
  }

  if (!device.settings.screenEnabled) {
    return (
      <EmptyState
        icon={MonitorOff}
        title="Screen viewing is turned off."
        description="An administrator can enable it for this device under Settings. It stays off until then."
      />
    );
  }

  if (!online) {
    return <EmptyState icon={MonitorOff} title="Device is offline." description="Connect the agent to view its screen." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Monitor className="h-4 w-4" />
          <span>
            {state === "streaming" && frame
              ? `${frame.width}×${frame.height} · updated ${formatRelative(frame.ts)}`
              : state === "starting"
                ? "Starting capture…"
                : state === "error"
                  ? message ?? "Capture failed."
                  : "Not streaming."}
          </span>
        </div>
        {streaming ? (
          <Button variant="secondary" size="sm" onClick={() => stopScreen(device.id)}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => startScreen(device.id)}>
            <Play className="h-3.5 w-3.5" />
            Start viewing
          </Button>
        )}
      </div>

      <div className="flex min-h-[18rem] items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-surface-2">
        {frame ? (
          <img
            src={frame.src}
            alt={`Screen of ${device.name}`}
            className="max-h-[70vh] w-full object-contain"
            draggable={false}
          />
        ) : (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            {streaming ? "Waiting for the first frame…" : "The screen appears here once you start viewing."}
          </p>
        )}
      </div>

      <p className="text-2xs text-muted-foreground">
        Viewing is read-only — Beacon never sends input to the device. Every viewing session is written to the audit
        log.
      </p>
    </div>
  );
}
