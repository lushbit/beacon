import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, KeyRound, RefreshCw, Save, ShieldAlert, Trash2 } from "lucide-react";
import { UPDATE_POLICIES, UPDATE_POLICY_LABELS } from "@beacon/shared";
import type { DeviceDto, DeviceSettingsDto, UpdatePolicy } from "@beacon/shared";
import { RemoveAgentDialog } from "@/components/device/RemoveAgentDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { DEVICE_COLORS, deviceColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

interface Props {
  device: DeviceDto;
  onSaved: (device: DeviceDto) => void;
}

function Panel({
  title,
  description,
  tone = "normal",
  className,
  children,
}: {
  title: string;
  description?: string;
  tone?: "normal" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border",
        danger ? "border-danger/60 bg-danger/[0.05]" : "border-border/70 bg-card",
        className
      )}
    >
      {/*
       * A thin red outline was easy to miss, so the dangerous section announces
       * itself with a filled bar across the top instead.
       */}
      <div
        className={cn(
          danger ? "flex items-start gap-2.5 border-b border-danger/40 bg-danger/15 px-4 py-3" : "px-4 pt-4"
        )}
      >
        {danger ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /> : null}
        <div className="min-w-0">
          <h3 className={cn("text-sm font-semibold", danger ? "text-danger" : "font-medium text-foreground")}>
            {title}
          </h3>
          {description ? (
            <p className={cn("mt-0.5 text-2xs", danger ? "text-danger/80" : "text-muted-foreground")}>{description}</p>
          ) : null}
        </div>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function DeviceSettingsTab({ device, onSaved }: Props) {
  const navigate = useNavigate();
  const { attempt, notify } = useToast();

  const [name, setName] = useState(device.name);
  const [color, setColor] = useState(device.color);
  const [tags, setTags] = useState(device.tags.join(", "));
  const [notes, setNotes] = useState(device.notes);
  const [settings, setSettings] = useState<DeviceSettingsDto>(device.settings);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [rotated, setRotated] = useState<string | null>(null);
  const rotatedCommand = useRef<HTMLPreElement>(null);

  const patch = <K extends keyof DeviceSettingsDto>(key: K, value: DeviceSettingsDto[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  /** Panels are stored as a hidden-list, so new volumes show up by default. */
  const toggleHidden = (kind: "hiddenDisks" | "hiddenInterfaces", id: string, visible: boolean) =>
    setSettings((current) => {
      const hidden = new Set(current.panels[kind]);
      if (visible) hidden.delete(id);
      else hidden.add(id);
      return { ...current, panels: { ...current.panels, [kind]: [...hidden] } };
    });

  const disks = device.latest?.detail.disks ?? [];
  const interfaces = device.latest?.detail.network ?? [];

  // Everything on this page is saved by one button, so the bar at the bottom
  // has to know whether anything actually changed.
  const dirty =
    name !== device.name ||
    color !== device.color ||
    tags !== device.tags.join(", ") ||
    notes !== device.notes ||
    JSON.stringify(settings) !== JSON.stringify(device.settings);

  const discard = () => {
    setName(device.name);
    setColor(device.color);
    setTags(device.tags.join(", "));
    setNotes(device.notes);
    setSettings(device.settings);
  };

  const save = async () => {
    setSaving(true);
    const updated = await attempt(
      () =>
        api.updateDevice(device.id, {
          name: name.trim(),
          color,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          notes,
          settings,
        }),
      "Device saved."
    );
    setSaving(false);
    if (updated) onSaved(updated);
  };

  const refresh = async () => {
    const updated = await attempt(() => api.refreshDevice(device.id), "System details refreshed.");
    if (updated) onSaved(updated);
  };

  const rotate = async () => {
    const result = await attempt(() => api.rotateDeviceToken(device.id));
    if (result) setRotated(result.token);
  };

  const remove = async () => {
    const done = await attempt(() => api.deleteDevice(device.id), "Device removed.");
    setConfirmDelete(false);
    // The agent is still on the device, so show how to uninstall it before
    // leaving the page of a device that no longer exists.
    if (done) setRemoved(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Identity" description="How this device is named and found around the dashboard.">
          <Field label="Display name" hint="What this device is called everywhere. Its hostname still shows beside it when the two differ.">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          </Field>
          <Field label="Accent" hint="Shown as a coloured bar on the left of this device in the overview list.">
            <div className="flex flex-wrap gap-2">
              {DEVICE_COLORS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setColor(option.id)}
                  aria-label={option.label}
                  aria-pressed={color === option.id}
                  className={cn(
                    "h-7 w-7 rounded-full ring-offset-2 ring-offset-card transition-shadow",
                    color === option.id ? "ring-2 ring-foreground/70" : "ring-1 ring-border"
                  )}
                  style={{ background: deviceColor(option.id) }}
                />
              ))}
            </div>
          </Field>
          <Field label="Tags" hint="Separate them with commas. Typing a tag into the overview filter shows every device that has it.">
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="office, linux" />
          </Field>
          <Field label="Notes" hint="Anything worth remembering about this machine. Only shown here.">
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
          </Field>
        </Panel>

        <Panel title="Collection" description="What this device reports and when, overriding the server defaults.">
          <Field label="Sample interval" hint="How often the agent reports, in seconds.">
            <Input
              type="number"
              min={1}
              max={300}
              value={Math.round(settings.sampleIntervalMs / 1000)}
              onChange={(event) => patch("sampleIntervalMs", Math.max(1, Number(event.target.value) || 5) * 1000)}
            />
          </Field>
          <Field label="Offline after" hint="Seconds without a report before this device counts as offline and its offline alert fires.">
            <Input
              type="number"
              min={15}
              max={86400}
              value={settings.offlineAfterSec}
              onChange={(event) => patch("offlineAfterSec", Math.max(15, Number(event.target.value) || 30))}
            />
          </Field>

          <Field label="Agent updates" hint="When this device installs a newer agent, instead of following the server setting.">
            <Select
              value={settings.updatePolicy ?? "default"}
              onValueChange={(value) => patch("updatePolicy", value === "default" ? null : (value as UpdatePolicy))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Follow the server default</SelectItem>
                {UPDATE_POLICIES.map((policy) => (
                  <SelectItem key={policy} value={policy}>
                    {UPDATE_POLICY_LABELS[policy]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Panel>
      </div>

      {disks.length > 0 || interfaces.length > 0 ? (
        <Panel title="Panels" description="Choose what this device's page shows. Hidden entries are still collected, just not drawn.">
          <div className="grid gap-6 sm:grid-cols-2">
            {disks.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Volumes</p>
                <ul className="space-y-2">
                  {disks.map((entry) => {
                    const id = entry.mount;
                    const visible = !settings.panels.hiddenDisks.includes(id);
                    return (
                      <li key={`${entry.fs}-${id}`} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm text-foreground" title={entry.fs}>
                          {id || entry.fs}
                        </span>
                        <Switch
                          checked={visible}
                          aria-label={`Show ${id || entry.fs}`}
                          onCheckedChange={(checked) => toggleHidden("hiddenDisks", id, checked)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {interfaces.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Network interfaces</p>
                <ul className="space-y-2">
                  {interfaces.map((entry) => {
                    const visible = !settings.panels.hiddenInterfaces.includes(entry.iface);
                    return (
                      <li key={entry.iface} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm text-foreground">{entry.iface}</span>
                        <Switch
                          checked={visible}
                          aria-label={`Show ${entry.iface}`}
                          onCheckedChange={(checked) => toggleHidden("hiddenInterfaces", entry.iface, checked)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Danger zone"
        tone="danger"
        description="Careful. These take effect straight away and cannot be undone."
      >
        <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-surface-2 p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Allow ending processes</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Lets administrators end a running process on this device from the Processes tab. Saved with the button at
              the bottom of this page.
            </p>
          </div>
          <Switch
            checked={settings.allowProcessKill}
            onCheckedChange={(checked) => patch("allowProcessKill", checked)}
            aria-label="Allow ending processes"
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-surface-2 p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Rotate the device token</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Cuts this agent off until the installer is run again with the new token, which is shown once.
            </p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => void rotate()}>
            <KeyRound className="h-4 w-4" />
            Rotate token
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border border-danger/30 bg-danger/[0.06] p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Remove this device</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Deletes the device with its metric history and alerts. The agent keeps running until it is uninstalled.
            </p>
          </div>
          <Button variant="danger" className="shrink-0" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
            Remove device
          </Button>
        </div>
      </Panel>

      {/*
       * One save for the whole page. It sticks to the bottom of the scrolling
       * area so it stays reachable from any section, on a phone as much as on a
       * desktop, rather than belonging to whichever section it happened to sit in.
       */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-2xs text-muted-foreground">
            {dirty ? "This page has changes you have not saved." : "Everything on this page is saved."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
              Refresh system info
            </Button>
            <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={rotated !== null} onOpenChange={(open) => !open && setRotated(null)}>
        <DialogContent>
          <DialogHeader
            title="New device token"
            description="The agent was disconnected. Re-run the installer on the device with this token, which is shown only once."
          />
          <pre ref={rotatedCommand} className="scroll-slim overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-xs">
            curl -sSL {window.location.origin}/install.sh | sh -s -- --url {window.location.origin} --token{" "}
            {rotated}
          </pre>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (rotated) {
                  const command = `curl -sSL ${window.location.origin}/install.sh | sh -s -- --url ${window.location.origin} --token ${rotated}`;
                  void copyText(command, rotatedCommand.current).then((result) =>
                    result === "copied"
                      ? notify("Command copied.", "success")
                      : notify("This browser blocked the copy. The command is selected, so copy it from there.", "info")
                  );
                }
              }}
            >
              Copy command
            </Button>
            <Button variant="primary" onClick={() => setRotated(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader
            title={`Remove ${device.name}?`}
            description="Are you sure you want to delete this device? Its metric history and alerts are deleted too."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              <ShieldAlert className="h-4 w-4" />
              Remove device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoveAgentDialog
        open={removed}
        deviceName={device.name}
        platform={device.platform}
        onClose={() => {
          setRemoved(false);
          navigate("/");
        }}
      />
    </div>
  );
}
