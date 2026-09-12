/**
 * The address people reach this dashboard at.
 *
 * A hub is reached through whatever host, port or reverse proxy the operator
 * set up, and it cannot work that out from the inside. The install commands
 * solve this by building from the address in the browser's bar, and the links
 * in notifications now do the same: every signed-in dashboard request records
 * where it came from, and alerts point back there. It is kept in the database,
 * so the links survive a restart and work even when nobody has the dashboard
 * open.
 */
import { getSetting, setSetting } from "./db/index.js";

const SETTING_KEY = "dashboardOrigin";

let cached: string | null | undefined;

export function dashboardOrigin(): string | null {
  if (cached === undefined) cached = getSetting<string | null>(SETTING_KEY, null);
  return cached;
}

/** Reached through a new address, so that is where the links should point. */
export function rememberDashboardOrigin(origin: string): void {
  if (!origin || origin === dashboardOrigin()) return;
  cached = origin;
  setSetting(SETTING_KEY, origin);
}
