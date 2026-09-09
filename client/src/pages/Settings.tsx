import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, Bell, CheckCircle2, Database, Info, KeyRound, Plus, RefreshCw, ScrollText, Send, Trash2, User } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { UPDATE_POLICIES, UPDATE_POLICY_LABELS } from "@beacon/shared";
import type { AuditEntryDto, ChannelDto, DeviceSummaryDto, EnrollTokenDto, ServerSettingsDto } from "@beacon/shared";
import { PageHeader } from "@/components/DashboardLayout";
import { EnrollDialog } from "@/components/EnrollDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, useIsAdmin } from "@/context/AuthContext";
import { useVersion } from "@/context/VersionContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { RANGES } from "@/lib/time";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border/70 bg-card">
      <header className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? <p className="mt-0.5 text-2xs text-muted-foreground">{description}</p> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ProfileTab() {
  const { session, preferences, savePreferences } = useAuth();
  const { attempt } = useToast();
  const [displayName, setDisplayName] = useState(session?.user.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Profile">
        <div className="space-y-4">
          <Field label="Display name">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Button
            variant="secondary"
            onClick={() => void attempt(() => api.updateProfile({ displayName }), "Profile saved.")}
          >
            Save profile
          </Button>
        </div>
      </Section>

      <Section title="Password" description="Changing your password signs out your other sessions.">
        <div className="space-y-4">
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={async () => {
              const done = await attempt(
                () => api.updateProfile({ currentPassword, newPassword }),
                "Password changed."
              );
              if (done) {
                setCurrentPassword("");
                setNewPassword("");
              }
            }}
          >
            Change password
          </Button>
        </div>
      </Section>

      <Section title="Display" description="These preferences are stored on your account.">
        <div className="space-y-4">
          <Field label="Default time range">
            <Select
              value={String(preferences.defaultRange)}
              onValueChange={(value) => void savePreferences({ defaultRange: Number(value) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((range) => (
                  <SelectItem key={range.id} value={String(range.seconds)}>
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Size units">
            <Select
              value={String(preferences.unitBase)}
              onValueChange={(value) => void savePreferences({ unitBase: Number(value) === 1000 ? 1000 : 1024 })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1024">Binary (KiB, MiB, GiB)</SelectItem>
                <SelectItem value="1000">Decimal (kB, MB, GB)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Temperature">
            <Select
              value={preferences.temperatureUnit}
              onValueChange={(value) => void savePreferences({ temperatureUnit: value === "f" ? "f" : "c" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="c">Celsius</SelectItem>
                <SelectItem value="f">Fahrenheit</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">Compact rows</p>
              <p className="text-2xs text-muted-foreground">Tighter rows on the overview list.</p>
            </div>
            <Switch
              checked={preferences.compactCards}
              onCheckedChange={(checked) => void savePreferences({ compactCards: checked })}
              aria-label="Compact rows"
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

const CHANNEL_FIELDS: Record<ChannelDto["type"], { key: string; label: string; hint?: string; placeholder?: string }[]> = {
  ntfy: [
    { key: "url", label: "Server URL", placeholder: "https://ntfy.sh" },
    { key: "topic", label: "Topic", placeholder: "beacon-alerts" },
    { key: "token", label: "Access token", hint: "Optional, for protected topics." },
  ],
  webhook: [
    { key: "url", label: "Endpoint URL", placeholder: "https://example.com/hooks/beacon" },
    { key: "secret", label: "Signing secret", hint: "Optional. Sent as an X-Beacon-Signature HMAC." },
  ],
  discord: [{ key: "url", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…" }],
};

function NotificationsTab() {
  const { attempt, notify } = useToast();
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<ChannelDto["type"]>("ntfy");
  const [name, setName] = useState("");
  const [minSeverity, setMinSeverity] = useState<ChannelDto["minSeverity"]>("warning");
  const [config, setConfig] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setChannels(await api.channels());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load channels.", "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const created = await attempt(
      () => api.createChannel({ name: name.trim() || type, type, enabled: true, minSeverity, config }),
      "Channel added."
    );
    if (created) {
      setCreating(false);
      setName("");
      setConfig({});
      void load();
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Notification channels"
        description="Alerts are pushed to every enabled channel that matches their severity."
      >
        {channels.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No channels yet."
            description="Add ntfy, a Discord webhook or a plain webhook to get alerts outside the dashboard."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                Add channel
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border/50">
            {channels.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{channel.name}</p>
                  <p className="truncate text-2xs text-muted-foreground">
                    {channel.type} · {channel.config.url ?? ""} · at least {channel.minSeverity}
                    {channel.lastSentAt ? ` · last sent ${formatRelative(channel.lastSentAt)}` : ""}
                  </p>
                  {channel.lastError ? <p className="mt-0.5 text-2xs text-danger">{channel.lastError}</p> : null}
                </div>
                <Switch
                  checked={channel.enabled}
                  aria-label={`Enable ${channel.name}`}
                  onCheckedChange={async (checked) => {
                    await attempt(() => api.updateChannel(channel.id, { enabled: checked }));
                    void load();
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const result = await attempt(() => api.testChannel(channel.id));
                    if (result?.ok) notify("Test notification sent.", "success");
                    void load();
                  }}
                >
                  <Send className="h-3.5 w-3.5" />
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${channel.name}`}
                  onClick={async () => {
                    await attempt(() => api.deleteChannel(channel.id), "Channel removed.");
                    void load();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {channels.length > 0 ? (
          <Button variant="secondary" className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Add channel
          </Button>
        ) : null}
      </Section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="Add notification channel" />
          <div className="space-y-4">
            <Field label="Type">
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value as ChannelDto["type"]);
                  setConfig({});
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ntfy">ntfy</SelectItem>
                  <SelectItem value="discord">Discord webhook</SelectItem>
                  <SelectItem value="webhook">Generic webhook</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ops phone" />
            </Field>

            {CHANNEL_FIELDS[type].map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                <Input
                  value={config[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => setConfig((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </Field>
            ))}

            <Field label="Send when severity is at least">
              <Select
                value={minSeverity}
                onValueChange={(value) => setMinSeverity(value as ChannelDto["minSeverity"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()}>
              Add channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServerTab() {
  const { attempt, notify } = useToast();
  const [settings, setSettings] = useState<ServerSettingsDto | null>(null);
  const [storage, setStorage] = useState<{ devices: number; rows: number; sizeBytes: number } | null>(null);
  const [tokens, setTokens] = useState<EnrollTokenDto[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [serverSettings, storageStats, tokenList] = await Promise.all([
        api.settings(),
        api.storage(),
        api.enrollTokens(),
      ]);
      setSettings(serverSettings);
      setStorage(storageStats);
      setTokens(tokenList);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load settings.", "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) return null;

  const patch = (next: Partial<ServerSettingsDto>) => setSettings({ ...settings, ...next });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Server" description="Applies to every device unless overridden per device.">
        <div className="space-y-4">
          <Field label="Dashboard name">
            <Input value={settings.siteName} onChange={(event) => patch({ siteName: event.target.value })} />
          </Field>
          <Field label="Default sample interval (seconds)">
            <Input
              type="number"
              min={1}
              max={300}
              value={Math.round(settings.defaultSampleIntervalMs / 1000)}
              onChange={(event) =>
                patch({ defaultSampleIntervalMs: Math.max(1, Number(event.target.value) || 5) * 1000 })
              }
            />
          </Field>
          <Field label="Agent updates" hint="What agents do by default; a device can override this.">
            <Select
              value={settings.defaultUpdatePolicy}
              onValueChange={(value) => patch({ defaultUpdatePolicy: value as ServerSettingsDto["defaultUpdatePolicy"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPDATE_POLICIES.map((policy) => (
                  <SelectItem key={policy} value={policy}>
                    {UPDATE_POLICY_LABELS[policy]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {settings.defaultUpdatePolicy === "window" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Window starts (device hour)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={settings.updateWindowStartHour}
                  onChange={(event) =>
                    patch({ updateWindowStartHour: Math.min(23, Math.max(0, Number(event.target.value) || 0)) })
                  }
                />
              </Field>
              <Field label="Window ends (device hour)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={settings.updateWindowEndHour}
                  onChange={(event) =>
                    patch({ updateWindowEndHour: Math.min(23, Math.max(0, Number(event.target.value) || 0)) })
                  }
                />
              </Field>
            </div>
          ) : null}

          <Field label="Session length (hours)">
            <Input
              type="number"
              min={1}
              max={8760}
              value={settings.sessionTtlHours}
              onChange={(event) => patch({ sessionTtlHours: Math.max(1, Number(event.target.value) || 24) })}
            />
          </Field>
          <Button
            variant="secondary"
            onClick={() => void attempt(() => api.updateSettings(settings), "Settings saved.")}
          >
            Save server settings
          </Button>
        </div>
      </Section>

      <Section title="Retention" description="Older samples are averaged down rather than thrown away.">
        <div className="space-y-4">
          <Field label="Full resolution (hours)">
            <Input
              type="number"
              min={1}
              max={720}
              value={settings.retention.rawHours}
              onChange={(event) =>
                patch({ retention: { ...settings.retention, rawHours: Math.max(1, Number(event.target.value) || 48) } })
              }
            />
          </Field>
          <Field label="One-minute averages (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={settings.retention.minuteDays}
              onChange={(event) =>
                patch({
                  retention: { ...settings.retention, minuteDays: Math.max(1, Number(event.target.value) || 30) },
                })
              }
            />
          </Field>
          <Field label="Hourly averages (days)">
            <Input
              type="number"
              min={1}
              max={3650}
              value={settings.retention.hourDays}
              onChange={(event) =>
                patch({ retention: { ...settings.retention, hourDays: Math.max(1, Number(event.target.value) || 365) } })
              }
            />
          </Field>

          {storage ? (
            <p className="flex items-center gap-2 text-2xs text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              {storage.rows.toLocaleString()} samples across {storage.devices} devices ·{" "}
              {formatBytes(storage.sizeBytes)} on disk
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void attempt(() => api.updateSettings(settings), "Retention saved.")}
            >
              Save retention
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const result = await attempt(() => api.pruneStorage(), "Old samples removed.");
                if (result) setStorage(result);
              }}
            >
              Prune now
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Enrollment tokens" description="Used once by an agent, then swapped for a per-device token.">
        {tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No tokens outstanding."
            action={
              <Button variant="primary" onClick={() => setEnrolling(true)}>
                <Plus className="h-4 w-4" />
                New token
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border/50">
              {tokens.map((token) => (
                <li key={token.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{token.label || "Untitled token"}</p>
                    <p className="truncate text-2xs text-muted-foreground">
                      {token.uses}/{token.maxUses || "∞"} used ·{" "}
                      {token.expiresAt ? `expires ${formatDateTime(token.expiresAt)}` : "no expiry"}
                    </p>
                  </div>
                  {token.maxUses > 0 && token.uses >= token.maxUses ? <Badge>spent</Badge> : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete token"
                    onClick={async () => {
                      await attempt(() => api.deleteEnrollToken(token.id), "Token deleted.");
                      void load();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" className="mt-4" onClick={() => setEnrolling(true)}>
              <Plus className="h-4 w-4" />
              New token
            </Button>
          </>
        )}
      </Section>

      <EnrollDialog open={enrolling} onOpenChange={setEnrolling} onCreated={() => void load()} />
    </div>
  );
}

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);

  useEffect(() => {
    void api
      .audit(200)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  return (
    <Section title="Audit log" description="Sign-ins, device changes, screen viewing and administrative actions.">
      {entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nothing recorded yet." />
      ) : (
        <div className="scroll-slim max-h-[32rem] overflow-y-auto">
          <ul className="divide-y divide-border/50 text-xs">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="tabular text-muted-foreground">{formatDateTime(entry.ts)}</span>
                <span className="font-medium text-foreground">{entry.action}</span>
                <span className="text-muted-foreground">{entry.actor}</span>
                {entry.detail ? <span className="text-muted-foreground">— {entry.detail}</span> : null}
                {entry.ip ? <span className="ml-auto text-muted-foreground/70">{entry.ip}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}


function AboutTab() {
  const isAdmin = useIsAdmin();
  const { info, appVersion, needsReload, checking, check, reload } = useVersion();
  const { attempt, notify } = useToast();
  const [devices, setDevices] = useState<DeviceSummaryDto[]>([]);
  const [settings, setSettings] = useState<ServerSettingsDto | null>(null);

  useEffect(() => {
    void api.devices().then(setDevices).catch(() => setDevices([]));
    if (isAdmin) void api.settings().then(setSettings).catch(() => setSettings(null));
  }, [isAdmin]);

  // The hub decides what "outdated" means; it knows which build it can serve.
  const outdated = devices.filter((device) => device.compatibility === "outdated");
  const incompatible = devices.filter((device) => device.compatibility === "incompatible");
  const [updatingAll, setUpdatingAll] = useState(false);

  const reloadDevices = () => void api.devices().then(setDevices).catch(() => undefined);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Version" description="What this hub is running, and what the newest release is.">
        <div className="space-y-4">
          <div>
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">Installed</p>
            <p className="group flex items-center gap-2 text-2xl font-semibold leading-tight text-foreground">
              v{info?.current ?? "—"}
              {info?.updateAvailable && info.latest ? (
                <span
                  tabIndex={0}
                  aria-label={`Version ${info.latest.version} is available`}
                  className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-info/30 bg-info/10 text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-2xs font-normal text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    v{info.latest.version} available
                  </span>
                </span>
              ) : null}
            </p>
          </div>

          {info?.updateAvailable && info.latest ? (
            <div className="rounded-md border border-info/30 bg-info/10 p-3">
              <p className="flex items-center gap-2 text-sm text-info">
                <ArrowUpCircle className="h-4 w-4 shrink-0" />
                Version {info.latest.version} is available.
              </p>
              {info.latest.notes ? (
                <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-2xs text-muted-foreground scroll-slim">
                  {info.latest.notes.slice(0, 800)}
                </p>
              ) : null}
              {info.latest.url ? (
                <a
                  href={info.latest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-2xs text-info underline-offset-2 hover:underline"
                >
                  Read the release notes
                </a>
              ) : null}
            </div>
          ) : info?.checksEnabled ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              This hub is up to date.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Update checks are turned off.</p>
          )}

          {needsReload ? (
            <p className="text-2xs text-warning">
              This page is still running {appVersion}. Reload to catch up with the hub.
            </p>
          ) : null}

          <p className="text-2xs text-muted-foreground">
            Free software under the AGPL-3.0.{" "}
            {info?.sourceUrl ? (
              <a
                href={info.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                Source code
              </a>
            ) : null}
          </p>

          <p className="text-2xs text-muted-foreground">
            Protocol v{info?.protocol ?? "—"} ·{" "}
            {info?.checkedAt ? `checked ${formatRelative(info.checkedAt)}` : "never checked"}
          </p>
          {info?.error ? <p className="text-2xs text-warning">{info.error}</p> : null}

          {info?.updateAvailable && isAdmin ? (
            <div className="space-y-2 rounded-md border border-border/60 bg-surface-2 p-3">
              <p className="text-xs text-foreground">Update this hub</p>
              <pre className="scroll-slim overflow-x-auto rounded-md border border-border bg-card p-2 text-2xs text-muted-foreground">
                docker compose pull &amp;&amp; docker compose up -d
              </pre>
              <p className="text-2xs text-muted-foreground">
                Run it where your compose file lives. Your database and accounts are on a volume and are not touched.
              </p>
            </div>
          ) : null}

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                disabled={checking}
                onClick={async () => {
                  await attempt(() => check());
                  notify("Checked for updates.", "success");
                }}
              >
                <RefreshCw className="h-4 w-4" />
                {checking ? "Checking…" : "Check now"}
              </Button>
              {settings ? (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Switch
                    checked={settings.updateChecks}
                    onCheckedChange={async (checked) => {
                      const next = await attempt(() => api.updateSettings({ updateChecks: checked }));
                      if (next) {
                        setSettings(next);
                        await reload();
                      }
                    }}
                    aria-label="Check for updates"
                  />
                  Check for updates
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Agents" description="Agents report their version when they connect.">
        {devices.length === 0 ? (
          <EmptyState icon={Info} title="No devices enrolled yet." />
        ) : outdated.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Every agent is on the current version.
          </p>
        ) : (
          <>
            <div className="mb-3 space-y-2">
              <p className="text-sm text-muted-foreground">
                {outdated.length} agent{outdated.length === 1 ? "" : "s"} behind the current version. Updating keeps each
                device's identity and history.
              </p>
              {isAdmin ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={updatingAll}
                  onClick={async () => {
                    setUpdatingAll(true);
                    const result = await attempt(() => api.updateAllAgents());
                    setUpdatingAll(false);
                    if (result) {
                      notify(
                        result.started > 0
                          ? `Updating ${result.started} agent${result.started === 1 ? "" : "s"} to ${result.version}.`
                          : "No online agent needed updating.",
                        "success"
                      );
                      reloadDevices();
                    }
                  }}
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                  {updatingAll ? "Starting…" : "Update all agents"}
                </Button>
              ) : null}
            </div>
            <ul className="divide-y divide-border/50">
              {outdated.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm text-foreground">{device.name}</span>
                  <Badge tone="warning">v{device.agentVersion}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
        {incompatible.length > 0 ? (
          <p className="mt-3 text-2xs text-warning">
            {incompatible.length} agent{incompatible.length === 1 ? " is" : "s are"} too old for this hub to talk to and
            must be reinstalled from the device.
          </p>
        ) : null}
      </Section>
    </div>
  );
}

export function SettingsPage() {
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "profile";

  return (
    <>
      <PageHeader title="Settings" description="Your account, and how Beacon runs." />
      <div className="p-4 sm:p-6">
        <Tabs
          value={tab}
          onValueChange={(value) => setParams(value === "profile" ? {} : { tab: value }, { replace: true })}
          className="space-y-4"
        >
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="profile">
              <User className="mr-1.5 inline h-3.5 w-3.5" />
              Account
            </TabsTrigger>
            <TabsTrigger value="about">
              <Info className="mr-1.5 inline h-3.5 w-3.5" />
              About
            </TabsTrigger>
            {isAdmin ? (
              <TabsTrigger value="notifications">
                <Bell className="mr-1.5 inline h-3.5 w-3.5" />
                Notifications
              </TabsTrigger>
            ) : null}
            {isAdmin ? (
              <TabsTrigger value="server">
                <Database className="mr-1.5 inline h-3.5 w-3.5" />
                Server
              </TabsTrigger>
            ) : null}
            {isAdmin ? (
              <TabsTrigger value="audit">
                <ScrollText className="mr-1.5 inline h-3.5 w-3.5" />
                Audit
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab />
          </TabsContent>
          <TabsContent value="about">
            <AboutTab />
          </TabsContent>
          {isAdmin ? (
            <TabsContent value="notifications">
              <NotificationsTab />
            </TabsContent>
          ) : null}
          {isAdmin ? (
            <TabsContent value="server">
              <ServerTab />
            </TabsContent>
          ) : null}
          {isAdmin ? (
            <TabsContent value="audit">
              <AuditTab />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </>
  );
}
