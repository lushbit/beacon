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
  const isAdmin = session?.user.role === "admin";
  const [info, setInfo] = useState<VersionDto | null>(null);
  const [checking, setChecking] = useState(false);

  const reload = useCallback(async () => {
    if (!session) return;
    try {
      setInfo(await api.version());
    } catch {
      /* the badge simply stays hidden */
    }
  }, [session]);

  /**
   * Admins ask the hub to look at the release feed whenever the dashboard
   * loads, so a new version announces itself instead of waiting for the next
   * six-hourly check or for someone to open Settings. The hub reuses a result
   * from the last few minutes, so reloading repeatedly costs nothing, and this
   * deliberately does not touch `checking` because no button is waiting on it.
   */
  const autoCheck = useCallback(async () => {
    if (!session) return;
    try {
      setInfo(await api.checkVersion(true));
    } catch {
      /* fall back to the plain read below */
      await reload();
    }
  }, [session, reload]);

  useEffect(() => {
    if (!session) return;
    const refresh = () => (isAdmin ? autoCheck() : reload());
    void refresh();
    // Signing in also triggers a check on the hub. Readers cannot ask for one
    // themselves, so a second read picks up that result for them.
    const settle = isAdmin ? undefined : window.setTimeout(() => void reload(), 8000);
    const timer = window.setInterval(() => void refresh(), 3600_000);
    return () => {
      if (settle !== undefined) window.clearTimeout(settle);
      window.clearInterval(timer);
    };
  }, [session, isAdmin, autoCheck, reload]);

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
