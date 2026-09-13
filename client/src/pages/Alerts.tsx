import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BellOff, Check, ExternalLink, Info, Plus, Send, Siren, Trash2 } from "lucide-react";
import {
  ALERT_CATEGORIES,
  ALERT_CATEGORY_LABELS,
  ALERT_METRICS,
  ALERT_METRIC_CATEGORIES,
  ALERT_METRIC_LABELS,
  ALERT_METRIC_UNITS,
  type AlertCategory,
  type AlertDto,
  type AlertMetric,
  type AlertRuleDto,
  type DeviceSummaryDto,
} from "@beacon/shared";
import { PageHeader } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, useIsAdmin } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { RelativeTime } from "@/components/RelativeTime";
import { formatDateTime, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEVERITY_TONE = { info: "info", warning: "warning", critical: "danger" } as const;
const SEVERITY_ICON = { info: Info, warning: AlertTriangle, critical: Siren };

/**
 * Durations in words, because "for 300s" reads like a machine wrote it. Every
 * part is spelled out rather than rounded, so a rule set to 330 seconds says
 * five and a half minutes rather than six.
 */
function durationWords(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} second${rest === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** Shorter than the labels in the rule editor, which have to name a metric exactly. */
const SUMMARY_LABELS: Partial<Record<AlertMetric, string>> = {
  diskMaxPct: "Disk usage",
  load1: "Load average",
};

function thresholdWords(metric: AlertMetric, threshold: number): string {
  switch (ALERT_METRIC_UNITS[metric]) {
    case "percent":
      return `${threshold}%`;
    case "celsius":
      return `${threshold} °C`;
    case "bytesPerSec":
      return formatRate(threshold);
    case "seconds":
      return durationWords(threshold);
    default:
      return String(threshold);
  }
}

/**
 * What a rule watches, in one line someone can read at a glance. The device is
 * left out because the section heading above the row already names it, and
 * repeating it on every row is what made the list hard to read.
 */
function ruleSummary(rule: AlertRuleDto): string {
  if (rule.metric === "offline") return `No report for ${durationWords(rule.threshold)}`;
  const label = SUMMARY_LABELS[rule.metric] ?? ALERT_METRIC_LABELS[rule.metric];
  const direction = rule.operator === "gt" ? "above" : "below";
  // A rule that fires on the first reading has no duration worth printing.
  const sustained = rule.durationSec > 0 ? ` for ${durationWords(rule.durationSec)}` : "";
  return `${label} ${direction} ${thresholdWords(rule.metric, rule.threshold)}${sustained}`;
}

/**
 * An empty selection means everything rather than nothing, so a tab opens
 * unfiltered and turning the last chip back off returns to the full list.
 */
function matchesCategories(metric: AlertMetric, selected: Set<AlertCategory>): boolean {
  return selected.size === 0 || selected.has(ALERT_METRIC_CATEGORIES[metric]);
}

function countByCategory(metrics: AlertMetric[]): Map<AlertCategory, number> {
  const counts = new Map<AlertCategory, number>();
  for (const metric of metrics) {
    const category = ALERT_METRIC_CATEGORIES[metric];
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

/**
 * The category chips above a list. Several can be on at once, so picking CPU
 * and Memory shows both and nothing else. Only categories that something in
 * this tab actually uses get a chip, so the row does not offer a filter that
 * would empty the list.
 */
function CategoryFilter({
  counts,
  selected,
  onChange,
}: {
  counts: Map<AlertCategory, number>;
  selected: Set<AlertCategory>;
  onChange: (next: Set<AlertCategory>) => void;
}) {
  const available = ALERT_CATEGORIES.filter((category) => (counts.get(category) ?? 0) > 0);
  // With one category there is nothing to choose between.
  if (available.length < 2) return null;

  const toggle = (category: AlertCategory) => {
    const next = new Set(selected);
    if (!next.delete(category)) next.add(category);
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Filter by category"
        className="scroll-slim flex max-w-full items-center gap-1 overflow-x-auto rounded-md bg-surface-2 p-1"
      >
        {available.map((category) => {
          const on = selected.has(category);
          return (
            <button
              key={category}
              type="button"
              onClick={() => toggle(category)}
              aria-pressed={on}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                on ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {ALERT_CATEGORY_LABELS[category]}
              <span className="tabular text-2xs text-muted-foreground">{counts.get(category)}</span>
            </button>
          );
        })}
      </div>
      {selected.size > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(new Set())}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function unitSuffix(metric: AlertMetric): string {
  switch (ALERT_METRIC_UNITS[metric]) {
    case "percent":
      return "%";
    case "celsius":
      return "°C";
    case "bytesPerSec":
      return "bytes/s";
    case "seconds":
      return "seconds";
    default:
      return "";
  }
}

/** How many alerts in this tab this account has not looked at yet. */
function TabCount({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-white/[0.12] px-1.5 py-0.5 text-2xs font-semibold tabular text-foreground">
      {value > 99 ? "99+" : value}
    </span>
  );
}

function AlertRow({ alert, onAcknowledge }: { alert: AlertDto; onAcknowledge: (id: string) => void }) {
  const Icon = SEVERITY_ICON[alert.severity];
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          alert.severity === "critical" ? "text-danger" : alert.severity === "warning" ? "text-warning" : "text-info"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{alert.message}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <Link to={`/devices/${alert.deviceId}`} className="underline-offset-2 hover:underline">
            {alert.deviceName}
          </Link>
          <span aria-hidden>·</span>
          <span>{alert.ruleName}</span>
          <span aria-hidden>·</span>
          <span title={formatDateTime(alert.startedAt)}>
            started <RelativeTime value={alert.startedAt} />
          </span>
          {alert.resolvedAt ? (
            <span>
              · resolved <RelativeTime value={alert.resolvedAt} />
            </span>
          ) : null}
          {alert.acknowledgedBy ? <span>· acknowledged by {alert.acknowledgedBy}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={alert.state === "firing" ? SEVERITY_TONE[alert.severity] : "neutral"}>
          {alert.state === "firing" ? alert.severity : "resolved"}
        </Badge>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/devices/${alert.deviceId}`}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open device
          </Link>
        </Button>
        {alert.state === "firing" && !alert.acknowledgedAt ? (
          <Button variant="ghost" size="sm" onClick={() => onAcknowledge(alert.id)}>
            <Check className="h-3.5 w-3.5" />
            Acknowledge
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One rule inside a device section. The device is named by the heading above,
 * so the summary here leaves it out.
 */
function RuleRow({
  rule,
  isAdmin,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: {
  rule: AlertRuleDto;
  isAdmin: boolean;
  onToggle: (rule: AlertRuleDto, enabled: boolean) => void;
  onTest: (rule: AlertRuleDto) => void;
  onEdit: (rule: AlertRuleDto) => void;
  onDelete: (rule: AlertRuleDto) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", rule.enabled ? "text-foreground" : "text-muted-foreground")}>
          {rule.name}
        </p>
        <p className="mt-0.5 text-2xs text-muted-foreground">{ruleSummary(rule)}</p>
      </div>
      <Badge tone={rule.enabled ? SEVERITY_TONE[rule.severity] : "neutral"}>
        {rule.enabled ? rule.severity : "disabled"}
      </Badge>
      {isAdmin ? (
        <div className="flex items-center gap-1">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(checked) => onToggle(rule, checked)}
            aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
            title={rule.enabled ? "Disable this rule" : "Enable this rule"}
            className="mr-1"
          />
          <Button variant="ghost" size="sm" onClick={() => onTest(rule)}>
            <Send className="h-3.5 w-3.5" />
            Test
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEdit(rule)}>
            Edit
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Delete ${rule.name}`} onClick={() => onDelete(rule)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

const EMPTY_RULE: Omit<AlertRuleDto, "id" | "createdAt"> = {
  name: "",
  deviceId: null,
  metric: "cpuPct",
  operator: "gt",
  threshold: 90,
  durationSec: 300,
  severity: "warning",
  cooldownSec: 900,
  enabled: true,
};

function RuleDialog({
  open,
  onOpenChange,
  devices,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: DeviceSummaryDto[];
  editing: AlertRuleDto | null;
  onSaved: () => void;
}) {
  const { attempt } = useToast();
  const [draft, setDraft] = useState(EMPTY_RULE);

  useEffect(() => {
    if (!open) return;
    setDraft(editing ? { ...editing } : EMPTY_RULE);
  }, [open, editing]);

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const body = { ...draft, name: draft.name.trim() || ALERT_METRIC_LABELS[draft.metric] };
    const result = editing
      ? await attempt(() => api.updateRule(editing.id, body), "Rule updated.")
      : await attempt(() => api.createRule(body), "Rule created.");
    if (result) {
      onOpenChange(false);
      onSaved();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={editing ? "Edit rule" : "New alert rule"}
          description="Rules are checked against every sample as it arrives."
        />
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder={ALERT_METRIC_LABELS[draft.metric]}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device">
              <Select
                value={draft.deviceId ?? "all"}
                onValueChange={(value) => set("deviceId", value === "all" ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All devices</SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Metric">
              <Select value={draft.metric} onValueChange={(value) => set("metric", value as AlertMetric)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALERT_METRICS.map((metric) => (
                    <SelectItem key={metric} value={metric}>
                      {ALERT_METRIC_LABELS[metric]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Condition">
              <Select value={draft.operator} onValueChange={(value) => set("operator", value as "gt" | "lt")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gt">Above</SelectItem>
                  <SelectItem value="lt">Below</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label={`Threshold (${unitSuffix(draft.metric)})`}>
              <Input
                type="number"
                value={draft.threshold}
                onChange={(event) => set("threshold", Number(event.target.value))}
              />
            </Field>

            <Field label="For (seconds)" hint="How long the condition must hold before it fires.">
              <Input
                type="number"
                min={0}
                value={draft.durationSec}
                onChange={(event) => set("durationSec", Math.max(0, Number(event.target.value) || 0))}
              />
            </Field>

            <Field label="Cooldown (seconds)" hint="Minimum gap between repeats of this alert.">
              <Input
                type="number"
                min={0}
                value={draft.cooldownSec}
                onChange={(event) => set("cooldownSec", Math.max(0, Number(event.target.value) || 0))}
              />
            </Field>

            <Field label="Severity">
              <Select
                value={draft.severity}
                onValueChange={(value) => set("severity", value as AlertRuleDto["severity"])}
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

            <div className="flex items-end justify-between gap-3 pb-1">
              <span className="text-sm text-foreground">Enabled</span>
              <Switch checked={draft.enabled} onCheckedChange={(checked) => set("enabled", checked)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {editing ? "Save rule" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlertsPage() {
  const isAdmin = useIsAdmin();
  const { lastAlert } = useLive();
  const { attempt, notify } = useToast();
  const { preferences, savePreferences } = useAuth();

  /**
   * Opening this page is not the same as reading it, so the counts survive
   * until a tab is actually picked. Each tab clears its own. It lives in a ref
   * so that saving a preference, which hands back a new `savePreferences`,
   * cannot turn this into a loop.
   */
  const markSeen = useRef<(tab: "active" | "history") => void>(() => {});
  markSeen.current = (tab) =>
    void savePreferences(tab === "active" ? { alertsActiveSeenAt: Date.now() } : { alertsHistorySeenAt: Date.now() });

  const [alerts, setAlerts] = useState<AlertDto[] | null>(null);
  const [rules, setRules] = useState<AlertRuleDto[] | null>(null);
  const [devices, setDevices] = useState<DeviceSummaryDto[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRuleDto | null>(null);
  // Each tab keeps its own chips, since filtering the history says nothing
  // about which rules someone wants to look at.
  const [historyCategories, setHistoryCategories] = useState<Set<AlertCategory>>(new Set());
  const [ruleCategories, setRuleCategories] = useState<Set<AlertCategory>>(new Set());

  const load = useCallback(async () => {
    try {
      const [alertList, ruleList, deviceList] = await Promise.all([api.alerts({ limit: 200 }), api.rules(), api.devices()]);
      setAlerts(alertList);
      setRules(ruleList);
      setDevices(deviceList);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load alerts.", "error");
      setAlerts([]);
      setRules([]);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new alert on the socket means the list is stale.
  useEffect(() => {
    if (lastAlert) void load();
  }, [lastAlert, load]);

  const active = useMemo(() => (alerts ?? []).filter((alert) => alert.state === "firing"), [alerts]);
  const history = useMemo(() => (alerts ?? []).filter((alert) => alert.state !== "firing"), [alerts]);

  const historyCounts = useMemo(() => countByCategory(history.map((alert) => alert.metric)), [history]);
  const visibleHistory = useMemo(
    () => history.filter((alert) => matchesCategories(alert.metric, historyCategories)),
    [history, historyCategories]
  );

  const ruleCounts = useMemo(() => countByCategory((rules ?? []).map((rule) => rule.metric)), [rules]);

  /**
   * Rules grouped into one section per device, so the page reads as a set of
   * devices rather than one mixed column. Rules that watch every device come
   * first, then the devices in the order the rest of the dashboard lists them.
   * A rule pointing at a device the hub no longer knows still gets a section,
   * because dropping it would hide a rule that is still being evaluated.
   */
  const ruleSections = useMemo(() => {
    const byDevice = new Map<string, AlertRuleDto[]>();
    for (const rule of rules ?? []) {
      if (!matchesCategories(rule.metric, ruleCategories)) continue;
      // The rule editor already uses "all" for the every-device option, so no
      // device can carry that id.
      const key = rule.deviceId ?? "all";
      const list = byDevice.get(key);
      if (list) list.push(rule);
      else byDevice.set(key, [rule]);
    }

    const sections: { key: string; name: string; href: string | null; rules: AlertRuleDto[] }[] = [];
    const take = (key: string, name: string, href: string | null) => {
      const list = byDevice.get(key);
      if (!list) return;
      byDevice.delete(key);
      sections.push({ key, name, href, rules: list });
    };

    take("all", "All devices", null);
    for (const device of devices) take(device.id, device.name, `/devices/${device.id}`);
    for (const [key, list] of byDevice) sections.push({ key, name: "Unknown device", href: null, rules: list });
    return sections;
  }, [rules, devices, ruleCategories]);

  // Counted the same way the hub counts them for the sidebar badge.
  const unreadActive = active.filter((alert) => alert.startedAt > preferences.alertsActiveSeenAt).length;
  const unreadHistory = history.filter(
    (alert) => (alert.resolvedAt ?? alert.startedAt) > preferences.alertsHistorySeenAt
  ).length;

  const acknowledge = async (id: string) => {
    await attempt(() => api.acknowledgeAlert(id));
    // Acting on an alert is as good as reading it, and this is also what tells
    // the sidebar to re-read its badge.
    markSeen.current("active");
    void load();
  };

  const deleteRule = async (rule: AlertRuleDto) => {
    await attempt(() => api.deleteRule(rule.id), "Rule deleted.");
    void load();
  };

  /**
   * The switch moves at once rather than waiting for the hub, so it never sits
   * on the old state under the finger. A refused request puts it back.
   */
  const setRuleEnabled = async (rule: AlertRuleDto, enabled: boolean) => {
    const apply = (value: boolean) =>
      setRules((current) => current?.map((entry) => (entry.id === rule.id ? { ...entry, enabled: value } : entry)) ?? current);
    apply(enabled);
    const result = await attempt(() => api.updateRule(rule.id, { enabled }), enabled ? "Rule enabled." : "Rule disabled.");
    if (!result) apply(rule.enabled);
    else void load();
  };

  const testRule = async (rule: AlertRuleDto) => {
    const result = await attempt(() => api.testRule(rule.id));
    if (!result) return;
    if (result.failures.length > 0) {
      notify(`${result.failures[0].channel}: ${result.failures[0].error}`, "error");
    } else if (result.sent === 0) {
      notify(
        result.skipped > 0 ? "No channel accepts this severity." : "No notification channel is enabled.",
        "error"
      );
    } else {
      notify(`Test alert sent to ${result.sent} channel${result.sent === 1 ? "" : "s"}.`, "success");
    }
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        description={
          alerts === null ? "Loading…" : `${active.length} active · ${rules?.length ?? 0} rules`
        }
        actions={
          isAdmin ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New rule
            </Button>
          ) : null
        }
      />

      <div className="p-4 sm:p-6">
        <Tabs defaultValue="active" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="active" onClick={() => markSeen.current("active")}>
              Active
              <TabCount value={unreadActive} />
            </TabsTrigger>
            <TabsTrigger value="history" onClick={() => markSeen.current("history")}>
              History
              <TabCount value={unreadHistory} />
            </TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
              {alerts === null ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : active.length === 0 ? (
                <EmptyState
                  icon={BellOff}
                  title="No active alerts."
                  description="Alerts appear here when a rule is triggered."
                />
              ) : (
                <ul className="divide-y divide-border/50">
                  {active.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} onAcknowledge={(id) => void acknowledge(id)} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <CategoryFilter counts={historyCounts} selected={historyCategories} onChange={setHistoryCategories} />
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
              {visibleHistory.length === 0 ? (
                history.length === 0 ? (
                  <EmptyState icon={BellOff} title="No past alerts yet." />
                ) : (
                  <EmptyState
                    icon={BellOff}
                    title="No past alerts match those filters."
                    description="Turn a filter off to see the rest."
                  />
                )
              ) : (
                <ul className="divide-y divide-border/50">
                  {visibleHistory.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} onAcknowledge={(id) => void acknowledge(id)} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <CategoryFilter counts={ruleCounts} selected={ruleCategories} onChange={setRuleCategories} />
            {rules === null ? (
              <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              </div>
            ) : ruleSections.length === 0 ? (
              <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                {rules.length === 0 ? (
                  <EmptyState
                    icon={BellOff}
                    title="No rules yet."
                    description="Add a rule to be told when something changes."
                  />
                ) : (
                  <EmptyState
                    icon={BellOff}
                    title="No rules match those filters."
                    description="Turn a filter off to see the rest."
                  />
                )}
              </div>
            ) : (
              ruleSections.map((section) => (
                <section
                  key={section.key}
                  className="overflow-hidden rounded-lg border border-border/70 bg-card"
                >
                  <header className="flex items-center justify-between gap-3 border-b border-border/50 bg-surface-2/50 px-4 py-2.5">
                    {section.href ? (
                      <Link
                        to={section.href}
                        className="truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {section.name}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium text-foreground">{section.name}</span>
                    )}
                    <span className="shrink-0 text-2xs tabular text-muted-foreground">
                      {section.rules.length} rule{section.rules.length === 1 ? "" : "s"}
                    </span>
                  </header>
                  <ul className="divide-y divide-border/50">
                    {section.rules.map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        isAdmin={isAdmin}
                        onToggle={(target, enabled) => void setRuleEnabled(target, enabled)}
                        onTest={(target) => void testRule(target)}
                        onEdit={(target) => {
                          setEditing(target);
                          setDialogOpen(true);
                        }}
                        onDelete={(target) => void deleteRule(target)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        devices={devices}
        editing={editing}
        onSaved={() => void load()}
      />
    </>
  );
}
