import os from "node:os";
import si, { type Systeminformation } from "systeminformation";
import type {
  DeviceStaticInfo,
  DiskUsage,
  DockerContainer,
  GpuUsage,
  MetricDetail,
  MetricSample,
  MetricSummary,
  NetInterfaceUsage,
  ProcessSummary,
} from "@beacon/shared";
import { PROTOCOL_VERSION } from "@beacon/shared";
import { AGENT_VERSION } from "./version.js";

/** Lets the hub run scheduled updates during this device's own night. */
function resolveTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Some probes shell out to platform tools and are far too slow to run on every
 * tick, so they are refreshed on their own schedule and reused in between.
 */
class Cached<T> {
  private value: T;
  private fetchedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    initial: T
  ) {
    this.value = initial;
  }

  get(): T {
    if (Date.now() - this.fetchedAt >= this.ttlMs && !this.inFlight) {
      this.inFlight = this.load()
        .then((next) => {
          this.value = next;
          this.fetchedAt = Date.now();
        })
        .catch(() => {
          // Keep the previous value; a probe failing is not fatal.
          this.fetchedAt = Date.now();
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.value;
  }
}

const gpuCache = new Cached<GpuUsage[]>(
  async () => {
    const graphics = await si.graphics();
    return graphics.controllers.map((controller) => ({
      model: controller.model ?? "",
      vendor: controller.vendor ?? "",
      utilizationPct: numberOrNull(controller.utilizationGpu),
      memoryUsedMb: numberOrNull(controller.memoryUsed),
      memoryTotalMb: numberOrNull(controller.memoryTotal),
      temperatureC: numberOrNull(controller.temperatureGpu),
    }));
  },
  15_000,
  []
);

const disksCache = new Cached<DiskUsage[]>(
  async () => {
    const sizes = await si.fsSize();
    return sizes
      .filter((entry) => entry.size > 0 && !/^(devtmpfs|tmpfs|squashfs|overlay)$/i.test(entry.type ?? ""))
      .map((entry) => ({
        fs: entry.fs,
        mount: entry.mount,
        type: entry.type ?? "",
        sizeBytes: entry.size,
        usedBytes: entry.used,
        usePct: Math.round((entry.use ?? 0) * 10) / 10,
      }));
  },
  30_000,
  []
);

interface ProcessSnapshot {
  total: number;
  list: ProcessSummary[];
}

const processCache = new Cached<ProcessSnapshot>(
  async () => {
    const data = await si.processes();
    const list = data.list
      .slice()
      .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
      .slice(0, 5)
      .map(toProcessSummary);
    return { total: data.all ?? data.list.length, list };
  },
  15_000,
  { total: 0, list: [] }
);

/**
 * Docker is optional: when there is no daemon, or the agent cannot reach the
 * socket, this stays empty and the dashboard never shows the panel.
 */
let dockerAvailable = false;

/** Asked once at startup and refreshed with the container list. */
export async function probeDocker(): Promise<boolean> {
  try {
    const info = await si.dockerInfo();
    dockerAvailable = Boolean(info?.id);
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

export function isDockerAvailable(): boolean {
  return dockerAvailable;
}

const dockerCache = new Cached<DockerContainer[]>(
  async () => {
    if (!dockerAvailable && !(await probeDocker())) return [];

    const containers = await si.dockerContainers(true);
    if (containers.length === 0) return [];

    const stats = await si.dockerContainerStats("*").catch(() => []);
    const byId = new Map(stats.map((entry) => [entry.id, entry]));

    return containers.map((container) => {
      const stat = byId.get(container.id);
      return {
        id: container.id,
        name: (container.name ?? "").replace(/^\//, ""),
        image: container.image ?? "",
        state: container.state ?? "",
        status: container.status ?? "",
        createdAt: container.created ? container.created * 1000 : null,
        cpuPct: stat ? Math.round((stat.cpuPercent ?? 0) * 10) / 10 : null,
        memUsedBytes: numberOrNull(stat?.memUsage),
        memLimitBytes: numberOrNull(stat?.memLimit),
        netRxBytes: numberOrNull(stat?.netIO?.rx),
        netTxBytes: numberOrNull(stat?.netIO?.wx),
        restartCount: numberOrNull(stat?.restartCount),
      } satisfies DockerContainer;
    });
  },
  10_000,
  []
);

const batteryCache = new Cached<MetricDetail["battery"]>(
  async () => {
    const battery = await si.battery();
    if (!battery.hasBattery) return null;
    return {
      percent: battery.percent ?? 0,
      isCharging: Boolean(battery.isCharging),
      minutesRemaining: battery.timeRemaining && battery.timeRemaining > 0 ? battery.timeRemaining : null,
    };
  },
  30_000,
  null
);

const tempCache = new Cached<{ main: number | null; cores: number[] }>(
  async () => {
    const temp = await si.cpuTemperature();
    const main = numberOrNull(temp.main);
    const cores = (temp.cores ?? []).filter((value) => typeof value === "number" && value > 0);
    return { main: main !== null && main > 0 ? main : null, cores };
  },
  10_000,
  { main: null, cores: [] }
);

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function toProcessSummary(proc: Systeminformation.ProcessesProcessData): ProcessSummary {
  return {
    pid: proc.pid,
    name: proc.name ?? "",
    cpuPct: Math.round((proc.cpu ?? 0) * 10) / 10,
    memPct: Math.round((proc.mem ?? 0) * 10) / 10,
    memBytes: Math.max(0, Math.round((proc.memRss ?? 0) * 1024)),
    user: proc.user ?? "",
    command: (proc.command ?? "").slice(0, 200),
    startedAt: proc.started ?? null,
  };
}

export async function listProcesses(limit: number, sortBy: "cpu" | "mem"): Promise<{
  ts: number;
  total: number;
  processes: ProcessSummary[];
}> {
  const data = await si.processes();
  const processes = data.list
    .slice()
    .sort((a, b) => (sortBy === "mem" ? (b.mem ?? 0) - (a.mem ?? 0) : (b.cpu ?? 0) - (a.cpu ?? 0)))
    .slice(0, limit)
    .map(toProcessSummary);
  return { ts: Date.now(), total: data.all ?? data.list.length, processes };
}

/* ----------------------------------------------------------------- static info */

export async function collectStaticInfo(): Promise<DeviceStaticInfo> {
  const [osInfo, cpu, system, mem, time] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.system(),
    si.mem(),
    Promise.resolve(si.time()),
  ]);

  return {
    hostname: osInfo.hostname || os.hostname(),
    platform: process.platform,
    distro: osInfo.distro ?? "",
    release: osInfo.release ?? "",
    kernel: osInfo.kernel ?? "",
    arch: osInfo.arch ?? process.arch,
    cpuManufacturer: cpu.manufacturer ?? "",
    cpuBrand: cpu.brand ?? "",
    cpuCores: cpu.cores ?? os.cpus().length,
    cpuPhysicalCores: cpu.physicalCores ?? cpu.cores ?? os.cpus().length,
    memTotalBytes: mem.total,
    isVirtual: Boolean(system.virtual),
    manufacturer: system.manufacturer ?? "",
    model: system.model ?? "",
    serial: system.serial || null,
    agentVersion: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    timezone: resolveTimezone(),
    nodeVersion: process.versions.node,
    bootedAt: typeof time.uptime === "number" ? Date.now() - time.uptime * 1000 : null,
  };
}

/* --------------------------------------------------------------------- sample */

export async function collectSample(): Promise<MetricSample> {
  const [load, mem, net, fsStats] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats().catch(() => []),
    si.fsStats().catch(() => null),
  ]);

  const disks = disksCache.get();
  const gpus = gpuCache.get();
  const processes = processCache.get();
  const battery = batteryCache.get();
  const temps = tempCache.get();
  const containers = dockerCache.get();

  const interfaces: NetInterfaceUsage[] = net
    .filter((entry) => entry.iface && entry.operstate !== "down")
    .map((entry) => ({
      iface: entry.iface,
      rxBytesPerSec: Math.max(0, entry.rx_sec ?? 0),
      txBytesPerSec: Math.max(0, entry.tx_sec ?? 0),
      rxErrors: entry.rx_errors ?? 0,
      txErrors: entry.tx_errors ?? 0,
      operstate: entry.operstate ?? "unknown",
    }));

  const busiestDisk = disks.reduce<DiskUsage | null>(
    (worst, disk) => (worst === null || disk.usePct > worst.usePct ? disk : worst),
    null
  );
  const diskTotals = disks.reduce(
    (acc, disk) => ({ used: acc.used + disk.usedBytes, size: acc.size + disk.sizeBytes }),
    { used: 0, size: 0 }
  );

  const gpu = gpus.find((entry) => entry.utilizationPct !== null) ?? gpus[0] ?? null;
  const loadAvg = process.platform === "win32" ? null : os.loadavg();

  const summary: MetricSummary = {
    cpuPct: Math.round((load.currentLoad ?? 0) * 10) / 10,
    memPct: mem.total > 0 ? Math.round((mem.active / mem.total) * 1000) / 10 : 0,
    memUsedBytes: mem.active,
    memTotalBytes: mem.total,
    swapPct: mem.swaptotal > 0 ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10 : null,
    diskMaxPct: busiestDisk ? busiestDisk.usePct : null,
    diskUsedBytes: diskTotals.size > 0 ? diskTotals.used : null,
    diskTotalBytes: diskTotals.size > 0 ? diskTotals.size : null,
    diskReadBps: fsStats ? numberOrNull(fsStats.rx_sec) : null,
    diskWriteBps: fsStats ? numberOrNull(fsStats.wx_sec) : null,
    netRxBps: interfaces.length ? interfaces.reduce((sum, entry) => sum + entry.rxBytesPerSec, 0) : null,
    netTxBps: interfaces.length ? interfaces.reduce((sum, entry) => sum + entry.txBytesPerSec, 0) : null,
    gpuPct: gpu?.utilizationPct ?? null,
    gpuMemPct:
      gpu && gpu.memoryTotalMb && gpu.memoryUsedMb !== null
        ? Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 1000) / 10
        : null,
    cpuTempC: temps.main,
    load1: loadAvg ? Math.round(loadAvg[0] * 100) / 100 : null,
    load5: loadAvg ? Math.round(loadAvg[1] * 100) / 100 : null,
    load15: loadAvg ? Math.round(loadAvg[2] * 100) / 100 : null,
    uptimeSec: os.uptime(),
    processCount: processes.total || null,
    batteryPct: battery ? battery.percent : null,
    containersRunning: dockerAvailable ? containers.filter((entry) => entry.state === "running").length : null,
    containersTotal: dockerAvailable ? containers.length : null,
  };

  const detail: MetricDetail = {
    cpu: {
      perCore: (load.cpus ?? []).map((core) => Math.round((core.load ?? 0) * 10) / 10),
      speedGhz: null,
      temperatures: temps.cores,
    },
    disks,
    network: interfaces,
    gpus,
    battery,
    topProcesses: processes.list,
    containers,
  };

  return { ts: Date.now(), summary, detail };
}
