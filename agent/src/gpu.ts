/**
 * GPU readings.
 *
 * `si.graphics()` names the adapters on a device, but it only fills in a
 * utilisation figure when it can reach nvidia-smi itself. Everywhere else every
 * GPU field came back null, so the dashboard drew a panel with no numbers in
 * it. The readings are collected here instead, from the source each platform
 * actually exposes:
 *
 *  - nvidia-smi, on any platform, for NVIDIA cards.
 *  - `/sys/class/drm` on Linux, which is where amdgpu publishes its busy
 *    percentage, VRAM use and temperature.
 *  - The GPU performance counters on Windows, which cover Intel and AMD too and
 *    are the numbers Task Manager shows.
 *
 * Identity (vendor, model, total memory) comes from `si.graphics()` where it
 * can, cached far longer than the readings because it cannot change while the
 * agent runs. Windows does not rely on it: `si.graphics()` comes back empty on
 * some Windows 11 machines, which left a PC with a real card showing no GPU
 * panel at all, so the adapters are named from `Win32_VideoController` in the
 * same call that reads the counters.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import si from "systeminformation";
import type { GpuUsage } from "@beacon/shared";

const execFileAsync = promisify(execFile);

/** Every probe here is optional, so a failure is an absent reading, not an error. */
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

function empty(): GpuUsage {
  return {
    model: "",
    vendor: "",
    utilizationPct: null,
    memoryUsedMb: null,
    memoryTotalMb: null,
    memoryShared: false,
    temperatureC: null,
  };
}

/**
 * What Windows lets an adapter borrow from system RAM, which is half of it.
 * This is the figure Task Manager draws its shared memory bar against, and the
 * only sensible total for a chip that has no memory of its own.
 */
function sharedLimitMb(): number {
  return Math.round(os.totalmem() / 2 / 1024 / 1024);
}

function hasReading(entry: GpuUsage): boolean {
  return (
    entry.utilizationPct !== null ||
    entry.memoryUsedMb !== null ||
    entry.memoryTotalMb !== null ||
    entry.temperatureC !== null
  );
}

/* ------------------------------------------------------------------- nvidia */

const NVIDIA_CANDIDATES =
  process.platform === "win32"
    ? [
        "nvidia-smi.exe",
        "C:\\Windows\\System32\\nvidia-smi.exe",
        "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
      ]
    : ["nvidia-smi", "/usr/bin/nvidia-smi", "/usr/local/bin/nvidia-smi"];

const NVIDIA_QUERY = [
  "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
  "--format=csv,noheader,nounits",
];

/**
 * Remembered after the first look: `undefined` means the tool has not been
 * searched for yet, `null` that this device has no NVIDIA card and should stop
 * paying for the search on every sample.
 */
let nvidiaSmi: string | null | undefined;

async function readNvidia(): Promise<GpuUsage[]> {
  if (nvidiaSmi === null) return [];

  let output: string | null = null;
  if (nvidiaSmi === undefined) {
    for (const candidate of NVIDIA_CANDIDATES) {
      output = await run(candidate, NVIDIA_QUERY);
      if (output !== null) {
        nvidiaSmi = candidate;
        break;
      }
    }
    if (nvidiaSmi === undefined) {
      nvidiaSmi = null;
      return [];
    }
  } else {
    output = await run(nvidiaSmi, NVIDIA_QUERY);
  }

  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // name, utilization, memory used, memory total, temperature. A field the
      // card does not report reads "[N/A]" and parses to null.
      const [name, utilization, used, total, temperature] = line.split(",").map((field) => field.trim());
      return {
        model: name ?? "",
        vendor: "NVIDIA",
        utilizationPct: numberOrNull(utilization),
        memoryUsedMb: numberOrNull(used),
        memoryTotalMb: numberOrNull(total),
        memoryShared: false,
        temperatureC: numberOrNull(temperature),
      } satisfies GpuUsage;
    });
}

/* -------------------------------------------------------------- linux sysfs */

/** PCI vendor ids, so a card without a name at least says who made it. */
const PCI_VENDORS: Record<string, string> = {
  "0x1002": "AMD",
  "0x1022": "AMD",
  "0x10de": "NVIDIA",
  "0x8086": "Intel",
  "0x1a03": "ASPEED",
  "0x15ad": "VMware",
  "0x1af4": "Red Hat",
  "0x1234": "QEMU",
};

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

async function readNumber(path: string): Promise<number | null> {
  return numberOrNull(await readText(path));
}

/** amdgpu hangs its temperature off a hwmon directory with a generated name. */
async function readCardTemperature(device: string): Promise<number | null> {
  let entries: string[];
  try {
    entries = await readdir(`${device}/hwmon`);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const millidegrees = await readNumber(`${device}/hwmon/${entry}/temp1_input`);
    if (millidegrees !== null) return Math.round(millidegrees / 1000);
  }
  return null;
}

async function readSysfs(): Promise<GpuUsage[]> {
  if (process.platform !== "linux") return [];

  let cards: string[];
  try {
    cards = (await readdir("/sys/class/drm"))
      .filter((name) => /^card\d+$/.test(name))
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  } catch {
    return [];
  }

  const found: GpuUsage[] = [];
  for (const card of cards) {
    const device = `/sys/class/drm/${card}/device`;
    const busy = await readNumber(`${device}/gpu_busy_percent`);
    const used = await readNumber(`${device}/mem_info_vram_used`);
    const total = await readNumber(`${device}/mem_info_vram_total`);
    const temperature = await readCardTemperature(device);
    // A card that reports none of these adds nothing si has not already said.
    if (busy === null && used === null && total === null && temperature === null) continue;

    found.push({
      model: "",
      vendor: PCI_VENDORS[(await readText(`${device}/vendor`)) ?? ""] ?? "",
      utilizationPct: busy,
      memoryUsedMb: used === null ? null : Math.round(used / 1024 / 1024),
      memoryTotalMb: total === null ? null : Math.round(total / 1024 / 1024),
      memoryShared: false,
      temperatureC: temperature,
    });
  }
  return found;
}

/* ----------------------------------------------------------------- windows */

/*
 * One PowerShell call answers three questions, because starting PowerShell is
 * the expensive part on Windows:
 *
 *  - `C` lines name the adapters, from `Win32_VideoController`. This does not
 *    go through `si.graphics()`, which comes back empty on some Windows 11
 *    machines and is the reason a PC with a real card was offered no GPU panel
 *    at all.
 *  - `U` lines are the load per adapter.
 *  - `M` lines are the dedicated memory in use per adapter, and `S` lines the
 *    memory it has borrowed from system RAM. An onboard chip has no memory of
 *    its own, so its dedicated figure is zero and the borrowed one is the only
 *    one that means anything.
 *  - `V` lines are how much memory an adapter has, from the driver's registry
 *    key. `Win32_VideoController.AdapterRAM` is a 32 bit field and saturates at
 *    4 GiB, which is how a 24 GiB card came to report itself as a 4 GiB one.
 *
 * The performance counters are read through their CIM classes rather than
 * Get-Counter, because counter *paths* are translated on a localised Windows
 * and "\GPU Engine(*)\Utilization Percentage" then matches nothing. The class
 * and property names below are the same in every language.
 *
 * An engine instance is named
 *   pid_1234_luid_0x00000000_0x0000F7A9_phys_0_eng_0_engtype_3D
 * so the adapter is the `luid…phys` part, which is also how the memory class
 * names its instances. Work on one adapter is spread over several engines, and
 * Task Manager's headline figure is the busiest engine type rather than the sum
 * of all of them, so that is what this reports.
 */
export const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
foreach ($e in @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)) {
  $adapter = [regex]::Match($e.Name, 'luid_0x[0-9A-Fa-f]+_0x[0-9A-Fa-f]+_phys_\\d+').Value
  if (-not $adapter) { continue }
  $type = [regex]::Match($e.Name, 'engtype_.+$').Value
  $rows += [pscustomobject]@{ Adapter = $adapter; Type = $type; Value = [double]$e.UtilizationPercentage }
}
$out = @()
foreach ($adapter in ($rows | Group-Object Adapter)) {
  $busiest = 0
  foreach ($type in ($adapter.Group | Group-Object Type)) {
    $sum = ($type.Group | Measure-Object Value -Sum).Sum
    if ($sum -gt $busiest) { $busiest = $sum }
  }
  $out += "U|$($adapter.Name)|$busiest"
}
foreach ($m in @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory)) {
  $out += "M|$($m.Name)|$($m.DedicatedUsage)"
  $out += "S|$($m.Name)|$($m.SharedUsage)"
}
foreach ($c in @(Get-CimInstance Win32_VideoController)) {
  if ($c.Name -match 'Basic Render|Basic Display|Remote Display') { continue }
  $out += "C|$($c.Name)|$($c.AdapterRAM)"
}
$class = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
foreach ($k in @(Get-ChildItem -LiteralPath $class)) {
  $desc = $k.GetValue('DriverDesc')
  $size = $k.GetValue('HardwareInformation.qwMemorySize')
  if (-not $size) { $size = $k.GetValue('HardwareInformation.MemorySize') }
  if ($size -is [byte[]]) { $size = [System.BitConverter]::ToUInt32($size, 0) }
  if ($desc -and $size) { $out += "V|$desc|$size" }
}
$out -join "\`n"
`;

/** Cleared once Windows answers nothing at all, so it stops being asked. */
let windowsGpuInfo = true;

async function readWindows(): Promise<GpuUsage[]> {
  if (process.platform !== "win32" || !windowsGpuInfo) return [];

  const output = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_SCRIPT,
  ]);
  if (!output) return [];

  const adapters = new Map<string, GpuUsage>();
  const of = (name: string) => {
    const existing = adapters.get(name);
    if (existing) return existing;
    const created = empty();
    adapters.set(name, created);
    return created;
  };
  const named: GpuUsage[] = [];
  const vram = new Map<string, number>();
  const shared = new Map<string, number>();

  for (const line of output.split("\n")) {
    const [kind, key, raw] = line.trim().split("|");
    if (!key) continue;
    if (kind === "C") {
      named.push({ ...empty(), model: key, memoryTotalMb: bytesToMb(numberOrNull(raw)) });
      continue;
    }
    const value = numberOrNull(raw);
    if (value === null) continue;
    if (kind === "V") vram.set(key, value);
    if (kind === "U") of(key).utilizationPct = Math.round(Math.min(100, value) * 10) / 10;
    if (kind === "M") of(key).memoryUsedMb = bytesToMb(value);
    if (kind === "S") shared.set(key, bytesToMb(value) ?? 0);
  }

  /*
   * An adapter using none of its own memory but some of the system's is an
   * onboard chip. Reporting "0 B of 2.1 GB" for one is both numbers wrong, so
   * it is measured against what it may borrow instead.
   */
  for (const [key, entry] of adapters) {
    const borrowed = shared.get(key) ?? 0;
    if (entry.memoryUsedMb || borrowed <= 0) continue;
    entry.memoryUsedMb = borrowed;
    entry.memoryTotalMb = sharedLimitMb();
    entry.memoryShared = true;
  }

  if (adapters.size === 0 && named.length === 0) {
    windowsGpuInfo = false;
    return [];
  }

  /*
   * The driver's own figure wins wherever it is bigger, which is the saturated
   * case and nothing else. Where the driver does not offer one, a total sitting
   * exactly on the 4 GiB ceiling is reported as unknown rather than as fact: a
   * 24 GiB card reading "3.5 GB of 4.3 GB" is not a rounding error, it is a
   * different card, and no figure at all beats a wrong one.
   */
  for (const entry of named) {
    const exact = bytesToMb(vram.get(entry.model) ?? null);
    if (exact !== null) {
      if (entry.memoryTotalMb === null || exact > entry.memoryTotalMb) entry.memoryTotalMb = exact;
      continue;
    }
    if (entry.memoryTotalMb !== null && entry.memoryTotalMb >= 4095 && entry.memoryTotalMb <= 4096) {
      entry.memoryTotalMb = null;
    }
  }

  // Sorted by instance name so the order is stable between samples, which is
  // what lets a reading stay attached to the same adapter.
  const readings = [...adapters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
  if (named.length === 0) return readings;

  return pairBySize(named, readings);
}

/**
 * Puts a counter reading against the adapter it came from.
 *
 * The counters know an adapter by its LUID and `Win32_VideoController` knows it
 * by name, and nothing in either connects the two. Pairing them by position put
 * a 3.3 GiB reading against a 512 MiB chip on a PC with a chip beside a card,
 * which the dashboard then drew as 654% memory in use.
 *
 * They are paired biggest to biggest instead. Dedicated memory in use cannot
 * exceed the memory an adapter has, so the largest reading belongs to the
 * largest adapter, and load breaks a tie because a machine at rest gives
 * nothing else to go on. Two adapters of the same size are still a guess, which
 * is as far as anything short of the graphics API can take it.
 */
export function pairBySize(named: GpuUsage[], readings: GpuUsage[]): GpuUsage[] {
  // Borrowed memory says nothing about how big an adapter is, so it sorts last.
  // The chip with none of its own is the one doing the borrowing.
  const own = (entry: GpuUsage) => (entry.memoryShared ? 0 : (entry.memoryUsedMb ?? 0));
  const byLoad = readings
    .slice()
    .sort((a, b) => own(b) - own(a) || (b.utilizationPct ?? 0) - (a.utilizationPct ?? 0));
  const paired = named.map((entry) => ({ ...entry }));

  paired
    .slice()
    .sort((a, b) => (b.memoryTotalMb ?? 0) - (a.memoryTotalMb ?? 0))
    .forEach((entry, rank) => {
      const reading = byLoad[rank];
      entry.utilizationPct = reading?.utilizationPct ?? null;
      entry.memoryUsedMb = reading?.memoryUsedMb ?? null;
      entry.memoryShared = reading?.memoryShared ?? false;
      // Measured against what it may borrow, not against a pool it has not got.
      if (reading?.memoryShared && reading.memoryTotalMb !== null) entry.memoryTotalMb = reading.memoryTotalMb;
    });

  return paired;
}

function bytesToMb(bytes: number | null): number | null {
  return bytes === null ? null : Math.round(bytes / 1024 / 1024);
}

/* ------------------------------------------------------------------- merge */

/** Cached hard: an adapter cannot change while the agent is running. */
let controllers: GpuUsage[] | null = null;

async function readControllers(): Promise<GpuUsage[]> {
  if (controllers) return controllers;
  try {
    const graphics = await si.graphics();
    controllers = graphics.controllers.map((controller) => ({
      model: controller.model ?? "",
      vendor: controller.vendor ?? "",
      utilizationPct: null,
      memoryUsedMb: null,
      // `memoryTotal` is only filled in for cards si can query directly, so the
      // adapter's reported VRAM stands in for the rest.
      memoryTotalMb: numberOrNull(controller.memoryTotal) ?? numberOrNull(controller.vram),
      memoryShared: false,
      temperatureC: null,
    }));
  } catch {
    controllers = [];
  }
  return controllers;
}

const BRANDS = ["nvidia", "amd", "radeon", "intel", "apple"];

/** Treats "Advanced Micro Devices" and "Radeon" as the same maker as "AMD". */
function brandOf(entry: GpuUsage): string {
  const text = `${entry.vendor} ${entry.model}`.toLowerCase();
  const brand = BRANDS.find((candidate) => text.includes(candidate));
  if (brand === "radeon") return "amd";
  if (text.includes("advanced micro devices")) return "amd";
  return brand ?? "";
}

/** Where a reading goes: an adapter to fill in, a new entry, or nowhere. */
const APPEND = -1;
const DISCARD = -2;

/**
 * Attaches each reading to the adapter it belongs to, by maker first and by
 * position second, so a laptop with an Intel chip beside an NVIDIA card does
 * not show the card's load against the chip.
 *
 * A reading with no adapter to go to becomes an entry of its own. That is the
 * case that matters most, because `si.graphics()` returns nothing at all on
 * some Windows 11 machines, and a device whose only GPU knowledge comes from
 * the performance counters still has a GPU worth showing.
 *
 * It is discarded only when a second source has already described the same
 * card, which is what happens on Windows when nvidia-smi and the counters both
 * report the one NVIDIA card in the machine. A duplicate reading is worth less
 * than the first one and would otherwise appear as a phantom extra GPU.
 */
export function merge(adapters: GpuUsage[], readings: GpuUsage[]): GpuUsage[] {
  const merged = adapters.map((entry) => ({ ...entry }));
  const used = new Set<number>();

  const claim = (reading: GpuUsage): number => {
    const brand = brandOf(reading);
    if (brand) {
      const free = merged.findIndex((entry, index) => !used.has(index) && brandOf(entry) === brand);
      if (free !== -1) return free;
      // Every adapter from this maker is already spoken for.
      if (merged.some((entry) => brandOf(entry) === brand)) return DISCARD;
      return APPEND;
    }
    const spare = merged.findIndex((entry, index) => !used.has(index) && !hasReading(entry));
    if (spare !== -1) return spare;
    // Nameless and nowhere to go: only worth keeping when it is all there is.
    return merged.length === 0 ? APPEND : DISCARD;
  };

  for (const reading of readings) {
    const index = claim(reading);
    if (index === DISCARD) continue;
    if (index === APPEND) {
      merged.push({ ...reading });
      used.add(merged.length - 1);
      continue;
    }
    used.add(index);
    merged[index] = {
      model: merged[index].model || reading.model,
      vendor: merged[index].vendor || reading.vendor,
      utilizationPct: reading.utilizationPct ?? merged[index].utilizationPct,
      memoryUsedMb: reading.memoryUsedMb ?? merged[index].memoryUsedMb,
      memoryTotalMb: reading.memoryTotalMb ?? merged[index].memoryTotalMb,
      memoryShared: reading.memoryShared || merged[index].memoryShared,
      temperatureC: reading.temperatureC ?? merged[index].temperatureC,
    };
  }

  // An adapter nothing could be read from and that si could not even name is
  // noise on the device page, so it is left out.
  return merged.filter((entry) => hasReading(entry) || entry.model || entry.vendor);
}

/**
 * A card cannot be using more memory than it has. When it looks like it is, the
 * total is the thing that is wrong: an adapter drawing on shared system memory,
 * or a size Windows reported from a field too narrow to hold it. Reporting no
 * total at all is honest, where keeping it gave the dashboard a GPU sitting at
 * 654% memory in use.
 */
function trustworthy(entry: GpuUsage): GpuUsage {
  if (entry.memoryUsedMb === null || entry.memoryTotalMb === null) return entry;
  if (entry.memoryUsedMb <= entry.memoryTotalMb) return entry;
  return { ...entry, memoryTotalMb: null };
}

export async function readGpus(): Promise<GpuUsage[]> {
  const [adapters, nvidia, sysfs, windows] = await Promise.all([
    readControllers(),
    readNvidia(),
    readSysfs(),
    readWindows(),
  ]);
  return merge(adapters, [...nvidia, ...sysfs, ...windows]).map(trustworthy);
}
