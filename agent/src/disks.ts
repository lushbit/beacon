/**
 * Drives, the filesystems sitting on them, and how hard each drive is working.
 *
 * `si.fsStats()` answers with one read and one write figure for the whole
 * machine, and on Windows it answers with nothing at all, which is why the Disk
 * activity panel never appeared there. Throughput is read per drive instead,
 * from the place each platform keeps it:
 *
 *  - `/proc/diskstats` on Linux, counted in sectors since boot.
 *  - The physical disk performance counters on Windows, which also name the
 *    drive letters each drive carries and so map a volume to its drive.
 *
 * macOS has neither, so it keeps the machine-wide figure it always had.
 */
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import si from "systeminformation";
import type { DiskDevice, DiskUsage } from "@beacon/shared";

const execFileAsync = promisify(execFile);

async function run(file: string, args: string[], timeoutMs = 8000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/* ------------------------------------------------------------ system mounts */

/** Filesystems that hold no user data and only ever add noise to the page. */
const PSEUDO_TYPES =
  /^(efivarfs|tmpfs|devtmpfs|devfs|squashfs|overlay|overlayfs|proc|procfs|sysfs|ramfs|autofs|cgroup2?|debugfs|tracefs|securityfs|pstore|bpf|configfs|fusectl|nsfs|mqueue|hugetlbfs|binfmt_misc|rpc_pipefs|fuse\.gvfsd-fuse|none)$/i;

const SYSTEM_MOUNTS = /^\/(sys|proc|dev|run|snap)(\/|$)|^\/var\/lib\/docker(\/|$)/;

/** Below this a filesystem is firmware or scratch space, not storage. */
const TINY_BYTES = 64 * 1024 * 1024;

function isSystemVolume(entry: { type: string; mount: string; sizeBytes: number }): boolean {
  if (PSEUDO_TYPES.test(entry.type)) return true;
  if (SYSTEM_MOUNTS.test(entry.mount)) return true;
  return entry.sizeBytes > 0 && entry.sizeBytes < TINY_BYTES;
}

/* ------------------------------------------------------------- linux rates */

interface Counters {
  readBytes: number;
  writeBytes: number;
  reads: number;
  writes: number;
  /** Milliseconds the drive spent with at least one request in flight. */
  busyMs: number;
}

/** Counters are totals since boot, so a rate needs the previous reading. */
let previous: { at: number; byDevice: Map<string, Counters> } | null = null;

const LINUX_SECTOR_BYTES = 512;

/**
 * Whole drives only. `/proc/diskstats` lists partitions and device-mapper
 * entries beside them, and counting those as well would report the same write
 * two or three times over.
 */
async function readLinuxCounters(whole: Set<string>): Promise<Map<string, Counters>> {
  const out = new Map<string, Counters>();
  let text: string;
  try {
    text = await readFile("/proc/diskstats", "utf8");
  } catch {
    return out;
  }

  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const name = parts[2];
    if (!whole.has(name)) continue;
    const readSectors = numberOrNull(parts[5]);
    const writeSectors = numberOrNull(parts[9]);
    if (readSectors === null || writeSectors === null) continue;
    out.set(`/dev/${name}`, {
      readBytes: readSectors * LINUX_SECTOR_BYTES,
      writeBytes: writeSectors * LINUX_SECTOR_BYTES,
      reads: numberOrNull(parts[3]) ?? 0,
      writes: numberOrNull(parts[7]) ?? 0,
      busyMs: numberOrNull(parts[12]) ?? 0,
    });
  }
  return out;
}

/* ----------------------------------------------------------- windows rates */

/*
 * An instance of the physical disk counter is named "0 C: D:", which is the
 * drive's index followed by every drive letter on it. That is the only place
 * Windows readily says which volume lives on which drive, so it is read here
 * and used for both jobs.
 */
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
foreach ($d in @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk)) {
  if ($d.Name -eq '_Total') { continue }
  $out += "$($d.Name)|$($d.DiskReadBytesPerSec)|$($d.DiskWriteBytesPerSec)|$($d.DiskReadsPerSec)|$($d.DiskWritesPerSec)|$($d.PercentIdleTime)"
}
$out -join "\`n"
`;

interface WindowsDrive {
  index: number;
  letters: string[];
  readBps: number;
  writeBps: number;
  readIops: number | null;
  writeIops: number | null;
  busyPct: number | null;
}

/** Cleared once Windows answers nothing, so it stops being asked. */
let windowsCounters = true;

async function readWindowsDrives(): Promise<WindowsDrive[]> {
  if (!windowsCounters) return [];

  const output = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_SCRIPT,
  ]);
  if (!output) return [];

  const drives: WindowsDrive[] = [];
  for (const line of output.split("\n")) {
    const [name, read, write, reads, writes, idle] = line.trim().split("|");
    if (!name) continue;
    // "0 C: D:" or "1" for a drive with no letter on it.
    const [head, ...letters] = name.trim().split(/\s+/);
    const index = numberOrNull(head);
    if (index === null) continue;
    const idlePct = numberOrNull(idle);
    drives.push({
      index,
      letters: letters.map((letter) => letter.replace(/:$/, "").toUpperCase()),
      readBps: numberOrNull(read) ?? 0,
      writeBps: numberOrNull(write) ?? 0,
      readIops: numberOrNull(reads),
      writeIops: numberOrNull(writes),
      // Windows counts idle time, and can overshoot 100 on a drive with a queue.
      busyPct: idlePct === null ? null : clampPct(100 - idlePct),
    });
  }

  if (drives.length === 0) windowsCounters = false;
  return drives;
}

/* ------------------------------------------------------------------ drives */

/** The hardware cannot change while the agent runs, so it is asked for once. */
let hardware: Awaited<ReturnType<typeof si.diskLayout>> | null = null;

async function readHardware() {
  if (!hardware) hardware = await si.diskLayout().catch(() => []);
  return hardware;
}

function clampPct(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/** `\\.\PHYSICALDRIVE2` and `/dev/sda` both end in what identifies them. */
function windowsIndexOf(device: string): number | null {
  const match = /(\d+)\s*$/.exec(device);
  return match ? Number(match[1]) : null;
}

export interface DiskSnapshot {
  disks: DiskUsage[];
  drives: DiskDevice[];
}

export async function readDisks(): Promise<DiskSnapshot> {
  const [sizes, blocks, layout] = await Promise.all([
    si.fsSize().catch(() => []),
    si.blockDevices().catch(() => []),
    readHardware(),
  ]);

  // Which partition belongs to which drive. On Linux a block device names its
  // parent outright, which is the whole mapping in one step.
  const parentOf = new Map<string, string>();
  for (const block of blocks) {
    if (block.type === "part" && block.device) parentOf.set(block.name, block.device);
    if (block.mount && block.device) parentOf.set(block.mount, block.device);
  }

  const windows = process.platform === "win32" ? await readWindowsDrives() : [];
  const byLetter = new Map<string, number>();
  for (const drive of windows) for (const letter of drive.letters) byLetter.set(letter, drive.index);

  const disks: DiskUsage[] = sizes
    .filter((entry) => entry.size > 0)
    .map((entry) => {
      const mount = entry.mount ?? "";
      const type = entry.type ?? "";
      const base = {
        fs: entry.fs,
        mount,
        type,
        sizeBytes: entry.size,
        usedBytes: entry.used,
        usePct: Math.round((entry.use ?? 0) * 10) / 10,
      };

      let device = parentOf.get(mount) ?? parentOf.get((entry.fs ?? "").replace(/^\/dev\//, "")) ?? "";
      if (!device && process.platform === "win32") {
        const index = byLetter.get(mount.replace(/[:\\/]+$/, "").toUpperCase());
        if (index !== undefined) device = `\\\\.\\PHYSICALDRIVE${index}`;
      }

      return { ...base, device, system: isSystemVolume(base) };
    });

  /* The rate is the change since the last sample. The first one after startup
   * has nothing to compare against, so it reports no rate rather than a spike
   * the size of everything written since the machine booted. */
  const now = Date.now();
  const counters =
    process.platform === "linux"
      ? await readLinuxCounters(new Set(blocks.filter((block) => block.type === "disk").map((block) => block.name)))
      : new Map<string, Counters>();
  const elapsedSec = previous ? (now - previous.at) / 1000 : 0;

  type Rates = Pick<DiskDevice, "readBps" | "writeBps" | "readIops" | "writeIops" | "busyPct">;
  const none: Rates = { readBps: null, writeBps: null, readIops: null, writeIops: null, busyPct: null };

  const rateOf = (device: string): Rates => {
    if (process.platform === "win32") {
      const index = windowsIndexOf(device);
      const drive = windows.find((entry) => entry.index === index);
      return drive
        ? {
            readBps: drive.readBps,
            writeBps: drive.writeBps,
            readIops: drive.readIops === null ? null : Math.round(drive.readIops),
            writeIops: drive.writeIops === null ? null : Math.round(drive.writeIops),
            busyPct: drive.busyPct,
          }
        : none;
    }
    const current = counters.get(device);
    const before = previous?.byDevice.get(device);
    if (!current || !before || elapsedSec <= 0) return none;
    const perSec = (now: number, then: number) => Math.max(0, Math.round((now - then) / elapsedSec));
    return {
      readBps: perSec(current.readBytes, before.readBytes),
      writeBps: perSec(current.writeBytes, before.writeBytes),
      readIops: perSec(current.reads, before.reads),
      writeIops: perSec(current.writes, before.writes),
      busyPct: clampPct((current.busyMs - before.busyMs) / (elapsedSec * 10)),
    };
  };

  const drives: DiskDevice[] = layout.map((entry, index) => {
    const device =
      entry.device || (process.platform === "win32" ? `\\\\.\\PHYSICALDRIVE${index}` : `/dev/disk${index}`);
    return {
      device,
      name: entry.name || entry.device || `Drive ${index + 1}`,
      vendor: entry.vendor ?? "",
      sizeBytes: numberOrNull(entry.size),
      kind: entry.type ?? "",
      interfaceType: entry.interfaceType ?? "",
      temperatureC: numberOrNull(entry.temperature),
      ...rateOf(device),
    };
  });

  // A drive the counters know but the hardware list does not still deserves a
  // line, since its throughput is real whatever the layout says.
  for (const device of counters.keys()) {
    if (drives.some((drive) => drive.device === device)) continue;
    drives.push({
      device,
      name: device,
      vendor: "",
      sizeBytes: null,
      kind: "",
      interfaceType: "",
      temperatureC: null,
      ...rateOf(device),
    });
  }

  if (counters.size > 0) previous = { at: now, byDevice: counters };
  return { disks, drives };
}
