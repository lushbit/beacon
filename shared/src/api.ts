/** DTOs returned by the hub's REST API and consumed by the dashboard. */

import type {
  AlertMetric,
  AlertOperator,
  AlertSeverity,
  AlertState,
  DeviceCapabilities,
  DeviceStaticInfo,
  MetricSample,
  MetricSummary,
  MetricTier,
} from "./metrics.js";

export type UserRole = "admin" | "viewer";

export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface SessionDto {
  user: UserDto;
  preferences: UserPreferences;
}

/**
 * Columns the overview list can be ordered by. "none" is the natural order —
 * online devices first, then by name — which is what the list looks like when
 * nobody has asked for a particular column.
 */
export const DEVICE_SORTS = [
  "none",
  "name",
  "cpu",
  "memory",
  "disk",
  "net",
  "temp",
  "uptime",
  "alerts",
  "agent",
] as const;
export type DeviceSort = (typeof DEVICE_SORTS)[number];

export type SortDirection = "asc" | "desc";

export const DEVICE_SORT_LABELS: Record<DeviceSort, string> = {
  none: "Default",
  name: "System",
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
  net: "Net",
  temp: "Temp",
  uptime: "Uptime",
  alerts: "Alerts",
  agent: "Agent",
};

/**
 * What each direction means for a given column, so the interface can say it in
 * words instead of leaving an arrow to be interpreted.
 */
export const DEVICE_SORT_DIRECTION_LABELS: Record<DeviceSort, Record<SortDirection, string>> = {
  none: { asc: "Default order", desc: "Default order" },
  name: { asc: "A to Z", desc: "Z to A" },
  cpu: { asc: "Idlest first", desc: "Busiest first" },
  memory: { asc: "Least used first", desc: "Most used first" },
  disk: { asc: "Emptiest first", desc: "Fullest first" },
  net: { asc: "Quietest first", desc: "Busiest first" },
  temp: { asc: "Coolest first", desc: "Hottest first" },
  uptime: { asc: "Shortest first", desc: "Longest first" },
  alerts: { asc: "Fewest first", desc: "Most first" },
  agent: { asc: "Oldest build first", desc: "Newest build first" },
};

export interface UserPreferences {
  /** Seconds of history the device charts show by default. */
  defaultRange: number;
  /** Bytes rendered as KB/MB (1000) or KiB/MiB (1024). */
  unitBase: 1000 | 1024;
  temperatureUnit: "c" | "f";
  deviceSort: DeviceSort;
  /** Direction the chosen attribute is sorted in; ignored when sort is "none". */
  deviceSortDir: SortDirection;
  compactCards: boolean;
  /**
   * When this account last opened each tab of the Alerts page. Anything raised
   * since then counts as unread, which is what the sidebar badge and the tab
   * titles show. Both belong to the account rather than to a browser, so they
   * follow the person from one machine to the next.
   */
  alertsActiveSeenAt: number;
  alertsHistorySeenAt: number;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  defaultRange: 3600,
  unitBase: 1024,
  temperatureUnit: "c",
  deviceSort: "none",
  deviceSortDir: "asc",
  compactCards: false,
  alertsActiveSeenAt: 0,
  alertsHistorySeenAt: 0,
};

/** Counts behind the badge beside Alerts in the sidebar. */
export interface AlertSummaryDto {
  /** Alerts firing right now. */
  active: number;
  /** How many of those nobody has acknowledged. */
  unacknowledged: number;
  /** Firing alerts raised since this account last opened the Active tab. */
  unreadActive: number;
  /** Alerts that ended since this account last opened the History tab. */
  unreadHistory: number;
}

export interface DevicePanelSettings {
  /** Panels the device page renders, in order. Empty means "all defaults". */
  panels: string[];
  hiddenDisks: string[];
  hiddenInterfaces: string[];
}

export interface DeviceSettingsDto {
  sampleIntervalMs: number;
  /** Empty means "follow the server default". */
  updatePolicy: UpdatePolicy | null;
  allowProcessKill: boolean;
  offlineAfterSec: number;
  panels: DevicePanelSettings;
}

export interface DeviceDto {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  os: string;
  arch: string;
  color: string;
  tags: string[];
  notes: string;
  status: "online" | "offline" | "never";
  lastSeenAt: number | null;
  createdAt: number;
  capabilities: DeviceCapabilities;
  staticInfo: DeviceStaticInfo | null;
  settings: DeviceSettingsDto;
  agentVersion: string | null;
  protocolVersion: number | null;
  compatibility: AgentCompatibility;
  updateState: AgentUpdateStateDto;
  latest: MetricSample | null;
  activeAlerts: number;
}

export interface DeviceSummaryDto {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  os: string;
  color: string;
  tags: string[];
  status: "online" | "offline" | "never";
  lastSeenAt: number | null;
  capabilities: DeviceCapabilities;
  agentVersion: string | null;
  compatibility: AgentCompatibility;
  updateState: AgentUpdateStateDto;
  latest: MetricSample | null;
  activeAlerts: number;
  /** Short recent history for the card sparklines. */
  spark: { ts: number; cpuPct: number; memPct: number }[];
}

export interface MetricSeriesPoint extends Partial<MetricSummary> {
  ts: number;
}

export interface MetricSeriesDto {
  deviceId: string;
  tier: MetricTier;
  from: number;
  to: number;
  stepSec: number;
  points: MetricSeriesPoint[];
}

export interface EnrollTokenDto {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number | null;
  uses: number;
  maxUses: number;
  createdBy: string | null;
  lastUsedAt: number | null;
  /** Only returned once, at creation time. */
  token?: string;
}

/**
 * Whether a device has checked in with a given enrollment token yet. The hub
 * never dials out to a device, so the "add a device" dialog waits for this
 * rather than being able to trigger a connection itself.
 */
export interface EnrollStatusDto {
  used: boolean;
  lastUsedAt: number | null;
  device: { id: string; name: string; online: boolean } | null;
}

export interface AlertRuleDto {
  id: string;
  name: string;
  deviceId: string | null;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  durationSec: number;
  severity: AlertSeverity;
  cooldownSec: number;
  enabled: boolean;
  createdAt: number;
}

export interface AlertDto {
  id: string;
  ruleId: string | null;
  ruleName: string;
  deviceId: string;
  deviceName: string;
  metric: AlertMetric;
  severity: AlertSeverity;
  state: AlertState;
  value: number | null;
  threshold: number | null;
  message: string;
  startedAt: number;
  resolvedAt: number | null;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  /** A made-up alert sent by a Test button rather than something that happened. */
  test?: boolean;
}

export type ChannelType = "ntfy" | "webhook" | "discord";

export interface ChannelDto {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  minSeverity: AlertSeverity;
  /** Secrets are redacted on read. */
  config: Record<string, string>;
  createdAt: number;
  lastError: string | null;
  lastSentAt: number | null;
}

export interface RetentionSettings {
  rawHours: number;
  minuteDays: number;
  hourDays: number;
}

export interface ServerSettingsDto {
  retention: RetentionSettings;
  defaultSampleIntervalMs: number;
  defaultOfflineAfterSec: number;
  sessionTtlHours: number;
  /** Ask the release feed whether a newer version exists. */
  updateChecks: boolean;
  /** Default agent update policy; a device may override it. */
  defaultUpdatePolicy: UpdatePolicy;
  /** Local hours at the device between which scheduled updates may run. */
  updateWindowStartHour: number;
  updateWindowEndHour: number;
  siteName: string;
}

export interface AuditEntryDto {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

/** Update policy for an agent, set globally and overridable per device. */
export const UPDATE_POLICIES = ["manual", "connect", "window"] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

export const UPDATE_POLICY_LABELS: Record<UpdatePolicy, string> = {
  manual: "Only when I update it myself",
  connect: "When the agent reconnects",
  window: "Overnight",
};

/** How an agent's version relates to what the hub can serve. */
export type AgentCompatibility = "current" | "outdated" | "incompatible" | "unknown";

export interface AgentUpdateStateDto {
  state: "idle" | "requested" | "downloading" | "restarting" | "confirmed" | "failed";
  targetVersion: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

/** What the hub can hand an agent, published for the update flow. */
export interface AgentManifestDto {
  version: string;
  protocol: number;
  minProtocol: number;
  sha256: string;
  sizeBytes: number;
  filename: string;
  url: string;
}

export interface ReleaseInfo {
  version: string;
  url: string;
  publishedAt: number | null;
  notes: string;
}

export interface VersionDto {
  /** Version this hub is running. */
  current: string;
  protocol: number;
  /** Where this build came from; used to build install commands. */
  sourceUrl: string;
  latest: ReleaseInfo | null;
  /** The release matching the version this hub runs, for the "what changed" notice. */
  installed: ReleaseInfo | null;
  updateAvailable: boolean;
  checkedAt: number | null;
  checksEnabled: boolean;
  /** Why the last check failed, if it did. */
  error: string | null;
}

export interface SetupStateDto {
  needsSetup: boolean;
  siteName: string;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}
