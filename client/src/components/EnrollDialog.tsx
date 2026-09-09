import { useMemo, useRef, useState } from "react";
import { Apple, Check, Container, Copy, KeyRound, MonitorSmartphone, ShieldAlert, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const EXPIRY_OPTIONS = [
  { id: "1", label: "1 hour" },
  { id: "24", label: "24 hours" },
  { id: "168", label: "7 days" },
  { id: "never", label: "Never" },
];

interface Step {
  /** Shown above the command when a platform needs more than one. */
  title?: string;
  command: string;
  note?: string;
}

function CommandBlock({ step, index, total }: { step: Step; index: number; total: number }) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const block = useRef<HTMLPreElement>(null);

  const copy = async () => {
    if ((await copyText(step.command, block.current)) === "copied") {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return;
    }
    notify("This browser blocked the copy. The command is selected, so copy it from there.", "info");
  };

  return (
    <div className="space-y-2">
      {total > 1 ? (
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {index + 1} of {total}
          {step.title ? ` — ${step.title}` : ""}
        </p>
      ) : null}
      <pre
        ref={block}
        className="scroll-slim max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-2 p-3 text-2xs leading-relaxed text-foreground"
      >
        {step.command}
      </pre>
      <div className="flex items-center justify-between gap-3">
        {step.note ? <p className="text-2xs text-muted-foreground">{step.note}</p> : <span />}
        <Button variant="secondary" size="sm" onClick={() => void copy()} className="shrink-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** Each command gets its own block and its own copy button, so nothing is pasted half. */
function CommandSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <CommandBlock key={step.command} step={step} index={index} total={steps.length} />
      ))}
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
  const [token, setToken] = useState<string | null>(null);
  const [insecure, setInsecure] = useState(false);

  const hubUrl = `${window.location.protocol}//${window.location.host}`;

  const commands = useMemo((): Record<string, Step[]> => {
    const value = token ?? "<token>";

    // With a self-signed certificate the command that *fetches* the installer
    // has to skip verification too, not just the agent's own connection.
    const shell = insecure
      ? `curl -sSLk ${hubUrl}/install.sh | sh -s -- --url ${hubUrl} --token ${value} --insecure-tls`
      : `curl -sSL ${hubUrl}/install.sh | sh -s -- --url ${hubUrl} --token ${value}`;

    const windows: Step[] = [];
    if (insecure) {
      windows.push({
        title: "Trust the certificate for this session",
        command: "[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }",
        note: "Run this first, in the same PowerShell window as the next command.",
      });
    }
    windows.push({
      title: "Install the agent",
      command: `& ([scriptblock]::Create((irm ${hubUrl}/install.ps1))) -Url ${hubUrl} -Token ${value}${
        insecure ? " -InsecureTls" : ""
      }`,
      note: "Starts with your session, so screen viewing works. Add -SystemService in an elevated prompt to start with the machine instead.",
    });

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
        note: "Reports host CPU, memory and network plus Docker container stats. Prefix both commands with sudo unless your user is in the docker group. Screen viewing is not available from a container.",
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
      setToken(result.token);
      onCreated?.();
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      setToken(null);
      setLabel("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title="Add a device"
          description={
            token
              ? "Run the commands below on the device. They install the agent, register it as a service and enroll it."
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
                <CommandSteps steps={commands.linux} />
              </TabsContent>

              <TabsContent value="macos">
                <CommandSteps steps={commands.macos} />
              </TabsContent>

              <TabsContent value="windows">
                <CommandSteps steps={commands.windows} />
              </TabsContent>

              <TabsContent value="docker">
                <CommandSteps steps={commands.docker} />
              </TabsContent>
            </Tabs>

            <div
              className={cn(
                "flex items-start justify-between gap-4 rounded-md border p-3 transition-colors",
                insecure ? "border-warning/50 bg-warning/10" : "border-warning/25 bg-warning/[0.04]"
              )}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  This hub uses a self-signed certificate
                </p>
                <p className="mt-1 text-2xs text-warning/80">
                  Adds the flags needed to skip certificate verification. Prefer a real certificate where you can — this
                  turns off the check that proves the device is talking to your hub.
                </p>
              </div>
              <Switch checked={insecure} onCheckedChange={setInsecure} aria-label="Hub uses a self-signed certificate" />
            </div>

            <p className="text-2xs text-muted-foreground">
              The installers need Node.js 20 or newer on the device. The token is shown once — it is stored hashed and
              cannot be read again — and the agent swaps it for a token unique to that device on first connection.
            </p>

            <DialogFooter>
              <Button variant="primary" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Label" hint="Only used to recognise the token in the list.">
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Office laptop" />
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
