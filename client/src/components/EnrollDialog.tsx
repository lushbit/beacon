import { useEffect, useMemo, useState } from "react";
import {
  Apple,
  CheckCircle2,
  Container,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import type { EnrollStatusDto, EnrollTokenDto } from "@beacon/shared";
import { CommandSteps, type Step } from "@/components/CommandSteps";
import { SelfSignedToggle } from "@/components/SelfSignedToggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { shellScriptDownload, windowsScriptCommand } from "@/lib/installCommands";

/** How long to watch for the device before offering to stop. */
const WAIT_TIMEOUT_MS = 5 * 60_000;

const EXPIRY_OPTIONS = [
  { id: "1", label: "1 hour" },
  { id: "24", label: "24 hours" },
  { id: "168", label: "7 days" },
  { id: "never", label: "Never" },
];

/** Sits under the commands and reports the device checking in, without leaving them. */
function ConnectionStatus({
  status,
  gaveUp,
  hubUrl,
  onKeepWaiting,
}: {
  status: EnrollStatusDto | null;
  gaveUp: boolean;
  hubUrl: string;
  onKeepWaiting: () => void;
}) {
  return (
    <div aria-live="polite">
      {status?.used ? (
        <div className="flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-success">Connection established</p>
            <p className="mt-0.5 text-2xs text-success/80">
              {status.device
                ? `${status.device.name} is enrolled and reporting to the hub.`
                : "The device is enrolled and reporting to the hub."}
            </p>
          </div>
        </div>
      ) : gaveUp ? (
        <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/10 p-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-warning">No device has checked in yet</p>
            <p className="mt-0.5 text-2xs text-warning/80">
              Check that the machine can reach {hubUrl} and that the install command finished. The token is still
              valid, so you can keep waiting or cancel it.
            </p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={onKeepWaiting}>
              Keep waiting
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-md border border-border/60 bg-surface-2 p-3">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm text-foreground">Waiting for the device to connect…</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Run the command on the device. This updates on its own, no refresh needed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function EnrollDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { attempt } = useToast();
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("24");
  const [maxUses, setMaxUses] = useState("1");
  const [created, setCreated] = useState<EnrollTokenDto | null>(null);
  const [insecure, setInsecure] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [status, setStatus] = useState<EnrollStatusDto | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const token = created?.token ?? null;
  const connected = Boolean(status?.used);

  const hubUrl = `${window.location.protocol}//${window.location.host}`;

  /**
   * The hub cannot reach out to a device, so this watches for the device
   * checking in with the token that was just handed out. Polling stops the
   * moment it arrives, and after a few minutes it offers to keep waiting rather
   * than spinning forever.
   */
  useEffect(() => {
    if (!waiting || !created || connected || gaveUp) return;
    let cancelled = false;
    const startedAt = Date.now();

    const tick = async () => {
      try {
        const next = await api.enrollStatus(created.id);
        if (!cancelled) setStatus(next);
      } catch {
        /* a blip should not end the wait */
      }
      if (!cancelled && Date.now() - startedAt > WAIT_TIMEOUT_MS) setGaveUp(true);
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [waiting, created, connected, gaveUp]);

  const commands = useMemo((): Record<string, Step[]> => {
    const value = token ?? "<token>";

    // With a self-signed certificate the command that *fetches* the installer
    // has to skip verification too, not just the agent's own connection.
    const shell = `${shellScriptDownload(hubUrl, insecure)} | sh -s -- --url ${hubUrl} --token ${value}${
      insecure ? " --insecure-tls" : ""
    }`;

    // One command. It installs a background service and elevates itself.
    const windows: Step[] = [
      {
        title: "Install the agent",
        command: windowsScriptCommand(hubUrl, `-Token ${value}`, insecure),
        note: "Approve the administrator prompt. Installs a service that starts with the machine, so it reports whether or not anyone is signed in.",
      },
    ];

    // The hub serves a ready-made build context, so the host needs neither git
    // nor access to the source repository. With a self-signed certificate the
    // daemon cannot fetch that URL itself, so curl pipes the context in instead.
    const contextUrl = `${hubUrl}/download/beacon-agent-docker.tar.gz`;
    const docker: Step[] = [
      {
        title: "Build the agent image",
        command: insecure
          ? `curl -sSLk ${contextUrl} | docker build -t beacon-agent -`
          : `docker build -t beacon-agent ${contextUrl}`,
      },
      {
        title: "Start the agent",
        command: [
          `docker run -d --name beacon-agent --restart unless-stopped \\`,
          `  --network host --pid host \\`,
          `  -v /var/run/docker.sock:/var/run/docker.sock:ro \\`,
          `  -v beacon-agent-data:/data \\`,
          `  -e BEACON_URL=${hubUrl} -e BEACON_TOKEN=${value}${insecure ? " -e BEACON_INSECURE_TLS=1" : ""} \\`,
          `  beacon-agent`,
        ].join("\n"),
        note: "Reports host CPU, memory and network plus Docker container stats. Prefix both commands with sudo unless your user is in the docker group.",
      },
    ];

    return {
      linux: [{ command: shell, note: "Installs a systemd service. Run it with sudo for a system-wide service." }],
      macos: [
        { command: shell, note: "The same command as Linux. It installs a launchd agent for the current user." },
      ],
      windows,
      docker,
    };
  }, [token, hubUrl, insecure]);

  const create = async () => {
    const result = await attempt(() =>
      api.createEnrollToken({
        label: label.trim(),
        expiresInHours: expiry === "never" ? null : Number(expiry),
        maxUses: Number(maxUses) || 1,
      })
    );
    if (result?.token) {
      setCreated(result);
      onCreated?.();
    }
  };

  /** Copying a command means it is about to run, so start watching for the device. */
  const startWaiting = () => {
    setWaiting(true);
    // Copying again after the wait ran out starts a fresh one.
    setGaveUp(false);
  };

  const reset = () => {
    setCreated(null);
    setLabel("");
    setWaiting(false);
    setStatus(null);
    setGaveUp(false);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  /** Finishes the flow. The caller reloads, so the new device appears by itself. */
  const finish = () => {
    onCreated?.();
    reset();
    onOpenChange(false);
  };

  /** Cancelling takes the unused token back out of the list, as if never made. */
  const cancel = async () => {
    if (created) await api.deleteEnrollToken(created.id).catch(() => undefined);
    finish();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title="Add a device"
          description={
            token
              ? "Run the commands below on the device. Once you copy one, this window waits for the device to connect."
              : "Create an enrollment token, then run the install command on the device."
          }
        />

        {token ? (
          <div className="space-y-4">
            <Tabs defaultValue="linux" className="space-y-3">
              <TabsList className="w-full">
                <TabsTrigger value="linux">
                  <Terminal className="mr-1.5 inline h-3.5 w-3.5" />
                  Linux
                </TabsTrigger>
                <TabsTrigger value="macos">
                  <Apple className="mr-1.5 inline h-3.5 w-3.5" />
                  macOS
                </TabsTrigger>
                <TabsTrigger value="windows">
                  <MonitorSmartphone className="mr-1.5 inline h-3.5 w-3.5" />
                  Windows
                </TabsTrigger>
                <TabsTrigger value="docker">
                  <Container className="mr-1.5 inline h-3.5 w-3.5" />
                  Docker
                </TabsTrigger>
              </TabsList>

              <TabsContent value="linux">
                <CommandSteps steps={commands.linux} onCopy={startWaiting} />
              </TabsContent>

              <TabsContent value="macos">
                <CommandSteps steps={commands.macos} onCopy={startWaiting} />
              </TabsContent>

              <TabsContent value="windows">
                <CommandSteps steps={commands.windows} onCopy={startWaiting} />
              </TabsContent>

              <TabsContent value="docker">
                <CommandSteps steps={commands.docker} onCopy={startWaiting} />
              </TabsContent>
            </Tabs>

            {waiting ? (
              <ConnectionStatus
                status={status}
                gaveUp={gaveUp}
                hubUrl={hubUrl}
                onKeepWaiting={() => setGaveUp(false)}
              />
            ) : null}

            <SelfSignedToggle checked={insecure} onCheckedChange={setInsecure} />

            <p className="text-2xs text-muted-foreground">
              The installers need Node.js 20 or newer on the device. The token is shown once — it is stored hashed and
              cannot be read again — and the agent swaps it for a token unique to that device on first connection.
            </p>

            <DialogFooter>
              {waiting && !connected ? (
                <Button variant="ghost" onClick={() => void cancel()}>
                  Cancel
                </Button>
              ) : null}
              <Button variant="primary" onClick={finish}>
                {connected ? "Close" : "Done"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              label="Device name"
              hint={
                Number(maxUses) === 1
                  ? "Shown in the device list. Leave it empty to use the device's hostname."
                  : "Each device is listed under this name with its hostname added. Leave it empty to use the hostname alone."
              }
            >
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Office laptop"
                maxLength={60}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expires">
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Devices allowed">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void create()}>
                <KeyRound className="h-4 w-4" />
                Create token
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
