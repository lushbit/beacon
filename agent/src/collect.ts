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
import { readDisks, type DiskSnapshot } from "./disks.js";
import { readGpus } from "./gpu.js";
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

const gpuCache = new Cached<GpuUsage[]>(readGpus, 15_000, []);

/*
 * Drives and filesystems come back together, because working out which drive a
 * filesystem sits on needs both. Ten seconds rather than thirty: the read and
 * write rates in here are charted, and a rate measured over half a minute is
 * too blunt to show a burst.
 */
const disksCache = new Cached<DiskSnapshot>(readDisks, 10_000, { disks: [], drives: [] });

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
    const health =
      battery.maxCapacity > 0 && battery.designedCapacity > 0
        ? Math.round((battery.maxCapacity / battery.designedCapacity) * 1000) / 10
        : null;
    return {
      percent: battery.percent ?? 0,
      isCharging: Boolean(battery.isCharging),
      minutesRemaining: battery.timeRemaining && battery.timeRemaining > 0 ? battery.timeRemaining : null,
      // Some firmware reports a design capacity from the wrong unit, which reads
      // as a battery at 3% or 900%. Neither is worth showing.
      healthPct: health !== null && health >= 20 && health <= 120 ? health : null,
      cycleCount: battery.cycleCount > 0 ? battery.cycleCount : null,
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
  // Memory comes from Node rather than si.mem(), which gives the same total but
  // starts PowerShell on Windows, and this runs before the agent can connect.
  const [osInfo, cpu, system, time] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.system(),
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
    memTotalBytes: os.totalmem(),
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
  const [load, mem, net, fsStats, speed] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats().catch(() => []),
    si.fsStats().catch(() => null),
    si.cpuCurrentSpeed().catch(() => null),
  ]);

  const { disks, drives } = disksCache.get();
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

  /*
   * Firmware and scratch filesystems are left out of both the busiest volume
   * and the totals. A 192 KiB EFI variable store sitting at 88% is not a device
   * running out of room, and counting it as one is how a tile came to disagree
   * with every number under it.
   */
  const realDisks = disks.filter((disk) => !disk.system);
  const busiestDisk = realDisks.reduce<DiskUsage | null>(
    (worst, disk) => (worst === null || disk.usePct > worst.usePct ? disk : worst),
    null
  );
  // A filesystem mounted twice is one filesystem, so it is counted once.
  const counted = new Map(realDisks.map((disk) => [`${disk.fs}:${disk.sizeBytes}`, disk]));
  const diskTotals = [...counted.values()].reduce(
    (acc, disk) => ({ used: acc.used + disk.usedBytes, size: acc.size + disk.sizeBytes }),
    { used: 0, size: 0 }
  );

  // One device charts one GPU series, so this has to pick the same card on
  // every sample or the line would be a blend of two. The card with the most
  // memory is the one doing the work on a machine that has a chip as well.
  const gpu =
    gpus
      .filter((entry) => entry.utilizationPct !== null || entry.memoryUsedMb !== null)
      .sort((a, b) => (b.memoryTotalMb ?? 0) - (a.memoryTotalMb ?? 0))[0] ??
    gpus[0] ??
    null;
  const loadAvg = process.platform === "win32" ? null : os.loadavg();

  /** Null rather than zero when no drive reported, so "unknown" stays unknown. */
  const totalRate = (key: "readBps" | "writeBps" | "readIops" | "writeIops"): number | null => {
    const known = drives.map((drive) => drive[key]).filter((value): value is number => typeof value === "number");
    return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
  };

  const tenth = (value: unknown): number | null => {
    const known = numberOrNull(value);
    return known === null ? null : Math.round(known * 10) / 10;
  };
  // systeminformation reports GHz, and zero when it could not tell. Only Linux
  // reports the live clock. Windows and macOS give the rated speed on every
  // call, which would chart as a flat line that means nothing.
  const mhz = process.platform === "linux" && speed && speed.avg > 0 ? Math.round(speed.avg * 1000) : null;

  const busiest = drives
    .map((drive) => drive.busyPct)
    .filter((value): value is number => typeof value === "number");
  const running = containers.filter((entry) => entry.state === "running");
  const containerSum = (key: "cpuPct" | "memUsedBytes"): number | null => {
    const known = running.map((entry) => entry[key]).filter((value): value is number => value !== null);
    return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
  };

  const summary: MetricSummary = {
    cpuPct: Math.round((load.currentLoad ?? 0) * 10) / 10,
    cpuUserPct: tenth(load.currentLoadUser),
    cpuSystemPct: tenth(load.currentLoadSystem),
    cpuStealPct: tenth(load.currentLoadSteal),
    cpuMhz: mhz,
    memCacheBytes: numberOrNull(mem.buffcache),
    swapUsedBytes: mem.swaptotal > 0 ? numberOrNull(mem.swapused) : null,
    swapTotalBytes: mem.swaptotal > 0 ? mem.swaptotal : null,
    memPct: mem.total > 0 ? Math.round((mem.active / mem.total) * 1000) / 10 : 0,
    memUsedBytes: mem.active,
    memTotalBytes: mem.total,
    swapPct: mem.swaptotal > 0 ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10 : null,
    diskMaxPct: busiestDisk ? busiestDisk.usePct : null,
    diskUsedBytes: diskTotals.size > 0 ? diskTotals.used : null,
    diskTotalBytes: diskTotals.size > 0 ? diskTotals.size : null,
    // The sum across the drives, which is a real figure on Windows where the
    // machine-wide one never was. macOS has neither counter and keeps si's.
    diskReadBps: totalRate("readBps") ?? (fsStats ? numberOrNull(fsStats.rx_sec) : null),
    diskWriteBps: totalRate("writeBps") ?? (fsStats ? numberOrNull(fsStats.wx_sec) : null),
    netRxBps: interfaces.length ? interfaces.reduce((sum, entry) => sum + entry.rxBytesPerSec, 0) : null,
    netTxBps: interfaces.length ? interfaces.reduce((sum, entry) => sum + entry.txBytesPerSec, 0) : null,
    gpuPct: gpu?.utilizationPct ?? null,
    gpuMemPct:
      gpu && gpu.memoryTotalMb && gpu.memoryUsedMb !== null
        ? Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 1000) / 10
        : null,
    cpuTempC: temps.main,
    gpuTempC: gpu?.temperatureC ?? null,
    gpuPowerW: gpu?.powerW ?? null,
    diskBusyPct: busiest.length > 0 ? Math.max(...busiest) : null,
    diskReadIops: totalRate("readIops"),
    diskWriteIops: totalRate("writeIops"),
    containersCpuPct: dockerAvailable ? tenth(containerSum("cpuPct")) : null,
    containersMemBytes: dockerAvailable ? containerSum("memUsedBytes") : null,
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
    drives,
    cpu: {
      perCore: (load.cpus ?? []).map((core) => Math.round((core.load ?? 0) * 10) / 10),
      speedGhz: speed && speed.avg > 0 ? speed.avg : null,
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
