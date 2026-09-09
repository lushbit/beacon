import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BellOff, Check, Info, Plus, Siren, Trash2 } from "lucide-react";
import {
  ALERT_METRICS,
  ALERT_METRIC_LABELS,
  ALERT_METRIC_UNITS,
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
import { useIsAdmin } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";

const SEVERITY_TONE = { info: "info", warning: "warning", critical: "danger" } as const;
const SEVERITY_ICON = { info: Info, warning: AlertTriangle, critical: Siren };

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
          <span title={formatDateTime(alert.startedAt)}>started {formatRelative(alert.startedAt)}</span>
          {alert.resolvedAt ? <span>· resolved {formatRelative(alert.resolvedAt)}</span> : null}
          {alert.acknowledgedBy ? <span>· acknowledged by {alert.acknowledgedBy}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={alert.state === "firing" ? SEVERITY_TONE[alert.severity] : "neutral"}>
          {alert.state === "firing" ? alert.severity : "resolved"}
        </Badge>
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

  const [alerts, setAlerts] = useState<AlertDto[] | null>(null);
  const [rules, setRules] = useState<AlertRuleDto[] | null>(null);
  const [devices, setDevices] = useState<DeviceSummaryDto[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRuleDto | null>(null);

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

  const firing = useMemo(() => (alerts ?? []).filter((alert) => alert.state === "firing"), [alerts]);
  const history = useMemo(() => (alerts ?? []).filter((alert) => alert.state !== "firing"), [alerts]);

  const acknowledge = async (id: string) => {
    await attempt(() => api.acknowledgeAlert(id));
    void load();
  };

  const deleteRule = async (rule: AlertRuleDto) => {
    await attempt(() => api.deleteRule(rule.id), "Rule deleted.");
    void load();
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        description={
          alerts === null ? "Loading…" : `${firing.length} firing · ${rules?.length ?? 0} rules`
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
        <Tabs defaultValue="firing" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="firing">Firing</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="firing">
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
              {alerts === null ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : firing.length === 0 ? (
                <EmptyState
                  icon={BellOff}
                  title="No alerts are firing."
                  description="Alerts appear here when a rule is triggered."
                />
              ) : (
                <ul className="divide-y divide-border/50">
                  {firing.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} onAcknowledge={(id) => void acknowledge(id)} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
              {history.length === 0 ? (
                <EmptyState icon={BellOff} title="No past alerts yet." />
              ) : (
                <ul className="divide-y divide-border/50">
                  {history.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} onAcknowledge={(id) => void acknowledge(id)} />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="rules">
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
              {rules === null ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : rules.length === 0 ? (
                <EmptyState icon={BellOff} title="No rules yet." description="Add a rule to be told when something changes." />
              ) : (
                <ul className="divide-y divide-border/50">
                  {rules.map((rule) => {
                    const device = devices.find((entry) => entry.id === rule.deviceId);
                    return (
                      <li key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{rule.name}</p>
                          <p className="mt-0.5 text-2xs text-muted-foreground">
                            {ALERT_METRIC_LABELS[rule.metric]} {rule.operator === "gt" ? "above" : "below"}{" "}
                            {rule.threshold}
                            {unitSuffix(rule.metric)} for {rule.durationSec}s ·{" "}
                            {device ? device.name : "all devices"}
                          </p>
                        </div>
                        <Badge tone={rule.enabled ? SEVERITY_TONE[rule.severity] : "neutral"}>
                          {rule.enabled ? rule.severity : "disabled"}
                        </Badge>
                        {isAdmin ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(rule);
                                setDialogOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${rule.name}`}
                              onClick={() => void deleteRule(rule)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
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
