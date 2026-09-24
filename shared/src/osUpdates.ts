/**
 * Operating system updates: Windows Update, softwareupdate on macOS, and the
 * package manager on Linux.
 *
 * The agent does the work and reports as it goes. The hub keeps every run as a
 * job with its log, so the Updates tab can show what is happening now and what
 * happened before, even for a run that finished while nobody was watching.
 */

/** The tool the agent drives on this device. */
export const OS_UPDATE_MANAGERS = [
  "windows",
  "macos",
  "apt",
  "dnf",
  "yum",
  "zypper",
  "pacman",
  "apk",
] as const;
export type OsUpdateManager = (typeof OS_UPDATE_MANAGERS)[number];

export const OS_UPDATE_MANAGER_LABELS: Record<OsUpdateManager, string> = {
  windows: "Windows Update",
  macos: "Software Update",
  apt: "APT",
  dnf: "DNF",
  yum: "YUM",
  zypper: "Zypper",
  pacman: "pacman",
  apk: "apk",
};

export interface OsUpdateItem {
  /** What the agent is given back to install this one: a package or an update id. */
  id: string;
  name: string;
  /** A longer title where the name alone says little, such as a KB number. */
  title: string | null;
  currentVersion: string | null;
  newVersion: string | null;
  sizeBytes: number | null;
  security: boolean;
  /** Installing it needs a restart, where the manager says so. */
  restart: boolean;
  kind: "package" | "system" | "driver" | "other";
}

export interface OsUpdateInventory {
  /** False when this device cannot be updated from the dashboard at all. */
  supported: boolean;
  /** Why not, in a sentence someone can act on. */
  reason: string | null;
  manager: OsUpdateManager | null;
  checkedAt: number | null;
  items: OsUpdateItem[];
  rebootRequired: boolean;
  /**
   * Whether single updates can be picked. Arch only upgrades everything at
   * once, because a partial upgrade is how an Arch system breaks.
   */
  canSelect: boolean;
  /** Things worth knowing about this device's updates, shown under the list. */
  notes: string[];
}

export type OsUpdateJobKind = "check" | "install" | "reboot";

/** Where a running job is. `done` is set once the job has an outcome. */
export type OsUpdatePhase = "starting" | "checking" | "downloading" | "installing" | "rebooting" | "done";

export type OsUpdateJobState = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export interface OsUpdateResult {
  name: string;
  ok: boolean;
  message: string | null;
}

/** What the agent reports about a job. The hub adds who asked and when it heard. */
export interface OsUpdateJobSnapshot {
  id: string;
  kind: OsUpdateJobKind;
  state: OsUpdateJobState;
  phase: OsUpdatePhase;
  /** 0 to 100, or null while the manager gives nothing to measure. */
  progress: number | null;
  /** What is being worked on right now, such as a package name. */
  current: string | null;
  /** Count of things done out of how many, where the manager numbers them. */
  stepDone: number | null;
  stepTotal: number | null;
  /** Only while this is true can the job still be stopped safely. */
  cancellable: boolean;
  rebootRequired: boolean;
  results: OsUpdateResult[];
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface OsUpdateJobDto extends OsUpdateJobSnapshot {
  deviceId: string;
  /** The package or update ids asked for, or null for everything. */
  requested: string[] | null;
  /** Restart on its own once the install is done, if the install needs one. */
  rebootAfter: boolean;
  actor: string;
  /** How many log lines the hub holds for this job. */
  logLines: number;
}

export interface OsUpdatesDto {
  inventory: OsUpdateInventory | null;
  /** The running job, if there is one. */
  active: OsUpdateJobDto | null;
  /** The most recent jobs, newest first, without their logs. */
  history: OsUpdateJobDto[];
  /** False for an agent too old to know about OS updates. */
  agentSupports: boolean;
  /** This device's settings allow installing and restarting from the dashboard. */
  allowed: boolean;
}

/** A short line for the device list and the tab badge. */
export interface OsUpdateSummaryDto {
  pending: number;
  security: number;
  rebootRequired: boolean;
  checkedAt: number | null;
  running: boolean;
}

/* ---------------------------------------------------------------- protocol */

export interface OsUpdateInstallParams {
  jobId: string;
  /** Item ids to install, or null for all of them. */
  ids: string[] | null;
  rebootAfter: boolean;
}

export interface OsUpdateJobParams {
  jobId: string;
}

/** Answer to `os_updates_status`, which the hub asks on every reconnect. */
export interface OsUpdateStatusResult {
  job: OsUpdateJobSnapshot | null;
  /** The job's log so far, so a hub that missed some of it can catch up. */
  log: string[];
  inventory: OsUpdateInventory | null;
}
