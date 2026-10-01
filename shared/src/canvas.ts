/**
 * Beacon Canvas: pages an admin builds out of blocks on a grid and publishes
 * for people without an account.
 *
 * Everything a visitor receives is cut down to what the page's blocks show.
 * `canvasNeeds` works out what that is, and `buildSnapshot` builds a device's
 * state from a sample with nothing else in it. The hub uses both for public
 * pages and the editor uses them for its preview, so a page looks the same in
 * both places.
 */

import type { DevicePanelSettings } from "./api.js";
import type { DeviceStaticInfo, MetricSample, MetricSummary } from "./metrics.js";

/* ------------------------------------------------------------------ the grid */

/** Columns across the page. Blocks are placed and sized in these. */
export const CANVAS_COLUMNS = 24;
/** Height of one grid row in pixels. */
export const CANVAS_ROW_HEIGHT = 28;
/** Space between blocks in pixels, both ways. */
export const CANVAS_GAP = 12;
export const CANVAS_MAX_ROWS = 400;
export const CANVAS_MAX_BLOCKS = 150;

/** Widths a page can be held to. 0 lets it fill the window. */
export const CANVAS_WIDTHS = [0, 1200, 1440, 1680, 1920] as const;

/** Ranges a chart can show, in seconds. */
export const CANVAS_RANGES = [
  { seconds: 900, label: "15m" },
  { seconds: 3600, label: "1h" },
  { seconds: 21_600, label: "6h" },
  { seconds: 86_400, label: "24h" },
  { seconds: 604_800, label: "7d" },
  { seconds: 2_592_000, label: "30d" },
] as const;

export const CANVAS_RANGE_SECONDS: readonly number[] = CANVAS_RANGES.map((range) => range.seconds);

export function canvasRangeLabel(seconds: number): string {
  return CANVAS_RANGES.find((range) => range.seconds === seconds)?.label ?? `${Math.round(seconds / 60)}m`;
}

/** Lowercase letters, digits and single dashes, 2 to 48 characters. */
export const CANVAS_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,47}$/;

/** A slug made from a title, for the new page dialog to suggest. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/* ----------------------------------------------------------------- metrics */

export type CanvasUnit =
  | "percent"
  | "bytes"
  | "rate"
  | "temperature"
  | "clock"
  | "watts"
  | "ms"
  | "ops"
  | "load"
  | "count"
  | "duration";

/**
 * Where a metric's numbers come from. `device` reads the summary. The others
 * read one GPU, drive or network interface, picked in the block as `sub`, and
 * fall back to the summary when nothing is picked (except drive temperature,
 * which only exists per drive).
 */
export type CanvasScope = "device" | "gpu" | "drive" | "iface";

export interface CanvasMetricField {
  key: string;
  label: string;
}

export interface CanvasMetric {
  id: string;
  label: string;
  group: string;
  unit: CanvasUnit;
  scope: CanvasScope;
  fields: CanvasMetricField[];
  /** The axis and the gauge never pass this, which is 100 for a percentage. */
  max?: number;
  /** Whether it makes sense as a line over time. Uptime does not. */
  chart: boolean;
}

export const CANVAS_METRICS: CanvasMetric[] = [
  { id: "cpu", label: "CPU usage", group: "CPU", unit: "percent", scope: "device", max: 100, chart: true, fields: [{ key: "cpuPct", label: "CPU" }] },
  {
    id: "cpuTime",
    label: "CPU user and system",
    group: "CPU",
    unit: "percent",
    scope: "device",
    max: 100,
    chart: true,
    fields: [
      { key: "cpuUserPct", label: "User" },
      { key: "cpuSystemPct", label: "System" },
      { key: "cpuStealPct", label: "Steal" },
    ],
  },
  {
    id: "load",
    label: "Load average",
    group: "CPU",
    unit: "load",
    scope: "device",
    chart: true,
    fields: [
      { key: "load1", label: "1 min" },
      { key: "load5", label: "5 min" },
      { key: "load15", label: "15 min" },
    ],
  },
  { id: "cpuClock", label: "Clock speed", group: "CPU", unit: "clock", scope: "device", chart: true, fields: [{ key: "cpuMhz", label: "Clock" }] },
  { id: "cpuTemp", label: "CPU temperature", group: "CPU", unit: "temperature", scope: "device", chart: true, fields: [{ key: "cpuTempC", label: "Temperature" }] },
  { id: "memory", label: "Memory usage", group: "Memory", unit: "percent", scope: "device", max: 100, chart: true, fields: [{ key: "memPct", label: "Memory" }] },
  {
    id: "memoryUsed",
    label: "Memory used and cached",
    group: "Memory",
    unit: "bytes",
    scope: "device",
    chart: true,
    fields: [
      { key: "memUsedBytes", label: "Used" },
      { key: "memCacheBytes", label: "Cache" },
    ],
  },
  { id: "memoryTotal", label: "Memory installed", group: "Memory", unit: "bytes", scope: "device", chart: false, fields: [{ key: "memTotalBytes", label: "Installed" }] },
  { id: "swap", label: "Swap usage", group: "Memory", unit: "percent", scope: "device", max: 100, chart: true, fields: [{ key: "swapPct", label: "Swap" }] },
  { id: "diskSpace", label: "Disk usage (fullest volume)", group: "Disk", unit: "percent", scope: "device", max: 100, chart: true, fields: [{ key: "diskMaxPct", label: "Disk" }] },
  { id: "diskUsed", label: "Disk space used", group: "Disk", unit: "bytes", scope: "device", chart: true, fields: [{ key: "diskUsedBytes", label: "Used" }] },
  {
    id: "diskIo",
    label: "Disk activity",
    group: "Disk",
    unit: "rate",
    scope: "drive",
    chart: true,
    fields: [
      { key: "diskReadBps", label: "Read" },
      { key: "diskWriteBps", label: "Write" },
    ],
  },
  {
    id: "diskOps",
    label: "Disk operations",
    group: "Disk",
    unit: "ops",
    scope: "drive",
    chart: true,
    fields: [
      { key: "diskReadIops", label: "Reads" },
      { key: "diskWriteIops", label: "Writes" },
    ],
  },
  { id: "diskBusy", label: "Disk busy time", group: "Disk", unit: "percent", scope: "drive", max: 100, chart: true, fields: [{ key: "diskBusyPct", label: "Busy" }] },
  { id: "diskTemp", label: "Drive temperature", group: "Disk", unit: "temperature", scope: "drive", chart: true, fields: [{ key: "diskTempC", label: "Temperature" }] },
  {
    id: "network",
    label: "Network traffic",
    group: "Network",
    unit: "rate",
    scope: "iface",
    chart: true,
    fields: [
      { key: "netRxBps", label: "Download" },
      { key: "netTxBps", label: "Upload" },
    ],
  },
  { id: "latency", label: "Latency to hub", group: "Network", unit: "ms", scope: "device", chart: true, fields: [{ key: "hubRttMs", label: "Round trip" }] },
  {
    id: "gpu",
    label: "GPU usage",
    group: "GPU",
    unit: "percent",
    scope: "gpu",
    max: 100,
    chart: true,
    fields: [
      { key: "gpuPct", label: "Usage" },
      { key: "gpuMemPct", label: "Memory" },
    ],
  },
  { id: "gpuTemp", label: "GPU temperature", group: "GPU", unit: "temperature", scope: "gpu", chart: true, fields: [{ key: "gpuTempC", label: "Temperature" }] },
  { id: "gpuPower", label: "GPU power draw", group: "GPU", unit: "watts", scope: "gpu", chart: true, fields: [{ key: "gpuPowerW", label: "Power" }] },
  { id: "processes", label: "Processes", group: "System", unit: "count", scope: "device", chart: true, fields: [{ key: "processCount", label: "Processes" }] },
  { id: "uptime", label: "Uptime", group: "System", unit: "duration", scope: "device", chart: false, fields: [{ key: "uptimeSec", label: "Uptime" }] },
  { id: "battery", label: "Battery", group: "System", unit: "percent", scope: "device", max: 100, chart: true, fields: [{ key: "batteryPct", label: "Battery" }] },
  { id: "containers", label: "Running containers", group: "Containers", unit: "count", scope: "device", chart: true, fields: [{ key: "containersRunning", label: "Running" }] },
  { id: "containersCpu", label: "Container CPU", group: "Containers", unit: "percent", scope: "device", chart: true, fields: [{ key: "containersCpuPct", label: "CPU" }] },
  { id: "containersMemory", label: "Container memory", group: "Containers", unit: "bytes", scope: "device", chart: true, fields: [{ key: "containersMemBytes", label: "Memory" }] },
];

const METRICS_BY_ID = new Map(CANVAS_METRICS.map((metric) => [metric.id, metric]));

export function canvasMetric(id: string): CanvasMetric | undefined {
  return METRICS_BY_ID.get(id);
}

/** Every summary field a metric can read, for checking what a request may ask for. */
export const CANVAS_SUMMARY_KEYS: readonly (keyof MetricSummary)[] = [
  "cpuPct",
  "cpuUserPct",
  "cpuSystemPct",
  "cpuStealPct",
  "load1",
  "load5",
  "load15",
  "cpuMhz",
  "cpuTempC",
  "memPct",
  "memUsedBytes",
  "memCacheBytes",
  "memTotalBytes",
  "swapPct",
  "diskMaxPct",
  "diskUsedBytes",
  "diskTotalBytes",
  "diskReadBps",
  "diskWriteBps",
  "diskReadIops",
  "diskWriteIops",
  "diskBusyPct",
  "netRxBps",
  "netTxBps",
  "hubRttMs",
  "gpuPct",
  "gpuMemPct",
  "gpuTempC",
  "gpuPowerW",
  "processCount",
  "uptimeSec",
  "batteryPct",
  "batteryCharging",
  "containersRunning",
  "containersTotal",
  "containersCpuPct",
  "containersMemBytes",
];

/* ------------------------------------------------------------------ blocks */

export const CANVAS_BLOCK_TYPES = [
  "heading",
  "text",
  "divider",
  "spacer",
  "chart",
  "value",
  "gauge",
  "status",
  "info",
  "volumes",
  "containers",
  "cores",
  "devices",
  "uptime",
  "alerts",
  "clock",
] as const;

export type CanvasBlockType = (typeof CANVAS_BLOCK_TYPES)[number];

/** Which devices a block covers: all of them, those with a tag, or a chosen few. */
export interface CanvasDeviceSelector {
  mode: "all" | "tag" | "pick";
  tag: string;
  ids: string[];
}

export type CanvasAggregate = "sum" | "avg" | "max" | "min";

export type CanvasTarget =
  | { kind: "device"; deviceId: string }
  | {
      kind: "fleet";
      select: CanvasDeviceSelector;
      agg: CanvasAggregate;
      /** Charts only: a line per device instead of one combined line. */
      split: boolean;
    };

export interface CanvasSource {
  metric: string;
  /** One of the metric's fields, or empty for all of them (charts) or the first (values). */
  field: string;
  /** The GPU (by position), drive or interface for metrics that have one. Empty for the total. */
  sub: string;
  target: CanvasTarget;
}

export interface CanvasThresholds {
  warn: number | null;
  crit: number | null;
  /** Low values are the problem, as with a battery. */
  below: boolean;
}

export const CANVAS_COLORS = ["ink", "blue", "orange", "aqua", "yellow", "magenta"] as const;
export type CanvasColor = (typeof CANVAS_COLORS)[number];

export const CANVAS_INFO_FIELDS = [
  "os",
  "platform",
  "kernel",
  "arch",
  "cpu",
  "cores",
  "memory",
  "uptime",
  "bootedAt",
  "model",
  "virtual",
  "agent",
  "lastSeen",
] as const;
export type CanvasInfoField = (typeof CANVAS_INFO_FIELDS)[number];

export const CANVAS_INFO_LABELS: Record<CanvasInfoField, string> = {
  os: "Operating system",
  platform: "Platform",
  kernel: "Kernel",
  arch: "Architecture",
  cpu: "Processor",
  cores: "Cores",
  memory: "Memory",
  uptime: "Uptime",
  bootedAt: "Started",
  model: "Hardware",
  virtual: "Virtual machine",
  agent: "Agent version",
  lastSeen: "Last seen",
};

export const CANVAS_CARD_METRICS = ["cpu", "memory", "disk", "network", "temperature", "uptime"] as const;
export type CanvasCardMetric = (typeof CANVAS_CARD_METRICS)[number];

export interface CanvasBlockConfigs {
  heading: { text: string; subtitle: string; size: "sm" | "md" | "lg" | "xl"; align: "left" | "center" | "right" };
  text: { text: string; size: "sm" | "md" | "lg"; align: "left" | "center" | "right" };
  divider: { label: string };
  spacer: Record<string, never>;
  chart: {
    source: CanvasSource;
    /** Seconds, or null to follow the range the visitor picked. */
    range: number | null;
    color: CanvasColor;
    legend: boolean;
    showValue: boolean;
    /** Marks alerts raised in the range on the chart. */
    alerts: boolean;
  };
  value: {
    source: CanvasSource;
    sparkline: boolean;
    range: number | null;
    thresholds: CanvasThresholds;
    caption: string;
  };
  gauge: { source: CanvasSource; style: "ring" | "bar"; thresholds: CanvasThresholds; max: number | null };
  status: { select: CanvasDeviceSelector };
  info: { deviceId: string; fields: CanvasInfoField[] };
  volumes: { deviceId: string };
  containers: { deviceId: string; runningOnly: boolean };
  cores: { deviceId: string; style: "heatmap" | "bars"; range: number | null };
  devices: { select: CanvasDeviceSelector; metrics: CanvasCardMetric[] };
  uptime: { select: CanvasDeviceSelector; days: 30 | 60 | 90 };
  alerts: { select: CanvasDeviceSelector; limit: number };
  clock: { timeZone: string; hour12: boolean; seconds: boolean; showDate: boolean };
}

interface CanvasBlockBase<T extends CanvasBlockType> {
  id: string;
  type: T;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Shown above the content. Empty hides the title row. */
  title: string;
  /** Drawn as a card. Off draws the content straight onto the page. */
  frame: boolean;
  config: CanvasBlockConfigs[T];
}

export type CanvasBlock = { [T in CanvasBlockType]: CanvasBlockBase<T> }[CanvasBlockType];
export type CanvasBlockOf<T extends CanvasBlockType> = CanvasBlockBase<T>;

export interface CanvasOptions {
  /** Seconds charts show when a visitor has not picked a range. */
  defaultRange: number;
  /** Ranges a visitor may switch between. One or none hides the picker. */
  visitorRanges: number[];
  /** Pixels, or 0 to fill the window. */
  maxWidth: number;
  showHeader: boolean;
  showUpdated: boolean;
  unitBase: 1000 | 1024;
  temperatureUnit: "c" | "f";
}

/** What the editor changes and publishing copies: the page as visitors see it. */
export interface CanvasContent {
  title: string;
  description: string;
  options: CanvasOptions;
  blocks: CanvasBlock[];
}

export const DEFAULT_CANVAS_OPTIONS: CanvasOptions = {
  defaultRange: 3600,
  visitorRanges: [3600, 86_400, 604_800],
  maxWidth: 1440,
  showHeader: true,
  showUpdated: true,
  unitBase: 1024,
  temperatureUnit: "c",
};

/** What each block is called in the library, and the size it starts at. */
export interface CanvasBlockInfo {
  label: string;
  description: string;
  group: "Layout" | "Metrics" | "Device" | "Fleet";
  w: number;
  h: number;
  minW: number;
  minH: number;
  frame: boolean;
}

export const CANVAS_BLOCK_INFO: Record<CanvasBlockType, CanvasBlockInfo> = {
  heading: { label: "Heading", description: "A title to split the page into sections.", group: "Layout", w: 24, h: 2, minW: 2, minH: 1, frame: false },
  text: { label: "Text", description: "A paragraph, with bold, italics and links.", group: "Layout", w: 12, h: 3, minW: 2, minH: 1, frame: false },
  divider: { label: "Divider", description: "A line across, with an optional label.", group: "Layout", w: 24, h: 1, minW: 2, minH: 1, frame: false },
  spacer: { label: "Spacer", description: "Empty room between blocks.", group: "Layout", w: 24, h: 1, minW: 1, minH: 1, frame: false },
  chart: { label: "Chart", description: "Any metric over time, for one device or many.", group: "Metrics", w: 12, h: 8, minW: 4, minH: 4, frame: true },
  value: { label: "Value", description: "One metric as a big number, with an optional trend line.", group: "Metrics", w: 4, h: 4, minW: 2, minH: 2, frame: true },
  gauge: { label: "Gauge", description: "One metric as a dial or a bar.", group: "Metrics", w: 4, h: 5, minW: 2, minH: 2, frame: true },
  status: { label: "Status", description: "Whether devices are online, and when they were last seen.", group: "Device", w: 6, h: 4, minW: 3, minH: 2, frame: true },
  info: { label: "System info", description: "Operating system, processor, memory and more.", group: "Device", w: 8, h: 7, minW: 4, minH: 3, frame: true },
  volumes: { label: "Volumes", description: "How full each volume of a device is.", group: "Device", w: 8, h: 6, minW: 4, minH: 3, frame: true },
  containers: { label: "Containers", description: "The Docker containers on a device.", group: "Device", w: 10, h: 7, minW: 5, minH: 3, frame: true },
  cores: { label: "CPU cores", description: "Every core, as a heatmap over time or bars now.", group: "Device", w: 12, h: 7, minW: 4, minH: 3, frame: true },
  devices: { label: "Device cards", description: "A card for every device, repeated automatically.", group: "Fleet", w: 24, h: 8, minW: 6, minH: 4, frame: true },
  uptime: { label: "Uptime history", description: "Daily availability bars, like a status page.", group: "Fleet", w: 24, h: 6, minW: 8, minH: 3, frame: true },
  alerts: { label: "Active alerts", description: "Alerts firing right now, or a calm all clear.", group: "Fleet", w: 8, h: 5, minW: 4, minH: 3, frame: true },
  clock: { label: "Clock", description: "The current time and date, in any time zone.", group: "Layout", w: 4, h: 3, minW: 2, minH: 2, frame: true },
};

export function defaultSelector(): CanvasDeviceSelector {
  return { mode: "all", tag: "", ids: [] };
}

export function defaultThresholds(metric: CanvasMetric | undefined): CanvasThresholds {
  if (!metric) return { warn: null, crit: null, below: false };
  if (metric.id === "battery") return { warn: 25, crit: 10, below: true };
  if (metric.unit === "percent" && metric.max === 100) return { warn: 75, crit: 90, below: false };
  if (metric.unit === "temperature") return { warn: 70, crit: 85, below: false };
  return { warn: null, crit: null, below: false };
}

/** A new block of a type, with every setting filled in. */
export function newCanvasBlock(
  type: CanvasBlockType,
  id: string,
  at: { x: number; y: number; w?: number; h?: number },
  deviceId = ""
): CanvasBlock {
  const info = CANVAS_BLOCK_INFO[type];
  const source = (metric: string): CanvasSource => ({
    metric,
    field: "",
    sub: "",
    target: { kind: "device", deviceId },
  });
  const base = {
    id,
    x: at.x,
    y: at.y,
    w: at.w ?? info.w,
    h: at.h ?? info.h,
    title: "",
    frame: info.frame,
  };
  switch (type) {
    case "heading":
      return { ...base, type, config: { text: "Section title", subtitle: "", size: "lg", align: "left" } };
    case "text":
      return { ...base, type, config: { text: "Write something about this page.", size: "md", align: "left" } };
    case "divider":
      return { ...base, type, config: { label: "" } };
    case "spacer":
      return { ...base, type, config: {} };
    case "chart":
      return {
        ...base,
        type,
        title: "CPU usage",
        config: { source: source("cpu"), range: null, color: "ink", legend: true, showValue: true, alerts: false },
      };
    case "value":
      return {
        ...base,
        type,
        title: "CPU",
        config: {
          source: source("cpu"),
          sparkline: true,
          range: null,
          thresholds: defaultThresholds(canvasMetric("cpu")),
          caption: "",
        },
      };
    case "gauge":
      return {
        ...base,
        type,
        title: "Memory",
        config: { source: source("memory"), style: "ring", thresholds: defaultThresholds(canvasMetric("memory")), max: null },
      };
    case "status":
      return { ...base, type, title: "Status", config: { select: deviceId ? { mode: "pick", tag: "", ids: [deviceId] } : defaultSelector() } };
    case "info":
      return {
        ...base,
        type,
        title: "System",
        config: { deviceId, fields: ["os", "cpu", "cores", "memory", "uptime", "model"] },
      };
    case "volumes":
      return { ...base, type, title: "Volumes", config: { deviceId } };
    case "containers":
      return { ...base, type, title: "Containers", config: { deviceId, runningOnly: false } };
    case "cores":
      return { ...base, type, title: "CPU cores", config: { deviceId, style: "heatmap", range: null } };
    case "devices":
      return { ...base, type, title: "Devices", config: { select: defaultSelector(), metrics: ["cpu", "memory", "disk", "uptime"] } };
    case "uptime":
      return { ...base, type, title: "Uptime", config: { select: defaultSelector(), days: 90 } };
    case "alerts":
      return { ...base, type, title: "Active alerts", config: { select: defaultSelector(), limit: 8 } };
    case "clock":
      return { ...base, type, config: { timeZone: "", hour12: false, seconds: false, showDate: true } };
  }
}

export function emptyCanvasContent(title: string): CanvasContent {
  return { title, description: "", options: { ...DEFAULT_CANVAS_OPTIONS }, blocks: [] };
}

/* ------------------------------------------------------------------- pages */

/**
 * Who may open a published page.
 *  - public: anyone with the address.
 *  - unlisted: only with the secret key in the address, so it cannot be guessed.
 *  - password: anyone who knows the page's password.
 *  - users: people signed in to this Beacon.
 */
export const CANVAS_ACCESS = ["public", "unlisted", "password", "users"] as const;
export type CanvasAccess = (typeof CANVAS_ACCESS)[number];

/** Which other sites may show the page in a frame. */
export const CANVAS_EMBED = ["none", "any", "list"] as const;
export type CanvasEmbed = (typeof CANVAS_EMBED)[number];

export interface CanvasPageSummaryDto {
  id: string;
  slug: string;
  title: string;
  access: CanvasAccess;
  /** Off takes the page down without losing it. */
  enabled: boolean;
  /** Has been published at least once. */
  published: boolean;
  /** The draft differs from what visitors see. */
  dirty: boolean;
  blocks: number;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

export interface CanvasPageDto extends CanvasPageSummaryDto {
  draft: CanvasContent;
  live: CanvasContent | null;
  /** The key an unlisted address carries. */
  shareKey: string;
  hasPassword: boolean;
  embed: CanvasEmbed;
  embedOrigins: string[];
}

/** A device as the editor knows it, before anything is cut away. */
export interface CanvasDeviceMeta {
  id: string;
  name: string;
  color: string;
  tags: string[];
  status: "online" | "offline" | "never";
  lastSeenAt: number | null;
  staticInfo: DeviceStaticInfo | null;
  panels: DevicePanelSettings | null;
  latest: MetricSample | null;
}

/* --------------------------------------------------------------- snapshots */

export interface CanvasGpuSnapshot {
  index: number;
  name: string;
  utilizationPct: number | null;
  memPct: number | null;
  temperatureC: number | null;
  powerW: number | null;
}

export interface CanvasDriveSnapshot {
  device: string;
  name: string;
  readBps: number | null;
  writeBps: number | null;
  readIops: number | null;
  writeIops: number | null;
  busyPct: number | null;
  temperatureC: number | null;
}

export interface CanvasVolumeSnapshot {
  mount: string;
  type: string;
  usePct: number;
  usedBytes: number;
  sizeBytes: number;
}

export interface CanvasContainerSnapshot {
  name: string;
  image: string;
  state: string;
  status: string;
  cpuPct: number | null;
  memUsedBytes: number | null;
}

/** Facts about a device. Never the hostname, serial number or any address. */
export interface CanvasInfo {
  os: string;
  platform: string;
  kernel: string;
  arch: string;
  cpu: string;
  cores: number | null;
  physicalCores: number | null;
  memoryBytes: number | null;
  bootedAt: number | null;
  model: string;
  virtual: boolean | null;
  agent: string;
}

/** What a page knows about one device. Parts its blocks do not use are left out. */
export interface CanvasDeviceSnapshot {
  id: string;
  name: string;
  color: string;
  status: "online" | "offline" | "never";
  lastSeenAt: number | null;
  /** When the sample these numbers come from was taken. */
  ts: number | null;
  summary: Partial<Record<keyof MetricSummary, number | null>>;
  gpus?: CanvasGpuSnapshot[];
  drives?: CanvasDriveSnapshot[];
  ifaces?: { iface: string; rxBps: number | null; txBps: number | null }[];
  perCore?: number[];
  volumes?: CanvasVolumeSnapshot[];
  containers?: CanvasContainerSnapshot[];
  info?: Partial<CanvasInfo>;
}

/** What a device has to carry for a page, worked out from its blocks. */
export interface CanvasNeeds {
  summary: string[];
  gpus: boolean;
  drives: boolean;
  ifaces: boolean;
  cores: boolean;
  volumes: boolean;
  containers: boolean;
  info: CanvasInfoField[];
}

export function emptyNeeds(): CanvasNeeds {
  return { summary: [], gpus: false, drives: false, ifaces: false, cores: false, volumes: false, containers: false, info: [] };
}

/** Everything, for the editor, which shows whatever an admin may pick. */
export function allNeeds(): CanvasNeeds {
  return {
    summary: [...CANVAS_SUMMARY_KEYS],
    gpus: true,
    drives: true,
    ifaces: true,
    cores: true,
    volumes: true,
    containers: true,
    info: [...CANVAS_INFO_FIELDS],
  };
}

/** A device the selector logic can look at. */
export interface CanvasSelectable {
  id: string;
  tags: string[];
}

export function selectDevices(select: CanvasDeviceSelector, devices: CanvasSelectable[]): string[] {
  if (select.mode === "pick") {
    const known = new Set(devices.map((device) => device.id));
    return select.ids.filter((id) => known.has(id));
  }
  if (select.mode === "tag") {
    const tag = select.tag.trim().toLowerCase();
    return devices.filter((device) => device.tags.some((entry) => entry.toLowerCase() === tag)).map((device) => device.id);
  }
  return devices.map((device) => device.id);
}

/** The devices a block draws from, in the order it should show them. */
export function blockDeviceIds(block: CanvasBlock, devices: CanvasSelectable[]): string[] {
  const one = (id: string) => (id && devices.some((device) => device.id === id) ? [id] : []);
  switch (block.type) {
    case "chart":
    case "value":
    case "gauge": {
      const target = block.config.source.target;
      return target.kind === "device" ? one(target.deviceId) : selectDevices(target.select, devices);
    }
    case "status":
    case "devices":
    case "uptime":
    case "alerts":
      return selectDevices(block.config.select, devices);
    case "info":
    case "volumes":
    case "containers":
    case "cores":
      return one(block.config.deviceId);
    default:
      return [];
  }
}

function addAll(into: string[], keys: readonly string[]): void {
  for (const key of keys) if (!into.includes(key)) into.push(key);
}

/** What one block needs from each of its devices. */
export function blockNeeds(block: CanvasBlock): CanvasNeeds {
  const needs = emptyNeeds();
  switch (block.type) {
    case "chart":
    case "value":
    case "gauge": {
      const metric = canvasMetric(block.config.source.metric);
      if (!metric) break;
      addAll(needs.summary, metric.fields.map((field) => field.key));
      if (metric.scope === "gpu") needs.gpus = true;
      if (metric.scope === "drive") needs.drives = true;
      if (metric.scope === "iface") needs.ifaces = true;
      break;
    }
    case "info":
      needs.info = [...block.config.fields];
      if (block.config.fields.includes("uptime")) addAll(needs.summary, ["uptimeSec"]);
      break;
    case "volumes":
      needs.volumes = true;
      break;
    case "containers":
      needs.containers = true;
      addAll(needs.summary, ["containersRunning", "containersTotal"]);
      break;
    case "cores":
      needs.cores = true;
      break;
    case "devices": {
      const map: Record<CanvasCardMetric, string[]> = {
        cpu: ["cpuPct"],
        memory: ["memPct"],
        disk: ["diskMaxPct"],
        network: ["netRxBps", "netTxBps"],
        temperature: ["cpuTempC"],
        uptime: ["uptimeSec"],
      };
      for (const metric of block.config.metrics) addAll(needs.summary, map[metric] ?? []);
      break;
    }
    default:
      break;
  }
  return needs;
}

export function mergeNeeds(into: CanvasNeeds, from: CanvasNeeds): CanvasNeeds {
  addAll(into.summary, from.summary);
  into.gpus ||= from.gpus;
  into.drives ||= from.drives;
  into.ifaces ||= from.ifaces;
  into.cores ||= from.cores;
  into.volumes ||= from.volumes;
  into.containers ||= from.containers;
  for (const field of from.info) if (!into.info.includes(field)) into.info.push(field);
  return into;
}

/** Per device, everything a page's blocks need from it. */
export function pageNeeds(blocks: CanvasBlock[], devices: CanvasSelectable[]): Map<string, CanvasNeeds> {
  const result = new Map<string, CanvasNeeds>();
  for (const block of blocks) {
    const ids = blockDeviceIds(block, devices);
    if (ids.length === 0) continue;
    const needs = blockNeeds(block);
    for (const id of ids) mergeNeeds(result.get(id) ?? result.set(id, emptyNeeds()).get(id)!, needs);
  }
  return result;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The same name the device page gives a GPU. Kept here so a public page and
 * the editor agree without the hub knowing about the dashboard's helpers.
 */
export function canvasGpuName(model: string, vendor: string, index: number): string {
  const brand = (text: string) =>
    /nvidia|geforce|quadro/i.test(text)
      ? "nvidia"
      : /advanced micro devices|\bamd\b|\bati\b|radeon/i.test(text)
        ? "amd"
        : /intel|\barc\b/i.test(text)
          ? "intel"
          : /apple/i.test(text)
            ? "apple"
            : "";
  const m = model.trim();
  const v = vendor.trim();
  if (!m) return v || `GPU ${index + 1}`;
  if (!v) return m;
  const maker = brand(v);
  return maker && maker === brand(m) ? m : `${v} ${m}`;
}

/**
 * A device's state cut down to `needs`. The device's own settings for hidden
 * drives, interfaces and GPUs apply, so a page never shows something the device
 * page itself leaves out.
 */
export function buildSnapshot(meta: CanvasDeviceMeta, needs: CanvasNeeds): CanvasDeviceSnapshot {
  const sample = meta.latest;
  const panels = meta.panels;
  const snapshot: CanvasDeviceSnapshot = {
    id: meta.id,
    name: meta.name,
    color: meta.color,
    status: meta.status,
    lastSeenAt: meta.lastSeenAt,
    ts: sample?.ts ?? null,
    summary: {},
  };

  if (sample) {
    const summary = sample.summary as unknown as Record<string, unknown>;
    for (const key of needs.summary) {
      if ((CANVAS_SUMMARY_KEYS as readonly string[]).includes(key)) {
        snapshot.summary[key as keyof MetricSummary] = numberOrNull(summary[key]);
      }
    }
    const detail = sample.detail;
    if (needs.gpus) {
      snapshot.gpus = (detail?.gpus ?? [])
        .map((gpu, index) => ({
          index,
          name: canvasGpuName(gpu.model ?? "", gpu.vendor ?? "", index),
          utilizationPct: numberOrNull(gpu.utilizationPct),
          memPct:
            gpu.memoryTotalMb && gpu.memoryUsedMb !== null
              ? Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 1000) / 10
              : null,
          temperatureC: numberOrNull(gpu.temperatureC),
          powerW: numberOrNull(gpu.powerW),
        }))
        .filter((gpu) => !(panels?.hiddenGpus ?? []).includes(gpu.name));
    }
    if (needs.drives) {
      snapshot.drives = (detail?.drives ?? []).map((drive) => ({
        device: drive.device,
        name: [drive.vendor, drive.name].filter(Boolean).join(" ").trim() || drive.device,
        readBps: numberOrNull(drive.readBps),
        writeBps: numberOrNull(drive.writeBps),
        readIops: numberOrNull(drive.readIops),
        writeIops: numberOrNull(drive.writeIops),
        busyPct: numberOrNull(drive.busyPct),
        temperatureC: numberOrNull(drive.temperatureC),
      }));
    }
    if (needs.ifaces) {
      snapshot.ifaces = (detail?.network ?? [])
        .filter((entry) => !(panels?.hiddenInterfaces ?? []).includes(entry.iface))
        .map((entry) => ({ iface: entry.iface, rxBps: numberOrNull(entry.rxBytesPerSec), txBps: numberOrNull(entry.txBytesPerSec) }));
    }
    if (needs.cores) snapshot.perCore = (detail?.cpu?.perCore ?? []).map((value) => numberOrNull(value) ?? 0);
    if (needs.volumes) {
      const merged = new Map<string, CanvasVolumeSnapshot>();
      for (const disk of detail?.disks ?? []) {
        if ((panels?.hiddenDisks ?? []).includes(disk.mount)) continue;
        if (disk.system && !panels?.showSystemVolumes) continue;
        // One filesystem mounted twice is one volume, as on the device page.
        const key = `${disk.fs}:${disk.sizeBytes}:${disk.usedBytes}`;
        const existing = merged.get(key);
        if (existing) existing.mount = `${existing.mount} · ${disk.mount}`;
        else
          merged.set(key, {
            mount: disk.mount,
            type: disk.type || "",
            usePct: disk.usePct,
            usedBytes: disk.usedBytes,
            sizeBytes: disk.sizeBytes,
          });
      }
      snapshot.volumes = [...merged.values()];
    }
    if (needs.containers) {
      snapshot.containers = (detail?.containers ?? []).map((container) => ({
        name: container.name,
        image: container.image,
        state: container.state,
        status: container.status,
        cpuPct: numberOrNull(container.cpuPct),
        memUsedBytes: numberOrNull(container.memUsedBytes),
      }));
    }
  }

  if (needs.info.length > 0) {
    const info = meta.staticInfo;
    const all: Partial<CanvasInfo> = info
      ? {
          os: [info.distro, info.release].filter(Boolean).join(" ").trim(),
          platform: info.platform,
          kernel: info.kernel,
          arch: info.arch,
          cpu: [info.cpuManufacturer, info.cpuBrand].filter(Boolean).join(" ").trim(),
          cores: numberOrNull(info.cpuCores),
          physicalCores: numberOrNull(info.cpuPhysicalCores),
          memoryBytes: numberOrNull(info.memTotalBytes),
          bootedAt: numberOrNull(info.bootedAt),
          model: [info.manufacturer, info.model].filter(Boolean).join(" ").trim(),
          virtual: typeof info.isVirtual === "boolean" ? info.isVirtual : null,
          agent: info.agentVersion,
        }
      : {};
    const picked: Partial<CanvasInfo> = {};
    const copy = <K extends keyof CanvasInfo>(key: K) => {
      if (all[key] !== undefined) picked[key] = all[key];
    };
    for (const field of needs.info) {
      if (field === "memory") copy("memoryBytes");
      else if (field === "cores") {
        copy("cores");
        copy("physicalCores");
      } else if (field === "uptime" || field === "lastSeen") continue;
      else copy(field);
    }
    snapshot.info = picked;
  }

  return snapshot;
}

/* ------------------------------------------------------------------ values */

const GPU_KEYS: Record<string, keyof CanvasGpuSnapshot> = {
  gpuPct: "utilizationPct",
  gpuMemPct: "memPct",
  gpuTempC: "temperatureC",
  gpuPowerW: "powerW",
};

const DRIVE_KEYS: Record<string, keyof CanvasDriveSnapshot> = {
  diskReadBps: "readBps",
  diskWriteBps: "writeBps",
  diskReadIops: "readIops",
  diskWriteIops: "writeIops",
  diskBusyPct: "busyPct",
  diskTempC: "temperatureC",
};

/** One field of a metric for one device, as it stands now. */
export function snapshotValue(snapshot: CanvasDeviceSnapshot, metric: CanvasMetric, key: string, sub: string): number | null {
  if (metric.scope === "gpu" && sub !== "") {
    const gpu = snapshot.gpus?.find((entry) => String(entry.index) === sub);
    const prop = GPU_KEYS[key];
    return gpu && prop ? numberOrNull(gpu[prop]) : null;
  }
  if (metric.scope === "drive" && (sub !== "" || key === "diskTempC")) {
    const prop = DRIVE_KEYS[key];
    if (!prop) return null;
    if (sub === "") {
      // No drive picked: the hottest one.
      const values = (snapshot.drives ?? []).map((drive) => numberOrNull(drive[prop])).filter((value): value is number => value !== null);
      return values.length > 0 ? Math.max(...values) : null;
    }
    const drive = snapshot.drives?.find((entry) => entry.device === sub);
    return drive ? numberOrNull(drive[prop]) : null;
  }
  if (metric.scope === "iface" && sub !== "") {
    const entry = snapshot.ifaces?.find((candidate) => candidate.iface === sub);
    if (!entry) return null;
    return key === "netRxBps" ? entry.rxBps : key === "netTxBps" ? entry.txBps : null;
  }
  return numberOrNull(snapshot.summary[key as keyof MetricSummary]);
}

export function aggregateValues(values: (number | null)[], agg: CanvasAggregate): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length === 0) return null;
  switch (agg) {
    case "sum":
      return present.reduce((total, value) => total + value, 0);
    case "avg":
      return present.reduce((total, value) => total + value, 0) / present.length;
    case "max":
      return Math.max(...present);
    case "min":
      return Math.min(...present);
  }
}

/** The field a single-number block shows: the one picked, or the metric's first. */
export function sourceField(metric: CanvasMetric, source: CanvasSource): string {
  return metric.fields.some((field) => field.key === source.field) ? source.field : metric.fields[0].key;
}

/**
 * A source's current number. For a fleet only online devices count, since an
 * offline device's last reading would otherwise stay in the total forever.
 */
export function sourceValue(
  source: CanvasSource,
  deviceIds: string[],
  snapshots: Record<string, CanvasDeviceSnapshot | undefined>
): number | null {
  const metric = canvasMetric(source.metric);
  if (!metric) return null;
  const key = sourceField(metric, source);
  if (source.target.kind === "device") {
    const snapshot = snapshots[deviceIds[0] ?? ""];
    return snapshot ? snapshotValue(snapshot, metric, key, source.sub) : null;
  }
  const agg = source.target.agg;
  return aggregateValues(
    deviceIds.map((id) => {
      const snapshot = snapshots[id];
      return snapshot && snapshot.status === "online" ? snapshotValue(snapshot, metric, key, source.sub) : null;
    }),
    agg
  );
}

/** "ok", "warning" or "critical" for a number against a block's thresholds. */
export function thresholdLevel(value: number | null, thresholds: CanvasThresholds): "ok" | "warning" | "critical" {
  if (value === null) return "ok";
  const past = (limit: number | null) => limit !== null && (thresholds.below ? value <= limit : value >= limit);
  if (past(thresholds.crit)) return "critical";
  if (past(thresholds.warn)) return "warning";
  return "ok";
}

/** A number in a unit, as a short string. Used by the hub's badges and the pages alike. */
export function formatCanvasValue(
  value: number | null | undefined,
  unit: CanvasUnit,
  options: { unitBase?: 1000 | 1024; temperatureUnit?: "c" | "f" } = {}
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const base = options.unitBase ?? 1024;
  const bytes = (amount: number) => {
    const units = base === 1024 ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] : ["B", "kB", "MB", "GB", "TB", "PB"];
    let index = 0;
    let scaled = Math.abs(amount);
    while (scaled >= base && index < units.length - 1) {
      scaled /= base;
      index += 1;
    }
    const digits = index === 0 || scaled >= 100 ? 0 : 1;
    return `${amount < 0 ? "-" : ""}${Number(scaled.toFixed(digits))} ${units[index]}`;
  };
  switch (unit) {
    case "percent":
      return `${value.toFixed(value < 10 && value !== 0 ? 1 : 0)}%`;
    case "bytes":
      return bytes(value);
    case "rate":
      return `${bytes(value)}/s`;
    case "temperature":
      return options.temperatureUnit === "f" ? `${Math.round(value * 1.8 + 32)}°F` : `${Math.round(value)}°C`;
    case "clock":
      return value >= 1000 ? `${(value / 1000).toFixed(2)} GHz` : `${Math.round(value)} MHz`;
    case "watts":
      return `${value.toFixed(value < 10 ? 1 : 0)} W`;
    case "ms":
      return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
    case "ops":
      return value >= 10_000 ? `${(value / 1000).toFixed(0)}k/s` : `${Math.round(value)}/s`;
    case "load":
      return value.toFixed(2);
    case "count":
      return String(Math.round(value));
    case "duration": {
      const total = Math.max(0, Math.round(value));
      if (total < 60) return `${total}s`;
      const minutes = Math.floor(total / 60);
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ${minutes % 60}m`;
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
  }
}

/* ------------------------------------------------------------ public reads */

export interface CanvasSeriesKey {
  key: string;
  label: string;
}

export interface CanvasSeriesDto {
  from: number;
  to: number;
  keys: CanvasSeriesKey[];
  points: ({ ts: number } & Record<string, number | null>)[];
  /** Alerts raised in the range, when the block asks for them. */
  markers: { ts: number; endTs: number | null; label: string; severity: string }[];
}

export interface CanvasUptimeDto {
  /** Local dates, oldest first, as `YYYY-MM-DD`. */
  days: string[];
  devices: {
    id: string;
    name: string;
    /** Share of each day the device was reporting, 0 to 100. Null before it existed. */
    values: (number | null)[];
    overall: number | null;
  }[];
}

export interface CanvasAlertsDto {
  alerts: {
    id: string;
    deviceId: string;
    deviceName: string;
    ruleName: string;
    severity: string;
    startedAt: number;
  }[];
}

export interface PublicCanvasDto {
  id: string;
  slug: string;
  content: CanvasContent;
  devices: CanvasDeviceSnapshot[];
  /** The devices each block draws from, worked out by the hub. */
  blockDevices: Record<string, string[]>;
  publishedAt: number | null;
  /** Badges work for this page (public and unlisted pages only). */
  badges: boolean;
}

/** What the page socket sends. */
export type CanvasLiveMessage =
  | { type: "snapshot"; device: CanvasDeviceSnapshot }
  | { type: "status"; deviceId: string; status: "online" | "offline"; lastSeenAt: number | null }
  | { type: "reload" };
