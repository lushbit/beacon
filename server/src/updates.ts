import { BEACON_VERSION, isNewer, PROTOCOL_VERSION } from "@beacon/shared";
import type { ReleaseInfo, VersionDto } from "@beacon/shared";
import { getSetting, setSetting } from "./db/index.js";
import { getServerSettings } from "./settings.js";
import { logger } from "./utils/log.js";

const log = logger("updates");

/**
 * Where to look for new releases. Defaults to the project's own repository and
 * can be pointed elsewhere (a fork, or an internal mirror) without a rebuild.
 */
const REPO = process.env.BEACON_UPDATE_REPO || "lushbit/beacon";
const FEED = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAG_FEED = (version: string) => `https://api.github.com/repos/${REPO}/releases/tags/v${version}`;
const CHECK_INTERVAL_MS = 6 * 3600_000;
/**
 * Floor for a check triggered by someone signing in. Without it, a busy
 * dashboard would hit the release feed on every sign-in and run into the
 * unauthenticated rate limit.
 */
export const LOGIN_CHECK_MAX_AGE_MS = 15 * 60_000;
const TIMEOUT_MS = 8000;

interface CachedCheck {
  latest: ReleaseInfo | null;
  checkedAt: number | null;
  error: string | null;
}

const EMPTY: CachedCheck = { latest: null, checkedAt: null, error: null };

function load(): CachedCheck {
  return { ...EMPTY, ...getSetting<Partial<CachedCheck>>("updateCheck", {}) };
}

function save(value: CachedCheck): void {
  setSetting("updateCheck", value);
}

/**
 * Notes for the version this hub is actually running. The newest release cannot
 * answer that once the two differ, and the dashboard needs it to show what
 * changed after an update.
 */
interface CachedInstalled {
  /** The hub version these notes belong to. Anything else is stale. */
  version: string;
  release: ReleaseInfo | null;
  checkedAt: number;
}

function loadInstalled(): ReleaseInfo | null {
  const cached = getSetting<CachedInstalled | null>("installedRelease", null);
  return cached && cached.version === BEACON_VERSION ? cached.release : null;
}

function saveInstalled(release: ReleaseInfo | null): void {
  setSetting("installedRelease", { version: BEACON_VERSION, release, checkedAt: Date.now() } satisfies CachedInstalled);
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

function toReleaseInfo(release: GithubRelease, version: string): ReleaseInfo {
  return {
    version,
    url: release.html_url ?? "",
    publishedAt: release.published_at ? Date.parse(release.published_at) : null,
    notes: (release.body ?? "").slice(0, 4000),
  };
}

/**
 * Fetched once per hub version and then remembered, so this costs one request
 * after an update and nothing at all afterwards.
 */
export async function refreshInstalledRelease(): Promise<void> {
  // Turning update checks off means this hub does not reach out, and that has
  // to hold for these notes too.
  if (!getServerSettings().updateChecks) return;

  const cached = getSetting<CachedInstalled | null>("installedRelease", null);
  if (cached && cached.version === BEACON_VERSION) return;

  // The newest release is often the installed one, and then no request is needed.
  const check = load();
  if (check.latest && check.latest.version === BEACON_VERSION) {
    saveInstalled(check.latest);
    return;
  }

  try {
    const response = await fetch(TAG_FEED(BEACON_VERSION), {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `beacon/${BEACON_VERSION}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A build with no matching release, a fork, or a source checkout: remember
    // that there is nothing to show rather than asking again every few hours.
    if (response.status === 404) {
      saveInstalled(null);
      return;
    }
    if (!response.ok) return;
    const release = (await response.json()) as GithubRelease;
    saveInstalled(toReleaseInfo(release, BEACON_VERSION));
  } catch {
    /* the next check tries again */
  }
}

export function versionInfo(): VersionDto {
  const cached = load();
  const checksEnabled = getServerSettings().updateChecks;
  return {
    current: BEACON_VERSION,
    protocol: PROTOCOL_VERSION,
    sourceUrl: `https://github.com/${REPO}`,
    latest: cached.latest,
    installed: loadInstalled(),
    updateAvailable: Boolean(cached.latest && isNewer(cached.latest.version, BEACON_VERSION)),
    checkedAt: cached.checkedAt,
    checksEnabled,
    error: cached.error,
  };
}

/** Never throws: a failed check is recorded and surfaced, not fatal. */
export async function checkForUpdates(force = false, maxAgeMs = CHECK_INTERVAL_MS): Promise<VersionDto> {
  const settings = getServerSettings();
  if (!settings.updateChecks && !force) return versionInfo();

  const cached = load();
  if (!force && cached.checkedAt && Date.now() - cached.checkedAt < maxAgeMs) {
    return versionInfo();
  }

  try {
    const response = await fetch(FEED, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `beacon/${BEACON_VERSION}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // A private or release-less repository answers 404; that is not an error
      // worth shouting about, just a check that cannot say anything useful.
      const reason = response.status === 404 ? "No published releases found." : `Release feed returned ${response.status}.`;
      save({ ...cached, checkedAt: Date.now(), error: reason });
      return versionInfo();
    }

    const release = (await response.json()) as GithubRelease;
    if (release.draft) {
      save({ ...cached, checkedAt: Date.now(), error: null });
      return versionInfo();
    }

    const version = (release.tag_name ?? release.name ?? "").trim().replace(/^v/i, "");
    if (!version) {
      save({ ...cached, checkedAt: Date.now(), error: "Release feed had no version tag." });
      return versionInfo();
    }

    const latest = toReleaseInfo(release, version);
    save({ latest, checkedAt: Date.now(), error: null });

    if (isNewer(version, BEACON_VERSION)) log.info(`update available: ${BEACON_VERSION} -> ${version}`);
    await refreshInstalledRelease();
    return versionInfo();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    save({ ...cached, checkedAt: Date.now(), error: `Could not reach the release feed: ${message}` });
    return versionInfo();
  }
}

/**
 * Refreshes the release information after a sign-in, without making anyone wait
 * for it. Rate limited by `LOGIN_CHECK_MAX_AGE_MS`.
 */
export function checkForUpdatesOnLogin(): void {
  void checkForUpdates(false, LOGIN_CHECK_MAX_AGE_MS).catch(() => undefined);
}

export function startUpdateChecks(): void {
  const run = () => {
    void checkForUpdates()
      .then(() => refreshInstalledRelease())
      .catch(() => undefined);
  };
  // Give the hub a moment to finish starting before reaching out.
  setTimeout(run, 15_000).unref();
  setInterval(run, CHECK_INTERVAL_MS).unref();
}
