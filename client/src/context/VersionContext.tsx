import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isNewer, type VersionDto } from "@beacon/shared";
import { api } from "@/lib/api";
import { useAuth } from "./AuthContext";

interface VersionValue {
  info: VersionDto | null;
  /** The version this page was loaded from. */
  appVersion: string;
  /**
   * True when the hub has been upgraded since this page was loaded. Everything
   * on screen is then from the previous build, which is how a stale tab ends up
   * showing a version that disagrees with the hub.
   */
  needsReload: boolean;
  checking: boolean;
  /** Ask the hub to refresh its release information now. */
  check: () => Promise<void>;
  reload: () => Promise<void>;
  /** True when this agent version is behind the newest release. */
  isAgentOutdated: (agentVersion: string | null | undefined) => boolean;
}

const VersionContext = createContext<VersionValue | null>(null);

export function VersionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  // Keyed on the user rather than the session object, which is replaced every
  // time a preference is saved and would otherwise restart the reads below.
  const userId = session?.user.id ?? null;
  const [info, setInfo] = useState<VersionDto | null>(null);
  const [checking, setChecking] = useState(false);

  /** Reads what the hub already knows. This never reaches the release feed. */
  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      setInfo(await api.version());
    } catch {
      /* the badge simply stays hidden */
    }
  }, [userId]);

  /*
   * Loading the dashboard only reads. The release feed is asked by the hub's
   * own schedule, by an admin signing in and by the Check now button, so
   * reloads and page changes never cost a request against its rate limit.
   */
  useEffect(() => {
    if (!userId) return;
    void reload();
    // An admin's sign-in starts a check on the hub, and this picks up its answer.
    const settle = window.setTimeout(() => void reload(), 8000);
    const timer = window.setInterval(() => void reload(), 3600_000);
    return () => {
      window.clearTimeout(settle);
      window.clearInterval(timer);
    };
  }, [userId, reload]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setInfo(await api.checkVersion());
    } finally {
      setChecking(false);
    }
  }, []);

  const isAgentOutdated = useCallback(
    (agentVersion: string | null | undefined) => {
      if (!agentVersion || !info) return false;
      // Compare against the newest thing we know about: a published release if
      // there is one, otherwise the hub's own version.
      const target = info.latest && isNewer(info.latest.version, info.current) ? info.latest.version : info.current;
      return isNewer(target, agentVersion);
    },
    [info]
  );

  const needsReload = Boolean(info && info.current !== __APP_VERSION__);

  const value = useMemo<VersionValue>(
    () => ({ info, appVersion: __APP_VERSION__, needsReload, checking, check, reload, isAgentOutdated }),
    [info, needsReload, checking, check, reload, isAgentOutdated]
  );

  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

export function useVersion(): VersionValue {
  const context = useContext(VersionContext);
  if (!context) throw new Error("useVersion must be used inside VersionProvider");
  return context;
}
