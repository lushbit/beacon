import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { UPDATE_POLICIES, UPDATE_POLICY_LABELS } from "@beacon/shared";
import type { DeviceDto, DeviceSettingsDto, UpdatePolicy } from "@beacon/shared";
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
    if (done) navigate("/");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Identity</h3>
        <Field label="Display name">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
        </Field>
        <Field label="Accent" hint="Only used as a small dot to tell devices apart.">
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
        <Field label="Tags" hint="Comma separated, used by the overview filter.">
          <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="office, linux" />
        </Field>
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Collection</h3>
        <Field label="Sample interval" hint="How often the agent reports, in seconds.">
          <Input
            type="number"
            min={1}
            max={300}
            value={Math.round(settings.sampleIntervalMs / 1000)}
            onChange={(event) => patch("sampleIntervalMs", Math.max(1, Number(event.target.value) || 5) * 1000)}
          />
        </Field>
        <Field label="Offline after" hint="Seconds used as the threshold when Beacon creates this device's offline alert rule.">
          <Input
            type="number"
            min={15}
            max={86400}
            value={settings.offlineAfterSec}
            onChange={(event) => patch("offlineAfterSec", Math.max(15, Number(event.target.value) || 30))}
          />
        </Field>

        <Field label="Agent updates" hint="Overrides the server default for this device only.">
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

        <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 bg-surface-2 p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Allow ending processes</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Lets administrators end a process on this device from the dashboard.
            </p>
          </div>
          <Switch
            checked={settings.allowProcessKill}
            onCheckedChange={(checked) => patch("allowProcessKill", checked)}
            aria-label="Allow ending processes"
          />
        </div>

        <div className="space-y-3 rounded-md border border-border/60 bg-surface-2 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Screen viewing</p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {device.capabilities.screen
                  ? "Read-only view of the device's display, streamed by the agent."
                  : device.capabilities.screenReason ?? "This device cannot be captured."}
              </p>
            </div>
            <Switch
              checked={settings.screenEnabled}
              disabled={!device.capabilities.screen}
              onCheckedChange={(checked) => patch("screenEnabled", checked)}
              aria-label="Enable screen viewing"
            />
          </div>

          {settings.screenEnabled ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="FPS">
                <Input
                  type="number"
                  min={1}
                  max={15}
                  value={settings.screenFps}
                  onChange={(event) => patch("screenFps", Math.min(15, Math.max(1, Number(event.target.value) || 4)))}
                />
              </Field>
              <Field label="Quality">
                <Input
                  type="number"
                  min={20}
                  max={95}
                  value={settings.screenQuality}
                  onChange={(event) =>
                    patch("screenQuality", Math.min(95, Math.max(20, Number(event.target.value) || 60)))
                  }
                />
              </Field>
              <Field label="Max width">
                <Input
                  type="number"
                  min={480}
                  max={3840}
                  step={80}
                  value={settings.screenMaxWidth}
                  onChange={(event) =>
                    patch("screenMaxWidth", Math.min(3840, Math.max(480, Number(event.target.value) || 1280)))
                  }
                />
              </Field>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" />
            Refresh system info
          </Button>
          <Button variant="outline" onClick={() => void rotate()}>
            <KeyRound className="h-4 w-4" />
            Rotate token
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
            Remove device
          </Button>
        </div>
      </section>

      {disks.length > 0 || interfaces.length > 0 ? (
        <section className="space-y-4 rounded-lg border border-border/70 bg-card p-4 xl:col-span-2">
          <div>
            <h3 className="text-sm font-medium text-foreground">Panels</h3>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              Choose what this device's page shows. Hidden entries are still collected, just not drawn.
            </p>
          </div>

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

          <p className="text-2xs text-muted-foreground">Panel changes are saved with the button above.</p>
        </section>
      ) : null}

      <Dialog open={rotated !== null} onOpenChange={(open) => !open && setRotated(null)}>
        <DialogContent>
          <DialogHeader
            title="New device token"
            description="The agent was disconnected. Re-run the installer on the device with this token — it is shown only once."
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
                  void copyText(command, rotatedCommand.current).then((ok) =>
                    ok
                      ? notify("Command copied.", "success")
                      : notify("Could not copy — select the command and copy it manually.", "error")
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
            description="This deletes the device, its metric history and its alerts. The agent can enroll again with a new token."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Remove device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
