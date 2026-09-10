/**
 * Metric shapes shared by the agent, the hub and the dashboard.
 *
 * A sample is split in two parts on purpose:
 *  - the flat numeric fields in `MetricSummary` are what gets charted, rolled
 *    up and evaluated by alert rules, so they are stored as real columns;
 *  - `MetricDetail` holds the per-disk / per-interface / per-GPU breakdown and
 *    is only kept for the raw retention tier.
 */

export interface CpuDetail {
  perCore: number[];
  speedGhz: number | null;
  temperatures: number[];
}

export interface DiskUsage {
  fs: string;
  mount: string;
  type: string;
  sizeBytes: number;
  usedBytes: number;
  usePct: number;
}

export interface NetInterfaceUsage {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxErrors: number;
  txErrors: number;
  operstate: string;
}

export interface GpuUsage {
  model: string;
  vendor: string;
  utilizationPct: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
}

export interface BatteryUsage {
  percent: number;
  isCharging: boolean;
  minutesRemaining: number | null;
}

export interface ProcessSummary {
  pid: number;
  name: string;
  cpuPct: number;
  memPct: number;
  memBytes: number;
  user: string;
  command: string;
  startedAt: string | null;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: number | null;
  cpuPct: number | null;
  memUsedBytes: number | null;
  memLimitBytes: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
  restartCount: number | null;
}

export interface MetricDetail {
  cpu: CpuDetail;
  disks: DiskUsage[];
  network: NetInterfaceUsage[];
  gpus: GpuUsage[];
  battery: BatteryUsage | null;
  topProcesses: ProcessSummary[];
  containers: DockerContainer[];
}

/** Flat, chartable numbers. Every field is optional-by-null so that a platform
 *  that cannot report a value never has to invent one. */
export interface MetricSummary {
  cpuPct: number;
  memPct: number;
  memUsedBytes: number;
  memTotalBytes: number;
  swapPct: number | null;
  diskMaxPct: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  diskReadBps: number | null;
  diskWriteBps: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
  gpuPct: number | null;
  gpuMemPct: number | null;
  cpuTempC: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  uptimeSec: number | null;
  processCount: number | null;
  batteryPct: number | null;
  containersRunning: number | null;
  containersTotal: number | null;
}

export interface MetricSample {
  ts: number;
  summary: MetricSummary;
  detail: MetricDetail;
}

/** Static facts about a device, refreshed when the agent reconnects. */
export interface DeviceStaticInfo {
  hostname: string;
  platform: string;
  distro: string;
  release: string;
  kernel: string;
  arch: string;
  cpuManufacturer: string;
  cpuBrand: string;
  cpuCores: number;
  cpuPhysicalCores: number;
  memTotalBytes: number;
  isVirtual: boolean;
  manufacturer: string;
  model: string;
  serial: string | null;
  agentVersion: string;
  /** Wire protocol the agent speaks; drives the compatibility state. */
  protocolVersion: number;
  /** IANA zone, used to run scheduled updates in the device's own night. */
  timezone: string | null;
  nodeVersion: string;
  bootedAt: number | null;
}

export interface DeviceCapabilities {
  /** The agent can read the Docker daemon on this device. */
  docker: boolean;
  /** Installed by the installer, so the hub can update it remotely. */
  selfUpdate: boolean;
  temperatures: boolean;
  gpu: boolean;
  battery: boolean;
  diskIo: boolean;
  processes: boolean;
  processKill: boolean;
}

/** Metric keys an alert rule can be written against. */
export const ALERT_METRICS = [
  "cpuPct",
  "memPct",
  "swapPct",
  "diskMaxPct",
  "netRxBps",
  "netTxBps",
  "gpuPct",
  "cpuTempC",
  "load1",
  "batteryPct",
  "containersRunning",
  "offline",
] as const;

export type AlertMetric = (typeof ALERT_METRICS)[number];

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  cpuPct: "CPU usage",
  memPct: "Memory usage",
  swapPct: "Swap usage",
  diskMaxPct: "Disk usage (busiest volume)",
  netRxBps: "Network download",
  netTxBps: "Network upload",
  gpuPct: "GPU usage",
  cpuTempC: "CPU temperature",
  load1: "Load average (1m)",
  batteryPct: "Battery level",
  containersRunning: "Running containers",
  offline: "Device offline",
};

/** Unit hints so the UI formats thresholds without a lookup table per page. */
export const ALERT_METRIC_UNITS: Record<AlertMetric, "percent" | "bytesPerSec" | "celsius" | "number" | "seconds"> = {
  cpuPct: "percent",
  memPct: "percent",
  swapPct: "percent",
  diskMaxPct: "percent",
  netRxBps: "bytesPerSec",
  netTxBps: "bytesPerSec",
  gpuPct: "percent",
  cpuTempC: "celsius",
  load1: "number",
  batteryPct: "percent",
  containersRunning: "number",
  offline: "seconds",
};

export type AlertOperator = "gt" | "lt";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertState = "firing" | "resolved";

export const METRIC_TIERS = ["raw", "minute", "hour"] as const;
export type MetricTier = (typeof METRIC_TIERS)[number];
