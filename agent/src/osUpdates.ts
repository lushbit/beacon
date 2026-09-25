/**
 * Operating system updates.
 *
 * Every platform has its own tool, so this is a small adapter per tool behind
 * one job runner. The runner owns the running process, keeps the log, works
 * out the phase and progress from the tool's own output, and reports to the hub
 * as it goes. Only one job runs at a time on a device.
 *
 * Nothing here ever waits for input. Every tool runs with no stdin and its
 * non-interactive flags, so a question a tool would have asked a person fails
 * the job with the question in the log instead of hanging it.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  OsUpdateInstallParams,
  OsUpdateInventory,
  OsUpdateItem,
  OsUpdateJobKind,
  OsUpdateJobSnapshot,
  OsUpdateManager,
  OsUpdateStatusResult,
  OsUpdateLogLevel,
} from "@beacon/shared";
import { formatLogLine, OS_UPDATE_MANAGER_LABELS } from "@beacon/shared";

export type OsUpdateEmit = (job: OsUpdateJobSnapshot, log: string[], inventory?: OsUpdateInventory) => void;

/* ------------------------------------------------------------------ helpers */

const SEARCH_PATH = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

function which(command: string): string | null {
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), ...SEARCH_PATH].filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function readOsRelease(): Record<string, string> {
  try {
    const text = fs.readFileSync("/etc/os-release", "utf8");
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

/** A progress bar redraws itself with \r, and only its last state is worth keeping. */
function cleanLine(raw: string): string {
  const parts = raw.split("\r");
  const last = parts.reverse().find((part) => part.trim() !== "") ?? "";
  return last.replace(ANSI, "").replace(/\s+$/, "");
}

function isRoot(): boolean {
  return typeof process.getuid !== "function" || process.getuid() === 0;
}

/**
 * The kernel that is running no longer has its modules on disk once a newer
 * one replaced it, which is the one reboot signal every distribution shares.
 * Only trusted where the modules directory exists at all, since a container or
 * a VPS on a host kernel has none and would always look out of date.
 */
function kernelReplaced(): boolean {
  const release = os.release();
  const bootedAt = Date.now() - os.uptime() * 1000;
  for (const base of ["/usr/lib/modules", "/lib/modules"]) {
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    if (!entries.includes(release)) return true;
    // Debian and Ubuntu keep the old kernel beside the new one, so the running
    // kernel's modules are still there. A different kernel that arrived since
    // boot is the sign there instead.
    return entries.some((entry) => {
      if (entry === release) return false;
      try {
        return fs.statSync(path.join(base, entry)).mtimeMs > bootedAt;
      } catch {
        return false;
      }
    });
  }
  return false;
}

/* ------------------------------------------------------------------ platform */

interface Platform {
  manager: OsUpdateManager | null;
  reason: string | null;
  canSelect: boolean;
  notes: string[];
  /** openSUSE Tumbleweed upgrades with `dup` rather than `update`. */
  rolling?: boolean;
}

let platform: Platform | null = null;

function detect(): Platform {
  if (platform) return platform;
  platform = detectUncached();
  return platform;
}

function unsupported(reason: string): Platform {
  return { manager: null, reason, canSelect: false, notes: [] };
}

function detectUncached(): Platform {
  if (process.platform === "win32") {
    return {
      manager: "windows",
      reason: null,
      canSelect: true,
      notes: ["Feature upgrades to a new Windows version are best installed from Settings on the PC."],
    };
  }

  if (process.platform === "darwin") {
    if (!isRoot()) {
      return unsupported(
        "The agent runs as a normal user on this Mac. Reinstall it with sudo so it can install updates."
      );
    }
    return {
      manager: "macos",
      reason: null,
      canSelect: true,
      notes: [
        "Apple only lets some macOS updates install without someone signing in on the Mac. If one fails for that reason, install it from System Settings.",
      ],
    };
  }

  if (process.platform !== "linux") return unsupported("Updates are not supported on this operating system yet.");

  if (fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv") || process.env.container) {
    return unsupported("The agent runs inside a container, so it cannot update the machine it runs on.");
  }
  if (!isRoot()) {
    return unsupported("The agent runs as a normal user. Reinstall it with sudo so it can install updates.");
  }

  const release = readOsRelease();
  if (release.ID === "nixos" || fs.existsSync("/etc/NIXOS")) {
    return unsupported("NixOS is updated by rebuilding its configuration, which Beacon does not do.");
  }
  if (fs.existsSync("/run/ostree-booted")) {
    return unsupported("This is an image-based system (ostree), which Beacon cannot update yet.");
  }

  if (which("apt-get") && which("dpkg")) return { manager: "apt", reason: null, canSelect: true, notes: [] };
  if (which("dnf") || which("dnf5")) return { manager: "dnf", reason: null, canSelect: true, notes: [] };
  if (which("yum")) return { manager: "yum", reason: null, canSelect: true, notes: [] };
  if (which("zypper")) {
    const rolling = /tumbleweed|slowroll/i.test(`${release.ID ?? ""} ${release.NAME ?? ""}`);
    return {
      manager: "zypper",
      reason: null,
      canSelect: !rolling,
      rolling,
      notes: rolling ? ["Tumbleweed is updated as a whole, so updates cannot be picked one by one."] : [],
    };
  }
  if (which("pacman")) {
    return {
      manager: "pacman",
      reason: null,
      canSelect: false,
      notes: ["Arch always upgrades everything at once. Upgrading single packages would leave the system half updated."],
    };
  }
  if (which("apk")) return { manager: "apk", reason: null, canSelect: true, notes: [] };

  return unsupported("No supported package manager was found (apt, dnf, yum, zypper, pacman or apk).");
}

/* -------------------------------------------------------------- the runner */

interface RunOptions {
  env?: Record<string, string>;
  /** Exit codes that count as success. */
  ok?: number[];
  /** Keep the output out of the job log, for listings that would flood it. */
  quiet?: boolean;
  /** Lines worth logging even when the rest of the output is kept out. */
  keep?: (line: string) => boolean;
  onLine?: (line: string) => void;
  /**
   * Said in the log whenever the tool has been silent for a minute, so a slow
   * step reads as slow rather than stuck.
   */
  waiting?: string;
  /** Stops the tool and fails the job if it has not finished by then. */
  timeoutMs?: number;
}

interface RunResult {
  code: number | null;
  output: string;
}

type Run = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

const MAX_LOG_LINES = 4000;
const MAX_OUTPUT = 4 * 1024 * 1024;

class Job {
  readonly snapshot: OsUpdateJobSnapshot;
  readonly log: string[] = [];
  private pending: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  child: ChildProcess | null = null;
  cancelled = false;
  rebootAfter = false;
  requested: string[] | null = null;

  constructor(
    id: string,
    kind: OsUpdateJobKind,
    private readonly emit: OsUpdateEmit
  ) {
    this.snapshot = {
      id,
      kind,
      state: "running",
      phase: "starting",
      progress: null,
      current: null,
      stepDone: null,
      stepTotal: null,
      cancellable: kind !== "reboot",
      rebootRequired: false,
      results: [],
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
  }

  /** Adds a log line: a time, a level and a message. */
  line(text: string, level: OsUpdateLogLevel = "INFO"): void {
    const line = formatLogLine(level, text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
    this.log.push(line);
    if (this.log.length > MAX_LOG_LINES) this.log.splice(0, this.log.length - MAX_LOG_LINES);
    this.pending.push(line);
    this.schedule();
  }

  set(patch: Partial<OsUpdateJobSnapshot>): void {
    Object.assign(this.snapshot, patch);
    this.schedule();
  }

  /** Several changes a second are merged into one event. */
  private schedule(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 400);
  }

  flush(inventory?: OsUpdateInventory): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const lines = this.pending;
    this.pending = [];
    this.emit({ ...this.snapshot, results: [...this.snapshot.results] }, lines, inventory);
  }

  finish(state: OsUpdateJobSnapshot["state"], error: string | null, inventory?: OsUpdateInventory): void {
    this.set({
      state,
      error,
      phase: "done",
      cancellable: false,
      current: null,
      finishedAt: Date.now(),
      progress: state === "succeeded" ? 100 : this.snapshot.progress,
    });
    this.flush(inventory);
  }

  /** Runs a command, feeding each output line to the log and to `onLine`. */
  run: Run = (command, args, options = {}) =>
    new Promise((resolve, reject) => {
      if (this.cancelled) {
        reject(new CancelledError());
        return;
      }
      if (!options.quiet) this.line(`${command} ${args.join(" ")}`.trim(), "CMD");
      const child = spawn(command, args, {
        env: { ...process.env, LC_ALL: "C", LANG: "C", ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
        // Its own process group, so stopping it also stops what it started.
        detached: process.platform !== "win32",
        windowsHide: true,
      });
      this.child = child;
      let output = "";
      let partial = "";
      const started = Date.now();
      let heardAt = started;
      let timedOut = false;

      const heartbeat = setInterval(() => {
        if (Date.now() - heardAt < 60_000) return;
        heardAt = Date.now();
        const minutes = Math.round((Date.now() - started) / 60_000);
        this.line(`${options.waiting ?? "Still running"}, ${minutes}m elapsed`, "WARN");
      }, 15_000);
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            this.killChild();
          }, options.timeoutMs)
        : null;
      const settle = () => {
        clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
      };

      const take = (chunk: Buffer) => {
        heardAt = Date.now();
        const text = chunk.toString("utf8");
        if (output.length < MAX_OUTPUT) output += text;
        const lines = (partial + text).split("\n");
        partial = lines.pop() ?? "";
        for (const raw of lines) this.handleLine(raw, options);
      };
      child.stdout?.on("data", take);
      child.stderr?.on("data", take);
      child.on("error", (error) => {
        settle();
        this.child = null;
        reject(error);
      });
      child.on("close", (code) => {
        settle();
        this.child = null;
        if (partial) this.handleLine(partial, options);
        if (this.cancelled) {
          reject(new CancelledError());
          return;
        }
        if (timedOut) {
          const minutes = Math.round((options.timeoutMs ?? 0) / 60_000);
          reject(new Error(`${path.basename(command)} gave no answer within ${minutes} minutes, so it was stopped.`));
          return;
        }
        const ok = options.ok ?? [0];
        if (code !== null && ok.includes(code)) {
          resolve({ code, output });
          return;
        }
        const tail = output
          .split("\n")
          .map(cleanLine)
          .filter(Boolean)
          .slice(-3)
          .join(" ");
        const reported = reportedError(output);
        reject(
          new ExitError(
            reported ?? `${path.basename(command)} exited with code ${code ?? "unknown"}${tail ? `: ${tail}` : ""}`,
            code
          )
        );
      });
    });

  private handleLine(raw: string, options: RunOptions): void {
    const line = cleanLine(raw);
    if (!line) return;
    // Scripts that speak in log lines already say their level.
    const logged = /^LOG (INFO|WARN|ERROR|OUT) (.*)$/.exec(line);
    if (logged) {
      this.line(logged[2], logged[1] as OsUpdateLogLevel);
      return;
    }
    options.onLine?.(line);
    if (!options.quiet || options.keep?.(line)) this.line(line, "OUT");
  }

  stop(): void {
    this.cancelled = true;
    this.killChild();
  }

  private killChild(): void {
    const child = this.child;
    if (!child || child.pid === undefined) return;
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined);
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
}

/** What the common Windows Update error codes mean, in words a person can act on. */
const WINDOWS_ERRORS: Record<string, string> = {
  "80240438": "Windows Update could not be reached from the system account",
  "8024402C": "The update server's name could not be looked up. Check the PC's internet connection",
  "80072EE7": "The update server's name could not be looked up. Check the PC's internet connection",
  "80072EE2": "The connection to Windows Update timed out",
  "8024401C": "The connection to Windows Update timed out",
  "80070422": "The Windows Update service is turned off on this PC",
  "8024001E": "The Windows Update service stopped while it was working",
  "80240016": "Another install is already running on this PC. Try again once it is done",
  "80070005": "Access was denied. The agent has to run as the system account",
};

/** The error a script reported itself, which says more than its exit code. */
function reportedError(output: string): string | null {
  const line = output
    .split("\n")
    .map(cleanLine)
    .reverse()
    .find((entry) => entry.startsWith("BEACON-ERROR "));
  if (!line) return null;
  const text = line.slice(13).trim();
  const code = /0x([0-9A-F]{8})/i.exec(text)?.[1]?.toUpperCase();
  const meaning = code ? WINDOWS_ERRORS[code] : undefined;
  return meaning ? `${meaning} (0x${code}).` : text;
}

/** A tool that ran and ended with an exit code nobody expected. */
class ExitError extends Error {
  constructor(
    message: string,
    readonly code: number | null
  ) {
    super(message);
  }
}

class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
  }
}

/** Runs a command outside any job, for background checks nobody is watching. */
const quietRun: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        env: { ...process.env, LC_ALL: "C", LANG: "C", ...options.env },
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        timeout: options.timeoutMs ?? 0,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        const output = `${stdout}${stderr}`;
        if (code !== null && (options.ok ?? [0]).includes(code)) resolve({ code, output });
        else reject(new ExitError(reportedError(output) ?? error?.message ?? `${command} failed`, code));
      }
    );
    // Nothing to say to it, and a tool that asks a question must not wait.
    child.stdin?.end();
  });

/* ----------------------------------------------------------------- adapters */

export interface Listing {
  items: OsUpdateItem[];
  rebootRequired: boolean;
}

interface InstallContext {
  job: Job;
  ids: string[] | null;
  /** Called once the tool starts changing the system, after which stopping is unsafe. */
  committing: () => void;
}

interface Adapter {
  list(run: Run, refresh: boolean): Promise<Listing>;
  install(context: InstallContext): Promise<void>;
}

function item(fields: Partial<OsUpdateItem> & { id: string; name: string }): OsUpdateItem {
  return {
    title: null,
    currentVersion: null,
    newVersion: null,
    sizeBytes: null,
    security: false,
    restart: false,
    kind: "package",
    ...fields,
  };
}

/** `(3/40)` and `[ 3/40]`, the way most tools number their steps. */
function stepOf(line: string): { done: number; total: number } | null {
  const match = /[([]\s*(\d+)\s*\/\s*(\d+)\s*[)\]]/.exec(line);
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  return total > 0 && done <= total ? { done, total } : null;
}

function setStep(job: Job, step: { done: number; total: number }, current: string | null): void {
  job.set({
    stepDone: step.done,
    stepTotal: step.total,
    progress: Math.round((step.done / step.total) * 1000) / 10,
    current: current ?? job.snapshot.current,
  });
}

/** Installed versions of every rpm, for the tools that only say the new one. */
async function rpmVersions(run: Run): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { output } = await run("rpm", ["-qa", "--qf", "%{NAME}.%{ARCH} %{VERSION}-%{RELEASE}\\n"], { quiet: true });
    for (const line of output.split("\n")) {
      const [key, version] = line.trim().split(" ");
      if (key && version) out.set(key, version);
    }
  } catch {
    /* versions are a nicety */
  }
  return out;
}

const KERNEL = /^(linux-image|linux-modules|linux-headers-\d|kernel|kernel-core|kernel-default|linux|linux-lts|linux-zen|linux-hardened|linux-virt)(-|$)/;

/* ---- apt */

const aptEnv = { DEBIAN_FRONTEND: "noninteractive", NEEDRESTART_MODE: "a", APT_LISTCHANGES_FRONTEND: "none" };

/** `libssl3/bookworm-security 3.0.15-1 amd64 [upgradable from: 3.0.14-1]` */
export function parseAptList(output: string): OsUpdateItem[] {
  const items: OsUpdateItem[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\S+?)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: ([^\]]+)\]/.exec(line.trim());
    if (!match) continue;
    const [, name, suite, next, current] = match;
    items.push(
      item({
        id: name,
        name,
        newVersion: next,
        currentVersion: current,
        security: /security/i.test(suite),
        restart: KERNEL.test(name),
      })
    );
  }
  return items;
}

const apt: Adapter = {
  async list(run, refresh) {
    if (refresh) await run("apt-get", ["update", "-o", "APT::Color=0"], { env: aptEnv });
    const { output } = await run("apt", ["list", "--upgradable"], { env: aptEnv, quiet: true });
    return {
      items: parseAptList(output),
      rebootRequired: fs.existsSync("/var/run/reboot-required") || kernelReplaced(),
    };
  },

  async install({ job, ids, committing }) {
    const args = [
      "-y",
      "-o", "Dpkg::Options::=--force-confdef",
      "-o", "Dpkg::Options::=--force-confold",
      "-o", "APT::Status-Fd=1",
      "-o", "APT::Color=0",
      // Waits for an unattended upgrade that holds the lock instead of failing.
      "-o", "DPkg::Lock::Timeout=300",
      ...(ids === null ? ["upgrade", "--with-new-pkgs"] : ["install", "--only-upgrade", ...ids]),
    ];
    job.set({ phase: "downloading" });
    await job.run("apt-get", args, {
      env: aptEnv,
      onLine: (line) => {
        // dlstatus:3:25.5:Retrieving file 3 of 12
        const download = /^dlstatus:[^:]*:([\d.]+):(.*)$/.exec(line);
        if (download) {
          job.set({ phase: "downloading", progress: Number(download[1]), current: download[2] });
          return;
        }
        // pmstatus:libssl3:45.4:Unpacking libssl3 (amd64)
        const install = /^pmstatus:[^:]*:([\d.]+):(.*)$/.exec(line);
        if (install) {
          committing();
          job.set({ phase: "installing", progress: Number(install[1]), current: install[2] });
        }
      },
    });
  },
};

/* ---- dnf and yum */

/**
 * `dnf check-update` prints `name.arch  version  repo`, and breaks a long name
 * onto a line of its own with the rest on the next one.
 */
export function parseDnfCheckUpdate(
  output: string,
  versions: Map<string, string> = new Map(),
  advisories: string[] = []
): OsUpdateItem[] {
  const found: { key: string; version: string }[] = [];
  let pending: string | null = null;
  for (const raw of output.split("\n")) {
    if (/^(Obsoleting|Security:)/.test(raw.trim())) break;
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 3 && tokens[0].includes(".") && /\d/.test(tokens[1])) {
      found.push({ key: tokens[0], version: tokens[1] });
      pending = null;
    } else if (tokens.length === 1 && tokens[0].includes(".") && !/:$/.test(tokens[0])) {
      pending = tokens[0];
    } else if (tokens.length === 2 && pending && /\d/.test(tokens[0])) {
      found.push({ key: pending, version: tokens[0] });
      pending = null;
    }
  }
  return found.map(({ key, version }) => {
    const name = key.replace(/\.[^.]+$/, "");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped}-\\d`);
    return item({
      id: key,
      name,
      newVersion: version,
      currentVersion: versions.get(key) ?? null,
      security: advisories.some((advisory) => pattern.test(advisory)),
      restart: KERNEL.test(name),
    });
  });
}

function dnfAdapter(binary: () => string): Adapter {
  return {
    async list(run, refresh) {
      const bin = binary();
      if (refresh) await run(bin, ["-y", "makecache"]);
      const { output } = await run(bin, ["-q", "check-update"], { ok: [0, 100], quiet: true });
      const versions = await rpmVersions(run);

      // The advisories name the exact builds that fix something.
      let advisories: string[] = [];
      try {
        const security = await run(bin, ["-q", "updateinfo", "list", "--security"], { ok: [0, 100], quiet: true });
        advisories = security.output
          .split("\n")
          .map((line) => line.trim().split(/\s+/).pop() ?? "")
          .filter(Boolean);
      } catch {
        /* not every repository publishes advisories */
      }

      const items = parseDnfCheckUpdate(output, versions, advisories);

      let rebootRequired = kernelReplaced();
      for (const [command, args] of [
        [bin, ["needs-restarting", "-r"]],
        ["needs-restarting", ["-r"]],
      ] as const) {
        try {
          const result = await run(command, [...args], { ok: [0, 1], quiet: true });
          rebootRequired = result.code === 1;
          break;
        } catch {
          /* the plugin is optional */
        }
      }
      return { items, rebootRequired };
    },

    async install({ job, ids, committing }) {
      job.set({ phase: "downloading" });
      let transaction = false;
      await job.run(binary(), ["-y", "upgrade", ...(ids ?? [])], {
        onLine: (line) => {
          if (/Running transaction|Transaction test succeeded|Running scriptlet/i.test(line)) {
            if (!transaction) committing();
            transaction = true;
            job.set({ phase: "installing" });
          }
          const step = stepOf(line);
          if (!step) return;
          const verb = /(Upgrading|Installing|Cleanup|Verifying|Erasing|Obsoleting|Reinstalling)\s*:?\s*(\S+)/.exec(line);
          if (verb) {
            if (!transaction) committing();
            transaction = true;
            job.set({ phase: "installing" });
            setStep(job, step, `${verb[1]} ${verb[2]}`);
          } else if (!transaction) {
            const name = /[)\]]:?\s+(\S+)/.exec(line)?.[1] ?? null;
            setStep(job, step, name ? `Downloading ${name}` : null);
          }
        },
      });
    },
  };
}

/* ---- zypper */

/** The `<update>` elements of `zypper --xmlout list-updates`. */
export function parseZypperUpdates(xml: string, versions: Map<string, string> = new Map()): OsUpdateItem[] {
  const items: OsUpdateItem[] = [];
  for (const tag of xml.match(/<update\s[^>]*>/g) ?? []) {
    const attribute = (key: string) => new RegExp(`\\s${key}="([^"]*)"`).exec(tag)?.[1] ?? null;
    const name = attribute("name");
    if (!name || (attribute("kind") ?? "package") !== "package") continue;
    const arch = attribute("arch");
    items.push(
      item({
        id: name,
        name,
        newVersion: attribute("edition"),
        currentVersion: attribute("edition-old") ?? (arch ? (versions.get(`${name}.${arch}`) ?? null) : null),
        restart: KERNEL.test(name),
      })
    );
  }
  return items;
}

const zypper: Adapter = {
  async list(run, refresh) {
    if (refresh) await run("zypper", ["--non-interactive", "refresh"]);
    const rolling = detect().rolling === true;
    const { output } = await run(
      "zypper",
      ["--non-interactive", "--xmlout", "list-updates", ...(rolling ? ["--dup"] : [])],
      { quiet: true }
    );
    const items = parseZypperUpdates(output, await rpmVersions(run));
    let rebootRequired = kernelReplaced();
    try {
      const result = await run("zypper", ["needs-rebooting"], { ok: [0, 102], quiet: true });
      rebootRequired = result.code === 102;
    } catch {
      /* older zypper */
    }
    return { items, rebootRequired };
  },

  async install({ job, ids, committing }) {
    const rolling = detect().rolling === true;
    const args = rolling
      ? ["--non-interactive", "dup", "--auto-agree-with-licenses"]
      : ["--non-interactive", "update", "--auto-agree-with-licenses", ...(ids ?? [])];
    job.set({ phase: "downloading" });
    await job.run("zypper", args, {
      onLine: (line) => {
        const step = stepOf(line);
        if (/Installing:|Removing:|Checking for file conflicts/i.test(line)) {
          committing();
          job.set({ phase: "installing" });
        }
        if (step) setStep(job, step, line.replace(/^\s*[([][^)\]]*[)\]]\s*/, "").slice(0, 120));
      },
    });
  },
};

/* ---- pacman */

/** `pacman -Qu`: `linux 6.9.7.arch1-1 -> 6.9.8.arch1-1` */
export function parsePacmanUpdates(output: string): OsUpdateItem[] {
  const items: OsUpdateItem[] = [];
  for (const line of output.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+->\s+(\S+)/.exec(line.trim());
    if (!match || /\[ignored\]/.test(line)) continue;
    items.push(
      item({ id: match[1], name: match[1], currentVersion: match[2], newVersion: match[3], restart: KERNEL.test(match[1]) })
    );
  }
  return items;
}

const pacman: Adapter = {
  async list(run, refresh) {
    let output = "";
    if (refresh) {
      // A throwaway copy of the sync databases, which is what checkupdates
      // does. Syncing the real ones without upgrading is how Arch systems end
      // up half updated.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-pacman-"));
      try {
        fs.symlinkSync("/var/lib/pacman/local", path.join(tmp, "local"));
        await run("pacman", ["-Sy", "--dbpath", tmp, "--logfile", "/dev/null"]);
        output = (await run("pacman", ["-Qu", "--dbpath", tmp], { ok: [0, 1], quiet: true })).output;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } else {
      output = (await run("pacman", ["-Qu"], { ok: [0, 1], quiet: true })).output;
    }
    return { items: parsePacmanUpdates(output), rebootRequired: kernelReplaced() };
  },

  async install({ job, committing }) {
    job.set({ phase: "downloading" });
    await job.run("pacman", ["-Syu", "--noconfirm", "--noprogressbar", "--color", "never"], {
      onLine: (line) => {
        if (/^:: (Processing package changes|Running pre-transaction hooks)/.test(line)) {
          committing();
          job.set({ phase: "installing" });
        }
        const step = stepOf(line);
        const verb = /(upgrading|installing|reinstalling|removing)\s+(\S+)/.exec(line);
        if (step && verb) {
          committing();
          job.set({ phase: "installing" });
          setStep(job, step, `${verb[1]} ${verb[2]}`);
        }
      },
    });
  },
};

/* ---- apk */

/** `apk version -l '<'`: `openssl-3.3.1-r0  < 3.3.2-r0` */
export function parseApkVersions(output: string): OsUpdateItem[] {
  const items: OsUpdateItem[] = [];
  for (const line of output.split("\n")) {
    const match = /^(.+?)-(\d\S*)\s+<\s+(\S+)/.exec(line.trim());
    if (!match) continue;
    items.push(
      item({ id: match[1], name: match[1], currentVersion: match[2], newVersion: match[3], restart: KERNEL.test(match[1]) })
    );
  }
  return items;
}

const apk: Adapter = {
  async list(run, refresh) {
    if (refresh) await run("apk", ["update"]);
    const { output } = await run("apk", ["version", "-l", "<"], { quiet: true });
    return { items: parseApkVersions(output), rebootRequired: kernelReplaced() };
  },

  async install({ job, ids, committing }) {
    job.set({ phase: "installing" });
    await job.run("apk", ids === null ? ["upgrade", "--no-progress"] : ["add", "--upgrade", "--no-progress", ...ids], {
      onLine: (line) => {
        const step = stepOf(line);
        const verb = /(Upgrading|Installing|Purging|Replacing|Downgrading)\s+(\S+)/.exec(line);
        if (step && verb) {
          committing();
          setStep(job, step, `${verb[1]} ${verb[2]}`);
        }
      },
    });
  },
};

/* ---- windows */

const POWERSHELL = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

/*
 * The Windows Update client object is built for the threading model PowerShell
 * does not use by default. Called from the default one, reading even Windows'
 * own last scan took over two minutes on the first PC this was tried on, so
 * the scripts that use it run with -MTA.
 */
const POWERSHELL_MTA = ["-NoProfile", "-NonInteractive", "-MTA", "-ExecutionPolicy", "Bypass", "-Command"];

/*
 * Scripts write two kinds of line. "LOG <level> <text>" goes into the job log
 * as it is. Everything else is a control word for the agent (DOWNLOAD, RESULT
 * and so on) or the BEACON-JSON listing. Say flushes each line, so the
 * dashboard hears about a step when it happens rather than when the script
 * ends. The console encoding can only be set where there is a console, and a
 * scheduled task has none, so that is allowed to fail.
 */
const WINDOWS_COMMON = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Say([string]$text) { [Console]::Out.WriteLine($text); [Console]::Out.Flush() }
function Log([string]$level, [string]$text) { Say ('LOG ' + $level + ' ' + $text) }
function Describe($err) { '{0} (0x{1:X8})' -f $err.Exception.Message, $err.Exception.HResult }
function Seconds($since) { [int]((Get-Date) - $since).TotalSeconds }
function Pending-Reboot {
  if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { return $true }
  if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { return $true }
  return $false
}
function Emit-List($items, [bool]$reboot) {
  Say ('BEACON-JSON ' + (ConvertTo-Json -Compress -Depth 4 @{ items = @($items); reboot = $reboot }))
}
`;

const WINDOWS_COM = `${WINDOWS_COMMON}
$session = New-Object -ComObject Microsoft.Update.Session
$session.ClientApplicationID = 'Beacon'

# A search that does not name a DeploymentAction only returns regular updates.
# Optional ones, such as the monthly preview update, have to be asked for,
# which is what the second half of this query does. A Windows too old to know
# the word answers WU_E_INVALID_CRITERIA (0x80240032), and gets the plain one.
$criteriaAll = "IsInstalled=0 and IsHidden=0 and DeploymentAction='Installation' or IsInstalled=0 and IsHidden=0 and DeploymentAction='OptionalInstallation'"
function Run-Search($searcher) {
  try { return ,($searcher.Search($criteriaAll).Updates) }
  catch {
    if ($_.Exception.HResult -ne -2145124302) { throw }
    Log WARN 'This Windows cannot list optional updates, searching without them'
    return ,($searcher.Search('IsInstalled=0 and IsHidden=0').Updates)
  }
}

function Read-LastScan {
  $started = Get-Date
  $searcher = $session.CreateUpdateSearcher()
  $searcher.Online = $false
  $found = Run-Search $searcher
  Log INFO ('Read the last scan in ' + (Seconds $started) + 's: ' + $found.Count + ' update(s)')
  return ,$found
}

# What decides whether an online search can work, written to the log first so
# a failure can be explained from the log alone.
function Log-Setup {
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    Log INFO ('System: ' + $os.Caption + ', build ' + $os.BuildNumber)
  } catch { }
  $policy = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate'
  $server = (Get-ItemProperty -Path $policy -ErrorAction SilentlyContinue).WUServer
  $useServer = (Get-ItemProperty -Path ($policy + '\\AU') -ErrorAction SilentlyContinue).UseWUServer
  if ($server -and $useServer -eq 1) { Log INFO ('Update server set by policy: ' + $server) }
  else { Log INFO 'Update server: Microsoft (no policy)' }
  if ((Get-ItemProperty -Path $policy -ErrorAction SilentlyContinue).DoNotConnectToWindowsUpdateInternetLocations -eq 1) {
    Log WARN 'A policy blocks Windows Update on the internet'
  }
  try {
    $proxy = ((netsh winhttp show proxy) -join ' ') -replace '\\s+', ' '
    Log INFO ('System proxy: ' + $proxy.Trim())
  } catch { }
}

# Tries the update sources one after the other: the one Windows itself uses
# for automatic updates (which is what Settings asks), Windows Update, then
# whatever the client picks by default.
function Search-Online {
  Log-Setup
  $attempts = @()
  try {
    $manager = New-Object -ComObject Microsoft.Update.ServiceManager
    foreach ($service in $manager.Services) {
      if ($service.IsDefaultAUService) {
        Log INFO ('Default update source: ' + $service.Name)
        $attempts += @{ name = $service.Name; selection = 3; id = $service.ServiceID }
      }
    }
  } catch { Log WARN ('Could not read the update sources: ' + (Describe $_)) }
  if (-not ($attempts | Where-Object { $_.id -eq '9482f4b4-e343-43b6-b170-9a65bc822c77' })) {
    $attempts += @{ name = 'Windows Update'; selection = 2; id = $null }
  }
  $attempts += @{ name = 'the client default'; selection = 0; id = $null }

  $lastError = $null
  foreach ($attempt in $attempts) {
    $started = Get-Date
    Log INFO ('Searching online via ' + $attempt.name)
    try {
      $searcher = $session.CreateUpdateSearcher()
      $searcher.Online = $true
      $searcher.ServerSelection = $attempt.selection
      if ($attempt.id) { $searcher.ServiceID = $attempt.id }
      $found = Run-Search $searcher
      Log INFO ('Search via ' + $attempt.name + ' finished in ' + (Seconds $started) + 's: ' + $found.Count + ' update(s)')
      return ,$found
    } catch {
      $lastError = Describe $_
      Log WARN ('Search via ' + $attempt.name + ' failed after ' + (Seconds $started) + 's: ' + $lastError)
    }
  }
  throw ('No update source answered. Last error: ' + $lastError)
}

# A property newer than this Windows reads as nothing, which is kept apart
# from 0 because 0 means something for these.
function Number-Or-Missing($value) { if ($null -eq $value) { -1 } else { [int]$value } }

function Describe-Update($u) {
  $flags = [pscustomobject]@{
    browseOnly = [bool]$u.BrowseOnly
    autoSelect = [bool]$u.AutoSelectOnWebSites
    autoSelection = Number-Or-Missing $u.AutoSelection
    autoDownload = Number-Or-Missing $u.AutoDownload
    deployment = Number-Or-Missing $u.DeploymentAction
  }
  # Written to the log, because which of these decide what Settings calls
  # optional has only ever been guessed at.
  Log OUT ($u.Title + ' | browseOnly=' + $flags.browseOnly + ' autoSelect=' + $flags.autoSelect + ' autoSelection=' + $flags.autoSelection + ' autoDownload=' + $flags.autoDownload + ' deployment=' + $flags.deployment)
  [pscustomobject]@{
    id = $u.Identity.UpdateID
    title = $u.Title
    kb = (($u.KBArticleIDs | ForEach-Object { "KB$_" }) -join ', ')
    size = [double]$u.MaxDownloadSize
    severity = [string]$u.MsrcSeverity
    categories = (($u.Categories | ForEach-Object { $_.Name }) -join '|')
    type = [int]$u.Type
    reboot = [int]$u.InstallationBehavior.RebootBehavior
    browseOnly = $flags.browseOnly
    autoSelect = $flags.autoSelect
    autoSelection = $flags.autoSelection
    autoDownload = $flags.autoDownload
    deployment = $flags.deployment
  }
}
`;

/*
 * The Windows Update service's own management interface, on Windows 10 1709
 * and later where Microsoft ships it. The service does the work in its own
 * process. Exit code 3 means this Windows does not have it.
 */
const WINDOWS_CIM = `${WINDOWS_COMMON}
$ns = 'root/Microsoft/Windows/WindowsUpdate'
try { Get-CimClass -Namespace $ns -ClassName MSFT_WUOperations | Out-Null }
catch {
  Log INFO 'No Windows Update service interface on this system, using the Windows Update client'
  Say 'BEACON-NOCIM'
  exit 3
}
function Scan-Updates([string]$criteria = 'IsInstalled=0 and IsHidden=0') {
  $scan = Invoke-CimMethod -Namespace $ns -ClassName MSFT_WUOperations -MethodName ScanForUpdates -Arguments @{ SearchCriteria = $criteria }
  if ($scan.ReturnValue -ne 0) { throw ('Windows Update answered with code 0x{0:X8}' -f $scan.ReturnValue) }
  return ,@($scan.Updates)
}
function Service-Reboot {
  try {
    $r = Invoke-CimMethod -Namespace $ns -ClassName MSFT_WUSettings -MethodName IsPendingReboot
    if ($r.PendingReboot) { return $true }
  } catch { }
  return (Pending-Reboot)
}
`;

/**
 * Lists updates through the client object. BEACON_WU_ONLINE=0 reads what
 * Windows found in its own last scan, which is quick. 1 searches online.
 */
export const WINDOWS_LIST = `${WINDOWS_COM}
try {
  if ($env:BEACON_WU_ONLINE -eq '1') { $found = Search-Online } else { $found = Read-LastScan }
  $items = @()
  foreach ($u in $found) { $items += Describe-Update $u }
  $reboot = [bool](New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired
  Emit-List $items ($reboot -or (Pending-Reboot))
} catch {
  Say ('BEACON-ERROR ' + (Describe $_))
  exit 1
}
`;

/** Lists updates by asking the Windows Update service to search. */
export const WINDOWS_CIM_LIST = `${WINDOWS_CIM}
try {
  $started = Get-Date
  Log INFO 'Searching online via the Windows Update service'
  $found = Scan-Updates
  Log INFO ('Search finished in ' + (Seconds $started) + 's: ' + $found.Count + ' update(s)')
  $items = @()
  foreach ($u in $found) {
    $items += [pscustomobject]@{
      id = [string]$u.UpdateID
      title = [string]$u.Title
      kb = (($u.KBArticleID | Where-Object { $_ } | ForEach-Object { "KB$_" }) -join ', ')
      size = 0
      severity = [string]$u.MsrcSeverity
      categories = ''
      type = 1
      reboot = 0
    }
  }
  Emit-List $items (Service-Reboot)
} catch {
  Say ('BEACON-ERROR ' + (Describe $_))
  exit 1
}
`;

/*
 * Updates are downloaded and then installed one at a time, which is slower than
 * one batch but is the only way a script gets to say where it is. The updates
 * are looked up in Windows' last scan, which is what the list on the dashboard
 * came from, and only searched for online when something is missing there.
 * "All" means what Windows would install by itself, as in Settings, so
 * optional updates are left out of it.
 */
export const WINDOWS_INSTALL = `${WINDOWS_COM}
try {
  Say 'PHASE checking'
  $wanted = $env:BEACON_UPDATE_IDS
  $ids = @($wanted -split ',')
  function Pick($updates) {
    $out = New-Object System.Collections.ArrayList
    foreach ($u in $updates) {
      # Only used without a listing to go by. With one, the agent names the
      # updates itself, using the same rule the dashboard shows.
      $recommended = (-not $u.BrowseOnly) -and ($u.DeploymentAction -ne 4)
      if (($wanted -eq 'all' -and $recommended) -or ($ids -contains $u.Identity.UpdateID)) { [void]$out.Add($u) }
    }
    return ,$out
  }
  $list = Pick (Read-LastScan)
  if ($list.Count -eq 0 -or ($wanted -ne 'all' -and $list.Count -lt $ids.Count)) {
    Log INFO 'The last scan does not have every chosen update'
    $list = Pick (Search-Online)
  }
  $n = $list.Count
  if ($n -eq 0) { Say 'NOTHING'; exit 0 }
  Log INFO ('Installing ' + $n + ' update(s)')
  $downloaded = @{}
  for ($i = 0; $i -lt $n; $i++) {
    $u = $list[$i]
    if (-not $u.EulaAccepted) { $u.AcceptEula() }
    Say ('DOWNLOAD ' + ($i + 1) + ' ' + $n + ' ' + $u.Title)
    if ($u.IsDownloaded) { $downloaded[$i] = $true; continue }
    $started = Get-Date
    $c = New-Object -ComObject Microsoft.Update.UpdateColl
    [void]$c.Add($u)
    $d = $session.CreateUpdateDownloader()
    $d.Updates = $c
    $r = $d.Download()
    $downloaded[$i] = ($r.ResultCode -eq 2 -or $r.ResultCode -eq 3)
    if ($downloaded[$i]) { Log INFO ('Downloaded in ' + (Seconds $started) + 's') }
    else {
      Log ERROR ('Download failed with result ' + $r.ResultCode + ' (0x{0:X8})' -f $r.HResult)
      Say ('RESULT ' + ($i + 1) + ' ' + $r.ResultCode + ' ' + $u.Title)
    }
  }
  Say 'COMMIT'
  $reboot = $false
  for ($i = 0; $i -lt $n; $i++) {
    if (-not $downloaded[$i]) { continue }
    $u = $list[$i]
    Say ('INSTALL ' + ($i + 1) + ' ' + $n + ' ' + $u.Title)
    $c = New-Object -ComObject Microsoft.Update.UpdateColl
    [void]$c.Add($u)
    $inst = $session.CreateUpdateInstaller()
    $inst.Updates = $c
    $r = $inst.Install()
    if ($r.RebootRequired) { $reboot = $true }
    if ($r.ResultCode -ne 2 -and $r.ResultCode -ne 3) { Log ERROR ('Install failed (0x{0:X8})' -f $r.HResult) }
    Say ('RESULT ' + ($i + 1) + ' ' + $r.ResultCode + ' ' + $u.Title)
  }
  Say ('REBOOT ' + ($reboot -or (Pending-Reboot)))
} catch {
  Say ('BEACON-ERROR ' + (Describe $_))
  exit 1
}
`;

/*
 * The same through the service. Where it offers a separate download, that is
 * used so the two phases still show. Where it does not, installing downloads
 * as it goes.
 */
export const WINDOWS_CIM_INSTALL = `${WINDOWS_CIM}
try {
  Say 'PHASE checking'
  $wanted = $env:BEACON_UPDATE_IDS
  $ids = @($wanted -split ',')
  Log INFO 'Looking up the chosen updates via the Windows Update service'
  if ($wanted -eq 'all') { $list = @(Scan-Updates 'IsInstalled=0 and IsHidden=0 and BrowseOnly=0 and AutoSelectOnWebSites=1') }
  else { $list = @(Scan-Updates | Where-Object { $ids -contains [string]$_.UpdateID }) }
  $n = $list.Count
  if ($n -eq 0) { Say 'NOTHING'; exit 0 }
  Log INFO ('Installing ' + $n + ' update(s)')
  $downloaded = @{}
  for ($i = 0; $i -lt $n; $i++) {
    $u = $list[$i]
    Say ('DOWNLOAD ' + ($i + 1) + ' ' + $n + ' ' + $u.Title)
    try {
      $r = Invoke-CimMethod -Namespace $ns -ClassName MSFT_WUOperations -MethodName DownloadUpdates -Arguments @{ Updates = [ciminstance[]]@($u) }
      $downloaded[$i] = ($r.ReturnValue -eq 0)
      if (-not $downloaded[$i]) {
        Log ERROR ('Download failed (0x{0:X8})' -f $r.ReturnValue)
        Say ('RESULT ' + ($i + 1) + ' 4 ' + $u.Title)
      }
    } catch {
      # No separate download on this Windows. Installing fetches it instead.
      $downloaded[$i] = $true
    }
  }
  Say 'COMMIT'
  $reboot = $false
  for ($i = 0; $i -lt $n; $i++) {
    if (-not $downloaded[$i]) { continue }
    $u = $list[$i]
    Say ('INSTALL ' + ($i + 1) + ' ' + $n + ' ' + $u.Title)
    $r = Invoke-CimMethod -Namespace $ns -ClassName MSFT_WUOperations -MethodName InstallUpdates -Arguments @{ Updates = [ciminstance[]]@($u) }
    if ($r.RebootRequired) { $reboot = $true }
    if ($r.ReturnValue -eq 0) { $code = 2 } else { $code = 4; Log ERROR ('Install failed (0x{0:X8})' -f $r.ReturnValue) }
    Say ('RESULT ' + ($i + 1) + ' ' + $code + ' ' + $u.Title)
  }
  Say ('REBOOT ' + ($reboot -or (Service-Reboot)))
} catch {
  Say ('BEACON-ERROR ' + (Describe $_))
  exit 1
}
`;

const WINDOWS_RESULT: Record<string, string> = {
  "0": "Not started",
  "1": "Still in progress",
  "2": "Installed",
  "3": "Installed with errors",
  "4": "Failed",
  "5": "Aborted",
};

interface WindowsEntry {
  id: string;
  title: string;
  kb: string;
  size: number;
  severity: string;
  categories: string;
  type: number;
  reboot: number;
  browseOnly?: boolean;
  /** Windows would pick it by itself. Settings shows the rest as optional. */
  autoSelect?: boolean;
  /** AutoSelectMode: 0 Windows decides, 1 if downloaded, 2 never, 3 always. -1 unknown. */
  autoSelection?: number;
  /** AutoDownloadMode: 0 Windows decides, 1 never, 2 always. -1 unknown. */
  autoDownload?: number;
  /** DeploymentAction: 1 install, 4 optional install. -1 unknown. */
  deployment?: number;
}

/**
 * What Settings would not list under its main updates. Optional installs
 * (preview updates) and browse-only ones say so outright. Defender definitions
 * install on their own and Settings never shows them. For the rest, the flags
 * that say Windows will not pick an update by itself make it optional, unless
 * another flag says it always will.
 */
function windowsOptional(entry: WindowsEntry, driver: boolean, definitions: boolean, noCategories: boolean): boolean {
  if (entry.browseOnly === true || entry.deployment === 4 || definitions) return true;
  if (entry.autoSelect === undefined) return noCategories && driver;
  const always = entry.autoSelection === 3 || entry.autoDownload === 2;
  if (always) return false;
  return entry.autoSelection === 2 || entry.autoDownload === 1 || entry.autoSelect === false;
}

/** The JSON line the listing script prints, or its error. */
export function parseWindowsList(output: string): Listing {
  const json = output.split("\n").find((line) => line.startsWith("BEACON-JSON "));
  if (!json) {
    const error = output.split("\n").find((line) => line.startsWith("BEACON-ERROR "));
    throw new Error(error ? error.slice(13).trim() : "Windows Update gave no answer.");
  }
  const parsed = JSON.parse(json.slice(12)) as { items: WindowsEntry[] | WindowsEntry; reboot: boolean };
  const entries = Array.isArray(parsed.items) ? parsed.items : parsed.items ? [parsed.items] : [];
  const items = entries.map((entry) => {
    // The service interface gives no categories, so the title stands in:
    // drivers read "Maker - Class - 1.2.3", definitions name themselves.
    const categories = entry.categories ? entry.categories.split("|") : [];
    const title = entry.title ?? "";
    const driver =
      entry.type === 2 || categories.includes("Drivers") || (categories.length === 0 && /^.+ - .+ - [\d.]+$/.test(title));
    const definitions =
      categories.some((name) => /Definition/i.test(name)) || /Security Intelligence Update|Definition Update/i.test(title);
    return item({
      id: entry.id,
      name: title,
      title: entry.kb || null,
      // A definitions package reports the full download, where Windows only
      // ever fetches a small difference, so its size would mislead.
      sizeBytes: entry.size > 0 && !definitions ? entry.size : null,
      security: categories.includes("Security Updates") || (!definitions && entry.severity !== "" && entry.severity !== null),
      restart: entry.reboot === 1 || /Cumulative Update/i.test(title),
      kind: driver ? "driver" : definitions ? "other" : "system",
      // Windows says so where it can. The service interface does not, and the
      // drivers it lists are the ones Settings keeps under Optional updates.
      optional: windowsOptional(entry, driver, definitions, categories.length === 0),
    });
  });
  return { items, rebootRequired: parsed.reboot === true };
}

/** Exit code of the service scripts when this Windows does not have the interface. */
const NO_CIM = 3;

/**
 * Whether this PC has the Windows Update service interface. Learned on first
 * use and kept, so an older Windows is not asked again on every check.
 */
let windowsService: boolean | null = null;

async function withService<T>(useService: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (windowsService === false) return fallback();
  try {
    const result = await useService();
    windowsService = true;
    return result;
  } catch (error) {
    if (!(error instanceof ExitError) || error.code !== NO_CIM) throw error;
    windowsService = false;
    return fallback();
  }
}

const windows: Adapter = {
  async list(run, refresh) {
    const listWith = async (script: string, args: string[], online: boolean) => {
      const { output } = await run("powershell.exe", [...args, script], {
        env: { BEACON_WU_ONLINE: online ? "1" : "0" },
        quiet: true,
        waiting: online ? "Still searching online" : "Still reading the last scan",
        timeoutMs: (online ? 30 : 3) * 60_000,
      });
      return parseWindowsList(output);
    };
    // Windows' own last scan is only reachable through the client object.
    if (!refresh) return listWith(WINDOWS_LIST, POWERSHELL_MTA, false);
    return withService(
      () => listWith(WINDOWS_CIM_LIST, POWERSHELL, true),
      () => listWith(WINDOWS_LIST, POWERSHELL_MTA, true)
    );
  },

  async install(context) {
    await withService(
      () => windowsInstall(context, WINDOWS_CIM_INSTALL, POWERSHELL),
      () => windowsInstall(context, WINDOWS_INSTALL, POWERSHELL_MTA)
    );
  },
};

async function windowsInstall({ job, ids, committing }: InstallContext, script: string, args: string[]) {
  {
    let reboot = false;
    job.set({ phase: "checking" });
    await job.run("powershell.exe", [...args, script], {
      env: { BEACON_UPDATE_IDS: ids === null ? "all" : ids.join(",") },
      quiet: true,
      waiting: "Still working. Large updates can take a while",
      onLine: (line) => {
        const [word, ...rest] = line.split(" ");
        if (word === "PHASE") {
          job.set({ phase: "checking", current: "Looking up the chosen updates" });
        } else if (word === "DOWNLOAD") {
          const [done, total, ...title] = rest;
          job.set({ phase: "downloading" });
          setStep(job, { done: Number(done) - 1, total: Number(total) }, title.join(" "));
          job.line(`Downloading ${done}/${total}: ${title.join(" ")}`);
        } else if (word === "COMMIT") {
          committing();
        } else if (word === "INSTALL") {
          const [done, total, ...title] = rest;
          committing();
          job.set({ phase: "installing" });
          setStep(job, { done: Number(done) - 1, total: Number(total) }, title.join(" "));
          job.line(`Installing ${done}/${total}: ${title.join(" ")}`);
        } else if (word === "RESULT") {
          const [done, code, ...title] = rest;
          const ok = code === "2" || code === "3";
          job.snapshot.results.push({ name: title.join(" "), ok, message: WINDOWS_RESULT[code] ?? `Result ${code}` });
          if (job.snapshot.stepTotal) {
            setStep(job, { done: Number(done), total: job.snapshot.stepTotal }, null);
          }
          job.line(`${WINDOWS_RESULT[code] ?? `Result ${code}`}: ${title.join(" ")}`, ok ? "INFO" : "ERROR");
        } else if (word === "REBOOT") {
          reboot = rest[0] === "True";
        } else if (word === "BEACON-NOCIM") {
          // Handled by the caller, which falls back to the client object.
        } else if (word === "NOTHING") {
          job.line("Nothing left to install");
        } else if (word === "BEACON-ERROR") {
          job.line(`Windows Update: ${rest.join(" ")}`, "ERROR");
        } else {
          job.line(line, "OUT");
        }
      },
    });
    if (reboot) job.set({ rebootRequired: true });
  }
}

/* ---- macOS */

export function parseSoftwareUpdate(output: string): OsUpdateItem[] {
  const items: OsUpdateItem[] = [];
  const lines = output.split("\n");
  for (let index = 0; index < lines.length; index++) {
    // Catalina and later: "* Label: Safari17.5VenturaAuto-17.5"
    const label = /^\s*\*\s+Label:\s*(.+)$/.exec(lines[index]);
    if (label) {
      const details = lines[index + 1] ?? "";
      const field = (key: string) => new RegExp(`${key}:\\s*([^,]+)`).exec(details)?.[1]?.trim() ?? null;
      const title = field("Title") ?? label[1];
      const size = field("Size");
      const kib = size ? Number(size.replace(/[^\d.]/g, "")) : NaN;
      items.push(
        item({
          id: label[1].trim(),
          name: title,
          newVersion: field("Version"),
          sizeBytes: Number.isFinite(kib) ? Math.round(kib * 1024) : null,
          restart: /Action:\s*restart/i.test(details),
          kind: /^macOS/i.test(title) ? "system" : "other",
          security: /security/i.test(title),
        })
      );
      continue;
    }
    // Older releases: "   * Safari12.1-12.1" then "\tSafari (12.1), 64960K [recommended]"
    const old = /^\s+\*\s+(\S.*)$/.exec(lines[index]);
    const details = lines[index + 1] ?? "";
    const oldDetails = /^\t(.+?)\s+\(([^)]+)\),\s+(\d+)K/.exec(details);
    if (old && oldDetails) {
      items.push(
        item({
          id: old[1].trim(),
          name: oldDetails[1],
          newVersion: oldDetails[2],
          sizeBytes: Number(oldDetails[3]) * 1024,
          restart: /\[restart\]/i.test(details),
          kind: /^macOS/i.test(oldDetails[1]) ? "system" : "other",
        })
      );
    }
  }
  return items;
}

const macos: Adapter = {
  async list(run) {
    const { output } = await run("softwareupdate", ["--list"], { quiet: true });
    return { items: parseSoftwareUpdate(output), rebootRequired: false };
  },

  async install({ job, ids, committing }) {
    // --agree-to-license arrived with Big Sur (Darwin 20).
    const major = Number(os.release().split(".")[0]);
    const listed = inventory?.items ?? [];
    const args = [
      "--install",
      ...(ids === null ? ["--all"] : ids),
      ...(major >= 20 ? ["--agree-to-license"] : []),
    ];
    job.set({ phase: "downloading" });
    await job.run("softwareupdate", args, {
      onLine: (line) => {
        const percent = /(\d+(?:\.\d+)?)%/.exec(line);
        if (/^Downloading/i.test(line)) {
          job.set({ phase: "downloading", current: line.replace(/:\s*[\d.]+%.*$/, "") });
        }
        if (/^(Installing|Preparing)/i.test(line)) {
          committing();
          job.set({ phase: "installing", current: line });
        }
        if (/^Done with/i.test(line)) {
          const name = line.replace(/^Done with\s*/i, "");
          job.snapshot.results.push({ name, ok: true, message: "Installed" });
        }
        if (percent) job.set({ progress: Number(percent[1]) });
      },
    });
    const restart = listed.some((entry) => entry.restart && (ids === null || ids.includes(entry.id)));
    if (restart) job.set({ rebootRequired: true });
  },
};

function adapterFor(manager: OsUpdateManager): Adapter {
  switch (manager) {
    case "apt":
      return apt;
    case "dnf":
      return dnfAdapter(() => (which("dnf") ? "dnf" : "dnf5"));
    case "yum":
      return dnfAdapter(() => "yum");
    case "zypper":
      return zypper;
    case "pacman":
      return pacman;
    case "apk":
      return apk;
    case "windows":
      return windows;
    case "macos":
      return macos;
  }
}

/* -------------------------------------------------------------- the module */

let current: Job | null = null;
let last: Job | null = null;
let inventory: OsUpdateInventory | null = null;

function inventoryFrom(listing: Listing | null, error?: string): OsUpdateInventory {
  const info = detect();
  return {
    supported: info.manager !== null,
    reason: info.reason ?? error ?? null,
    manager: info.manager,
    checkedAt: listing ? Date.now() : (inventory?.checkedAt ?? null),
    items: listing ? listing.items : (inventory?.items ?? []),
    rebootRequired: listing ? listing.rebootRequired : (inventory?.rebootRequired ?? false),
    canSelect: info.canSelect,
    notes: info.notes,
  };
}

export function osUpdatesBusy(): boolean {
  return current !== null;
}

export function osUpdateStatus(): OsUpdateStatusResult {
  const job = current ?? last;
  return {
    job: job ? { ...job.snapshot, results: [...job.snapshot.results] } : null,
    log: job ? job.log.slice(-1000) : [],
    // A device that can never be updated says why straight away, rather than
    // after its first background check.
    inventory: inventory ?? (detect().manager ? null : inventoryFrom(null)),
  };
}

function begin(id: string, kind: OsUpdateJobKind, emit: OsUpdateEmit): Job {
  if (current) throw new Error("Another update job is still running on this device.");
  const job = new Job(id, kind, emit);
  current = job;
  job.flush();
  return job;
}

function end(job: Job): void {
  if (current === job) current = null;
  last = job;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A check someone asked for, with its log. */
export function startCheck(jobId: string, emit: OsUpdateEmit): void {
  const info = detect();
  if (!info.manager) throw new Error(info.reason ?? "Updates are not supported here.");
  const adapter = adapterFor(info.manager);
  const job = begin(jobId, "check", emit);
  job.set({ phase: "checking", current: "Looking for updates" });
  job.line(`Check started, using ${OS_UPDATE_MANAGER_LABELS[info.manager]}`);

  void (async () => {
    try {
      if (info.manager === "windows") {
        // What Windows found on its own comes back at once, so the list is
        // filled in while the slow online search runs.
        try {
          const quick = await adapter.list(job.run, false);
          inventory = inventoryFrom(quick);
          job.line(`Last scan lists ${quick.items.length} update${quick.items.length === 1 ? "" : "s"}, searching online for newer ones`);
          job.flush(inventory);
        } catch (error) {
          if (error instanceof CancelledError) throw error;
          job.line(`Could not read the last scan: ${describe(error)}`, "WARN");
        }
        job.set({ current: "Asking Windows Update. The first search on a PC can take 10 minutes or more." });
      }
      const listing = await adapter.list(job.run, true);
      inventory = inventoryFrom(listing);
      const optional = listing.items.filter((entry) => entry.optional).length;
      const needed = listing.items.length - optional;
      job.line(
        `Check finished in ${Math.round((Date.now() - job.snapshot.startedAt) / 1000)}s: ` +
          (needed === 0 ? "up to date" : `${needed} update${needed === 1 ? "" : "s"} available`) +
          (optional > 0 ? `, ${optional} optional` : "") +
          (listing.rebootRequired ? ", restart pending" : "")
      );
      job.set({ rebootRequired: listing.rebootRequired });
      end(job);
      job.finish("succeeded", null, inventory);
    } catch (error) {
      end(job);
      if (error instanceof CancelledError) job.finish("cancelled", null);
      else {
        job.line(`Check failed: ${describe(error)}`, "ERROR");
        job.finish("failed", describe(error));
      }
    }
  })();
}

export function startInstall(params: OsUpdateInstallParams, emit: OsUpdateEmit): void {
  const info = detect();
  if (!info.manager) throw new Error(info.reason ?? "Updates are not supported here.");
  let ids = info.canSelect ? params.ids : null;
  // Windows has no "everything recommended" of its own that matches what the
  // dashboard lists, so "all" becomes the updates the list shows as needed.
  if (ids === null && info.manager === "windows" && inventory) {
    ids = inventory.items.filter((entry) => !entry.optional).map((entry) => entry.id);
  }
  const adapter = adapterFor(info.manager);
  const job = begin(params.jobId, "install", emit);
  job.rebootAfter = params.rebootAfter;
  job.requested = ids;

  const before = inventory?.items ?? [];
  const wanted = ids === null ? before : before.filter((entry) => ids.includes(entry.id));
  job.line(
    ids === null
      ? `Install started for all recommended updates, using ${OS_UPDATE_MANAGER_LABELS[info.manager]}`
      : `Install started for ${ids.length} selected update${ids.length === 1 ? "" : "s"}, using ${OS_UPDATE_MANAGER_LABELS[info.manager]}`
  );

  void (async () => {
    try {
      await adapter.install({
        job,
        ids,
        committing: () => {
          if (job.snapshot.cancellable) job.set({ cancellable: false });
        },
      });

      // Listing again says what actually changed, which the tools do not
      // report in any one way.
      job.set({ phase: "checking", current: "Checking what was installed", progress: null });
      let listing: Listing | null = null;
      try {
        listing = await adapter.list(job.run, false);
      } catch (error) {
        job.line(`Could not list updates afterwards: ${describe(error)}`, "WARN");
      }
      inventory = inventoryFrom(listing);

      if (info.manager !== "windows" && info.manager !== "macos" && listing) {
        const left = new Set(listing.items.map((entry) => entry.id));
        job.snapshot.results = wanted.map((entry) => ({
          name: entry.name,
          ok: !left.has(entry.id),
          message: left.has(entry.id) ? "Held back by the package manager" : `Updated to ${entry.newVersion ?? "the new version"}`,
        }));
      }
      const rebootRequired = job.snapshot.rebootRequired || (listing?.rebootRequired ?? false);
      const failed = job.snapshot.results.filter((result) => !result.ok).length;
      job.set({ rebootRequired });
      job.line(
        failed > 0
          ? `Install finished: ${failed} of ${job.snapshot.results.length} not installed`
          : `Install finished: ${job.snapshot.results.length || "all"} installed`,
        failed > 0 ? "WARN" : "INFO"
      );

      if (rebootRequired && job.rebootAfter) {
        job.set({ phase: "rebooting", current: "Restarting to finish the updates", progress: null });
        job.line("Restarting the device to finish installing");
        job.flush(inventory);
        // The job stays running on purpose. The hub closes it once the device
        // is back, which is the only way to know the restart worked.
        await restartMachine(job);
        return;
      }
      end(job);
      job.finish(failed > 0 && failed === job.snapshot.results.length ? "failed" : "succeeded", null, inventory);
    } catch (error) {
      end(job);
      if (error instanceof CancelledError) {
        job.line("Cancelled before anything was installed", "WARN");
        job.finish("cancelled", null);
        return;
      }
      job.line(`Install failed: ${describe(error)}`, "ERROR");
      // What did get installed is still worth knowing.
      try {
        inventory = inventoryFrom(await adapter.list(quietRun, false));
      } catch {
        /* keep the old listing */
      }
      job.finish("failed", describe(error), inventory ?? undefined);
    }
  })();
}

export function startReboot(jobId: string, emit: OsUpdateEmit): void {
  const job = begin(jobId, "reboot", emit);
  job.set({ phase: "rebooting", current: "Restarting", cancellable: false });
  job.line("Restart requested from the dashboard");
  job.flush();
  void restartMachine(job);
}

async function restartMachine(job: Job): Promise<void> {
  // Long enough for the event above to reach the hub before the network goes.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const attempts: [string, string[]][] =
    process.platform === "win32"
      ? [["shutdown.exe", ["/r", "/t", "5", "/d", "p:0:0", "/c", "Restart requested from the Beacon dashboard"]]]
      : process.platform === "darwin"
        ? [["shutdown", ["-r", "now"]]]
        : [
            ["systemctl", ["reboot"]],
            ["shutdown", ["-r", "now"]],
            ["reboot", []],
          ];
  let lastError = "";
  for (const [command, args] of attempts) {
    try {
      await quietRun(command, args);
      job.line(`${command} accepted the restart`);
      job.flush();
      // Still here ten minutes later means the restart was called off, perhaps
      // by someone at the machine. Say so rather than stay busy forever.
      setTimeout(() => {
        if (current !== job) return;
        end(job);
        job.line("The device did not restart within 10 minutes", "ERROR");
        job.finish("failed", "The device accepted the restart but did not go down.");
      }, 10 * 60_000).unref();
      return;
    } catch (error) {
      lastError = describe(error);
    }
  }
  end(job);
  job.line(`Could not restart: ${lastError}`, "ERROR");
  job.finish("failed", `The device refused to restart: ${lastError}`);
}

/** Stops a job, but only while nothing has been changed on the system yet. */
export function cancelJob(jobId: string): void {
  if (!current || current.snapshot.id !== jobId) throw new Error("That job is not running.");
  if (!current.snapshot.cancellable) {
    throw new Error("Updates are being installed now. Stopping part way could leave the system broken.");
  }
  current.line("Cancel requested", "WARN");
  current.stop();
}

/**
 * The check the agent runs on its own, a few minutes after starting and then
 * every few hours, so the dashboard can say updates are waiting without anyone
 * asking first. It keeps out of the way of any job someone started.
 */
export async function backgroundCheck(): Promise<OsUpdateInventory | null> {
  if (current) return null;
  const info = detect();
  if (!info.manager) {
    inventory = inventoryFrom(null);
    return inventory;
  }
  try {
    // On Windows the background check reads Windows' own last scan, which is
    // cheap. Searching online every few hours would keep the PC busy.
    inventory = inventoryFrom(await adapterFor(info.manager).list(quietRun, info.manager !== "windows"));
  } catch (error) {
    inventory = { ...inventoryFrom(null), reason: `The last check failed: ${describe(error)}` };
  }
  return inventory;
}
