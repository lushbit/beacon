import { purgeOldAttempts } from "./auth/ratelimit.js";
import { purgeExpiredSessions } from "./auth/sessions.js";
import { purgeExpiredEnrollTokens } from "./devices.js";
import { purgeOldAudit } from "./audit.js";
import { sweepOfflineRules } from "./alerts/engine.js";
import { sweepScheduledUpdates } from "./agentUpdates.js";
import { onlineDeviceIds } from "./hub/agents.js";
import { pruneSamples, runRollups } from "./metrics/store.js";
import { getServerSettings } from "./settings.js";
import { logger } from "./utils/log.js";

const log = logger("jobs");

function safely(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    log.error(`job "${name}" failed`, error);
  }
}

export function startJobs(): void {
  // Offline detection has to be quick, everything else can be lazy.
  const offlineTimer = setInterval(() => {
    safely("offline-sweep", () => sweepOfflineRules(onlineDeviceIds()));
  }, 15_000);

  // Scheduled agent updates: checked often enough to catch a window opening,
  // rarely enough to be invisible.
  const updateTimer = setInterval(() => {
    safely("agent-updates", sweepScheduledUpdates);
  }, 5 * 60_000);

  const rollupTimer = setInterval(() => {
    safely("rollups", () => runRollups());
  }, 60_000);

  const maintenanceTimer = setInterval(() => {
    safely("prune-samples", () => pruneSamples(getServerSettings().retention));
    safely("purge-sessions", purgeExpiredSessions);
    safely("purge-enroll-tokens", purgeExpiredEnrollTokens);
    safely("purge-attempts", purgeOldAttempts);
    safely("purge-audit", () => purgeOldAudit(90));
  }, 3600_000);

  offlineTimer.unref();
  updateTimer.unref();
  rollupTimer.unref();
  maintenanceTimer.unref();

  // Catch up once at boot rather than waiting an hour.
  safely("rollups", () => runRollups());
  safely("prune-samples", () => pruneSamples(getServerSettings().retention));
  safely("purge-sessions", purgeExpiredSessions);

  log.info("background jobs started");
}
