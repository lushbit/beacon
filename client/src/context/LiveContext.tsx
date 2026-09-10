import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LiveServerMessage, MetricSample } from "@beacon/shared";
import { api } from "@/lib/api";
import { useAuth } from "./AuthContext";

export interface LiveAlert {
  id: string;
  deviceId: string;
  deviceName: string;
  ruleName: string;
  severity: string;
  state: string;
  message: string;
  startedAt: number;
  resolvedAt: number | null;
  value: number | null;
}

/**
 * How values are currently being refreshed. The socket is preferred, but some
 * setups block it — a proxy that does not forward upgrades, or a self-signed
 * certificate that the browser accepts for pages but refuses for `wss://`.
 * Rather than silently freeze, the dashboard falls back to polling.
 */
export type LiveMode = "live" | "polling" | "connecting";

interface LiveValue {
  connected: boolean;
  mode: LiveMode;
  samples: Record<string, MetricSample>;
  statuses: Record<string, { status: "online" | "offline"; lastSeenAt: number | null }>;
  lastAlert: LiveAlert | null;
  updates: Record<string, { state: string; targetVersion: string | null; error: string | null }>;
}

const LiveContext = createContext<LiveValue | null>(null);

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/live`;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [connected, setConnected] = useState(false);
  const [samples, setSamples] = useState<Record<string, MetricSample>>({});
  const [statuses, setStatuses] = useState<LiveValue["statuses"]>({});
  const [lastAlert, setLastAlert] = useState<LiveAlert | null>(null);
  const [socketFailed, setSocketFailed] = useState(false);
  const [updates, setUpdates] = useState<LiveValue["updates"]>({});

  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(1000);

  useEffect(() => {
    if (!session) {
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
      return;
    }

    let disposed = false;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setSocketFailed(false);
        retryRef.current = 1000;
        socket.send(JSON.stringify({ type: "subscribe", deviceIds: "all" }));
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: LiveServerMessage;
        try {
          message = JSON.parse(event.data) as LiveServerMessage;
        } catch {
          return;
        }
        switch (message.type) {
          case "sample":
            setSamples((current) => ({ ...current, [message.deviceId]: message.sample }));
            return;
          case "device_status":
            setStatuses((current) => ({
              ...current,
              [message.deviceId]: { status: message.status, lastSeenAt: message.lastSeenAt },
            }));
            return;
          case "alert":
            setLastAlert(message.alert);
            return;
          case "agent_update":
            setUpdates((current) => ({ ...current, [message.deviceId]: message.state }));
            return;
          default:
            return;
        }
      };

      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (disposed) return;
        // One failed attempt is normal (a restart, a blip). Repeated failures
        // mean the socket is not going to work here, so start polling.
        if (retryRef.current >= 4000) setSocketFailed(true);
        retryTimer = window.setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, 15_000);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session]);

  // Fallback refresh: only runs while the socket is unusable.
  useEffect(() => {
    if (!session || connected || !socketFailed) return;

    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const devices = await api.devices();
        if (cancelled) return;
        setSamples((current) => {
          const next = { ...current };
          for (const device of devices) if (device.latest) next[device.id] = device.latest;
          return next;
        });
        setStatuses((current) => {
          const next = { ...current };
          for (const device of devices) {
            if (device.status !== "never") {
              next[device.id] = { status: device.status, lastSeenAt: device.lastSeenAt };
            }
          }
          return next;
        });
      } catch {
        /* keep the last values rather than blanking the dashboard */
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, connected, socketFailed]);

  const mode: LiveMode = connected ? "live" : socketFailed ? "polling" : "connecting";

  const value = useMemo<LiveValue>(
    () => ({ connected, mode, samples, statuses, lastAlert, updates }),
    [connected, mode, samples, statuses, lastAlert, updates]
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const context = useContext(LiveContext);
  if (!context) throw new Error("useLive must be used inside LiveProvider");
  return context;
}
