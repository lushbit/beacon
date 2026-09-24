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
  /**
   * The physical drive this filesystem lives on, empty when the agent cannot
   * work it out. It is what groups the volumes on the device page.
   */
  device: string;
  /**
   * A firmware, pseudo or tiny system filesystem. The device page leaves these
   * out until someone asks for them, because a NAS reports a dozen of them and
   * none is anything to keep an eye on.
   */
  system: boolean;
}

/**
 * A physical drive. Read and write rates are measured here rather than per
 * filesystem, because that is the level the operating system counts them at.
 */
export interface DiskDevice {
  /** `/dev/sda` on Linux, `\\.\PHYSICALDRIVE0` on Windows. Identifies the drive. */
  device: string;
  name: string;
  vendor: string;
  sizeBytes: number | null;
  /** "SSD", "HD" or empty when unknown. */
  kind: string;
  interfaceType: string;
  temperatureC: number | null;
  readBps: number | null;
  writeBps: number | null;
  /** Reads and writes completed per second. Absent from agents before 1.3.0. */
  readIops?: number | null;
  writeIops?: number | null;
  /** Share of the time the drive was working on something, 0 to 100. */
  busyPct?: number | null;
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
  /**
   * The memory above is borrowed from system RAM rather than the adapter's own,
   * which is all an onboard chip has. The total is then what Windows lets it
   * borrow, so the two numbers still belong together.
   */
  memoryShared: boolean;
  temperatureC: number | null;
  /** Watts drawn by the card, where the driver says. Absent before 1.3.0. */
  powerW?: number | null;
}

export interface BatteryUsage {
  percent: number;
  isCharging: boolean;
  minutesRemaining: number | null;
  /** How much charge a full battery holds now, against when it was new. */
  healthPct?: number | null;
  cycleCount?: number | null;
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
  /** Empty from an agent older than 1.2.2, which reported no drives at all. */
  drives: DiskDevice[];
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
  /**
   * Where the CPU time went. Idle, nice and interrupts are left out, so these
   * do not add up to `cpuPct`. Null from an agent older than 1.3.0.
   */
  cpuUserPct?: number | null;
  cpuSystemPct?: number | null;
  /** Time a virtual machine waited for its host. Zero on bare metal. */
  cpuStealPct?: number | null;
  /** Average clock across the cores, in MHz. */
  cpuMhz?: number | null;
  /** Buffers and page cache, which the system hands back when it needs to. */
  memCacheBytes?: number | null;
  swapUsedBytes?: number | null;
  swapTotalBytes?: number | null;
  /** The main GPU's temperature, the same card `gpuPct` reports. */
  gpuTempC?: number | null;
  gpuPowerW?: number | null;
  /** The busiest drive's busy time, which is what a saturated disk shows as. */
  diskBusyPct?: number | null;
  diskReadIops?: number | null;
  diskWriteIops?: number | null;
  /** All running containers added together. */
  containersCpuPct?: number | null;
  containersMemBytes?: number | null;
  /**
   * How long a message takes to reach the agent and come back, measured by the
   * hub rather than the agent, so it works whatever agent version is running.
   */
  hubRttMs?: number | null;
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

/**
 * Alert metrics grouped into the handful of things people actually think in.
 * Twelve metrics are too many to filter one by one, so the dashboard filters by
 * these instead. The order here is the order the filter chips are drawn in.
 */
export const ALERT_CATEGORIES = [
  "cpu",
  "memory",
  "disk",
  "network",
  "gpu",
  "battery",
  "containers",
  "availability",
] as const;

export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
  network: "Network",
  gpu: "GPU",
  battery: "Battery",
  containers: "Containers",
  availability: "Availability",
};

export const ALERT_METRIC_CATEGORIES: Record<AlertMetric, AlertCategory> = {
  cpuPct: "cpu",
  memPct: "memory",
  swapPct: "memory",
  diskMaxPct: "disk",
  netRxBps: "network",
  netTxBps: "network",
  gpuPct: "gpu",
  cpuTempC: "cpu",
  load1: "cpu",
  batteryPct: "battery",
  containersRunning: "containers",
  offline: "availability",
};

export type AlertOperator = "gt" | "lt";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertState = "firing" | "resolved";

export const METRIC_TIERS = ["raw", "minute", "hour"] as const;
export type MetricTier = (typeof METRIC_TIERS)[number];
