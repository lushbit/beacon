import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_USER_PREFERENCES, type SessionDto, type UserPreferences } from "@beacon/shared";
import { api, ApiError, UNAUTHORIZED_EVENT } from "@/lib/api";

interface AuthValue {
  session: SessionDto | null;
  preferences: UserPreferences;
  loading: boolean;
  needsSetup: boolean;
  siteName: string;
  refresh: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  savePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [siteName, setSiteName] = useState("Beacon");

  const refresh = useCallback(async () => {
    try {
      const state = await api.setupState();
      setNeedsSetup(state.needsSetup);
      setSiteName(state.siteName);
      if (state.needsSetup) {
        setSession(null);
        return;
      }
      setSession(await api.me());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setSession(null);
      else setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 anywhere in the app drops us back to the sign-in screen.
  useEffect(() => {
    const onUnauthorized = () => setSession((current) => (current ? null : current));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    setSession(await api.login({ username, password }));
    setNeedsSetup(false);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSession(null);
  }, []);

  const savePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    const preferences = await api.updatePreferences(patch);
    setSession((current) => (current ? { ...current, preferences } : current));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      preferences: session?.preferences ?? DEFAULT_USER_PREFERENCES,
      loading,
      needsSetup,
      siteName,
      refresh,
      signIn,
      signOut,
      savePreferences,
    }),
    [session, loading, needsSetup, siteName, refresh, signIn, signOut, savePreferences]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function useIsAdmin(): boolean {
  const { session } = useAuth();
  return session?.user.role === "admin";
}
